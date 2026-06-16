# TICKET-004C-R — Administration Center Registry & Search Foundation

## Status
DONE

## Wave
WAVE-004C-R — Administration Center registry and search foundation

## Repository source of truth
- Active repository: `RiosBioz/Keymaster`
- Historical/archive repository: `RiosBioz/Stadportalen`
- Rule: future RORK waves and tickets must use `RiosBioz/Keymaster` unless explicitly overridden in writing.

## Purpose
Implement the next narrow Administration Center slice after WAVE-004B-R: a frontend-only registry for Administration Center items and a simple local search field on the existing `/administration` Super Admin hub.

The registry is discovery/display metadata only. It is not a permission model, route registry replacement, backend search service, command palette, analytics system, activity-log writer, or new settings framework.

## Implementation summary
- Created `src/lib/administrationCenter/administrationCenterRegistry.ts`.
- Defined the Administration Center category order:
  - Companies & Users
  - Access & Permissions
  - Modules & Navigation
  - Services & Pricing
  - Content & Website
  - Templates
  - Operational Registers
  - Requests & CRM
  - Plans & Entitlements
  - Platform Settings
  - Governance & Logs
- Added registry metadata for active and planned Administration Center items:
  - `id`
  - `title`
  - `category`
  - `description`
  - optional `route`
  - `breadcrumb`
  - `keywords`
  - `aliases`
  - `status: active | planned`
  - `scope: super_admin | company_admin | global | future`
  - existing permission metadata/access note
  - related item IDs where useful
- Refactored `src/pages/superadmin/AdministrationCenter.tsx` so the hub sections/items render from the registry rather than duplicated page-local item arrays.
- Added a local search field and grouped search results on `/administration`.
- Added calculator-related search metadata so terms like `calculator`, `price calculator`, `pricing`, `quote`, `quotation`, `estimate`, `service price`, and `public calculator` find the relevant calculator/pricing items.

## Search behavior
- Local frontend search only.
- Searches title, description, category, breadcrumb, keywords, aliases, existing permission metadata, and access notes.
- Groups results by Administration Center category.
- Shows breadcrumbs such as `Services & Pricing → Calculator builder`.
- Active items link to existing known routes.
- Planned items remain disabled/non-clickable.

## Boundaries preserved
- No backend/search service was added.
- No command palette, Cmd+K, or quick actions were added.
- No new permissions, access model, module model, entitlement model, package files, or config files were added.
- No existing routes were moved, renamed, or redirected.
- No Company Admin navigation was changed.
- No Supabase, persistence, analytics, activity-log, notification, automation, or AI behavior was added.
- No CRM/Admin Requests runtime, Calculator runtime, Automation & AI runtime, Services runtime, Media runtime, Templates runtime, or Company Admin operational behavior was changed.

## Tests
Focused vitest command:

```txt
bunx vitest run \
  src/lib/administrationCenter/administrationCenterRegistry.test.ts \
  src/pages/superadmin/AdministrationCenter.test.tsx \
  src/components/layout/DashboardLayout.administration-nav.test.tsx
```

Result:

```txt
Test Files 3 passed (3)
Tests 18 passed (18)
```

## Verification
Full `runChecks({ appPath: "web-cleanops" })` was run and failed with the known 25 unrelated TypeScript baseline errors documented in `docs/ai-handoff/06-verification-report.md`. None are in WAVE-004C-R changed source/test files.

## Next recommended ticket
A later narrow ticket may add registry maintenance/documentation guardrails or duplicate-ID/duplicate-route metadata tests. It should remain frontend-only unless a future prompt explicitly authorizes broader behavior.
