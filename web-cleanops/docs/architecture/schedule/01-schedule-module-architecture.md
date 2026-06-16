# Schedule Module Architecture

## Status

Draft v2 for technical review.

Phase 0 cleanup status: target architecture only. This document separates current implementation concepts from future schedule-domain concepts and does not authorize code, migrations, schema changes or runtime behavior changes.

## Owner

Product / Admin Scheduling

## Review Target

RORK

## Related Documents

- `/docs/architecture/schedule/00-schedule-index.md`
- `/docs/architecture/schedule/02-service-level-scheduling-packages.md`
- `/docs/architecture/schedule/03-schedule-module-ux-architecture.md`
- `/docs/architecture/keys/`
- `/docs/dev-center/`
- `/docs/backlog/20-build-backlog.md`

## Scope

Manual scheduling core, deterministic schedule validation, recurring schedule generation, occurrence-level variations, one-off bookings, conflict handling and future AI-assisted scheduling.

Current implementation context:

- Work Orders and WorkOrder service rows are the current service/work planning model.
- WorkOrder service rows are the current closest code model for planned service work.
- Booking Queue is a current business/admin queue snapshot, not final schedule authority.
- Schedule Core and occurrence exceptions are current schedule-adjacent mechanisms.
- Supabase is the source of truth; localStorage is legacy/cache/fallback only.

Target architecture context:

- Assignment, ScheduleSeries, RecurrenceRule, planned ScheduleOccurrence, ScheduleChangeSet, ScheduleLock and StaffAvailability are future target concepts.
- These target concepts remain documentation-only until data authority, ADRs, schema/migration plans and validation are approved.
- This document is not an implementation-ready schema and does not authorize migrations, repository changes, UI implementation or runtime schedule writes.

## Primary Goal

Build a deterministic schedule engine that supports recurring customers, manual admin planning, forward preview, conflict detection, solvable variations, one-off bookings, occurrence-level overrides, schedule history protection and future AI-assisted optimization.

The Schedule Module must work without AI. Many customers will use the system manually, so the core scheduling engine must prevent common human planning mistakes even when AI is disabled.

---

# 1. Purpose

The Schedule Module is the planning layer for CleanOps.

It must support:

- recurring customer assignments
- weekly, biweekly, four-weekly and monthly patterns
- one-off bookings
- extra cleanings
- manual admin scheduling
- drag-and-drop planning
- schedule preview into the future
- conflict detection
- solvable future conflicts
- customer preferences
- approved assignment deviations
- ordinary staff continuity
- substitute staff logic
- occurrence-level variations
- existing AO / assignment variation logic
- schedule history protection
- future AI-assisted scheduling on top of deterministic rules

Core principle:

> The system must not only show whether a time slot is free in the currently viewed week. It must determine whether the slot is safe for the type of booking the admin is trying to create.

---

# 2. Architecture Boundaries

## 2.1 Schedule is planned work

Schedule represents planned future work.

Schedule is not operational truth.

Operational truth belongs to downstream execution systems such as:

- Mission Log
- Check-in/check-out
- Time Reporting
- Payroll Basis
- Invoice Basis
- Incident handling
- Operational deviations

Schedule may generate or update future planned Missions only through approved workflows, but it must not rewrite completed operational history.

Schedule changes may only affect future planned work. Mission Log records, staff sessions, mission events, time reports, payroll/invoice basis and completed or approved records must not be rewritten by schedule changes.

## 2.2 Assignment / AO is the service object

Assignment / AO is target-architecture terminology for the future extracted service-domain object.

In the current app, the closest operational model is the Work Order service row. Future work must explicitly map WorkOrder service rows to Assignment before introducing Assignment as an authority.

Assignment / AO represents what the customer has bought.

Schedule represents when and how the assignment is planned.

Do not model recurring schedule behavior as flat calendar events directly attached to the customer. That will fail when supporting:

- recurring series
- occurrence overrides
- approved deviations
- future preview
- history protection
- AI suggestions
- schedule locking
- one-off vs recurring priority

## 2.3 AI is optional

AI must not be the core scheduling engine.

The deterministic engine must provide:

- recurrence generation
- availability checking
- preference validation
- conflict detection
- conflict classification
- resolution option generation
- schedule change-set validation
- transactional commit
- audit trail

AI may sit on top of this engine to explain, rank, optimize and suggest. AI-generated suggestions must pass the same validation service as manual admin changes.

