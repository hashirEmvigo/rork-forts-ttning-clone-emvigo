# TICKET-MEDIA-005-R — Company Media Library Scope Filter & Global Label Fix

## Status
DONE

## Wave
WAVE-MEDIA-005-R — Company media library scope filter and global label fix

## Active repository
RiosBioz/Keymaster

## Execution mode
Narrow frontend UX/copy/filter refinement slice.

## Summary
Refined Company Admin Settings → Media Library at `/settings/media` so ownership scope is explicit and no longer confused with public visibility/category concepts.

The page now has a local image-scope filter:
- `All images`
- `Global media`
- `Internal media`

Global Super Admin-provided assets display as `Global`; company-owned assets display as `Internal`. The word `Public` is not used as an ownership/scope label in the Company Admin Media Library. `Website / Public places` remains only a category/usage-area label.

## Files changed
- `web-cleanops/src/pages/settings/MediaLibrary.tsx`
- `web-cleanops/src/pages/settings/MediaLibrary.test.tsx`
- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`
- `web-cleanops/docs/ai-handoff/tickets/TICKET-MEDIA-005-R-company-media-library-scope-filter-global-label-fix.md`

## Implementation details
- Added a top-level scope filter control inside Company Admin Media Library.
- Default filter is `All images`, showing both global and internal media.
- `Global media` filter shows only `library: "global_library"` items from the existing MEDIA-003 data boundary.
- `Internal media` filter shows only `library: "company_library"` items from the existing MEDIA-003 data boundary.
- Category grouping is still handled by the existing MEDIA-002 `groupItemsByAssetCategory()` helper.
- Global media remains read-only and exposes no archive/delete action.
- Internal upload/manage remains deferred through the disabled foundation control from MEDIA-004.
- No stored database values were renamed.

## Boundaries honored
- No backend changes.
- No Supabase changes.
- No RLS changes.
- No schema/storage changes.
- No new routes.
- No new permissions.
- No new access model, module model, entitlement model, or override/hide-global system.
- No command palette, search service, or search overhaul.
- No Super Admin Media Center archive/restore/category behavior change.
- No CRM/Admin Requests, Calculator, Administration Center, or Automation & AI runtime change.

## Verification
Focused command:

```txt
bunx vitest run \
  src/pages/settings/MediaLibrary.test.tsx \
  src/pages/Settings.menu-tiles.test.tsx \
  src/lib/assets/companyMediaSettingsNav.test.ts \
  src/lib/assets/companyMediaLibrary.test.ts \
  src/lib/assets/assetCategorySections.test.ts \
  src/lib/assets/assetPermissions.test.ts \
  src/lib/assets/globalMedia.test.ts \
  src/pages/superadmin/MediaCenter.test.tsx
```

Result:

```txt
Test Files 8 passed (8)
Tests 75 passed (75)
```

Full validation:

```txt
runChecks({ appPath: "web-cleanops" })
```

Result: failed with the known 25 unrelated TypeScript baseline errors outside this ticket’s changed files.

## Known unrelated baseline failures
The full validation failure is unchanged from prior media waves and remains outside this ticket’s scope:
- `src/components/companies/CompanyDialog.tsx`
- `src/components/modules/CategoryDialog.tsx`
- `src/components/settings/NavigationMenuPanel.tsx`
- `src/context/AppContext.tsx`
- `src/lib/adminCreateUser.ts`
- `src/lib/assets/assetRepository.ts`
- `src/lib/calculator/calculatorConfigAdmin.ts`
- `src/lib/calculator/calculatorQuoteRequests.ts`
- `src/lib/calculator/publicCalculator.test.ts`
- `src/lib/calculator/publicCalculatorClient.ts`

## Acceptance confirmations
- Company Admin Media Library renders the scope filter buttons: PASS.
- Default filter shows both global and internal/company assets: PASS.
- `Global media` filter shows only global Super Admin assets: PASS.
- `Internal media` filter shows only company-owned/internal assets: PASS.
- `Public` is no longer used as the ownership/scope display label: PASS.
- `Global` is used for Super Admin-provided/global assets: PASS.
- `Internal` is used for company-owned assets: PASS.
- Category grouping still works inside each filter: PASS.
- Company Admin still cannot archive/delete global Super Admin assets: PASS.
- Super Admin Media Center behavior remains unchanged: PASS.
