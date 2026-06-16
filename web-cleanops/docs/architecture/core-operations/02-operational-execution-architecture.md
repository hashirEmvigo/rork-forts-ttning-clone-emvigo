# Rork Prompt: CleanOps Operational Execution Architecture

We need to design and implement a new operational architecture inside the existing CleanOps Vite + React web application.

This is not a separate app project.

Use the current CleanOps codebase patterns:

* Vite + React
* TypeScript
* Existing pages/components structure
* Existing repository/data layer patterns
* Supabase-ready schema and migrations
* Company-scoped data
* Feature flags / entitlements
* Settings-driven configuration
* Development Center tracking
* Clear separation between UI, domain logic, repositories and data models

Before coding, inspect the current codebase and identify the relevant existing patterns for:

* Booking Queue
* Schedule
* Work Orders
* Customers
* Employees
* Settings
* Entitlements / packages / feature flags
* Development Center
* Supabase migration conventions
* Repository/data access conventions
* Existing type definitions

Do not implement everything in one uncontrolled pass.

Start with an architecture pass and a safe minimal foundation.

---

# 1. High-Level Product Architecture

We are separating operational execution into several distinct modules.

Core modules:

```ts
mission_log
time_reporting
```

Optional add-on modules:

```ts
operational_flags
notification_center
incident_management
action_center
time_quality_analytics
payroll_basis
invoice_basis
```

The key separation is:

```txt
Schedule = planned work
Booking Queue = business / administrative booking status
Mission Log = actual execution ledger
Time Reporting = approval, adjustment and time classification workspace
Payroll Basis = approved payroll output
Invoice Basis = approved invoice/customer-billing output
Notification Center = outbound messages
Incident Management = formal case handling
Action Center = decision/action queue
Operational Flags = visible operational risk indicators
Time Quality Analytics = booked-time accuracy and pattern analysis
```

Important:

* Mission Log and Time Reporting must be treated as separate modules.
* Mission Log records what happened.
* Time Reporting decides how time should be approved and classified.
* Time Reporting must have its own page and workflow.
* Time Reporting must not be only a tab inside Mission Log.

Schedule boundary:

* Schedule changes may affect only future planned work.
* Schedule changes must not rewrite completed, approved, invoiced, payroll-linked or execution-linked history.
* Schedule work must not mutate mission logs, mission staff sessions, mission events, time reports, payroll basis or invoice basis.
* Operational corrections must use a separate explicit correction workflow, not schedule mutation.
* Booking Queue is not final schedule authority and must not be used as the sole authority for Mission Log or Time Reporting.

---

# 2. Non-Negotiable System Rules

These rules must be respected across the architecture.

```txt
Mission Log must not automatically mutate Schedule during the workday.
Schedule remains planned work and must not rewrite execution history.
Mission Log becomes the execution source of truth.
Time Reporting becomes the approval and classification workspace.
Payroll Basis consumes approved payroll-relevant time.
Invoice Basis consumes approved billable/customer-relevant time.
The customer time bank must only be affected by Invoice Basis, not directly by Mission Log or Time Reporting.
Mission Log must not directly send customer notifications.
Mission Log must not directly create payroll payouts.
Mission Log must not directly create invoices.
Notification Center consumes events and sends messages.
Incident Management consumes events and creates formal cases.
Action Center consumes events and creates decision tasks.
Operational Flags consumes events and displays risk/status indicators.
Time Quality Analytics consumes booked-time rating data and provides analysis.
```

---

# 3. Entitlements / Feature Keys

Each major module or add-on must be controllable through company-level entitlements.

Use these feature keys:

```ts
type FeatureKey =
  | "mission_log"
  | "time_reporting"
  | "operational_flags"
  | "notification_center"
  | "incident_management"
  | "action_center"
  | "time_quality_analytics"
  | "payroll_basis"
  | "invoice_basis";
```

Entitlement state:

```ts
type EntitlementState = "active" | "trial" | "inactive";
```

Recommended type:

```ts
interface CompanyFeatureEntitlement {
  id: string;
  companyId: string;
  featureKey: FeatureKey;
  state: EntitlementState;
  trialStartedAt?: string;
  trialEndsAt?: string;
  activatedAt?: string;
  deactivatedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

Use one shared helper:

```ts
export function hasFeature(
  entitlements: CompanyFeatureEntitlement[],
  featureKey: FeatureKey
): boolean {
  const entitlement = entitlements.find((item) => item.featureKey === featureKey);
  return entitlement?.state === "active" || entitlement?.state === "trial";
}
```

Expected behavior:

* If `mission_log` is inactive, Mission Log UI is locked/hidden.
* If `time_reporting` is inactive, Time Reporting UI is locked/hidden.
* If add-ons are inactive, core source events may still exist, but premium UI/actions must be hidden or locked.
* Add-ons should support active / trial / inactive.
* Settings should expose configuration only for enabled or trial features, unless showing a locked upgrade state.

---

# 4. Recommended File Structure

Use the existing Vite + React structure and adapt names if the codebase already has a preferred convention.

Recommended pages:

```txt
src/pages/admin/MissionLog.tsx
src/pages/admin/TimeReporting.tsx
src/pages/admin/ActionCenter.tsx
src/pages/admin/NotificationCenter.tsx
src/pages/admin/Incidents.tsx
src/pages/admin/TimeQualityAnalytics.tsx
```

Recommended components:

```txt
src/components/mission-log/
src/components/mission-log/MissionLogDashboard.tsx
src/components/mission-log/MissionLogList.tsx
src/components/mission-log/MissionLogDetailDrawer.tsx
src/components/mission-log/MissionStatusBadge.tsx
src/components/mission-log/DelayProjectionPanel.tsx
src/components/mission-log/BookedTimeRatingForm.tsx
src/components/mission-log/BookedTimeRatingBadge.tsx
src/components/mission-log/MissionEventTimeline.tsx

src/components/time-reporting/
src/components/time-reporting/TimeReportingDashboard.tsx
src/components/time-reporting/TimeReportQueue.tsx
src/components/time-reporting/TimeReportTable.tsx
src/components/time-reporting/TimeReportDetailDrawer.tsx
src/components/time-reporting/TimeAllocationEditor.tsx
src/components/time-reporting/TimeReportBulkActions.tsx
src/components/time-reporting/TimeReportMessageThread.tsx
src/components/time-reporting/TimeReportStatusBadge.tsx
src/components/time-reporting/TimeReportFilters.tsx

src/components/action-center/
src/components/action-center/ActionCenterDashboard.tsx
src/components/action-center/ActionItemList.tsx
src/components/action-center/ActionItemDetailDrawer.tsx