---

# 3. Core Scheduling Problem

A visible empty slot in one week is not necessarily a recurring available slot.

Example:

```text
Week 3, Monday

08:00-10:00 Customer 1, weekly
10:00-12:00 Customer 2, weekly
12:00-14:00 Empty slot
```

Admin wants to book:

```text
Customer 3
Every Monday
12:00-14:00
```

But in week 6:

```text
12:00-14:00 Customer X, every 4th week
```

The schedule engine must detect this before saving Customer 3 as recurring.

The slot must be classified as one of:

```ts
type SlotAvailability =
  | 'available_now_only'
  | 'available_for_recurring'
  | 'available_with_solvable_variations'
  | 'available_but_requires_admin_decision'
  | 'blocked';
```

A krock is not automatically a blocker. If the conflicting occurrence can be moved within customer preferences, same ordinary staff and valid route/staff availability, the system should classify it as solvable.

---

# 4. Availability States

## 4.1 available_now_only

The slot is free in the visible week, but not safe as a recurring slot.

Suitable for:

- one-off cleaning
- extra cleaning
- temporary booking

Not suitable for:

- new recurring booking without additional review

## 4.2 available_for_recurring

No conflicts exist across the selected preview horizon.

The admin can safely create the recurring booking.

## 4.3 available_with_solvable_variations

Future conflicts exist, but the system found valid occurrence-level variations.

Example:

```text
Customer 3 can be booked every Monday 12:00-14:00.

Week 6 conflicts with Customer X.
Customer X can be moved to Tuesday 13:00-15:00 with the same staff,
within the customer's approved preferences.
```

This requires admin confirmation before commit.

## 4.4 available_but_requires_admin_decision

Potential solutions exist, but the system cannot safely choose one automatically.

Examples:

- several equivalent alternatives
- different staff required
- route impact uncertain
- service-level policy conflict
- cascade risk

## 4.5 blocked

No valid solution exists.

Examples:

- conflicting occurrence is locked
- fixed-time customer cannot move
- same-staff requirement cannot be met
- no valid alternative inside preferences
- movement creates unresolved cascade

---

# 5. Existing AO / Assignment Variation Support

AO already supports variations on an assignment.

Example:

```text
Normal assignment:
Customer has cleaning every Monday 08:00-12:00.

Approved deviation:
Cleaning may happen later, as long as it finishes no later than 15:00.

Actual schedule:
Week 1: 08:00-12:00
Week 2: 08:00-12:00
Week 3: 08:00-12:00
Week 4: 10:30-14:30
```

Schedule architecture should preserve this concept, but separate the model clearly:

```text
Assignment / AO
= what service the customer has bought

Recurring schedule rule
= when the service normally happens

Occurrence
= one specific planned visit on one specific date

Occurrence override / variation
= one specific occurrence has a different time, date, staff, route position or status
```

Rule:

> A variation should usually modify one occurrence, not the whole recurring series.

---

# 6. Recommended Domain Model

The following models are architectural targets only. They are not approved database schemas, migrations, repositories or runtime contracts.

Before implementation, RORK must review current code/data structures and decide what can be adapted vs what should be new through ADRs. Until then, Work Orders, WorkOrder service rows, Booking Queue, Schedule Core and occurrence exceptions remain the current implementation surfaces.

## 6.1 Customer

```ts
type Customer = {
  id: string;
  companyId: string;

  name: string;
  addressId: string;

  status: 'active' | 'paused' | 'ended';

  accessInstructions?: string;
  keyRequired: boolean;

  preferredStaffIds?: string[];
  blockedStaffIds?: string[];
};
```

## 6.2 Assignment / AO

Commercial/service object. Not a calendar event.

```ts
type Assignment = {
  id: string;
  companyId: string;

  customerId: string;

  serviceType:
    | 'home_cleaning'
    | 'deep_cleaning'
    | 'office_cleaning'
    | 'stair_cleaning'
    | 'window_cleaning'
    | string;

  defaultDurationMinutes: number;

  activeFrom: Date;
  activeTo?: Date;

  status: 'active' | 'paused' | 'ended';

  assignmentKind: 'recurring' | 'one_off' | 'extra';

  serviceLevelPackageId?: string;

  notes?: string;
};
```

## 6.3 AssignmentPreference

Defines scheduling limits and approved deviations.

