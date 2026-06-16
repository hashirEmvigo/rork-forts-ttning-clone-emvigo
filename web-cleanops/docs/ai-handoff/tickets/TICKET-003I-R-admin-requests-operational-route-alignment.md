# TICKET-003I-R — Admin Requests Operational Route Alignment

## Status

READY — approved for RORK execution.

## Wave

WAVE-003I-R — Admin Requests operational route alignment

## Goal

Align the existing REQUEST CRM operational routes with the established **Admin Requests** module access model.

A Company Admin should only reach the Admin Requests operational shell when all existing access layers say the module is usable:

1. REQUEST CRM shell feature flag is enabled.
2. User role/permission gate allows the route.
3. `canAccessModule(currentUser, "admin-requests")` returns true.

This wave should make the already-built operational shell follow the Service → Module bridge from WAVE-003H-R without building any new request functionality.

## Context from previous wave

WAVE-003H-R is DONE.

It created the first narrow Service → Module availability bridge:

- service key: `admin_requests`
- module id: `admin-requests`
- bridge: `src/lib/serviceModuleBridge.ts`
- access resolver: `src/lib/moduleAccess.ts`
- app seam: `AppContext.canAccessModule(...)`

The ticket registry states the next smallest wave is WAVE-003I-R: re-gate `/crm/*` operational routes on `canAccessModule("admin-requests")`.

## Product decisions already established

- `admin_requests` is the active Admin Requests service/catalogue key.
- `admin_requests` affects only module `admin-requests`.
- `employee_customer_requests` is deferred and must remain separate.
- Super Admin owns Services/Catalogue/Companies entitlement and global governance.
- Company Admin owns local module activation and later operational request handling.
- The Company Admin local module toggle remains the final activation layer.

## Route scope

### In scope

Only align the existing Admin Requests **operational** shell routes:

- `/crm`
- `/crm/dashboard`
- `/crm/requests`

These routes must remain behind:

- `isRequestCrmShellEnabled()`
- existing role/permission protection
- existing `requests.view` permission
- existing module access through `canAccessModule(currentUser, "admin-requests")`

### Out of scope

Do not align or relocate the settings shell in this wave:

- `/crm/settings`
- `/crm/settings/:tab`

Do not move settings to `/settings/request` in this wave.

## Required implementation scope

### 1. Inspect existing route and access patterns first

Before changing code, inspect:

- `src/App.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/context/AppContext.tsx`
- `src/lib/moduleAccess.ts`
- `src/lib/serviceModuleBridge.ts`
- `src/lib/requestCrm/shellNav.ts`
- existing route guard tests, if any
- existing REQUEST CRM shell tests, if any

Confirm how `canAccessModule(user, moduleId)` behaves for `company_admin` and `super_admin` before choosing the safest implementation pattern.

### 2. Add the smallest reusable module route guard

Preferred safe approach:

- either extend `ProtectedRoute` with a narrow optional module guard prop, or
- add a small wrapper component dedicated to module-gated routes.

The guard must:

- use `useApp()` and the existing `canAccessModule(currentUser, "admin-requests")` seam;
- run after authentication/role/permission checks, or preserve the same effective order without weakening existing behavior;
- redirect blocked users consistently with existing protected-route behavior, normally back to `/dashboard`;
- not duplicate `resolveCompanyModuleState` logic in `App.tsx` or CRM pages;
- not create a new route/auth/module access model.

If the existing `ProtectedRoute` abstraction cannot safely support module gating without side effects, create a narrow local wrapper for this wave and document the reason.

### 3. Apply the module gate only to operational CRM routes

Gate only:

- `/crm`
- `/crm/dashboard`
- `/crm/requests`

Expected behavior:

- feature flag OFF → routes remain absent as today;
- signed-out user → login redirect as today;
- missing role/permission → dashboard redirect as today;
- `canAccessModule(currentUser, "admin-requests") === false` → no operational CRM access;
- `canAccessModule(currentUser, "admin-requests") === true` → existing operational shell remains reachable.

Do not change route paths.
Do not change navigation labels unless required by an existing active-nav test.
Do not change REQUEST CRM shell flags.
Do not change `/crm/settings` or `/crm/settings/:tab`.

### 4. Preserve existing Admin Requests architecture

This wave must consume the bridge from WAVE-003H-R.

Do not:

- create a new entitlement resolver;
- create a new module resolver;
- bypass `canAccessModule`;
- read service entitlements directly from route components;
- hardcode company entitlement checks in CRM pages;
- auto-enable the local Company Admin module toggle;
- affect `employee-customer-requests` or `employee_customer_requests`.

### 5. Tests

Add or update focused tests where patterns exist.

Tests should cover:

- `/crm`, `/crm/dashboard`, and `/crm/requests` stay unreachable when the shell flag is OFF;
- authenticated user with `requests.view` but without usable `admin-requests` module is redirected/blocked;
- authenticated user with `requests.view` and usable `admin-requests` module reaches the existing CRM shell;
- `/crm/settings` and `/crm/settings/:tab` are not changed by this operational route wave;
- `employee-customer-requests` is not introduced or affected.

Run the narrowest relevant test/check set.

If full static checks still show known unrelated baseline TypeScript errors, document them separately and do not fix unrelated domains.

## Explicit non-goals

Do not implement:

- request creation
- request list data model beyond the existing mock/read-only shell
- request detail view
- assignment
- status transitions
- comments/messages
- operational request handler
- Company Admin Settings → Request
- customer request surface
- employee request surface
- `employee_customer_requests` service
- backend/domain schema
- Supabase migrations
- database writes
- new entitlement model
- new module model
- new settings framework
- `/crm/settings` relocation
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
- which route guard pattern was used;
- confirmation `/crm`, `/crm/dashboard`, and `/crm/requests` are gated by `canAccessModule(currentUser, "admin-requests")`;
- confirmation existing feature flag and permission gates remain intact;
- confirmation `/crm/settings` and `/crm/settings/:tab` were not changed;
- confirmation no backend/migrations/new entitlement model/new module model were added;
- confirmation `employee-customer-requests` was not affected;
- tests/checks run;
- unrelated baseline failures, if any;
- recommended next smallest wave.

## Stop conditions

Stop and report BLOCKED if:

- `canAccessModule` is missing or cannot safely be used from the route guard layer;
- the route guard would require backend/migrations/Supabase schema changes;
- the route guard would require a new entitlement model or module model;
- safe operational gating would require implementing request CRUD/domain logic in the same wave;
- the change would weaken existing role/permission checks;
- the change would require relocating `/crm/settings`;
- the change would affect `employee-customer-requests`;
- the implementation would create request-specific access hacks instead of using the existing module access seam.