src/components/notifications/
src/components/notifications/NotificationCenterPanel.tsx
src/components/notifications/NotificationSettingsPanel.tsx
src/components/notifications/NotificationDeliveryLog.tsx

src/components/incidents/
src/components/incidents/IncidentList.tsx
src/components/incidents/IncidentDetailDrawer.tsx
src/components/incidents/IncidentTimeline.tsx

src/components/time-quality/
src/components/time-quality/TimeQualityDashboard.tsx
src/components/time-quality/CustomerTimeFitView.tsx
src/components/time-quality/EmployeeTimePatternView.tsx
src/components/time-quality/CustomerEmployeeComparisonView.tsx
src/components/time-quality/ReasonCodeStatsView.tsx
src/components/time-quality/TimeQualityFilters.tsx
```

Recommended repositories:

```txt
src/lib/data/missionLogRepository.ts
src/lib/data/timeReportingRepository.ts
src/lib/data/actionCenterRepository.ts
src/lib/data/notificationRepository.ts
src/lib/data/incidentRepository.ts
src/lib/data/timeQualityRepository.ts
```

Recommended domain files:

```txt
src/lib/domain/missionLogRules.ts
src/lib/domain/missionLogEvents.ts
src/lib/domain/delayProjection.ts
src/lib/domain/timeReportingRules.ts
src/lib/domain/timeAllocationRules.ts
src/lib/domain/timeQualityRules.ts
src/lib/domain/timeQualityAnalytics.ts
src/lib/domain/featureEntitlements.ts
```

Recommended types:

```txt
src/types/missionLog.ts
src/types/timeReporting.ts
src/types/actionCenter.ts
src/types/notifications.ts
src/types/incidents.ts
src/types/timeQuality.ts
src/types/entitlements.ts
```

Recommended migrations:

```txt
supabase/migrations/xxxx_mission_log_core.sql
supabase/migrations/xxxx_time_reporting.sql
supabase/migrations/xxxx_time_allocations.sql
supabase/migrations/xxxx_action_center.sql
supabase/migrations/xxxx_notifications.sql
supabase/migrations/xxxx_incidents.sql
supabase/migrations/xxxx_time_quality_analytics.sql
```

---

# 5. Mission Log Module

## 5.1 Purpose

Mission Log is the operational execution ledger.

It answers:

* What was planned?
* What actually happened?
* Who was assigned?
* Who checked in?
* Who checked out?
* Was GPS or QR verification successful?
* Was the mission delayed?
* Did this mission affect later missions?
* Did the customer time window risk being breached?
* What events happened during the mission?
* What basic execution data should feed Time Reporting?

Mission Log is operational and event-driven.

It should support:

* Today’s missions
* Live mission status
* Completed mission history
* Check-in/check-out sessions
* GPS/QR verification state
* Delay projection
* Chain delay detection
* Customer time window breach risk
* Basic mission-level deviations
* Event timeline
* Link to Time Reporting
* Link to Customer Card
* Link to Employee Card
* Link to Work Order / Booking

Mission Log must not become the financial approval workspace.

That belongs to Time Reporting.

---

## 5.2 Mission Log Data Model

One Mission Log Entry represents one planned booking occurrence / mission.

```ts
type MissionStatus =
  | "scheduled"
  | "not_started"
  | "in_progress"
  | "completed"
  | "missed"
  | "cancelled"
  | "requires_attention";

type DelayStatus =
  | "on_time"
  | "late_check_in"
  | "over_time"
  | "early_finish"
  | "estimated_delay"
  | "chain_delay_risk"
  | "time_window_breach_risk"
  | "critical_delay";

interface MissionLogEntry {
  id: string;
  companyId: string;

  bookingId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;

  customerId: string;
  customerNameSnapshot: string;
  customerAddressSnapshot: string;

  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledDurationMinutes: number;

  actualStartTime?: string;
  actualEndTime?: string;
  actualDurationMinutes?: number;

  projectedStartTime?: string;
  projectedEndTime?: string;
  projectedDelayMinutes?: number;

  approvedCustomerTimeWindowStart?: string;
  approvedCustomerTimeWindowEnd?: string;
  hasStrictTimeWindow: boolean;

  missionStatus: MissionStatus;
  delayStatus: DelayStatus;

  timeReportId?: string;
  timeReportStatus?: TimeReportStatus;

  requiresAdminReview: boolean;
  reviewReasonCodes: string[];

  createdAt: string;
  updatedAt: string;
}
```

---

## 5.3 Mission Staff Sessions

Check-in/check-out must be stored per employee.

This is required because one employee can be on time while another is late.

```ts
type CheckMethod = "gps" | "qr" | "manual" | "missing";

type LocationVerificationStatus =
  | "verified"
  | "warning"
  | "failed"
  | "not_required"
  | "missing";

type StaffSessionStatus =
  | "scheduled"
  | "checked_in"
  | "checked_out"
  | "missing_check_in"
  | "missing_check_out"
  | "manual_review_required";

interface MissionStaffSession {
  id: string;
  companyId: string;
  missionLogEntryId: string;

  employeeId: string;
  employeeNameSnapshot: string;

  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledDurationMinutes: number;

  actualCheckInTime?: string;
  actualCheckOutTime?: string;
  actualDurationMinutes?: number;

  checkInMethod: CheckMethod;
  checkOutMethod: CheckMethod;

  checkInLocationStatus: LocationVerificationStatus;
  checkOutLocationStatus: LocationVerificationStatus;

  checkInLatitude?: number;
  checkInLongitude?: number;
  checkOutLatitude?: number;
  checkOutLongitude?: number;

  qrCheckInCodeId?: string;
  qrCheckOutCodeId?: string;

  status: StaffSessionStatus;

  createdAt: string;
  updatedAt: string;
}
```

---

## 5.4 Mission Events

Mission Log must be event-driven.

Every important operational action should create an immutable event.

```ts
type MissionEventType =
  | "mission_created"
  | "mission_started"
  | "mission_completed"
  | "employee_checked_in"
  | "employee_checked_out"
  | "employee_late_check_in"
  | "missing_check_in"
  | "missing_check_out"
  | "gps_verification_failed"
  | "qr_verification_failed"
  | "estimated_delay_detected"
  | "chain_delay_detected"
  | "time_window_breach_risk_detected"
  | "employee_delay_confirmation_requested"
  | "employee_delay_confirmed"
  | "employee_delay_rejected"
  | "customer_delay_update_recommended"
  | "customer_delay_update_sent"
  | "admin_alert_created"
  | "time_report_created"
  | "booked_time_rating_submitted"
  | "low_booked_time_rating_detected"
  | "critical_booked_time_rating_detected";

