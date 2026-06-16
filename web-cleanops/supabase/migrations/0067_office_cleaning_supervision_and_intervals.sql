-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 12F): OFFICE CLEANING REFINEMENT
-- ============================================================================
--
-- PURPOSE
--   Refine the public-ready office_cleaning service (Slice 12E) WITHOUT changing
--   any other service or the disabled public state. Slice 12F:
--     1. Reworks the office `frequency` options to the ordinary-cleaning interval
--        set (weekday_daily / weekly / biweekly / every_four_weeks) PLUS a
--        non-priceable "custom_interval" (→ engine routes it to manual review).
--     2. Seeds the `supervision_start_minutes` pricing rule (default 15) — a fixed
--        per-visit overhead the engine adds to supervision (tillsynsstädning).
--     3. Adds the supervision question group (toggle + visits/week + minutes/visit,
--        price-affecting) and three INFORMATION-ONLY office quote fields
--        (consumables, other add-ons, after-hours) that never affect the price.
--     4. Clarifies the toilet-count help text (count individual toilets).
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   • INSERTs 1 pricing rule + 6 questions (all `on conflict do nothing`).
--   • UPDATEs the office `frequency` options_json and the `toilets` help_text
--     (idempotent — re-running sets the same values).
--   • Leaves office enabled=true (Slice 12E) so it stays the third public-ready
--     service; the engine + admin readiness now REQUIRE supervision_start_minutes,
--     which this migration provides, so office remains "Ready".
--
-- WHAT THIS MIGRATION DOES NOT DO (scope guard)
--   • Does NOT enable any other draft service (window/deep/stairwell/procurement).
--   • Does NOT change pricing math, RLS, the pricing-model CHECK, or any other
--     table. The supervision math + custom-interval manual review live in the pure
--     engine (src + Deno mirror, parity-tested), NOT in SQL.
--   • Does NOT enable the calculator. calculator_settings.enabled stays FALSE.
--   • No hard deletes; no cleaning_plans (office prices on its own hourly_rate).
--
-- IDEMPOTENCY
--   One guarded `do $$` block resolving the SAME MVP company as 0060/0065/0066
--   (by name, then verified legacy_id, else a clean NOTICE no-op — never a demo
--   company). Inserts use deterministic legacy_ids + `on conflict do nothing`;
--   the option/help UPDATEs are plain idempotent writes scoped to the office
--   service's questions.
-- ============================================================================

