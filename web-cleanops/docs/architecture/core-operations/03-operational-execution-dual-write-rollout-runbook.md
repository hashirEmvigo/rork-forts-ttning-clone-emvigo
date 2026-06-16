# CleanOps — Operational Execution Dual-Write + Shadow-Validation Rollout Runbook

> **Status:** CONTROLLED-ENABLEMENT RUNBOOK. This document is the manual,
> step-by-step package for safely enabling the Mission Log + Time Reporting
> dual-write mirrors and the parity shadow-validation runner in a controlled
> **dev/demo** environment.
>
> **This is NOT a read cut-over.** Legacy `localStorage` `TimeReport` remains the
> single authoritative source throughout. No `*_SUPABASE_AUTHORITATIVE` flag is
> enabled here. No reads switch, no UI changes, no service-row delete-guard switch,
> no `TimeReportStatusBadge` change, no legacy `TimeReport` removal, and no
> payroll / invoice / time-bank / notification / AI behaviour is introduced.
>
> **Environment:** shared online dev/demo only. No production / customer-
> authoritative rollout. Use a disposable test customer — never risk real
> customer data.

---

## 0. Architecture recap (verified)

- **Mission Log schema** — migration **`0031`** (`mission_log_entries`,
  `mission_staff_sessions`, `mission_log_events`).
- **Time Reporting schema** — migration **`0032`** (`time_reports`,
  `time_allocations`, `time_deviation_reason_codes`, `time_report_events`,
  `time_report_flags`, `time_report_flag_events`, `time_report_messages`,
  `saved_filters`, `saved_review_queues`).
- **Read adapters** — `supabaseMissionLogRepository`,
  `supabaseTimeReportingRepository`, SavedReviewQueue adapter. Present, **NOT**
  wired to any live read.
- **Dual-write mirrors** — `mirrorMissionLogCheckout` then
  `mirrorTimeReportingCheckout`, both fire-and-forget after `persistTimeReports`
  in `AppContext.submitTimeReportCheckout`. Legacy checkout is authoritative and
  is never blocked by a mirror failure.
- **Parity comparators** — pure `compareTimeReportingParity`,
  `compareMissionLogParity` + the shared mismatch model (`parityShared.ts`).
- **Parity runner** — `runTimeReportingParityForReport` /
  `runTimeReportingParityBatch` (read-only, deterministic-id fetches, never
  throws).
- **Runtime shadow hook** — fire-and-forget call to the runner at the success
  tail of `mirrorTimeReportingCheckout`, gated by `TIME_REPORTING_SHADOW_VALIDATE`.
- **Telemetry state** — `timeReportingParityState.ts` (sanitized counters + a
  50-capped recent-mismatch ring).
- **Flags** — `MISSION_LOG_DUAL_WRITE`, `TIME_REPORTING_DUAL_WRITE`,
  `TIME_REPORTING_SHADOW_VALIDATE`: all `envFlag(...) || false`, **DEFAULT OFF**,
  not the `cutoverFlag()` resolver. Committed code keeps them OFF.

All three flags are plain `EXPO_PUBLIC_*` booleans — only the literal string
`"true"` turns them on. Rollback for any flag is a single env flip back to
`false` (or removing the var) and a rebuild. No data migration is needed to roll
back because legacy is always authoritative.

---

## 1. Flag enablement steps (one at a time)

Enable **one flag at a time**, rebuild the dev/demo environment, run the
checkpoint, and only proceed if the checkpoint passes.

```
Flag N  →  rebuild  →  checkpoint  →  PASS?  →  proceed to Flag N+1
                                    └─ FAIL ─→ STOP, roll back Flag N, report
```

### Step 1 — `MISSION_LOG_DUAL_WRITE`

1. Set in the dev/demo environment:
   ```
   EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE=true
   ```
   Leave `TIME_REPORTING_DUAL_WRITE` and `TIME_REPORTING_SHADOW_VALIDATE` unset/`false`.