```ts
type AssignmentPreference = {
  id: string;
  companyId: string;

  assignmentId: string;

  allowedWeekdays: Weekday[];

  preferredStartTime?: string;
  preferredEndTime?: string;

  allowedStartTimeFrom?: string;
  allowedStartTimeTo?: string;

  allowedFinishTimeLatest?: string;

  maxDeviationBeforeMinutes?: number;
  maxDeviationAfterMinutes?: number;

  requiresSameStaff: boolean;
  requiresPreferredStaff: boolean;

  allowTemporaryMove: boolean;
  allowDifferentDaySameWeek: boolean;
  allowDifferentStaff: boolean;

  travelSensitivity: 'low' | 'medium' | 'high';

  notes?: string;
};
```

Example:

```text
Normal:
Monday 08:00-12:00

Allowed:
Monday start between 08:00 and 11:00
Latest finish 15:00
Duration must remain 240 minutes
Same staff preferred or required
```

Valid variation:

```text
Monday 10:30-14:30
```

Invalid variation:

```text
Monday 11:30-15:30
```

Reason:

```text
Ends after latest approved finish time.
```

## 6.4 ScheduleSeries

Represents the normal standing schedule pattern.

```ts
type ScheduleSeries = {
  id: string;
  companyId: string;

  assignmentId: string;
  recurrenceRuleId: string;

  defaultWeekday: Weekday;
  defaultStartTime: string;
  defaultEndTime: string;

  defaultStaffIds: string[];

  routeGroupId?: string;
  routePosition?: number;

  startDate: Date;
  endDate?: Date;

  status: 'active' | 'paused' | 'ended';

  createdByUserId: string;

  createdAt: Date;
  updatedAt: Date;
};
```

## 6.5 RecurrenceRule

Supports weekly, biweekly, four-weekly, monthly and later custom patterns.

```ts
type RecurrenceRule = {
  id: string;
  companyId: string;

  frequency:
    | 'weekly'
    | 'biweekly'
    | 'four_weekly'
    | 'monthly'
    | 'custom';

  interval: number;

  weekParity?: 'even' | 'odd';

  cycleAnchorDate?: Date;
  cycleAnchorWeek?: number;
  cycleOffset?: number;

  weekdays: Weekday[];

  monthlyMode?: 'date_of_month' | 'nth_weekday';

  dayOfMonth?: number;

  nthWeekday?: {
    nth: 1 | 2 | 3 | 4 | -1;
    weekday: Weekday;
  };

  timezone: string;
};
```

Important:

> Every-fourth-week customers should not be based only on even/odd week logic.

Use an anchor date or anchor week.

Example:

```text
Customer X:
Every 4th week
Cycle starts week 2
Monday 12:00-14:00
```

This means:

```text
Week 2
Week 6
Week 10
Week 14
...
```

Recommended concept:

```ts
function occursInWeek(rule: RecurrenceRule, date: Date): boolean {
  const weeksSinceAnchor = differenceInCalendarWeeks(
    startOfWeek(date),
    startOfWeek(rule.cycleAnchorDate!)
  );

  return weeksSinceAnchor % rule.interval === 0;
}
```

## 6.6 ScheduleOccurrence

A concrete planned visit generated from a recurring series or created as a one-off.

```ts
type ScheduleOccurrence = {
  id: string;
  companyId: string;

  assignmentId: string;
  scheduleSeriesId?: string;

  occurrenceDate: Date;

  plannedStart: Date;
  plannedEnd: Date;

  staffIds: string[];

  source:
    | 'recurring_generated'
    | 'one_off'
    | 'manual_extra'
    | 'system_generated';

  status:
    | 'planned'
    | 'confirmed'
    | 'completed'
    | 'cancelled'
    | 'moved'
    | 'requires_attention';

  priorityClass:
    | 'locked_recurring'
    | 'fixed_recurring'
    | 'flexible_recurring'
    | 'one_off'
    | 'extra'
    | 'placeholder';

  movable: boolean;
  lockReason?: string;

  isMaterialized: boolean;
  locked: boolean;

  createdAt: Date;
  updatedAt: Date;
};
```

Important distinction:

```text
ScheduleSeries = the rule
ScheduleOccurrence = the specific visit
```

## 6.7 OccurrenceOverride

Occurrence-level change preserving the original series.