do $$
declare
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
    raise notice 'Office cleaning 12F refinement SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  select id, legacy_id into v_office_id, v_office_legacy
    from calculator_services
   where company_id = v_company_id and service_key = 'office_cleaning' and deleted_at is null
   limit 1;

  if v_office_id is null then
    raise notice 'Office cleaning 12F refinement SKIPPED: office_cleaning service not found (run 0065/0066 first).';
    return;
  end if;

  -- ── 1. Supervision pricing rule (fixed per-visit start overhead, minutes) ───
  --    Default 15 min. Editable in Pricing Rules; the engine reads it by key —
  --    NEVER hardcoded. Required for office readiness (Slice 12F).
  insert into pricing_rules (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    rule_key, rule_type, value_numeric, value_json, condition_json,
    active, sort_order, data
  ) values
    (
      'calc_rule_office_supervision_start_minutes_' || v_company_legacy,
      v_company_id, v_company_legacy, v_office_id, v_office_legacy,
      'supervision_start_minutes', 'threshold', 15,
      '{}'::jsonb, '{}'::jsonb, true, 12, '{}'::jsonb
    )
  on conflict do nothing;

  -- ── 2. Supervision question group (price-affecting) + info-only fields ──────
  --    The supervision detail fields are conditionally shown in the public office
  --    flow (only when the toggle is on); the engine ignores them when inactive.
  insert into calculator_questions (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    question_key, label, help_text, input_type, required,
    options_json, validation_json, affects_pricing, sort_order, active
  ) values
    (
      'calc_q_office_supervision_cleaning_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'supervision_cleaning', 'Tillsynsstädning',
      'Återkommande tillsyn mellan ordinarie städningar. Påverkar månadspriset.',
      'boolean', false,
      '[]'::jsonb, '{}'::jsonb, true, 8, true
    ),
    (
      'calc_q_office_supervision_visits_per_week_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'supervision_visits_per_week', 'Önskat antal tillfällen per vecka',
      'Hur många tillsynstillfällen per vecka.',
      'integer', false,
      '[]'::jsonb, jsonb_build_object('min', 0, 'max', 21, 'step', 1),
      true, 9, true
    ),
    (
      'calc_q_office_supervision_minutes_per_visit_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'supervision_minutes_per_visit', 'Önskad tidsåtgång per tillfälle (minuter)',
      'Ungefärlig tid per tillsynstillfälle i minuter.',
      'integer', false,
      '[]'::jsonb, jsonb_build_object('min', 0, 'max', 480, 'step', 5),
      true, 10, true
    ),
    (
      'calc_q_office_consumables_quote_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'consumables_quote', 'Jag vill ha offert för förbrukningsmaterial',
      'Informationsfält – påverkar inte priset i detta skede.',
      'boolean', false,
      '[]'::jsonb, '{}'::jsonb, false, 11, true
    ),
    (
      'calc_q_office_other_addons_quote_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'other_addons_quote', 'Jag vill ha offert för andra tilläggstjänster',
      'Informationsfält – påverkar inte priset i detta skede.',
      'boolean', false,
      '[]'::jsonb, '{}'::jsonb, false, 12, true
    ),
    (
      'calc_q_office_after_hours_cleaning_' || v_company_legacy, v_company_id, v_company_legacy,
      v_office_id, v_office_legacy,
      'after_hours_cleaning', 'Städning utanför ordinarie kontorstider',
      'Informationsfält – påverkar inte priset i detta skede.',
      'boolean', false,
      '[]'::jsonb, '{}'::jsonb, false, 13, true
    )
  on conflict do nothing;

  -- ── 3. Rework the office frequency options (ordinary cleaning + custom) ─────
  --    Internal values MUST match the engine's OFFICE_VISITS_PER_MONTH keys;
  --    'custom_interval' has no automatic price (engine → manual review).
  update calculator_questions
     set options_json = jsonb_build_array(
           jsonb_build_object('value', 'weekday_daily',   'label', 'Varje dag / vardagar'),
           jsonb_build_object('value', 'weekly',          'label', 'Varje vecka'),
           jsonb_build_object('value', 'biweekly',        'label', 'Varannan vecka'),
           jsonb_build_object('value', 'every_four_weeks','label', 'Var fjärde vecka'),
           jsonb_build_object('value', 'custom_interval', 'label', 'Annat intervall')
         ),
         label = 'Ordinarie städning',
         help_text = 'Hur ofta kontoret ska städas. Välj "Annat intervall" för specialupplägg.'
   where company_id = v_company_id
     and calculator_service_id = v_office_id
     and question_key = 'frequency'
     and deleted_at is null;

  -- ── 4. Clarify the toilet-count help text (count individual toilets) ────────
  update calculator_questions
     set help_text = 'Räkna varje enskild toalett, inte toalettstationer.'
   where company_id = v_company_id
     and calculator_service_id = v_office_id
     and question_key = 'toilets'
     and deleted_at is null;

  raise notice 'Office cleaning 12F refinement applied for company "%": supervision rule + 6 questions + interval/toilet copy.', v_company_legacy;
end $$;

-- ============================================================================
-- INTENTIONALLY NOT DONE (scope guard for this slice)
--   • No other draft service enabled or priced.
--   • No pricing-math, RLS, CHECK, or Company-Admin change.
--   • No calculator activation — calculator_settings.enabled stays FALSE.
-- ============================================================================