interface MissionLogEvent {
  id: string;
  companyId: string;
  missionLogEntryId: string;

  eventType: MissionEventType;

  actorType: "system" | "employee" | "admin" | "customer";
  actorId?: string;

  payload: Record<string, unknown>;

  correlationId?: string;
  idempotencyKey?: string;
  schemaVersion: number;

  occurredAt: string;
  createdAt: string;
}
```

---

# 6. Mission Log UI

Mission Log should feel like an operational control center, not a passive table.

Recommended layout:

```txt
Top area:
- Title
- Date navigation
- Search
- Filters
- Export/report button later

Dashboard cards:
- Total missions today
- Not started
- In progress
- Completed
- Delayed
- Requires attention
- Pending time reports
- Low booked-time ratings

Deviation summary:
- Group active deviations by category and severity
- Do not show one giant unstructured alert list
```

## 6.1 Date Navigation

Add simple date navigation:

```txt
[ < ] Today, May 15, 2025 [ > ]
```

Rules:

* Left arrow moves one day back.
* Right arrow moves one day forward only up to today.
* Never navigate to future missions in Mission Log.
* Date filter can open a more advanced date filter drawer/popup.
* For future planned work, use Schedule, not Mission Log.

---

## 6.2 Mission Log Tabs

Recommended tabs:

```txt
Overview
Live Missions
Upcoming Today
Deviations
History
```

Important:

* Live Missions = ongoing missions only.
* There must be a fast way to show upcoming missions later today.
* Use “Upcoming Today” as a separate tab or button.
* Do not mix all future scheduled work into Live Missions.

---

## 6.3 Active Deviations Panel

Critical customer time-window alerts are good, but deviations must be categorized.

There may be 10+ active deviations at the same time.

Use grouped deviation categories:

```txt
Critical
High
Warning
Info
```

Or by type:

```txt
Time Window
Missing Check-in/out
Delay / Chain Delay
GPS / QR
Time Reporting
Customer Impact
```

Each group should show count and allow expanding.

Example:

```txt
Active Deviations
- Critical: 2
- High: 4
- Warning: 10
```

Each deviation row should support:

* Open Mission
* Contact Employee
* Notify Customer, if Notification Center is active
* Create Action, if Action Center is active
* Create Incident, if Incident Management is active
* Mark handled

---

## 6.4 Team and Location Filters

Admins must be able to filter by team.

Company admins must be able to filter or browse by location/city/branch.

Add filters:

```txt
Team
Location / City / Branch
Employee
Customer
Mission status
Deviation type
Time report status
```

Expected behavior:

* Admin can search or filter by assigned team.
* Company admin can switch/browse locations.
* Filter drawer should include team and location.
* Main toolbar may expose Team and Location as primary filters if heavily used.

---

# 7. Delay Projection

Mission Log should calculate operational forecasts without changing Schedule.

Example:

Mission 1 has two employees.

* Employee A arrives on time.
* Employee B is 20 minutes late.
* Lost capacity = 20 employee-minutes.
* Team size = 2.
* Estimated mission delay = 20 / 2 = 10 minutes.

Recommended domain function:

```ts
export function calculateMissionDelay(input: {
  plannedTeamSize: number;
  lateEmployeeMinutes: number[];
  currentActualProgressMinutes?: number;
  scheduledDurationMinutes: number;
}): number {
  const totalLostStaffMinutes = input.lateEmployeeMinutes.reduce(
    (sum, minutes) => sum + minutes,
    0
  );

  const effectiveTeamSize = Math.max(input.plannedTeamSize, 1);

  return Math.ceil(totalLostStaffMinutes / effectiveTeamSize);
}
```

Downstream projection:

```ts
export function projectDownstreamMissions(params: {
  missions: MissionLogEntry[];
  currentMissionId: string;
  currentMissionProjectedDelayMinutes: number;
  travelBufferMinutesByMissionId: Record<string, number>;
}): MissionLogEntry[] {
  // Do not mutate Schedule.
  // Only calculate projectedStartTime, projectedEndTime and projectedDelayMinutes
  // for Mission Log entries.
  return params.missions;
}
```

---

# 8. Employee Delay Confirmation

When Mission Log detects that a later mission may start late, ask employees to confirm.

Example:

```txt
Will you be approximately 10 minutes late to the next mission?
```

Allowed responses:

```ts
type DelayConfirmationResponse =
  | "yes"
  | "no"
  | "not_sure";

type DelayRecoveryReason =
  | "we_can_catch_up"
  | "we_will_skip_break"
  | "current_customer_finished_early"
  | "extra_staff_helping"
  | "other";
```

Payload:

```ts
interface DelayConfirmationPayload {
  missionLogEntryId: string;
  nextMissionLogEntryId: string;
  employeeId: string;
  response: DelayConfirmationResponse;
  recoveryReason?: DelayRecoveryReason;
  comment?: string;
}
```

Behavior:

If `yes`:

* Keep projected delay.
* Mark next mission as estimated delayed.
* Create `customer_delay_update_recommended` event.
* If Notification Center is active and customer opted in, customer may receive a delay update.

If `no`:

* Keep the system projection internally.
* Store employee response and reason.
* Do not notify customer unless a later critical threshold is reached.

If `not_sure`:

* Create Action Center item for admin review if Action Center is active.
* Otherwise mark mission as requires admin review.

---

# 9. Customer Time Window Breach

Customers may have approved time windows.

```ts
interface CustomerTimeWindow {
  customerId: string;
  weekday: number;
  allowedStartTime: string;
  allowedEndTime: string;
  isStrict: boolean;
}
```

Create emergency warning if:

```ts
projectedStartTime > approvedWindowEnd
```

or:

```ts
projectedEndTime > approvedWindowEnd && hasStrictTimeWindow === true
```

or:

```ts
projectedStartTime < approvedWindowStart && hasStrictTimeWindow === true
```

Expected event:

```ts
"time_window_breach_risk_detected"
```

Expected emergency action:

```ts
{
  actionType: "time_window_breach_risk",
  priority: "critical",
  assigneeRole: "admin",
  requiresImmediateAttention: true
}
```

If Notification Center is active and admin emergency alerts are enabled, trigger an admin emergency notification.

Suggested UI:

* Bottom-right warning box
* Critical color state
* Buttons:

  * Open Mission
  * Open Action Center
  * Contact Employee
  * Notify Customer
  * Mark handled

---

# 10. Booked Time Rating at Checkout

When an employee checks out from a mission, ask them to rate whether the booked mission time was sufficient.

This collection step belongs to Mission Log Core.

The advanced analysis belongs to the `time_quality_analytics` add-on.

Checkout question:

```txt
How well did the booked time match the actual work needed?
```

Scale:

```txt
0 = Catastrophic / completely insufficient time
10 = More than enough time for everything
```

Type:

```ts
type BookedTimeRating = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
```

Interpretation:

```txt
0–2 = Critical time mismatch
3–4 = Poor time fit
5–6 = Borderline / acceptable but tight
7–8 = Good fit
9–10 = Plenty of time
```

The rating must be stored per employee session, not only per mission.

---

## 10.1 Structured Reason Codes

Employees should be able to select one or more predefined reasons.

No free text should be required.

Free text can be optional.

Recommended reason codes:

```ts
type BookedTimeRatingReason =
  | "too_much_to_clean"
  | "customer_home_was_dirtier_than_expected"
  | "extra_customer_requests"
  | "access_problem"
  | "key_or_entry_problem"
  | "missing_or_wrong_material"
  | "equipment_problem"
  | "customer_interruption"
  | "new_or_unfamiliar_customer"
  | "unclear_work_instructions"
  | "travel_or_parking_problem"
  | "team_understaffed"
  | "employee_inexperienced"
  | "quality_standard_too_high_for_booked_time"
  | "time_was_sufficient"
  | "other";
