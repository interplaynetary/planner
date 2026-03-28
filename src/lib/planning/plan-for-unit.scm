;;; plan-for-unit.scm — Multi-pass planning orchestrator
;;;
;;; Translated from src/lib/planning/plan-for-unit.ts
;;;
;;; This is the core planning algorithm. It takes a set of location/scope IDs,
;;; a time horizon, and a planning context (stores + indexes), and produces a
;;; plan store populated with intents, commitments, and processes.
;;;
;;; Architecture: The planner is a compiler pipeline:
;;;   Demands (source) → Classify (lexing) → Explode via recipes (parsing)
;;;   → Net against inventory (constraint solving) → Schedule (code gen)
;;;   → Emit signals (output)
;;;
;;; The pipeline is composed of pure phases. The netter is the symbol table.
;;; Backtracking is the constraint solver's search.

;; Assumes all store actors, algorithms, and schemas are loaded.

(use-modules (srfi srfi-1)
             (srfi srfi-11)
             (goblins utils hashmap))

(define *epsilon-pu* 1e-9)


;; ═════════════════════════════════════════════════════════════════════════
;; Demand/Supply slot types (alists)
;; ═════════════════════════════════════════════════════════════════════════
;;
;; DemandSlot keys: intent-id, spec-id, action, remaining-quantity,
;;                  required-quantity, unit, due, at-location, provider, receiver
;;
;; SupplySlot keys: id, slot-type (inventory|scheduled|labor),
;;                  spec-id, quantity, available-from, at-location
;;
;; DemandSlotClass: locally-satisfiable | transport-candidate |
;;                  producible-with-imports | external-dependency

(define *class-order*
  '((locally-satisfiable . 0) (transport-candidate . 1)
    (producible-with-imports . 2) (external-dependency . 3)))


;; ═════════════════════════════════════════════════════════════════════════
;; Phase 1: Normalize
;; ═════════════════════════════════════════════════════════════════════════

(define (normalize-phase ids normalize-fn)
  "Deduplicate and filter IDs via the spatial model's normalize function."
  (normalize-fn ids))


;; ═════════════════════════════════════════════════════════════════════════
;; Phase 2: Extract demand/supply slots
;; ═════════════════════════════════════════════════════════════════════════

