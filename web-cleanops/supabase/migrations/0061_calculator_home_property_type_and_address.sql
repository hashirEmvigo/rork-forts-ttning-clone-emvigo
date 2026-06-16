-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 9A): HOME CLEANING — two NON-PRICING
--   informational questions (Typ av bostad + Adress).  [ADDITIVE / IDEMPOTENT]
-- ============================================================================
--
-- PURPOSE
--   Add two real, persisted, NON-PRICING questions to the HOME CLEANING service
--   so the public calculator can collect (and the Super Admin inbox can show)
--   the property type and a free-text address with each quote request:
--     • property_type  — select  (Lägenhet / Villa / Radhus / Annat) — mirrors
--                         the move-out option set seeded in 0060.
--     • address        — text    (optional street address).
--
--   Both are affects_pricing = FALSE, so they are captured into the answers
--   snapshot but NEVER feed the pricing engine (which only reads sqm / plan /
--   addons). The Postnummer remains the single canonical CONTACT field — this
--   migration does NOT add a postal_code question (the existing one is no longer
--   rendered by the public page; see PriceCalculator.tsx).
--
-- WHY A MIGRATION (and why it is safe)
--   Questions are configurable ROWS (0058). These are additive INSERTs guarded
--   by `on conflict (legacy_id) do nothing`, plus a tiny, GUARDED re-ordering of
--   two existing home questions so the new property_type slots in right after
--   `bathrooms` (sort_order 3). The re-order only fires when a row is still at
--   its 0060 seeded sort_order, so it never clobbers a later Super Admin edit and
--   re-running is a no-op.
--
-- SCOPE GUARD
--   • Touches HOME CLEANING questions only. No schema/table/enum/RLS changes.
--   • No pricing_rules, no settings, no plans, no prospects/quote_requests.
--   • enabled stays as-is (the calculator remains DARK until flipped on).
--
-- TARGET COMPANY (mirrors 0060 — resolve by name, then verified legacy_id; never
--   fall back to a demo company).
-- ============================================================================

do $$
declare
  v_target_name    text := 'Städalliansen Sverige AB';  -- primary match: stable business identity
  v_target_legacy  text := 'cmp_o2f6orw29m';            -- fallback match: verified live legacy_id

  v_company_legacy text;
  v_company_id     uuid;
  v_home_id        uuid;
  v_home_legacy    text;
begin
  -- ── Resolve the target company (no demo fallback). ────────────────────────
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
    raise notice 'Calculator home-fields migration SKIPPED: company "%" (legacy "%") not found.', v_target_name, v_target_legacy;
    return;
  end if;

  -- ── Resolve the HOME CLEANING service (live row only). ────────────────────
  select id into v_home_id
    from calculator_services
   where company_id = v_company_id and service_key = 'home_cleaning' and deleted_at is null;

  if v_home_id is null then
    raise notice 'Calculator home-fields migration SKIPPED: home_cleaning service not found for "%".', v_company_legacy;
    return;
  end if;

  v_home_legacy := 'calc_svc_home_cleaning_' || v_company_legacy;

  -- ── GUARDED re-order: make room at sort_order 3 for property_type. ────────
  --    Only shifts rows still sitting at their 0060 seeded sort_order, so a
  --    later Super Admin re-order is never clobbered and re-runs are no-ops.
  update calculator_questions
     set sort_order = 4
   where legacy_id = 'calc_q_home_frequency_' || v_company_legacy
     and sort_order = 3 and deleted_at is null;

  update calculator_questions
     set sort_order = 6
   where legacy_id = 'calc_q_home_postal_code_' || v_company_legacy
     and sort_order = 4 and deleted_at is null;

  -- ── Insert the two informational questions (additive, idempotent). ────────
  insert into calculator_questions (
    legacy_id, company_id, company_legacy_id,
    calculator_service_id, calculator_service_legacy_id,
    question_key, label, help_text, input_type, required,
    options_json, validation_json, affects_pricing, sort_order, active
  ) values
    (
      'calc_q_home_property_type_' || v_company_legacy, v_company_id, v_company_legacy,
      v_home_id, v_home_legacy,
      'property_type', 'Typ av bostad', null,
      'select', false,                               -- optional; informational only
      jsonb_build_array(
        jsonb_build_object('value', 'apartment', 'label', 'Lägenhet'),
        jsonb_build_object('value', 'house',     'label', 'Villa'),
        jsonb_build_object('value', 'terraced',  'label', 'Radhus'),
        jsonb_build_object('value', 'other',     'label', 'Annat')
      ),
      '{}'::jsonb, false, 3, true                    -- affects_pricing = FALSE
    ),
    (
      'calc_q_home_address_' || v_company_legacy, v_company_id, v_company_legacy,
      v_home_id, v_home_legacy,
      'address', 'Adress', 'Gatuadress där städningen ska utföras (valfritt).',
      'text', false,                                 -- optional in MVP
      '[]'::jsonb, jsonb_build_object('maxLength', 200),
      false, 7, true                                 -- affects_pricing = FALSE
    )
  on conflict (legacy_id) do nothing;

  raise notice 'Calculator home-fields migration applied for "%": property_type + address (non-pricing).', v_company_legacy;
end $$;

-- ============================================================================
-- NOT CHANGED (scope guard)
--   • No move-out questions (move-out already has its own property_type in 0060).
--   • No postal_code question added — Postnummer is the single canonical CONTACT
--     field; the public page no longer renders a postal_code question.
--   • No pricing_rules — both new questions are affects_pricing = FALSE.
-- ============================================================================
