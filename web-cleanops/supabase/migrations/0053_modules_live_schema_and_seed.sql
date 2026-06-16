-- ============================================================================
-- CleanOps — MODULES (Phase 2A): create the missing live Module-domain tables
--   and seed the GLOBAL master catalogue.
-- ============================================================================
--
-- ROOT CAUSE THIS MIGRATION FIXES
--   The app's Module read/write seam (supabaseModuleRepository / moduleCutover /
--   moduleDualWrite) targets three tables defined by migration
--   0027_modules_checklists_protocols_media_tables.sql:
--     • modules            — GLOBAL master catalogue (data jsonb + deleted_at)
--     • module_categories  — GLOBAL groupings    (data jsonb + deleted_at)
--     • company_modules    — COMPANY-scoped per-company config
--   Live-DB verification confirmed NONE of these tables exist
--   (public.modules / public.module_categories / public.company_modules all
--   absent). 0027 was therefore never applied to the live database, so any
--   Supabase module read throws ("relation does not exist") and there is no place
--   for an authoritative write to land — every Super-Admin module / category
--   change is lost on a hard refresh. This is the same dual-definition / unapplied
--   trap that 0052 fixed for time_codes.
--
-- WHAT THIS MIGRATION DOES (idempotent, additive, no data loss)
--   1. (Re)defines the shared updated_at trigger function set_mcpm_updated_at()
--      so this migration is self-contained even if 0027 never ran.
--   2. Creates the three tables with the FULL schema the app expects
--      (id uuid + legacy_id unique + flat list/RLS columns + lossless `data`
--      jsonb + `deleted_at` soft-delete + timestamps), each guarded by
--      `create table if not exists` so re-running (or a later 0027) is a no-op.
--   3. Adds the read-critical columns defensively (`data`, `deleted_at`) for
--      cross-environment parse safety — no-ops on a fresh create.
--   4. Recreates indexes, updated_at triggers and the FULL, EXPLICIT RLS policy
--      set for all three tables (no "identical to 0027" placeholders). DELETE has
--      no policy on any table → removal is a soft-delete UPDATE (`deleted_at`).
--   5. Seeds the 12 GLOBAL master modules + 3 GLOBAL module categories into BOTH
--      the flat columns AND the lossless `data` jsonb the read path returns.
--
-- ARCHIVE / RESTORE SEMANTICS (after this migration)
--   • Modules            archive = status 'inactive', restore = status 'active'
--                        (the platform on/off toggle). No module create/delete UI.
--   • Module categories  create / edit / archive(status)/restore / reorder via
--                        UPDATE; delete = soft-delete (`deleted_at`).
--
-- SCOPE: GLOBAL master catalogue only (modules + module_categories carry no
--        company id). `company_modules` is CREATED here ONLY so the read seam
--        cannot crash — its per-company availability/enablement behaviour is NOT
--        wired into the app yet (a separate follow-up slice). This migration does
--        not read or change services, time codes, checklists, protocols, media,
--        payroll, work orders or any other domain.
-- ============================================================================

