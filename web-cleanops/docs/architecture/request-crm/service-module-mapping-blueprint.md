# REQUEST CRM — Service → Module Mapping Blueprint

## Status

Architecture / planning only. Wave **WAVE-003E-R** / **TICKET-003E-R**.

No application code, routes, runtime behavior, backend, migrations, entitlement
model, module registry, Notification Center, or Auto-Action Center were created
or changed. This document defines *how* REQUEST CRM should map onto the existing
**Services → Modules → Company Admin Settings** model so a later, minimal
implementation wave can proceed without ad-hoc patching.

It is the successor to the gap report in
`entitlement-module-visibility-alignment.md` (WAVE-003D-R, BLOCKED). That note
established *that* the chain is not integrated; this note defines *the target
mapping* and the smallest safe path to it.

### Correction — WAVE-003F-R-CORRECTION (supersedes the single-suite key)

The single `request_crm` suite key recommended below (and implemented
registry-only in WAVE-003F) has been **replaced**. Latest product decision:
**Admin Requests** and **Employee & Customer Requests** are *separate*
products/modules (they will differ significantly), so they must not share one
commercial key.

- **Implemented now (registry-only):** service key **`admin_requests`**
  ("Admin Requests"), `affects` **only** the `admin-requests` module. Packaging
  defaults still mirror `notification_center` (`defaultGlobalEnabled: true`,
  `defaultCompanyEnabled: false`, `supportsTrial: true`).
- **Deferred (future wave):** service key **`employee_customer_requests`**,
  affecting the `employee-customer-requests` module — intentionally NOT registered
  yet.
- Everything else in this blueprint (the 3-layer Services + Modules model, the
  diagnostic-only `affects` seam, the route-gating recommendation, and the clean
  Super-Admin-governance vs. Company-Admin-operations split) is unchanged. Read
  every “`request_crm` suite affecting both request modules” reference below as the
  superseded shape; the Service→Module bridge and `/crm/*` re-gating remain a
  later, separate wave.

### Guardrails this blueprint stays inside

- It reuses the **existing** Service-entitlement model (System B) and the
  **existing** Module-access model (System A). It does **not** invent a third /
  parallel entitlement or module system.
- It routes REQUEST CRM **through** Services → Modules. It does **not** endorse
  the env-flag/route-only bypass.
- It keeps **Super Admin governance** and **Company Admin operational UX** on
  opposite sides of a clean boundary; they are never mixed.
- Notification Center, Auto-Action Center, AI policy, runtime guards remain owned
  by the Automation & AI Center (`25-automation-ai-center-alignment.md`,
  `26-runtime-safety-performance-alignment.md`) and are **out of** this mapping.

---

## 1. Existing structures (verified by inspection)

Three independent systems exist today. The product owner's chain assumes they are
one integrated pipeline; they are not yet linked.

### System A — Module access model ("Settings → Modules")

- `src/lib/modules.ts` — `MODULE_DEFINITIONS`. Static catalogue (id, name,
  description, icon, `allowedUserTypes`). Request-related entries already present:
  - `admin-requests` → "Admin Requests" — allowed: `company_admin`.
  - `employee-customer-requests` → "Employee & Customer Requests" — allowed:
    `company_admin`, `employee`, `customer`.
- `src/lib/moduleAccess.ts` — pure 3-layer resolver, combined in this exact
  order, global wins first:
  1. **Global** `modules.status` (Super Admin, platform-wide active/inactive).
  2. **Company available** `company_modules.available` (Super Admin offers the
     module to one company).
  3. **Company enabled** `company_modules.enabled` (Company Admin switches an
     offered module on/off).
  - States: `globally_inactive` | `not_offered` | `available_off` | `enabled`.
  - `isCompanyModuleOffered()` → switch vs. "Not available" lock.
  - `isCompanyModuleUsable()` (state `enabled`) → the access predicate.
- `src/components/modules/ModulesPanel.tsx` — **Company Admin** Settings → Modules
  view; toggle when offered, `Lock` "Not available" pill otherwise.
- `src/components/modules/PlatformModulesPanel.tsx` — **Super Admin** view: global
  status (`setModuleStatus`) + per-company availability (`setModuleAvailable`).
  This is System A's *own* Super-Admin grant surface.
