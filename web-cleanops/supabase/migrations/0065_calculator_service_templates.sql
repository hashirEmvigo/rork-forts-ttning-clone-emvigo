-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 12C): SERVICE TEMPLATES + MODEL WHITELIST
-- ============================================================================
--
-- PURPOSE
--   Make the calculator a reusable SaaS module by (1) widening the allowed
--   pricing-model whitelist so future service types can be scaffolded, and (2)
--   seeding the requested service TEMPLATES as HIDDEN DRAFTS for the MVP company.
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   1. Relaxes calculator_services_pricing_model_check to ALSO allow the reserved
--      template model identifiers. This is a pure SUPERSET — the two engine-backed
--      models (home/move-out) and every existing row still pass. No existing math,
--      column, RLS policy or behaviour is changed.
--   2. Seeds 5 new service rows as HIDDEN DRAFTS (enabled=false, coming_soon=false)
--      so they are admin-only and CAN NOT reach the public calculator:
--        • office_cleaning   → Kontorsstädning   (office_cleaning_recurring_area_frequency)
--        • window_cleaning   → Fönsterputs       (window_cleaning_count_based)
--        • deep_cleaning     → Storstädning      (deep_cleaning_area_addons)
--        • stairwell_cleaning→ Trappstädning     (stairwell_cleaning_floors_frequency)
--        • procurement       → Upphandling       (inquiry_only_no_price)
--      Office cleaning also gets a starter QUESTION set so it is the most complete
--      template. NO pricing_rules are seeded for any of them, so each shows as
--      "Missing pricing" / "Unsupported pricing" in the admin readiness badge.
--
-- WHY THE TEMPLATES STAY NON-PUBLIC (the safety contract)
--   The pure pricing engine (src/lib/calculator/pricingEngine.ts + the Deno
--   mirror) implements ONLY home_cleaning_recommended_hours and
--   move_out_fixed_plus_addons. A service on any OTHER model is flagged
--   "Unsupported pricing" by computeServiceReadiness; the Super-Admin editor locks
--   its Enabled switch; and the public config Edge query only returns
--   enabled/coming_soon services (these drafts are neither). Implementing a new
--   model (engine + parity test + seeded pricing_rules) is a deliberate FUTURE
--   slice per service — see docs/runbooks.
--
-- IDEMPOTENCY
--   The CHECK swap uses drop-if-exists + add. The seed runs in one guarded `do $$`
--   block resolving the SAME MVP company as 0060 (by name, then verified legacy_id,
--   else a clean NOTICE no-op — never a demo company). Every insert uses
--   `on conflict (legacy_id) do nothing` with deterministic legacy_ids, so
--   re-running never duplicates a row and never clobbers later Super-Admin edits.
--
-- INTENTIONALLY NOT DONE
--   • No new pricing_model engine code (templates stay non-public until built).
--   • No pricing_rules for the templates (so they cannot price).
--   • No enabling of any service; the calculator stays dark (settings.enabled=false).
--   • No RLS / permission / Company-Admin change.
-- ============================================================================

-- ── 1. Widen the pricing-model whitelist (pure superset) ────────────────────
alter table calculator_services
  drop constraint if exists calculator_services_pricing_model_check;
alter table calculator_services
  add constraint calculator_services_pricing_model_check
  check (pricing_model in (
    'home_cleaning_recommended_hours',
    'move_out_fixed_plus_addons',
    'office_cleaning_recurring_area_frequency',
    'window_cleaning_count_based',
    'deep_cleaning_area_addons',
    'stairwell_cleaning_floors_frequency',
    'inquiry_only_no_price'
  ));

