# TICKET-003J-R — Company Admin Settings → Request Foundation

## Status

READY — approved for RORK execution.

## Wave

WAVE-003J-R — Company Admin Settings → Request foundation

## Goal

Create the first **Company Admin local Request settings foundation** for Admin Requests.

This wave should introduce a safe, frontend-only foundation for the future Company Admin Settings → Request surface, distinct from:

- Super Admin global/system request governance: `/request-settings`
- legacy/preview REQUEST CRM settings shell: `/crm/settings` and `/crm/settings/:tab`
- operational Admin Requests routes: `/crm`, `/crm/dashboard`, `/crm/requests`

The intended target surface is:

- `/settings/request`

This is a foundation/shell wave only. It must not implement the operational request handler.

## Context from previous waves

WAVE-003G-R created the Super Admin global Request Settings foundation at `/request-settings`.

WAVE-003H-R created the Admin Requests Service → Module availability bridge:

- service key: `admin_requests`
- module id: `admin-requests`
- bridge: `src/lib/serviceModuleBridge.ts`
- access resolver: `src/lib/moduleAccess.ts`
- app seam: `AppContext.canAccessModule(...)`

WAVE-003I-R aligned operational CRM routes with the module access model:

- `/crm`
- `/crm/dashboard`
- `/crm/requests`

Those operational routes now additionally require `canAccessModule(currentUser, "admin-requests") === true`.

## Product decisions already established

- `admin_requests` is the active Admin Requests service/catalogue key.
- `admin_requests` affects only module `admin-requests`.
- `employee_customer_requests` is deferred and must remain separate.
- Super Admin owns global/system request governance at `/request-settings`.
- Company Admin owns local company-level request settings at `/settings/request`.
- Company Admin owns later operational request handling.
- Company Admin local module activation remains the final activation layer.

## Required product boundary

This wave creates only a local Company Admin settings foundation for **Admin Requests**.

It may show local configuration placeholders/read-only controls for future implementation, for example:

- local request intake preferences
- company request categories/types, shown as future/local placeholders
- SLA/default response-time placeholders
- assignment/responsibility placeholders
- customer/employee request-source toggles as disabled/future placeholders
- notification/automation handoff placeholders linking conceptually to Notification Center and Automation & AI Center
- audit/governance notes explaining that Super Admin global defaults come from `/request-settings`

Do not make these settings operational or persistent unless an existing safe frontend/mock pattern already exists and no backend/schema change is required.

## Required implementation scope

### 1. Inspect existing settings and route patterns first

Before changing code, inspect:

- `src/App.tsx`
- `src/pages/Settings.tsx`
- `src/pages/superadmin/RequestSettings.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/context/AppContext.tsx`
- `src/lib/requestCrm/settingsNav.ts`
- `src/lib/requestCrm/shellNav.ts`
- existing Settings page tests/nav tests
- existing Super Admin Request Settings tests, if any

Confirm whether the safest implementation is:

- a new dedicated page at `src/pages/settings/RequestSettings.tsx`, or
- a new company-admin-only settings component/panel mounted from a dedicated `/settings/request` route.

Use the existing Settings/DashboardLayout/PageHeader/tile/card patterns. Do not introduce a parallel design system.

### 2. Create the Company Admin route

Add the route:

- `/settings/request`

Expected access pattern:

- signed-out user → login redirect, as existing protected routes do;
- non-company-admin roles → dashboard redirect or access denied, following existing `ProtectedRoute` conventions;
- company admin without required settings/request permission → dashboard redirect/access denied, following existing patterns;
- company admin with access → sees the local Request settings foundation.

Preferred protection:

- `allow={["company_admin"]}`
- preserve/require the existing relevant permission model where available, likely `requests.settings.view` and/or `settings.manage` according to current patterns;
- if a module gate is used, it must use the existing `canAccessModule(currentUser, "admin-requests")` seam and must not duplicate resolver logic.

If current roles/permissions make the exact permission choice unsafe or ambiguous, use the narrowest existing pattern and document the decision in the outbox.

### 3. Add discoverability from Company Admin Settings

