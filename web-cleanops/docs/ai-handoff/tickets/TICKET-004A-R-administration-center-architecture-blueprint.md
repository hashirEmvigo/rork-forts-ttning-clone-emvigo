# TICKET-004A-R — Administration Center Architecture Blueprint + Handoff State Alignment

## Status

DONE — documentation-only planning ticket completed in WAVE-004A-R.

## Wave

WAVE-004A-R — Administration Center architecture blueprint + handoff state alignment

## Repository source of truth

- Active repository: `RiosBioz/Keymaster`
- Historical/archive repository: `RiosBioz/Stadportalen`
- Rule: use `RiosBioz/Keymaster` for future RORK tickets/waves unless explicitly overridden.

## Purpose

Create a controlled Administration Center architecture blueprint before implementation and align stale handoff state after WAVE-003L-R.

## Execution mode

Documentation-only / architecture-only.

## Scope completed

- Created the Administration Center architecture blueprint at `web-cleanops/docs/architecture/administration-center/01-administration-center-architecture-blueprint.md`.
- Defined current-state summary, recommended IA, Super Admin vs Company Admin boundaries, route strategy, permission strategy, search/registry strategy, risks, phased ticket plan, recommended first implementation ticket, and explicit non-goals.
- Aligned stale handoff state so `01-current-objective.md` and `02-rork-inbox.md` no longer point to WAVE-003J-R after WAVE-003L-R completion.
- Updated the ticket registry and verification report for this planning wave.
- Added architecture index links to the new blueprint.

## Current-state summary

The app already has established administration surfaces and boundaries:

- Super Admin platform surfaces: Companies, Users, Services, Media Center, Calculator, Settings Templates, Agreement Templates, Platform Settings, Request Settings, System Performance, Development Center, Employee Migration, and template/governance areas.
- Company Admin surfaces: local Settings, `/settings/request`, operational Admin Requests under `/crm/*`, company users/customers/employees/scheduling/operations, and module-owned operational pages.
- Admin Requests operational routes already use the existing `/crm/*` shell, existing `requests.view` permission model, and existing `admin-requests` module seam.
- Super Admin Request Settings (`/request-settings`) and Company Admin Request Settings (`/settings/request`) are intentionally separate.
- REQUEST CRM settings routes (`/crm/settings`, `/crm/settings/:tab`) remain distinct and must not be relocated.

## Recommended Administration Center IA

Administration Center should start as a Super Admin hub with grouped links to existing canonical destinations:

1. Platform control — Companies, Users, Platform Settings, System Performance, Development Center, Employee Migration.
2. Services and modules — Services, module availability/status references, Admin Requests service/module references.
3. Templates and libraries — Settings Templates, Agreement Templates, Checklist Manager / Global Templates, Media Center.
4. Request and communication governance — `/request-settings`, `/crm/settings`, `/crm/settings/:tab`, and display-only references to Admin Requests operations and Automation & AI Center governance.
5. Operational references — links to existing operational areas, clearly labeled by ownership and not embedded into the Super Admin hub.

Administration Center is a finder/governance hub, not a new source of truth.

## Super Admin vs Company Admin boundaries

Super Admin owns platform governance, service/module availability, global templates, global request governance, diagnostics, and platform libraries.

Company Admin owns company-local settings, `/settings/request`, operational Admin Requests under `/crm/*`, and company-scoped operational work.

Boundary rules:

- Do not let Super Admin bypass Company Admin operational seams.
- Do not move Company Admin settings into the Super Admin hub.
- Existing destination routes remain authoritative.
- Cross-links must label destination ownership clearly.

## Route strategy

Recommended future route: `/administration`.

Route rules:

- Add at most one Super Admin hub route in the first implementation ticket.
- Do not move existing routes.
- Do not redirect existing admin routes through the hub.
- Do not create nested replacement routes.
- Existing canonical destination routes remain unchanged.

## Permission strategy

First implementation should use existing access seams only:

- Super Admin role boundary for the hub.
- Existing permissions for destination link visibility where already applicable.
- Existing destination route guards remain authoritative.

Do not add new permission keys, entitlements, module models, or access-control layers in the first implementation ticket.

## Search / registry strategy

A later implementation may introduce a display-only destination registry with metadata such as id, label, description, group, canonical path, owner role, existing permission, module dependency, keywords, and status.

Registry/search rules:

- Registry is discovery metadata only.
- Registry must not define permissions.
- Registry must not bypass route guards or `canAccessModule`.
- Search should start as local client-side filtering only.
- No backend search, Supabase tables, analytics, AI search, or activity logs.

## Risks

- Parallel settings system risk.
- Permission drift risk.
- Route churn risk.
- Super Admin / Company Admin boundary risk.
- Admin Requests regression risk.
- Calculator V2 interruption risk.
- Automation & AI scope creep risk.
- Repository confusion risk.

Mitigation: start with a hub-only planning/implementation sequence and preserve all existing routes, surfaces, permissions, modules, and runtime behavior.

## Phased ticket plan

1. `TICKET-004A-R` — Architecture blueprint + handoff alignment. Documentation-only. DONE.
2. `TICKET-004B-R` — Administration Center Super Admin hub shell. Recommended first implementation ticket.
3. `TICKET-004C-R` — Display-only administration destination registry.
4. `TICKET-004D-R` — Local hub search/filter foundation.
5. `TICKET-004E-R` — Cross-area status summaries.
6. `TICKET-004F-R` — Governance hardening review.

## Recommended first implementation ticket after 004A

`TICKET-004B-R — Administration Center Super Admin hub shell`

Recommended scope:

- Add one Super Admin-only `/administration` hub route.
- Add one sidebar entry only if explicitly approved and consistent with existing navigation patterns.
- Render static cards linking to existing canonical destinations.
- Use existing design-system components and route guards.

## Explicit non-goals for first implementation ticket

- No replacement of existing settings pages.
- No route moves or redirects.
- No nested Administration Center subroutes.
- No changes to `/crm/*`, `/crm/settings`, `/crm/settings/:tab`, `/request-settings`, or `/settings/request`.
- No Calculator V2 runtime work.
- No Automation & AI runtime work.
- No Services, Media Center, Templates, CRM runtime, Admin Requests runtime, or Company Admin operational behavior changes.
- No new permissions, modules, entitlements, feature flags, backend services, Supabase tables/RPC/policies, migrations, package changes, or config changes.
- No search registry unless explicitly rescoped.
- No persistence, analytics, activity logs, notifications, automation, or AI.
- Do not use `RiosBioz/Stadportalen`.

## Verification

No tests were run because this was documentation-only and no documentation lint/check was identified or required by the ticket.

## Files created/updated

- `web-cleanops/docs/architecture/administration-center/01-administration-center-architecture-blueprint.md`
- `web-cleanops/docs/ai-handoff/tickets/TICKET-004A-R-administration-center-architecture-blueprint.md`
- `web-cleanops/docs/ai-handoff/01-current-objective.md`
- `web-cleanops/docs/ai-handoff/02-rork-inbox.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`
- `web-cleanops/docs/architecture/README.md`
- `web-cleanops/docs/architecture/00-architecture-index.md`
