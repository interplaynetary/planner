# Svelte Component Specification — DDMRP / DDOM UI

Maps every DDMRP/DDOM concern to a Svelte component. Each component entry lists its data contract (stores/props), events it emits, and the VF fields / library functions it reads.

---

## Design System

### `components/ui/BufferZoneBar.svelte`

Reusable horizontal zone indicator (Early | Green | Yellow | Red | Late) used by stock, time, and capacity buffers alike.

**Props:**

```ts
export let value: number; // current position (quantity or time)
export let tor: number; // top of red
export let toy: number; // top of yellow
export let tog: number; // top of green
export let unit: string = "";
export let showLabels: boolean = true;
export let orientation: "horizontal" | "vertical" = "horizontal";
```

**Emits:** nothing (display only)

---

### `components/ui/ZoneBadge.svelte`

Colored pill showing zone status: `red | yellow | green | excess | stockout`.

**Props:** `zone: string`, `label?: string`

---

### `components/ui/PriorityCell.svelte`

Shows NFP% with zone-appropriate background color and numeric label.

**Props:** `pct: number`, `zone: string`

---

### `components/ui/QuantityBar.svelte`

Horizontal progress bar. Used for fulfillment state (committed vs. fulfilled) and demand satisfaction.

**Props:** `value: number`, `max: number`, `label?: string`

---

## 1. DDS&OP — Master Settings Layer

### `routes/settings/BufferProfileEditor.svelte`

Full CRUD for `BufferProfile` records (item type × LTF × VF).

**Data:**

- `bufferZoneStore.allBufferZones()` grouped by `profileId`
- `POST /api/buffer-profiles`

**Fields edited:**

- `leadTimeFactor` (LTF)
- `variabilityFactor` (VF)
- `orderCycleDays`
- `ostMultiplier`
- `recalculationCadence: 'daily' | 'weekly' | 'monthly'`

---

### `routes/settings/PartProfileAssignment.svelte`

Assigns each `ResourceSpecification` to a `BufferProfile`.

**Data:** `RecipeStore.allResourceSpecs()` × `BufferProfile[]`

**Output:** updates `ResourceSpecification.resourceClassifiedAs[]` with profile tag

---

### `routes/settings/DemandAdjustmentFactorEditor.svelte`

Manages `DemandAdjustmentFactor` records (DAF, Zone AF, Lead Time AF).

**Fields:** `type: 'demand' | 'zone' | 'leadTime'`, `factor`, `validFrom`, `validTo`, `specId`, `atLocation?`

---

### `routes/settings/ADUSettings.svelte`

Configure ADU blend ratio (`aduBlendRatio`) and rolling window length per spec / buffer zone.

---

## 2. DDMRP — C1: Strategic Inventory Positioning

### `routes/positioning/DecouplingPointMap.svelte`

Network graph showing all `RecipeProcess` steps with decoupling points (`EconomicResource.stage`) overlaid. Highlights DLT legs between decoupling points.

**Data:**

- `RecipeStore.getProcessChain(recipeId)` for all recipes
- `Observer.conformingResources()` filtered to `stage !== undefined`

**Interactions:** click a node to open `DecouplingPointDetail`

---

### `components/positioning/DecouplingPointDetail.svelte`

Side panel for a single decoupling point. Shows:

- `BufferZone` parameters (ADU, DLT, TOR/TOY/TOG)
- Current on-hand vs. zone thresholds
- Decoupling Point Placement Considerations table (from `decoupling-considerations.jpg`)
- Six tests checklist (from `decoupling-tests.jpg`)

---

### `components/positioning/BomTreeViewer.svelte`

Visual BOM tree from `RecipeStore` with decoupling point and stage annotations. Collapsible nodes, with `RecipeFlow.stage` shown as boundary markers.

---

## 3. DDMRP — C2: Buffer Profiles & Levels

### `routes/buffers/BufferZoneDashboard.svelte`

Grid of `BufferZone` cards, one per spec × location. Each card shows:

- Part# + location
- ADU, DLT, TOR/TOY/TOG
- Current on-hand buffer status (via `bufferStatus()`)
- Last computed date + recalibration due indicator

**Actions:** "Recalibrate" → calls `recalibrateBufferZone()` + `BufferZoneStore.replaceZone()`

