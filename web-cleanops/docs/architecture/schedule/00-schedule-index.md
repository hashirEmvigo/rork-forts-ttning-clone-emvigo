# Schedule Documentation Index

## Status

Draft v2 for technical review.

Phase 0 cleanup status: documentation-only target architecture with implementation-safety guardrails. These documents are not an implementation-ready schema, migration plan or authorization to change runtime behavior.

## Owner

Product / Admin Scheduling / Customer Operations

## Review Target

RORK

## Purpose

This folder contains the canonical architecture documentation for the CleanOps Schedule Module.

Schedule is the planning layer for recurring work, one-off bookings, assignment planning, forward preview, occurrence changes, conflict detection, manual admin scheduling and future AI-assisted scheduling.

Current implementation and target architecture must be kept separate:

- Current app concepts include Work Orders, WorkOrder service rows, Booking Queue, Schedule Core and occurrence exceptions.
- Target architecture concepts include Assignment, ScheduleSeries, RecurrenceRule, planned schedule occurrence, ScheduleChangeSet, ScheduleLock and StaffAvailability.
- Target concepts remain documentation-only until data authority, ADRs, migrations and validation plans are explicitly approved.
- These documents are not an implementation-ready schema and do not authorize repositories, adapters, UI, migrations, Supabase policy changes or runtime writes.

Use this folder before implementing or changing any scheduling logic, recurring booking logic, one-off booking logic, occurrence generation, schedule preview, staff assignment, schedule conflict handling, service-level scheduling policy, schedule UX or schedule-related key/access analysis.

These documents replace earlier partial schedule drafts and should be treated as the current review package for RORK.

---

## Canonical Documents

### 01-schedule-module-architecture.md

Defines the deterministic scheduling engine and core domain model.

This document covers:

- Assignment / AO scheduling boundary
- Assignment preferences and approved deviations
- recurring schedule series
- recurrence rules
- generated schedule occurrences
- occurrence overrides and variations
- one-off bookings
- manual admin scheduling
- forward preview
- future conflict detection
- solvable schedule conflicts
- customer preferences
- staff availability
- staff absence handling
- route/travel buffers
- schedule locking
- history protection
- schedule change sets
- validation and conflict resolution
- future AI-assisted scheduling on top of deterministic rules
- KEYS/access analysis triggers

Use this document before implementing or changing scheduling logic, recurring customer planning, one-off bookings, assignment/AO variations, schedule preview, conflict resolution, drag-and-drop commit behavior or AI-assisted scheduling.

Important principle:

> A visible empty slot in one week must not automatically be treated as a recurring available slot. The schedule engine must evaluate future occurrences before allowing a recurring booking to be created.

---

### 02-service-level-scheduling-packages.md

Defines the architecture for Service Level Packages and how they influence scheduling, operational priority and future customer service differentiation.

This document covers:

- service level package definitions
- customer-facing package tiers
- internal scheduling priority
- time-window flexibility
- same-staff continuity rules
- approved substitute pools
- minimum staff qualification levels
- conflict-resolution priority
- AI scheduling optimization freedom
- customer agreement integration
- pricing/entitlement boundaries
- future customer support priority
- future SLA behavior
- quality control extensions
- premium customer handling beyond scheduling

Use this document before implementing or changing package-based scheduling rules, customer service levels, premium/priority customer logic, staff qualification matching, support priority, SLA behavior or AI optimization policies.

Important principle:

> Service Level Packages must not be implemented as hard-coded UI labels. They should be modeled as policy-driven configuration that can later extend beyond scheduling into customer support, communication priority, SLA handling, quality controls and other premium service capabilities.

---

### 03-schedule-module-ux-architecture.md

Defines the Schedule Workspace UX architecture.

This document covers:

- dedicated schedule workspace layout
- schedule-specific sidebar
- search behavior
- overview/timeline view switch
- date and period navigation
- employee filter
- schedule status filter
- planning queue
- unassigned assignment dock positions
- ultrawide and small-screen behavior
- overview grid behavior
- timeline grid behavior
- alternating day backgrounds
- sticky planning queue
- drag-and-drop planning UX
- inline recurring slot preview
- state models for UI implementation

Use this document before implementing or changing the `/schedule` route, schedule workspace layout, sidebar filters, planning queue, drag-and-drop UX, multi-week schedule views, recurring slot preview UI or schedule-related user preferences.