```ts
type OccurrenceOverride = {
  id: string;
  companyId: string;

  occurrenceId?: string;
  scheduleSeriesId?: string;

  originalOccurrenceDate: Date;

  overrideDate?: Date;
  overrideStart?: Date;
  overrideEnd?: Date;
  overrideStaffIds?: string[];

  overrideStatus?: 'cancelled' | 'moved' | 'rescheduled';

  reason:
    | 'customer_request'
    | 'staff_absence'
    | 'holiday'
    | 'route_optimization'
    | 'future_conflict_resolution'
    | 'manual_admin_change';

  createdByUserId: string;
  createdAt: Date;
};
```

## 6.8 StaffAvailability

```ts
type StaffAvailability = {
  id: string;
  companyId: string;

  staffId: string;

  weekday: Weekday;

  availableFrom: string;
  availableTo: string;

  validFrom: Date;
  validTo?: Date;
};
```

## 6.9 StaffAbsence

```ts
type StaffAbsence = {
  id: string;
  companyId: string;

  staffId: string;

  startDateTime: Date;
  endDateTime: Date;

  reason: 'sick' | 'vacation' | 'leave' | 'other';

  status: 'planned' | 'confirmed';
};
```

## 6.10 ScheduleLock

```ts
type ScheduleLock = {
  id: string;
  companyId: string;

  occurrenceId: string;

  lockType:
    | 'completed'
    | 'invoiced'
    | 'customer_confirmed'
    | 'admin_locked';

  reason?: string;

  createdByUserId?: string;
  createdAt: Date;
};
```

Rule:

> Never automatically move a locked occurrence.

---

# 7. Generated vs Materialized Schedule

Recommended approach:

```text
Hybrid model
```

Source of truth:

```text
Assignment
+ AssignmentPreference
+ ScheduleSeries
+ RecurrenceRule
+ OccurrenceOverride
+ ScheduleLock
```

Operational schedule cache:

```text
Materialized ScheduleOccurrences
```

## 7.1 Materialization Horizon

Recommended default:

```text
12 weeks ahead
```

Optional for larger planning:

```text
26 weeks ahead
```

The system should still be able to calculate beyond the materialized range on demand.

## 7.2 On-Demand Preview

When admin attempts to create or move a recurring schedule, the system should run an on-demand preview.

```ts
previewRecurringPlacement({
  assignmentId,
  staffIds,
  weekday: 'monday',
  startTime: '12:00',
  endTime: '14:00',
  recurrence: 'weekly',
  startDate,
  horizonWeeks: 12
});
```

Preview should not write anything.

It should return:

```ts
type PreviewRecurringPlacementResult = {
  status: 'safe' | 'solvable' | 'needs_admin_decision' | 'blocked';
  occurrences: PreviewOccurrence[];
  conflicts: Conflict[];
  proposedResolutions: ResolutionOption[];
};
```

---

# 8. Preview Horizon

Recommended presets:

```text
4 weeks
8 weeks
12 weeks
26 weeks
52 weeks
```

Default recommendation:

```text
12 weeks for normal weekly / biweekly recurring booking
26 weeks for every-fourth-week and monthly customers
```

Reason:

A 4-week preview may miss monthly and every-fourth-week patterns depending on the start week.

---

# 9. Conflict Model

Conflicts should be structured domain objects, not strings.

```ts
type Conflict = {
  id: string;
  companyId: string;

  candidateOccurrence: PreviewOccurrence;
  conflictingOccurrence: ScheduleOccurrence;

  conflictType:
    | 'time_overlap'
    | 'staff_unavailable'
    | 'customer_preference_violation'
    | 'service_level_violation'
    | 'travel_time_violation'
    | 'double_booking'
    | 'holiday'
    | 'capacity_exceeded'
    | 'locked_occurrence'
    | 'required_staff_missing'
    | 'key_access_risk';

  severity:
    | 'info'
    | 'warning'
    | 'requires_decision'
    | 'blocking';

  canBeResolvedAutomatically: boolean;

  resolutionOptions: ResolutionOption[];
};
```

---

# 10. Resolution Options

When a future conflict is found, the system should attempt to find valid solutions.

