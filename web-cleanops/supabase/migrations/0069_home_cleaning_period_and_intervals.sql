-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 12I): HOME CLEANING PERIOD + INTERVALS
-- ============================================================================
--
-- PURPOSE
--   Refine the public-ready home_cleaning service WITHOUT changing any other
--   service or the disabled public state. Slice 12I:
--     1. Retires the `bathrooms` question (active=false) — bathrooms no longer
--        affect the home price (the engine stopped reading them in 12I).
--     2. Reworks the home `frequency` options to the THREE private recurring
--        intervals only (weekly / biweekly / every_four_weeks). The old
--        "monthly" / "En gång i månaden" / "one_time" wording is removed —
--        "Var fjärde vecka" replaces any monthly phrasing.
--     3. Seeds four rule-driven home TIME-adjustment pricing rules (minutes):
--          • every_four_weeks_start_minutes         (default 30)
--          • under_minimum_visit_threshold_minutes  (default 180)
--          • under_minimum_visit_start_minutes      (default 15)
--          • strict_setup_start_minutes             (default 0)
--        Each is read by key in the pure engine (src + Deno mirror, parity-
--        tested) and NEVER hardcoded; a missing rule means 0 (no effect, fail-safe).
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   • UPDATEs the home `bathrooms` question to active=false (idempotent).
--   • UPDATEs the home `frequency` options_json + help_text (idempotent — re-
--     running sets the same values).
--   • INSERTs 4 pricing rules (`on conflict do nothing`, deterministic legacy_ids).
--   • Leaves home enabled=true so it stays the FIRST public-ready service. The new
--     home rules are OPTIONAL for readiness (home is not in
--     REQUIRED_PRICING_RULE_KEYS), so home stays "Ready" with or without them; a
--     missing rule simply means that adjustment is 0.
--
-- WHAT THIS MIGRATION DOES NOT DO (scope guard)
--   • Does NOT touch move_out_cleaning, office_cleaning, or any draft service.
--   • Does NOT hard delete anything (bathrooms is deactivated, not removed, so old
--     submitted quotes keep their frozen answer snapshot).
--   • Does NOT change pricing math, RLS, the pricing-model/rule-type CHECKs, or any
--     other table. The four-week period + time-adjustment math lives in the pure
--     engine, NOT in SQL.
--   • Does NOT enable the calculator. calculator_settings.enabled stays FALSE.
--
-- IDEMPOTENCY
--   One guarded `do $$` block resolving the SAME MVP company as 0060/0065/0066/
--   0067/0068 (by name, then verified legacy_id, else a clean NOTICE no-op — never
--   a demo company). Inserts use deterministic legacy_ids + `on conflict do
--   nothing`; the question UPDATEs are plain idempotent writes scoped to the home
--   service's questions.
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
    raise notice 'Home cleaning 12I refinement SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  select id, legacy_id into v_home_id, v_home_legacy
    from calculator_services
   where company_id = v_company_id and service_key = 'home_cleaning' and deleted_at is null
   limit 1;

  if v_home_id is null then
    raise notice 'Home cleaning 12I refinement SKIPPED: home_cleaning service not found (run 0060 first).';
    return;
  end if;

  -- ── 1. Retire the bathrooms question (active=false; no hard delete) ─────────
  --    Bathrooms no longer affect the home price (engine stopped reading them).
  update calculator_questions
     set active = false
   where company_id = v_company_id
     and calculator_service_id = v_home_id
     and question_key = 'bathrooms'
     and deleted_at is null;

  -- ── 2. Rework the home frequency options (three recurring intervals only) ───
  --    Internal values MUST match the engine's HOME_VISITS_PER_FOUR_WEEKS keys.
  --    "monthly" / "En gång i månaden" / "one_time" are removed; "Var fjärde
  --    vecka" is the only four-week wording.
  update calculator_questions
     set options_json = jsonb_build_array(
           jsonb_build_object('value', 'weekly',          'label', 'Varje vecka'),
           jsonb_build_object('value', 'biweekly',        'label', 'Varannan vecka'),
           jsonb_build_object('value', 'every_four_weeks','label', 'Var fjärde vecka')
         ),
         label = 'Intervall',
         help_text = null
   where company_id = v_company_id
     and calculator_service_id = v_home_id
     and question_key = 'frequency'
     and deleted_at is null;

  -- ── 3. Seed the home time-adjustment pricing rules (minutes, editable) ──────
  --    Read by key in the pure engine; NEVER hardcoded. Optional for readiness
  --    (missing → 0, no effect). strict_setup_start_minutes default 0 (no public
  --    field yet; Super Admin can raise it).
  insert into pricing_rules (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    rule_key, rule_type, value_numeric, value_json, condition_json,
    active, sort_order, data
  ) values
    (
      'calc_rule_home_every_four_weeks_start_minutes_' || v_company_legacy,
      v_company_id, v_company_legacy, v_home_id, v_home_legacy,
      'every_four_weeks_start_minutes', 'threshold', 30,
      '{}'::jsonb, '{}'::jsonb, true, 20, '{}'::jsonb
    ),
    (
      'calc_rule_home_under_minimum_visit_threshold_minutes_' || v_company_legacy,
      v_company_id, v_company_legacy, v_home_id, v_home_legacy,
      'under_minimum_visit_threshold_minutes', 'threshold', 180,
      '{}'::jsonb, '{}'::jsonb, true, 21, '{}'::jsonb
    ),
    (
      'calc_rule_home_under_minimum_visit_start_minutes_' || v_company_legacy,
      v_company_id, v_company_legacy, v_home_id, v_home_legacy,
      'under_minimum_visit_start_minutes', 'threshold', 15,
      '{}'::jsonb, '{}'::jsonb, true, 22, '{}'::jsonb
    ),
    (
      'calc_rule_home_strict_setup_start_minutes_' || v_company_legacy,
      v_company_id, v_company_legacy, v_home_id, v_home_legacy,
      'strict_setup_start_minutes', 'threshold', 0,
      '{}'::jsonb, '{}'::jsonb, true, 23, '{}'::jsonb
    )
  on conflict do nothing;

  raise notice 'Home cleaning 12I refinement applied for company "%": bathrooms retired, intervals reworked, 4 time rules seeded.', v_company_legacy;
end $$;

-- ============================================================================
-- INTENTIONALLY NOT DONE (scope guard for this slice)
--   • No move-out / office / draft-service change.
--   • No pricing-math, RLS, CHECK, or Company-Admin change.
--   • No hard deletes; no calculator activation — enabled stays FALSE.
-- ============================================================================
