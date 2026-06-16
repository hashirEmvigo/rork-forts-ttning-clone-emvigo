-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 12E): OFFICE CLEANING → PUBLIC-READY
-- ============================================================================
--
-- PURPOSE
--   Make `office_cleaning` (Kontorsstädning) the THIRD public-ready service in the
--   public calculator. Slice 12C (migration 0065) seeded it as a HIDDEN DRAFT
--   (enabled=false) on the `office_cleaning_recurring_area_frequency` model with a
--   starter question set but NO pricing rules. Slice 12E now (1) implements that
--   model in the pure pricing engine (src + Deno mirror, parity-tested), (2) seeds
--   its pricing rules, (3) adds the two remaining pricing questions, and (4) flips
--   the service to enabled=true so — once the calculator is turned on — it appears
--   as the third service after Hemstädning + Flyttstädning.
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   1. Seeds 11 pricing_rules for the office service (flat per-service rule_keys,
--      matching the seeded home/move-out convention; the engine reads them by
--      (service, rule_key)). EVERY value is a PLACEHOLDER business number.
--   2. Adds the two remaining pricing questions to the office service:
--        • meeting_rooms — integer (optional, affects_pricing)
--        • has_kitchen   — boolean (optional, affects_pricing)
--      The 0065 starter set (sqm, frequency, toilets, workstations, postal_code)
--      already covers the other inputs; together they are the full office form.
--   3. Flips the office service enabled=true (public-ready). coming_soon stays
--      false and sort_order stays 3 (set in 0065) so it renders third.
--
-- WHAT THIS MIGRATION DOES NOT DO (scope guard)
--   • Does NOT enable any OTHER draft service (window/deep/stairwell/procurement
--     stay hidden — their models are still unimplemented).
--   • Does NOT change the pricing-model CHECK (0065 already allows the office
--     model identifier), any RLS policy, or any other table.
--   • Does NOT enable the calculator. calculator_settings.enabled stays FALSE —
--     the public page remains dark until a Super Admin flips it on after review.
--   • No hard deletes. No cleaning_plans (office prices on its own hourly_rate
--     rule, settings_json.requiresCleaningPlan=false from 0065 — no plan selector).
--
-- IDEMPOTENCY
--   One guarded `do $$` block resolving the SAME MVP company as 0060/0065 (by
--   name, then verified legacy_id, else a clean NOTICE no-op — never a demo
--   company). Inserts use `on conflict do nothing` with deterministic legacy_ids,
--   so re-running never duplicates a row. The enabled flip is a plain idempotent
--   UPDATE scoped to the office service (re-running sets the same value).
-- ============================================================================