```

Recommended model:

```ts
interface MissionBookedTimeRating {
  id: string;
  companyId: string;

  missionLogEntryId: string;
  missionStaffSessionId: string;

  bookingId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;

  customerId: string;
  customerNameSnapshot: string;

  employeeId: string;
  employeeNameSnapshot: string;

  scheduledDurationMinutes: number;
  actualDurationMinutes?: number;
  deviationMinutes?: number;
  deviationPercent?: number;

  rating: BookedTimeRating;
  reasonCodes: BookedTimeRatingReason[];

  optionalComment?: string;

  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}
```

---

# 11. Time Reporting Module

## 11.1 Purpose

Time Reporting must be a standalone module and page.

It is part of the operational chain, but it must not live only inside Mission Log.

Create:

```txt
src/pages/admin/TimeReporting.tsx
```

Time Reporting answers:

* What time should be approved?
* What time should go to payroll?
* What time should be billable?
* What time should be non-billable/internal?
* What time should be excluded?
* Does employee input need admin review?
* Does admin adjustment need employee approval?
* Does a report need clarification?
* Is the report ready for Payroll Basis?
* Is the report ready for Invoice Basis?

Time Reporting must support high-volume admin workflows.

Assume thousands of records, for example 5,000+ reports.

The page must be optimized for production work.

It should feel like:

```txt
Inbox + spreadsheet + approval workflow
```

---

## 11.2 Core Time Reporting Fields

Each time report must clearly separate:

```txt
Scheduled time
Checked-in time
Checked-out time
Actual duration
Employee reported duration
Admin adjusted duration
Final approved payroll time
Total deviation
Billable deviation
Non-billable/internal deviation
Excluded time
Reason codes
Employee note/message
Admin note/message
Payroll status
Invoice basis status
Approval status
```

Example:

```txt
Scheduled: 120 min
Checked in: 09:00
Checked out: 12:00
Actual: 180 min
Deviation: +60 min

Allocation:
120 min = scheduled billable
30 min = extra billable
30 min = internal non-billable, reason: Training
```

Economic interpretation:

```txt
Payroll = 180 min
Invoice basis = 150 min
Internal cost = 30 min
```

---

## 11.3 Time Report Statuses

```ts
type TimeReportStatus =
  | "draft"
  | "employee_submitted"
  | "auto_approved"
  | "admin_review_required"
  | "admin_adjusted_pending_employee"
  | "employee_question_pending"
  | "employee_answered"
  | "approved"
  | "ready_for_payroll"
  | "ready_for_invoice"
  | "sent_to_payroll"
  | "sent_to_invoice_basis"
  | "admin_override_approved"
  | "rejected"
  | "excluded";
```

Payroll and invoice must be separate.

```ts
type PayrollApprovalStatus =
  | "not_ready"
  | "ready"
  | "approved"
  | "sent_to_payroll"
  | "excluded";

type InvoiceBasisStatus =
  | "not_ready"
  | "ready"
  | "approved"
  | "sent_to_invoice_basis"
  | "excluded";
```

A time report may be ready for payroll but not ready for invoice, or the opposite.

---

## 11.4 Time Report Data Model

```ts
interface TimeReport {
  id: string;
  companyId: string;

  missionLogEntryId: string;
  bookingId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;

  customerId: string;
  customerNameSnapshot: string;

  employeeId: string;
  employeeNameSnapshot: string;

  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledDurationMinutes: number;

  checkedInAt?: string;
  checkedOutAt?: string;
  actualDurationMinutes?: number;

  employeeReportedStartTime?: string;
  employeeReportedEndTime?: string;
  employeeReportedDurationMinutes?: number;

  adminAdjustedStartTime?: string;
  adminAdjustedEndTime?: string;
  adminAdjustedDurationMinutes?: number;
  adminAdjustmentReason?: string;

  finalApprovedPayrollMinutes?: number;
  finalApprovedInvoiceMinutes?: number;

  totalDeviationMinutes?: number;
  billableDeviationMinutes?: number;
  nonBillableDeviationMinutes?: number;
  excludedMinutes?: number;

  status: TimeReportStatus;
  payrollApprovalStatus: PayrollApprovalStatus;
  invoiceBasisStatus: InvoiceBasisStatus;

  requiresAdminReview: boolean;
  reviewReasonCodes: string[];

  employeeApprovalStatus: "pending" | "approved" | "rejected";
  adminApprovalStatus: "pending" | "approved" | "rejected" | "overridden";

  createdAt: string;
  updatedAt: string;
}
```

---

## 11.5 Time Allocation Model

Use a separate allocation model so deviations can be split correctly.

```ts
type TimeAllocationType =
  | "scheduled_billable"
  | "extra_billable"
  | "internal_non_billable"
  | "non_billable_customer_related"
  | "training"
  | "admin_adjustment"
  | "excluded";

interface TimeAllocation {
  id: string;
  companyId: string;
  timeReportId: string;
  missionLogEntryId: string;
  employeeId: string;

  allocationType: TimeAllocationType;

  minutes: number;

  reasonCodeId?: string;
  reasonLabelSnapshot?: string;

  isPayrollRelevant: boolean;
  isInvoiceRelevant: boolean;
  isBillable: boolean;

  createdByActorType: "employee" | "admin" | "system";
  createdByActorId?: string;

  note?: string;

