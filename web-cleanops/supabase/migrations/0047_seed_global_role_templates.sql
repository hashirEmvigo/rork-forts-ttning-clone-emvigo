-- ============================================================================
-- CleanOps — ROLE-SEED-GLOBAL: seed the GLOBAL role templates into Supabase
-- ============================================================================
--
-- CONTEXT
--   Roles live in ONE table (0022): a role is GLOBAL (company_id null → the Super
--   Admin role templates) or company-owned (company_id set). Migration 0046 added
--   seed_company_roles_from_templates(...) — which COPIES every global
--   company-scoped template into each company so the Company Admin → Settings →
--   Roles & Permissions panel (which renders ONLY company-scoped rows) is not
--   blank. The live app reads the role directory from Supabase
--   (ROLES_SUPABASE_AUTHORITATIVE), reconstructing each Role from the lossless
--   `data` jsonb.
--
-- ROOT CAUSE THIS MIGRATION FIXES
--   The GLOBAL templates themselves were NEVER written to Supabase by any
--   migration. They are produced ONLY by the app's localStorage seed
--   (seedRoles() in src/lib/store.ts → buildRole(base, null)); getting them into
--   Supabase depended on the in-browser role migration / dual-write utility being
--   run by a Super Admin, which never happened live (the ROLES cut-over wrote
--   company data but the shared templates were not mirrored — and a data reset
--   would not restore them either, because nothing seeds them server-side).
--
--   Net effect on the live database:
--     • `select … from roles where company_id is null` → 0 rows.
--     • 0046's backfill therefore had nothing to copy → 0 company roles inserted.
--     • Städalliansen Sverige AB has 0 company roles → Company Admin panel BLANK.
--
-- WHAT THIS MIGRATION DOES
--   1. Idempotently INSERTS the four GLOBAL templates (company_id null) — the
--      canonical definitions that mirror the app's seedRoles() EXACTLY:
--        • legacy_id   = 'role_tpl_<base>'  (matches systemRoleId(base, null), so
--          the app's dual-write upserts the SAME row by legacy_id — no drift).
--        • name        = ROLE_LABELS[base]      (types/index.ts).
--        • base_role   = the base role.
--        • is_system   = true.
--        • data jsonb  = the COMPLETE Role the UI reads, with companyId null and
--          permissions inherited verbatim from DEFAULT_ROLE_PERMISSIONS[base]
--          (src/lib/permissions.ts). super_admin is included as a platform-only
--          template (it is never copied to a company by 0046).
--      Idempotent: ON CONFLICT (legacy_id) DO NOTHING. Re-running inserts nothing
--      and never overwrites a template a Super Admin has since edited.
--
--   2. Re-runs seed_company_roles_from_templates() (from 0046) — now that the
--      templates exist, this backfills every non-archived company with its
--      company_admin / employee / customer roles. Idempotent (ON CONFLICT DO
--      NOTHING): companies that already have a role keep it, gaps are filled.
--      Städalliansen Sverige AB immediately receives its three company roles.
--
--   The 0046 AFTER INSERT trigger on `companies` already auto-seeds FUTURE
--   companies from the templates — and now works, because the templates exist.
--
-- SAFETY / NON-GOALS
--   * Touches ONLY the roles table (global template rows + the company-role
--     backfill via the existing 0046 function). It does NOT change the
--     customer-number or staff-number allocators, user creation, the
--     admin-create-user Edge Function, the auth provisioning trigger, work
--     orders, customers, bookings / Booking Ledger, Schedule, Mission Log, Time
--     Reporting, payroll, invoices, reset tooling or occurrence exceptions.
--   * Adds NO new id/number generator — role ids are the existing deterministic
--     legacy_id scheme ('role_tpl_<base>' for templates).
--   * No schema change → no PostgREST schema-cache reload required (new ROWS are
--     visible immediately; unlike a column add this needs no NOTIFY pgrst).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. GLOBAL templates — the shared Super Admin role catalogue (company_id null).
--    Permissions mirror DEFAULT_ROLE_PERMISSIONS (src/lib/permissions.ts) 1:1.
-- ─────────────────────────────────────────────────────────────────────────
with tpl(legacy_id, base_role, name, description, permissions) as (
  values
    (
      'role_tpl_super_admin', 'super_admin', 'Super Admin',
      'Full platform oversight across every company.',
      '["dashboard.view","companies.manage","roles.manage","reports.view","settings.view","settings.manage","settings.manageEmployeeRoles","customers.view","customers.create","customers.edit","customers.delete","employees.view","employees.create","employees.edit","employees.delete","schedule.view","schedule.edit","workOrders.view","workOrders.manage","checklists.settings.view","checklists.settings.manage","checklists.execution.view","checklists.execution.complete","checklists.execution.inspect","checklist_templates.view","checklist_templates.create","checklist_templates.edit","checklist_templates.archive","global_templates.view","global_templates.create","global_templates.edit","global_templates.archive","customer_protocols.view","my_cleaning_protocols.view","settings_templates.manage","services.manage","media.manage","settings.timecodes.view","settings.timecodes.manage","payroll.export.view","payroll.export.manage","payroll.export.run","payroll.export.entitlements.manage"]'::jsonb
    ),
    (
      'role_tpl_company_admin', 'company_admin', 'Company Admin',
      'Manages their company''s team, roles and settings.',
      '["dashboard.view","users.manage","roles.manage","reports.view","settings.view","settings.manage","settings.manageEmployeeRoles","customers.view","customers.create","customers.edit","customers.delete","employees.view","employees.create","employees.edit","employees.delete","schedule.view","schedule.edit","workOrders.view","workOrders.manage","checklists.settings.view","checklists.settings.manage","checklists.execution.view","checklists.execution.complete","checklists.execution.inspect","checklist_templates.view","checklist_templates.create","checklist_templates.edit","checklist_templates.archive","global_templates.view","customer_protocols.view","customer_protocols.create","customer_protocols.edit","customer_protocols.archive","my_cleaning_protocols.view","services.manage","media.manage","settings.timecodes.view","payroll.export.view","payroll.export.manage","payroll.export.run"]'::jsonb
    ),
    (
      'role_tpl_employee', 'employee', 'Employee',
      'Front-line staff with access to the employee portal.',
      '["dashboard.view","employee_portal.access","media.manage","customers.view","schedule.view","workOrders.view"]'::jsonb
    ),
    (
      'role_tpl_customer', 'customer', 'Customer',
      'Client account with access to the customer portal.',
      '["customer_portal.access","my_cleaning_protocols.view"]'::jsonb
    )
)
insert into roles (
  legacy_id, company_id, company_legacy_id, name, base_role, is_system, data, deleted_at
)
select
  t.legacy_id,
  null,
  null,
  t.name,
  t.base_role,
  true,
  jsonb_build_object(
    'id',          t.legacy_id,
    'name',        t.name,
    'description', t.description,
    'companyId',   null,
    'isSystem',    true,
    'baseRole',    t.base_role,
    'permissions', t.permissions,
    'createdAt',   '2026-01-01T00:00:00.000Z'
  ),
  null
from tpl t
on conflict (legacy_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL — now that the templates exist, seed every non-archived company
--    (idempotent; 0046's function uses ON CONFLICT (legacy_id) DO NOTHING).
-- ─────────────────────────────────────────────────────────────────────────
select seed_company_roles_from_templates();