- `src/context/AppContext.tsx` — `canAccessModule(user, moduleId)`,
  `getCompanyModuleSetting`, `setModuleStatus`, `setModuleAvailable`,
  `setModuleEnabled`, `getNavModuleGroups`.
- `src/pages/ModulePage.tsx` — generic module landing (`/modules/:moduleId`);
  renders `AccessDenied` unless `canAccessModule` passes. Correct gate precedent.
- Operational surface already wired: `src/components/layout/DashboardLayout.tsx`
  (Company Admin "Operations" group) shows **"Requests" → `/modules/employee-customer-requests`**,
  gated by `canAccessModule("employee-customer-requests")`. `admin-requests` has
  **no** nav entry yet (reachable only via the generic `/modules/:moduleId`).

### System B — Service entitlement model ("Super Admin Services / Catalogue / Companies / Billing")

- `src/lib/serviceRegistry.ts` — `SERVICE_FEATURE_REGISTRY` + `ServiceFeatureKey`
  (`src/types/index.ts`). Pure 3-layer resolver:
  1. `resolveGlobalAvailability` — Super Admin: is the feature available at all?
  2. `resolveCompanyEntitlementStatus` — Super Admin: company tri-state
     `disabled` | `trial` | `enabled`.
  3. `resolveEffectiveCompanyStatus` — global gate always collapses to `disabled`.
  - Commercial metadata is first-class: `billingEligible`, `billingLabel`,
    `defaultGlobalEnabled`, `defaultCompanyEnabled`, `supportsTrial`,
    `trialLimit`/`trialLimitType`, plus a declaration-only `limits[]` bundle-merge
    model. This is the **Catalogue / Billing** packaging layer.
- Registered keys: `preferred_time_evaluation`, `media_uploads`, `time_bank`,
  `mission_log`, `time_reporting`, `operational_flags`, `notification_center`,
  `incident_management`, `action_center`, `time_quality_analytics`,
  `payroll_basis`, `invoice_basis`. **No `request_*` / `crm` key exists.**
- The closest billable add-on precedent is `notification_center`
  (`defaultGlobalEnabled: true`, `defaultCompanyEnabled: false`,
  `supportsTrial: true`).
- **Latent (already-typed) bridge seam:** a `ServiceFeatureDefinition` may declare
  `affects?: FeatureSurface[]`, and `FeatureSurface` already includes
  `{ kind: "module"; moduleId: string }`, validated by
  `findInvalidModuleReferences()`. Today this is **Phase 0 diagnostic-only — no
  runtime effect on access/entitlement/navigation**, and **no service currently
  points at a request module.** This is the natural place a future Service→Module
  link attaches *without* inventing anything new.
- Super Admin surfaces: `/services` (`src/pages/superadmin/Services.tsx`, role
  `super_admin` + `settings_templates.manage`), `/entitlement-validation`. Company
  entitlement is curated through the Companies / catalogue surfaces.

### System C — REQUEST CRM `/crm/*` shell (the current bypass)

- `src/App.tsx` — `/crm`, `/crm/dashboard`, `/crm/requests` gated by
  `isRequestCrmShellEnabled()` (env flag `ENABLE_REQUEST_CRM_FRONTEND_SHELL`) +
  `ProtectedRoute allow={["super_admin","company_admin"]} requirePermission="requests.view"`.
  `/crm/settings` + `/crm/settings/:tab` gated by
  `isRequestCrmSettingsShellEnabled()` (master flag **and**
  `ENABLE_REQUEST_CRM_SETTINGS_SHELL`) + `requirePermission="requests.settings.view"`.
- `src/lib/requestCrm/shellNav.ts`, `settingsNav.ts`, `settingsTabs.ts`,
  `src/lib/featureFlags.ts` — flag/permission helpers + nav constants.
  `DashboardLayout`'s "Requests / CRM" section shows for **both** super_admin and
  company_admin purely on flag + permission.
- **Gated by neither System A nor System B.** This is the route-only / flag-only
  path WAVE-003D was stopped for, and the thing this mapping must reconcile.

### Settings-route precedent