  createdAt: string;
  updatedAt: string;
}
```

This allows:

* Payroll-relevant time
* Invoice-relevant time
* Billable extra time
* Non-billable/internal time
* Training time
* Excluded time
* Admin adjustments

---

## 11.6 Time Deviation Reason Codes

Company admin must be able to configure reason codes in Settings.

Example reason codes:

```txt
Training
New employee
Internal onboarding
Material problem
Wrong/missing instruction
Key/access problem
Customer not ready
Extra quality control
Planning mistake
Admin decision
Non-billable customer service
Other
```

Recommended model:

```ts
interface TimeDeviationReasonCode {
  id: string;
  companyId: string;

  label: string;
  description?: string;

  defaultAllocationType:
    | "extra_billable"
    | "internal_non_billable"
    | "non_billable_customer_related"
    | "training"
    | "excluded";

  isBillableDefault: boolean;
  isPayrollRelevantDefault: boolean;
  isInvoiceRelevantDefault: boolean;

  requiresComment: boolean;
  isActive: boolean;

  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}
```

---

## 11.7 Employee Time Reporting Flow

When the employee checks out or submits daily time, if actual time deviates from scheduled time, ask how the deviation should be reported.

Example:

```txt
You exceeded scheduled time by 60 minutes.
How should this time be reported?
```

Options:

```txt
Use full deviation as billable extra time
Use full deviation as internal / non-billable time
Split the deviation
```

Split example:

```txt
Billable extra time: 30 min
Internal / non-billable time: 30 min
Reason: Training
Comment: optional or required depending on settings
```

Important:

* Employee suggests allocation.
* Admin approves or changes allocation.
* Employee does not final-approve financial classification.
* Structured reason codes must be primary.
* Free text is optional or settings-driven.

---

## 11.8 Admin Time Reporting Workspace

Time Reporting must have its own high-volume page.

Required views:

```txt
Needs Review
Employee Submitted
Admin Review
Employee Approval Needed
Ready for Payroll
Ready for Invoice
Approved
History
```

Required review buckets:

```txt
Missing check-in
Missing check-out
Manual employee adjustment
Large deviation
Billable deviation suggested
Non-billable/internal suggested
Employee message pending
Employee approval needed
GPS/QR issue
Ready for auto approval
```

Dashboard cards:

```txt
Total Reports
Needs Review
Missing Check-out
Manual Adjustments
Billable Deviations
Non-billable Deviations
Employee Approval Needed
Ready for Payroll
Ready for Invoice
```

Required table columns:

```txt
Date
Customer
Employee
Scheduled
Checked in
Checked out
Actual
Deviation
Billable deviation
Non-billable/internal deviation
Reason
Employee note/message
Payroll status
Invoice basis status
Approval status
Actions
```

---

## 11.9 Inline Editing and Bulk Actions

For thousands of records, admins must not open every item manually.

Support inline editing:

```txt
Approved payroll time
Billable deviation
Non-billable/internal deviation
Reason code
Payroll status
Invoice basis status
Admin note
```

Support bulk actions:

```txt
Bulk approve
Bulk request employee clarification
Bulk assign reason code
Bulk set billable/non-billable allocation
Bulk mark ready for payroll
Bulk mark ready for invoice
Bulk exclude
Bulk export
```

Sensitive actions must require confirmation and reason text:

```txt
Admin override
Bulk exclude
Changing payroll-relevant approved time
Changing invoice-relevant approved time
```

---

## 11.10 Time Report Detail Drawer

When admin opens a report, use a right-side detail drawer.

Show:

* Mission context
* Customer
* Employee
* Scheduled time
* Check-in/out time
* Actual time
* GPS/QR verification
* Employee suggested allocation
* Admin allocation
* Payroll-relevant time
* Invoice-relevant time
* Billable time
* Non-billable/internal time
* Reason codes
* Message thread
* Audit/event timeline
* Linked Mission Log entry
* Linked Customer Card
* Linked Employee Card
* Linked Work Order

Actions:

```txt
Approve
Adjust
Ask employee
Send correction
Request employee approval
Override
Create incident
Open Mission Log
Open Customer Card
```

---

## 11.11 Time Report Messages

Each time report should support communication between admin and employee.

```ts
interface TimeReportMessage {
  id: string;
  companyId: string;
  timeReportId: string;

  senderType: "employee" | "admin" | "system";
  senderId?: string;

  message: string;

  createdAt: string;
}
```

Use cases:

* Admin asks employee why time was allocated internally.
* Employee explains missing checkout.
* Admin requests clarification.
* Employee confirms an admin adjustment.

For analytics, use structured reason codes, not free text.

---

## 11.12 Auto Approval Rules

Auto approval may only happen when the report is simple.

A report can be auto-approved if:

```txt
Check-in exists
Check-out exists
GPS or QR verification passed, if required
No manual employee adjustment
No admin adjustment
Deviation within configured threshold
No split allocation
No internal/non-billable deviation
No employee/admin message required
No critical Mission Log event
No linked incident
Employee daily approval exists, if required
```

If employee splits time between billable and internal/non-billable, require admin review.

---

## 11.13 Admin Override Rules

Admin override must:

* Require reason text
* Be logged as an event
* Bypass employee approval
* Be visible in internal admin history
* Optionally create incident candidate
* Never be shown to customer as internal override detail

---

# 12. Time Reporting Settings

Company admin must be able to configure Time Reporting.

```ts
interface TimeReportingSettings {
  companyId: string;

  autoApprovalEnabled: boolean;

  maxDeviationMinutes: number;
  maxDeviationPercent: number;

  requireGpsOrQrVerification: boolean;
  requireEmployeeDailyApproval: boolean;

  manualAdjustmentsAlwaysRequireAdminReview: boolean;
  splitAllocationsAlwaysRequireAdminReview: boolean;
  internalNonBillableAlwaysRequiresAdminReview: boolean;
  gpsQrProblemsAlwaysRequireAdminReview: boolean;

  allowEmployeeSuggestedAllocation: boolean;
  allowEmployeeOptionalComment: boolean;