```ts
type ResolutionOption = {
  id: string;
  companyId: string;

  conflictId: string;

  action:
    | 'move_conflicting_occurrence'
    | 'move_candidate_occurrence'
    | 'change_staff'
    | 'change_route_position'
    | 'cancel_one_off'
    | 'ask_admin';

  targetOccurrenceId?: string;

  newDate?: Date;
  newStart?: Date;
  newEnd?: Date;
  newStaffIds?: string[];

  keepsSameStaff: boolean;
  withinCustomerPreferences: boolean;
  satisfiesServiceLevel: boolean;
  travelTimeOk: boolean;
  keyAccessOk?: boolean;
  affectsOtherOccurrences: boolean;

  score: number;

  explanation: string;
};
```

Resolution preference order:

1. Same day, same staff, different time.
2. Same week, same staff, allowed different day.
3. Same day, approved substitute staff.
4. Same week, approved substitute staff.
5. Move one-off assignment instead.
6. Ask admin.

Prefer:

- same customer preference
- same staff
- same substitute pool
- same day
- minimal time movement
- minimal route impact
- no cascade
- lower-priority assignment absorbs movement

---

# 11. Priority Model

Default priority order:

```text
1. Locked recurring assignments
2. Fixed-time recurring assignments
3. Contracted recurring assignments with strict service level
4. Recurring assignments with flexible preferences
5. Moved recurring occurrences
6. One-off assignments
7. Extra cleaning
8. Internal/admin placeholders
```

Service Level Packages may modify priority. See `02-service-level-scheduling-packages.md`.

General rule:

> Recurring assignments should normally beat one-off assignments, but not all recurring assignments have the same priority.

---

# 12. Schedule Change Sets

Preview should create a proposed change set.

Nothing should be written until admin confirms.

```ts
type ScheduleChangeSet = {
  id: string;
  companyId: string;

  createdByUserId: string;

  status: 'draft' | 'confirmed' | 'discarded';

  actions: ScheduleChangeAction[];

  validationResult: ScheduleValidationResult;

  createdAt: Date;
};
```

Possible actions:

```ts
type ScheduleChangeAction =
  | CreateScheduleSeriesAction
  | CreateOccurrenceOverrideAction
  | MoveOccurrenceAction
  | CancelOccurrenceAction
  | AssignStaffAction;
```

Commit rule:

```text
Either all changes are saved,
or none are saved.
```

No partial schedule updates.

---

# 13. Validation Engine

The schedule module needs a reusable validation engine.

It should run when:

- admin creates recurring schedule
- admin moves a booking
- admin adds one-off assignment
- admin changes staff
- admin changes customer preference
- admin changes recurrence rule
- staff absence is registered
- holiday affects schedule
- drag-and-drop placement is attempted
- AI proposes optimization

Recommended function:

```ts
validateScheduleChange(changeSet, options);
```

Example:

```ts
const result = validateScheduleChange(changeSet, {
  horizonWeeks: 12,
  allowAutoResolution: true,
  includeTravelTime: true,
  includeCustomerPreferences: true,
  includeServiceLevelPolicies: true,
  includeStaffAvailability: true,
  includeKeyAccessRisk: true
});
```

Return:

```ts
type ScheduleValidationResult = {
  status:
    | 'valid'
    | 'valid_with_warnings'
    | 'requires_decision'
    | 'invalid';

  conflicts: Conflict[];
  warnings: Warning[];
  proposedResolutions: ResolutionOption[];

  summary: {
    checkedOccurrences: number;
    conflictCount: number;
    autoResolvableCount: number;
    blockingCount: number;
  };
};
```

---

# 14. Conflict Resolution Algorithm

High-level flow:

```ts
function previewRecurringPlacement(candidate, horizonWeeks) {
  const candidateOccurrences = generateOccurrences(candidate, horizonWeeks);

  const existingOccurrences = loadRelevantOccurrences({
    dateRange: candidateOccurrences.dateRange,
    staffIds: candidate.staffIds,
    routeGroupId: candidate.routeGroupId,
    includeRecurring: true,
    includeOneOff: true,
    includeOverrides: true
  });

  const conflicts = [];

  for (const candidateOccurrence of candidateOccurrences) {
    const overlaps = findOverlappingOccurrences(
      candidateOccurrence,
      existingOccurrences
    );

    for (const overlap of overlaps) {
      const conflict = classifyConflict(candidateOccurrence, overlap);

      if (conflict.canPossiblyBeResolved) {
        conflict.resolutionOptions = findResolutionOptions(conflict);
      }

      conflicts.push(conflict);
    }
  }

  return classifyPreviewResult(conflicts);
}
```

## 14.1 Avoid uncontrolled cascade

Automatic resolution must be limited.

MVP recommendation:

