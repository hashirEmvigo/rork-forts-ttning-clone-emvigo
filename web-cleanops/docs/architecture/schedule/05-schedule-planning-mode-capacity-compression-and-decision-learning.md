# Schedule Planning Mode, Capacity, Compression and Decision Learning

## Status

Draft v1 for architecture / product / technical review.

Phase 0 cleanup status: target architecture only. This document does not authorize code, migrations, schema changes, UI changes, Planning Mode implementation, ScheduleChangeSet persistence, compression implementation, Booking Queue sync, Mission Log changes, Time Reporting changes or AI implementation.

## Owner

Product / Admin Scheduling / AI / Capacity Planning

## Review Target

RORK

## Related Documents

- `/docs/architecture/schedule/00-schedule-index.md`
- `/docs/architecture/schedule/01-schedule-module-architecture.md`
- `/docs/architecture/schedule/02-service-level-scheduling-packages.md`
- `/docs/architecture/schedule/03-schedule-module-ux-architecture.md`
- `/docs/architecture/schedule/04-customer-scheduling-preferences-and-temporary-exceptions.md`
- `/docs/00-master-index.md`

## Scope

Planning Mode / draft scheduling, ScheduleChangeSet review workflow, decision capture, AI decision learning boundaries, capacity analytics, bookable vs free time, Schedule Compression Mode, Holiday Compression Mode, customer communication and quality review.

This document is architecture and product policy. It does not authorize implementation, migrations, AI automation, automatic schedule mutation, Booking Queue writes, occurrence exception writes, Mission Log changes, Time Reporting changes or external model training.

Current implementation context:

- Work Orders and WorkOrder service rows are the current service/work planning model.
- WorkOrder service rows are the current closest code model for planned service work.
- Booking Queue is mixed/mirror-based with a temporary local bridge and is not final schedule authority.
- Schedule Core and occurrence exceptions are current schedule-adjacent mechanisms.
- Supabase is the source of truth; localStorage is legacy/cache/fallback only.

Documentation-only target concepts:

- persistent ScheduleChangeSet
- Planning Mode publish
- ScheduleSeries / RecurrenceRule / planned ScheduleOccurrence schema
- capacity analytics
- compression / holiday compression
- service-level policy enforcement
- AI scheduling / AI learning
- Booking Queue as authoritative schedule source
- schedule-driven Mission Log or Time Reporting integration

This document is not an implementation-ready schema. It does not authorize code, migrations, repositories, adapters, UI, Supabase policy changes, Booking Queue sync, occurrence exception writes or runtime schedule mutation.

---

# 1. Purpose

CleanOps Schedule Module should evolve from a calendar into a planning and capacity-control system.

It should help admins understand:

- what is booked
- what is actually bookable
- what capacity is fragmented
- what changes are being drafted
- why changes are made
- which customers need communication
- where schedule compression can create better operational capacity

Core principle:

> Deterministic validation first. AI assistance second. No automatic schedule mutation without explicit approved implementation and admin control.

---

# 2. Planning Mode / Utkastläge

Schedule work should support a Planning Mode in the target architecture.

Planning Mode remains documentation-only until ADR approval. It must not mutate committed schedule, Booking Queue, occurrence exceptions, WorkOrder service rows, Mission Log or Time Reporting while changes are drafts.

Planning Mode must not depend on local Booking Queue fallback. The Booking Queue bridge is temporary technical debt, must remain off unless explicitly reviewed, and clean Supabase empty reads must remain empty.

In Planning Mode, an admin can:

- move assignments for several hours
- test alternative placements
- create drag-and-drop changes
- compare alternatives
- undo or adjust changes
- collect all changes in a change set
- review everything before publishing

The system should not ask for a reason after every small drag operation.

Technical logging may capture draft operations, but AI learning and reason capture should primarily use reviewed/published changes.

Only confirmed/published changes should become primary AI learning signals after AI learning, privacy defaults and deterministic validation are approved.

---

# 3. Change basket / ändringskorg

Planning Mode should show a visible draft change basket.

Example:

```text
Ändringar i utkast (7)
```

Expanded example:

```text
✓ Kund A flyttad till tisdag
✓ Kund B bytte medarbetare
✓ Kund C fick ny tid
✓ Konflikt med Kund X löst
```

Before publish, show summary:

```text
Du har gjort 14 ändringar i vecka 5.

- 6 uppdrag flyttade till annan tid
- 3 uppdrag bytte medarbetare
- 2 återkommande kunder fick avvikelse
- 1 Premium/Priority-kund påverkades
- 2 konflikter löstes
```

