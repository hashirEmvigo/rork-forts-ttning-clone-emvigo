-- ============================================================================
-- CleanOps — ROLE-PROSPECT: add the "Prospect" role template + per-company seed
-- ============================================================================
--
-- CONTEXT
--   Roles live in ONE table (0022): a role is GLOBAL (company_id null → the Super
--   Admin role templates) or company-owned (company_id set). Migrations 0046/0047
--   seed the four BASE-ROLE templates (super_admin / company_admin / employee /
--   customer) and copy the three company-scoped ones into every company so the
--   Company Admin → Settings → Roles & Permissions panel is not blank.
--
-- WHAT THIS MIGRATION ADDS
--   A new "Prospect" role — a person/contact who may later fill in the price
--   calculator and log in to preview an offer. It is added as a CUSTOM role
--   template (NOT a new auth base role), so it needs NO change to the auth
--   base_role set (super_admin/company_admin/employee/customer), NO RLS change,
--   NO user-creation change and NO customer-portal change:
--
--     • base_role stays NULL (the table already documents NULL as "custom roles"),
--       and data->>'baseRole' is omitted, so the app reads Role.baseRole = undefined
--       and treats Prospect exactly like any other custom role. The app's UserRole
--       union is untouched.
--     • The flat base_role column is free text with no enum/CHECK (0022), and the
--       roles RLS policies key only on company_id / is_super_admin() — neither
--       depends on a fixed base_role list — so a Prospect row is fully legal.
--     • Permissions start EMPTY; they are configurable later in Roles & Permissions
--       (Super Admin edits this global template; each company edits its own copy).
--       Nothing is hardcoded here beyond an empty permission set.
--
--   1. GLOBAL Prospect template (company_id null), idempotent by legacy_id
--      ('role_tpl_prospect'). Mirrors the deterministic id scheme used by the
--      other templates.
--
--   2. seed_company_roles_from_templates(...) is REPLACED so it also copies the
--      Prospect template into every company (alongside the three base-role
--      copies), identified by the STABLE legacy_id 'role_tpl_prospect' rather than
--      by base_role (Prospect has none). Per-company id = 'role_<company>_prospect',
--      matching the existing 'role_<company>_<suffix>' convention so the app's
--      dual-write upserts the SAME row by legacy_id (no duplication/renumbering).
--      The existing AFTER INSERT trigger on `companies` (0046) calls this function,
--      so FUTURE companies receive Prospect automatically.
--
--   3. BACKFILL — re-runs the function so every existing non-archived company
--      (incl. Städalliansen Sverige AB) immediately gets its Prospect company role.
--
-- SAFETY / NON-GOALS
--   * Purely additive. Existing role rows are untouched (ON CONFLICT DO NOTHING),
--     so existing roles cannot break.
--   * No new auth base role, no RLS change, no enum/CHECK, no user-creation change,
--     no customer-portal wiring, no login/auth behaviour for Prospect yet.
--   * Touches ONLY the roles table seeding. It does NOT change the customer-number
--     or staff-number allocators, the admin-create-user Edge Function, the auth
--     provisioning trigger, work orders, customers, bookings / Booking Ledger,
--     Schedule, Mission Log, Time Reporting, payroll, invoices, reset tooling or
--     occurrence exceptions. No new id/number generator is added.
--   * No schema change → no PostgREST schema-cache reload required (new ROWS are
--     visible immediately).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. GLOBAL Prospect template (company_id null). base_role NULL + data without
--    `baseRole` ⇒ the app reads it as a configurable CUSTOM role. Empty perms.
-- ─────────────────────────────────────────────────────────────────────────
insert into roles (
  legacy_id, company_id, company_legacy_id, name, base_role, is_system, data, deleted_at
)
values (
  'role_tpl_prospect',
  null,
  null,
  'Prospect',
  null,
  true,
  jsonb_build_object(
    'id',          'role_tpl_prospect',
    'name',        'Prospect',
    'description', 'Prospective contact who can complete the price calculator and later preview an offer. Configure permissions here.',
    'companyId',   null,
    'isSystem',    true,
    'permissions', '[]'::jsonb,
    'createdAt',   '2026-01-01T00:00:00.000Z'
  ),
  null
)
on conflict (legacy_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. REPLACE the per-company seed so it ALSO copies the Prospect template.
--    Each template carries a `suffix` used for the deterministic per-company
--    legacy_id ('role_<company>_<suffix>') and a `base_role_val` written to the
--    flat column (the three base roles keep their base_role; Prospect stays NULL).
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
    -- One company-scoped template per base role (super_admin is platform-only).
    select base_role as suffix, base_role as base_role_val, name, data
      from (
        select distinct on (base_role) base_role, name, data, created_at
          from roles
         where company_id is null
           and deleted_at is null
           and base_role in ('company_admin', 'employee', 'customer')
         order by base_role, created_at asc
      ) base_tpls
    union all
    -- The Prospect custom template, identified by its STABLE legacy_id (it has no
    -- base_role). Copied with suffix 'prospect' and a NULL flat base_role.
    select 'prospect' as suffix, null::text as base_role_val, name, data
      from roles
     where company_id is null
       and deleted_at is null
       and legacy_id = 'role_tpl_prospect'
  )
  insert into roles (
    legacy_id, company_id, company_legacy_id, name, base_role, is_system, data, deleted_at
  )
  select
    'role_' || coalesce(c.legacy_id, c.id::text) || '_' || tpl.suffix,
    c.id,
    coalesce(c.legacy_id, c.id::text),
    tpl.name,
    tpl.base_role_val,
    true,
    tpl.data || jsonb_build_object(
      'id',        'role_' || coalesce(c.legacy_id, c.id::text) || '_' || tpl.suffix,
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
-- 3. BACKFILL — seed every existing non-archived company once (idempotent), now
--    including the Prospect company role.
-- ─────────────────────────────────────────────────────────────────────────
select seed_company_roles_from_templates();
