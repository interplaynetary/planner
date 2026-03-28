;;; planning.scm — Goblins actor for the VF planning layer
;;;
;;; Translated from src/lib/planning/planning.ts (PlanStore)
;;; State: 10 hashmaps (plans, commitments, intents, claims, agreements,
;;;        agreement-bundles, proposals, proposal-lists, scenarios,
;;;        scenario-definitions) + signal metadata + secondary indexes.

(use-modules (goblins)
             (goblins actor-lib methods)
             (goblins utils hashmap)
             (srfi srfi-1)
             (srfi srfi-9)
             (ice-9 match))

;; Assumes schemas.scm and store-utils.scm are loaded.


;; =========================================================================
;; Plan store state record (bundles all maps for clean bcom)
;; =========================================================================

(define-record-type <plan-store-state>
  (make-plan-store-state plans commitments intents claims
                         agreements agreement-bundles
                         proposals proposal-lists
                         scenarios scenario-definitions
                         meta
                         ;; secondary indexes (hashmap of key -> list of IDs)
                         tag-index intents-by-spec commitments-by-spec
                         intents-by-plan commitments-by-plan
                         commitments-by-process)
  plan-store-state?
  (plans               pss-plans)
  (commitments         pss-commitments)
  (intents             pss-intents)
  (claims              pss-claims)
  (agreements          pss-agreements)
  (agreement-bundles   pss-agreement-bundles)
  (proposals           pss-proposals)
  (proposal-lists      pss-proposal-lists)
  (scenarios           pss-scenarios)
  (scenario-definitions pss-scenario-definitions)
  (meta                pss-meta)
  (tag-index           pss-tag-index)
  (intents-by-spec     pss-intents-by-spec)
  (commitments-by-spec pss-commitments-by-spec)
  (intents-by-plan     pss-intents-by-plan)
  (commitments-by-plan pss-commitments-by-plan)
  (commitments-by-process pss-commitments-by-process))

(define (empty-plan-store-state)
  (make-plan-store-state
    (hashmap) (hashmap) (hashmap) (hashmap)
    (hashmap) (hashmap) (hashmap) (hashmap)
    (hashmap) (hashmap) (hashmap)
    (hashmap) (hashmap) (hashmap)
    (hashmap) (hashmap) (hashmap)))