- `/settings` (`settings.manage`); `/settings/checklists` + the
  `CHECKLIST_SETTINGS_MODULES.map(...)` sub-routes are the established
  `/settings/<area>` precedent. Request settings currently live at `/crm/settings`,
  **not** at the target `/settings/request` and `/settings/crm`.

### Why the request modules read "Not available"

Per `moduleAccess.ts`, "Not available" = `globally_inactive` (module row missing
or `status !== "active"`) or `not_offered` (`company_modules.available` not true
for the company). In a Supabase-authoritative environment the request modules are
simply not granted/active — a **data/config state inside the existing model**, not
a missing mechanism. (The localStorage demo seed `store.ts seedCompanyModules`
sets every module `available/enabled = true`, which is why this only reproduces in
granted environments.)

---

## 2. Proposed REQUEST CRM service structure

**Recommendation: a service *suite* (System B) with module *children* (System A).**
A single commercial entitlement gates "does this company get REQUEST CRM at all,
and on what plan"; the existing module entries remain the per-capability switches
Company Admin activates. This is option (c) "service suite with module children",
deliberately *not* (b) many billable keys.

Why this shape:

- It matches the product owner's words exactly — "Super Admin controls service
  access through Services / Catalogue / Billing" (one commercial grant) →
  "Company Admin sees available modules in Settings → Modules" (the children).
- One suite key keeps Catalogue/Billing simple and mirrors the existing
  `notification_center` add-on, instead of multiplying billable SKUs.
- The granular children **already exist** in `MODULE_DEFINITIONS`, so activation
  reuses `ModulesPanel` / `canAccessModule` with zero new module registry.

### Recommended keys (names to ratify — **do not implement in this wave**)

Commercial **service** key to ADD to the existing `SERVICE_FEATURE_REGISTRY`
later (System B — *extends* the existing registry, is **not** a parallel model):

- `request_crm` — "REQUEST CRM" suite entitlement. Billable add-on, modelled on
  `notification_center`: `defaultGlobalEnabled: true`, `defaultCompanyEnabled:
  false`, `supportsTrial: true`, `billingEligible: true`. Declares the bridge via
  the existing seam: `affects: [{ kind: "module", moduleId: "admin-requests" },
  { kind: "module", moduleId: "employee-customer-requests" }]`.

Module **children** to REUSE (System A — already in `MODULE_DEFINITIONS`, **no new
modules, no renames**):

- `admin-requests` — Company Admin operational request handling (admin CRM
  workspace).
- `employee-customer-requests` — shared employee/customer request inbox (also the
  anchor for the deferred customer/employee surfaces).

Single-key vs. multi-key is a ratification point (see §7). The suite-with-children
shape is the recommendation; per-module billable keys are explicitly **not**
recommended for v1.

---

## 3. Super Admin responsibility (availability, packaging, governance)

Super Admin is **not** the operational request handler. Super Admin owns
*availability and governance*, expressed through existing surfaces:

- **Global availability** — `modules.status` (System A global) and
  `resolveGlobalAvailability` (System B global). Platform-wide on/off.
- **Company entitlement / "grant access"** — the System B company entitlement
  (`disabled` | `trial` | `enabled`) via Services / Companies / Billing. This is
  the authoritative "this company gets REQUEST CRM" grant.
- **Paid add-ons** — System B `billingEligible` / `supportsTrial` / `trialLimit`
  on `request_crm`, exactly like `notification_center`.
- **Billing / Catalogue packaging** — `SERVICE_FEATURE_REGISTRY` metadata +
  future bundles (`billingLabel`, `limits[]` merge model).
- **Locked / system request types** — Super-Admin-owned, non-company-editable
  request types (`18-settings-configuration.md`: "hard-coded request types").
- **Global request templates** — platform templates following the existing
  `/global-templates` · `/agreement-templates` · `/settings-templates` pattern.
- **Notification templates** — referenced only; **owned by the Automation & AI
  Center** (`25-…`). REQUEST does not own a notification engine. (Not built here.)
- **Auto-action templates** — referenced only; **owned by the Automation & AI
  Center**. (Not built here.)
- **Governance / history / audit** — audit events per `16-security-permissions-audit.md`;
  the Super-Admin override is policy-gated and audited
  (`allow_superadmin_override` → "true with audit").

