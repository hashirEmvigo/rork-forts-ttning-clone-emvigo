# TICKET-MEDIA-002-R — Media Center Image Category Sections

## Status
DONE

## Wave
WAVE-MEDIA-002-R — Media Center image category sections

## Repository
- Active repository: `RiosBioz/Keymaster`
- Historical/archive/frozen repository: `RiosBioz/Stadportalen`
- Old repository was not used.

## Execution mode
Narrow frontend UX/data-presentation slice.

## Context
TICKET-MEDIA-001-R fixed Super Admin global Media Center removal so global assets are archived/removed from future selection instead of unsafe delete/soft-delete behavior.

This ticket improves the Super Admin Media Center Images presentation. Uploaded assets already store category metadata through the Asset Center `categoryId` field; the Images view now uses that existing metadata to group images by category instead of rendering one flat wall.

## Implemented behavior
- The Media Center Images tab now renders collapsed category sections.
- Sections are based on existing seeded Asset Center category ids:
  - `asset_cat_cleaning_protocols` → Cleaning protocols
  - `asset_cat_services` → Services
  - `asset_cat_website_public` → Website / Public places
  - `asset_cat_general` → General folder
- Each non-empty section shows a clear label, description, and item count.
- Sections are collapsed by default.
- Expanding a section shows only images in that category.
- Missing or unknown category ids fall back to General folder.
- Empty category sections are hidden to keep the Images tab clean.
- The Archived tab reuses the same grouping pattern, so archived assets remain organized while existing restore behavior remains intact.
- Existing All media, Videos, Documents, Website / Public, Website imagery, upload, archive, restore, preview, copy URL, and login-background behaviors are preserved.

## Files changed
- `src/lib/assets/assetCategorySections.ts`
  - New display-only mapping helper for the four seeded global Asset Center categories.
  - Adds `getAssetCategorySection()` and `groupItemsByAssetCategory()`.
  - This is not a new category source of truth; it maps existing `asset.categoryId` values to user-facing section labels.
- `src/lib/assets/assetCategorySections.test.ts`
  - New focused tests for category display order, stored id mapping, fallback behavior, and grouping/hiding empty sections.
- `src/pages/superadmin/MediaCenter.tsx`
  - Images and Archived tabs now render collapsed category accordion sections.
  - Category section search matching includes the existing category label.
  - Existing flat grid remains for non-category tabs.
  - Existing upload/archive/restore/storage behavior is unchanged.
- `src/pages/superadmin/MediaCenter.test.tsx`
  - Added focused tests for collapsed category sections, category-only expansion behavior, unknown/missing fallback, grouped archived view, archive/restore behavior inside sections, and upload category assignment compatibility.
- `docs/ai-handoff/tickets/TICKET-MEDIA-002-R-media-center-image-category-sections.md`
  - This ticket record.
- `docs/ai-handoff/03-rork-outbox.md`
  - WAVE-MEDIA-002-R execution report.
- `docs/ai-handoff/05-ticket-registry.md`
  - Added `TICKET-MEDIA-002-R` as DONE and advanced the active wave record.
- `docs/ai-handoff/06-verification-report.md`
  - Verification report updated for this wave.

## Data/source-of-truth decision
No backend schema, RLS policy, storage, runtime, or persistence behavior changed.

This ticket adds a small frontend display-mapping helper only. The source of truth remains the existing Asset Center category metadata already used by upload (`asset.categoryId`). The mapping helper only normalizes known stored category ids into clean Media Center section labels and provides the General folder fallback.

## Confirmations
- Media Center Images are grouped by category: YES.
- Sections are collapsed by default: YES.
- Expanding a section shows only images from that category: YES.
- Missing/unknown category fallback is General folder: YES.
- Empty categories are hidden: YES.
- Archived view reuses the grouping pattern: YES.
- Upload/category assignment remains compatible with the existing Asset Center categories: YES.
- Archive/restore behavior remains intact: YES.
- Frontend-only UX/data-presentation change: YES.
- No backend, Supabase, RLS, storage, route, permission, Company Admin override, search overhaul, category-management UI, CRM/Admin Requests, Calculator, or Automation & AI runtime change: YES.

## Tests / checks
Focused vitest command:

```txt
bunx vitest run \
  src/lib/assets/assetCategorySections.test.ts \
  src/lib/assets/assetRepository.test.ts \
  src/lib/assets/globalMedia.test.ts \
  src/lib/assets/assetPermissions.test.ts \
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

Result: failed with 25 known unrelated TypeScript baseline errors. None are in files changed for this ticket after the touched `MediaCenter.tsx` prop typing issue was fixed and focused tests were rerun green.

## Known unrelated baseline failures left untouched
- `src/components/companies/CompanyDialog.tsx` — result-union `.error` access.
- `src/components/modules/CategoryDialog.tsx` — invalid `const` assertion.
- `src/components/settings/NavigationMenuPanel.tsx` — icon-name string union mismatch.
- `src/context/AppContext.tsx` — company write/update result-union `.error` access plus an `"active"`/`"archived"` comparison.
- `src/lib/adminCreateUser.ts` — result-union `.error` access.
- `src/lib/assets/assetRepository.ts` — pre-existing Supabase typing conversions.
- `src/lib/calculator/*` — pre-existing calculator/Supabase typing and public calculator test issues.

## Rollback
Revert the Media Center UI changes, the new category-section helper/tests, and this wave’s handoff documentation. No migration or data transformation was introduced by this ticket.
