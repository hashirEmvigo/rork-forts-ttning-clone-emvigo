# TICKET-003H-R — Admin Requests Service → Module Availability Bridge

## Status

DONE — implemented the `admin_requests` → `admin-requests` Service → Module
availability bridge in the existing resolver layer (`src/lib/serviceModuleBridge.ts`
+ `src/lib/moduleAccess.ts` Layer 2), wired through `AppContext.canAccessModule`,
`ModulesPanel`, and `PlatformModulesPanel`. Company Admin local toggle stays the
final layer; `employee-customer-requests` unaffected; no `/crm/*` re-gating, no
backend/migrations, no new entitlement/module model. See `03-rork-outbox.md` and
`06-verification-report.md`.

## Wave

WAVE-003H-R — Admin Requests Service → Module Availability Bridge

## Goal

Create the first narrow bridge from the existing **Super Admin Services / Catalogue / Companies entitlement model** to the existing **Company Admin Settings → Modules availability model** for **Admin Requests only**.

The intended product chain is:

1. Super Admin enables the global module `admin-requests` in Platform Modules / Settings → Modules.
2. Super Admin exposes/sells the service `admin_requests` through Services / Catalogue.
3. Super Admin grants a company `admin_requests` as Disabled / Trial / Enabled through the existing Companies / Services / Billing entitlement model.
4. Company Admin sees `Admin Requests` as available in Settings → Modules only when the company is entitled.
5. Company Admin still controls the local module toggle as the final layer.

This wave should implement the smallest safe frontend/runtime bridge needed for step 4 while preserving the existing models.

## Product decisions already established

- `admin_requests` is the active Admin Requests service/catalogue key.
- `admin_requests` affects only module `admin-requests`.
- `employee_customer_requests` is deferred and must remain separate.
- Super Admin owns Services/Catalogue/Companies entitlement and global governance.
- Company Admin owns local module activation and later operational request handling.

## Required model

For the `admin-requests` module only:

- If `admin_requests` effective company entitlement is `enabled` or `trial`, the module should be treated as **offered/available** to that company.
- If `admin_requests` effective company entitlement is `disabled`, missing, globally unavailable, or otherwise not effectively granted, the module should be treated as **not offered / not available** to that company.
- Company Admin must still use the existing Settings → Modules local toggle to turn the module on/off after it becomes available.
- Do not automatically enable the module for the Company Admin.
- Do not make `employee-customer-requests` available from this service.

## Non-goals

Do **not** build:

- operational request handler
- request creation
- request list/inbox
- request detail view
- assignment
- status transitions
- comments/messages
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
- `/crm/*` re-gating
- `/crm/*` route relocation
- Notification Center
- Auto-Action / Action Center
- AI automation
- automation runner
- rule builder
- notification delivery
- authorization weakening

Do not modify unrelated existing flows.

## Required implementation scope

### 1. Inspect existing models first

Before changing anything, inspect:

- `src/lib/serviceRegistry.ts`
- `src/lib/moduleAccess.ts`
- `src/lib/modules.ts`
- `src/context/AppContext.tsx`
- Company entitlement data flow / resolver usage
- Company Admin Settings → Modules panel
- Super Admin Platform Modules panel
- Existing tests around module access and service entitlement, if any

Confirm that `admin_requests` exists and affects only `admin-requests`.

If `admin_requests` is missing, BLOCK.

If `admin_requests` affects `employee-customer-requests`, BLOCK.

### 2. Implement the bridge in the existing model only

Implement the bridge using existing structures.

Preferred approach:

- Introduce a small, explicit mapping from service feature key to module id using existing registry/`affects` metadata where safe.
- For this wave, support only:
  - service key: `admin_requests`
  - module id: `admin-requests`
- Keep the mapping generic enough that a later `employee_customer_requests` service can use the same pattern, but do not implement the future service now.