Important principle:

> The Schedule Workspace should allow admins to understand what is planned, what is unplanned, who is visible, what needs review and where assignments can be placed without leaving the schedule context.

---



### 04-customer-scheduling-preferences-and-temporary-exceptions.md

Defines the customer scheduling preference model and temporary exception architecture.

This document covers:

- Preferred recurring cleaning times
- Acceptable recurring cleaning times
- Acceptable temporary cleaning times
- Temporary rescheduling priority
- Temporary scheduling exceptions
- Customer Portal self-service boundaries
- Admin Customer Card scheduling scope
- WorkOrderDetails planning guidance
- Add Service Status preview semantics
- one-time vs recurring service-row scheduling implications
- Booking Queue and occurrence exception boundaries
- future AI/scheduling interpretation rules

Use this document before implementing or changing Customer Cleaning Days & Times, customer portal scheduling preferences, temporary exceptions, WorkOrderDetails customer scheduling warnings or Add Service customer-fit logic.

Important principle:

> Temporary customer wishes are planning guidance, not guarantees. They must not automatically mutate the schedule, Booking Queue or occurrence exceptions without explicit approved implementation and admin control.

---

### 05-schedule-planning-mode-capacity-compression-and-decision-learning.md

Defines Planning Mode, capacity analytics, schedule compression and AI decision-learning boundaries.

This document covers:

- Planning Mode / Utkastläge
- draft ScheduleChangeSet handling
- change basket / ändringskorg
- quality review before publish
- decision reason capture
- AI learning company settings
- audit log vs AI learning
- booked service hours vs operational occupancy
- free time vs bookable time
- fragmentation and compression potential
- Schedule Compression Mode
- Holiday Compression Mode
- compression scenarios
- customer communication actions

Use this document before implementing planning-mode workflows, schedule compression, capacity analytics, holiday-week planning, AI decision learning or schedule publish/review flows.

Important principle:

> Schedule compression is not route optimization. It may accept local route loss when the validated global capacity gain is higher.

---

## Terminology Map

| Term | Current or target | Meaning / boundary |
|---|---|---|
| Work Order service row | Current code model | The current operational/service-row model used inside Work Orders. Do not silently mutate it from schedule guidance. |
| Assignment | Future extracted service-domain concept | A future service object representing what the customer bought, separated from when it is planned. |
| Planned schedule occurrence | Future planned schedule object | A future generated or one-off planned schedule item. Not the same as completed execution history. |
| Visit occurrence / mission | Execution anchor | The operational visit/mission anchor used by execution flows; completed or approved history must not be rewritten by schedule changes. |
| Booking Queue item | Current planning/admin queue snapshot | A business/admin queue snapshot. It is not final schedule authority. |
| Occurrence exception | Current per-occurrence overlay | A current mechanism for one specific occurrence/date variation. Must not be created by temporary wishes in the first implementation. |
| Temporary scheduling exception | Future/customer preference guidance | A customer/admin date-bound wish for a period. It is not a guarantee, recurring preference change, occurrence exception or automatic rescheduling instruction. |
| Service Level Policy Package | Future scheduling/customer-priority policy | Future policy layer for scheduling/customer priority. It is not the existing service package/catalog template. |

---

## Current Implementation vs Target Architecture

Current implementation surfaces that future schedule work must respect:

| Surface | Phase 0 classification | Authority boundary |
|---|---|---|
| Work Orders / AO | Current implementation | Current service/work planning model; authority hardening continues in separate AO phases. |
| WorkOrder service rows | Current implementation | Current row-level planned-work model; must be Supabase-authoritative before downstream schedule or Booking Queue alignment relies on it. |
| Booking Queue | Current implementation / temporary workflow layer | Mixed/mirror-based admin queue snapshot; not final schedule authority. |
| Schedule Core | Current schedule-adjacent implementation | May be read/validated only within approved scope; not a license to introduce new schedule schema. |
| Occurrence exceptions | Current per-occurrence overlay | Must not be created by warnings, temporary scheduling exceptions or unapproved Planning Mode flows. |
| Customer scheduling preferences V2 / Customer Card Cleaning Days & Times | Current customer/admin preference surfaces | May provide read-only planning context, not automatic schedule mutation. |

Target concepts described in this package remain documentation-only until approved:

