# Goblins Migration Architecture

## Premise

The TypeScript planner is 11 stores + pure planning algorithms operating on
VF records. The Goblins migration preserves the domain model (Layer 0:
schemas.scm is done) and re-expresses the stores as actors, the algorithms
as pure functions called within turns, and governance as capability
attenuation.

## Layered Architecture

```
Layer 0: VF Records (schemas.scm)              DONE
Layer 1: Store Actors (state + CRUD + queries)  <-- this document
Layer 2: Planning Algorithms (pure functions)
Layer 3: Governance (validators + capabilities)
Layer 4: Federation (actor topology + OCapN)
```

## Key Goblins Constraints That Shape Design

1. **Transactionality is per-turn, per-vat.** All synchronous `$` calls
   within a single turn either all commit or all roll back. Cross-vat `<-`
   is async and NOT transactional.

2. **State changes via `bcom`.** No mutation — actors "become" their next
   state. This makes every state transition a value, which is perfect for
   VF's event-sourced model.

3. **Capabilities are references.** If you have a reference to an actor,
   you can message it. No reference = no access. Attenuation via facets
   and wards.

4. **Persistence via self-portraits.** Actors serialize their constructor
   args. References to other actors serialize as stable IDs. This means
   store state persists naturally if we use `define-actor`.

## Design Decision: Granularity

### Option A: One actor per store (coarse)
Like the TS classes. One `^plan-store` actor holds all intents, commitments,
plans, etc.

- Pro: Transactional consistency within a store (single turn can update
  intent + commitment + agreement atomically).
- Pro: Simple — direct port of TS API.
- Con: Single bottleneck per store. No capability isolation between records.

### Option B: One actor per entity (fine)
Each Intent, each Resource, each Agent is its own actor.

- Pro: Maximum capability isolation (give someone a ref to one Intent,
  not the whole store).
- Pro: Natural distribution — entities can live in different vats.
- Con: Cross-entity operations (promote intent to commitment) require
  multi-actor coordination. Within same vat: synchronous `$` works.
  Across vats: need saga pattern.
- Con: Portrait explosion — thousands of actors to persist.

### Recommended: Option A with faceted access (hybrid)

Use **one actor per store** for transactional integrity, but expose
**faceted sub-references** for capability control:

```scheme
(define-actor (^plan-store bcom state)
  ;; Full interface (controller only)
  (define controller-methods
    (methods
      ((add-intent intent) ...)
      ((promote-to-commitment intent-id provider receiver) ...)
      ((add-plan plan) ...)
      ...))

  ;; Read-only facet (safe to share widely)
  (define reader-methods
    (methods
      ((get-intent id) ...)
      ((get-commitment id) ...)
      ((intents-for-spec spec-id) ...)
      ...))

  (ward store-warden controller-methods
        #:extends reader-methods))
```

Members get the reader facet. Governance gets the controller reference.
Planning algorithms get a read-only reference.

## Vat Topology

```
Scope Vat (one per organization/commune):
├── ^plan-store        — intents, commitments, plans, agreements, signals
├── ^observer          — events (append-only), resources (derived)
├── ^recipe-store      — recipes, specs (read-heavy, rarely mutated)
├── ^agent-store       — agents, relationships
├── ^buffer-zone-store — DDMRP zones, profiles
├── ^account-store     — commune labor-credit pools
├── ^snapshot-store    — buffer health time-series (append-only)
├── ^alert-store       — execution alerts (append-only)
└── ^scope-root        — coordinator, expressor registry, inbox
```

All actors in the same vat = all participate in the same turn.
A planning pass can synchronously read from all stores and write
results to plan-store, atomically.

```
Federation Vat:
├── ^store-registry    — maps scope-ids to (far) scope-root refs
├── ^planner           — orchestrates multi-scope planning
└── ^federation-root   — governance for the federation itself
```