;; Helper: update a single field in plan-store-state
(define (pss-with-intents st new-intents)
  (make-plan-store-state
    (pss-plans st) (pss-commitments st) new-intents (pss-claims st)
    (pss-agreements st) (pss-agreement-bundles st)
    (pss-proposals st) (pss-proposal-lists st)
    (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
    (pss-tag-index st) (pss-intents-by-spec st) (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))

(define (pss-with-commitments st new-commitments)
  (make-plan-store-state
    (pss-plans st) new-commitments (pss-intents st) (pss-claims st)
    (pss-agreements st) (pss-agreement-bundles st)
    (pss-proposals st) (pss-proposal-lists st)
    (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
    (pss-tag-index st) (pss-intents-by-spec st) (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))


;; =========================================================================
;; Index maintenance helpers
;; =========================================================================

(define (append-to-index idx key val)
  "Append val to the list stored at key."
  (hashmap-set idx key (cons val (hashmap-ref idx key '()))))

(define (remove-from-index idx key val)
  "Remove val from the list at key."
  (let ((lst (hashmap-ref idx key '())))
    (hashmap-set idx key (delete val lst))))

(define (index-intent-tags tag-index intent)
  "Add intent to tag index for each of its resourceClassifiedAs tags."
  (let ((tags (or (intent-resource-classified-as intent) '()))
        (iid (intent-id intent)))
    (fold (lambda (tag idx) (append-to-index idx tag iid))
          tag-index tags)))

(define (index-intent-spec ibs intent)
  "Add intent to spec index."
  (let ((spec (intent-resource-conforms-to intent)))
    (if spec (append-to-index ibs spec (intent-id intent)) ibs)))

(define (index-commitment-spec cbs commitment)
  "Add commitment to spec index."
  (let ((spec (commitment-resource-conforms-to commitment)))
    (if spec (append-to-index cbs spec (commitment-id commitment)) cbs)))


;; =========================================================================
;; Record <-> list serialization for persistence
;; =========================================================================

(define (sm m)
  (if (and m (measure? m))
      (list (measure-has-numerical-value m) (measure-has-unit m)) #f))
(define (dm lst)
  (if (and lst (pair? lst)) (make-measure (car lst) (cadr lst)) #f))

(define (intent->list i)
  (list (intent-id i) (intent-action i) (intent-name i) (intent-note i)
        (intent-image i) (intent-input-of i) (intent-output-of i)
        (intent-resource-inventoried-as i) (intent-resource-conforms-to i)
        (intent-resource-classified-as i)
        (sm (intent-resource-quantity i)) (sm (intent-effort-quantity i))
        (sm (intent-available-quantity i)) (sm (intent-minimum-quantity i))
        (intent-provider i) (intent-receiver i)
        (intent-has-beginning i) (intent-has-end i) (intent-has-point-in-time i)
        (intent-due i) (intent-at-location i) (intent-stage i) (intent-state i)
        (intent-planned-within i) (intent-satisfies i) (intent-in-scope-of i)
        (intent-finished i) (intent-availability-window i)))

(define (list->intent* lst)
  (match lst
    ((id action name note image input-of output-of rias rct rca
      rq eq aq mq provider receiver hb he hpit due at-loc stage state
      pw satisfies iso finished aw)
     (make-intent id action name note image input-of output-of rias rct rca
                  (dm rq) (dm eq) (dm aq) (dm mq)
                  provider receiver hb he hpit due at-loc stage state
                  pw satisfies iso finished aw))))

(define (commitment->list c)
  (list (commitment-id c) (commitment-action c) (commitment-note c)
        (commitment-input-of c) (commitment-output-of c)
        (commitment-resource-inventoried-as c) (commitment-resource-conforms-to c)
        (commitment-resource-classified-as c)
        (sm (commitment-resource-quantity c)) (sm (commitment-effort-quantity c))
        (commitment-provider c) (commitment-receiver c)
        (commitment-has-beginning c) (commitment-has-end c)
        (commitment-has-point-in-time c) (commitment-due c)
        (commitment-created c) (commitment-at-location c)
        (commitment-in-scope-of c) (commitment-stage c) (commitment-state c)
        (commitment-satisfies c) (commitment-clause-of c)
        (commitment-independent-demand-of c) (commitment-planned-within c)
        (commitment-finished c) (commitment-availability-window c)))

(define (list->commitment* lst)
  (match lst
    ((id action note input-of output-of rias rct rca rq eq
      provider receiver hb he hpit due created at-loc iso stage state
      satisfies clause-of ind-demand pw finished aw)
     (make-commitment id action note input-of output-of rias rct rca
                      (dm rq) (dm eq)
                      provider receiver hb he hpit due created at-loc
                      iso stage state satisfies clause-of ind-demand pw
                      finished aw))))

(define (plan->list p)
  (list (plan-id p) (plan-name p) (plan-note p) (plan-due p)
        (plan-created p) (plan-has-independent-demand p)
        (plan-refinement-of p) (plan-classified-as p)))

(define (list->plan* lst) (apply make-plan lst))

(define (claim->list c)
  (list (claim-id c) (claim-action c) (claim-provider c) (claim-receiver c)
        (claim-triggered-by c)
        (sm (claim-resource-quantity c)) (sm (claim-effort-quantity c))
        (claim-resource-conforms-to c) (claim-resource-classified-as c)
        (claim-due c) (claim-created c) (claim-note c) (claim-finished c)))

(define (list->claim* lst)
  (match lst
    ((id action provider receiver triggered-by rq eq rct rca due created note finished)
     (make-claim id action provider receiver triggered-by
                 (dm rq) (dm eq) rct rca due created note finished))))

(define (agreement->list a)
  (list (agreement-id a) (agreement-name a) (agreement-note a)
        (agreement-created a) (agreement-stipulates a)
        (agreement-stipulates-reciprocal a)))

(define (list->agreement* lst) (apply make-agreement lst))

;; Simplified serializers for less-used types
(define (scenario->list s)
  (list (scenario-id s) (scenario-name s) (scenario-note s)
        (scenario-defined-as s) (scenario-refinement-of s)
        (scenario-has-beginning s) (scenario-has-end s) (scenario-in-scope-of s)))
(define (list->scenario* lst) (apply make-scenario lst))

(define (scenario-definition->list sd)
  (list (scenario-definition-id sd) (scenario-definition-name sd)
        (scenario-definition-note sd) (scenario-definition-has-duration sd)
        (scenario-definition-in-scope-of sd)))
(define (list->scenario-definition* lst) (apply make-scenario-definition lst))


;; =========================================================================
;; Serialize / deserialize full plan-store-state
;; =========================================================================

(define (serialize-plan-store-state st)
  (list (serialize-hashmap (pss-plans st) plan->list)
        (serialize-hashmap (pss-commitments st) commitment->list)
        (serialize-hashmap (pss-intents st) intent->list)
        (serialize-hashmap (pss-claims st) claim->list)
        (serialize-hashmap (pss-agreements st) agreement->list)
        ;; Note: indexes not serialized — rebuilt from data on restore
        (pss-agreement-bundles st)  ;; alist-based, already serializable
        (pss-proposals st)
        (pss-proposal-lists st)
        (serialize-hashmap (pss-scenarios st) scenario->list)
        (serialize-hashmap (pss-scenario-definitions st) scenario-definition->list)
        (pss-meta st)  ;; alist-based metadata
        (pss-tag-index st) (pss-intents-by-spec st) (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))

(define (deserialize-plan-store-state data)
  (match data
    ((sp sc si scl sa sab sprop spl sscen ssd smeta
      stag sibs scbs . _rest)  ;; ignore extra fields if present
     (let* ((d-intents (deserialize-hashmap si list->intent*))
            (d-commitments (deserialize-hashmap sc list->commitment*))
            ;; Rebuild new indexes from data
            (ibp (hashmap-fold (lambda (_id i acc)
                    (let ((pw (intent-planned-within i)))
                      (if pw (hashmap-set acc pw (cons (intent-id i) (hashmap-ref acc pw '()))) acc)))
                  (hashmap) d-intents))
            (cbpl (hashmap-fold (lambda (_id c acc)
                     (let ((pw (commitment-planned-within c)))
                       (if pw (hashmap-set acc pw (cons (commitment-id c) (hashmap-ref acc pw '()))) acc)))
                   (hashmap) d-commitments))
            (cbpr (hashmap-fold (lambda (_id c acc)
                     (let* ((a0 acc)
                            (a1 (if (commitment-input-of c)
                                    (hashmap-set a0 (commitment-input-of c)
                                      (cons (commitment-id c) (hashmap-ref a0 (commitment-input-of c) '())))
                                    a0))
                            (a2 (if (commitment-output-of c)
                                    (hashmap-set a1 (commitment-output-of c)
                                      (cons (commitment-id c) (hashmap-ref a1 (commitment-output-of c) '())))
                                    a1)))
                       a2))
                   (hashmap) d-commitments)))
       (make-plan-store-state
         (deserialize-hashmap sp list->plan*)
         d-commitments d-intents
         (deserialize-hashmap scl list->claim*)
         (deserialize-hashmap sa list->agreement*)
         sab sprop spl
         (deserialize-hashmap sscen list->scenario*)
         (deserialize-hashmap ssd list->scenario-definition*)
         smeta stag sibs scbs ibp cbpl cbpr)))))


;; =========================================================================
;; ^plan-store — persistent Goblins actor
;; =========================================================================

(define-actor (^plan-store bcom st)
  ;; st: <plan-store-state>

  #:portrait
  (lambda () (list (serialize-plan-store-state st)))

  #:version 1

  #:restore
  (lambda (version data)
    (case version
      ((1) (spawn ^plan-store (deserialize-plan-store-state data)))
      (else (error "Unknown ^plan-store version" version))))

  (methods

    ;; --- Plans ---

    ((add-plan plan)
     (let* ((id (or (plan-id plan) (generate-id "plan-")))
            (new-plans (hashmap-set (pss-plans st) id plan)))
       (bcom (^plan-store bcom
               (make-plan-store-state
                 new-plans (pss-commitments st) (pss-intents st) (pss-claims st)
                 (pss-agreements st) (pss-agreement-bundles st)
                 (pss-proposals st) (pss-proposal-lists st)
                 (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
                 (pss-tag-index st) (pss-intents-by-spec st)
                 (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))
             id)))

    ((get-plan id) (hashmap-ref (pss-plans st) id #f))
    ((all-plans)   (hashmap-values (pss-plans st)))

    ;; --- Intents ---

    ((add-intent intent)
     ;; VF rule: provider OR receiver, not both
     (when (and (intent-provider intent) (intent-receiver intent))
       (error "VF constraint: Intent cannot have both provider and receiver"))
     (let* ((id (or (intent-id intent) (generate-id "intent-")))
            (new-intents (hashmap-set (pss-intents st) id intent))
            (new-tag-idx (index-intent-tags (pss-tag-index st) intent))
            (new-ibs (index-intent-spec (pss-intents-by-spec st) intent))
            ;; Maintain intents-by-plan index
            (new-ibp (let ((pw (intent-planned-within intent)))
                       (if pw (append-to-index (pss-intents-by-plan st) pw id)
                           (pss-intents-by-plan st)))))
       (bcom (^plan-store bcom
               (make-plan-store-state
                 (pss-plans st) (pss-commitments st) new-intents (pss-claims st)
                 (pss-agreements st) (pss-agreement-bundles st)
                 (pss-proposals st) (pss-proposal-lists st)
                 (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
                 new-tag-idx new-ibs (pss-commitments-by-spec st)
                 new-ibp (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))
             id)))

    ((get-intent id)  (hashmap-ref (pss-intents st) id #f))
    ((all-intents)    (hashmap-values (pss-intents st)))

    ((open-intents)
     (hashmap-filter (lambda (i) (not (intent-finished i))) (pss-intents st)))

    ((intents-for-plan plan-id)
     ;; O(log n) via index
     (filter-map (lambda (iid) (hashmap-ref (pss-intents st) iid #f))
                 (hashmap-ref (pss-intents-by-plan st) plan-id '())))

    ((intents-for-tag tag)
     (let ((ids (hashmap-ref (pss-tag-index st) tag '())))
       (filter-map (lambda (id) (hashmap-ref (pss-intents st) id #f)) ids)))

    ((intents-for-spec spec-id)
     (let ((ids (hashmap-ref (pss-intents-by-spec st) spec-id '())))
       (filter-map (lambda (id) (hashmap-ref (pss-intents st) id #f)) ids)))

    ((offers)
     (hashmap-filter
       (lambda (i) (and (intent-provider i) (not (intent-receiver i))
                        (not (intent-finished i))))
       (pss-intents st)))

    ((requests)
     (hashmap-filter
       (lambda (i) (and (intent-receiver i) (not (intent-provider i))
                        (not (intent-finished i))))
       (pss-intents st)))

    ;; --- Commitments ---

    ((add-commitment commitment)
     (let* ((id (or (commitment-id commitment) (generate-id "commit-")))
            (new-commitments (hashmap-set (pss-commitments st) id commitment))
            (new-cbs (index-commitment-spec (pss-commitments-by-spec st) commitment))
            ;; Maintain commitments-by-plan index
            (new-cbpl (let ((pw (commitment-planned-within commitment)))
                        (if pw (append-to-index (pss-commitments-by-plan st) pw id)
                            (pss-commitments-by-plan st))))
            ;; Maintain commitments-by-process index
            (new-cbpr (let* ((st0 (pss-commitments-by-process st))
                             (st1 (if (commitment-input-of commitment)
                                      (append-to-index st0 (commitment-input-of commitment) id)
                                      st0))
                             (st2 (if (commitment-output-of commitment)
                                      (append-to-index st1 (commitment-output-of commitment) id)
                                      st1)))
                        st2)))
       (bcom (^plan-store bcom
               (make-plan-store-state
                 (pss-plans st) new-commitments (pss-intents st) (pss-claims st)
                 (pss-agreements st) (pss-agreement-bundles st)
                 (pss-proposals st) (pss-proposal-lists st)
                 (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
                 (pss-tag-index st) (pss-intents-by-spec st) new-cbs
                 (pss-intents-by-plan st) new-cbpl new-cbpr))
             id)))

    ((get-commitment id) (hashmap-ref (pss-commitments st) id #f))
    ((all-commitments)   (hashmap-values (pss-commitments st)))

    ((commitments-for-process process-id)
     ;; O(log n) via index
     (filter-map (lambda (cid) (hashmap-ref (pss-commitments st) cid #f))
                 (hashmap-ref (pss-commitments-by-process st) process-id '())))

    ((commitments-for-plan plan-id)
     ;; O(log n) via index
     (filter-map (lambda (cid) (hashmap-ref (pss-commitments st) cid #f))
                 (hashmap-ref (pss-commitments-by-plan st) plan-id '())))

    ((commitments-for-spec spec-id)
     (let ((ids (hashmap-ref (pss-commitments-by-spec st) spec-id '())))
       (filter-map (lambda (id) (hashmap-ref (pss-commitments st) id #f)) ids)))

    ;; --- Promote intent to commitment ---

    ((promote-to-commitment iid counterparty . rest)
     ;; iid: intent ID string
     ;; counterparty: alist with optional 'provider and 'receiver keys
     ;; rest: optional (observer-ref) — for labor ATP gate
     (let* ((observer-ref (if (pair? rest) (car rest) #f))
            (the-intent (hashmap-ref (pss-intents st) iid #f)))
       (unless the-intent (error (format #f "Intent ~a not found" iid)))
       (let* ((prov (or (intent-provider the-intent)
                        (assq-ref counterparty 'provider)))
              (recv (or (intent-receiver the-intent)
                        (assq-ref counterparty 'receiver))))
         (unless (and prov recv)
           (error "Cannot promote: need both provider and receiver"))
         ;; Capacity ATP gate: prevent overcommitment of agent capacity.
         ;; Action type 'work' is the discriminator; unit-of-effort confirms capacity resource.
         (when (and observer-ref
                   (eq? (intent-action the-intent) 'work)
                   (intent-resource-inventoried-as the-intent))
           (let* ((cap-res ($ observer-ref 'get-resource
                              (intent-resource-inventoried-as the-intent))))
             (when (and cap-res
                        (economic-resource-unit-of-effort cap-res))
               (let* ((onhand (measure-qty
                                (economic-resource-onhand-quantity cap-res)))
                      (effort-qty (measure-qty
                                    (or (intent-effort-quantity the-intent)
                                        (intent-resource-quantity the-intent)
                                        (make-measure 0 "hours"))))
                      (already-committed
                        (fold (lambda (c acc)
                                (if (and (eq? (commitment-action c) 'work)
                                         (equal? (commitment-resource-inventoried-as c)
                                                 (intent-resource-inventoried-as the-intent))
                                         (not (commitment-finished c)))
                                    (+ acc (measure-qty
                                             (or (commitment-effort-quantity c)
                                                 (make-measure 0 "hours"))))
                                    acc))
                              0 (hashmap-values (pss-commitments st)))))
                 (when (> (+ already-committed effort-qty) onhand)
                   (error (format #f
                     "Capacity overcommitment: ~a hours would exceed ~a on-hand ~a hours (~a already committed)"
                     effort-qty (intent-resource-inventoried-as the-intent)
                     onhand already-committed)))))))
         ;; Build commitment from intent fields
         (let* ((cid (generate-id "commit-"))
                (commitment (make-commitment
                              cid (intent-action the-intent) #f
                              (intent-input-of the-intent) (intent-output-of the-intent)
                              (intent-resource-inventoried-as the-intent)
                              (intent-resource-conforms-to the-intent)
                              (intent-resource-classified-as the-intent)
                              (intent-resource-quantity the-intent)
                              (intent-effort-quantity the-intent)
                              prov recv
                              (intent-has-beginning the-intent)
                              (intent-has-end the-intent)
                              (intent-has-point-in-time the-intent)
                              (intent-due the-intent)
                              #f  ;; created
                              (intent-at-location the-intent)
                              (intent-in-scope-of the-intent)
                              (intent-stage the-intent) (intent-state the-intent)
                              iid  ;; satisfies
                              #f #f  ;; clauseOf, independentDemandOf
                              (intent-planned-within the-intent)
                              #f  ;; finished
                              (intent-availability-window the-intent)))
                ;; Mark intent finished (if not recurring)
                (finished? (and (not (intent-availability-window the-intent)) #t))
                (updated-intent
                  (if finished?
                      (make-intent
                        (intent-id the-intent) (intent-action the-intent)
                        (intent-name the-intent) (intent-note the-intent)
                        (intent-image the-intent)
                        (intent-input-of the-intent) (intent-output-of the-intent)
                        (intent-resource-inventoried-as the-intent)
                        (intent-resource-conforms-to the-intent)
                        (intent-resource-classified-as the-intent)
                        (intent-resource-quantity the-intent)
                        (intent-effort-quantity the-intent)
                        (intent-available-quantity the-intent)
                        (intent-minimum-quantity the-intent)
                        (intent-provider the-intent) (intent-receiver the-intent)
                        (intent-has-beginning the-intent) (intent-has-end the-intent)
                        (intent-has-point-in-time the-intent) (intent-due the-intent)
                        (intent-at-location the-intent) (intent-stage the-intent)
                        (intent-state the-intent) (intent-planned-within the-intent)
                        (intent-satisfies the-intent) (intent-in-scope-of the-intent)
                        #t  ;; finished = true
                        (intent-availability-window the-intent))
                      the-intent))
                (new-intents (hashmap-set (pss-intents st) iid updated-intent))
                (new-commitments (hashmap-set (pss-commitments st) cid commitment))
                (new-cbs (index-commitment-spec (pss-commitments-by-spec st) commitment)))
           (bcom (^plan-store bcom
                   (make-plan-store-state
                     (pss-plans st) new-commitments new-intents (pss-claims st)
                     (pss-agreements st) (pss-agreement-bundles st)
                     (pss-proposals st) (pss-proposal-lists st)
                     (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
                     (pss-tag-index st) (pss-intents-by-spec st) new-cbs
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))
                 cid)))))

    ;; --- Claims ---

    ((add-claim claim)
     (let* ((id (or (claim-id claim) (generate-id "claim-")))
            (new-claims (hashmap-set (pss-claims st) id claim)))
       (bcom (^plan-store bcom
               (make-plan-store-state
                 (pss-plans st) (pss-commitments st) (pss-intents st) new-claims
                 (pss-agreements st) (pss-agreement-bundles st)
                 (pss-proposals st) (pss-proposal-lists st)
                 (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
                 (pss-tag-index st) (pss-intents-by-spec st)
                 (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))
             id)))

    ((get-claim id) (hashmap-ref (pss-claims st) id #f))
    ((all-claims)   (hashmap-values (pss-claims st)))

    ;; --- Agreements ---

    ((add-agreement agreement)
     (let* ((id (agreement-id agreement))
            (new-agrs (hashmap-set (pss-agreements st) id agreement)))
       (bcom (^plan-store bcom
               (make-plan-store-state
                 (pss-plans st) (pss-commitments st) (pss-intents st) (pss-claims st)
                 new-agrs (pss-agreement-bundles st)
                 (pss-proposals st) (pss-proposal-lists st)
                 (pss-scenarios st) (pss-scenario-definitions st) (pss-meta st)
                 (pss-tag-index st) (pss-intents-by-spec st)
                 (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st)))
             id)))

    ((get-agreement id) (hashmap-ref (pss-agreements st) id #f))

    ;; --- Signal metadata ---

    ((set-meta intent-id meta-alist)
     (let ((new-meta (hashmap-set (pss-meta st) intent-id meta-alist)))
       (bcom (^plan-store bcom
               (make-plan-store-state
                 (pss-plans st) (pss-commitments st) (pss-intents st) (pss-claims st)
                 (pss-agreements st) (pss-agreement-bundles st)
                 (pss-proposals st) (pss-proposal-lists st)
                 (pss-scenarios st) (pss-scenario-definitions st) new-meta
                 (pss-tag-index st) (pss-intents-by-spec st)
                 (pss-commitments-by-spec st)
                 (pss-intents-by-plan st) (pss-commitments-by-plan st)
                 (pss-commitments-by-process st))))))

    ((get-meta intent-id) (hashmap-ref (pss-meta st) intent-id #f))))  ;; close method + methods + define-actor


;; =========================================================================
;; Persistence environment
;; =========================================================================

(define plan-store-env
  (make-persistence-env
    `((((vf planning) ^plan-store) ,^plan-store))))