```text
Maximum cascade depth = 1
```

If moving Customer X creates a new conflict with Customer Y:

```text
Status = requires_admin_decision
```

Do not let the system silently rearrange half the week.

---

# 15. Staff Availability and Absence

Staff availability should be validated separately from customer preferences.

When staff absence is added, the system should identify affected bookings:

```text
Anna sick Tuesday.

Affected bookings:
- Customer 4 Tuesday 08:00-10:00
- Customer 5 Tuesday 10:30-13:30
```

Then it can suggest:

- move to another approved staff member
- move to another day within preferences
- use approved substitute pool
- requires admin action

Service-level policies may restrict substitute options.

---

# 16. Route and Travel Time

Even if calendar time fits, the route may not.

The validation engine should eventually consider:

- customer address
- staff starting location
- previous occurrence
- next occurrence
- travel buffer
- area / route group

Basic model:

```ts
type RouteValidation = {
  previousOccurrenceId?: string;
  nextOccurrenceId?: string;

  travelFromPreviousMinutes?: number;
  travelToNextMinutes?: number;

  requiredBufferMinutes: number;

  valid: boolean;
};
```

MVP can use simple buffers:

```text
Same area: 10 minutes
Default buffer: 15 minutes
Different area: 30 minutes
```

Later, this can be replaced by real routing.

---

# 17. One-Off Bookings

One-off bookings should be easy to create, but they should not silently consume recurring capacity.

When admin books a one-off assignment into a slot, the system should be able to show:

```text
This slot is free for this date.
However, this time may be part of a recurring available pattern.
Do you want to reserve it for a one-off job?
```

One-off assignments should generally have lower priority than recurring assignments.

If a future recurring booking needs that slot, the one-off should be easier to move unless locked or customer-confirmed.

---

# 18. Series Changes and History Protection

Changing a recurring schedule must not rewrite history.

Example:

```text
Customer has weekly cleaning Monday 08:00-12:00.
Admin changes future schedule to Thursday 10:00-14:00.
```

Expected behavior:

```text
Past occurrences stay as they were.
Future occurrences change.
Completed occurrences stay locked.
```

UI should ask:

```text
Apply change to:
- This occurrence only
- This and future occurrences
- Entire series
```

Even "entire series" should not modify completed, invoiced or locked history.

Recommended write model for future pattern change:

```text
End old ScheduleSeries at effective date.
Create new ScheduleSeries from effective date.
Keep history untouched.
Materialize future occurrences.
Audit log.
```

---

# 19. Drag-and-Drop Integration

Drag-and-drop is a UX interaction, not a validation bypass.

When an assignment card is dropped into a schedule cell or timeline slot:

1. Create draft change set.
2. Validate schedule change.
3. Show result to admin if warning/decision/blocking state exists.
4. Commit only after valid confirmation.

Recurring assignments must not silently commit based only on current visible week.

---

# 20. AI-Assisted Scheduling Boundary

AI may help with:

- suggesting best placement
- explaining conflicts
- ranking resolution options
- finding better weekly distribution
- detecting overloaded employees
- detecting inefficient routes
- predicting planning risk
- summarizing why a slot is or is not safe

AI must not bypass:

- recurrence generation
- service-level policy
- customer preferences
- staff availability
- locks
- conflict validation
- key/access requirements
- admin confirmation for risky changes

AI should use the same APIs as the manual UI:

```text
previewRecurringPlacement
validateScheduleChange
findResolutionOptions
commitScheduleChangeSet
```

AI can rank and explain, but the deterministic engine decides validity.

---

# 21. Write Rules

## 21.1 Creating a recurring booking

Write:

- ScheduleSeries
- RecurrenceRule
- Materialized occurrences for horizon
- Occurrence overrides for accepted future variations
- Audit log

## 21.2 Moving one occurrence

Write:

- OccurrenceOverride
- Updated materialized occurrence
- Audit log

Do not change the recurring series.

## 21.3 Moving future recurring pattern

Write:

- End old ScheduleSeries at effective date
- Create new ScheduleSeries from effective date
- Keep history untouched
- Materialize future occurrences
- Audit log

---

# 22. Example Scenario: Visible Free Slot with Hidden Future Conflict

Visible week:

```text
Week 3 Monday

08:00-10:00 Customer 1, weekly
10:00-12:00 Customer 2, weekly
12:00-14:00 Empty
```

Hidden future booking:

```text
Week 6 Monday

12:00-14:00 Customer X, every 4th week
```

Admin tries to book:

```text
Customer 3
Weekly
Monday 12:00-14:00
Staff: Anna
```

System preview:

```text
Week 3: free
Week 4: free
Week 5: free
Week 6: conflict with Customer X
Week 7: free
Week 8: free
Week 9: free
Week 10: conflict with Customer X
```

System checks Customer X preferences:

```text
Customer X allows:
Monday or Tuesday
Start between 10:00 and 14:00
Latest finish 16:00
Same staff required
```

System checks Anna availability:

```text
Week 6 Tuesday 13:00-15:00 available
Week 10 Tuesday 13:00-15:00 available
```

Result:

```text
Status: available_with_solvable_variations
```

System proposal:

```text
Create Customer 3 weekly Monday 12:00-14:00.

Create planned variations:
- Week 6: Move Customer X to Tuesday 13:00-15:00
- Week 10: Move Customer X to Tuesday 13:00-15:00
```

Admin sees:

```text
This slot is not purely free, but it can be used safely.
Future conflicts can be solved within customer preferences using ordinary staff.
```

---


---

# 23. Customer Preferences, Temporary Exceptions and Planning Inputs

Detailed customer scheduling preference semantics are defined in `/docs/architecture/schedule/04-customer-scheduling-preferences-and-temporary-exceptions.md`.

Temporary Scheduling Exceptions are warning/guidance only for now. They must not create occurrence exceptions, move WorkOrder service rows, write Booking Queue, mutate recurring series, affect Mission Log or affect Time Reporting.

Temporary Scheduling Exceptions may be read as planning context only. They are not schedule authority, not an occurrence-write instruction and not permission to mutate AO/service-row lifecycle state.

The schedule engine must treat customer preferences as validation inputs and explanation context, not as automatic write triggers.

Key rules:

1. Preferred recurring cleaning times are the strongest positive signal for permanent recurring schedules.
2. Acceptable recurring cleaning times are valid but lower-priority permanent alternatives.
3. Acceptable temporary cleaning times are only valid when there is an explicit temporary rescheduling context.
4. Temporary scheduling exceptions are date-bound wishes/guidance, not delivery guarantees.
5. Active temporary exceptions may create warnings for affected service rows, but must not automatically move bookings.
6. Normal Add Service must not use temporary windows unless the action is explicitly a temporary reschedule.
7. Customer preferences and temporary exceptions must pass through the deterministic validation engine before any future automated schedule change.

Temporary Scheduling Exceptions may later become inputs to `ScheduleChangeSet` generation, occurrence override proposals and AI explanation, but first implementation should show warnings/planning guidance only.

---

# 24. Planning Mode and Draft Change Sets

Planning Mode / Utkastläge is defined in `/docs/architecture/schedule/05-schedule-planning-mode-capacity-compression-and-decision-learning.md`.

Planning Mode and persistent ScheduleChangeSet remain documentation-only until ADR approval. The first approved implementation may start as UI-only draft state if that is selected later.

Planning Mode, compression, AI scheduling, ScheduleSeries / RecurrenceRule / ScheduleOccurrence schema and persistent ScheduleChangeSet must not be implemented until AO/service-row data authority and the required ADRs are approved.

Planning Mode extends the target `ScheduleChangeSet` concept:

- admins may draft several schedule changes before commit
- drag-and-drop should create draft actions, not silent commits
- reason capture should happen during publish/review, not on every small drag
- only reviewed/published changes should become AI-learning signals
- the publish step should validate all proposed changes as one deterministic unit

This preserves the existing architecture rule:

> Either all changes are saved, or none are saved.

Planning Mode must not bypass schedule locks, customer preferences, service-level policy, KEYS/access constraints or operational history protection.

Planning Mode must not use Booking Queue as sole authority while Booking Queue remains mixed/mirror-based with a temporary bridge. The local Booking Queue backout bridge must remain off unless explicitly reviewed, and clean Supabase empty reads must remain empty.

---

# 25. Capacity Analytics and Schedule Compression Boundary

Capacity analytics and schedule compression are defined in `/docs/architecture/schedule/05-schedule-planning-mode-capacity-compression-and-decision-learning.md`.

The schedule engine should distinguish:

```text
free time != bookable time
```

Bookable capacity depends on assignment duration, travel time, employee availability, customer preference windows, service-level policy, keys/access, route constraints and break rules.

