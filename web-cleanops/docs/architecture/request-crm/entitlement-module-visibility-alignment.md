# REQUEST CRM — Entitlement / Module Visibility Alignment

## Status
BLOCKED (architecture decision required). Wave WAVE-003D-R / TICKET-003D-R.
No code was changed. This note records the actual existing structures, the gap
between them and the required "Services → Modules" chain, and the smallest safe
next step.

> **Re-verification (WAVE-003D-R re-run).** This wave was re-executed and every
> claim below was re-confirmed directly against the live source files
> (`src/lib/modules.ts`, `src/lib/moduleAccess.ts`, `src/lib/serviceRegistry.ts`,
> `src/App.tsx`, `src/lib/requestCrm/shellNav.ts`, `src/lib/requestCrm/settingsNav.ts`)
> rather than from prior notes. Nothing has changed: System B still has **no**
> `request_*`/`crm` key, no service points its `affects` at a request module, and
> `/crm/*` is still env-flag-gated (not `canAccessModule`-gated). The product
> clarification places the grant in the **Services entitlement model (System B =
> “Model 2”)**, which requires the new `request_crm` key + Service→Module bridge
> that this wave is forbidden to create. No blueprint §7 ratification is recorded,
> so the wave remains BLOCKED. Smallest safe next step is unchanged: ratify §7,
> then WAVE-003F (registry-only `request_crm` key, zero runtime/authz change). See
> `service-module-mapping-blueprint.md` for the target mapping.

> **Correction (WAVE-003F-R-CORRECTION).** The Model 2 registry key has been split.
> Implemented now: **`admin_requests`** (affects only the `admin-requests` module).
> Deferred to a future wave: **`employee_customer_requests`** (would affect
> `employee-customer-requests`). Admin Requests and Employee & Customer Requests are
> separate products/modules. Read the single-`request_crm`-key references below as
> superseded; the Services → Modules chain and the BLOCKED bridge status are
> otherwise unchanged.

## Required target chain (from the ticket)
1. Super Admin grants company access through the existing **Services / Catalogue /
   Companies / Billing** entitlement model.
2. Company Admin sees the entitled module as available in **Settings → Modules**.
3. Company Admin activates the module in Settings → Modules.
4. Once active, Company Admin sees the operational request surfaces and related
   settings.
5. Customer/Employee request surfaces come later, gated by their own role-specific
   module access.

The ticket assumes this is a single, already-integrated "Services → Modules"
pipeline. **It is not.** The codebase has two separate, unlinked Super-Admin
control surfaces, and the operational REQUEST CRM shell is gated by neither.

## What actually exists today

### System A — Module access model ("Settings → Modules")
- `src/lib/modules.ts` — `MODULE_DEFINITIONS` includes the two request modules:
  - `admin-requests` → "Admin Requests" (allowed: `company_admin`).
  - `employee-customer-requests` → "Employee & Customer Requests" (allowed:
    `company_admin`, `employee`, `customer`).
- `src/lib/moduleAccess.ts` — pure 3-layer resolver, combined in this order:
  1. **Global** `modules.status` (Super Admin, platform-wide active/inactive).
  2. **Company available** `company_modules.available` (Super Admin offers the
     module to a specific company).
  3. **Company enabled** `company_modules.enabled` (Company Admin switches an
     offered module on/off).
  - `isCompanyModuleOffered()` drives the switch vs. the "Not available" lock.
  - `isCompanyModuleUsable()` (state `enabled`) is the access-gate predicate.
- `src/components/modules/ModulesPanel.tsx` — Company Admin view; shows the
  toggle when offered, otherwise the `Lock` "Not available" pill.
- `src/components/modules/PlatformModulesPanel.tsx` — Super Admin view; controls
  global status (`setModuleStatus`) and per-company availability
  (`setModuleAvailable`). **This is System A's own Super-Admin grant surface.**
- `src/context/AppContext.tsx` — `canAccessModule(user, moduleId)` resolves
  through the same model; plus `getCompanyModuleSetting`, `setModuleEnabled`,
  `setModuleAvailable`, `setModuleStatus`.
- `src/lib/store.ts` — `seedCompanyModules()` seeds every module
  `available: true, enabled: true`, but that is the **localStorage demo seed
  only**. Under Supabase-authoritative companies/modules the request modules'
  availability comes from the database.
- Existing operational surface already wired: `src/components/layout/DashboardLayout.tsx`
  (Company Admin nav) shows **"Requests" → `/modules/employee-customer-requests`**,
  gated by `canAccessModule("employee-customer-requests")`, rendered by the
  generic `ModulePage`. `admin-requests` has **no** nav entry yet.

### System B — Service entitlement model ("Super Admin Services / Catalogue / Companies / Billing")
- `src/lib/serviceRegistry.ts` — `SERVICE_FEATURE_REGISTRY` + `ServiceFeatureKey`
  (`src/types/index.ts`). 3-layer model: global availability → company
  entitlement (`disabled` / `trial` / `enabled`) → company setting.
- Registered keys: `preferred_time_evaluation`, `media_uploads`, `time_bank`,
  `mission_log`, `time_reporting`, `operational_flags`, `notification_center`,
  `incident_management`, `action_center`, `time_quality_analytics`,
  `payroll_basis`, `invoice_basis`.
- **No request/CRM key exists.** `notification_center` is the closest "billable
  add-on" pattern the ticket references, but there is nothing for requests.