Actions:

```text
[Godkänn föreslagna orsaker]
[Ange samma orsak för alla]
[Gå igenom manuellt]
[Spara utan AI-lärande]
```

---

# 4. Decision reasons / reason codes

Reason capture should use structured reason codes, not only free text.

Recommended initial type:

```ts
type ScheduleDecisionReason =
  | 'customer_preference'
  | 'regular_staff_continuity'
  | 'approved_substitute'
  | 'staff_experience_match'
  | 'service_level_priority'
  | 'route_optimization'
  | 'travel_time_reduction'
  | 'key_or_access_constraint'
  | 'sick_leave_cover'
  | 'vacation_cover'
  | 'time_window_constraint'
  | 'customer_relationship'
  | 'complaint_history'
  | 'one_off_priority'
  | 'schedule_compression'
  | 'release_staff_capacity'
  | 'standby_capacity_creation'
  | 'holiday_week_compression'
  | 'increase_bookable_capacity'
  | 'merge_sparse_schedule'
  | 'manual_admin_judgement'
  | 'other';
```

Important:

- `schedule_compression` is not the same as `route_optimization`.
- In compression, local travel time may worsen while global capacity improves.

---

# 5. AI learning company setting

Recommended company setting label:

```text
AI-lärande för schema
```

or:

```text
Förbättra AI-förslag med schemabeslut
```

Avoid UI wording such as:

```text
Activate training data for AI
```

MVP principles:

- Audit log is always on for saved/published schedule changes.
- AI decision learning is opt-in per company.
- MVP learning is tenant-local.
- Anonymized product improvement is a separate future opt-in.
- External model training is a separate future opt-in.
- Free text notes are not automatically used as AI learning data in MVP.

Recommended defaults:

```ts
const scheduleAiLearningDefaults = {
  scheduleLearningEnabled: false,
  useOnlyWithinTenant: true,
  allowAnonymizedProductImprovement: false,
  allowExternalModelTraining: false,
  includeFreeTextNotes: false
};
```

---

# 6. Reason capture timing

Do not ask for a reason on every drag.

Ask for reason or suggest reason at:

- publish/review
- recurring customer moved
- ordinary employee changed
- AI suggestion rejected
- warning ignored
- Premium/Priority customer affected
- customer moved outside optimal preference
- schedule marked ready despite conflict
- locked/ready week changed
- assignment moved to another day

The system may suggest reasons automatically based on context. Admin can accept, edit or bulk-apply them.

---

# 7. Capacity analytics

Schedule must understand more than booked rows.

Capacity analytics remain documentation-only until authoritative AO/service-row data and planned occurrence authority are approved.

It should understand:

- booked service hours
- operational occupancy
- free hours
- bookable gap hours
- unbookable fragment hours
- largest bookable gap
- fragmentation score
- compression potential

Important distinction:

```text
Ledig tid ≠ bokningsbar tid
```

Free time is all unoccupied time.

Bookable time is free time that can actually fit work given:

- assignment duration
- travel time before/after
- employee working hours
- customer time window
- service-level policy
- staff qualification
- key/access constraints
- route logic
- break rules

---

# 8. Recommended capacity metrics

```ts
type DayCapacityMetrics = {
  date: string;

  availableStaffHours: number;
  bookedServiceHours: number;
  occupiedOperationalHours: number;

  freeHoursTotal: number;
  bookableGapHours: number;
  unbookableFragmentHours: number;

  largestBookableGapHours: number;
  bookableGapCount: number;

  bookedServiceUtilizationPct: number;
  operationalOccupancyPct: number;
  bookableCapacityPct: number;

  fragmentationScore: number;
  compressionPotentialScore: number;

  status:
    | 'healthy'
    | 'fragmented'
    | 'overloaded'
    | 'underutilized'
    | 'compression_candidate';
};
```

```ts
type WeekCapacityMetrics = {
  weekNumber: number;
  year: number;

  days: DayCapacityMetrics[];

  totalAvailableStaffHours: number;
  totalBookedServiceHours: number;
  totalOccupiedOperationalHours: number;

  totalFreeHours: number;
  totalBookableGapHours: number;
  totalUnbookableFragmentHours: number;

  bookableGapImprovementPotentialHours: number;
  releasableStaffDayCount: number;

  recommendedCompressionObjectives: CompressionObjective[];
};
```

---

# 9. Capacity UI

Daily header example:

```text
Måndag 27/1
Bokad 78%
Bokningsbart 14,5h
Ledigt 22h
```

Weekly overview example:

```text
Vecka 5 – Bokningsläge

Total kapacitet: 600h
Bokad kundtid: 462h / 77%
Operativt upptaget: 515h / 86%
Ledigt totalt: 85h
Bokningsbara luckor: 41h
Ej bokningsbara fragment: 44h
Komprimeringspotential: Hög
```

Do not show ambiguous percentages without labels. Use labels such as:

- Bokad kundtid
- Bokningsbara luckor
- Ledigt totalt
- Operativt upptaget

---

# 10. Schedule Compression Mode

Schedule Compression Mode is a planning mode for reshaping the week to create operational capacity.

Compression objectives:

```ts
type CompressionObjective =
  | 'general_week_compression'
  | 'holiday_compression'
  | 'release_staff_day'
  | 'overbooked_day_relief'
  | 'increase_bookable_gaps'
  | 'merge_sparse_schedules'
  | 'create_standby_capacity';
```

Use cases:

1. General week compression.
2. Holiday compression.
3. Release staff day.
4. Overbooked day relief.
5. Increase bookable gaps.
6. Merge sparse schedules.
7. Create standby capacity.

Compression is not route optimization. A locally worse route can be acceptable if it creates a larger bookable capacity gain.

---

# 11. Holiday Compression Mode

Holiday Compression Mode is a specialization of Schedule Compression Mode.

Use when:

- public holiday / red day
- short week
- closed Friday
- all Friday customers need to fit Monday-Thursday

Rules:

- System should not merely find existing gaps.
- Existing Monday-Thursday schedules may need compression.
- Customers may move outside optimal but within acceptable preferences.
- Service-level packages determine who moves first.
- MVP proposes, not auto-commits.

---

# 12. Compression UI

Button:

```text
[Komprimera]
```

Dialog:

```text
Komprimeringsläge

Vad vill du uppnå?

○ Skapa fler bokningsbara luckor
○ Frigör en medarbetardag
○ Komprimera inför röd dag
○ Avlasta överbelastad dag
○ Slå ihop glesa scheman
○ Skapa standby-kapacitet
```

Scope options:

```text
[Hela veckan]
[Valda dagar]
[Valda medarbetare]
[Valda uppdrag]
```

Change mode:

```text
○ Endast enstaka händelser
○ Tillåt framtida återkommande ändringar
○ Visa båda alternativen
```

MVP recommendation:

```text
Endast enstaka händelser
```

That means occurrence overrides, not recurring series changes.

---

# 13. Compression scenarios

System should produce scenarios, not directly mutate the schedule.

Examples:

```text
Scenario A – Frigör mest kapacitet
Scenario B – Minst kundpåverkan
Scenario C – Bäst balans
```

Scenario example:

```text
Scenario A
Frigör: Anna fredag + Lars fredag
Skapar bokningsbar kapacitet: 16h
Flyttar: 5 kunder
Kundpåverkan: Medel
Extra restid: +48 min
Premium-kunder påverkade: 0
Rekommendation: Stark
```

Admin selects a scenario and proceeds into Planning Mode where changes are draft actions. This remains scenario/preview-only until ScheduleChangeSet, validation, Booking Queue bridge retirement and occurrence-write ADRs are approved.

---

# 14. Compression proposal model

```ts
type ScheduleCompressionProposal = {
  id: string;
  companyId: string;

  objective: CompressionObjective;

  scope:
    | 'week'
    | 'selected_days'
    | 'selected_staff'
    | 'selected_assignments';

  changeMode:
    | 'temporary_occurrence_overrides'
    | 'future_series_changes'
    | 'mixed';

  proposedChanges: ScheduleChangeAction[];

  effects: {
    releasedStaffDays: number;
    releasedBookableHours: number;
    freeHoursBefore: number;
    freeHoursAfter: number;
    bookableGapHoursBefore: number;
    bookableGapHoursAfter: number;
    unbookableFragmentsBefore: number;
    unbookableFragmentsAfter: number;
    affectedCustomers: number;
    customerMessagesRequired: number;
    premiumCustomersAffected: number;
    extraTravelMinutes: number;
  };

  score: number;
  warnings: string[];
};
```

---

# 15. Compression scoring

Compression scoring should understand the active objective.

Example:

```ts
compressionScore =
  releasedCapacityScore
  + bookableGapImprovementScore
  + fullDayReleaseScore
  + overloadReductionScore
  - customerPreferencePenalty
  - serviceLevelPenalty
  - travelTimePenalty
  - staffContinuityPenalty
  - customerCommunicationPenalty;
```

A worse local route can still be a better global schedule if it creates significant bookable capacity.

---

# 16. Service-level interaction

