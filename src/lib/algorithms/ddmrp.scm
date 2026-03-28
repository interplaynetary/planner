;;; ddmrp.scm — DDMRP buffer algorithms
;;;
;;; Translated from src/lib/algorithms/ddmrp.ts
;;; Pure functions: ADU, DLT, NFP, zone computation, buffer recalibration,
;;; replenishment signal generation, prioritized share allocation.
;;;
;;; DDMRP ref: Ptak & Smith — Demand Driven Material Requirements Planning

;; Assumes schemas.scm, store-utils.scm, propagation.scm are loaded.

(use-modules (srfi srfi-1)
             (goblins utils hashmap))

(define *epsilon* 1e-9)
(define *seconds-per-day* 86400)

;; Actions whose onhandEffect is 'decrement (consuming actions)
(define *consuming-actions*
  '(consume combine pickup accept))


;; =========================================================================
;; ADU — Average Daily Usage
;; =========================================================================

(define (compute-adu events spec-id window-days as-of-seconds)
  "Compute rolling ADU from historical EconomicEvents.
   events: list of <economic-event>.
   as-of-seconds: POSIX epoch seconds.
   Returns alist: ((adu . number) (unit . string) (window-days . number)
                    (sample-count . number))."
  (let* ((window-start (- as-of-seconds (* window-days *seconds-per-day*)))
         (consuming
           (filter (lambda (e)
                     (and (equal? (economic-event-resource-conforms-to e) spec-id)
                          (memq (economic-event-action e) *consuming-actions*)
                          (not (economic-event-exclude-from-adu e))
                          (economic-event-has-point-in-time e)
                          (let ((ts (iso-datetime->epoch
                                      (economic-event-has-point-in-time e))))
                            (and (>= ts window-start) (<= ts as-of-seconds)))))
                   events))
         (total-qty (fold (lambda (e acc)
                            (+ acc (if (economic-event-resource-quantity e)
                                       (measure-has-numerical-value
                                         (economic-event-resource-quantity e))
                                       0)))
                          0 consuming))
         (unit (if (and (pair? consuming)
                        (economic-event-resource-quantity (car consuming)))
                   (measure-has-unit (economic-event-resource-quantity (car consuming)))
                   "each")))
    `((adu . ,(if (> window-days 0) (/ total-qty window-days) 0))
      (unit . ,unit)
      (window-days . ,window-days)
      (sample-count . ,(length consuming)))))

(define (compute-forward-adu intents spec-id window-days as-of-seconds)
  "Forward-looking ADU from planned consuming intents within horizon.
   intents: list of <intent>."
  (let* ((horizon-end (+ as-of-seconds (* window-days *seconds-per-day*)))
         (consuming
           (filter (lambda (i)
                     (and (equal? (intent-resource-conforms-to i) spec-id)
                          (intent-input-of i)
                          (not (memq (intent-action i)
                                     '(use work cite deliver-service)))
                          (intent-due i)
                          (let ((ts (iso-datetime->epoch (intent-due i))))
                            (and (>= ts as-of-seconds) (<= ts horizon-end)))))
                   intents))
         (total-qty (fold (lambda (i acc)
                            (+ acc (if (intent-resource-quantity i)
                                       (measure-has-numerical-value
                                         (intent-resource-quantity i))
                                       0)))
                          0 consuming)))
    (if (> window-days 0) (/ total-qty window-days) 0)))

(define (blend-adu past forward . rest)
  "Blend past and forward ADU. ratio: 0=forward-only, 1=past-only, 0.5=equal."
  (let ((ratio (if (pair? rest) (car rest) 1)))
    (+ (* past ratio) (* forward (- 1 ratio)))))


;; =========================================================================
;; Lead Time
;; =========================================================================

(define (recipe-lead-time recipe-id recipe-store)
  "Template DLT via critical path (longest duration chain) through recipe processes.
   Returns days."
  (let* ((chain ($ recipe-store 'get-process-chain recipe-id)))
    (if (null? chain) 0
        (fold (lambda (rp acc) (+ acc (rp-duration-days rp))) 0 chain))))

(define (compute-decoupled-lead-time target-spec-id buffered-specs recipe-store
                                      . rest)
  "Compute DLT stopping at buffer boundaries (decoupling points).
   buffered-specs: set (list) of spec-ids that have buffers.
   Recursive for non-buffered inputs. Returns days."
  (let ((computing (if (pair? rest) (car rest) '())))
    (if (member target-spec-id computing) 0  ;; cycle guard
        (let* ((recipe ($ recipe-store 'recipe-for-output target-spec-id)))
          (if (not recipe) 0
              (let* ((chain ($ recipe-store 'get-process-chain (recipe-id recipe)))
                     (new-computing (cons target-spec-id computing)))
                (fold
                  (lambda (rp acc)
                    (let* ((pid (recipe-process-id rp))
                           (flows-pair ($ recipe-store 'flows-for-process pid))
                           (inputs (car flows-pair))
                           ;; Max input lead time (only non-buffered inputs)
                           (input-lt
                             (fold (lambda (f best)
                                     (let ((spec (recipe-flow-resource-conforms-to f)))
                                       (if (or (not spec)
                                               (member spec buffered-specs)
                                               (memq (recipe-flow-action f)
                                                     '(use work cite deliver-service)))
                                           best
                                           (max best
                                                (compute-decoupled-lead-time
                                                  spec buffered-specs recipe-store
                                                  new-computing)))))
                                   0 inputs)))
                      (+ acc (rp-duration-days rp) input-lt)))
                  0 chain)))))))


;; =========================================================================
;; Demand Qualification (OST filtering)
;; =========================================================================

(define (qualify-demand spec-id today-seconds buffer-zone profile plan-store)
  "OST-filtered qualified demand due within the spike horizon.
   Returns total qualified demand quantity."
  (let* ((dlt (buffer-zone-dlt-days buffer-zone))
         (ost-horizon-days (or (buffer-zone-ost-horizon-days buffer-zone)
                               (inexact->exact (ceiling (* dlt 0.5)))))
         (horizon-end (+ today-seconds (* ost-horizon-days *seconds-per-day*)))
         (ost-mult (and profile (buffer-profile-ost-multiplier profile)))
         (adu (buffer-zone-adu buffer-zone))
         (spike-threshold (and ost-mult (* adu ost-mult)))
         ;; Get all consuming commitments + intents for this spec
         (commitments ($ plan-store 'commitments-for-spec spec-id))
         (intents ($ plan-store 'intents-for-spec spec-id)))
    (let ((demand-from-commitments
            (fold (lambda (c acc)
                    (if (and (not (commitment-finished c))
                             (commitment-input-of c)
                             (commitment-due c)
                             (let ((ts (iso-datetime->epoch (commitment-due c))))
                               (<= ts horizon-end)))
                        (let ((qty (if (commitment-resource-quantity c)
                                       (measure-has-numerical-value
                                         (commitment-resource-quantity c))
                                       0)))
                          (if (and spike-threshold (> qty spike-threshold))
                              acc  ;; spike — excluded
                              (+ acc qty)))
                        acc))
                  0 commitments))
          (demand-from-intents
            (fold (lambda (i acc)
                    (if (and (not (intent-finished i))
                             (intent-input-of i)
                             (intent-due i)
                             (not (memq (intent-action i)
                                        '(use work cite deliver-service)))
                             (let ((ts (iso-datetime->epoch (intent-due i))))
                               (<= ts horizon-end)))
                        (let ((qty (if (intent-resource-quantity i)
                                       (measure-has-numerical-value
                                         (intent-resource-quantity i))
                                       0)))
                          (if (and spike-threshold (> qty spike-threshold))
                              acc  ;; spike — excluded
                              (+ acc qty)))
                        acc))
                  0 intents)))
      (+ demand-from-commitments demand-from-intents))))


;; =========================================================================
;; NFP — Net Flow Position
;; =========================================================================

(define (compute-nfp spec-id buffer-zone profile plan-store observer
                      . rest)
  "Compute NFP = onhand + onorder - qualifiedDemand.
   Returns alist: ((nfp . number) (onhand . number) (onorder . number)
                    (qualified-demand . number) (zone . symbol) (priority . number))."
  (let* ((today-seconds (if (pair? rest) (car rest) (current-time)))
         ;; Onhand: sum of onhandQuantity for conforming resources
         (resources ($ observer 'conforming-resources spec-id))
         (onhand (fold (lambda (r acc)
                         (+ acc (if (economic-resource-onhand-quantity r)
                                    (measure-has-numerical-value
                                      (economic-resource-onhand-quantity r))
                                    0)))
                       0 resources))
         ;; Onorder: sum of open supply commitments (outputOf set, not finished)
         (all-commitments ($ plan-store 'commitments-for-spec spec-id))
         (onorder (fold (lambda (c acc)
                          (if (and (commitment-output-of c)
                                   (not (commitment-finished c))
                                   (commitment-resource-quantity c))
                              (+ acc (measure-has-numerical-value
                                       (commitment-resource-quantity c)))
                              acc))
                        0 all-commitments))
         ;; Qualified demand
         (qd (qualify-demand spec-id today-seconds buffer-zone profile plan-store))
         ;; NFP
         (nfp (- (+ onhand onorder) qd))
         ;; Zone classification
         (tor (buffer-zone-tor buffer-zone))
         (toy (buffer-zone-toy buffer-zone))
         (tog (buffer-zone-tog buffer-zone))
         (zone (cond ((<= nfp tor) 'red)
                     ((<= nfp toy) 'yellow)
                     ((<= nfp tog) 'green)
                     (else 'excess)))
         (priority (if (> tog 0) (/ nfp tog) 1.0)))
    `((nfp . ,nfp) (onhand . ,onhand) (onorder . ,onorder)
      (qualified-demand . ,qd) (zone . ,zone) (priority . ,priority))))


;; =========================================================================
;; Buffer Zone Computation (Ptak & Smith Ch 8)
;; =========================================================================

(define (compute-buffer-zone-levels profile adu adu-unit dlt-days moq moq-unit
                                     . rest)
  "Compute TOR/TOY/TOG zone boundaries.
   Formula:
     red-base   = ADU * DLT * LTF
     red-safety  = red-base * VF
     TOR        = (red-base + red-safety) * ZAF_red
     TOY        = TOR + ADU * DLT * ZAF_yellow
     green      = max(ADU * DOC, red-base, MOQ) * ZAF_green
     TOG        = TOY + green
   Returns alist: ((tor . n) (toy . n) (tog . n) (red-base . n) (red-safety . n))."
  (let* ((opts (if (pair? rest) (car rest) '()))
         (daf (or (assq-ref opts 'demand-adj-factor) 1.0))
         (ltaf (or (assq-ref opts 'lead-time-adj-factor) 1.0))
         (zaf-red (or (assq-ref opts 'red-zone-adj-factor) 1.0))
         (zaf-yellow (or (assq-ref opts 'yellow-zone-adj-factor) 1.0))
         (zaf-green (or (assq-ref opts 'green-zone-adj-factor) 1.0))
         (doc-days (or (assq-ref opts 'doc-days)
                       (and profile (buffer-profile-order-cycle-days profile))
                       0))
         (effective-adu (* adu daf))
         (effective-dlt (* dlt-days ltaf))
         (ltf (buffer-profile-lead-time-factor profile))
         (vf (buffer-profile-variability-factor profile))
         ;; Red zone
         (red-base (* effective-adu effective-dlt ltf))
         (red-safety (* red-base vf))
         (tor (* (+ red-base red-safety) zaf-red))
         ;; Yellow zone
         (toy (+ tor (* effective-adu effective-dlt zaf-yellow)))
         ;; Green zone: three-way max
         (green-adu-doc (* effective-adu doc-days))
         (green (max green-adu-doc red-base moq))
         (tog (+ toy (* green zaf-green))))
    `((tor . ,tor) (toy . ,toy) (tog . ,tog)
      (red-base . ,red-base) (red-safety . ,red-safety))))


;; =========================================================================
;; Buffer Recalibration
;; =========================================================================

(define (recalibrate-buffer-zone existing new-adu new-dlt-days profile
                                 adjustments as-of-seconds)
  "Recalibrate a BufferZone with fresh ADU and DLT.
   Returns a new <buffer-zone> record."
  (let* ((classification (buffer-zone-buffer-classification existing)))
    ;; Override zones are user-managed — never auto-recalculate
    (if (eq? classification 'replenished-override)
        existing
        (let* (;; Aggregate adjustment factors
               (agg (aggregate-adjustment-factors adjustments as-of-seconds
                      (buffer-zone-spec-id existing)
                      (buffer-zone-at-location existing)))
               (opts `((demand-adj-factor . ,(or (assq-ref agg 'demand) 1.0))
                       (lead-time-adj-factor . ,(or (assq-ref agg 'lead-time) 1.0))
                       (red-zone-adj-factor . ,(or (assq-ref agg 'red) 1.0))
                       (yellow-zone-adj-factor . ,(or (assq-ref agg 'yellow) 1.0))
                       (green-zone-adj-factor . ,(or (assq-ref agg 'green) 1.0))
                       (doc-days . ,(or (buffer-zone-order-cycle-days existing)
                                        (and profile (buffer-profile-order-cycle-days profile))
                                        0))))
               (levels (compute-buffer-zone-levels
                         profile new-adu (buffer-zone-adu-unit existing)
                         new-dlt-days (buffer-zone-moq existing)
                         (buffer-zone-moq-unit existing) opts))
               ;; Build ISO timestamp
               ;; (simplified — use epoch seconds as string for now)
               (timestamp (number->string as-of-seconds)))
          ;; Reconstruct buffer-zone with updated values
          (make-buffer-zone
            (buffer-zone-id existing)
            (buffer-zone-spec-id existing)
            (buffer-zone-profile-id existing)
            classification
            (buffer-zone-at-location existing)
            (buffer-zone-upstream-location-id existing)
            (buffer-zone-replenishment-recipe-id existing)
            (buffer-zone-upstream-stage-id existing)
            (buffer-zone-downstream-stage-id existing)
            new-adu (buffer-zone-adu-unit existing)
            (buffer-zone-adu-blend-ratio existing)
            (buffer-zone-adu-window-days existing)
            (buffer-zone-adu-computed-from existing)
            (buffer-zone-adu-alert-high-pct existing)
            (buffer-zone-adu-alert-low-pct existing)
            (buffer-zone-adu-alert-window-days existing)
            (buffer-zone-estimated-adu existing)
            (buffer-zone-bootstrap-days-accumulated existing)
            (buffer-zone-ost-horizon-days existing)
            new-dlt-days
            (buffer-zone-moq existing)
            (buffer-zone-moq-unit existing)
            (buffer-zone-order-cycle-days existing)
            (buffer-zone-override-reason existing)
            (buffer-zone-override-note existing)
            (buffer-zone-transport-days existing)
            (buffer-zone-staging-days existing)
            (assq-ref levels 'tor)
            (assq-ref levels 'toy)
            (assq-ref levels 'tog)
            (buffer-zone-tipping-point existing)
            (assq-ref levels 'red-base)
            (assq-ref levels 'red-safety)
            (or (assq-ref opts 'demand-adj-factor) 1.0)
            (or (assq-ref opts 'green-zone-adj-factor) 1.0)
            (or (assq-ref opts 'lead-time-adj-factor) 1.0)
            (buffer-zone-supply-offset-days existing)
            #f  ;; activeAdjustmentIds — would need DAF IDs
            timestamp)))))


;; =========================================================================
;; Adjustment Factor Aggregation
;; =========================================================================

(define (aggregate-adjustment-factors adjustments as-of-seconds spec-id
                                      . rest)
  "Aggregate active DemandAdjustmentFactors by type.
   Returns alist: ((demand . factor) (lead-time . factor)
                    (red . factor) (yellow . factor) (green . factor))."
  (let* ((at-location (and (pair? rest) (car rest)))
         (active (filter
                   (lambda (daf)
                     (and (equal? (demand-adjustment-factor-spec-id daf) spec-id)
                          (or (not at-location)
                              (not (demand-adjustment-factor-at-location daf))
                              (equal? (demand-adjustment-factor-at-location daf) at-location))
                          (or (not (demand-adjustment-factor-is-active daf))
                              (demand-adjustment-factor-is-active daf))
                          (let ((from (iso-datetime->epoch
                                        (demand-adjustment-factor-valid-from daf)))
                                (to (iso-datetime->epoch
                                      (demand-adjustment-factor-valid-to daf))))
                            (and (<= from as-of-seconds) (>= to as-of-seconds)))))
                   adjustments)))
    ;; Compound factors of same type (multiply)
    (fold (lambda (daf acc)
            (let* ((typ (demand-adjustment-factor-type daf))
                   (fac (demand-adjustment-factor-factor daf))
                   (target (or (demand-adjustment-factor-target-zone daf) 'red))
                   (key (if (eq? typ 'zone) target typ))
                   (current (or (assq-ref acc key) 1.0)))
              (assq-set! acc key (* current fac))))
          '((demand . 1.0) (lead-time . 1.0) (red . 1.0) (yellow . 1.0) (green . 1.0))
          active)))

;; Helper: assq-set! for alists (functional update)
(define (assq-set! alist key val)
  "Return a new alist with key mapped to val."
  (cons (cons key val)
        (filter (lambda (pair) (not (eq? (car pair) key))) alist)))


;; =========================================================================
;; Buffer Status
;; =========================================================================

(define (buffer-status onhand buffer-zone)
  "Current buffer status relative to zone boundaries.
   Returns alist: ((zone . symbol) (pct . number) (onhand . number)
                    (tipping-point-breached . boolean))."
  (let* ((tor (buffer-zone-tor buffer-zone))
         (toy (buffer-zone-toy buffer-zone))
         (tog (buffer-zone-tog buffer-zone))
         (tp (buffer-zone-tipping-point buffer-zone))
         (zone (cond ((<= onhand tor) 'red)
                     ((<= onhand toy) 'yellow)
                     ((<= onhand tog) 'green)
                     (else 'excess)))
         (pct (if (> tog 0) (* (/ onhand tog) 100) 100))
         (tp-breached (and tp (< onhand tp))))
    `((zone . ,zone) (pct . ,pct) (onhand . ,onhand)
      (tipping-point-breached . ,tp-breached))))


;; =========================================================================
;; Replenishment Signal Generation
;; =========================================================================

(define (generate-replenishment-signal spec-id nfp-result buffer-zone today-seconds
                                       . rest)
  "Generate an NFP-triggered supply order proposal when NFP <= TOY.
   nfp-result: alist from compute-nfp.
   Returns <replenishment-signal> record or #f if not needed."
  (let* ((at-location (and (pair? rest) (car rest)))
         (nfp (assq-ref nfp-result 'nfp))
         (toy (buffer-zone-toy buffer-zone))
         (tog (buffer-zone-tog buffer-zone))
         (zone (assq-ref nfp-result 'zone)))
    (if (> nfp toy) #f  ;; green/excess — no signal needed
        (let* ((moq (buffer-zone-moq buffer-zone))
               (raw-qty (- tog nfp))
               (recommended (if (> moq 0)
                                (* (ceiling (/ raw-qty moq)) moq)
                                raw-qty))
               (dlt (buffer-zone-dlt-days buffer-zone))
               (offset (or (buffer-zone-supply-offset-days buffer-zone) 0))
               (due-seconds (+ today-seconds (* (+ dlt offset) *seconds-per-day*)))
               (due-date (number->string due-seconds)))
          (make-replenishment-signal
            (generate-id "rs-")
            spec-id at-location
            (buffer-zone-id buffer-zone)
            (assq-ref nfp-result 'onhand)
            (assq-ref nfp-result 'onorder)
            (assq-ref nfp-result 'qualified-demand)
            nfp
            (assq-ref nfp-result 'priority)
            zone
            recommended
            due-date
            'open #f
            (number->string today-seconds))))))


;; =========================================================================
;; Prioritized Share Allocation
;; =========================================================================

(define (prioritized-share slots total-supply)
  "Allocate scarce supply across multiple buffer locations using DDMRP
   sequential zone-fill. Returns alist of (slot-id . allocated-qty).
   slots: list of alists with keys: id, onhand, tor, toy, tog.
   Note: slot IDs are strings, so we use assoc (equal?) not assq (eq?)."
  (let* ((result '())
         (remaining total-supply))
    ;; Helper: lookup in result by string key
    (define (result-ref id) (let ((p (assoc id result))) (if p (cdr p) 0)))
    (define (result-set! id val)
      (set! result (cons (cons id val)
                         (filter (lambda (p) (not (equal? (car p) id))) result))))
    ;; Phase 1: Fill all to TOR
    (for-each
      (lambda (slot)
        (let* ((id (assq-ref slot 'id))
               (onhand (assq-ref slot 'onhand))
               (tor (assq-ref slot 'tor))
               (gap (max 0 (- tor onhand)))
               (alloc (min gap remaining)))
          (when (> alloc 0)
            (result-set! id alloc)
            (set! remaining (- remaining alloc)))))
      slots)
    ;; Phase 2: Fill to TOY
    (when (> remaining *epsilon*)
      (for-each
        (lambda (slot)
          (let* ((id (assq-ref slot 'id))
                 (already (result-ref id))
                 (onhand (+ (assq-ref slot 'onhand) already))
                 (toy (assq-ref slot 'toy))
                 (gap (max 0 (- toy onhand)))
                 (alloc (min gap remaining)))
            (when (> alloc 0)
              (result-set! id (+ already alloc))
              (set! remaining (- remaining alloc)))))
        slots))
    ;; Phase 3: Distribute surplus by green zone size
    (when (> remaining *epsilon*)
      (let* ((total-green (fold (lambda (s acc)
                                  (+ acc (- (assq-ref s 'tog)
                                            (assq-ref s 'toy))))
                                0 slots)))
        (when (> total-green 0)
          (for-each
            (lambda (slot)
              (let* ((id (assq-ref slot 'id))
                     (green (- (assq-ref slot 'tog) (assq-ref slot 'toy)))
                     (share (/ green total-green))
                     (alloc (min (* remaining share) remaining))
                     (already (result-ref id)))
                (when (> alloc *epsilon*)
                  (result-set! id (+ already alloc)))))
            slots))))
    result))