do $$
declare
  -- Same target resolution as the 0060/0065 seeds (never a demo company).
  v_target_name    text := 'Städalliansen Sverige AB';
  v_target_legacy  text := 'cmp_o2f6orw29m';
  v_company_legacy text;
  v_company_id     uuid;
  v_office_id      uuid;
  v_office_legacy  text;
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
    raise notice 'Office cleaning public-ready SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  -- Resolve the office service seeded by 0065 (by stable service_key).
  select id, legacy_id into v_office_id, v_office_legacy
    from calculator_services
   where company_id = v_company_id and service_key = 'office_cleaning' and deleted_at is null
   limit 1;

  if v_office_id is null then
    raise notice 'Office cleaning public-ready SKIPPED: office_cleaning service not found (run 0065 first).';
    return;
  end if;

  -- ── 1. Pricing rules (flat per-service rule_keys the engine reads) ──────────
  --    [PRICE#] EVERY value_numeric below is a PLACEHOLDER business number.
  --    Formula (Slice 12E): hours_per_visit = base_visit_hours
  --      + sqm*hours_per_sqm + toilets*toilet_extra_hours
  --      + meeting_rooms*meeting_room_extra_hours + workstations*workstation_extra_hours
  --      + (has_kitchen ? kitchen_extra_hours : 0), floored at minimum_hours_per_visit;
  --      raw_monthly = hours_per_visit * visits_per_month(frequency) * hourly_rate;
  --      then ± margin and rounded (shared range_*_percent + rounding_increment).
  insert into pricing_rules (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    rule_key, rule_type, value_numeric, value_json, condition_json,
    active, sort_order, data
  ) values
    ('calc_rule_office_base_visit_hours_'        || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'base_visit_hours',        'numeric_factor', 1.0,   '{}'::jsonb, '{}'::jsonb, true, 1,  '{}'::jsonb),
    ('calc_rule_office_hours_per_sqm_'           || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'hours_per_sqm',           'numeric_factor', 0.008, '{}'::jsonb, '{}'::jsonb, true, 2,  '{}'::jsonb),
    ('calc_rule_office_toilet_extra_hours_'      || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'toilet_extra_hours',      'numeric_factor', 0.2,   '{}'::jsonb, '{}'::jsonb, true, 3,  '{}'::jsonb),
    ('calc_rule_office_meeting_room_extra_hours_'|| v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'meeting_room_extra_hours','numeric_factor', 0.15,  '{}'::jsonb, '{}'::jsonb, true, 4,  '{}'::jsonb),
    ('calc_rule_office_workstation_extra_hours_' || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'workstation_extra_hours', 'numeric_factor', 0.02,  '{}'::jsonb, '{}'::jsonb, true, 5,  '{}'::jsonb),
    ('calc_rule_office_kitchen_extra_hours_'     || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'kitchen_extra_hours',     'numeric_factor', 0.3,   '{}'::jsonb, '{}'::jsonb, true, 6,  '{}'::jsonb),
    ('calc_rule_office_minimum_hours_per_visit_' || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'minimum_hours_per_visit', 'threshold',      1.5,   '{}'::jsonb, '{}'::jsonb, true, 7,  '{}'::jsonb),
    ('calc_rule_office_hourly_rate_'             || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'hourly_rate',             'numeric_factor', 459,   '{}'::jsonb, '{}'::jsonb, true, 8,  '{}'::jsonb),
    ('calc_rule_office_range_min_percent_'       || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'range_min_percent',       'margin_percent', 10,    '{}'::jsonb, '{}'::jsonb, true, 9,  '{}'::jsonb),
    ('calc_rule_office_range_max_percent_'       || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'range_max_percent',       'margin_percent', 10,    '{}'::jsonb, '{}'::jsonb, true, 10, '{}'::jsonb),
    ('calc_rule_office_rounding_increment_'      || v_company_legacy, v_company_id, v_company_legacy, v_office_id, v_office_legacy, 'rounding_increment',      'rounding',       50,    '{}'::jsonb, '{}'::jsonb, true, 11, '{}'::jsonb)
  on conflict do nothing;

  -- ── 2. The two remaining pricing questions (meeting_rooms + has_kitchen) ────
  --    `on conflict do nothing` guards BOTH the legacy_id and the (service, key)
  --    live-unique index, so a re-run (or a hand-added key) never errors.
  insert into calculator_questions (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    question_key, label, help_text, input_type, required,
    options_json, validation_json, affects_pricing, sort_order, active
  ) values
    (
      'calc_q_office_meeting_rooms_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'meeting_rooms', 'Antal mötesrum', 'Ungefärligt antal mötesrum/konferensrum.',
      'integer', false,
      '[]'::jsonb, jsonb_build_object('min', 0, 'max', 100, 'step', 1),
      true, 6, true
    ),
    (
      'calc_q_office_has_kitchen_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'has_kitchen', 'Kök/pentry finns', 'Finns det ett kök eller pentry som ska städas?',
      'boolean', false,
      '[]'::jsonb, '{}'::jsonb, true, 7, true
    )
  on conflict do nothing;

  -- ── 3. Flip the office service to PUBLIC-READY (enabled) ────────────────────
  --    coming_soon stays false; sort_order stays 3 (set in 0065) → renders third.
  --    Idempotent: scoped to the office service; re-running sets the same value.
  update calculator_services
     set enabled = true
   where company_id = v_company_id
     and service_key = 'office_cleaning'
     and deleted_at is null;

  raise notice 'Office cleaning is now public-ready (enabled) for company "%": 11 rules + 2 questions seeded.', v_company_legacy;
end $$;

-- ============================================================================
-- INTENTIONALLY NOT DONE (scope guard for this slice)
--   • No other draft service enabled (window/deep/stairwell/procurement stay hidden).
--   • No pricing-model CHECK change (0065 already allows the office identifier).
--   • No RLS / permission / Company-Admin change.
--   • No calculator activation — calculator_settings.enabled stays FALSE.
-- ============================================================================
