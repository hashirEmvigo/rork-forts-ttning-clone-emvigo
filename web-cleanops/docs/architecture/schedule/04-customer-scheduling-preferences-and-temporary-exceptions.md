# Customer Scheduling Preferences and Temporary Exceptions

## Status

Draft v1 for architecture / product / technical review.

Phase 0 cleanup status: target architecture only. This document does not authorize code, migrations, schema changes, UI changes, Booking Queue writes, occurrence exception writes, WorkOrder/service-row mutation, Mission Log changes or Time Reporting changes.

## Owner

Product / Customer Operations / Admin Scheduling / Customer Portal

## Review Target

RORK

## Related Documents

- `/docs/architecture/schedule/00-schedule-index.md`
- `/docs/architecture/schedule/01-schedule-module-architecture.md`
- `/docs/architecture/schedule/02-service-level-scheduling-packages.md`
- `/docs/architecture/schedule/03-schedule-module-ux-architecture.md`
- `/docs/architecture/schedule/05-schedule-planning-mode-capacity-compression-and-decision-learning.md`
- `/docs/00-master-index.md`

## Scope

Customer scheduling preferences, Customer Cleaning Days & Times, temporary rescheduling flexibility, date-bound temporary scheduling exceptions, Customer Portal self-service boundaries, WorkOrderDetails planning guidance, Add Service Status preview semantics, Booking Queue implications and future AI/scheduling interpretation.

This document is architecture and product policy. It does not authorize implementation, migrations, Booking Queue writes, occurrence exception writes, automatic rescheduling, WorkOrder service-row mutation, Mission Log changes, Time Reporting changes or AI automation.

Current implementation context:

- Customer scheduling preferences V2 and Customer Card Cleaning Days & Times are current app surfaces.
- WorkOrderDetails and Add Service Status preview may show read-only planning guidance where already implemented.
- Work Orders and WorkOrder service rows remain the current service/work model.
- Booking Queue is mixed/mirror-based with a temporary local bridge and is not final schedule authority.
- Supabase is the source of truth; localStorage is legacy/cache/fallback only.

Target architecture context:

- Temporary Scheduling Exceptions are future customer/admin date-bound wishes.
- They are warning/guidance only for the first implementation.
- They are not guarantees, recurring preference changes, occurrence exceptions or automatic rescheduling instructions.
- They must not become write authority for WorkOrder service rows, Booking Queue, occurrence exceptions, Mission Log or Time Reporting.

This document is not an implementation-ready schema. It does not authorize a Customer JSON model, a separate table, migrations, policies, repositories, adapters, UI, Customer Portal self-service or runtime behavior until the relevant ADRs and implementation phase are approved.

---

# 1. Purpose

CleanOps needs to distinguish between normal recurring customer preferences and temporary scheduling flexibility.

Customers are usually stricter about their ordinary recurring cleaning day/time, but more flexible for one-off changes caused by customer requests, holidays, employee absence, capacity issues or administrative rescheduling. These concepts must be separate so that manual scheduling, future AI planning and customer-facing self-service do not overstate the customer's flexibility.

Core principle:

> Customer scheduling preferences are planning inputs and warnings. They are not delivery guarantees and must not automatically mutate the schedule unless a future, explicitly approved rescheduling workflow does so.

---

# 2. Approved terminology

Use these customer-facing/product terms.

| Term | Meaning | Use when | Do not use when |
|---|---|---|---|
| Preferred recurring cleaning times | Customer's first-choice windows for ordinary recurring cleaning. | Normal recurring schedule scoring. | Temporary one-off rescheduling. |
| Acceptable recurring cleaning times | Lower-priority but acceptable permanent recurring alternatives. | Permanent recurring schedule alternatives. | Absence-only or date-bound temporary exceptions. |
| Acceptable temporary cleaning times | General temporary flexibility windows for one-off rescheduling. | Temporary rescheduling with explicit reason/context. | Normal permanent schedule. |
| Temporary rescheduling priority | How aggressively temporary alternatives may be used. | One-off rescheduling workflows. | As a delivery promise or permanent rule. |
| Temporary scheduling exception | Date-bound customer/admin-created temporary scheduling wish. | School holidays, customer vacation, public holidays, renovation, one-off preference periods. | General recurring preference or global temporary flexibility. |
| Customer fit | How well a proposed service row matches customer scheduling preferences. | Add Service, Change date/time, future Schedule preview. | As a blocking rule unless explicitly configured. |
| Employee fit | How well a proposed service row matches employee availability/preference. | Add Service preview and future Schedule planning. | Before an employee availability model exists. |
| Optimal | Matches preferred preference. | Status preview. | As a guarantee. |
| Acceptable | Matches acceptable preference. | Status preview. | As equivalent to optimal. |
| Outside preference | Outside known preference window. | Warning/attention state. | As automatic blocker unless policy requires it. |
| Not enough data | Missing data for evaluation. | Unknown/missing date/time/preferences/employee availability. | As a failure state. |