Schedule Compression Mode creates draft scenarios such as:

- release staff day
- holiday compression
- merge sparse schedule
- create standby capacity
- increase bookable gaps

Compression scenarios must be validated as `ScheduleChangeSet` drafts before commit after those concepts are approved. They must not directly rewrite occurrences, Booking Queue, recurring series, Mission Log, Time Reporting, payroll/invoice basis or completed/approved execution records.

Future implementation direction, subject to ADR approval:

- compression proposals should remain scenario/preview-only first
- if later committed, compression should initially create only explicitly approved temporary occurrence overrides
- future recurring-series changes require explicit separate approval
- AI may rank/explain scenarios but cannot auto-commit them

---

# 26. AI Decision Learning Boundary

AI scheduling and AI decision learning are separate concepts.

Audit logging of actual published schedule changes is always required.

AI decision learning should be:

- opt-in per company
- tenant-local by default in MVP
- based on reviewed/published decisions, not every draft drag operation
- based on structured reason codes, not raw free-text notes by default

AI must not use free-text notes for learning unless a future explicit opt-in and privacy review approves it.

AI must not treat customer wishes as guarantees.

---

# 27. MVP Recommendation

Prioritize safety, clarity and correct data modeling.

MVP must include:

1. Recurring schedule series.
2. Occurrence generation.
3. Occurrence overrides / variations.
4. Weekly, biweekly and four-weekly recurrence.
5. Preview 4/8/12/26 weeks.
6. Conflict detection.
7. Customer preference validation.
8. Staff availability validation.
9. Basic service-level policy hook.
10. Simple priority model.
11. Manual confirmation before committing changes.
12. Audit log.
13. Drag-and-drop validation boundary.

MVP should avoid:

1. Full automatic route optimization.
2. Deep cascade rescheduling.
3. AI-dependent scheduling.
4. Silent automatic movement of multiple customers.
5. Complex monthly edge cases before weekly/four-weekly is stable.

---

# 28. Suggested Implementation Phases

## Phase 1 - Discovery and mapping

- Map existing AO/assignment variation behavior.
- Map current schedule/calendar concepts.
- Map current customer, employee and assignment models.
- Identify current local/Supabase ownership for scheduling data.
- Report conflicts before schema changes.

## Phase 2 - Data model foundation

Documentation-only until ADR approval. Build or adapt only after data authority and migrations are approved:

- Assignment scheduling fields
- AssignmentPreference
- ScheduleSeries
- RecurrenceRule
- ScheduleOccurrence
- OccurrenceOverride
- StaffAvailability
- StaffAbsence
- ScheduleLock
- AuditLog

## Phase 3 - Recurrence generation

Implement:

- weekly
- biweekly even/odd
- four-weekly with anchor date
- monthly basic if needed
- generateOccurrences(series, dateRange)
- applyOverrides(occurrences, overrides)

## Phase 4 - Preview and validation engine

Implement:

- previewRecurringPlacement()
- validateScheduleChange()
- conflict model
- availability classification

## Phase 5 - Resolution suggestions

Implement simple valid moves:

- same staff
- same week
- within customer preference
- no new conflict
- no cascade beyond MVP limit

## Phase 6 - Commit change set

Documentation-only until ADR approval. Implement only after draft/publish authority and validation are approved:

- draft change set
- admin confirmation
- transactional commit
- audit log
- materialized occurrence update

## Phase 7 - UX integration

Integrate with `03-schedule-module-ux-architecture.md`.

## Phase 8 - AI assisted scheduling

Add AI on top of deterministic APIs only after manual scheduling is stable.

---

# 29. Review Questions for RORK

Please review with focus on:

1. How this should connect to existing AO / assignment variation functionality.
2. Whether current data structures already support any proposed concepts.
3. Whether ScheduleSeries, RecurrenceRule, Occurrence and Override should be new tables or adapted from existing models.
4. How materialized occurrences should be generated and stored.
5. How far ahead occurrences should be materialized by default.
6. How schedule locks interact with completed missions, invoicing and payroll.
7. How KEYS/access readiness should be triggered from schedule changes.
8. How service-level policy should be injected into validation.
9. Which parts are required before any UI scheduling work starts.
10. Which parts should be represented in Development Center and backlog.
11. Which scope should be excluded from MVP.

RORK should return a technical review and implementation plan before coding begins.