Everything in this list is *availability, packaging, global templates, or
governance* — never the day-to-day handling of a company's requests.

---

## 4. Company Admin responsibility (the operational owner)

Company Admin is the **primary operational request handler** and owns local
configuration, all *downstream of* a Super-Admin grant:

- **Settings → Modules** — existing `ModulesPanel`; sees `admin-requests` /
  `employee-customer-requests` as available **only** when entitled, and switches
  them on/off (`setModuleEnabled`, System A layer 3).
- **Enable/disable entitled modules** — the activation step; an un-entitled
  module shows the "Not available" lock (no bypass).
- **Settings → Request** (target `/settings/request`) — local request domain
  settings per `18-settings-configuration.md`: categories/subcategories,
  admin-created request types, status/priority/severity labels, SLA defaults,
  owner/support routing defaults, internal post types, email-policy labels,
  visibility defaults, and *links* to the Automation & AI Center (not its rules).
- **Settings → CRM** (target `/settings/crm`) — CRM-specific local configuration
  (pipeline/board/presentation), same ownership boundary.
- **Operational request dashboard / list / inbox** — the `/crm/*` surfaces
  (dashboard, requests), re-gated on module-active (see §6). Company Admin is the
  primary user.
- **Local editable templates / settings where allowed** — company-local request
  templates and the editable subset of settings, as opposed to Super-Admin
  global/locked types and central automation policy.

The boundary is explicit: Company Admin never edits global availability, billing,
locked system types, or central automation/notification/AI policy.

---

## 5. Customer / Employee future scope (deferred)

Documented as **out of scope now**, to be added later behind their own role +
module access — never folded into admin settings:

- **Customer request surface** — the `customer` capability of
  `employee-customer-requests` (and any future `customer-requests` child). Public
  / customer portal exposure is a non-goal here.
- **Employee request surface** — the `employee` capability of the same module (and
  any future `employee-requests` child).
- **Role-specific notification / request UX** — per-role inboxes and notification
  presentation; gated by `allowedUserTypes` + future role permissions, with
  delivery owned centrally by the Automation & AI Center.

These remain separate from `/settings/request` and `/settings/crm`, which are
admin-only.

---

## 6. Route visibility model

### Current routes and gates

| Route | Current gate | Follows model? |
|---|---|---|
| `/crm`, `/crm/dashboard`, `/crm/requests` | `ENABLE_REQUEST_CRM_FRONTEND_SHELL` env flag + `requests.view` + roles | No — env-flag/route-only **bypass** |
| `/crm/settings`, `/crm/settings/:tab` | master + `ENABLE_REQUEST_CRM_SETTINGS_SHELL` env flags + `requests.settings.view` | No — env-flag/route-only **bypass** |
| `/modules/employee-customer-requests` | `canAccessModule(...)` via `ModulePage` | Yes — System A |
| `/modules/admin-requests` | `canAccessModule(...)` via generic `/modules/:moduleId` (no nav) | Yes — System A |

### Routes that bypass the intended model

All `/crm/*` routes. They gate on a build-time env flag + role + permission, never
on `canAccessModule`, so a company that is not entitled/active can still be inside
the operational surface in a preview build.

### Recommended future route-gating principle (reuse the existing pattern)

Gate every request operational and settings route with the **same predicate the
module model already uses** — `canAccessModule(user, <requestModuleKey>)` **AND**
the existing permission — exactly like `ModulePage` and `/modules/...` do today:

- `/crm/dashboard`, `/crm/requests` → `canAccessModule(user, "admin-requests")` +
  `requires requests.view`.
- `/settings/request`, `/settings/crm` (relocated from `/crm/settings`) →
  `canAccessModule(user, "admin-requests")` + `requires requests.settings.view`,
  mirroring the `/settings/checklists` precedent.
- The module's *availability* is itself driven by the Super-Admin **`request_crm`
  entitlement** (System B) through the bridge seam, so the full product chain
  (Services/Billing grant → module available → Company Admin activates → surfaces
  appear) holds end-to-end with no new mechanism.
- The `ENABLE_REQUEST_CRM_*` env flags stop being the *access* gate. They may
  survive only as a temporary build-time rollout kill switch, never as
  authorization.

This keeps request gating identical in shape to every other module surface and
removes the bypass.