2. Rebuild / redeploy the dev/demo build.
3. **Checkpoint 1:**
   - Submit one checkout (Checkout A below).
   - Legacy checkout still succeeds and the legacy `TimeReport` is saved.
   - `mission_log_entries` / `mission_staff_sessions` / `mission_log_events` rows
     are created for the checkout (verify with §4 Mission Log queries).
   - No `time_reports` rows are written yet (Time Reporting mirror still OFF).
   - No checkout error, no duplicate Mission Log rows on a retry.

### Step 2 — `TIME_REPORTING_DUAL_WRITE`

1. With Step 1 still ON, add:
   ```
   EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE=true
   ```
2. Rebuild / redeploy.
3. **Checkpoint 2:**
   - Submit Checkouts A, B and C below.
   - Legacy checkout still succeeds for all three.
   - `time_reports` + `time_allocations` + `time_report_events` rows are created
     (verify with §4).
   - Flags / messages behave per the §2 checklist and §3 expected rows.
   - No duplicate rows on a retry; invariants in §3 hold.

### Step 3 — `TIME_REPORTING_SHADOW_VALIDATE`

1. With Steps 1 and 2 still ON, add:
   ```
   EXPO_PUBLIC_TIME_REPORTING_SHADOW_VALIDATE=true
   ```
2. Rebuild / redeploy.
3. **Checkpoint 3:**
   - Submit Checkouts A, B and C again.
   - Legacy checkout still succeeds; the parity runner runs fire-and-forget at
     the Time Reporting mirror success tail.
   - Read sanitized parity telemetry (§5): `0` blocking mismatches, `0` fetch
     failures, no unexpected warnings.

### Why this order is safest

- Mission Log is the **upstream producer** of execution rows that Time Reporting
  soft-links to; enabling it first means the rows Time Reporting references exist
  before Time Reporting mirroring begins.
- Time Reporting dual-write is enabled **before** shadow validation so there are
  real Supabase rows to compare against — enabling validation first would only
  produce expected "missing" info noise.
- Shadow validation is last because it only *reads + compares*; it has no value
  until both mirrors are producing rows, and it must never gate the mirrors.

### Do NOT enable (out of scope)

```
EXPO_PUBLIC_MISSION_LOG_SUPABASE_AUTHORITATIVE
EXPO_PUBLIC_TIME_REPORTING_SUPABASE_AUTHORITATIVE
```

---

## 2. Manual validation checklist

Set-up: use one disposable test customer with one work order / service row, then
run the three checkouts.

### Checkout A — normal / auto-approved (no deviation)

- [ ] Legacy checkout succeeds; legacy `TimeReport` saved.
- [ ] Mission Log rows created (entry + staff session + `checked_out` event).
- [ ] Time Reporting rows created (`time_reports` + scheduled `time_allocations`
      + submitted `time_report_events`).
- [ ] **No** `time_report_flags` row (auto-approved → no admin review).
- [ ] **No** `time_report_flag_events` row.
- [ ] **No** `time_report_messages` row (no comment).

### Checkout B — deviation requiring admin review, NO comment

- [ ] Legacy checkout succeeds; legacy `TimeReport` saved.
- [ ] Mission Log rows created (entry + staff session + `checked_out` event).
- [ ] Time Reporting rows created (`time_reports` + allocations +
      `time_report_events`).
- [ ] Exactly **one** open `time_report_flags` row (`resolution_status = open`).
- [ ] Exactly **one** `flag_opened` `time_report_flag_events` row.
- [ ] **No** `time_report_messages` row (no comment to preserve).

### Checkout C — deviation requiring admin review, WITH comment

- [ ] Legacy checkout succeeds; legacy `TimeReport` saved.
- [ ] Mission Log rows created (entry + staff session + `checked_out` event).
- [ ] Time Reporting rows created (`time_reports` + allocations +
      `time_report_events`).