---

### `components/buffers/BufferZoneCard.svelte`

Single spec buffer summary card:

- `BufferZoneBar` (stock view, vertical funnel shape)
- NFP result from `computeNFP()`
- Priority% badge

---

### `components/buffers/BufferZoneEditor.svelte`

Form to manually set or override zone parameters (ADU, DLT, MOQ, TOR/TOY/TOG). Calls `computeBufferZone()` for live preview as values change.

---

### `components/buffers/ZoneFormulaBreakdown.svelte`

Read-only display of the buffer zone formula decomposition:

```
redBase  = ADU × DLT × LTF
redSafety = redBase × VF
TOR      = (redBase + redSafety) × ZAF
TOY      = TOR + ADU × DLT
Green    = max(orderCycle × ADU, redBase, MOQ)
TOG      = TOY + Green
```

Populated from `BufferZoneComputation` returned by `computeBufferZone()`.

---

## 4. DDMRP — C3: Dynamic Adjustments

### `routes/adjustments/AdjustmentFactorDashboard.svelte`

Table of all `DemandAdjustmentFactor` records, filterable by spec, type, and active date. Shows type (`demand` / `zone` / `leadTime`), factor value, validity window.

---

### `components/adjustments/AdjustmentFactorBadge.svelte`

Inline chip showing which adjustments are active on a buffer zone today (`BufferZone.activeAdjustmentIds`).

---

### `routes/adjustments/RecalibrationQueue.svelte`

List of buffer zones returned by `BufferZoneStore.zonesDueForRecalibration(today)`. Batch "Recalibrate All" button.

---

## 5. DDMRP — C4: Net Flow Position & Supply Order Generation

### `routes/planning/PlanningScreen.svelte`

The main DDMRP planning queue (equivalent to the planning screen columns in `DDOM-Dashboard.jpg` → Reliability column). Central compositing component.

**Columns:**
| Column | Source |
|---|---|
| Part# | `ResourceSpecification.name` |
| Open Supply | sum of `Commitment.outputOf` qty |
| On-Hand | `Observer.conformingResources()` → `onhandQuantity` |
| Demand | `qualifyDemand()` result |
| Net Flow | `computeNFP().nfp` |
| Priority % | `NFPResult.priority × 100` |
| Recommended Qty | `TOG − NFP` (when NFP ≤ TOY) |
| Action | `generateReplenishmentSignal()` → label |

**Sub-components used:** `PriorityCell`, `ZoneBadge`, `BufferZoneBar`

**Sorted by:** `sortBySchedulingPriority()` — lowest priority% first (most urgent)

---

### `components/planning/NFPCard.svelte`

Detailed NFP breakdown for a single spec:

- On-Hand, On-Order, Qualified Demand fields
- Signed NFP value (can be negative)
- Zone indicator
- `BufferZoneBar` showing NFP position relative to TOR/TOY/TOG

**Data:** `NFPResult` from `computeNFP()`

---

### `components/planning/ADUPanel.svelte`

Shows past ADU (`computeADU()`), forward ADU (`computeForwardADU()`), and blended ADU (`blendADU()`) for a spec. Configurable window length. Mini bar chart of daily consumption events.

---

### `components/planning/QualifiedDemandBreakdown.svelte`

Itemised table of flows counted in `qualifyDemand()`:

- Lists each qualifying `Commitment` / `Intent` (`inputOf` set, due within OST horizon)
- Shows OST horizon date, spike threshold, and which items were filtered
- Colour-coded by amount vs. spike threshold

---

### `components/planning/ReplenishmentSignalPanel.svelte`

Shows all open `ReplenishmentSignal` records for a spec. Actions: Approve (→ `PlanStore.promoteToCommitment()`) or Reject. Shows recommended qty, due date, priority%, buffer zone id.

---

### `routes/planning/PrioritizedShareView.svelte`

Multi-location scarce supply allocation view. Uses `prioritizedShare()` result. Shows allocation per location: fill-to-TOR → fill-to-TOY → proportional green.

---

## 6. DDMRP — C4: BOM Explosion / Dependent Demand

### `routes/planning/DependentDemandExplorer.svelte`

Interactive BOM explosion viewer. User enters a spec + quantity + due date; the component calls `dependentDemand()` and visualises the resulting Process tree and Commitment/Intent flows.