- Assignment as extracted service-domain concept.
- ScheduleSeries and RecurrenceRule as recurring schedule source models.
- Planned ScheduleOccurrence as future planned schedule object.
- Persistent ScheduleChangeSet and Planning Mode publish.
- ScheduleLock, StaffAvailability, capacity analytics, compression and AI scheduling.

No target concept may become runtime authority until the relevant data authority, ADR, RLS/permission model, migration plan, validation plan and manual QA scope are approved.

---

## Booking Queue Bridge Note

Booking Queue is not final schedule authority.

- The current local backout bridge is temporary technical debt only.
- The local backout bridge must remain **OFF** unless explicitly reviewed for a migration/backout reason.
- A clean successful Supabase empty Booking Queue read must remain empty.
- Future schedule features must not depend on local Booking Queue fallback.
- Future schedule features must not treat stale local Booking Queue snapshots as planning truth.
- Booking Queue must not be used as the sole authority for Planning Mode, compression, AI scheduling, Customer Portal scheduling, Mission Log or Time Reporting.

---

## Mission Log / Time Reporting Boundary

Schedule changes may affect only future planned work.

Schedule work must not mutate or rewrite:

- Mission Log records
- mission staff sessions
- mission events
- time reports
- payroll basis
- invoice basis
- completed records
- approved records
- invoiced or payroll-linked records

Operational corrections must use a separate explicit correction workflow, not schedule mutation. Schedule documentation must not be read as permission to rewrite execution history, payroll/invoice basis or approved operational records.

---

## Documentation-Only Concepts

The following remain documentation-only until separate ADRs, data authority decisions, schemas/migrations and validation plans are approved:

- ScheduleSeries / RecurrenceRule / ScheduleOccurrence schema
- persistent ScheduleChangeSet
- Planning Mode publish
- capacity analytics
- compression / holiday compression
- service-level policy enforcement
- AI scheduling / AI learning
- Booking Queue as authoritative schedule source
- schedule-driven Mission Log or Time Reporting integration

Documentation-only means no code, migrations, repositories, adapters, routes, hooks, components, Supabase policies or runtime behavior may be inferred from these concepts without explicit implementation approval.

---

## Open ADR Decisions Before Implementation

The following decisions must be reviewed before Phase 1 or any implementation work:

1. Temporary exceptions: separate Supabase table vs Customer JSON.
2. Customer/admin approval policy for customer-created temporary exceptions.
3. Active exception edit policy.
4. Cutoff window before service date.
5. Derived vs stored temporary exception status.
6. RLS/permissions for customer/admin access.
7. Booking Queue bridge retirement criteria.
8. Minimum validation engine before occurrence writes.
9. WorkOrder service row to future Assignment mapping.
10. ScheduleOccurrence vs VisitOccurrence naming.
11. ScheduleChangeSet: UI-only draft first vs persisted model.
12. AI learning/privacy defaults.

---

## Schedule Rules

All schedule-related development must follow these rules:

1. Supabase is the source of truth; localStorage is legacy/cache/fallback only.
2. Schedule represents planned work.
3. Schedule is not operational truth.
4. Schedule may generate future planned Missions or operational work objects only through approved workflows.
5. Historical execution outcomes must not be rewritten when future schedule rules change.
6. Recurring bookings must be generated through deterministic recurrence logic.
7. One-off bookings must be clearly separated from recurring series.
8. Manual schedule changes must be traceable.
9. Assignment changes must be validated against availability and operational constraints after the Assignment model is approved.
10. Schedule conflicts must be detected before they create operational risk.
11. Future AI-assisted scheduling must operate on top of the same validation rules as manual scheduling.
12. Service level policies must be interpreted as constraints/weights, not as informal labels.
13. Drag-and-drop should not silently commit complex recurring changes without validation.
14. Occurrence-level overrides must preserve the original recurring series unless the admin explicitly changes the future series.
15. Completed, invoiced, customer-confirmed, payroll-linked or admin-locked occurrences must not be moved automatically.
16. Schedule changes that affect access readiness must trigger or expose KEYS/access analysis.
17. Customer scheduling preferences must distinguish recurring preferences from temporary rescheduling flexibility.
18. Date-bound temporary scheduling exceptions are customer wishes/guidance, not delivery guarantees.
19. Warnings or preference conflicts must not automatically mutate service rows, Booking Queue, occurrence exceptions or recurring series.
20. Planning Mode should collect draft schedule changes and validate them before publish/commit after its ADR is approved.
21. AI may rank, explain and suggest, but must not auto-commit schedule mutations without deterministic validation and admin approval.
22. Capacity analytics must distinguish free time from actually bookable time.
23. Schedule compression must be represented as draft scenarios/change sets before any commit.