Federation actors hold **far references** to scope-roots via OCapN.
Cross-scope queries use `<-` (async, promise-based).

## Store Actor Designs

### ^plan-store

The most complex store. Holds all planning-layer VF entities.

```scheme
;; State is a single immutable record holding all maps
(define-record-type <plan-store-state>
  (make-plan-store-state plans intents commitments claims
                         agreements agreement-bundles
                         proposals proposal-lists
                         scenarios scenario-definitions
                         signal-meta
                         ;; indexes (derived, rebuilt on mutation)
                         intent-by-spec commitment-by-spec tag-index)
  plan-store-state?
  (plans             pss-plans)
  (intents           pss-intents)
  (commitments       pss-commitments)
  ;; ... etc
  )

(define-actor (^plan-store bcom state)
  ;; Immutable functional updates — each mutation returns new state via bcom
  (define (add-intent* state intent)
    (let* ((id (or (intent-id intent) (generate-id)))
           (new-intents (ghash-set (pss-intents state) id intent))
           ;; update indexes
           (new-by-spec (index-by-spec new-intents))
           (new-tag-idx (index-by-tag new-intents)))
      (make-plan-store-state
        (pss-plans state) new-intents (pss-commitments state)
        ;; ... rebuild with updated indexes
        )))

  (define controller-methods
    (methods
      ((add-intent intent)
       (let ((new-state (add-intent* state intent)))
         (bcom (^plan-store bcom new-state)
               (intent-id intent))))  ;; return ID

      ((promote-to-commitment intent-id provider receiver)
       ;; Atomic: update intent (finished=true, decrement available-qty)
       ;; + create commitment + update agreement
       ;; All within one bcom = one turn = transactional
       (let* ((intent (ghash-ref (pss-intents state) intent-id))
              (commitment (intent->commitment intent provider receiver))
              (new-state (pipe state
                           (finish-intent* intent-id)
                           (add-commitment* commitment))))
         (bcom (^plan-store bcom new-state)
               (commitment-id commitment))))

      ((emit-signal kind payload)
       (let* ((intent (signal->intent kind payload))
              (meta (make-signal-meta kind (intent-id intent)))
              (new-state (pipe state
                           (add-intent* intent)
                           (add-meta* meta))))
         (bcom (^plan-store bcom new-state)
               (intent-id intent))))))

  (define reader-methods
    (methods
      ((get-intent id)
       (ghash-ref (pss-intents state) id))
      ((get-commitment id)
       (ghash-ref (pss-commitments state) id))
      ((all-intents)
       (ghash-values (pss-intents state)))
      ((intents-for-spec spec-id)
       (ghash-ref (pss-intent-by-spec state) spec-id '()))
      ((commitments-for-process proc-id)
       (filter (lambda (c) (or (equal? (commitment-input-of c) proc-id)
                               (equal? (commitment-output-of c) proc-id)))
               (ghash-values (pss-commitments state))))
      ((open-intents)
       (filter (lambda (i) (not (intent-finished i)))
               (ghash-values (pss-intents state))))))

  (ward plan-store-warden controller-methods
        #:extends reader-methods))
```

### ^observer

Event-sourced. The event log is append-only; resources are derived.

```scheme
(define-actor (^observer bcom events resources indexes)
  ;; events: list (append-only log)
  ;; resources: ghash of id -> <economic-resource>
  ;; indexes: ghash of various lookup structures

  (define controller-methods
    (methods
      ((record event)
       ;; 1. Append event to log
       ;; 2. Apply effects to resources (pure function)
       ;; 3. Update fulfillment/satisfaction tracking
       ;; 4. bcom with new state
       (let* ((new-events (cons event events))
              (affected (apply-event-effects resources event))
              (new-resources (merge-resources resources affected))
              (new-indexes (update-indexes indexes event)))
         (bcom (^observer bcom new-events new-resources new-indexes)
               affected)))

      ((seed-resource resource)
       (let ((new-resources (ghash-set resources
                              (economic-resource-id resource) resource)))
         (bcom (^observer bcom events new-resources indexes))))))

  (define reader-methods
    (methods
      ((get-resource id)
       (ghash-ref resources id))
      ((all-resources)
       (ghash-values resources))
      ((events-for-resource resource-id)
       (ghash-ref (idx-by-resource indexes) resource-id '()))
      ((onhand spec-id #:optional at-location)
       ;; Sum onhand quantities for a spec at a location
       (compute-onhand resources spec-id at-location))))

  (ward observer-warden controller-methods
        #:extends reader-methods))
```