Add a clear Company Admin Settings entry point for Request settings using existing Settings navigation/tile patterns.

Expected behavior:

- visible only for Company Admin contexts where the existing permission/module model allows it;
- not visible for Super Admin because Super Admin already has `/request-settings`;
- should not duplicate or replace existing `/crm/settings` preview routes in this wave;
- should not change unrelated settings tabs.

If the current Settings page architecture makes a direct tile/link to `/settings/request` unsafe, create the safest minimal route-only foundation and document the limitation.

### 4. Keep Super Admin and Company Admin surfaces separate

Do not change:

- `/request-settings` — Super Admin global/system governance
- `/crm/settings`
- `/crm/settings/:tab`
- `/crm`
- `/crm/dashboard`
- `/crm/requests`

Do not move `/crm/settings` to `/settings/request` in this wave.

### 5. Content expectations for the foundation page

The page should be clear that this is a **local company configuration foundation**.

It should communicate the governance split:

- Super Admin defines global/system defaults in `/request-settings`.
- Company Admin will later configure local behavior in `/settings/request`.
- Operational request handling will later live in the Admin Requests operational module.
- Automation/AI decisions will later be governed by Automation & AI Center.

Allowed UI content:

- cards/sections/placeholders
- read-only mock/default values
- disabled switches/buttons with “Future” or “Coming later” labels
- warnings/notes that no runtime behavior is active yet

Not allowed:

- live settings persistence
- Supabase writes
- operational request runtime behavior
- real automation execution
- notification delivery
- AI decision execution

### 6. Tests

Add or update focused tests where patterns exist.

Tests should cover:

- `/settings/request` is protected and Company Admin-only;
- missing permission is blocked according to existing ProtectedRoute behavior;
- Super Admin does not use this Company Admin surface;
- the Company Admin settings entry point appears only where expected;
- `/request-settings` remains Super Admin-only and unchanged;
- `/crm/settings` and `/crm/settings/:tab` remain unchanged;
- no operational CRM route behavior from WAVE-003I-R regresses;
- `employee-customer-requests` is not introduced or affected.

Run the narrowest relevant test/check set.

If full static checks still show known unrelated baseline TypeScript errors, document them separately and do not fix unrelated domains.

## Explicit non-goals

Do not implement:

- request creation
- request list data model beyond existing shells
- request detail view
- assignment runtime
- status transitions runtime
- comments/messages runtime
- operational request handler
- customer request surface
- employee request surface
- `employee_customer_requests` service
- `employee-customer-requests` module
- backend/domain schema
- Supabase migrations
- database writes
- new entitlement model
- new module model
- new settings framework
- `/request-settings` rewrite
- `/crm/settings` relocation
- `/crm/settings` or `/crm/settings/:tab` removal
- Notification Center changes
- Action Center / Auto-Action Center changes
- live AI provider
- automation runner
- rule builder
- runtime automation or AI decisions
- email outbox/inbound email
- authorization weakening

Do not modify unrelated existing flows.

## Expected final report

RORK must update:

- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

RORK must report:

- exact files changed;
- route created and protection used;
- how the Company Admin Settings entry point was added;
- confirmation `/request-settings` remains Super Admin-only and unchanged;
- confirmation `/crm/settings` and `/crm/settings/:tab` remain unchanged;
- confirmation operational `/crm/*` route behavior from WAVE-003I-R remains unchanged;
- confirmation no backend/migrations/new entitlement model/new module model/request CRUD/automation/AI/notifications were added;
- confirmation `employee-customer-requests` was not affected;
- tests/checks run;
- unrelated baseline failures, if any;
- recommended next smallest wave.

## Stop conditions

Stop and report BLOCKED if:

- adding `/settings/request` would require backend/migrations/Supabase schema changes;
- adding the foundation would require a new entitlement model or module model;
- safe routing would require weakening existing role/permission checks;
- the implementation would require relocating or deleting `/crm/settings`;
- the implementation would require changing `/request-settings` behavior;
- the implementation would require operational request CRUD/runtime logic;
- the implementation would affect `employee-customer-requests`;
- the implementation would create request-specific access hacks instead of using existing permission/module seams.
