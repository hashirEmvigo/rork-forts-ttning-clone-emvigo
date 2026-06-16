-- ============================================================================
-- CleanOps — ASSET LINKS: prevent duplicate ACTIVE placements (Phase 3).
-- ============================================================================
--
-- PURPOSE
--   Work Order images are now Supabase-authoritative: a placement is an
--   `asset_links` row (entity_type + entity_id + placement_key) pointing at a
--   customer-owned asset. The app already de-dupes before inserting, but this
--   adds a narrow DB-level guarantee that the SAME asset is never actively
--   linked twice to the SAME placement slot (e.g. double-click / race).
--
-- WHAT THIS MIGRATION CREATES (idempotent, additive)
--   • uq_asset_links_active_placement — partial UNIQUE index over
--       (entity_type, entity_id, placement_key, asset_legacy_id)
--       WHERE deleted_at is null.
--     Only ACTIVE (non-archived) links are constrained, so an asset can be
--     re-attached after being removed (the old soft-deleted row is ignored).
--     NULL entity_id rows (singletons like login_page) are treated as distinct
--     by Postgres, so multiple such placements remain allowed.
--
-- SAFETY
--   asset_links carries no work-order data before this phase, so the unique
--   index builds cleanly. Purely additive — no table/policy/data changes.
-- ============================================================================

create unique index if not exists uq_asset_links_active_placement
  on asset_links (entity_type, entity_id, placement_key, asset_legacy_id)
  where deleted_at is null;