---

### `components/planning/ExplosionTree.svelte`

Recursive tree of the `DependentDemandResult`:

- Each node = one `Process` with its input/output flows
- Shows quantity, back-scheduled dates, SNLT/SNE score used for recipe selection
- Leaf nodes show `purchaseIntents` (external sourcing signals)

---

### `components/planning/PurchaseIntentList.svelte`

Table of `purchaseIntents[]` from `DependentDemandResult`. Shows spec, quantity, needed-by date. Links to `ProposalList` for supplier matching.

---

## 7. DDMRP — C4: planForRegion

### `routes/planning/RegionPlannerView.svelte`

H3 cell-based planning map. Runs `planForRegion()` per selected cell cluster.

**Sub-components:**

- `DemandSlotClassBadge` — shows `locally-satisfiable | transport-candidate | producible-with-imports | external-dependency`
- `DeficitSignalList` — list of `DeficitSignal` records from the run
- `MetabolicDebtList` — orphan demands with no recipe
- `ConflictReport` — inventory overclaim + capacity contention results

---

### `components/planning/DemandSlotCard.svelte`

Single demand slot from `IndependentDemandIndex`: spec, remaining qty, due date, H3 cell, classification badge.

---

## 8. DDMRP — C5: Execution / Buffer Management

### `routes/execution/BufferStatusDashboard.svelte`

Grid of all monitored specs showing physical buffer status (uses `onhandQuantity`, not `accountingQuantity`). Visual funnels (like `stock-buffers.jpg`).

**Data:** `bufferStatus(onhand, bufferZone)` → `BufferStatusResult`

**Alerts overlaid:**

- `onhandAlert()` — current on-hand alert
- `projectOnHand()` — projected stockout indicator

---

### `components/execution/BufferFunnel.svelte`

Vertical funnel diagram (matching DDI visual style) showing current on-hand position within Green/Yellow/Red zones. Fills from bottom. Includes TOG label at top and current quantity overlay.

**Props:** `bufferZone: BufferZone`, `onhand: number`

---

### `components/execution/OnHandAlert.svelte`

Alert banner when `onhand / tor < alertThreshold`. Shows zone color, current %, and recommended action.

---

### `routes/execution/ProjectedOnHandView.svelte`

Day-by-day table + area chart over DLT horizon. Uses `projectOnHand()` result (`DailyProjectionEntry[]`).

**Columns:** Date | Receipts | Demand | Projected On-Hand | Zone
**Chart:** stacked area — on-hand running balance coloured by zone; red line at TOR; negative values shown as dark-red stockout zone.

---

### `routes/execution/OrderActivityDashboard.svelte`

Unified PO/MO/TO execution view (equivalent to "Order Activity Summary" from `ddmrp-operational-map.md` §4.3).

**Columns:** Order# | Part# | Order Type | Status | Release Date | Due Date | Qty | Buffer Status %

**Data:**

- `PlanStore.allCommitments()` filtered by `action: 'produce' | 'transferAllRights' | 'transfer' | 'transferCustody'`
- `Observer.FulfillmentState` per commitment
- `bufferStatus()` per spec

---

### `routes/execution/WIPPriorityDashboard.svelte`

Released MO dispatch list ordered by live `onhandQuantity / TOG %`. Refreshes on `process_completed` Observer events.

**Columns:** MO# | Item# | Buffer Status % (color strip) | DLT remaining

---

## 9. DDMRP — C5: Signal Integrity

### `routes/execution/SignalIntegrityReport.svelte`

Tracks recommendation vs. actual supply orders. Uses `signalIntegrityReport()` result (`SignalIntegrityEntry[]`).

**Columns:** Signal# | Spec | Recommended Qty | Approved Qty | Qty Deviation | Recommended Due | Actual Due | Late? | Fulfillment %

**Colour:** green = compliant; yellow = qty deviation; red = late or over-fulfilled.

---

### `components/execution/SignalIntegrityRow.svelte`

Single row in the signal integrity report. Shows `FulfillmentState.totalFulfilled / totalCommitted` as a `QuantityBar`.

---

## 10. Demand Driven Scheduling

### `routes/scheduling/SchedulingQueue.svelte`