### ^buffer-zone-store (simple example)

```scheme
(define-actor (^buffer-zone-store bcom zones)
  ;; zones: ghash of id -> <buffer-zone>
  (methods
    ((add-zone zone)
     (bcom (^buffer-zone-store bcom
             (ghash-set zones (buffer-zone-id zone) zone))
           (buffer-zone-id zone)))

    ((get-zone id)
     (ghash-ref zones id))

    ((zones-for-spec spec-id)
     (filter (lambda (z) (equal? (buffer-zone-spec-id z) spec-id))
             (ghash-values zones)))

    ((find-zone spec-id #:optional at-location)
     ;; Location-aware lookup with fallback to global
     (or (find (lambda (z) (and (equal? (buffer-zone-spec-id z) spec-id)
                                (equal? (buffer-zone-at-location z) at-location)))
              (ghash-values zones))
         (find (lambda (z) (and (equal? (buffer-zone-spec-id z) spec-id)
                                (not (buffer-zone-at-location z))))
              (ghash-values zones))))

    ((update-zone id partial)
     (let* ((old (ghash-ref zones id))
            (new (merge-buffer-zone old partial)))
       (bcom (^buffer-zone-store bcom
               (ghash-set zones id new)))))))
```

### ^scope-root (coordinator + expressor registry)

This is where crypto.md's patterns land:

```scheme
(define-actor (^scope-root bcom name stores expressors validator)
  ;; stores: record of store actor references (all near, same vat)
  ;; expressors: ghash of expressor-id -> expressor-identity
  ;; validator: procedure that gates mutations

  (define-values (inbox-warden inbox-incanter)
    (spawn-sealer-triplet))

  (define controller-methods
    (methods
      ;; Governance: create new expressor (member)
      ((create-expressor member-name)
       (define-values (sealer unsealer sealed?)
         (spawn-sealer-triplet))
       (let* ((identity (spawn ^expressor-identity member-name unsealer sealed?))
              (controller (spawn ^expressor-controller
                            (self) (generate-id) sealer))
              (new-expressors (ghash-set expressors
                                (expressor-id controller) identity)))
         (bcom (^scope-root bcom name stores new-expressors validator)
               (values identity controller))))

      ;; Execute validated action
      ((evaluate action expressor-id seal)
       ;; 1. Verify seal against expressor's unsealer
       ;; 2. Check validator allows this action for this expressor
       ;; 3. Execute against stores (synchronous — same vat)
       ;; 4. Return result
       (let* ((identity (ghash-ref expressors expressor-id))
              (unsealer ($ identity 'unsealer))
              (content ($ unsealer seal)))
         (unless ($ validator action expressor-id)
           (error "Validator rejected action"))
         (execute-action stores action)))))

  (define public-methods
    (methods
      ;; Cross-org: submit proposal via inbox
      ((submit-proposal expr sender-identity)
       ...)
      ;; Read access to stores (returns read-only facets)
      ((plan-store-reader)
       (facet (stores-plan-store stores)
              'get-intent 'get-commitment 'all-intents
              'intents-for-spec 'open-intents))
      ((observer-reader)
       (facet (stores-observer stores)
              'get-resource 'all-resources 'onhand))))

  (ward inbox-warden controller-methods
        #:extends public-methods))
```

## Layer 2: Planning Algorithms

