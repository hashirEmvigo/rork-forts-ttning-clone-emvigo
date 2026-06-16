-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 1C): DEFAULT MVP SEED  [PROPOSED]
-- ============================================================================
--
-- STATUS: PROPOSED ONLY — `.sql.proposed` is never picked up by the migration
-- runner (which globs `*.sql`). Nothing here is applied until it is reviewed and
-- renamed to `0060_calculator_seed.sql`. Apply 0058 then 0059 then 0060 (this
-- file references the tables created by both).
--
-- PURPOSE
--   Seed ONE company's first working calculator configuration so the Super Admin
--   page and (later) the public page have real rows to render. Seeds ONLY the
--   admin/config side (0058 tables) — no prospects, no quote_requests (those are
--   captured at runtime, never seeded).
--
-- WHAT IS SEEDED (idempotent, additive)
--   • calculator_settings  — 1 row  (behaviour + all public page copy)
--   • calculator_services  — 2 rows (home_cleaning, move_out_cleaning)
--   • cleaning_plans        — 3 rows (flexible, fixed, priority)
--   • calculator_questions — 5 rows (home) + 7 rows (move-out)
--   • pricing_rules         — 10 rows (home) + 8 rows (move-out)
--   Window/office cleaning are intentionally NOT seeded (kept out of MVP).
--
-- IDEMPOTENCY
--   The whole seed runs inside one `do $$` block guarded by the target company.
--   Every insert uses `on conflict (legacy_id) do nothing`, and every legacy_id
--   is DETERMINISTIC (built from a stable key + the company legacy id). Re-running
--   never duplicates a row and never clobbers later Super Admin edits (a seed sets
--   *initial defaults* only). If the target company does not exist yet, the block
--   raises a NOTICE and exits cleanly (a safe no-op, not an error).
--
-- ── PLACEHOLDER LEGEND (what the human must review before going live) ────────
--   [TARGET]      v_target_name / v_target_legacy — WHICH company this seeds.
--                 Defaults to the VERIFIED live "Städalliansen Sverige AB"
--                 (legacy 'cmp_o2f6orw29m'); resolved by name, then legacy_id.
--                 Never falls back to a demo company (cmp_nordlys/cmp_fjord).
--   [PRICE#]      every numeric in cleaning_plans.hourly_rate and pricing_rules
--                 is a PLACEHOLDER business number — replace with real figures.
--   [COPY]        all customer-facing text (content json, display_name,
--                 description, cancellation terms, FAQ, contact email/phone) is
--                 placeholder Swedish copy — review/rewrite freely.
--   [STRUCTURAL]  service_key / pricing_model / input_type / plan_key / rule_key
--                 / rule_type / option values / enum-like terms are STABLE machine
--                 keys the engine + UI switch on — DO NOT rename casually.
--
-- INTENTIONAL DEFAULTS
--   • enabled = false  → the calculator ships DARK. Super Admin flips it on only
--     after replacing the placeholder numbers (prevents a public launch on fake
--     prices). public_slug is still seeded ('rakna-ut-ditt-pris').
--   • Confirmations encoded here: email-required & cleaning-plan-vs-service rules
--     are documented at each relevant row (see inline notes).
-- ============================================================================

do $$
declare
  -- ===========================================================================
  -- [TARGET] The company this calculator config belongs to — the public
  --   Städportalen / Städalliansen MVP owner. This is NOT a demo company.
  --
  --   VERIFIED against the live target environment (Supabase project ref
  --   swqcdcpwofdnmoureifu) on 2026-06-07:
  --     • 'Städalliansen Sverige AB'  → legacy_id 'cmp_o2f6orw29m'   (EXISTS, active)
  --     • 'cmp_nordlys' / 'cmp_fjord' → 0002 demo seeds; DO NOT exist at runtime
  --        in this environment, so they are neither valid nor safe targets.
  --     • 'cmp_9ovsofaxha'            → does NOT exist (an earlier guess was wrong).
  --
  --   RESOLUTION (idempotent; never attaches calculator config to a demo company):
  --     1. match by NAME  — the stable business identity. legacy_ids here are
  --        randomly generated per environment (e.g. 'cmp_o2f6orw29m'), so name
  --        survives a DB reset that would regenerate the legacy_id.
  --     2. else match by the VERIFIED legacy_id (belt-and-suspenders).
  --     3. else NO-OP with a clear NOTICE — never fall back to cmp_nordlys/cmp_fjord.
  --   The RESOLVED legacy_id is what every child row's deterministic legacy_id is
  --   built from, so the whole seed stays internally consistent per environment.
  -- ===========================================================================
  v_target_name    text := 'Städalliansen Sverige AB';  -- primary match: stable business identity
  v_target_legacy  text := 'cmp_o2f6orw29m';            -- fallback match: verified live legacy_id

  v_company_legacy text;   -- the ACTUAL legacy_id, RESOLVED at runtime (never hardcoded to a demo co)
  v_company_id     uuid;
  v_home_id        uuid;
  v_moveout_id     uuid;
  v_home_legacy    text;
  v_moveout_legacy text;
begin
  -- ── Resolve the target company WITHOUT defaulting to a demo company. ───────
  --    gen_random_uuid is unknowable ahead of time, so we ALWAYS resolve BOTH the
  --    UUID (for FKs) and the legacy_id (for child legacy_id keys) at runtime.
  --    Step 1: by stable name.
  select id, legacy_id into v_company_id, v_company_legacy
    from companies
   where name = v_target_name and status <> 'archived'
   order by created_at asc
   limit 1;

  --    Step 2: fallback by verified legacy_id.
  if v_company_id is null then
    select id, legacy_id into v_company_id, v_company_legacy
      from companies
     where legacy_id = v_target_legacy and status <> 'archived'
     limit 1;
  end if;

  --    Step 3: hard stop — no demo fallback.
  if v_company_id is null then
    raise notice 'Calculator seed SKIPPED: MVP company "%" (legacy "%") not found in this environment. No demo fallback — replace v_target_* and re-run.', v_target_name, v_target_legacy;
    return;
  end if;

  raise notice 'Calculator seed TARGET resolved: "%" (legacy_id "%", id %).', v_target_name, v_company_legacy, v_company_id;

  v_home_legacy    := 'calc_svc_home_cleaning_'     || v_company_legacy;
  v_moveout_legacy := 'calc_svc_move_out_cleaning_' || v_company_legacy;

  -- =========================================================================
  -- 1. calculator_settings  (one row; behaviour + all editable page copy)
  --    [COPY] everything in `content` is placeholder Swedish copy.
  --    Confirmation: show_login_prompt_after_submit = true (login prompt shown).
  -- =========================================================================
  insert into calculator_settings (
    legacy_id, company_id, company_legacy_id,
    enabled, public_slug, embed_key,
    price_display_mode, show_price_before_contact, require_contact_before_result,
    show_login_prompt_after_submit,
    quote_validity_days, manual_review_threshold_amount, currency, rut_display_mode,
    auto_create_prospect, auto_create_quote_request, default_quote_status,
    content, data
  ) values (
    'calc_settings_' || v_company_legacy, v_company_id, v_company_legacy,
    false,                       -- [DEFAULT] ship dark; Super Admin enables after real numbers
    'rakna-ut-ditt-pris',        -- public route handle (real, intended slug)
    null,
    'range',                     -- [STRUCTURAL] exact | range | hidden_until_submit
    true,                        -- show price before contact details
    false,                       -- do not force contact before showing a result
    true,                        -- show login prompt after submit (confirmation)
    30,                          -- quote validity (days)
    10000,                       -- [PRICE#] manual-review threshold (SEK) — PLACEHOLDER
    'SEK',
    'none',                      -- [STRUCTURAL] none | show_after_rut | show_before_after
    true,                        -- auto-create prospect on submit
    true,                        -- auto-create quote request on submit
    'submitted',                 -- [STRUCTURAL] submitted | pending_review | ready_for_customer
    -- [COPY] page copy slots (title/subtitle/intro/result/confirmation/login/
    -- back-link/contact/FAQ/CTA labels). Adding a slot needs NO migration.
    jsonb_build_object(
      'pageTitle',        'Räkna ut ditt pris',
      'pageSubtitle',     'Få en uppskattad kostnad för din städning på under en minut.',
      'introText',        'Svara på några snabba frågor så ger vi dig ett prisintervall direkt. Ingen bindning.',
      'resultPanelText',  'Din uppskattning baseras på ytan, antal badrum och vald plan. Slutpriset bekräftas efter en kort kontakt.',
      'quoteCreatedText', 'Tack! Din förfrågan är mottagen. Vi återkommer med en bekräftad offert inom kort.',
      'loginPromptText',  'Vill du följa din förfrågan? Skapa ett konto med din e-post så får du tillgång till din portal.',
      'backToWebsite',    jsonb_build_object('label', 'Tillbaka till webbplatsen', 'href', '/'),
      'contactHelp',      jsonb_build_object(
                            'heading', 'Behöver du hjälp?',
                            'text',    'Kontakta oss så hjälper vi dig att komma igång.',
                            'email',   'PLACEHOLDER_kontakt@example.se',
                            'phone',   'PLACEHOLDER_+46 00 000 00 00'
                          ),
      'ctaLabels',        jsonb_build_object(
                            'start',       'Börja här',
                            'next',        'Nästa',
                            'back',        'Tillbaka',
                            'getPrice',    'Visa pris',
                            'submitQuote', 'Skicka offertförfrågan'
                          ),
      'faq', jsonb_build_array(
        jsonb_build_object('q', 'Hur beräknas priset?',  'a', 'PLACEHOLDER: Priset baseras på ytan, antal badrum, vald plan och hur ofta städningen sker.'),
        jsonb_build_object('q', 'Är priset bindande?',   'a', 'PLACEHOLDER: Nej, du får ett uppskattat prisintervall. Slutpriset bekräftas efter kontakt.'),
        jsonb_build_object('q', 'Ingår RUT-avdrag?',     'a', 'PLACEHOLDER: Beskriv hur RUT-avdrag hanteras här.')
      )
    ),
    '{}'::jsonb
  )
  on conflict (legacy_id) do nothing;

  -- =========================================================================
  -- 2. calculator_services  (2 rows)
  --    Confirmation: cleaning plans apply to the HOURLY service (home cleaning);
  --    move-out does NOT require a plan → settings_json.requiresCleaningPlan.
  -- =========================================================================
  insert into calculator_services (
    legacy_id, company_id, company_legacy_id,
    service_key, display_name, description,
    enabled, coming_soon, pricing_model, sort_order, settings_json
  ) values
    (
      v_home_legacy, v_company_id, v_company_legacy,
      'home_cleaning',                                   -- [STRUCTURAL]
      'Hemstädning',                                     -- [COPY]
      'Återkommande hemstädning med samma höga kvalitet varje gång.', -- [COPY]
      true, false,
      'home_cleaning_recommended_hours',                 -- [STRUCTURAL] pricing model
      1,
      jsonb_build_object('requiresCleaningPlan', true)   -- home uses cleaning plans
    ),
    (
      v_moveout_legacy, v_company_id, v_company_legacy,
      'move_out_cleaning',                               -- [STRUCTURAL]
      'Flyttstädning',                                   -- [COPY]
      'Noggrann flyttstädning enligt branschens checklista.',         -- [COPY]
      true, false,
      'move_out_fixed_plus_addons',                      -- [STRUCTURAL] pricing model
      2,
      jsonb_build_object('requiresCleaningPlan', false)  -- move-out needs NO plan (confirmation)
    )
  on conflict (legacy_id) do nothing;

  -- Resolve service UUIDs for the question/rule FKs (visible within this txn).
  select id into v_home_id    from calculator_services
    where company_id = v_company_id and service_key = 'home_cleaning'     and deleted_at is null;
  select id into v_moveout_id from calculator_services
    where company_id = v_company_id and service_key = 'move_out_cleaning' and deleted_at is null;

  -- =========================================================================
  -- 3. cleaning_plans  (3 rows — COMMERCIAL terms only, never cleaning content)
  --    [PRICE#] hourly_rate values are PLACEHOLDERS. 'flexible' is the default.
  -- =========================================================================
  insert into cleaning_plans (
    legacy_id, company_id, company_legacy_id,
    plan_key, name, description, hourly_rate,
    flexibility_level, customer_day_time_control, same_staff_preference_level,
    booking_priority, cancellation_terms_summary,
    is_default, active, sort_order, data
  ) values
    (
      'clean_plan_flexible_' || v_company_legacy, v_company_id, v_company_legacy,
      'flexible',                                        -- [STRUCTURAL]
      'Flexibel',                                        -- [COPY]
      'Lägre timpris. Vi har större flexibilitet kring dag och tid.', -- [COPY]
      349,                                               -- [PRICE#] SEK/h — PLACEHOLDER
      'high', 'company_controlled', 'low', 'standard',
      'PLACEHOLDER: Avbokning senast 48 timmar innan besök.',         -- [COPY]
      true,  true, 1, '{}'::jsonb                        -- default plan
    ),
    (
      'clean_plan_fixed_' || v_company_legacy, v_company_id, v_company_legacy,
      'fixed',                                           -- [STRUCTURAL]
      'Fast',                                            -- [COPY]
      'Fast dag och tid med starkare personalkontinuitet.',           -- [COPY]
      399,                                               -- [PRICE#] SEK/h — PLACEHOLDER
      'medium', 'preferred', 'medium', 'elevated',
      'PLACEHOLDER: Avbokning senast 72 timmar innan besök.',         -- [COPY]
      false, true, 2, '{}'::jsonb
    ),
    (
      'clean_plan_priority_' || v_company_legacy, v_company_id, v_company_legacy,
      'priority',                                        -- [STRUCTURAL]
      'Prioritet',                                       -- [COPY]
      'Högsta prioritet på dina önskemål och starkast kontinuitet.',  -- [COPY]
      449,                                               -- [PRICE#] SEK/h — PLACEHOLDER
      'low', 'guaranteed', 'high', 'priority',
      'PLACEHOLDER: Avbokning senast 5 dagar innan besök.',           -- [COPY]
      false, true, 3, '{}'::jsonb
    )
  on conflict (legacy_id) do nothing;

  -- =========================================================================
  -- 4. calculator_questions — HOME CLEANING (5 rows)
  --    Plan selection is handled by the cleaning-plan selector (service.settings
  --    requiresCleaningPlan=true), not a question row.
  -- =========================================================================
  if v_home_id is not null then
    insert into calculator_questions (
      legacy_id, company_id, company_legacy_id,
      calculator_service_id, calculator_service_legacy_id,
      question_key, label, help_text, input_type, required,
      options_json, validation_json, affects_pricing, sort_order, active
    ) values
      (
        'calc_q_home_sqm_' || v_company_legacy, v_company_id, v_company_legacy,
        v_home_id, v_home_legacy,
        'sqm', 'Boyta (m²)', 'Ange ungefärlig yta som ska städas.',   -- [STRUCTURAL key] / [COPY]
        'number', true,
        '[]'::jsonb, jsonb_build_object('min', 10, 'max', 500, 'step', 1),
        true, 1, true
      ),
      (
        'calc_q_home_bathrooms_' || v_company_legacy, v_company_id, v_company_legacy,
        v_home_id, v_home_legacy,
        'bathrooms', 'Antal badrum', null,
        'integer', true,
        '[]'::jsonb, jsonb_build_object('min', 0, 'max', 10, 'step', 1),
        true, 2, true
      ),
      (
        'calc_q_home_frequency_' || v_company_legacy, v_company_id, v_company_legacy,
        v_home_id, v_home_legacy,
        'frequency', 'Hur ofta?', 'Återkommande städning ger ett lägre pris per tillfälle.',
        'select', true,
        jsonb_build_array(
          jsonb_build_object('value', 'weekly',   'label', 'Varje vecka'),
          jsonb_build_object('value', 'biweekly', 'label', 'Varannan vecka'),
          jsonb_build_object('value', 'monthly',  'label', 'En gång i månaden'),
          jsonb_build_object('value', 'one_time', 'label', 'Engångsstädning')
        ),
        '{}'::jsonb, true, 3, true
      ),
      (
        'calc_q_home_postal_code_' || v_company_legacy, v_company_id, v_company_legacy,
        v_home_id, v_home_legacy,
        'postal_code', 'Postnummer', 'Vi kontrollerar att vi täcker ditt område.',
        'postal_code', true,
        '[]'::jsonb, jsonb_build_object('pattern', '^\d{3} ?\d{2}$'),
        false, 4, true                                   -- informational; not a price factor in MVP
      ),
      (
        'calc_q_home_addons_' || v_company_legacy, v_company_id, v_company_legacy,
        v_home_id, v_home_legacy,
        'addons', 'Tillval', 'Lägg till extra moment vid behov.',
        'multiselect', false,
        -- option values MUST match the addon_hours_* rule keys below
        jsonb_build_array(
          jsonb_build_object('value', 'oven',          'label', 'Ugn'),
          jsonb_build_object('value', 'fridge',        'label', 'Kyl/frys'),
          jsonb_build_object('value', 'inside_windows','label', 'Fönsterputs insida')
        ),
        '{}'::jsonb, true, 5, true
      )
    on conflict (legacy_id) do nothing;
  end if;

  -- =========================================================================
  -- 5. calculator_questions — MOVE-OUT CLEANING (7 rows)
  --    Add-ons for move-out are modelled as explicit toggles (glazed_balcony,
  --    divisible_windows) + extra-bathroom derived from `bathrooms`, matching the
  --    addon_* pricing rules exactly (no orphan generic add-ons in MVP).
  -- =========================================================================
  if v_moveout_id is not null then
    insert into calculator_questions (
      legacy_id, company_id, company_legacy_id,
      calculator_service_id, calculator_service_legacy_id,
      question_key, label, help_text, input_type, required,
      options_json, validation_json, affects_pricing, sort_order, active
    ) values
      (
        'calc_q_moveout_sqm_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'sqm', 'Boyta (m²)', 'Ange ungefärlig yta som ska flyttstädas.',
        'number', true,
        '[]'::jsonb, jsonb_build_object('min', 10, 'max', 500, 'step', 1),
        true, 1, true
      ),
      (
        'calc_q_moveout_property_type_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'property_type', 'Typ av bostad', null,
        'select', true,
        jsonb_build_array(
          jsonb_build_object('value', 'apartment', 'label', 'Lägenhet'),
          jsonb_build_object('value', 'house',     'label', 'Villa'),
          jsonb_build_object('value', 'terraced',  'label', 'Radhus'),
          jsonb_build_object('value', 'other',     'label', 'Annat')
        ),
        '{}'::jsonb, false, 2, true                      -- informational in MVP (price is per m²)
      ),
      (
        'calc_q_moveout_bathrooms_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'bathrooms', 'Antal badrum', 'Första badrummet ingår; tillkommande badrum prissätts extra.',
        'integer', true,
        '[]'::jsonb, jsonb_build_object('min', 1, 'max', 10, 'step', 1),
        true, 3, true                                    -- drives addon_extra_bathroom (count > 1)
      ),
      (
        'calc_q_moveout_glazed_balcony_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'glazed_balcony', 'Inglasad balkong', 'Inglasad balkong städas som tillval.',
        'boolean', false,
        '[]'::jsonb, '{}'::jsonb, true, 4, true          -- → addon_glazed_balcony
      ),
      (
        'calc_q_moveout_divisible_windows_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'divisible_windows', 'Spröjsade fönster', 'Fönster med spröjs tar längre tid och prissätts som tillval.',
        'boolean', false,
        '[]'::jsonb, '{}'::jsonb, true, 5, true          -- → addon_divisible_windows
      ),
      (
        'calc_q_moveout_desired_date_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'desired_date', 'Önskat datum', 'När vill du att städningen utförs?',
        'date', false,
        '[]'::jsonb, '{}'::jsonb, false, 6, true         -- scheduling info; not a price factor
      ),
      (
        'calc_q_moveout_postal_code_' || v_company_legacy, v_company_id, v_company_legacy,
        v_moveout_id, v_moveout_legacy,
        'postal_code', 'Postnummer', 'Vi kontrollerar att vi täcker ditt område.',
        'postal_code', true,
        '[]'::jsonb, jsonb_build_object('pattern', '^\d{3} ?\d{2}$'),
        false, 7, true
      )
    on conflict (legacy_id) do nothing;
  end if;

  -- =========================================================================
  -- 6. pricing_rules — HOME CLEANING (10 rows)
  --    Formula (doc 04): recommended_hours = base_hours + sqm*hours_per_sqm
  --      + bathrooms*bathroom_extra_hours + Σ addon_hours, clamped to minimum_hours;
  --      raw_price = recommended_hours * plan.hourly_rate; ± margin; round.
  --    [PRICE#] EVERY value_numeric below is a PLACEHOLDER.
  -- =========================================================================
  if v_home_id is not null then
    insert into pricing_rules (
      legacy_id, company_id, company_legacy_id,
      calculator_service_id, calculator_service_legacy_id,
      rule_key, rule_type, value_numeric, value_json, condition_json,
      active, sort_order, data
    ) values
      ('calc_rule_home_base_hours_'            || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'base_hours',            'numeric_factor', 1.5,  '{}'::jsonb, '{}'::jsonb, true, 1,  '{}'::jsonb),
      ('calc_rule_home_hours_per_sqm_'         || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'hours_per_sqm',         'numeric_factor', 0.02, '{}'::jsonb, '{}'::jsonb, true, 2,  '{}'::jsonb),
      ('calc_rule_home_minimum_hours_'         || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'minimum_hours',         'threshold',      2,    '{}'::jsonb, '{}'::jsonb, true, 3,  '{}'::jsonb),
      ('calc_rule_home_bathroom_extra_hours_'  || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'bathroom_extra_hours',  'numeric_factor', 0.25, '{}'::jsonb, '{}'::jsonb, true, 4,  '{}'::jsonb),
      ('calc_rule_home_addon_hours_oven_'      || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'addon_hours_oven',      'addon_hours',    0.5,  '{}'::jsonb, '{}'::jsonb, true, 5,  '{}'::jsonb),
      ('calc_rule_home_addon_hours_fridge_'    || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'addon_hours_fridge',    'addon_hours',    0.5,  '{}'::jsonb, '{}'::jsonb, true, 6,  '{}'::jsonb),
      ('calc_rule_home_addon_hours_inwin_'     || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'addon_hours_inside_windows', 'addon_hours', 0.75, '{}'::jsonb, '{}'::jsonb, true, 7, '{}'::jsonb),
      ('calc_rule_home_range_min_percent_'     || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'range_min_percent',     'margin_percent', 10,   '{}'::jsonb, '{}'::jsonb, true, 8,  '{}'::jsonb),
      ('calc_rule_home_range_max_percent_'     || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'range_max_percent',     'margin_percent', 10,   '{}'::jsonb, '{}'::jsonb, true, 9,  '{}'::jsonb),
      ('calc_rule_home_rounding_increment_'    || v_company_legacy, v_company_id, v_company_legacy, v_home_id, v_home_legacy, 'rounding_increment',    'rounding',       50,   '{}'::jsonb, '{}'::jsonb, true, 10, '{}'::jsonb)
    on conflict (legacy_id) do nothing;
  end if;

  -- =========================================================================
  -- 7. pricing_rules — MOVE-OUT CLEANING (8 rows)
  --    Formula (doc 04): base = max(minimum_price, sqm*price_per_sqm);
  --      addons = glazed_balcony + divisible_windows + (bathrooms-1)*extra_bathroom;
  --      raw_price = base + addons; ± margin; round.
  --    [PRICE#] EVERY value_numeric below is a PLACEHOLDER.
  -- =========================================================================
  if v_moveout_id is not null then
    insert into pricing_rules (
      legacy_id, company_id, company_legacy_id,
      calculator_service_id, calculator_service_legacy_id,
      rule_key, rule_type, value_numeric, value_json, condition_json,
      active, sort_order, data
    ) values
      ('calc_rule_moveout_price_per_sqm_'        || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'price_per_sqm',           'numeric_factor', 35,   '{}'::jsonb, '{}'::jsonb, true, 1, '{}'::jsonb),
      ('calc_rule_moveout_minimum_price_'        || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'minimum_price',           'threshold',      1500, '{}'::jsonb, '{}'::jsonb, true, 2, '{}'::jsonb),
      ('calc_rule_moveout_addon_glazed_balcony_' || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'addon_glazed_balcony',    'addon_price',    300,  '{}'::jsonb, '{}'::jsonb, true, 3, '{}'::jsonb),
      ('calc_rule_moveout_addon_div_windows_'    || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'addon_divisible_windows', 'addon_price',    250,  '{}'::jsonb, '{}'::jsonb, true, 4, '{}'::jsonb),
      ('calc_rule_moveout_addon_extra_bathroom_' || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'addon_extra_bathroom',    'addon_price',    200,  '{}'::jsonb, '{}'::jsonb, true, 5, '{}'::jsonb),
      ('calc_rule_moveout_range_min_percent_'    || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'range_min_percent',       'margin_percent', 10,   '{}'::jsonb, '{}'::jsonb, true, 6, '{}'::jsonb),
      ('calc_rule_moveout_range_max_percent_'    || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'range_max_percent',       'margin_percent', 10,   '{}'::jsonb, '{}'::jsonb, true, 7, '{}'::jsonb),
      ('calc_rule_moveout_rounding_increment_'   || v_company_legacy, v_company_id, v_company_legacy, v_moveout_id, v_moveout_legacy, 'rounding_increment',      'rounding',       50,   '{}'::jsonb, '{}'::jsonb, true, 8, '{}'::jsonb)
    on conflict (legacy_id) do nothing;
  end if;

  raise notice 'Calculator seed applied for company "%" (home + move-out, 3 plans).', v_company_legacy;
end $$;

-- ============================================================================
-- INTENTIONALLY NOT SEEDED (scope guard for this slice)
--   • No window_cleaning / office_cleaning services (kept out of MVP).
--   • No prospects / quote_requests / quote_request_answers — those are captured
--     at runtime by the Slice 3 Edge Function, never seeded.
--   • No anon/public access, no Edge Function, no pricing-engine code.
--   • No Company-Admin rows; this seeds ONE Super-Admin-managed company config.
--   • enabled stays false → calculator is dark until real numbers are entered.
-- ============================================================================