Priority-sorted MO list (from `sortBySchedulingPriority()`). Lowest NFP% first. Also applies sequence group sort (allergen/regulatory via `RecipeProcess.processClassifiedAs`).

**Columns:** Sequence Group | MO# | Part# | Priority % | NFP | Due Date | Agent | Route Step

---

### `routes/scheduling/ScheduleBook.svelte`

Gantt-style calendar view of `ScheduleBook.blocksFor()` for an agent or resource. Shows `ScheduleBlock[]` as horizontal bars coloured by Commitment (confirmed, dark) vs. Intent (tentative, light).

**Interactions:**

- Drag to reschedule (emits `reschedule` event → calls `PlanStore`)
- Click to open `CommitmentDetail`

---

### `components/scheduling/ScheduleBlock.svelte`

Single time block on the Gantt. Shows action, agent, quantity/hours, zone badge if linked to a buffer.

---

### `routes/scheduling/DrumScheduler.svelte`

Drum (most-loaded resource) finite scheduling view. Bar chart showing daily load vs. capacity ceiling (matching `drum-scheduling.jpg`). Both MTS and MTO orders shown.

**Data:** `ScheduleBook.committedEffortOn(agentId, dt)` per day

---

### `routes/scheduling/ControlPointSchedule.svelte`

Control point schedule maintenance screen (Reliability column of DDOM dashboard). One row per control point process, showing:

- Scheduled start
- Work orders feeding into it (time buffer status)
- `hasUseConflict` alerts

---

### `components/scheduling/TimeBufferBoard.svelte`

The "Yet to be Received" / "Received" horizontal dual-bar display from `yet-to-be-recieved.jpg` and `time-buffers-2.jpg`.

Two rows per work order:

- **Yet to be Received** — based on `Commitment.due` vs. today
- **Received** — based on `EconomicEvent.fulfills` timestamp

Zone colours: Early / Green (`OK`) / Yellow (`Investigate`) / Red (`ACT`) / Late.

**Props:** `commitments: Commitment[]`, `bufferZone: BufferZone`

---

### `routes/execution/LTMAlertView.svelte`

Lead Time Managed alert screen. Uses `ltmAlert()` result.

**Columns:** Order# | Part# | Due Date | Days Remaining | LTM Sub-Zone (G/Y/R) | Fulfillment State

Alert horizon = last third of DLT, subdivided into G/Y/R.

---

### `components/scheduling/MaterialSyncAlert.svelte`

Alert list for non-decoupled items where supply shortfall is detected via `PlanNetter.netDemand()`. Shows MO#, Part#, Release Date, Qty, Shortage, Parent Buffer Status.

---

## 11. Track & Trace

### `routes/trace/TraceView.svelte`

Bidirectional provenance explorer. User selects a resource or event.

- **Trace (backwards)** tab: calls `trace()` → renders `FlowTree`
- **Track (forwards)** tab: calls `track()` → renders `FlowTree`

---

### `components/trace/FlowTree.svelte`

Recursive tree of `FlowNode[]`. Node types: `event | process | resource`. Expandable; shows action, quantity, agent, date. Highlights corrected events.

---

### `components/trace/LotBadge.svelte`

Shows `EconomicResource.lot` (`BatchLotRecord`) info: lot code, expiration date.

---

## 12. Cost & Value

### `routes/finance/CostRollupView.svelte`

Shows `rollupStandardCost()` vs `rollupActualCost()` and `costVariance()` for a recipe or resource. Per-stage breakdown table + total in configured unit (credits, hours, USD).

---

### `routes/finance/ValueDistributionView.svelte`

Income distribution result from `distributeIncome()`. Pie/bar chart of shares per contributing agent. Configurable `ValueEquation` selector (effort, equal, hybrid, hybrid+depreciation).

---

### `components/finance/SNEIndex.svelte`

Displays `buildSNEIndex()` result — table of spec → SNE (effort hours per unit). Sortable, filterable. Used for SNLT-based recipe selection transparency.

---

## 13. Observer / Inventory

### `routes/inventory/InventoryView.svelte`

Table of `EconomicResource` records from `Observer.inventory()`. Filterable by spec, location, stage, containment.

**Columns:** Resource ID | Spec | Accounting Qty | On-Hand Qty | Stage | Location | Lot | Contained In

---