- **No bridge to System A.** `moduleAccess.ts` has zero references to
  `serviceKey` / entitlements; `serviceRegistry.ts` has zero references to
  request/crm. The two models are fully independent.

### System C — REQUEST CRM frontend shell (`/crm/*`)
- `src/App.tsx` — `/crm`, `/crm/dashboard`, `/crm/requests` are gated by
  `isRequestCrmShellEnabled()` (env flag) + `ProtectedRoute allow=[super_admin,
  company_admin] requirePermission="requests.view"`; `/crm/settings` and
  `/crm/settings/:tab` by `isRequestCrmSettingsShellEnabled()` +
  `requirePermission="requests.settings.view"`.
- `src/lib/featureFlags.ts` / `src/lib/requestCrm/*` — build-time
  `EXPO_PUBLIC_ENABLE_REQUEST_CRM_*` flags.
- **Not gated by `canAccessModule`.** This shell bypasses both System A and
  System B — the route-only / flag-only path WAVE-003D was stopped for.
- Runtime flag enforcement is owned by the Automation & AI Center (see
  `25-automation-ai-center-alignment.md`, `26-runtime-safety-performance-alignment.md`)
  and is an explicit non-goal here.

### Settings routes
- `/settings` (permission `settings.manage`); `/settings/checklists` and
  `/settings/checklists/*` exist as the sub-route precedent.
- Request settings currently live at **`/crm/settings`** (env-flag gated), **not**
  at the ticket's target `/settings/request` and `/settings/crm`, which do not
  exist.

## Why the request modules show "Not available"
Per `moduleAccess.ts`, "Not available" = state `globally_inactive` (module row
missing or `status !== "active"`) or `not_offered` (`company_modules.available`
is not true for the company). In the user's Supabase-authoritative environment
the request modules are simply not granted/active — a **data/config state inside
the existing module model**, not a missing code mechanism. Super Admin can
already offer them via `PlatformModulesPanel`.

## Does a matching Super Admin **service entitlement** key exist?
**No.** There is no `request_*` / `crm` / `admin_requests` key in
`ServiceFeatureKey` or `SERVICE_FEATURE_REGISTRY`. The request modules are
governed only by System A's own Super-Admin layer (Platform Modules
availability), which is a **different mechanism** than the Services entitlement
model the ticket names.

## The gap (why this is BLOCKED)
To satisfy the literal target chain, three things that are currently independent
would have to be linked:
1. **Service entitlement (B) → module availability (A).** No request service key
   and no B→A bridge exist. Building them = a **new entitlement key + new
   bridge**, which the ticket forbids ("new entitlement database model", "new
   module registry separate from the existing one", "Do not create a new
   module/access/entitlement system").
2. **Module-active (A) → operational `/crm/*` shell (C).** The shell is env-flag
   gated, not module gated. Re-gating it needs an **undefined module→surface
   mapping** (does `/crm/dashboard` belong to `admin-requests`,
   `employee-customer-requests`, or both?) and touches the centrally-owned
   feature-flag/runtime system (non-goal).
3. **Two competing request surfaces** (`/modules/employee-customer-requests` vs
   `/crm/*`) must be reconciled — which is canonical, and does one supersede the
   other — a product decision.

Each is a material product/architecture decision. Per the escalation policy
("two materially different business/product flows"; "required files or modules
are missing and the correct replacement cannot be inferred safely"; default to
architecture-level stop) and the ticket's own Option B / stop conditions
("alignment would require a new backend entitlement/module model"; "existing
service/module keys cannot be found or confidently linked"; "Do not guess or
invent a parallel model"), the wave stops here rather than guessing.

## Recommended next step (decision ticket, not implementation)
Pick ONE canonical model:

- **Model 1 — Modules-native (smallest, no new entitlement system).** Treat the
  existing Platform Modules availability layer as the "Super Admin grants company
  access" step. Then: (a) keep request gating entirely in System A; (b) choose
  the canonical operational surface — either keep `/modules/...` or make `/crm/*`
  the operational surface but gate it on `canAccessModule(...)` instead of the
  env flag (and decide which module governs which `/crm` surface); (c) add
  `/settings/request` + `/settings/crm` gated by the same module-active +
  permission check. Needs a product decision on the module→surface mapping and on
  retiring the env-flag preview, but introduces **no new entitlement model**.
- **Model 2 — Services-entitlement-native (matches the ticket's literal wording).**
  Introduce a request `ServiceFeatureKey` (e.g. `request_platform`) in System B
  plus a Services-entitlement → module-availability bridge, mirroring the
  `notification_center` add-on pattern. This requires a **new entitlement key +
  bridge** and is therefore a later architecture/implementation wave — explicitly
  out of scope (a non-goal) for this corrective wave.

### Decision needed from Sebastian / ChatGPT
1. Which model is canonical for REQUEST CRM gating — Model 1 (Modules-native) or
   Model 2 (Services-entitlement-native)?
2. The module → operational-surface mapping: which module(s) govern the request
   dashboard / inbox, and what is the fate of the `/crm/*` env-flag preview and
   the existing `/modules/employee-customer-requests` surface?
3. Confirmation that `/settings/request` + `/settings/crm` should be gated by the
   chosen model (module-active + permission), not by a standalone flag/route.

Only after (1)–(3) are answered can a safe, minimal implementation ticket be
authored without inventing a parallel model.