-- ── 0. Shared updated_at trigger fn (self-contained; matches 0027) ──────────
create or replace function set_mcpm_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. modules  (GLOBAL master data — no company scope)
-- ===========================================================================
create table if not exists modules (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique not null,
  name          text not null,
  -- 'active' | 'inactive' | 'archived' (mirrors EntityStatus).
  status        text not null default 'active',
  data          jsonb not null default '{}'::jsonb,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Read-critical columns (defensive; no-ops on a fresh create above).
alter table modules add column if not exists data       jsonb not null default '{}'::jsonb;
alter table modules add column if not exists deleted_at timestamptz;
alter table modules add column if not exists status     text not null default 'active';

create index if not exists idx_modules_name on modules(name);
create index if not exists idx_modules_active
  on modules(name) where deleted_at is null;

drop trigger if exists trg_modules_updated_at on modules;
create trigger trg_modules_updated_at
  before update on modules
  for each row execute function set_mcpm_updated_at();

alter table modules enable row level security;

-- READ: the global catalogue is world-readable to every authenticated user.
drop policy if exists "modules_select_global" on modules;
create policy "modules_select_global" on modules
  for select to authenticated using (true);

-- INSERT: super admin only (Super-Admin governed master data).
drop policy if exists "modules_insert_super_admin" on modules;
create policy "modules_insert_super_admin" on modules
  for insert to authenticated with check (is_super_admin());

-- UPDATE: super admin only (covers status archive/restore + soft-delete).
drop policy if exists "modules_update_super_admin" on modules;
create policy "modules_update_super_admin" on modules
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 2. module_categories  (GLOBAL master data — no company scope)
-- ===========================================================================
create table if not exists module_categories (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique not null,
  name          text not null,
  status        text not null default 'active',
  sort_order    integer not null default 0,
  data          jsonb not null default '{}'::jsonb,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Read-critical columns (defensive; no-ops on a fresh create above).
alter table module_categories add column if not exists data       jsonb not null default '{}'::jsonb;
alter table module_categories add column if not exists deleted_at timestamptz;
alter table module_categories add column if not exists sort_order integer not null default 0;
alter table module_categories add column if not exists status     text not null default 'active';

create index if not exists idx_module_categories_sort on module_categories(sort_order);
create index if not exists idx_module_categories_active
  on module_categories(sort_order) where deleted_at is null;

drop trigger if exists trg_module_categories_updated_at on module_categories;
create trigger trg_module_categories_updated_at
  before update on module_categories
  for each row execute function set_mcpm_updated_at();

alter table module_categories enable row level security;

drop policy if exists "module_categories_select_global" on module_categories;
create policy "module_categories_select_global" on module_categories
  for select to authenticated using (true);

drop policy if exists "module_categories_insert_super_admin" on module_categories;
create policy "module_categories_insert_super_admin" on module_categories
  for insert to authenticated with check (is_super_admin());

drop policy if exists "module_categories_update_super_admin" on module_categories;
create policy "module_categories_update_super_admin" on module_categories
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 3. company_modules  (COMPANY-scoped per-company config)
--    legacy_id == "<companyId>:<moduleId>" (the 1:1 config record identity).
--    CREATED so the read seam cannot crash; behaviour intentionally UNWIRED.
-- ===========================================================================
create table if not exists company_modules (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  module_legacy_id   text not null,
  available          boolean not null default false,
  enabled            boolean not null default false,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Read-critical columns (defensive; no-ops on a fresh create above).
alter table company_modules add column if not exists data       jsonb not null default '{}'::jsonb;
alter table company_modules add column if not exists deleted_at timestamptz;

create index if not exists idx_company_modules_company
  on company_modules(company_id) where deleted_at is null;
create index if not exists idx_company_modules_companylegacy
  on company_modules(company_legacy_id);
create index if not exists idx_company_modules_module
  on company_modules(module_legacy_id);

drop trigger if exists trg_company_modules_updated_at on company_modules;
create trigger trg_company_modules_updated_at
  before update on company_modules
  for each row execute function set_mcpm_updated_at();

alter table company_modules enable row level security;

-- READ: own company
drop policy if exists "company_modules_select_own_company" on company_modules;
create policy "company_modules_select_own_company" on company_modules
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: super admin → all
drop policy if exists "company_modules_select_super_admin" on company_modules;
create policy "company_modules_select_super_admin" on company_modules
  for select to authenticated using (is_super_admin());

-- INSERT: own company
drop policy if exists "company_modules_insert_own_company" on company_modules;
create policy "company_modules_insert_own_company" on company_modules
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company
drop policy if exists "company_modules_insert_super_admin" on company_modules;
create policy "company_modules_insert_super_admin" on company_modules
  for insert to authenticated with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "company_modules_update_own_company" on company_modules;
create policy "company_modules_update_own_company" on company_modules
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company
drop policy if exists "company_modules_update_super_admin" on company_modules;
create policy "company_modules_update_super_admin" on company_modules
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 4. Seed the GLOBAL master MODULES (idempotent on legacy_id)
-- ===========================================================================
-- Inserts only modules whose legacy_id does not already exist. Populates the
-- flat summary columns AND the lossless `data` jsonb (id === legacy_id) so the
-- read path reconstructs a complete {@link Module} record. status = 'active'.
insert into modules (legacy_id, name, status, deleted_at, data)
select
  s.legacy_id, s.name, 'active', null,
  jsonb_build_object(
    'id',               s.legacy_id,
    'name',             s.name,
    'description',      s.description,
    'status',           'active',
    'allowedUserTypes', s.allowed_user_types::jsonb,
    'createdAt',        to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
from (values
  ('checklist-manager',          'Checklist Manager',            'Build and assign cleaning checklists to teams and sites.',               '["company_admin","employee"]'),
  ('quality-control',            'Quality Control',              'Run inspections and track quality scores across jobs.',                   '["company_admin","employee"]'),
  ('admin-requests',             'Admin Requests',               'Internal requests routed to company administrators.',                     '["company_admin"]'),
  ('employee-customer-requests', 'Employee & Customer Requests', 'Shared request inbox for staff and customers.',                           '["company_admin","employee","customer"]'),
  ('expense-receipts',           'Expense Receipts',             'Capture and approve staff expense receipts.',                             '["company_admin","employee"]'),
  ('key-management',             'Key Management',               'Track physical keys and access handovers.',                               '["company_admin","employee"]'),
  ('news',                       'News',                         'Company announcements for staff and customers.',                          '["company_admin","employee","customer"]'),
  ('reports',                    'Reports',                      'Operational reporting and exports.',                                      '["company_admin"]'),
  ('faq',                        'FAQ',                          'Self-service answers for staff and customers.',                           '["company_admin","employee","customer"]'),
  ('admin-invoices',             'Admin Invoices',               'Internal billing and supplier invoices.',                                 '["company_admin"]'),
  ('customer-invoices',          'Customer Invoices',            'Invoices issued to and viewed by customers.',                             '["company_admin","customer"]'),
  ('my-cleaning-protocols',      'My Cleaning Protocols',        'Customers can view the cleaning protocols connected to their account.',   '["customer","company_admin","super_admin"]')
) as s(legacy_id, name, description, allowed_user_types)
where not exists (
  select 1 from modules m where m.legacy_id = s.legacy_id
);

-- ===========================================================================
-- 5. Seed the GLOBAL master MODULE CATEGORIES (idempotent on legacy_id)
-- ===========================================================================
insert into module_categories (legacy_id, name, status, sort_order, deleted_at, data)
select
  s.legacy_id, s.name, 'active', s.sort_order, null,
  jsonb_build_object(
    'id',               s.legacy_id,
    'name',             s.name,
    'description',      s.description,
    'icon',             s.icon,
    'sortOrder',        s.sort_order,
    'status',           'active',
    'visibleUserTypes', s.visible_user_types::jsonb,
    'moduleIds',        s.module_ids::jsonb,
    'createdAt',        to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
from (values
  ('cat_operations',     'Operations',     'Features connected to daily operational work.',                  'wrench',    0, '["company_admin","employee"]', '["checklist-manager","quality-control","key-management","employee-customer-requests"]'),
  ('cat_backoffice',     'Backoffice',     'Features connected to administration, reporting and finance.',   'briefcase', 1, '["company_admin"]',            '["reports","admin-invoices","expense-receipts","faq"]'),
  ('cat_customer_portal','Customer Portal','Features available for customer-facing workflows.',              'headset',   2, '["customer","company_admin"]', '["customer-invoices","faq","news","employee-customer-requests"]')
) as s(legacy_id, name, description, icon, sort_order, visible_user_types, module_ids)
where not exists (
  select 1 from module_categories c where c.legacy_id = s.legacy_id
);