Avoid these terms in customer/admin UI:

- `during employee absence` as the main name for temporary flexibility; it is too narrow.
- `guaranteed` for customer wishes.
- `deferred`, `legacy`, `local-first` in user-facing UI.
- copy implying that temporary preferences automatically reschedule visits.

---

# 3. Customer scheduling preference model

The scheduling preference model should be versioned under `Customer.schedulingPreferences`.

Recommended V2 shape:

```ts
type CustomerSchedulingPreferences = {
  version: 2;

  preferredRecurringWindows: CustomerCleaningTimeWindow[];
  acceptableRecurringWindows: CustomerCleaningTimeWindow[];

  acceptableTemporaryWindows: CustomerCleaningTimeWindow[];
  temporaryReschedulingPriority: TemporaryReschedulingPriority[];

  temporaryExceptions?: TemporarySchedulingException[];

  schedulingNotes?: string;
  updatedAt?: string;

  // legacy read support during transition
  preferredDays?: CleaningDayPreference[];
  secondaryDays?: CleaningDayPreference[];
  absencePriority?: AbsenceHandlingPreference[];
  absenceHandling?: AbsenceHandlingPreference | null;
};
```

Recommended shared window shape:

```ts
type CustomerCleaningTimeWindow = {
  id: string;
  weekday: WeekDay;
  startTime: string;
  endTime: string;
  label?: string;
  note?: string;
  priority?: number;
};
```

Recommended temporary priority values:

```ts
type TemporaryReschedulingPriority =
  | 'keep_regular_employee'
  | 'keep_regular_day_time'
  | 'use_acceptable_temporary_window'
  | 'skip_or_wait';
```

## 3.1 Permanent recurring schedule

Use for ordinary recurring bookings.

Evaluation order:

1. Preferred recurring cleaning times.
2. Acceptable recurring cleaning times.
3. Outside preference if neither matches.

Do not use acceptable temporary cleaning times for permanent schedule creation or normal Add Service.

## 3.2 General temporary rescheduling flexibility

Use only when a one-off temporary event exists.

Examples:

- employee absence
- employee sickness
- employee vacation
- customer-requested reschedule
- holiday
- capacity issue
- admin manual change

Temporary windows are broader flexibility windows and are not permanent availability.

## 3.3 Backward compatibility

Legacy mapping:

- `preferredDays` → `preferredRecurringWindows`
- `secondaryDays` → `acceptableRecurringWindows`
- `absencePriority` / `absenceHandling` → `temporaryReschedulingPriority`
- `acceptableTemporaryWindows` defaults to empty

Do not automatically copy recurring windows into temporary windows. Temporary flexibility is a separate consent/expectation.

Legacy fields may remain readable while callers migrate through adapters such as:

```ts
normalizeSchedulingPreferencesV2();
legacyPreferencesToV2();
v2PreferencesToPreferredTimeInput();
```

---

# 4. Temporary scheduling exceptions

A Temporary Scheduling Exception is a date-bound customer/admin-created temporary wish.

Examples:

- school holiday
- public holiday / red day
- customer vacation
- customer working from home for a specific week
- renovation at home
- customer-requested temporary preference for a specific week
- capacity issue
- admin manual one-off change

Core policy:

> Temporary scheduling exceptions create planning guidance and warnings. First version must not automatically move bookings, mutate Booking Queue or create occurrence exceptions.

Temporary Scheduling Exceptions are:

- customer/admin date-bound wishes
- warning/guidance only in the current approved direction
- not guarantees
- not recurring preference changes
- not occurrence exceptions
- not automatic rescheduling instructions
- not authority to mutate WorkOrder service rows, Booking Queue, recurring series, Mission Log or Time Reporting
- not authority to write payroll/invoice basis or rewrite completed/approved execution history