The bridge should make `admin-requests` **offered/available** when the company has effective `admin_requests` entitlement `enabled` or `trial`.

Do not create a third access system.
Do not bypass the existing module access resolver.
Do not write request-specific special-case logic directly into UI components if it belongs in the access/resolver layer.

### 3. Preserve the existing three-layer module model

The resulting Company Admin module state should remain conceptually:

1. Global module status — Super Admin platform-wide module active/inactive.
2. Company availability — now derived/bridged from `admin_requests` entitlement for `admin-requests`.
3. Company enabled — Company Admin local toggle.

Expected behavior:

- Global module inactive → not usable.
- Company not entitled to `admin_requests` → `Admin Requests` not available / locked.
- Company entitled to `admin_requests` but local module toggle off → available but off.
- Company entitled to `admin_requests` and local module toggle on → enabled/usable.

If current data structures cannot support this safely without backend/migrations, implement the safest frontend/local resolver bridge or report BLOCKED with exact reason.

### 4. Companies entitlement surface

Do not create a new request-specific Companies UI.

Use the existing Services / Catalogue / Companies entitlement model.

If existing UI already renders `admin_requests` from `SERVICE_FEATURE_REGISTRY`, do not duplicate it.

This wave should make the module availability follow that entitlement where the existing in-app state/resolver can safely do so.

### 5. Settings → Modules behavior

Company Admin Settings → Modules should reflect the bridge:

- If company has `admin_requests` entitlement enabled/trial, `Admin Requests` should be offered/available.
- If not entitled, it should show as not available/locked or be unavailable according to the existing module UX pattern.
- Company Admin can still switch it on/off only when offered.

Do not build Company Admin Settings → Request.
Do not build operational request UI.

### 6. Route-gating scope

Do not re-gate `/crm/*` in this wave.

Do not relocate `/crm/settings` to `/settings/request`.

Do not change REQUEST CRM shell flags.

This wave only bridges service entitlement to module availability for `admin-requests`.

### 7. Tests

Add or update focused tests where patterns exist.

Tests should cover:

- `admin_requests` entitlement enabled/trial makes `admin-requests` offered/available.
- disabled/missing entitlement does not offer `admin-requests`.
- local Company Admin module enabled/off state remains separate from entitlement availability.
- `employee-customer-requests` is not affected by `admin_requests`.
- existing module access behavior for unrelated modules is unchanged.

Run the narrowest relevant tests.

If full static checks still show known unrelated baseline TypeScript errors, document them separately and do not fix unrelated domains.

### 8. Documentation updates

Update relevant handoff and architecture docs to record:

- Admin Requests now has a Service → Module availability bridge.
- The bridge is only for `admin_requests` → `admin-requests`.
- Employee & Customer Requests remains deferred.
- Company Admin Settings → Request remains future scope.
- Operational request handler remains future scope.
- `/crm/*` re-gating remains future scope.
- No backend/migrations/new access model were added.

## Expected final report

RORK must report:

- exact files changed
- where the bridge was implemented
- how `admin_requests` entitlement is resolved
- how `admin-requests` availability is derived
- confirmation Company Admin local toggle remains separate
- confirmation `employee-customer-requests` is not affected
- confirmation no `/crm/*` gating changes were made
- confirmation no backend/migrations/new entitlement model/new module model were added
- tests/checks run
- unrelated baseline failures, if any
- recommended next smallest wave

## Stop conditions

Stop and report BLOCKED if:

- `admin_requests` does not exist
- `admin_requests` does not affect only `admin-requests`
- the bridge would require backend/migrations/Supabase schema changes
- the bridge would require a new entitlement model or new module model
- the bridge would bypass existing Services → Modules architecture
- the bridge would require `/crm/*` re-gating in the same wave
- the bridge would require Company Admin Settings → Request or operational request handling
- the bridge would affect `employee-customer-requests`
- the implementation would create request-specific UI hacks instead of resolver-level access logic
