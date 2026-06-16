# TICKET-003L-R — Admin Requests Manual Create Foundation

## Status

DONE — implemented and verified in WAVE-003L-R.

## Wave

WAVE-003L-R — Admin Requests manual create foundation

## Goal

Add a frontend-only manual-create foundation for Company Admins inside the existing Admin Requests operational area.

## Scope

- Admin Requests only.
- Company Admin operational surface only.
- Existing `/crm/*` shell only.
- Existing `admin-requests` module seam only.
- Existing `requests.view` CRM permission model only.
- Frontend/mock/local UI foundation only.

## Implemented result

- Added a Company Admin-only `Create request` entry point on `/crm/requests`.
- Added `RequestCreateSheet`, a local-only side-sheet form for draft capture.
- Captured safe foundation-level fields:
  - request title
  - request category/type
  - source
  - priority
  - customer/reference placeholder
  - description/internal note placeholder
  - optional linked object placeholder
- Added clearly disabled/read-only later-slice sections for:
  - assignment
  - status workflow
  - Automation & AI
- Submit creates no real request and only shows a local preview/success callout:
  “Draft request captured locally for UI preview only. Persistence arrives in a later backend slice.”

## Non-goals preserved

- No backend.
- No Supabase writes.
- No database schema changes.
- No real persistence.
- No real request creation runtime.
- No assignment runtime.
- No comments/messages runtime.
- No notifications.
- No automation execution.
- No AI execution.
- No activity-log writes.
- No new permission keys.
- No new module model.
- No new entitlement model.
- No calculator work.
- No `employee_customer_requests` / `employee-customer-requests` work.

## Verification

Focused tests passed:

```txt
bunx vitest run \
  src/components/crm/RequestCreateSheet.test.tsx \
  src/components/crm/RequestDetailSheet.test.tsx \
  src/pages/crm/CrmRequests.test.tsx \
  src/pages/crm/CrmDashboard.test.tsx \
  src/pages/crm/CrmRouteAccess.access.test.tsx \
  src/lib/requestCrm/requestListFilters.test.ts \
  src/lib/requestCrm/shellNav.test.ts
# => Test Files 7 passed (7), Tests 52 passed (52)
```

Full `runChecks({ appPath: "web-cleanops" })` was run and still reports 25 known unrelated TypeScript baseline errors outside this wave's changed files.