---

## 7. Gaps and decision points (ratify before implementation)

1. **Service shape** — confirm a single `request_crm` suite entitlement
   (recommended) vs. multiple per-module billable keys.
2. **Bridge semantics** — when `request_crm` is entitled for a company, does the
   linked module become **available automatically** (recommended — single grant,
   matches the product chain) or is entitlement only a **precondition** that still
   requires a separate Platform-Modules availability toggle (double grant)? This
   also decides the fate of System A's per-company availability toggle for request
   modules (derive it vs. keep it manual).
3. **Module → surface mapping** — which module governs which surface. Recommended:
   `admin-requests` gates the admin operational CRM workspace (`/crm/*` +
   `/settings/request` + `/settings/crm`); `employee-customer-requests` gates the
   shared inbox and the deferred customer/employee surfaces. Confirm or adjust.
4. **Competing surfaces** — reconcile `/crm/*` vs. the existing
   `/modules/employee-customer-requests` `ModulePage`. Recommended: `/crm/*`
   becomes the canonical operational workspace; the `/modules/...` entry redirects
   there (or is retired). Confirm.
5. **Settings relocation** — move `/crm/settings` → `/settings/request` +
   `/settings/crm`, and confirm the Super-Admin-global vs. Company-Admin-local
   split per `18-settings-configuration.md`.
6. **Env-flag retirement** — confirm `ENABLE_REQUEST_CRM_*` is demoted from access
   gate to (at most) a temporary rollout switch.