Service level packages influence compression.

Default policy:

```text
Flex Basic / Flex Plus move first.
Standard can move within acceptable rules.
Priority is protected more strongly.
Premium should generally not be affected.
```

Packages affect:

- movement priority
- time-window tolerance
- same-staff continuity
- approved substitute rules
- customer communication priority
- support/SLA priority
- AI optimization freedom

Service Level Policy Package means the future policy/entitlement concept, not the existing service package/catalog template.

Package policy must be evaluated before compression proposals are recommended, after Service Level Policy Package authority is approved. Until then this is documentation-only.

---

# 17. Customer communication and quality review

Before publish, Planning Mode should show communication impact.

Example:

```text
Kunder som behöver informeras: 6
Kunder där tid ändras inom preferens: 4
Kunder där tid ändras utanför optimal men inom acceptabel: 2
Kunder där manuell bekräftelse rekommenderas: 1
```

Actions:

```text
[Skicka information]
[Skapa manuell kontaktuppgift]
[Markera som bekräftat]
[Hoppa över kundmeddelande]
```

Internal reason and external customer copy are different.

Internal reason:

```text
schedule_compression
```

External copy:

```text
Vi behöver justera din tid denna vecka på grund av planeringsändring.
```

Holiday copy:

```text
På grund av helgdag justeras veckans städtid.
```

---

# 18. Implementation phases

Phase 0 documentation cleanup only is currently approved.

Planning Mode, compression, AI scheduling, ScheduleSeries / RecurrenceRule / ScheduleOccurrence schema and persistent ScheduleChangeSet remain documentation-only until data authority is approved. None of these concepts may write Booking Queue, occurrence exceptions, Mission Log, Time Reporting, payroll/invoice basis or completed/approved records without explicit later approval.

Future phases require explicit approval and ADRs before implementation:

1. Documentation and RORK architecture review.
2. ScheduleChangeSet ADR: UI-only draft first vs persisted model.
3. Planning Mode / draft ScheduleChangeSet model.
4. Change basket UI.
5. Publish/review workflow.
6. Reason-code capture and proposal.
7. AI learning company setting and privacy defaults.
8. Capacity metrics calculation after schedule occurrence authority exists.
9. Capacity UI display.
10. Compression scenario generator as preview-only first.
11. Holiday compression mode as preview-only first.
12. Customer communication action workflow.
13. AI ranking/explanation integration after deterministic validation is stable.

---

# 19. Open ADR decisions and questions

Required ADR decisions before implementation:

1. Temporary exceptions: separate Supabase table vs Customer JSON, where Planning Mode consumes temporary guidance.
2. Approval policy for customer/admin temporary guidance before it may influence planning scenarios.
3. Active edit policy for temporary guidance while draft planning is in progress.
4. Cutoff window before service date.
5. Derived vs stored status for temporary guidance consumed by planning.
6. RLS/permissions for planning, temporary guidance and admin/super-admin access.
7. Booking Queue bridge retirement criteria.
8. Minimum validation engine before occurrence writes.

Additional product/architecture questions:

9. Which capacity metrics are required for MVP?
10. Should capacity analytics be computed on demand or materialized?
11. How should travel-time data be approximated before real routing exists?
12. Should compression first support only occurrence overrides?
13. When can compression modify future ScheduleSeries?
14. How should package policy block or penalize compression?
15. Which schedule decisions require customer communication?
16. How long should draft planning sessions persist?
17. How should multiple admins editing the same week be handled?
18. Should free-text notes ever be used for AI learning?
19. Should AI learning remain tenant-local only in MVP?

---

# 20. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Admin believes AI/compression auto-mutates schedule. | MVP proposes draft scenarios only. |
| Free time mistaken for bookable time. | Separate free vs bookable metrics in UI. |
| Customer communication forgotten. | Publish review must surface communication actions. |
| Compression harms premium customers. | Service-level policy penalties/blocks. |
| AI learns from messy draft experiments. | Learn only from reviewed/published changes after opt-in approval. |
| Free text leaks into AI training. | Exclude free text by default. |
| Compression rewrites recurring series too early. | MVP occurrence overrides only after occurrence-write validation is approved. |
| Holiday compression creates cascade risk. | Validation engine and admin approval required. |
| Planning features depend on local Booking Queue fallback. | Keep Booking Queue bridge retirement as an explicit ADR and do not use local fallback as authority. |
| Schedule changes rewrite Mission Log or Time Reporting. | Limit schedule changes to future planned work; protect Mission Log, staff sessions, mission events, time reports, payroll/invoice basis and completed/approved records. |
