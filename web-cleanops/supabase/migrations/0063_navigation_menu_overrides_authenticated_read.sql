-- ============================================================================
-- CleanOps — NAVIGATION & MENU REGISTRY (Slice 11B fix): authenticated READ of
-- system-scope menu presentation overrides
-- ============================================================================
--
-- PURPOSE
--   Slice 11A created `navigation_menu_overrides` (migration 0062) with
--   super_admin-only RLS — correct while the ONLY consumer was the Super-Admin
--   Calculator tabs + the Navigation settings surface. Slice 11B then wired the
--   Customer Card menu to consume the same override layer
--   (useNavigationMenu("customer_card")). The Customer Card is used by Company
--   Admin, but the super_admin-only SELECT policy made every Company-Admin read
--   return ZERO rows (RLS filters silently, not an error), so the menu fell back
--   to registry defaults — custom labels/icons never appeared for Company Admin.
--
--   This migration enables the documented Phase-2 read path from 0062: a SELECT
--   policy that lets ANY authenticated user read SYSTEM-SCOPE override rows. This
--   is the same pattern `system_settings` (migration 0030) already uses for
--   app-wide platform config.
--
-- WHY THIS IS SAFE (presentation only — permissions stay authoritative)
--   • The table holds ONLY non-sensitive presentation data: menu_key,
--     custom_label, custom_icon, sort_order, is_visible (+ forward-compatible
--     scope columns). No PII, no secrets, no permission/route data — those live
--     in the source registry (navigationRegistry.ts) and are never editable.
--   • Reading a row can NEVER grant access. The UI resolver
--     (resolveNavigationGroup) filters every item by the live permission check,
--     and each route keeps its own permission gate. A visible override on a menu
--     the user lacks permission for is still dropped; a hidden override only
--     removes a tile from the UI and never changes route/section access.
--   • WRITES stay super_admin-only (managing platform menu presentation remains
--     Master-Admin governed). Company Admin can READ the approved presentation
--     but cannot create/update/reset overrides, and does NOT receive
--     navigation.manage.
--
-- SCOPE
--   Adds ONE additive SELECT policy. The existing super_admin SELECT/INSERT/
--   UPDATE policies from 0062 are left intact (the super_admin SELECT still
--   covers any future per-company rows; system-scope reads are now broadened).
--   No schema change, no DELETE policy ("reset to default" still neutralises the
--   row — NULLs + is_visible=true — never a hard delete).
--
-- IDEMPOTENT: drop-if-exists + create policy, so re-running is a safe no-op.
-- ============================================================================

alter table navigation_menu_overrides enable row level security;

-- READ (Phase 2): every authenticated user may read SYSTEM-SCOPE presentation
-- overrides so applied menus (e.g. the Customer Card, used by Company Admin)
-- render the approved labels/icons/order/visibility. Presentation only —
-- permission checks in the UI + per-route gates remain authoritative.
drop policy if exists "navigation_menu_overrides_select_system" on navigation_menu_overrides;
create policy "navigation_menu_overrides_select_system" on navigation_menu_overrides
  for select to authenticated
  using (scope_type = 'system' and company_id is null);

-- NOTE: the super_admin SELECT/INSERT/UPDATE policies from 0062 are intentionally
-- NOT changed here. Writes remain super_admin-only; this migration only widens
-- READ access for system-scope rows. No DELETE policy is added.
