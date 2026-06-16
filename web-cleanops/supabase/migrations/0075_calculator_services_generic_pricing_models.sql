-- ============================================================================
-- 0075 — Calculator services: allow GENERIC pricing models   (Slice GPM-3a)
-- ============================================================================
-- PURPOSE
--   Widen `calculator_services_pricing_model_check` so a service may use EITHER
--   a legacy, service-named pricing model (unchanged — every existing row still
--   passes) OR one of the new GENERIC, admin-selectable pricing models from
--   GPM-1: hourly_by_area | sqm_fixed | unit_based | fixed_package |
--   manual_quote. This unblocks admin-created generic service SHELLS (GPM-3a)
--   without touching any existing data or behaviour.
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   • Drops + re-adds the CHECK as a pure SUPERSET of the migration-0065 list:
--       - all 7 legacy values stay valid,
--       - the historical `deep_cleaning_area_based` spelling is added for
--         code-compat (it is listed in LEGACY_PRICING_MODELS of
--         src/lib/calculator/v2/pricingModel.ts), and
--       - the 5 generic GPM-1 models are appended.
--   The swap uses `drop constraint if exists` + `add constraint`, so re-running
--   the migration is safe.
--
-- INTENTIONALLY NOT DONE (the safety contract)
--   • No row is updated or rewritten — every service keeps its `pricing_model`.
--   • No service is seeded, enabled, disabled, hidden, archived or deleted.
--   • No other table, column, index, RLS policy or trigger is touched.
--   • Generic-model services are still created as HIDDEN DRAFTS (enabled=false,
--     coming_soon=false) by the app and are NOT engine-routed yet, so widening
--     the CHECK changes no public, pricing or admin behaviour on its own.
-- ============================================================================

alter table calculator_services
  drop constraint if exists calculator_services_pricing_model_check;

alter table calculator_services
  add constraint calculator_services_pricing_model_check
  check (pricing_model in (
    -- ── Legacy, service-named models (migration 0065 list — all preserved) ──
    'home_cleaning_recommended_hours',
    'move_out_fixed_plus_addons',
    'office_cleaning_recurring_area_frequency',
    'window_cleaning_count_based',
    'deep_cleaning_area_addons',
    'deep_cleaning_area_based',            -- historical spelling kept for code-compat
    'stairwell_cleaning_floors_frequency',
    'inquiry_only_no_price',
    -- ── Generic, admin-selectable models (GPM-1) ───────────────────────────
    'hourly_by_area',
    'sqm_fixed',
    'unit_based',
    'fixed_package',
    'manual_quote'
  ));
