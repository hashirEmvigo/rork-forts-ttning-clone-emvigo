# Administration Center Architecture Blueprint

## Ticket

TICKET-004A-R — Administration Center Architecture Blueprint + Handoff State Alignment

## Status

Documentation-only architecture blueprint. No product implementation is authorized by this file.

## Repository source of truth

- Active repository: `RiosBioz/Keymaster`
- Historical/archive repository: `RiosBioz/Stadportalen`
- Rule: future RORK waves and tickets must use `RiosBioz/Keymaster` unless explicitly overridden in writing.

## Purpose

Define a controlled architecture direction for a future Administration Center before any route, navigation, permission, UI, registry, backend, or runtime implementation begins.

The Administration Center should start as a **Super Admin hub** that helps platform operators find and understand existing administration surfaces. It must not replace, relocate, or rewrite existing settings, operational routes, CRM/Admin Requests, Calculator V2, Automation & AI Center, Services, Media Center, Templates, or Company Admin settings.

## Current-state summary

The current app already has multiple administration surfaces distributed across established route and navigation seams:

- Super Admin platform surfaces include Companies, Users, Services, Media Center, Calculator, Settings Templates, Agreement Templates, Platform Settings, Request Settings, System Performance, Development Center, Employee Migration, and related template/governance pages.
- Company Admin operational and local settings surfaces include Settings, Request Settings at `/settings/request`, Admin Requests operational routes under `/crm/*`, users/customers/employees/planning areas, and module-driven operational pages.
- Admin Requests already has a controlled operational shell at `/crm`, `/crm/dashboard`, and `/crm/requests`, gated by existing `requests.view` access plus the existing `admin-requests` module seam.
- Super Admin request governance exists separately at `/request-settings`.
- Company Admin local request settings exist separately at `/settings/request`.
- REQUEST CRM settings/preview surfaces such as `/crm/settings` and `/crm/settings/:tab` remain distinct from operational Admin Requests and must not be relocated by an Administration Center.
- Navigation presentation is already partially configurable through the Navigation & Menus presentation layer, but that layer is not a permission system and must not become one.

## Recommended Administration Center information architecture

### IA goal

Create one Super Admin landing hub that organizes existing administration areas by ownership and purpose, without moving or replacing them.

### Recommended hub groups

1. **Platform control**
   - Companies
   - Users / provisioning
   - Platform Settings
   - System Performance
   - Development Center
   - Employee Migration

2. **Services and modules**
   - Services
   - Platform Modules / module availability surfaces where already present
   - Admin Requests service/module status references
   - Future service-to-module diagnostics, if approved later

3. **Templates and libraries**
   - Settings Templates
   - Agreement Templates
   - Checklist Manager / Global Templates
   - Media Center

4. **Request and communication governance**
   - Super Admin Request Settings at `/request-settings`
   - REQUEST CRM settings shell at `/crm/settings` and `/crm/settings/:tab`
   - Admin Requests operational links as references only, not a Super Admin replacement for Company Admin work
   - Automation & AI Center references as governance/future-runtime links only

5. **Operational references**
   - Links to existing operational areas for context, clearly marked as owned by Company Admin or module operations where applicable.
   - No operational workflows should be embedded into the Super Admin hub in the first implementation slice.

### IA rule

Administration Center is a **finder and governance hub**, not a new source of truth. The canonical behavior stays in the existing destination pages.

## Super Admin vs Company Admin boundaries

### Super Admin owns

- Platform-level governance and configuration.
- Service catalogue and entitlement/module availability governance.
- Global templates and global request governance.
- Platform diagnostics, system performance, and Development Center readouts.
- Media and template libraries that affect global/public/platform assets.

### Company Admin owns

- Company-local settings and operations.
- Company Request Settings at `/settings/request`.
- Admin Requests operational work under `/crm/*` when the company has the `admin-requests` module and the user has existing request permissions.
- Local users/customers/employees/scheduling/operations inside the company context.

### Boundary rules

- The Administration Center must not let Super Admin perform Company Admin operational request work by bypassing the existing module seam.
- Company Admin settings must not be moved into the Super Admin Administration Center.
- Existing role-specific destination routes remain authoritative.
- Any cross-link from the hub must be explicit about ownership: “Platform governance”, “Company-local settings”, or “Operational area”.

## Route strategy

### Recommended future route

Use one future Super Admin hub route, for example:

- `/administration`

This route should be introduced only in a later implementation ticket.

### Route principles

- Do not create nested replacement routes for existing pages.
- Do not move existing routes.
- Do not redirect existing admin routes through the hub.
- Do not create a parallel settings system.
- Hub cards should link to existing canonical destinations.
- Existing routes remain canonical:
  - `/services`
  - `/media-center`
  - `/calculator`
  - `/settings-templates`
  - `/agreement-templates`
  - `/system-settings`
  - `/request-settings`
  - `/system-performance`
  - `/development-center`
  - `/employee-migration`
  - `/crm/settings`
  - `/crm/settings/:tab`
  - `/settings/request`
  - `/crm`, `/crm/dashboard`, `/crm/requests`

### First implementation route scope

The first implementation ticket after this blueprint should add at most one Super Admin hub route and one sidebar entry, if explicitly approved. It should not add subroutes, routing redirects, or route ownership changes.

## Permission strategy

### First implementation recommendation

Use existing access seams only:

- Super Admin role boundary for the hub.
- Existing permissions for destination links and visibility, such as `settings_templates.manage`, `calculator.manage`, `requests.view`, and `requests.settings.view` where they already apply.
- Existing route guards remain responsible for enforcing destination access.

### Permission rules

