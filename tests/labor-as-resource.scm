;;; labor-as-resource.scm — Tests for capability/capacity separation
;;;
;;; Core design:
;;;   - Capacity: ONE resource per agent, identified by unit-of-effort
;;;   - Capability: skills are separate resources (skillsOf/agentsWithSkill)
;;;   - Action type 'work' is the discriminator — no tags needed

(use-modules (goblins)
             (goblins persistence-store memory)
             (goblins utils hashmap)
             (srfi srfi-1))

(define pass-count 0)
(define (check label pred)
  (if pred
      (begin (set! pass-count (+ pass-count 1))
             (format #t "  ok: ~a\n" label))
      (error (string-append "FAIL: " label))))


;; =========================================================================
;; 1. Create scope vat
;; =========================================================================

(display "=== Capacity/Capability Separation Tests ===\n\n")

(define store (make-memory-store))
(define-values (vat scope)
  (spawn-persistent-vat
    scope-env
    (lambda () (spawn-scope "Test Commune"))
    store))


;; =========================================================================
;; 2. Seed capacity resource
;; =========================================================================

(display "--- seed-capacity-resource ---\n")

(with-vat vat
  (let ((obs ($ scope 'observer)))

    ;; Seed a capacity resource for alice (40 hours)
    (let ((res ($ obs 'seed-capacity-resource "alice" 40)))
      (check "capacity resource id"
             (equal? "capacity:alice" (economic-resource-id res)))
      (check "conforms-to is agent-capacity"
             (equal? "spec:agent-capacity"
                     (economic-resource-conforms-to res)))
      (check "primaryAccountable is alice"
             (equal? "alice"
                     (economic-resource-primary-accountable res)))
      (check "unit-of-effort is hours"
             (equal? "hours"
                     (economic-resource-unit-of-effort res)))
      (check "accountingQuantity is 40"
             (= 40 (measure-has-numerical-value
                      (economic-resource-accounting-quantity res))))
      (check "onhandQuantity is 40"
             (= 40 (measure-has-numerical-value
                      (economic-resource-onhand-quantity res))))
      (check "no classifiedAs tags"
             (not (economic-resource-classified-as res))))

    ;; Seed another for bob
    ($ obs 'seed-capacity-resource "bob" 30)))


;; =========================================================================
;; 3. capacity-resource-for-agent query
;; =========================================================================

(display "\n--- capacity-resource-for-agent ---\n")

(with-vat vat
  (let ((obs ($ scope 'observer)))

    ;; Seed a skill resource for alice (not capacity)
    ($ obs 'seed-resource
       (make-economic-resource
         "skill:alice:welding" "Welding Cert" #f #f #f
         "spec:welding-certified" #f
         (make-measure 1 "certification") (make-measure 1 "certification")
         #f #f "alice" #f #f #f #f #f #f #f #f))

    (let ((cap ($ obs 'capacity-resource-for-agent "alice")))
      (check "alice has capacity resource" (and cap #t))
      (check "capacity id is correct"
             (equal? "capacity:alice" (economic-resource-id cap)))
      (check "has unit-of-effort"
             (equal? "hours" (economic-resource-unit-of-effort cap))))

    ;; Unknown agent returns #f
    (check "unknown agent returns #f"
           (not ($ obs 'capacity-resource-for-agent "unknown")))))


;; =========================================================================
;; 4. ATP gate — overcommitment prevention
;; =========================================================================

(display "\n--- ATP gate ---\n")

(with-vat vat
  (let ((obs ($ scope 'observer))
        (ps  ($ scope 'plan-store)))

    (let ((plan-id ($ ps 'add-plan (make-plan "plan-1" "Capacity test" #f #f #f #f #f #f))))

      ;; First intent: 30 hours of work
      ($ ps 'add-intent
         (make-intent
           "intent-w1" 'work "Work offer 1" #f #f
           #f #f
           "capacity:alice" #f #f
           #f (make-measure 30 "hours") #f #f
           "alice" #f
           #f #f #f #f #f #f #f
           plan-id #f #f #f #f))

      ;; Promote first intent — 30 <= 40, should succeed
      (let ((cid1 ($ ps 'promote-to-commitment "intent-w1"
                     `((provider . "alice") (receiver . "scope-A"))
                     obs)))
        (check "first commitment created" (string? cid1))

        ;; Second intent: 15 more hours → 30 + 15 = 45 > 40
        ($ ps 'add-intent
           (make-intent
             "intent-w2" 'work "Work offer 2" #f #f
             #f #f
             "capacity:alice" #f #f
             #f (make-measure 15 "hours") #f #f
             "alice" #f
             #f #f #f #f #f #f #f
             plan-id #f #f #f #f))

        ;; Should throw — overcommitment
        (let ((threw? (catch #t
                        (lambda ()
                          ($ ps 'promote-to-commitment "intent-w2"
                             `((provider . "alice") (receiver . "scope-B"))
                             obs)
                          #f)
                        (lambda (key . args) #t))))
          (check "ATP gate rejects overcommitment" threw?))

        ;; Third intent: exactly 10 hours → 30 + 10 = 40 = capacity
        ($ ps 'add-intent
           (make-intent
             "intent-w3" 'work "Work offer 3" #f #f
             #f #f
             "capacity:alice" #f #f
             #f (make-measure 10 "hours") #f #f
             "alice" #f
             #f #f #f #f #f #f #f
             plan-id #f #f #f #f))

        (let ((cid3 ($ ps 'promote-to-commitment "intent-w3"
                       `((provider . "alice") (receiver . "scope-C"))
                       obs)))
          (check "commitment at exact capacity succeeds" (string? cid3)))))))


;; =========================================================================
;; 5. Backward compatibility — no observer, no gate
;; =========================================================================

(display "\n--- backward compatibility ---\n")

(with-vat vat
  (let ((ps ($ scope 'plan-store)))

    ($ ps 'add-intent
       (make-intent
         "intent-w4" 'work "No observer check" #f #f
         #f #f
         "capacity:alice" #f #f
         #f (make-measure 999 "hours") #f #f
         "alice" #f
         #f #f #f #f #f #f #f
         "plan-1" #f #f #f #f))

    (let ((cid ($ ps 'promote-to-commitment "intent-w4"
                   `((provider . "alice") (receiver . "scope-X")))))
      (check "backward-compatible: no observer, no ATP gate" (string? cid)))))


;; =========================================================================
;; Summary
;; =========================================================================

(format #t "\n=== ~a checks passed ===\n" pass-count)
