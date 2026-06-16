-- ============================================================================
-- CleanOps — ROLE-SEED: per-company role inheritance from the global templates
-- ============================================================================
--
-- CONTEXT
--   Roles live in ONE table (0022): a role is GLOBAL (company_id null → the Super
--   Admin role templates) or company-owned (company_id set). The live app reads
--   the role directory from Supabase (ROLES_SUPABASE_AUTHORITATIVE), and the
--   Company Admin → Settings → Roles & Permissions panel renders ONLY the
--   company-scoped rows for the logged-in company (it deliberately excludes the
--   global templates — a company admin works with their OWN roles, not the shared
--   templates). The full Role the UI consumes is reconstructed from the lossless
--   `data` jsonb, so `data.companyId` is what the panel filters on.
--
-- ROOT CAUSE THIS MIGRATION FIXES
--   Companies created through the app provision their built-in roles and mirror
--   them to Supabase, so they are fine. But companies that PREDATE the roles
--   cut-over (e.g. Städalliansen Sverige AB) never received company-scoped role
--   rows in Supabase. The global templates exist (Super Admin sees them), but the
--   company has zero company-scoped rows → the Company Admin panel is BLANK.
--
-- WHAT THIS MIGRATION DOES
--   1. seed_company_roles_from_templates(target uuid) — an idempotent function
--      that, for one company (or all non-archived companies when target is null),
--      INSERTS a company-scoped copy of every GLOBAL company-scoped template
--      (company_admin / employee / customer; super_admin is platform-only and is
--      never copied to a company). Each copy:
--        • legacy_id        = 'role_' || <app-facing company id> || '_' || base
--          (matches systemRoleId() in the app, so the app's dual-write upserts the
--           SAME row by legacy_id — no duplication, no renumbering).
--        • company_id       = the company UUID (FK + RLS).
--        • company_legacy_id= the app-facing id (so the company-scoped READ returns
--          it).
--        • data jsonb       = the template's data with id/companyId/isSystem
--          rewritten to the company, so `data.companyId` matches the logged-in
--          admin's user.companyId and the panel filter passes — and the granted
--          permissions are INHERITED verbatim from the template.
--      Idempotent: ON CONFLICT (legacy_id) DO NOTHING. Re-running seeds nothing
--      new and never renumbers or overwrites an existing role.
--
--   2. BACKFILL — seeds every existing non-archived company once, so Städalliansen
--      Sverige AB (and any other pre-cut-over company) immediately has its
--      company_admin / employee / customer roles.
--
--   3. TRIGGER — AFTER INSERT on companies auto-seeds future companies from the
--      templates regardless of the creation path (app or direct SQL), satisfying
--      "new companies inherit roles automatically". Safe + idempotent.
--
-- SAFETY / NON-GOALS
--   * No-op when no global templates exist (inserts nothing, never errors).
--   * SECURITY DEFINER + fixed search_path so the seed bypasses RLS consistently
--     for the trigger path; the backfill runs as the migration's privileged role.
--   * Touches ONLY the roles table seeding. It does NOT change the customer-number
--     or staff-number allocators, user creation, the admin-create-user Edge
--     Function, the auth provisioning trigger, work orders, customers, bookings /
--     Booking Ledger, Schedule, Mission Log, Time Reporting, payroll, invoices,
--     reset tooling or occurrence exceptions. No new id/number generator is added
--     (role ids are the existing deterministic legacy_id scheme).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Idempotent seed function — company roles copied from the global templates.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function seed_company_roles_from_templates(target_company uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  with templates as (
    -- One template per company-scoped base role (super_admin is platform-only).
    -- DISTINCT ON guards against duplicate template rows for the same base role.
    select distinct on (base_role)
           base_role,
           name,
           data
      from roles
     where company_id is null
       and deleted_at is null
       and base_role in ('company_admin', 'employee', 'customer')
     order by base_role, created_at asc
  )
  insert into roles (
    legacy_id, company_id, company_legacy_id, name, base_role, is_system, data, deleted_at
  )
  select
    'role_' || coalesce(c.legacy_id, c.id::text) || '_' || tpl.base_role,
    c.id,
    coalesce(c.legacy_id, c.id::text),
    tpl.name,
    tpl.base_role,
    true,
    tpl.data || jsonb_build_object(
      'id',        'role_' || coalesce(c.legacy_id, c.id::text) || '_' || tpl.base_role,
      'companyId', coalesce(c.legacy_id, c.id::text),
      'isSystem',  true
    ),
    null
  from companies c
  cross join templates tpl
  where (target_company is null and c.status <> 'archived')
     or (target_company is not null and c.id = target_company)
  on conflict (legacy_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL — seed every existing non-archived company once (idempotent).
-- ─────────────────────────────────────────────────────────────────────────
select seed_company_roles_from_templates();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. TRIGGER — auto-seed future companies from the templates on insert.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function trg_seed_company_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_company_roles_from_templates(new.id);
  return new;
end;
$$;

drop trigger if exists companies_seed_roles on companies;
create trigger companies_seed_roles
  after insert on companies
  for each row
  execute function trg_seed_company_roles();