- [ ] Exactly **one** open `time_report_flags` row (`resolution_status = open`).
- [ ] Exactly **one** `flag_opened` `time_report_flag_events` row.
- [ ] Exactly **one** `time_report_messages` row (the real, non-empty comment).

---

## 3. Expected table rows per checkout type

| Table | Checkout A (auto) | Checkout B (review, no comment) | Checkout C (review + comment) |
|---|---|---|---|
| `mission_log_entries` | 1 | 1 | 1 |
| `mission_staff_sessions` | 1 (per checked-out staff) | 1 | 1 |
| `mission_log_events` | ≥1 (`checked_out`) | ≥1 (`checked_out`) | ≥1 (`checked_out`) |
| `time_reports` | 1 | 1 | 1 |
| `time_allocations` | ≥1 (scheduled always) | scheduled + non-zero deviation slices | scheduled + non-zero deviation slices |
| `time_report_events` | 1 (`submitted`) | 1 (`submitted`) | 1 (`submitted`) |
| `time_report_flags` | 0 | 1 (`open`) | 1 (`open`) |
| `time_report_flag_events` | 0 | 1 (`flag_opened`) | 1 (`flag_opened`) |
| `time_report_messages` | 0 | 0 | 1 |

> Mission Log rows appear only while `MISSION_LOG_DUAL_WRITE` is ON. With it OFF,
> their absence is **expected / info** in parity telemetry, never blocking.

### Invariants (must hold for every checkout)

- A **scheduled** allocation always exists — including a `0`-minute scheduled
  allocation.
- **Zero-minute deviation allocations are skipped** (no empty billable/internal
  deviation rows).
- `time_reports.payroll_approval_status = not_ready`.
- `time_reports.invoice_basis_status = not_ready`.
- `time_reports.ai_recommendation = null`.
- Flag `resolution_status` is **separate** from approval status; the report flag
  rollup is separate from approval / payroll / invoice status.
- **Retry must not create duplicates** — `legacy_id` / deterministic
  `idempotency_key` make every write idempotent (reports, allocations, events,
  flags, flag events, messages).
- Append-only tables (`time_report_events`, `time_report_flag_events`,
  `time_report_messages`, `mission_log_events`) are insert-ignore; no UPDATE /
  DELETE.

---

## 4. Read-only SQL inspection queries

Run in the Supabase Dashboard → SQL Editor. **All queries are read-only — no
destructive SQL.** Substitute the bracketed placeholders. Cross-entity refs are
text `legacy_id`s (never FKs), so most queries key on `*_legacy_id` + company
scope.

```sql
-- 0. Resolve the company UUID from its legacy id (for company_id-keyed checks).
select id as company_uuid, legacy_id
from public.companies
where legacy_id = '<COMPANY_LEGACY_ID>';
```

### Time Reporting

