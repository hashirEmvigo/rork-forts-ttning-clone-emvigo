# TICKET-MEDIA-001-R — Media Center Global Asset Archive Semantics & RLS Fix

## Status
DONE

## Wave
WAVE-MEDIA-001-R — Media Center global asset archive semantics and RLS fix

## Repository
- Active repository: `RiosBioz/Keymaster`
- Historical/archive/frozen repository: `RiosBioz/Stadportalen`
- Old repository was not used.

## Execution mode
Narrow Media Center bugfix + architecture rule implementation.

## Problem
In Super Admin → Media Center, the destructive trash/delete affordance called the global media delete path, which used the Asset Center `softDeleteAsset` operation (`deleted_at`). In production this surfaced as:

```txt
[assets] delete failed: new row violates row-level security policy for table "assets"
```

More importantly, that behavior violated the product rule for global assets: a Super Admin should not hard-delete or soft-delete a global source image by default because existing company usage may depend on it.

## Implemented behavior
- Super Admin global asset removal now uses archive/remove-from-global-library semantics.
- The Media Center UI no longer presents a destructive hard-delete/trash control for global assets.
- Active assets still show in the normal Media Center library.
- Archived assets are excluded from active/selectable lists and remain visible under the Archived tab.
- Existing asset records, storage paths, public URLs, and existing usage references remain intact.
- Company Admin remains blocked from the Super Admin Media Center surface and cannot archive/delete global originals there.

## Files changed
- `src/pages/superadmin/MediaCenter.tsx`
  - Removed the destructive delete/trash affordance from global asset cards.
  - Replaced the delete confirmation with an archive/remove-from-global-library confirmation.
  - Added the required warning copy: existing usages continue to display the image.
  - Confirm action calls the existing archive mutation.
- `src/hooks/use-global-media-library.ts`
  - Changed the hook-level remove behavior to archive/remove-from-library semantics.
  - Uses `logAssetArchived` instead of `asset_deleted` for this default global-library removal path.
  - Shows success copy explaining that future selection is removed while existing usages continue.
- `src/lib/assets/globalMedia.ts`
  - Added `removeGlobalMediaFromLibrary()` as the explicit global asset removal semantic.
  - Kept `deleteGlobalMedia()` as a backward-compatible alias that archives instead of soft-deleting.
  - Removed direct global-media dependency on `softDeleteAsset`.
  - Fixed the local validation type narrowing surfaced by full validation.
- `src/lib/assets/globalMedia.test.ts`
  - Updated tests to prove global media remove/delete aliases archive and do not call `softDeleteAsset`.
- `src/lib/assets/assetRepository.test.ts`
  - Strengthened archive tests to prove `archived_at` is set, active lists exclude archived rows, and the asset record is not deleted.
- `src/pages/superadmin/MediaCenter.test.tsx`
  - New focused UI tests for archive language, warning copy, archive action pass-through, active/selectable exclusion, archived legacy visibility, and Company Admin block.
- `docs/ai-handoff/tickets/TICKET-MEDIA-001-R-media-center-global-asset-archive-semantics-rls-fix.md`
  - This ticket record.
- `docs/ai-handoff/03-rork-outbox.md`
  - WAVE-MEDIA-001-R execution report.
- `docs/ai-handoff/05-ticket-registry.md`
  - Added `TICKET-MEDIA-001-R` as DONE and advanced active wave status.
- `docs/ai-handoff/06-verification-report.md`
  - Verification report updated for this wave.

## Supabase / RLS decision
No Supabase migration was added.

Reason: the existing Asset Center schema already has safe archive semantics through `assets.archived_at`, and the existing `assets_update` RLS policy permits manageable updates. The observed failure came from the UI/service defaulting to the unsafe soft-delete path (`deleted_at`) for global library removal. This ticket fixes the action semantics so normal Super Admin removal updates `archived_at` instead of attempting `deleted_at`.

## Confirmations
- Super Admin archive removes the global asset from future selection: YES.
- Existing usage can continue to display because the asset record, storage object, public URL, and links are not removed: YES.
- Archived global assets remain represented under the Archived tab: YES.
- Company Admin cannot delete/archive global Super Admin assets from Media Center: YES; the route/page remains Super Admin-only and the page fails closed.
- No hard delete added: YES.
- No soft-delete default for global Media Center removal: YES.
- No company override/hide system added: YES.
- No backend service, storage cleanup, new permission, new route, package/config, calculator, CRM/Admin Requests, or Automation & AI runtime change: YES.

## Tests / checks
Focused vitest command:

```txt
bunx vitest run \
  src/lib/assets/assetRepository.test.ts \
  src/lib/assets/globalMedia.test.ts \
  src/lib/assets/assetPermissions.test.ts \
  src/pages/superadmin/MediaCenter.test.tsx
```

Result:

```txt
Test Files 4 passed (4)
Tests 43 passed (43)
```

Full validation:

```txt
runChecks({ appPath: "web-cleanops" })
```

Result: failed with 25 known unrelated baseline TypeScript errors. None are in files changed for this ticket.

## Known unrelated baseline failures left untouched
- `src/components/companies/CompanyDialog.tsx` — result-union `.error` access.
- `src/components/modules/CategoryDialog.tsx` — invalid `const` assertion.
- `src/components/settings/NavigationMenuPanel.tsx` — icon-name string union mismatch.
- `src/context/AppContext.tsx` — company write/update result-union `.error` access plus an `"active"`/`"archived"` comparison.
- `src/lib/adminCreateUser.ts` — result-union `.error` access.
- `src/lib/assets/assetRepository.ts` — pre-existing Supabase typing conversions.
- `src/lib/calculator/*` — pre-existing calculator/Supabase typing and public calculator test issues.

## Manual Supabase/RLS verification note
Because no live Supabase RLS integration test harness exists in this project, manually verify in staging by signing in as a real Super Admin, opening `/media-center`, selecting a global asset, using “Remove from global library”, and confirming:

1. the asset row has `archived_at` set and `deleted_at` remains null;
2. the asset disappears from active media/website selection;
3. the asset appears under Archived;
4. existing public URL or linked usage still resolves;
5. a Company Admin cannot reach `/media-center` or perform the archive action.

## Rollback
Revert the Media Center UI/hook/globalMedia/test changes and this ticket documentation. No migration or data transformation was introduced by this ticket.