- No new permission key in the first implementation ticket.
- No new entitlement model.
- No new module model.
- No new access-control layer.
- A hub link may be hidden or marked unavailable based on existing permissions, but clicking a link must still rely on the existing destination route guard.
- Navigation & Menus remains presentation-only and must not become authorization.

### Later permission consideration

If the Administration Center later becomes more than a hub, a future ADR/ticket may consider a dedicated permission. That must be explicit, reviewed, and separate from the first implementation ticket.

## Search and registry strategy

### Recommended registry shape for future implementation

A future Administration Center can use a small display-only registry of existing admin destinations. Each entry should describe discovery metadata, not authority:

- `id`
- `label`
- `description`
- `group`
- `canonicalPath`
- `ownerRole`: Super Admin, Company Admin, or shared reference
- `requiredExistingPermission`
- `moduleDependency` when already established
- `keywords`
- `status`: available, reference-only, future, or later-slice

### Registry rules

- Registry entries must point to existing canonical routes.
- Registry must not define permissions.
- Registry must not bypass `ProtectedRoute` or `canAccessModule`.
- Registry must not duplicate Navigation & Menus as an alternate sidebar system.
- Registry should be easy to test as pure metadata before any UI uses it.

### Search rules

- First search implementation, if approved, should be local/client-side filtering over the display-only registry.
- No backend search.
- No Supabase search table.
- No analytics or activity-log writes.
- No AI search.
- Search results must clearly label cross-role references and unavailable destinations.

## Risks

1. **Parallel settings system risk** — A broad Administration Center could accidentally become a second settings framework. Mitigation: hub-only first, links to canonical pages only.
2. **Permission drift risk** — A registry could become a hidden authorization layer. Mitigation: registry is discovery metadata only; route guards remain authoritative.
3. **Route churn risk** — Moving existing pages would break established waves and tests. Mitigation: no route moves or redirects in first implementation.
4. **Super Admin / Company Admin boundary risk** — A hub could blur platform governance and company operations. Mitigation: group by ownership and label destination authority.
5. **Admin Requests regression risk** — Admin Requests has recently been built in narrow waves. Mitigation: preserve `/crm/*`, `/request-settings`, `/settings/request`, `/crm/settings`, and `/crm/settings/:tab` unchanged.
6. **Calculator V2 interruption risk** — Documentation context may reference Calculator V2, but this blueprint must not resume calculator work. Mitigation: only link/reference Calculator as an existing Super Admin surface.
7. **Automation & AI scope creep risk** — A hub could imply runtime automation. Mitigation: Automation & AI references remain display/navigation/governance only until a separate runtime ticket.
8. **Repository confusion risk** — Old `RiosBioz/Stadportalen` must not be used. Mitigation: all handoff docs continue to name `RiosBioz/Keymaster` as active.

## Phased ticket plan

### TICKET-004A-R — Architecture blueprint + handoff alignment

Status: documentation-only planning ticket.

- Create this blueprint.
- Create the ticket handoff record.
- Align stale handoff state after WAVE-003L-R.
- No app code, routes, UI, permissions, tests, package/config, backend, Supabase, or runtime changes.

### TICKET-004B-R — Administration Center Super Admin hub shell

Recommended first implementation ticket after 004A.

- Add one Super Admin-only hub route, likely `/administration`.
- Add one sidebar/navigation entry only if it follows the existing `DashboardLayout` and permission patterns.
- Render static hub cards linking to existing canonical destinations.
- Use existing design-system components and existing route guards.
- No search registry yet unless explicitly included as display-only static metadata.

### TICKET-004C-R — Display-only administration destination registry

- Add a pure metadata registry for existing admin destinations.
- Include ownership, existing permissions, canonical routes, status labels, and keywords.
- Add focused metadata tests.
- Do not use the registry for authorization.

### TICKET-004D-R — Local hub search/filter foundation

- Add client-side filtering over the display-only registry.
- No backend, Supabase, analytics, AI, or activity logging.
- Keep route guards authoritative.

### TICKET-004E-R — Cross-area status summaries

- Add read-only status cards using existing local/mock/frontend-safe data only.
- Do not add new writes, diagnostics RPCs, telemetry collection, or backend calls.
- Any real status integration requires separate approval.

### TICKET-004F-R — Governance hardening review

- Review whether the hub should remain Super Admin-only discovery or needs a formal governance model.
- Consider ADR only if the hub begins to affect behavior, permissions, or platform operations.

## Recommended first implementation ticket after 004A

**TICKET-004B-R — Administration Center Super Admin hub shell**

Reason: it is the narrowest useful product slice. It creates a discoverable Super Admin landing surface while preserving all existing destinations as the source of truth.

## Explicit non-goals for TICKET-004B-R

- Do not replace existing settings pages.
- Do not move routes.
- Do not create nested Administration Center subroutes.
- Do not change `/crm/*`, `/crm/settings`, `/crm/settings/:tab`, `/request-settings`, or `/settings/request`.
- Do not change Calculator V2 work or calculator runtime.
- Do not change Automation & AI runtime.
- Do not change Services, Media Center, Templates, CRM runtime, Admin Requests runtime, or Company Admin operational behavior.
- Do not add new permissions, modules, entitlements, feature flags, backend services, Supabase tables/RPC/policies, migrations, package changes, or config changes.
- Do not implement search registry yet unless explicitly rescoped.
- Do not add persistence, analytics, activity logs, notifications, automation, or AI.
- Do not use `RiosBioz/Stadportalen`.

## Planning-wave recommendation

Yes. Administration Center should start as a planning-wave because it crosses multiple existing admin domains, navigation patterns, permissions, and ownership boundaries. Implementation should begin only after this blueprint is accepted and a narrow TICKET-004B-R prompt is explicitly approved.