7. **Central ownership reaffirmation** — confirm Notification / Auto-action / AI
   templates stay owned by the Automation & AI Center and remain outside the
   REQUEST service/module mapping (consistent with "do not build Notification
   Center / Auto-Action Center").
8. **Packaging defaults** — confirm `request_crm` billing/trial defaults mirror
   `notification_center`.

None of these require inventing a parallel model: every recommended answer reuses
System A + System B (and the existing `affects` seam). The decisions are product
packaging + surface-reconciliation choices, which is why they are ratified, not
guessed.

---

## 8. Recommended next smallest safe implementation wave

Sequence, smallest reversible step first:

1. **Decision ratification (no code)** — product/architecture sign-off on §7
   (carry forward the open decision from WAVE-003D-R). Implementation stays gated
   on this.
2. **WAVE-003F — `request_crm` registry key + declared module bridge
   (registry-only, zero runtime/authz change).** After ratification, add the
   `request_crm` `ServiceFeatureKey` to the **existing** `SERVICE_FEATURE_REGISTRY`
   with `affects` pointing at the two request modules (the **existing
   diagnostic-only seam** — still no runtime effect), plus unit tests. This is
   purely additive, fully reversible, changes no gate, and proves the catalogue
   shape before anything is wired.
3. **Later wave (separate)** — activate the entitlement → module-availability
   bridge and re-gate `/crm/*` + relocate settings to `/settings/request` /
   `/settings/crm` on `canAccessModule(...)` + permission, retiring the env-flag
   access gate. This is the first wave that touches runtime gating and must follow
   its own focused ticket.

This ordering means the first code wave after ratification carries near-zero risk
and no authorization change, with each subsequent step independently verifiable.

---

## 9. Stop-condition check (why this is a blueprint, not BLOCKED)

The wave's stop conditions are: stop if the mapping would require inventing a
parallel entitlement model, bypassing Services → Modules, or mixing Super Admin
governance with Company Admin operational UX. None is triggered:

- **No parallel model** — the mapping reuses System B (Service entitlement) +
  System A (Module access) + the existing `affects` module-surface seam. Adding
  one key to an existing registry is *using* the model, not duplicating it.
- **No bypass** — the mapping routes REQUEST CRM *through* Services → Modules and
  explicitly retires the env-flag/route-only bypass.
- **No mixing** — §3 (Super Admin: availability/packaging/governance) and §4
  (Company Admin: operations/local settings) are a clean, explicit split.

Therefore the deliverable is a completed architecture/planning blueprint with a
clear recommendation; *implementation* remains gated on ratifying the §7 decision
points.

---

## 10. Implementation note — WAVE-003G-R (Super Admin Request Settings foundation)

A first **Super Admin Settings → Request** surface now exists as a frontend/mock,
configuration/governance-only foundation. It realizes the §3 Super-Admin side of
the boundary (availability/packaging/governance), without touching the §6 route
model, the Service→Module bridge, or any runtime gating.

- **Exists / scope:** Super-Admin-only page `src/pages/superadmin/RequestSettings.tsx`,
  reached via the top-level route `/request-settings`
  (`ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage"`)
  and a `"Request Settings"` item in the existing sidebar **Settings** section
  (`DashboardLayout`). It reuses the established Super Admin settings/page/nav
  patterns — **no parallel settings framework**.
- **Global/system/governance-only:** the page shows placeholders/mock data —
  global/system request types, locked default statuses and priorities, SLA
  templates, global/system request templates (locked vs. copyable-later), a
  governance/audit placeholder, and clearly-labelled **Future** references to
  Notification templates, Auto-Action templates, and the Automation & AI Center.
  No operational request handling is wired.
- **Tied to Admin Requests:** the surface is the governance home for the
  `admin_requests` product (badge `Admin Requests`); it does not resolve the
  entitlement or alter module availability.
- **Route separation:** `/request-settings` is a Super Admin top-level route,
  deliberately distinct from the **future Company Admin local `/settings/request`**
  (§4). The two owners never share a route.
- **Still future scope (unchanged by this wave):** Company Admin Settings →
  Request / Settings → CRM; the operational request handler (dashboard/list/
  inbox/detail/assignment/status/comments); the deferred
  `employee_customer_requests` product and customer/employee surfaces; and the
  Notification Center / Auto-Action Center, which remain **separate systems**
  owned by the Automation & AI Center.
- **No bridge / no gating change:** the entitlement→module-availability bridge and
  `/crm/*` re-gating remain the later, separate **WAVE-003G**, still gated on the
  §7 ratification.

---

## 11. Implementation note — WAVE-003H-R (Admin Requests Service → Module availability bridge)

The §7.2 "bridge semantics" decision is now **partially realized** for Admin
Requests only: a company's effective `admin_requests` entitlement makes the
`admin-requests` module **available automatically** (the recommended single-grant
shape), while the `/crm/*` re-gating and settings relocation of §6 / §8.3 remain
deferred.

- **Bridge seam (new):** `src/lib/serviceModuleBridge.ts`. An explicit allow-list
  `SERVICE_MODULE_BRIDGE = [{ serviceKey: "admin_requests", moduleId:
  "admin-requests" }]` — NOT a broad derivation from every registry `affects`
  entry, so the Phase 0 diagnostic seam (§System B) never silently becomes runtime
  access. `resolveModuleEntitlementAvailability()` returns `undefined` for
  un-bridged modules and `resolveEffectiveCompanyStatus(...) !== "disabled"` for
  bridged ones. `validateServiceModuleBridge()` guards each entry against the
  service's registry `affects` + the module catalogue.
- **Resolver reuse (no third system):** `src/lib/moduleAccess.ts`
  `resolveCompanyModuleState` gained an optional `entitlementAvailability` feeding
  **Layer 2 (company available)**; `undefined` ⇒ the raw `company_modules.available`
  flag, so every other module is unchanged. Layer 1 (global status) still wins;
  Layer 3 (Company Admin local toggle) stays separate — the bridge never
  auto-enables.
- **Surfaces:** wired through `AppContext.canAccessModule` (+ new
  `getModuleEntitlementAvailability`), the Company Admin `ModulesPanel`, and the
  Super Admin `PlatformModulesPanel` (the bridged module's manual availability
  toggle is disabled and annotated "set by the {service} service"), so all three
  read one resolver and cannot diverge.
- **Scope kept narrow:** `admin_requests`→`admin-requests` only;
  `employee-customer-requests` is untouched (deferred `employee_customer_requests`
  product); no `/crm/*` re-gating, no `/crm/settings` relocation, no shell-flag
  change, no backend/migration, no new entitlement or module model.
- **Still deferred:** the §6 route re-gating of `/crm/*` on
  `canAccessModule("admin-requests")` + permission, the env-flag retirement, the
  Company Admin `/settings/request` · `/settings/crm` relocation, the operational
  request handler, and the `employee_customer_requests` product — each its own
  future wave.