---

## Schedule vs Operational Execution

Schedule is a planning system.

Operational execution is handled by downstream operational objects such as missions, mission log, time reporting, payroll basis and invoice basis.

The schedule layer may create or update future planned operational work only through approved workflows, but it must not rewrite historical execution records.

If a scheduled occurrence is completed, approved, invoiced, payroll-linked or operationally locked, future series changes must not rewrite the completed history.

---

## Access and KEYS Dependency

Schedule changes may affect access readiness.

When a booking is created, moved, reassigned or converted between recurring and one-off work, the system should be able to trigger key/access analysis where relevant.

This is especially important for:

- short-notice one-off bookings
- employee replacement
- sick leave cover
- vacation cover
- customer rebooking
- staff reassignment
- bookings requiring physical keys, tags, codes or customer entry
- schedule changes that break an existing key transfer plan
- service-level packages that promise same-staff or approved-substitute continuity

Detailed KEYS behavior should remain documented under:

- `/docs/architecture/keys/`
- `/docs/implementation/keys/`
- `/docs/dev-center/keys/`

The schedule module should only define when KEYS/access analysis is required, not duplicate the full KEYS architecture.

---

## Before Changing Schedule Logic

Before changing schedule-related behavior:

1. Read `/docs/00-master-index.md`.
2. Read `/docs/governance/01-project-constitution.md`.
3. Read `/docs/governance/02-data-authority-and-test-data-policy.md`.
4. Read `/docs/architecture/schedule/00-schedule-index.md`.
5. Read `/docs/architecture/schedule/01-schedule-module-architecture.md`.
6. Read `/docs/architecture/schedule/02-service-level-scheduling-packages.md` if the change affects package priority, service tiers, scheduling flexibility, support priority, staff qualification or customer service levels.
7. Read `/docs/architecture/schedule/03-schedule-module-ux-architecture.md` if the change affects `/schedule`, the workspace layout, sidebar filters, planning queue, drag-and-drop or schedule preview UI.
8. Read `/docs/architecture/schedule/04-customer-scheduling-preferences-and-temporary-exceptions.md` if the change affects customer preferences, temporary scheduling exceptions, Customer Portal scheduling wishes, Customer Card scheduling guidance, WorkOrderDetails warnings or Add Service customer-fit logic.
9. Read `/docs/architecture/schedule/05-schedule-planning-mode-capacity-compression-and-decision-learning.md` if the change affects Planning Mode, compression, capacity analytics, AI scheduling or ScheduleChangeSet concepts.
10. Check `/docs/backlog/20-build-backlog.md`.
11. Check related Development Center documentation if the change affects a major feature or operationally sensitive workflow.
12. Verify whether KEYS/access analysis is affected.
13. Update implementation and validation documentation if scope changes.

---

## Expected RORK Review Output

Before implementation, RORK should review these documents and return:

1. Current codebase overlap.
2. Current data model overlap.
3. Current AO/assignment variation overlap.
4. Current local/Supabase data authority implications.
5. Recommended canonical domain model.
6. Tables/models that should be new vs adapted.
7. UX implementation risks.
8. Service-level package modeling recommendation.
9. AI scheduling boundary recommendation.
10. KEYS/access integration risks.
11. Development Center/backlog update proposal.
12. Phased implementation plan.
13. Open decisions requiring product approval.

RORK should not begin implementation from these documents without explicit approval.

---

## Related Documentation

- `/docs/00-master-index.md`
- `/docs/governance/`
- `/docs/backlog/20-build-backlog.md`
- `/docs/architecture/keys/`
- `/docs/implementation/`
- `/docs/dev-center/`
- `/docs/architecture/schedule/01-schedule-module-architecture.md`
- `/docs/architecture/schedule/02-service-level-scheduling-packages.md`
- `/docs/architecture/schedule/03-schedule-module-ux-architecture.md`
- `/docs/architecture/schedule/04-customer-scheduling-preferences-and-temporary-exceptions.md`
- `/docs/architecture/schedule/05-schedule-planning-mode-capacity-compression-and-decision-learning.md`