  createdAt: string;
  updatedAt: string;
}
```

---

# 13. Time Quality Analytics Add-on

Feature key:

```ts
"time_quality_analytics"
```

This is a separate add-on / premium feature.

Important:

* Mission Log Core collects booked-time rating at checkout.
* Time Quality Analytics provides advanced reporting and pattern analysis.
* Advanced analytics must be entitlement-gated.

Purpose:

Help admins understand:

* Which customers regularly take longer than booked
* Which customers regularly receive low booked-time ratings
* Which employees regularly take longer than scheduled
* Whether the issue is customer-specific, employee-specific, service-specific or planning-specific
* Whether low booked-time ratings may indicate quality risk
* Whether a customer contract or booked time should be reviewed

Use neutral language.

Do not label employees as “slow”.

Preferred language:

```txt
time pattern
deviation trend
review recommended
higher average duration
lower average time rating
```

Avoid:

```txt
slow employee
bad employee
poor performer
```

---

## 13.1 Time Quality Analytics Views

Dedicated page or Mission Log linked analytics page:

```txt
Time Quality Analytics
```

Views:

```txt
Customer Time Fit
Employee Time Patterns
Customer + Employee Comparison
Reason Code Statistics
```

Filters:

```txt
Date range
Customer
Employee
Service type
Work order
Rating range
Deviation range
Reason code
Only missions over booked time
Only missions under booked time
Only low-rated missions
Only repeated issues
```

Customer Time Fit should show:

```txt
Customer
Number of missions
Average booked duration
Average actual duration
Average deviation minutes
Average deviation percent
Average booked time rating
Number of low ratings
Number of critical ratings
Most common reason codes
Trend direction
Last mission date
Review recommendation
```

Employee Time Pattern should show:

```txt
Employee
Number of missions
Average scheduled duration
Average actual duration
Average deviation minutes
Average deviation percent
Average booked time rating given by employee
Customers served
Most common reason codes
Over-time frequency
Under-time frequency
Low-rating frequency
Last mission date
Review recommendation
```

Customer + Employee Comparison should show:

```txt
Customer
Employee
Number of visits
Average scheduled duration
Average actual duration
Average deviation minutes
Average deviation percent
Average booked time rating
Most common reason code
Last visit date
Trend direction
```

Reason Code Statistics should show:

```txt
Reason code
Number of occurrences
Average rating
Average deviation minutes
Customers most affected
Employees most affected
Trend over time
```

---

# 14. Operational Flags Add-on

Feature key:

```ts
"operational_flags"
```

Purpose:

Convert Mission Log and Time Reporting conditions into visible operational flags.

Examples:

```ts
"late_check_in"
"missing_check_in"
"missing_check_out"
"gps_failed"
"qr_failed"
"over_time"
"under_time"
"estimated_delay"
"chain_delay_risk"
"time_window_breach_risk"
"admin_review_required"
"non_billable_time_review"
"low_booked_time_rating"
```

If inactive:

* Internal logic may still calculate conditions.
* Advanced flag UI and filters should be hidden or locked.

---

# 15. Action Center Add-on

Feature key:

```ts
"action_center"
```

Purpose:

Central queue for items requiring human decision or follow-up.

Examples:

```ts
type ActionItemType =
  | "employee_delay_confirmation_required"
  | "customer_delay_notification_recommended"
  | "time_window_breach_risk"
  | "admin_time_review_required"
  | "missing_check_in_review"
  | "missing_check_out_review"
  | "gps_qr_problem_review"
  | "employee_approval_required"
  | "incident_review_required"
  | "time_quality_review_recommended"
  | "time_report_clarification_required";
```

Recommended model:

```ts
type ActionItemPriority = "low" | "medium" | "high" | "critical";

type ActionItemStatus =
  | "open"
  | "acknowledged"
  | "resolved"
  | "dismissed"
  | "auto_resolved";

interface ActionItem {
  id: string;
  companyId: string;

  sourceModule:
    | "mission_log"
    | "time_reporting"
    | "operational_flags"
    | "incident_management"
    | "notification_center"
    | "time_quality_analytics";

  sourceEntityType:
    | "mission_log_entry"
    | "time_report"
    | "time_allocation"
    | "incident"
    | "notification_event"
    | "booked_time_rating"
    | "time_quality_pattern";

  sourceEntityId: string;

  actionType: ActionItemType;
  priority: ActionItemPriority;
  status: ActionItemStatus;

  title: string;
  description: string;

  assigneeRole?: "admin" | "manager" | "employee";
  assigneeUserId?: string;

  dueAt?: string;
  resolvedAt?: string;
  resolvedByUserId?: string;

  metadata: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
}
```

---

# 16. Notification Center Add-on

Feature key:

```ts
"notification_center"
```

Purpose:

Consume events and send messages to admins, employees and customers.

Supported recipients:

```ts
"admin"
"employee"
"customer"
```

Supported channels:

```ts
"in_app"
"push"
"email" // future
"sms"   // future
```

Notification Center should only deliver if:

```txt
notification_center entitlement is active or trial
company settings allow this notification type
recipient has opted in when applicable
event passes configured threshold rules
```

Settings:

```ts
interface CompanyNotificationSettings {
  id: string;
  companyId: string;

  adminNotificationsEnabled: boolean;
  employeeNotificationsEnabled: boolean;
  customerNotificationsEnabled: boolean;

  notifyAdminOnLateCheckIn: boolean;
  notifyAdminOnMissingCheckOut: boolean;
  notifyAdminOnGpsQrProblem: boolean;
  notifyAdminOnTimeWindowBreachRisk: boolean;
  notifyAdminOnCriticalDelay: boolean;

  notifyAdminOnTimeReportReviewRequired: boolean;
  notifyAdminOnEmployeeQuestionPending: boolean;

  notifyCustomerOnEstimatedDelay: boolean;
  customerDelayNotificationThresholdMinutes: number;

  notifyEmployeeOnDelayConfirmationRequest: boolean;
  notifyEmployeeOnAdminTimeAdjustment: boolean;
  notifyEmployeeOnTimeReportQuestion: boolean;

  emergencyAlertsEnabled: boolean;
  emergencyAlertRoles: string[];

  createdAt: string;
  updatedAt: string;
}
```

Notification event:

```ts
type NotificationStatus =
  | "pending"
  | "sent"
  | "failed"
  | "suppressed"
  | "cancelled";

interface NotificationEvent {
  id: string;
  companyId: string;

  sourceEventId: string;
  sourceModule:
    | "mission_log"
    | "time_reporting"
    | "action_center"
    | "incident_management"
    | "time_quality_analytics";

  recipientType: "admin" | "employee" | "customer";
  recipientId: string;

  channel: "in_app" | "push" | "email" | "sms";

  title: string;
  body: string;

  status: NotificationStatus;
  suppressedReason?: string;

  sentAt?: string;
  failedAt?: string;
  failureReason?: string;

  createdAt: string;
  updatedAt: string;
}
```

If inactive:

* Do not send outbound notifications.
* Optionally store suppressed notification events.

---

# 17. Incident Management Add-on

Feature key:

```ts
"incident_management"
```

Purpose:

Create formal cases from severe operational or time-reporting events.

Examples:

```ts
type IncidentType =
  | "missed_mission"
  | "severe_delay"
  | "time_window_breach"
  | "customer_complaint"
  | "gps_qr_issue"
  | "key_access_issue"
  | "property_damage"
  | "admin_override"
  | "repeated_time_quality_issue"
  | "time_reporting_dispute"
  | "other";