Planning passes are **pure functions** that read from stores and produce
records. They run within a turn on the scope vat:

```scheme
(define (plan-for-scope scope-root demand-intents)
  ;; All store reads are synchronous ($ — same vat)
  (let* ((plan-store ($ scope-root 'plan-store-reader))
         (observer   ($ scope-root 'observer-reader))
         (recipes    ($ scope-root 'recipe-store-reader))
         (zones      ($ scope-root 'zone-store-reader))
         ;; Phase 0: buffer health pre-evaluation
         (buffer-health (evaluate-buffer-health zones observer))
         ;; Phase 1: demand netting
         (supply-slots (extract-supply observer recipes))
         (deficits (net-demands demand-intents supply-slots))
         ;; Phase 2: dependent demand explosion
         (derived (explode-demands deficits recipes))
         ;; ... etc
         )
    ;; Return plan as records (not mutations)
    (make-plan-result deficits derived buffer-health)))

;; The scope-root's evaluate method calls this, then writes results:
(define (execute-planning-action stores action)
  (match action
    (('run-plan demand-intents)
     (let ((result (plan-for-scope stores demand-intents)))
       ;; Write intents/commitments to plan-store (synchronous, same turn)
       (for-each (lambda (i) ($ (stores-plan-store stores) 'add-intent i))
                 (plan-result-intents result))
       result))))
```

## Layer 4: Federation

Cross-scope operations use `<-` (async) and promise pipelining:

```scheme
(define-actor (^store-registry bcom scope-refs)
  ;; scope-refs: ghash of scope-id -> far reference to ^scope-root
  (methods
    ((register scope-id scope-ref)
     (bcom (^store-registry bcom
             (ghash-set scope-refs scope-id scope-ref))))

    ((resolve scope-id record-type record-id)
     ;; Returns a promise (far reference)
     (let ((scope (ghash-ref scope-refs scope-id)))
       (if scope
           (<- scope 'resolve record-type record-id)
           (error "Unknown scope" scope-id))))

    ((all-scopes)
     (ghash-keys scope-refs))))

;; Federation planning: collect intents across scopes
(define (federated-planning-pass registry scope-ids)
  (let ((intent-promises
         (map (lambda (sid)
                (<- (<- registry 'get-scope sid)
                    'plan-store-reader))
              scope-ids)))
    ;; Wait for all scope readers, then merge and plan
    (on (all-of* intent-promises)
        (lambda (readers)
          (let ((all-intents (append-map
                               (lambda (r) (<- r 'open-intents))
                               readers)))
            ;; ... merge planning across scopes
            )))))
```

## Migration Order

1. **^buffer-zone-store** — simplest, validates the actor pattern
2. **^recipe-store** — read-heavy, tests query patterns
3. **^agent-store** — tests cascade deletes
4. **^observer** — tests event-sourcing in actors
5. **^plan-store** — the big one, tests transactional multi-entity updates
6. **^scope-root** — tests capability/governance integration
7. **^store-registry** — tests federation/OCapN

## Open Questions

1. **ghash vs. custom persistent maps**: Goblins' `ghash` is functional and
   persistent-friendly. Is it performant enough for stores with thousands
   of entries? Benchmark needed.

2. **Index maintenance cost**: Rebuilding indexes on every `bcom` is O(n).
   For large stores, we may need incremental index actors.

3. **Snapshot isolation for reads**: During a planning pass, reads should
   see a consistent snapshot. Within a single turn this is guaranteed
   (no concurrent writes). But what about cross-vat reads?

4. **Event notification**: TS stores use subscribe/notify. In Goblins,
   this becomes `<-np` (fire-and-forget messages to listener actors).
   Need to design the subscription protocol.

5. **Time**: Buffer recalibration and ADU computation depend on wall-clock
   time. Goblins has no built-in clock. Use a `^clock` actor or inject
   timestamps at the governance layer?
