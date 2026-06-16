# TICKET-MEDIA-004-R — Company Admin Settings Media Library Foundation

## Status
DONE

## Wave
WAVE-MEDIA-004-R — Company Admin settings media library foundation

## Repository
- Active repository: `RiosBioz/Keymaster`
- Historical/archive/frozen repository: `RiosBioz/Stadportalen`
- Old repository was not used.

## Execution mode
Narrow frontend/settings foundation slice.

## Context
TICKET-MEDIA-001-R fixed Super Admin global Media Center archive/remove semantics so global source assets are archived instead of hard-deleted.

TICKET-MEDIA-002-R grouped Super Admin Media Center Images into category sections using existing Asset Center category metadata.

TICKET-MEDIA-003-R added the shared Company Admin media data-access foundation separating read-only Super Admin global assets from company-owned local assets.

This ticket creates the first Company Admin Settings entry point for that foundation at `/settings/media`.

## Investigation summary
- No existing Company Admin Media Center route/page existed.
- Company Admin Settings already has a settings hub at `/settings` using `PageMenuTiles` for internal settings sections.
- The safest product placement is therefore an internal Company Admin Settings tile linking to a dedicated settings route at `/settings/media`, not a new global sidebar item.
- MEDIA-003 data-access helpers are safe to consume for read-only/listing behavior.
- Existing company upload/archive data-access functions exist, but there was no existing Company Admin Settings upload/manage workflow to reuse without broadening this ticket. Upload/manage controls were therefore intentionally deferred on the page.

## Implemented behavior
- Added Company Admin Settings → Media Library at `/settings/media`.
- Added a Company Admin-only settings nav helper for the route and Settings tile visibility.
- Added a Media Library tile inside the existing Company Admin Settings hub.
- The new page clearly separates:
  - **Global library** — Super Admin-provided, read-only assets.
  - **Company library** — company-owned assets for the current company.
- Both libraries reuse the existing category grouping helper:
  - Cleaning protocols
  - Services
  - Website / Public places
  - General folder
- Global assets render as read-only/selectable when active and expose no archive/delete actions.
- Company-owned assets render separately from global assets.
- Unknown/missing category ids fall back through the existing General folder behavior.
- Company upload/manage is shown as a disabled "Upload coming later" foundation control with a clear empty-state note.
- The page subtly notes future company-level hiding of global assets.

## Files changed
- `src/App.tsx`
  - Added `/settings/media` route guarded by `allow={["company_admin"]}` and existing `settings.manage` permission.
- `src/lib/assets/companyMediaSettingsNav.ts`
  - New settings route/nav helper for Company Admin Media Library visibility.
- `src/lib/assets/companyMediaSettingsNav.test.ts`
  - New focused tests for path, existing permission reuse, and Company Admin-only nav visibility.
- `src/pages/Settings.tsx`
  - Added Company Admin-only Media Library tile inside the existing Settings hub.
  - Tile links to `/settings/media`; no global sidebar item was added.
- `src/pages/Settings.menu-tiles.test.tsx`
  - Updated Settings tile tests to verify the Company Admin Media Library tile and link.
- `src/pages/settings/MediaLibrary.tsx`
  - New Company Admin Settings Media Library foundation page.
- `src/pages/settings/MediaLibrary.test.tsx`
  - New focused page and route guard tests.
- `docs/ai-handoff/tickets/TICKET-MEDIA-004-R-company-admin-settings-media-library-foundation.md`
  - This ticket record.
- `docs/ai-handoff/03-rork-outbox.md`
  - WAVE-MEDIA-004-R execution report.
- `docs/ai-handoff/05-ticket-registry.md`
  - Added `TICKET-MEDIA-004-R` as DONE and advanced the active wave record.
- `docs/ai-handoff/06-verification-report.md`
  - Verification report updated for this wave.

## Data/source-of-truth decision
Implemented as a frontend/settings foundation. No Supabase schema, RLS policy, storage bucket, backend service, route migration, new permission, entitlement, module, or runtime migration was added.

The source of truth remains the existing Asset Center model and MEDIA-003 helpers: `assets.scope`, `assets.companyId`, `assets.customerId`, `assets.archivedAt`, `assets.categoryId`, storage bucket/path metadata, and existing RLS/permission semantics.

## Explicit non-implementation decisions
- No new global sidebar item was added.
- No Company Admin Administration Center was created.
- No company-level hide/override of global assets was added.
- No Company Admin global asset archive/delete capability was added.
- No Company Admin upload/archive UI was enabled yet; the page shows a safe disabled foundation state until a later workflow ticket.
- No new permissions, modules, entitlements, backend service, Supabase migration, RLS change, storage cleanup, search overhaul, CRM/Admin Requests runtime, Calculator runtime, Administration Center runtime, or Automation & AI runtime was added.

## Confirmations
- Implemented as a frontend/settings foundation rather than planning-only: YES.
- Company Admin can access `/settings/media` with the existing `settings.manage` permission: YES.
- Non-Company Admin users are blocked by the route guard and page-level defense-in-depth: YES.
- Settings navigation shows Media Library inside Company Admin Settings: YES.
- Global assets render read-only and expose no archive/delete actions: YES.
- Company Admin cannot delete/archive global Super Admin assets: YES.
- Company library renders separately from Global library: YES.
- Category grouping is reused correctly: YES.
- Super Admin Media Center behavior remains intact: YES.
- Backend/Supabase/RLS/storage/schema change: NO.
- New permission/model/route migration/search service/command palette: NO.

## Tests / checks
Focused vitest command:

```txt
bunx vitest run \
  src/lib/assets/companyMediaSettingsNav.test.ts \
  src/pages/settings/MediaLibrary.test.tsx \
  src/pages/Settings.menu-tiles.test.tsx \
  src/lib/assets/companyMediaLibrary.test.ts \
  src/lib/assets/assetCategorySections.test.ts \
  src/lib/assets/assetPermissions.test.ts \
  src/lib/assets/globalMedia.test.ts \
  src/pages/superadmin/MediaCenter.test.tsx
```

Result:

```txt
Test Files 8 passed (8)
Tests 73 passed (73)
```

Notes:
- The focused run includes the existing expected stderr log from `globalMedia.test.ts` proving image-derivation fallback (`canvas unavailable`). The test passes.
- React Router future-flag warnings appear in UI test environments only. Tests pass.

Full validation:

```txt
runChecks({ appPath: "web-cleanops" })
```

Result: failed with 25 known unrelated TypeScript baseline errors. None are in files changed for this ticket.

## Known unrelated baseline failures left untouched
- `src/components/companies/CompanyDialog.tsx` — result-union `.error` access.
- `src/components/modules/CategoryDialog.tsx` — invalid `const` assertion.
- `src/components/settings/NavigationMenuPanel.tsx` — icon-name string union mismatch.
- `src/context/AppContext.tsx` — company write/update result-union `.error` access plus an `"active"`/`"archived"` comparison.
- `src/lib/adminCreateUser.ts` — result-union `.error` access.
- `src/lib/assets/assetRepository.ts` — pre-existing Supabase typing conversions.
- `src/lib/calculator/*` — pre-existing calculator/Supabase typing and public calculator test issues.

## Rollback
Revert the `/settings/media` route, the Company Media Settings nav helper and tests, the Settings tile/link update, the new Media Library page/tests, and this wave’s handoff documentation updates. No migration or data transformation was introduced by this ticket.