```

Model:

```ts
type IncidentSeverity = "low" | "medium" | "high" | "critical";

type IncidentStatus =
  | "open"
  | "in_review"
  | "waiting_for_customer"
  | "waiting_for_employee"
  | "resolved"
  | "dismissed";

interface Incident {
  id: string;
  companyId: string;

  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;

  missionLogEntryId?: string;
  timeReportId?: string;
  bookingId?: string;
  customerId?: string;
  employeeIds: string[];

  title: string;
  description: string;

  createdFromEventId?: string;
  createdByActorType: "system" | "admin" | "customer" | "employee";
  createdByActorId?: string;

  resolvedAt?: string;
  resolvedByUserId?: string;

  createdAt: string;
  updatedAt: string;
}
```

If inactive:

* Do not create full incidents automatically.
* Store source events.
* Optionally mark `incidentCandidate: true`.

---

# 18. Future API Readiness

Do not assume an external backend API now unless the current architecture already uses one.

But keep internal contracts API-ready.

Use stable DTOs, repository methods, event envelopes, schema versions, correlation IDs and idempotency keys.

Recommended event envelope:

```ts
interface SystemEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  companyId: string;

  sourceModule:
    | "mission_log"
    | "time_reporting"
    | "operational_flags"
    | "incident_management"
    | "notification_center"
    | "action_center"
    | "time_quality_analytics"
    | "payroll_basis"
    | "invoice_basis";

  eventType: string;

  entityType:
    | "mission_log_entry"
    | "mission_staff_session"
    | "time_report"
    | "time_allocation"
    | "action_item"
    | "incident"
    | "notification_event"
    | "booked_time_rating"
    | "time_quality_pattern";

  entityId: string;

  actorType: "system" | "admin" | "employee" | "customer";
  actorId?: string;

  payload: TPayload;

  schemaVersion: number;
  correlationId: string;
  idempotencyKey?: string;

  occurredAt: string;
}
```

---

# 19. Repository Contracts

Use repository methods, not hardcoded page logic.

## Mission Log Repository

```ts
export interface MissionLogRepository {
  listMissionEntries(params: MissionLogListParams): Promise<MissionLogEntry[]>;
  getMissionEntry(id: string): Promise<MissionLogEntry | null>;

  checkIn(input: MissionCheckInInput): Promise<MissionLogEntry>;
  checkOut(input: MissionCheckOutInput): Promise<MissionLogEntry>;

  submitBookedTimeRating(input: SubmitBookedTimeRatingInput): Promise<MissionBookedTimeRating>;

  listMissionEvents(missionLogEntryId: string): Promise<MissionLogEvent[]>;
}
```

## Time Reporting Repository

```ts
export interface TimeReportingRepository {
  listTimeReports(params: TimeReportListParams): Promise<TimeReport[]>;
  getTimeReport(id: string): Promise<TimeReport | null>;

  updateTimeAllocation(input: UpdateTimeAllocationInput): Promise<TimeAllocation[]>;
  approveTimeReport(input: ApproveTimeReportInput): Promise<TimeReport>;
  requestEmployeeClarification(input: RequestEmployeeClarificationInput): Promise<TimeReportMessage>;
  submitEmployeeAnswer(input: SubmitEmployeeAnswerInput): Promise<TimeReportMessage>;
  adminAdjustTimeReport(input: AdminAdjustTimeReportInput): Promise<TimeReport>;
  adminOverrideTimeReport(input: AdminOverrideTimeReportInput): Promise<TimeReport>;

  bulkApprove(input: BulkApproveTimeReportsInput): Promise<TimeReport[]>;
  bulkAssignReasonCode(input: BulkAssignReasonCodeInput): Promise<TimeReport[]>;
  bulkMarkReadyForPayroll(input: BulkMarkReadyForPayrollInput): Promise<TimeReport[]>;
  bulkMarkReadyForInvoice(input: BulkMarkReadyForInvoiceInput): Promise<TimeReport[]>;
  bulkExclude(input: BulkExcludeTimeReportsInput): Promise<TimeReport[]>;

  listMessages(timeReportId: string): Promise<TimeReportMessage[]>;
}
```

## Action Center Repository

```ts
export interface ActionCenterRepository {
  listActionItems(params: ActionItemListParams): Promise<ActionItem[]>;
  getActionItem(id: string): Promise<ActionItem | null>;
  acknowledgeActionItem(id: string, userId: string): Promise<ActionItem>;
  resolveActionItem(id: string, userId: string, note?: string): Promise<ActionItem>;
  dismissActionItem(id: string, userId: string, reason?: string): Promise<ActionItem>;
}
```

## Notification Repository

```ts
export interface NotificationRepository {
  listNotifications(params: NotificationListParams): Promise<NotificationEvent[]>;
  createNotificationEvent(input: CreateNotificationEventInput): Promise<NotificationEvent>;
  markNotificationRead(id: string): Promise<void>;
  updateNotificationSettings(input: CompanyNotificationSettings): Promise<CompanyNotificationSettings>;
}
```

## Incident Repository

```ts
export interface IncidentRepository {
  listIncidents(params: IncidentListParams): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | null>;
  createIncident(input: CreateIncidentInput): Promise<Incident>;
  updateIncident(input: UpdateIncidentInput): Promise<Incident>;
  resolveIncident(id: string, userId: string): Promise<Incident>;
  dismissIncident(id: string, userId: string, reason?: string): Promise<Incident>;
}
```

## Time Quality Repository

```ts
export interface TimeQualityRepository {
  listBookedTimeRatings(params: TimeQualityFilterParams): Promise<MissionBookedTimeRating[]>;

  getCustomerTimeFitStats(params: TimeQualityFilterParams): Promise<CustomerTimeFitStats[]>;
  getEmployeeTimePatternStats(params: TimeQualityFilterParams): Promise<EmployeeTimePatternStats[]>;
  getCustomerEmployeeComparison(params: TimeQualityFilterParams): Promise<CustomerEmployeeTimeStats[]>;
  getReasonCodeStats(params: TimeQualityFilterParams): Promise<ReasonCodeStats[]>;

