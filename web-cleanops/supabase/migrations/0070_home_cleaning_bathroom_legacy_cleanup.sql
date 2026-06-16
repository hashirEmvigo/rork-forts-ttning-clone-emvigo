-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 12I cleanup): HOME BATHROOM LEGACY NOISE
-- ============================================================================
--
-- PURPOSE
--   Finish retiring the legacy bathroom configuration from the active
--   home_cleaning calculator config WITHOUT deleting any history. Slice 12I
--   already stopped the engine from reading bathrooms and set the bathrooms
--   question active=false (migration 0069). This follow-up removes the
--   remaining "active/relevant" legacy noise from admin/pricing config:
--     1. Deactivates the legacy `bathroom_extra_hours` home pricing rule
--        (active=false) so it no longer appears as a relevant home rule.
--     2. Hardens the home `bathrooms` question so it is active=false,
--        required=false AND affects_pricing=false (defence in depth — old
--        rows may still carry required/affects_pricing flags).
--
-- WHAT THIS MIGRATION DOES (additive + idempotent + safe)
--   • UPDATEs the home `bathroom_extra_hours` pricing rule to active=false.
--   • UPDATEs the home `bathrooms` question to active=false, required=false,
--     affects_pricing=false. Plain idempotent writes (re-running sets the
--     same values).
--
-- WHAT THIS MIGRATION DOES NOT DO (scope guard)
--   • Does NOT touch move_out_cleaning (it has its OWN bathrooms question +
--     extra-bathroom math — left untouched), office_cleaning, or any draft.
--   • Does NOT hard delete anything — the rule and question rows remain for
--     historical/quote-snapshot compatibility, only deactivated.
--   • Does NOT change pricing math, RLS, CHECKs, frequency options, the four
--     0069 time rules, or any Edge Function.
--   • Does NOT enable the calculator. calculator_settings.enabled stays FALSE.
--
-- IDEMPOTENCY
--   One guarded `do $$` block resolving the SAME MVP company as 0060/0065/
--   0066/0067/0068/0069 (by name, then verified legacy_id, else a clean
--   NOTICE no-op — never a demo company). Scoped strictly to the home
--   service's `bathroom_extra_hours` rule and `bathrooms` question.
-- ============================================================================

do $$
declare
  v_target_name    text := 'Städalliansen Sverige AB';
  v_target_legacy  text := 'cmp_o2f6orw29m';
  v_company_legacy text;
  v_company_id     uuid;
  v_home_id        uuid;
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
    raise notice 'Home bathroom cleanup SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  select id into v_home_id
    from calculator_services
   where company_id = v_company_id and service_key = 'home_cleaning' and deleted_at is null
   limit 1;

  if v_home_id is null then
    raise notice 'Home bathroom cleanup SKIPPED: home_cleaning service not found (run 0060 first).';
    return;
  end if;

  -- ── 1. Deactivate the legacy bathroom_extra_hours home pricing rule ─────────
  --    Bathrooms no longer affect the home price (engine stopped reading them
  --    in 12I). The row stays for history; it is just no longer active.
  update pricing_rules
     set active = false
   where company_id = v_company_id
     and calculator_service_id = v_home_id
     and rule_key = 'bathroom_extra_hours';

  -- ── 2. Harden the home bathrooms question (inactive + non-required + no price)
  --    Defence in depth on top of 0069's active=false: also clears required and
  --    affects_pricing so no public flow can surface or price it.
  update calculator_questions
     set active = false,
         required = false,
         affects_pricing = false
   where company_id = v_company_id
     and calculator_service_id = v_home_id
     and question_key = 'bathrooms'
     and deleted_at is null;

  raise notice 'Home bathroom cleanup applied for company "%": bathroom_extra_hours deactivated, bathrooms question hardened (inactive/non-required/non-pricing).', v_company_legacy;
end $$;

-- ============================================================================
-- INTENTIONALLY NOT DONE (scope guard for this slice)
--   • No move-out / office / draft-service change.
--   • No hard deletes; no frequency / 0069 rule change.
--   • No pricing-math, RLS, CHECK, or Edge Function change.
--   • No calculator activation — enabled stays FALSE.
-- ============================================================================
