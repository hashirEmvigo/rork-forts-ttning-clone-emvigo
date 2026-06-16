-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 12G): HOME CLEANING — "Vi har husdjur"
-- ============================================================================
--
-- PURPOSE
--   Add a configurable PETS factor to the public-ready home_cleaning service
--   WITHOUT changing any other service or the disabled public state. Slice 12G:
--     1. Adds the `has_pets` question (boolean, price-affecting) so a visitor can
--        say their home has pets ("Vi har husdjur").
--     2. Seeds the `pet_time_percent` pricing rule (default 10) — the percentage
--        the engine adds to the recommended HOURS when has_pets is true. It is
--        read by key in the pure engine (src + Deno mirror, parity-tested) and is
--        NEVER hardcoded; a missing rule means 0 % (no effect, fail-safe).
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   • INSERTs 1 question + 1 pricing rule for the home service (both
--     `on conflict do nothing` with deterministic legacy_ids).
--   • Leaves home enabled=true (Slice 0060) so it stays the FIRST public-ready
--     service. The pet rule is OPTIONAL for readiness (home is not in
--     REQUIRED_PRICING_RULE_KEYS), so home stays "Ready" with or without it; the
--     seed simply makes the new toggle do something out of the box.
--
-- WHAT THIS MIGRATION DOES NOT DO (scope guard)
--   • Does NOT touch move_out_cleaning, office_cleaning, or any draft service.
--   • Does NOT change pricing math, RLS, the pricing-model/rule-type CHECKs, or
--     any other table. The pets math lives in the pure engine, NOT in SQL.
--   • Does NOT enable the calculator. calculator_settings.enabled stays FALSE.
--   • No hard deletes.
--
-- IDEMPOTENCY
--   One guarded `do $$` block resolving the SAME MVP company as 0060/0061/0065/
--   0066/0067 (by name, then verified legacy_id, else a clean NOTICE no-op —
--   never a demo company). Inserts use deterministic legacy_ids +
--   `on conflict do nothing`, so re-running never duplicates a row.
-- ============================================================================

do $$
declare
  v_target_name    text := 'Städalliansen Sverige AB';
  v_target_legacy  text := 'cmp_o2f6orw29m';
  v_company_legacy text;
  v_company_id     uuid;
  v_home_id        uuid;
  v_home_legacy    text;
begin
  select id, legacy_id into v_company_id, v_company_legacy
    from companies
   where name = v_target_name and status <> 'archived'
   order by created_at asc
   limit 1;

  if v_company_id is null then
    select id, legacy_id into v_company_id, v_company_legacy
      from companies
     where legacy_id = v_target_legacy and status <> 'archived'
     limit 1;
  end if;

  if v_company_id is null then
    raise notice 'Home cleaning pets SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  select id, legacy_id into v_home_id, v_home_legacy
    from calculator_services
   where company_id = v_company_id and service_key = 'home_cleaning' and deleted_at is null
   limit 1;

  if v_home_id is null then
    raise notice 'Home cleaning pets SKIPPED: home_cleaning service not found (run 0060 first).';
    return;
  end if;

  -- ── 1. The pets question (price-affecting boolean) ──────────────────────────
  --    Shown in the home "Tillägg och önskemål" group; the engine reads it as
  --    has_pets and applies the pet_time_percent uplift to recommended HOURS.
  insert into calculator_questions (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    question_key, label, help_text, input_type, required,
    options_json, validation_json, affects_pricing, sort_order, active
  ) values
    (
      'calc_q_home_has_pets_' || v_company_legacy, v_company_id, v_company_legacy,
      v_home_id, v_home_legacy,
      'has_pets', 'Vi har husdjur',
      'Hjälper oss att uppskatta tiden mer rättvist. Påverkar den uppskattade tiden.',
      'boolean', false,
      '[]'::jsonb, '{}'::jsonb, true, 8, true
    )
  on conflict do nothing;

  -- ── 2. The pets pricing rule (percentage time uplift, editable) ─────────────
  --    Default 10 %. Editable in Pricing Rules; the engine reads it by key —
  --    NEVER hardcoded. Optional for readiness (missing → 0 %, no effect).
  insert into pricing_rules (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    rule_key, rule_type, value_numeric, value_json, condition_json,
    active, sort_order, data
  ) values
    (
      'calc_rule_home_pet_time_percent_' || v_company_legacy,
      v_company_id, v_company_legacy, v_home_id, v_home_legacy,
      'pet_time_percent', 'margin_percent', 10,
      '{}'::jsonb, '{}'::jsonb, true, 11, '{}'::jsonb
    )
  on conflict do nothing;

  raise notice 'Home cleaning pets applied for company "%": has_pets question + pet_time_percent rule (default 10).', v_company_legacy;
end $$;

-- ============================================================================
-- INTENTIONALLY NOT DONE (scope guard for this slice)
--   • No move-out / office / draft-service change.
--   • No pricing-math, RLS, CHECK, or Company-Admin change.
--   • No calculator activation — calculator_settings.enabled stays FALSE.
-- ============================================================================
