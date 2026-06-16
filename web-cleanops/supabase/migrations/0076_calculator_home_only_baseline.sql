-- ============================================================================
-- 0076 — Persist HOME-ONLY calculator baseline   (Slice GPM-DATA-MIGRATION-1)
-- ============================================================================
-- PURPOSE
--   Encode, as an idempotent + company-scoped migration, the Home-only calculator
--   baseline that was already applied to the live database by the operator as
--   manual SQL (ticket GPM-DATA-CLEAN-1). This closes the "migration <-> live-data
--   drift" risk: a fresh rebuild/reseed from supabase/migrations now reproduces the
--   Home-only state instead of restoring move-out/office as ENABLED and re-creating
--   the Group A drafts.
--
--   Target end state for the MVP company (Stadalliansen, cmp_o2f6orw29m):
--     * home_cleaning ......... ENABLED (only active service)  -- NEVER touched here
--     * move_out_cleaning ..... Group B -> enabled=false, coming_soon=false
--     * office_cleaning ....... Group B -> enabled=false, coming_soon=false
--         + their cleaning_plans set active=false (history preserved)
--     * window_cleaning ....... Group A -> soft-deleted (deleted_at set)
--     * deep_cleaning ......... Group A -> soft-deleted (deleted_at set)
--     * stairwell_cleaning .... Group A -> soft-deleted (deleted_at set)
--     * procurement ........... Group A -> soft-deleted (deleted_at set)
--
-- WHAT THIS MIGRATION DOES (data UPDATEs only; additive intent, fully idempotent)
--   1. Group B: disable move_out_cleaning + office_cleaning (enabled=false,
--      coming_soon=false) and deactivate their cleaning_plans (active=false).
--      Questions, pricing_rules and any quote/prospect snapshots are KEPT.
--   2. Group A: soft-delete the four unsupported draft services by stamping
--      deleted_at (only when currently null, so re-runs never re-stamp the time).
--
-- IDEMPOTENCY / SAFETY CONTRACT
--   * One guarded `do $$` block resolving the SAME MVP company as 0060/0065 (by
--     name, then verified legacy_id, else a clean NOTICE no-op -- never a demo
--     company).
--   * Every UPDATE is guarded so a re-run is a no-op (won't even bump updated_at):
--       Group B service update matches only rows not already disabled;
--       Group B plan update matches only still-active plans;
--       Group A soft-delete matches only rows with deleted_at is null.
--   * home_cleaning is in NO target list -> never selected for write, never touched.
--   * Generic V2 services (sqm_fixed / hourly_by_area / ... admin shells) use OTHER
--     service_keys -> never matched, never touched.
--   * calculator_settings (the master enable/public flag) is NOT touched.
--   * No hard delete. No row is removed. No schema/RLS/trigger/index change.
--   * No questions, pricing_rules, size_bands, add-ons or quote history mutated.
--
-- NOTE ON LIVE STATE
--   The live database was already moved to this exact state manually; applying this
--   migration there is a guarded no-op. Its value is reproducibility from version
--   control on any fresh / reseeded environment.
-- ============================================================================

do $$
declare
  -- Same target resolution as the 0060/0065 seeds (never a demo company).
  v_target_name      text := 'Städalliansen Sverige AB';
  v_target_legacy    text := 'cmp_o2f6orw29m';
  v_company_legacy   text;
  v_company_id       uuid;
  v_group_b_services integer := 0;
  v_group_b_plans    integer := 0;
  v_group_a_services integer := 0;
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
    raise notice '0076 Home-only baseline SKIPPED: MVP company "%" not found in this environment.', v_target_name;
    return;
  end if;

  -- ── Group B — disable legacy ENABLED services (KEEP history; no soft-delete) ──
  -- home_cleaning is intentionally NOT in this list and is never touched.
  update calculator_services
     set enabled = false,
         coming_soon = false
   where company_id = v_company_id
     and deleted_at is null
     and service_key in ('move_out_cleaning', 'office_cleaning')
     and (enabled is distinct from false or coming_soon is distinct from false);
  get diagnostics v_group_b_services = row_count;

  -- Deactivate the Group B services' cleaning plans (history preserved, not deleted).
  update cleaning_plans
     set active = false
   where company_id = v_company_id
     and deleted_at is null
     and service_key in ('move_out_cleaning', 'office_cleaning')
     and active = true;
  get diagnostics v_group_b_plans = row_count;

  -- ── Group A — soft-delete unsupported DRAFT services (history preserved) ──
  -- Only stamps deleted_at while still live, so re-runs preserve the original time.
  update calculator_services
     set deleted_at = now()
   where company_id = v_company_id
     and deleted_at is null
     and service_key in ('window_cleaning', 'deep_cleaning', 'stairwell_cleaning', 'procurement');
  get diagnostics v_group_a_services = row_count;

  raise notice '0076 Home-only baseline applied for company "%": Group B disabled % service row(s) + deactivated % plan(s); Group A soft-deleted % service row(s). home_cleaning untouched.',
    v_company_legacy, v_group_b_services, v_group_b_plans, v_group_a_services;
end $$;