(define (extract-demands-from-intents plan-store canonical-ids)
  "Extract demand slots from open intents in the plan store.
   Returns list of demand slot alists."
  (let ((open ($ plan-store 'open-intents)))
    (filter-map
      (lambda (intent)
        (let ((rq (intent-resource-quantity intent)))
          (and rq (> (measure-has-numerical-value rq) *epsilon-pu*)
               `((intent-id . ,(intent-id intent))
                 (spec-id . ,(intent-resource-conforms-to intent))
                 (action . ,(intent-action intent))
                 (remaining-quantity . ,(measure-has-numerical-value rq))
                 (required-quantity . ,(measure-has-numerical-value rq))
                 (unit . ,(measure-has-unit rq))
                 (due . ,(intent-due intent))
                 (at-location . ,(intent-at-location intent))
                 (provider . ,(intent-provider intent))
                 (receiver . ,(intent-receiver intent))))))
      open)))

(define (extract-supply-from-observer observer canonical-ids)
  "Extract inventory supply slots from observer resources.
   Returns list of supply slot alists."
  (let ((resources ($ observer 'all-resources)))
    (filter-map
      (lambda (r)
        (let ((qty (measure-qty (economic-resource-onhand-quantity r))))
          (and (> qty *epsilon-pu*)
               `((id . ,(string-append "inv:" (economic-resource-id r)))
                 (slot-type . inventory)
                 (spec-id . ,(economic-resource-conforms-to r))
                 (quantity . ,qty)
                 (at-location . ,(economic-resource-current-location r))))))
      resources)))


;; ═════════════════════════════════════════════════════════════════════════
;; Phase 3: Classify demands
;; ═════════════════════════════════════════════════════════════════════════

(define (classify-demand slot supply-slots recipe-store)
  "Classify a demand slot into one of four categories."
  (let* ((spec-id (assq-ref slot 'spec-id))
         ;; Check for local supply
         (has-local-supply
           (any (lambda (s) (equal? (assq-ref s 'spec-id) spec-id))
                supply-slots))
         ;; Check for recipe
         (has-recipe (and spec-id
                         (not (null? ($ recipe-store 'recipes-for-output spec-id))))))
    (cond
      (has-local-supply 'locally-satisfiable)
      (has-recipe 'producible-with-imports)
      (else 'external-dependency))))


;; ═════════════════════════════════════════════════════════════════════════
;; Phase 4: Formulate — the core multi-pass logic
;; ═════════════════════════════════════════════════════════════════════════

(define (formulate-phase classified-demands supply-slots
                         recipe-store plan-store observer
                         plan-id agents horizon)
  "The core multi-pass planning algorithm.
   Returns alist: ((processes . list) (commitments . list) (intents . list)
                    (purchase-intents . list) (deficit-signals . list)
                    (surplus-signals . list))."

  (define ns (empty-netter-state))  ;; pure state monad
  (define all-processes '())
  (define all-commitments '())
  (define all-intents '())
  (define all-purchase-intents '())
  (define deficit-signals '())
  (define surplus-signals '())

  ;; Sort demands: by class order, then by due date
  (define sorted-demands
    (sort classified-demands
      (lambda (a b)
        (let ((ca (or (assq-ref *class-order* (assq-ref a 'class)) 3))
              (cb (or (assq-ref *class-order* (assq-ref b 'class)) 3)))
          (if (= ca cb)
              ;; Same class: earlier due first
              (let ((da (or (assq-ref a 'due) "9999"))
                    (db (or (assq-ref b 'due) "9999")))
                (string<? da db))
              (< ca cb))))))

  ;; --- Pass 1: Explode primary demands ---
  (for-each
    (lambda (classified)
      (let* ((slot (assq-ref classified 'slot))
             (slot-class (assq-ref classified 'class))
             (spec-id (assq-ref slot 'spec-id))
             (qty (assq-ref slot 'remaining-quantity))
             (unit (or (assq-ref slot 'unit) "each"))
             (due (or (assq-ref slot 'due)
                      (and (pair? horizon) (cdr horizon))
                      (number->string (current-time)))))

        (when (and spec-id (> qty *epsilon-pu*))
          (let ((due-epoch (if (number? due) due (iso-datetime->epoch due))))
            (let-values (((new-ns result)
                          (dependent-demand
                            plan-id spec-id qty due-epoch
                            recipe-store plan-store observer ns
                            #:agents agents)))
              (set! ns new-ns)
              ;; Accumulate results
              (set! all-processes
                (append (assq-ref result 'processes) all-processes))
              (set! all-commitments
                (append (assq-ref result 'commitments) all-commitments))
              (set! all-intents
                (append (assq-ref result 'intents) all-intents))
              ;; Track purchase intents
              (let ((purchases (assq-ref result 'purchase-intents)))
                (set! all-purchase-intents
                  (append purchases all-purchase-intents))
                ;; Emit deficit signals for unresolved demands
                (let ((unresolved-qty
                        (fold (lambda (pi acc)
                                (+ acc (if (and (intent-resource-quantity pi)
                                                (equal? (intent-resource-conforms-to pi) spec-id))
                                           (measure-has-numerical-value
                                             (intent-resource-quantity pi))
                                           0)))
                              0 purchases)))
                  (when (> unresolved-qty *epsilon-pu*)
                    (set! deficit-signals
                      (cons `((kind . deficit)
                              (spec-id . ,spec-id)
                              (qty . ,unresolved-qty)
                              (unit . ,unit)
                              (due . ,due)
                              (original-shortfall . ,unresolved-qty)
                              (resolved-at . ())
                              (source . unmet-demand))
                            deficit-signals))))))))))
    sorted-demands)

  ;; --- Supply phase: forward-schedule available supply ---
  (for-each
    (lambda (supply-slot)
      (let* ((spec-id (assq-ref supply-slot 'spec-id))
             (qty (assq-ref supply-slot 'quantity))
             (avail-epoch (or (and (assq-ref supply-slot 'available-from)
                                   (iso-datetime->epoch (assq-ref supply-slot 'available-from)))
                              (current-time))))
        (when (and spec-id (> qty *epsilon-pu*))
          (let-values (((new-ns result)
                        (dependent-supply
                          plan-id spec-id qty avail-epoch
                          recipe-store plan-store observer ns
                          #:agents agents)))
            (set! ns new-ns)
            (set! all-processes
              (append (assq-ref result 'processes) all-processes))
            (set! all-commitments
              (append (assq-ref result 'commitments) all-commitments))
            (set! all-intents
              (append (assq-ref result 'intents) all-intents))
            (set! all-purchase-intents
              (append (assq-ref result 'purchase-intents) all-purchase-intents))
            ;; Surplus signals
            (for-each
              (lambda (s)
                (set! surplus-signals
                  (cons `((kind . surplus)
                          (spec-id . ,(assq-ref s 'spec-id))
                          (qty . ,(assq-ref s 'quantity))
                          (unit . "each"))
                        surplus-signals)))
              (assq-ref result 'surplus))))))
    supply-slots)

  ;; Return accumulated results
  `((processes . ,(reverse all-processes))
    (commitments . ,(reverse all-commitments))
    (intents . ,(reverse all-intents))
    (purchase-intents . ,(reverse all-purchase-intents))
    (deficit-signals . ,(reverse deficit-signals))
    (surplus-signals . ,(reverse surplus-signals))))


;; ═════════════════════════════════════════════════════════════════════════
;; Phase 5: Collect — emit signals and return result
;; ═════════════════════════════════════════════════════════════════════════

(define (collect-phase formulated plan-store plan-id)
  "Emit deficit/surplus signals to the plan store. Returns the plan result."
  (let ((deficits (assq-ref formulated 'deficit-signals))
        (surpluses (assq-ref formulated 'surplus-signals)))
    ;; Emit deficit signals
    (for-each
      (lambda (sig)
        (let-values (((intent meta) (signal->intent sig plan-id)))
          ($ plan-store 'add-intent intent)
          ($ plan-store 'set-meta (intent-id intent) meta)))
      deficits)
    ;; Emit surplus signals
    (for-each
      (lambda (sig)
        (let-values (((intent meta) (signal->intent sig plan-id)))
          ($ plan-store 'add-intent intent)
          ($ plan-store 'set-meta (intent-id intent) meta)))
      surpluses)
    formulated))


;; ═════════════════════════════════════════════════════════════════════════
;; plan-for-unit — main entry point
;; ═════════════════════════════════════════════════════════════════════════

(define* (plan-for-unit ids horizon
                        recipe-store plan-store observer
                        #:key (agents #f) (normalize-fn identity)
                              (plan-name "Plan"))
  "The multi-pass planning algorithm.
   ids: list of location/scope identifiers.
   horizon: alist with 'from and 'to keys (epoch seconds or ISO strings).
   Returns alist with keys: plan-id, processes, commitments, intents,
   purchase-intents, deficit-signals, surplus-signals."

  ;; Phase 1: Normalize IDs
  (let* ((canonical (normalize-phase ids normalize-fn))
         ;; Create the plan
         (plan-id (generate-id "plan-"))
         (_ ($ plan-store 'add-plan
               (make-plan plan-id plan-name #f #f #f #f #f #f)))

         ;; Phase 2: Extract demand/supply slots
         (demands (extract-demands-from-intents plan-store canonical))
         (supply (extract-supply-from-observer observer canonical))

         ;; Phase 3: Classify demands
         (classified (map (lambda (d)
                            `((slot . ,d)
                              (class . ,(classify-demand d supply recipe-store))))
                          demands))

         ;; Phase 4: Formulate (multi-pass explosion + netting)
         (formulated (formulate-phase classified supply
                       recipe-store plan-store observer
                       plan-id agents horizon))

         ;; Phase 5: Collect (emit signals)
         (result (collect-phase formulated plan-store plan-id)))

    ;; Write processes/commitments/intents to plan store
    (for-each (lambda (p)
                ;; Processes aren't stored in plan-store in our implementation
                ;; (they're returned as part of the result)
                #f)
              (assq-ref result 'processes))

    `((plan-id . ,plan-id)
      ,@result)))