### `components/inventory/ResourceCard.svelte`

Single resource detail: both quantity fields, stage, containment status, lot info, `previousEvent` link.

---

### `routes/inventory/FulfillmentStateView.svelte`

Shows `Observer.FulfillmentState` per Commitment: total committed, total fulfilled, fulfilling events list, finished flag, over-fulfilled warning.

---

## 14. Proposals & Marketplace

### `routes/marketplace/ProposalListView.svelte`

All `Proposal` records (`purpose: 'offer' | 'request'`). Filterable by spec, provider, receiver, location.

**Actions:** Accept → `PlanStore.acceptProposal()` → creates Agreement + Commitments

---

### `routes/marketplace/AgreementView.svelte`

Shows `Agreement.stipulates[]` (primary Commitments) and `stipulatesReciprocal[]` (reciprocal Commitments). Links to `ClaimState` for outstanding obligations.

---

## 15. DDOM Dashboard (Composite)

### `routes/dashboard/DDOMDashboard.svelte`

Top-level three-column dashboard matching `DDOM-Dashboard.jpg`:

| Column                                    | Sub-components                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| **Reliability** (Planner/Buyer/Scheduler) | `PlanningScreen`, `SignalIntegrityReport` (mini), `ControlPointSchedule` (mini) |
| **Stability** (Buffer/Resource Manager)   | `TimeBufferBoard`, `BufferStatusDashboard` (mini), capacity buffer bar chart    |
| **Velocity** (Buffer/Resource/Scheduler)  | `FlowExceptionReport`                                                           |

---

### `components/dashboard/FlowExceptionReport.svelte`

Table of flow exceptions (late releases, missed control point starts, critical activity gaps). Columns: Order# | Date | Domain | Duration/Time | Due Date.

---

## 16. Shared / Cross-Cutting

### `components/shared/SpaceTimeMap.svelte`

H3 hex map (using `maplibre-gl` or `leaflet`) showing agent capacity, demand slots, or inventory by cell. Colour-coded by zone status. Click cell → drill-down panel.

**Data:** `AgentIndex`, `IndependentDemandIndex`, `EconomicResourceIndex`

---

### `components/shared/AgentCapacityCard.svelte`

`AgentCapacity` summary: agent name, skills (resource specs), total hours, committed hours, remaining hours, temporal window.

---

### `components/shared/RecipeSelector.svelte`

Dropdown/search for `Recipe` records from `RecipeStore`. Shows SNLT/SNE score alongside each option.

---

### `components/shared/CommitmentDetail.svelte`

Detail panel for a `Commitment`: all fields, fulfillment state, linked plan, linked agreement, action type badge.

---

### `components/shared/IntentDetail.svelte`

Detail panel for an `Intent`: provider XOR receiver, availability window, ATP status (`availableQuantity` / `minimumQuantity`), satisfaction state.

---

## Component Hierarchy Summary

```
DDOMDashboard
├── Reliability Column
│   ├── PlanningScreen
│   │   ├── NFPCard (per row)
│   │   │   └── BufferZoneBar
│   │   ├── PriorityCell
│   │   └── ZoneBadge
│   ├── SignalIntegrityReport
│   │   └── SignalIntegrityRow
│   │       └── QuantityBar
│   └── ControlPointSchedule
│       └── TimeBufferBoard
│           └── BufferZoneBar
├── Stability Column
│   ├── TimeBufferBoard (full)
│   └── BufferStatusDashboard (mini)
│       ├── BufferFunnel (per spec)
│       └── OnHandAlert
└── Velocity Column
    └── FlowExceptionReport

BufferZoneDashboard
└── BufferZoneCard (per spec)
    ├── BufferZoneBar
    └── ZoneFormulaBreakdown

PlanningScreen (standalone route)
├── ADUPanel
├── QualifiedDemandBreakdown
├── ReplenishmentSignalPanel
└── PrioritizedShareView

ProjectedOnHandView
└── DailyProjectionEntry[] → chart

ScheduleBook (Gantt route)
└── ScheduleBlock[]

DrumScheduler
└── bar chart (effort per day)

DecouplingPointMap
└── DecouplingPointDetail
    └── BomTreeViewer

TraceView
└── FlowTree (recursive)
    └── FlowNode → LotBadge
```
