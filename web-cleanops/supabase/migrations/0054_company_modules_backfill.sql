-- ============================================================================
-- CleanOps — COMPANY MODULES (Phase 2B): backfill per-company availability for
--   existing ACTIVE companies × ACTIVE global modules (explicit-offer + backfill).
-- ============================================================================
--
-- CONTEXT / ROOT CAUSE THIS MIGRATION FIXES
--   Phase 2A (migration 0053) created the `company_modules` table together with
--   its FULL RLS policy set (own-company + super_admin SELECT/INSERT/UPDATE; no
--   DELETE policy → removal is a soft-delete UPDATE) and seeded the 12 GLOBAL
--   modules, but intentionally left company_modules UNWIRED — so the live table
--   is EMPTY. With the Phase-2B read path now Supabase-authoritative, an empty
--   company_modules table means every Company Admin sees every module as
--   "Not available" (the reported News symptom): a globally-active module that
--   was never offered to a company has no row, so `available`/`enabled` default
--   to false and access is denied.
--
-- DECISION (accepted): explicit-offer + backfill.
--   * Global module status controls whether a module exists platform-wide.
--   * Super Admin controls whether a module is AVAILABLE per company.
--   * Company Admin can ENABLE/disable only modules available to their company.
--   For every EXISTING active company we OFFER every ACTIVE global module
--   (available = true) and switch it ON (enabled = true) so the current/default
--   access of live companies is preserved (nothing that worked before breaks).
--
-- ONE-TIME, IDEMPOTENT BACKFILL
--   Inserts one company_modules row per (active company carrying a legacy_id) ×
--   (active, non-deleted global module) that does NOT already exist — matched on
--   the composite legacy_id "<companyLegacyId>:<moduleLegacyId>" (the 1:1 config
--   identity the app + repository use). Populates the flat columns (company_id
--   uuid FK for RLS, company_legacy_id query scope, module_legacy_id, available,
--   enabled) AND the lossless `data` jsonb the read path reconstructs the
--   CompanyModuleSetting from. Re-running is a pure no-op.
--
-- WHY company_legacy_id is the app-facing id
--   The frontend's company id space is the company `legacy_id` (e.g.
--   'cmp_nordlys') — see companiesSupabase.mapRow (id = legacy_id ?? id) and
--   profile.companyId = company.legacy_id. So data.companyId === company_legacy_id
--   and the composite legacy_id uses the legacy ids on both sides; company_id is
--   the real UUID FK that RLS (company_id = current_company_id()) checks. Active
--   companies WITHOUT a legacy_id cannot map into that id space and are skipped.
--
-- SCOPE: company_modules availability/enablement backfill ONLY. It does NOT add
--   or alter any table, RLS policy, trigger or index (0053 already established
--   them and they are unchanged), and does not read or change modules,
--   module_categories, time codes, services, payroll, work orders or any other
--   domain. Future company-creation defaults are a SEPARATE later slice and are
--   intentionally NOT handled here.
-- ============================================================================

insert into company_modules (
  legacy_id,
  company_id,
  company_legacy_id,
  module_legacy_id,
  available,
  enabled,
  deleted_at,
  data
)
select
  c.legacy_id || ':' || m.legacy_id            as legacy_id,
  c.id                                          as company_id,
  c.legacy_id                                   as company_legacy_id,
  m.legacy_id                                   as module_legacy_id,
  true                                          as available,
  true                                          as enabled,
  null                                          as deleted_at,
  jsonb_build_object(
    'companyId', c.legacy_id,
    'moduleId',  m.legacy_id,
    'available', true,
    'enabled',   true
  )                                             as data
from companies c
cross join modules m
where c.status = 'active'
  and c.legacy_id is not null
  and m.status = 'active'
  and m.deleted_at is null
  and not exists (
    select 1
    from company_modules cm
    where cm.legacy_id = c.legacy_id || ':' || m.legacy_id
  );