-- ── 2. Seed the service templates as HIDDEN DRAFTS for the MVP company ───────
do $$
declare
  -- Same target resolution as the 0060 seed (never a demo company).
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
    raise notice 'Calculator service templates SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  v_office_legacy := 'calc_svc_office_cleaning_' || v_company_legacy;

  -- All draft: enabled=false + coming_soon=false → hidden from the public calculator.
  insert into calculator_services (
    legacy_id, company_id, company_legacy_id,
    service_key, display_name, description,
    enabled, coming_soon, pricing_model, sort_order, settings_json
  ) values
    (
      v_office_legacy, v_company_id, v_company_legacy,
      'office_cleaning', 'Kontorsstädning',
      'Återkommande kontorsstädning anpassad efter yta och städfrekvens.',
      false, false, 'office_cleaning_recurring_area_frequency', 3,
      jsonb_build_object('requiresCleaningPlan', false)
    ),
    (
      'calc_svc_window_cleaning_' || v_company_legacy, v_company_id, v_company_legacy,
      'window_cleaning', 'Fönsterputs',
      'Fönsterputsning prissatt efter antal fönster och tillval.',
      false, false, 'window_cleaning_count_based', 4,
      jsonb_build_object('requiresCleaningPlan', false)
    ),
    (
      'calc_svc_deep_cleaning_' || v_company_legacy, v_company_id, v_company_legacy,
      'deep_cleaning', 'Storstädning',
      'Noggrann storstädning baserad på yta med valbara tillval.',
      false, false, 'deep_cleaning_area_addons', 5,
      jsonb_build_object('requiresCleaningPlan', false)
    ),
    (
      'calc_svc_stairwell_cleaning_' || v_company_legacy, v_company_id, v_company_legacy,
      'stairwell_cleaning', 'Trappstädning',
      'Trappstädning prissatt efter antal våningsplan, trappuppgångar och frekvens.',
      false, false, 'stairwell_cleaning_floors_frequency', 6,
      jsonb_build_object('requiresCleaningPlan', false)
    ),
    (
      'calc_svc_procurement_' || v_company_legacy, v_company_id, v_company_legacy,
      'procurement', 'Upphandling',
      'Förfrågan om upphandling — hanteras som en kontaktförfrågan utan automatiskt pris.',
      false, false, 'inquiry_only_no_price', 7,
      jsonb_build_object('requiresCleaningPlan', false)
    )
  on conflict (legacy_id) do nothing;

  -- Starter QUESTION set for the office template (informational until an engine
  -- model + pricing_rules exist; affects_pricing marks the INTENDED price inputs).
  select id into v_office_id from calculator_services
    where company_id = v_company_id and service_key = 'office_cleaning' and deleted_at is null;

  if v_office_id is not null then
    insert into calculator_questions (
      legacy_id, company_id, company_legacy_id,
      calculator_service_id, calculator_service_legacy_id,
      question_key, label, help_text, input_type, required,
      options_json, validation_json, affects_pricing, sort_order, active
    ) values
      (
        'calc_q_office_sqm_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy,
        'sqm', 'Yta (m²)', 'Ungefärlig yta som ska städas.',
        'number', true,
        '[]'::jsonb, jsonb_build_object('min', 10, 'max', 5000, 'step', 1),
        true, 1, true
      ),
      (
        'calc_q_office_frequency_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy,
        'frequency', 'Hur ofta?', 'Hur ofta kontoret ska städas.',
        'select', true,
        jsonb_build_array(
          jsonb_build_object('value', 'daily',    'label', 'Varje dag'),
          jsonb_build_object('value', 'weekly',   'label', 'Varje vecka'),
          jsonb_build_object('value', 'biweekly', 'label', 'Varannan vecka'),
          jsonb_build_object('value', 'monthly',  'label', 'En gång i månaden')
        ),
        '{}'::jsonb, true, 2, true
      ),
      (
        'calc_q_office_toilets_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy,
        'toilets', 'Antal toaletter', null,
        'integer', false,
        '[]'::jsonb, jsonb_build_object('min', 0, 'max', 50, 'step', 1),
        true, 3, true
      ),
      (
        'calc_q_office_workstations_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy,
        'workstations', 'Antal arbetsplatser', 'Ungefärligt antal arbetsplatser.',
        'integer', false,
        '[]'::jsonb, jsonb_build_object('min', 0, 'max', 1000, 'step', 1),
        true, 4, true
      ),
      (
        'calc_q_office_postal_code_' || v_company_legacy, v_company_id, v_company_legacy,
        v_office_id, v_office_legacy,
        'postal_code', 'Postnummer', 'Vi kontrollerar att vi täcker ert område.',
        'postal_code', true,
        '[]'::jsonb, jsonb_build_object('pattern', '^\d{3} ?\d{2}$'),
        false, 5, true
      )
    on conflict (legacy_id) do nothing;
  end if;

  raise notice 'Calculator service templates seeded (5 hidden drafts) for company "%".', v_company_legacy;
end $$;