```sql
-- 1. The time_report parent for this checkout (deterministic legacy id).
--    Confirms scope, minutes, status invariants and soft-link ids.
select legacy_id, company_legacy_id, work_order_legacy_id, service_row_legacy_id,
       employee_legacy_id, employee_name_snapshot,
       scheduled_duration_minutes, actual_duration_minutes, total_deviation_minutes,
       status, requires_admin_review,
       payroll_approval_status, invoice_basis_status, ai_recommendation,
       flag_resolution_status, submitted_at,
       mission_log_entry_legacy_id, mission_staff_session_legacy_id,
       deleted_at
from public.time_reports
where legacy_id = '<TIME_REPORT_LEGACY_ID>'
  and company_legacy_id = '<COMPANY_LEGACY_ID>';

-- 2. All time_reports for a service row / work order (scope sanity + dup check).
select legacy_id, status, requires_admin_review, total_deviation_minutes, submitted_at
from public.time_reports
where company_legacy_id = '<COMPANY_LEGACY_ID>'
  and work_order_legacy_id = '<WORK_ORDER_LEGACY_ID>'
  and service_row_legacy_id = '<SERVICE_ROW_LEGACY_ID>'
  and deleted_at is null
order by submitted_at desc;

-- 3. Allocations (scheduled always present; zero-minute deviation slices skipped).
select legacy_id, allocation_type, minutes,
       is_payroll_relevant, is_invoice_relevant, is_billable, deleted_at
from public.time_allocations
where time_report_legacy_id = '<TIME_REPORT_LEGACY_ID>'
  and deleted_at is null
order by allocation_type;

-- 4. Submitted event (append-only; exactly one submitted, no duplicates).
select legacy_id, event_type, occurred_at, idempotency_key
from public.time_report_events
where time_report_legacy_id = '<TIME_REPORT_LEGACY_ID>'
order by occurred_at;

-- 5. Flag (one OPEN flag only when admin review is required).
select legacy_id, flag_type, resolution_status, created_at, idempotency_key
from public.time_report_flags
where time_report_legacy_id = '<TIME_REPORT_LEGACY_ID>'
  and deleted_at is null;

-- 6. Flag events (append-only; one flag_opened per flag).
select legacy_id, event_type, occurred_at, idempotency_key
from public.time_report_flag_events
where time_report_legacy_id = '<TIME_REPORT_LEGACY_ID>'
order by occurred_at;

-- 7. Messages (one row only when a real non-empty comment exists).
--    Inspect existence/count only; do NOT export message bodies into telemetry.
select legacy_id, occurred_at, idempotency_key
from public.time_report_messages
where time_report_legacy_id = '<TIME_REPORT_LEGACY_ID>'
order by occurred_at;
```

### Mission Log (only meaningful while `MISSION_LOG_DUAL_WRITE` is ON)

```sql
-- 8. Mission Log entry for this checkout (deterministic legacy id).
select legacy_id, company_legacy_id, work_order_legacy_id, service_row_legacy_id,
       deleted_at
from public.mission_log_entries
where legacy_id = '<MISSION_LOG_ENTRY_LEGACY_ID>'
  and company_legacy_id = '<COMPANY_LEGACY_ID>';

-- 9. Staff session(s) for the entry.
select legacy_id, employee_legacy_id, mission_log_entry_legacy_id, deleted_at
from public.mission_staff_sessions
where mission_log_entry_legacy_id = '<MISSION_LOG_ENTRY_LEGACY_ID>'
  and deleted_at is null;

-- 10. checked_out event (append-only; no duplicates).
select legacy_id, event_type, occurred_at, idempotency_key
from public.mission_log_events
where mission_log_entry_legacy_id = '<MISSION_LOG_ENTRY_LEGACY_ID>'
order by occurred_at;
```

> The deterministic `time_report` / Mission Log `legacy_id`s are derived by
> `buildTimeReportLegacyId` / `buildMissionLogEntryLegacyId` /
> `buildMissionStaffSessionLegacyId` from the checkout context. In dev you can
> read them from the in-app console handles in §5, or from the parity telemetry
> `sourceLegacyId` of any recorded mismatch.

---

## 5. Telemetry inspection

The runner records into `timeReportingParityState`. In a DEV build the snapshot
is exposed on the window console handle:

```js
// Browser dev console (dev build only):
window.__cleanopsData.getTimeReportingParityState();

// Reset between manual test passes:
window.__cleanopsData.resetTimeReportingParityState();
```

Check these fields after the manual checkouts:

| Field | Expected (clean dev pass) |
|---|---|
| `enabled` | `true` (when `TIME_REPORTING_SHADOW_VALIDATE` is ON) |
| `totalChecked` | matches the number of validated checkouts |
| `matched` | equals `totalChecked` on a clean pass |
| `mismatched` | `0` |
| `blocking` | **`0`** |
| `warning` | `0` (any warning must be understood + documented) |
| `info` | `0`, OR only expected entries (e.g. Mission Log absence while `MISSION_LOG_DUAL_WRITE` is OFF) |
| `fetchFailures` | **`0`** |
| `recentMismatches` | empty, OR every entry understood (sanitized; comments / message bodies / name snapshots already `[redacted]`) |