## 4.1 Policy decisions

1. Only one active/overlapping exception is allowed per customer for the same date range.
2. The customer exception is a wish/guideline, not a guarantee.
3. A customer exception must not negatively override other customers' planning needs.
4. Every exception requires `startDate` and `endDate`.
5. Customers may create their own temporary exceptions in the Customer Portal.
6. Admins may create, edit and cancel exceptions for customers.
7. First version shows warnings/planning guidance only.
8. No automatic rescheduling in first version.
9. No automatic Booking Queue mutation in first version.
10. No automatic occurrence exception mutation in first version.

## 4.2 Proposed model

```ts
type TemporarySchedulingExceptionStatus =
  | 'upcoming'
  | 'active'
  | 'expired'
  | 'cancelled';

type TemporarySchedulingExceptionReason =
  | 'school_holiday'
  | 'public_holiday'
  | 'customer_vacation'
  | 'customer_working_from_home'
  | 'renovation'
  | 'customer_requested_temporary_preference'
  | 'employee_absence'
  | 'employee_sickness'
  | 'employee_vacation'
  | 'capacity_issue'
  | 'admin_manual'
  | 'other';

type TemporarySchedulingException = {
  id: string;
  status: TemporarySchedulingExceptionStatus;
  reason: TemporarySchedulingExceptionReason;

  startDate: string;
  endDate: string;

  windows: CustomerCleaningTimeWindow[];
  note?: string;

  createdByType: 'customer' | 'admin' | 'system';
  createdById?: string;

  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
};
```

## 4.3 Storage recommendation

Preferred direction before Customer Portal self-service:

- Use a separate Supabase table for temporary scheduling exceptions so customer-created records can have explicit ownership, RLS, audit, status handling and date-range query behavior.
- This remains an ADR decision before any migration is created.

Do not implement as Customer JSON or a separate table until the ADR is approved.

Customer JSON may still be considered for admin-only, customer-scoped low-volume storage, but it is not the preferred direction for portal self-service because permissions, overlap validation and audit become less explicit.

Open decision:

- Separate Supabase table vs `Customer.schedulingPreferences.temporaryExceptions` for the first approved implementation.

---

# 5. Customer Portal scope

Customer Portal first self-service scope is documentation-only until storage, RLS, approval policy and cutoff-window ADRs are approved:

- create temporary scheduling exception
- choose start date and end date
- choose acceptable temporary days/times for that period
- choose reason
- add optional note
- view active/upcoming exceptions
- edit own upcoming/active exception if allowed by product policy
- cancel own future/upcoming exception if safe

Customer Portal should not in first version:

- edit all permanent recurring preferences
- guarantee rescheduling
- automatically move schedule
- affect other customers negatively
- mutate Booking Queue
- create occurrence exceptions

Suggested copy:

```text
Temporary scheduling wishes help us plan, but cannot be guaranteed.
We will use this information when reviewing the schedule and may contact you if we need to confirm a change.
```

---

# 6. Admin Customer Card scope

Admin Customer Card is the intended admin edit surface after implementation is approved. Until then, this section is target architecture only for:

- Preferred recurring cleaning times
- Acceptable recurring cleaning times
- Acceptable temporary cleaning times
- Temporary rescheduling priority
- Scheduling notes
- Temporary scheduling exceptions

Customer Card should show active exceptions clearly, for example:

```text
Active temporary scheduling exception
2026-02-09 - 2026-02-16
Customer has temporary scheduling wishes for this period.
```

Admin may:

- create exception for customer
- edit exception
- cancel exception
- view active/upcoming/expired/cancelled exceptions
- see history where relevant

---

# 7. WorkOrderDetails / Services impact

WorkOrderDetails should display customer scheduling preferences and active temporary exceptions as read-only planning guidance when implemented.

Rules:

- Do not manually link service rows to customer days/times.
- Service rows get this context automatically through the work order customer relation.
- If a service row date falls inside an active temporary exception, show the exception context.
- If booked date/time is outside the exception windows, show a warning:

```text
Booked time differs from the customer's temporary scheduling wishes for this period.
```

Do not:

- auto-move service rows
- mutate Booking Queue
- create occurrence exceptions
- alter recurrence rules
- affect Mission Log
- affect Time Reporting
- treat the exception as a delivery guarantee

---

# 8. Add Service Status Preview

Status preview remains non-blocking and warning-only.

Normal Add Service should evaluate only recurring preferences:

- preferred recurring match = Optimal
- acceptable recurring match = Acceptable
- outside recurring = Outside preference
- missing date/time/preferences = Not enough data

Normal Add Service must not use acceptable temporary windows or temporary scheduling exceptions unless the action is explicitly a temporary reschedule/exception context.

Future Change date/time / Reschedule flows may evaluate temporary exceptions when the service date falls inside an exception period and a rescheduling reason/context exists.

Employee fit remains `Not enough data` until an employee availability/preference model exists.

---

# 9. One-time vs recurring service-row logic

## 9.1 One-time service rows

One-time service row date/time can be changed directly through the service-row RPC when the action is explicitly `Change date/time`.

Rules:

- update parent `work_orders.data.serviceRows`
- update flat `work_order_service_rows`
- verify through fresh Supabase read
- do not mutate Booking Queue in first version
- do not create occurrence exceptions

## 9.2 Recurring service rows

Recurring service-row date/time changes are not ordinary edits.

Potential meanings:

- move one occurrence only
- change all future occurrences
- change the whole series
- change only time
- create an occurrence exception
- split/end current series and start another

Therefore recurring rows require a separate reschedule/occurrence/series-change flow.

## 9.3 Occurrence exceptions

One occurrence move should become an occurrence exception/override, not a base recurring row mutation, only after occurrence-write policy and validation are approved.

Temporary scheduling exceptions may later influence occurrence exception suggestions, but must not create them automatically in first version.

---

# 10. Booking Queue implications

Booking Queue is not final schedule authority.

The current Booking Queue bridge is accepted only as temporary technical debt:

- local backout bridge must remain **OFF** unless explicitly reviewed
- clean successful Supabase empty reads must remain empty
- future schedule features must not depend on local Booking Queue fallback
- future schedule features must not resurrect stale local Booking Queue snapshots
- Booking Queue must not be used as the sole authority for Planning Mode, compression, AI, Customer Portal scheduling, Mission Log or Time Reporting

Booking Queue should not be mutated by warnings or customer preferences alone.

Potential stale snapshot risk:

- if service row date/time changes but Booking Queue snapshot is not synced, queue views that use persisted queue fields may lag.
- if queue read derives from live service row, the risk is lower.

Policy:

- first version of preference/exception warnings does not write Booking Queue.
- Booking Queue sync must be a separate, explicit architecture slice.
- no hidden local side effects.

---

# 11. AI / scheduling semantics

AI scheduling and AI learning remain documentation-only until approved.

AI scheduling must not be introduced before AO/service-row authority, deterministic validation and Booking Queue bridge retirement criteria are approved.

Future AI/scheduling must interpret:

- Preferred recurring = strongest positive signal for permanent schedule.
- Acceptable recurring = allowed permanent alternative.
- Acceptable temporary = allowed only for temporary rescheduling.
- Temporary scheduling exception = date-bound customer-specific temporary wish.
- Temporary exception is stronger context than general temporary flexibility during its date range.
- None of these are delivery guarantees.
- Missing data means `Not enough data`, not inferred consent.

AI must explain temporary-window usage, for example:

```text
The selected date is inside an active customer temporary scheduling exception.
The customer prefers Wednesday 09:00-13:00 during this period, but this booking is Friday 15:00.
```

AI must not bypass deterministic validation, service-level policy, staff availability, key/access constraints or admin approval.

---

# 12. Service-level package interaction

Service level packages constrain how customer preferences and temporary exceptions are applied.

Examples:

- Flex Basic / Flex Plus can absorb more scheduling optimization.
- Standard may move within approved recurring/temporary rules.
- Priority should be protected more strongly.
- Premium should generally be protected from compression and broad temporary moves.

Package policy may limit:

- how much a customer can be moved
- whether same staff is required
- whether approved substitute pool is required
- how much AI optimization freedom exists
- when customer communication/support action is required

Temporary exceptions do not override package policy.

---

# 13. Warnings vs automatic actions

First version should show warnings/guidance, not automatic changes, for:

- service row outside active temporary exception windows
- service row outside recurring preferences
- active temporary exception overlapping booked service
- recurring service rows needing occurrence logic
- Booking Queue mismatch
- AI scheduling suggestions

Later explicit implementations may support:

- creating occurrence overrides
- generating reschedule suggestions
- syncing Booking Queue
- applying admin-approved changes through ScheduleChangeSet
- notifying customers

---

# 14. Implementation phases

Phase 0 documentation cleanup only is currently approved.

Planning Mode, compression, AI scheduling, ScheduleSeries / RecurrenceRule / ScheduleOccurrence schema and persistent ScheduleChangeSet are documentation-only until data authority is approved. This document does not authorize occurrence exception writes or Booking Queue sync.

Future phases require explicit approval and ADRs before implementation:

1. Documentation and RORK architecture review.
2. Data authority and storage ADR for temporary exceptions.
3. RLS/permissions and approval/cutoff policy ADRs.
4. V2 preference follow-up, if needed.
5. Customer Card admin UI.
6. WorkOrderDetails read-only planning guidance.
7. Add Service Status preview recurring-window evaluation.
8. Customer Portal temporary exception self-service.
9. Temporary exception warnings in WorkOrderDetails / Add Service / Change date-time.
10. Rescheduling reason model.
11. Occurrence exception integration for recurring rows only after validation engine approval.
12. Booking Queue sync design only after bridge retirement criteria are approved.
13. AI/scheduling scoring and explanation layer only after deterministic validation is stable.

---

# 15. Tests and validation expectations

Model/adapters:

- legacy preferredDays migrate to preferredRecurringWindows
- legacy secondaryDays migrate to acceptableRecurringWindows
- temporary windows default empty
- removed V2 windows do not rehydrate from legacy fields
- temporary exceptions reject overlap
- startDate/endDate required

Customer Card:

- V2 recurring and temporary sections render
- temporary exceptions render active/upcoming/history states
- admin can create/edit/cancel exception when implemented
- customer wishes copy does not imply guarantee

Customer Portal:

- customer can create own temporary exception when implemented
- customer cannot edit all permanent preferences in first version
- portal copy clarifies preference vs guarantee

WorkOrderDetails:

- read-only guidance shows recurring/temporary preferences
- active temporary exception warning appears when service date is within exception period
- outside-exception-window warning appears
- no service-row preference link created
- no Booking Queue/occurrence mutation

Add Service Status Preview:

- recurring preferred = Optimal
- recurring acceptable = Acceptable
- outside recurring = Outside preference
- temporary windows ignored for normal Add Service
- non-blocking save

---

# 16. Open ADR decisions and questions

Required ADR decisions before implementation:

1. Temporary exceptions: separate Supabase table vs Customer JSON.
2. Approval policy for customer-created and admin-created temporary exceptions.
3. Active edit policy: whether customers/admins may edit active exceptions or only upcoming ones.
4. Cutoff window before service date.
5. Derived vs stored status for upcoming/active/expired/cancelled state.
6. RLS/permissions for customer/admin/super-admin access.
7. Booking Queue bridge retirement criteria.
8. Minimum validation engine before occurrence writes.

Additional product questions:

9. How should expired/cancelled exceptions be archived/displayed?
10. Should an active exception create a task/notification for admin review?
11. How strictly should package policy limit temporary windows?
12. Should customer communications be automatically suggested when temporary exceptions conflict with booked visits?

---

# 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Customer treats exception as guaranteed. | Use explicit copy: wishes/guidance, not guarantee. |
| Temporary windows are used as permanent availability. | Separate recurring vs temporary model and evaluator logic. |
| Overlapping exceptions cause ambiguity. | Allow only one active/overlapping exception per customer/date range. |
| AI uses temporary flexibility without reason. | Require explicit temporary event/rescheduling reason. |
| Booking Queue becomes stale. | Keep queue sync separate and visible as a known follow-up; do not rely on local fallback. |
| Admin misses active exception. | Surface active exception as read-only guidance on Customer Card and WorkOrderDetails after implementation approval. |
| Service rows move automatically without approval. | First version warnings only; later ScheduleChangeSet/admin approval after validation is approved. |
| Temporary exception writes Mission Log or Time Reporting indirectly. | Treat Mission Log, staff sessions, mission events, time reports, payroll/invoice basis and completed/approved records as out of scope for schedule guidance. |
