# TICKET-MEDIA-003-R — Company Admin Media Library Global/Local Foundation

## Status
DONE

## Wave
WAVE-MEDIA-003-R — Company Admin media library global/local foundation

## Repository
- Active repository: `RiosBioz/Keymaster`
- Historical/archive/frozen repository: `RiosBioz/Stadportalen`
- Old repository was not used.

## Execution mode
Narrow analysis + frontend/data-access foundation slice.

## Context
TICKET-MEDIA-001-R fixed Super Admin global Media Center archive/remove semantics so global source assets are removed from future selection without breaking existing usage.

TICKET-MEDIA-002-R grouped Super Admin Media Center Images into collapsed category sections using existing Asset Center category metadata.

This ticket prepares the Company Admin media boundary without inventing a broad new module, route, or override system.

## Investigation summary
- There is an existing Super Admin Media Center at `/media-center`, guarded for `super_admin` and backed by Asset Center global/website scopes.
- There is no existing standalone Company Admin Media Center route/page that can be safely refined in this ticket.
- Existing Customer Card media is customer-scoped (`customer_internal` / `customer_visible`) and is not the same as a top-level company media library.
- Asset Center already supports the ownership split needed for this foundation:
  - global source assets: `global_internal`, `global_public`, `website_public`, `companyId === null`, `customerId === null`;
  - company-owned local assets: `company_internal` / `company_public`, `companyId` set, `customerId === null`;
  - customer media: customer-scoped and intentionally excluded from the top-level company library foundation.
- Existing RLS/client permission helpers already encode the key rule: Company Admin can manage own-company company/customer assets, but cannot manage global originals or public-published assets.
- The existing Asset Center category ids from MEDIA-002 can be reused for company-owned local assets.

## Implemented behavior
- Added a frontend/data-access boundary for the future Company Admin Media Library.
- The boundary separates two lanes:
  - **Global library**: Super Admin source assets, read-only for Company Admin.
  - **Company library**: company-owned local assets, manageable by the owning Company Admin.
- Active global assets are returned as selectable for future usage.
- Archived global assets are excluded from future selection by default.
- Archived global assets can be returned only when explicitly passed as an existing referenced asset id, so legacy usage can still render without becoming selectable for new usage.
- Company-owned local assets can be uploaded as private `company_internal` assets.
- Company-owned local assets use the same `asset.categoryId` metadata, so the existing category grouping helper can group them into Cleaning protocols, Services, Website / Public places, and General folder.
- Company Admin archive is allowed only for own-company local library assets and rejected for global Super Admin originals, foreign company assets, customer-scoped media, and public-published local assets.
- URL resolution works for both public global assets and private signed global/company assets.

## Files changed
- `src/lib/assets/companyMediaLibrary.ts`
  - New frontend/data-access foundation for Company Admin global/local media separation.
  - Adds global source asset classification, company-owned local asset classification, list helpers, selectable picker helper, upload helper, archive guard, and URL resolution.
  - Does not create a route or UI.
- `src/lib/assets/companyMediaLibrary.test.ts`
  - New focused tests proving global/local separation, read-only global items, archived global legacy handling, selectable filtering, own-company archive guard, company upload behavior, category grouping compatibility, and cleanup-on-create-failure behavior.
- `src/lib/assets/index.ts`
  - Exports the new Company Admin media library foundation helpers/types from the Asset Center barrel.
- `docs/ai-handoff/tickets/TICKET-MEDIA-003-R-company-admin-media-library-global-local-foundation.md`
  - This ticket record.
- `docs/ai-handoff/03-rork-outbox.md`
  - WAVE-MEDIA-003-R execution report.
- `docs/ai-handoff/05-ticket-registry.md`
  - Added `TICKET-MEDIA-003-R` as DONE and advanced the active wave record.
- `docs/ai-handoff/06-verification-report.md`
  - Verification report updated for this wave.

## Data/source-of-truth decision
This was implemented as a frontend/data-access foundation. No Supabase schema, RLS policy, storage bucket, route, permission, entitlement, module, or runtime migration was added.

The source of truth remains the existing Asset Center tables and fields: `assets.scope`, `assets.companyId`, `assets.customerId`, `assets.archivedAt`, `assets.categoryId`, storage bucket/path metadata, and existing RLS/permission semantics.

## Explicit non-implementation decisions
- No Company Admin Media Center route/page was created because no safe existing standalone Company Admin media surface exists yet.
- No sidebar/navigation entry was added.
- No Company Admin global-hide/override system was added.
- No new permissions, modules, entitlements, routes, backend service, Supabase migration, RLS change, storage cleanup, search overhaul, CRM/Admin Requests runtime, Calculator runtime, Administration Center runtime, or Automation & AI runtime was added.

## Confirmations
- Implemented as frontend/data-access foundation rather than planning-only: YES.
- Company Admin can see global assets as read-only/selectable items at the data-access foundation level: YES.
- Archived global assets are not selectable for future usage: YES.
- Explicit existing references to archived global assets can still be represented: YES.
- Company Admin cannot delete/archive global Super Admin assets: YES.
- Company-owned assets are separated from global assets: YES.
- Company-owned assets can use the same category grouping pattern: YES.
- Super Admin Media Center category grouping and archive/restore behavior remains intact: YES.
- Backend/Supabase/RLS/storage/schema change: NO.
- New route/sidebar/permission/model/search service: NO.

## Tests / checks
Focused vitest command:

```txt
bunx vitest run \
  src/lib/assets/companyMediaLibrary.test.ts \
  src/lib/assets/assetCategorySections.test.ts \
  src/lib/assets/assetPermissions.test.ts \
  src/lib/assets/globalMedia.test.ts \
  src/pages/superadmin/MediaCenter.test.tsx
```

Result:

```txt
Test Files 5 passed (5)
Tests 53 passed (53)
```

Notes:
- The focused run includes the existing expected stderr log from `globalMedia.test.ts` proving image-derivation fallback (`canvas unavailable`). The test passes.
- React Router future-flag warnings appear in the MediaCenter UI test environment only. Tests pass.

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
Revert `src/lib/assets/companyMediaLibrary.ts`, `src/lib/assets/companyMediaLibrary.test.ts`, the Asset Center barrel export, and this wave’s handoff documentation updates. No migration or data transformation was introduced by this ticket.