**Success criteria before any future read cut-over discussion:**

- `0` blocking mismatches.
- `0` fetch failures.
- `0` unexpected warnings.
- `recentMismatches` empty or fully understood.

The sanitizer guarantees no deviation comments, message bodies, or
employee/customer name snapshots ever enter telemetry — only short scalar
ids / minutes / counts / statuses are retained.

---

## 6. Stop conditions

STOP immediately, roll back the most recently enabled flag (§7) and report if any
of the following occur:

- Any checkout **error caused by the mirror or validation** (legacy checkout must
  always succeed).
- **Duplicate** reports / events / flags / messages on a retry.
- Wrong `service_row_legacy_id` on a mirrored row.
- Allocation **sum mismatch** vs the legacy report minutes.
- **Missing scheduled allocation** on any report.
- **Missing open flag** for a pending-admin-review checkout.
- **Unexpected flag** on an auto-approved checkout.
- Any parity **fetch failures** (`fetchFailures > 0`).
- Telemetry **leaks** comments / message bodies / customer free text (any
  unexpected non-redacted sensitive value).
- Any **payroll / invoice / time-bank write** observed.

---

## 7. Rollback steps (per flag)

Rollback is instant and data-free — legacy `TimeReport` is always authoritative,
so disabling a flag never requires data recovery. Roll back the **most recently
enabled** flag first.

1. **`TIME_REPORTING_SHADOW_VALIDATE`** → set `=false` (or remove the var) and
   rebuild. The runner is no longer reachable; mirrors continue, no telemetry is
   recorded. Returns to the post-Step-2 state.
2. **`TIME_REPORTING_DUAL_WRITE`** → set `=false` and rebuild. Time Reporting
   rows stop being written; the shadow hook is unreachable (it lives inside the
   Time Reporting mirror). Returns to the post-Step-1 state. (Disable
   `TIME_REPORTING_SHADOW_VALIDATE` too for cleanliness.)
3. **`MISSION_LOG_DUAL_WRITE`** → set `=false` and rebuild. Mission Log rows stop
   being written. Returns to the fully-OFF committed baseline.

Existing Supabase rows written before rollback are harmless: nothing reads them,
and legacy stays authoritative. They can be left in the dev/demo DB or cleaned
manually out-of-band.

---

## 8. Test suites to run (before and after flag enablement)

Run the build + the targeted suites:

```
runChecks (appPath: web-cleanops)

# Dual-write
missionLogDualWrite
timeReportingDualWrite

# Parity
timeReportingParity
missionLogParity
timeReportingParityRunner
timeReportingShadowHook

# Read adapters
supabaseMissionLogRepository (Mission Log read adapter)
supabaseTimeReportingRepository (Time Reporting read adapter)
SavedReviewQueue read adapter

# Operational regression
checkout
service-row delete guard
employee assignment
entitlement
```

All must remain green.

### Known accepted pre-existing issues (NOT introduced by this work)

- **`protocolRunStore`** — same-millisecond ordering flakiness in the full suite.
- **`developmentTimeline.test.ts`** — the default 50-entry cap vs the full
  timeline entry count makes `getTimelineEntries("all").length === total` fail.

Both are tracked separately and must not be fixed as part of rollout.

---

## 9. Development Center tracking

State recorded for this rollout (see `developmentCenter.ts`, `time_reporting`
module notes):

- Controlled validation **pending** (runbook prepared).
- Flags `MISSION_LOG_DUAL_WRITE` / `TIME_REPORTING_DUAL_WRITE` /
  `TIME_REPORTING_SHADOW_VALIDATE` remain **default OFF in committed code**.
- **No** read cut-over.
- **Not** Supabase-authoritative.

Progression states to track during execution: `validation pending` →
`validation running` → `validation passed` / `validation failed / blocked`.
Nothing is marked Supabase-authoritative.
