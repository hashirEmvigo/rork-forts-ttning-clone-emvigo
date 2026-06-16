# TICKET-004B-R — Super Admin Administration Center Hub Foundation

## Status
DONE

## Wave
WAVE-004B-R — Super Admin Administration Center hub foundation

## Repository source of truth
- Active repository: `RiosBioz/Keymaster`
- Historical/archive repository: `RiosBioz/Stadportalen`
- Rule: future RORK waves and tickets must use `RiosBioz/Keymaster` unless explicitly overridden in writing.

## Purpose
Implement the first narrow Administration Center product slice: a Super Admin-only hub page that organizes existing administration surfaces and links to existing canonical routes.

The Administration Center starts as a finder/navigation hub. It is not a replacement for existing settings pages, routes, CRM/Admin Requests, Calculator, Automation & AI, Services, Media, Templates, modules, permissions, entitlements, or Company Admin operational surfaces.

## Implementation summary
- Added a new Super Admin hub page at `/administration`.
- Added one route guarded by the existing `ProtectedRoute` role/permission pattern:
  - `allow={["super_admin"]}`
  - `requirePermission="settings_templates.manage"`
- Added one Super Admin sidebar entry in the existing `DashboardLayout` navigation composition.
- Rendered the required hub categories:
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
- Existing surfaces render as links to existing known routes only.
- Future/unresolved surfaces render as disabled planned/later-slice actions.

## Existing route links included
Examples of linked existing destinations:
- `/companies`
- `/users`
- `/settings?tab=roles`
- `/settings?tab=modules`
- `/settings?tab=categories`
- `/settings?tab=navigation`
- `/settings?tab=audit`
- `/services`
- `/calculator`
- `/media-center`
- `/settings-templates`
- `/agreement-templates`
- `/modules/checklist-manager`
- `/system-performance`
- `/development-center`
- `/employee-migration`
- `/request-settings`
- `/crm/settings`
- `/entitlement-validation`
- `/system-settings`

## Boundaries preserved
- No existing routes were moved or renamed.
- No new Administration Center subroutes were added.
- No search registry or command search was implemented.
- No new permissions, modules, entitlements, feature flags, package files, or config files were added.
- No backend, Supabase, persistence, activity-log, notification, automation, or AI behavior was added.
- No Admin Requests runtime, CRM runtime, Calculator runtime, Automation & AI runtime, Services runtime, Media runtime, Templates runtime, or Company Admin operational behavior was changed.

## Tests
Focused vitest command:

```txt
bunx vitest run \
  src/pages/superadmin/AdministrationCenter.test.tsx \
  src/components/layout/DashboardLayout.administration-nav.test.tsx \
  src/components/layout/DashboardLayout.calculator-nav.test.tsx \
  src/components/layout/DashboardLayout.main-nav-overrides.test.tsx
```

Result:

```txt
Test Files 4 passed (4)
Tests 19 passed (19)
```

## Verification
Full `runChecks({ appPath: "web-cleanops" })` must be recorded in `docs/ai-handoff/06-verification-report.md` after the final validation run.

## Next recommended ticket
TICKET-004C-R — Display-only Administration Center destination registry.

It should add pure metadata for existing destinations only and must not become an authorization model, backend search, analytics surface, AI feature, or activity-log writer.