  getTimeQualitySettings(companyId: string): Promise<TimeQualitySettings>;
  updateTimeQualitySettings(input: TimeQualitySettings): Promise<TimeQualitySettings>;
}
```

---

# 20. Customer Visibility Rules

Customer-facing views must be safe.

Customer may see:

* Booking date
* Service
* Planned time, if already customer-visible elsewhere
* Completed status
* Execution status
* Customer-safe delay messages
* Customer-safe notes
* Customer-facing incident/review information if allowed

Customer must not see:

* Payroll status
* Admin override details
* Internal comments
* Internal risk scoring
* Internal employee payroll time
* Internal Action Center items
* Employee comparison analytics
* Booked-time rating per employee
* Internal Time Quality Analytics
* Internal non-billable classification unless explicitly customer-facing

---

# 21. Settings

Settings must support module-level configuration.

## Mission Log Settings

* GPS verification required
* QR verification allowed
* Manual check-in allowed
* Manual check-out allowed
* Late threshold minutes
* Chain delay threshold minutes
* Customer time window breach warnings

## Time Reporting Settings

* Auto approval enabled
* Max deviation minutes
* Max deviation percent
* Require GPS/QR verification
* Require employee daily approval
* Manual adjustments always require admin review
* Split allocations always require admin review
* Internal/non-billable allocations always require admin review
* GPS/QR issues always require admin review
* Allow employee suggested allocation
* Allow employee optional comment
* Reason codes for time deviations

## Notification Center Settings

Visible/unlocked if `notification_center` is active or trial.

* Admin notifications
* Employee notifications
* Customer notifications
* Emergency alerts
* Delay notifications
* Time report notifications
* Customer delay threshold
* Recipient roles

## Operational Flags Settings

Visible/unlocked if `operational_flags` is active or trial.

* Visible flag groups
* Late threshold
* Overtime threshold
* Undertime threshold
* Chain delay threshold
* Time window breach warnings
* Low rating threshold display

## Incident Management Settings

Visible/unlocked if `incident_management` is active or trial.

* Auto-create incident candidates
* Create incident on missed mission
* Create incident on severe delay
* Create incident on time window breach
* Create incident on GPS/QR failure
* Create incident on admin override
* Create incident on repeated time quality issue
* Create incident on time reporting dispute
* Require admin confirmation before creating incident

## Time Quality Analytics Settings

Visible/unlocked if `time_quality_analytics` is active or trial.

* Rating required on checkout
* Allow optional comment
* Low rating threshold
* Critical rating threshold
* Repeated issue minimum count
* High deviation minutes threshold
* High deviation percent threshold
* Enable customer time fit analysis
* Enable employee time pattern analysis
* Enable customer/employee comparison
* Enable reason code statistics

---

# 22. Development Center Tracking

Add a Development Center initiative:

```txt
Operational Execution: Mission Log, Time Reporting and Add-ons
```

Suggested phases:

```txt
Phase 1: Architecture discovery and current-code audit
Phase 2: Entitlements and feature keys
Phase 3: Mission Log Core foundation
Phase 4: Mission Staff Sessions and Mission Events
Phase 5: Basic Mission Log UI
Phase 6: Time Reporting foundation
Phase 7: Time Allocation and Reason Codes
Phase 8: Time Reporting high-volume admin UI
Phase 9: Booked Time Rating collection
Phase 10: Delay Projection and Chain Delay Risk
Phase 11: Operational Flags add-on
Phase 12: Notification Center add-on
Phase 13: Incident Management add-on
Phase 14: Action Center add-on
Phase 15: Time Quality Analytics add-on
Phase 16: Payroll Basis integration
Phase 17: Invoice Basis integration
```

Each phase should track:

* Status
* Scope
* Files touched
* Migrations added
* Feature flags / entitlements
* Known risks
* Verification checklist
* Build/test status

---

# 23. Recommended Implementation Sequence

Do not build all features at once.

## Phase 1: Codebase audit

Before coding:

* Inspect relevant files
* Identify current patterns
* Confirm route structure
* Confirm settings structure
* Confirm entitlement/package structure
* Confirm existing data layer
* Confirm migration conventions
* Confirm Development Center registry pattern

Deliver:

* File map
* Proposed implementation plan
* Risk list
* Verification checklist

## Phase 2: Feature keys and entitlements

Add feature keys:

```txt
mission_log
time_reporting
operational_flags
notification_center
incident_management
action_center
time_quality_analytics
payroll_basis
invoice_basis
```

Ensure active/trial/inactive support.

## Phase 3: Mission Log Core

Build:

* Mission Log types
* Mission Log repository interface
* Supabase-ready migration
* Basic Mission Log page
* Dashboard cards
* Mission list
* Mission detail drawer
* Mission event timeline
* Date navigation
* Team/location filters
* Active deviation grouping

## Phase 4: Staff sessions and check-in/out

Build:

* Mission staff sessions
* Check-in/check-out model
* GPS/QR status
* Per-employee session state
* Basic actual duration calculation

## Phase 5: Time Reporting Core

Build:

* Time Reporting page
* Time Report model
* Time Allocation model
* Payroll status
* Invoice basis status
* Reason codes
* Time report repository interface
* Basic review queue

## Phase 6: High-volume Time Reporting UI

Build:

* Dashboard cards
* Review buckets
* Advanced filters
* Inline editing
* Bulk actions
* Detail drawer
* Message thread
* Audit timeline

## Phase 7: Booked Time Rating

Build:

* Checkout rating prompt
* 0–10 rating
* Structured reason codes
* Optional comment
* Rating storage per employee session
* Basic rating display in Mission Log

## Phase 8: Delay Projection

Build:

* Delay calculation
* Projected start/end
* Chain delay detection
* Employee delay confirmation
* Time window breach detection
* Critical warning state

## Phase 9: Add-ons

Build add-ons separately and entitlement-gated:

* Operational Flags
* Notification Center
* Incident Management
* Action Center
* Time Quality Analytics

## Phase 10: Payroll and Invoice Basis

Build later:

* Approved Mission Log / Time Reporting output for payroll
* Approved invoice-relevant output for invoice basis
* Ensure time bank is only affected by invoice basis

---

# 24. Requested Output from Rork

Please start by reviewing the current codebase.

Then provide an implementation plan before coding.

Required output:

1. Current-code findings
2. Relevant existing files and patterns
3. Proposed type definitions
4. Proposed migrations
5. Proposed repository interfaces
6. Proposed UI/page structure
7. Suggested implementation phases
8. Risks and edge cases
9. Verification checklist
10. Development Center registration plan

Do not start with a large uncontrolled implementation.

Start with a safe architecture pass and minimal foundations for:

```txt
mission_log
time_reporting
entitlements
development_center_tracking
```

The most important architectural decision is:

```txt
Mission Log and Time Reporting must be separate modules.

Mission Log records execution.
Time Reporting approves, adjusts and financially classifies time.
```
