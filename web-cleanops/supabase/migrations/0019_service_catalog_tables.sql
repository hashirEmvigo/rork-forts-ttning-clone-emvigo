-- ============================================================================
-- CleanOps — SVCCAT-1: SERVICE-CATALOG master-data tables
--   service_categories · payroll_groups · service_packages
-- ============================================================================
--
-- The companion wave to migration 0018 (services). Each of these is a FLAT,
-- low-dependency master-data record — a single row per item, no
-- schedule-critical child collections. They follow the EXACT services pattern:
-- flat indexed columns for list / RLS / id-resolution + a lossless `data jsonb`
-- for detail reconstruction, `legacy_id` as the migration upsert key, and the
-- WO-5.6 `deleted_at` soft-delete convention (an upsert always UNDELETES).
--
-- GLOBAL vs company rows (mirrors services exactly):
--   • service_categories — companyId === null is a GLOBAL Super Admin category;
--     otherwise company-owned. Global rows: company_id = null.
--   • payroll_groups — same: companyId === null is a GLOBAL Super Admin group.
--   • service_packages — ALWAYS global master data (the type carries no
--     companyId at all), so every package row is company_id = null. The columns
--     are kept for structural symmetry with the other catalog tables.
--
-- RLS (extends the services 0018 model): anon has no access; every signed-in
-- user READS their company's rows AND the shared GLOBAL rows; super_admin reads
-- all; WRITES are own-company OR super-admin (global writes are super-admin
-- only); DELETE is blocked (removal is a soft-delete UPDATE).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Shared updated_at trigger fn (reused by all three tables).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_service_catalog_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. service_categories
-- ===========================================================================
create table if not exists service_categories (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  name               text not null,
  status             text not null default 'active',
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_service_categories_company_name
  on service_categories(company_id, name);
create index if not exists idx_service_categories_companylegacy_name
  on service_categories(company_legacy_id, name);
create index if not exists idx_service_categories_active
  on service_categories(company_id) where deleted_at is null;
create index if not exists idx_service_categories_global_active
  on service_categories(name) where company_id is null and deleted_at is null;

drop trigger if exists trg_service_categories_updated_at on service_categories;
create trigger trg_service_categories_updated_at
  before update on service_categories
  for each row execute function set_service_catalog_updated_at();

alter table service_categories enable row level security;

drop policy if exists "service_categories_select_own_company" on service_categories;
create policy "service_categories_select_own_company" on service_categories
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "service_categories_select_global" on service_categories;
create policy "service_categories_select_global" on service_categories
  for select to authenticated
  using (company_id is null);

drop policy if exists "service_categories_select_super_admin" on service_categories;
create policy "service_categories_select_super_admin" on service_categories
  for select to authenticated
  using (is_super_admin());

drop policy if exists "service_categories_insert_own_company" on service_categories;
create policy "service_categories_insert_own_company" on service_categories
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "service_categories_insert_super_admin" on service_categories;
create policy "service_categories_insert_super_admin" on service_categories
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "service_categories_update_own_company" on service_categories;
create policy "service_categories_update_own_company" on service_categories
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "service_categories_update_super_admin" on service_categories;
create policy "service_categories_update_super_admin" on service_categories
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 2. payroll_groups
-- ===========================================================================
create table if not exists payroll_groups (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  name               text not null,
  status             text not null default 'active',
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_payroll_groups_company_name
  on payroll_groups(company_id, name);
create index if not exists idx_payroll_groups_companylegacy_name
  on payroll_groups(company_legacy_id, name);
create index if not exists idx_payroll_groups_active
  on payroll_groups(company_id) where deleted_at is null;
create index if not exists idx_payroll_groups_global_active
  on payroll_groups(name) where company_id is null and deleted_at is null;

drop trigger if exists trg_payroll_groups_updated_at on payroll_groups;
create trigger trg_payroll_groups_updated_at
  before update on payroll_groups
  for each row execute function set_service_catalog_updated_at();

alter table payroll_groups enable row level security;

drop policy if exists "payroll_groups_select_own_company" on payroll_groups;
create policy "payroll_groups_select_own_company" on payroll_groups
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "payroll_groups_select_global" on payroll_groups;
create policy "payroll_groups_select_global" on payroll_groups
  for select to authenticated
  using (company_id is null);

drop policy if exists "payroll_groups_select_super_admin" on payroll_groups;
create policy "payroll_groups_select_super_admin" on payroll_groups
  for select to authenticated
  using (is_super_admin());

drop policy if exists "payroll_groups_insert_own_company" on payroll_groups;
create policy "payroll_groups_insert_own_company" on payroll_groups
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "payroll_groups_insert_super_admin" on payroll_groups;
create policy "payroll_groups_insert_super_admin" on payroll_groups
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "payroll_groups_update_own_company" on payroll_groups;
create policy "payroll_groups_update_own_company" on payroll_groups
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "payroll_groups_update_super_admin" on payroll_groups;
create policy "payroll_groups_update_super_admin" on payroll_groups
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 3. service_packages  (ALWAYS global master data — company_id always null)
-- ===========================================================================
create table if not exists service_packages (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  -- Always null: packages are global master data. Columns kept for symmetry.
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  name               text not null,
  -- 'active' or 'archived' (derived from the package's archived flag).
  status             text not null default 'active',
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_service_packages_name on service_packages(name);
create index if not exists idx_service_packages_global_active
  on service_packages(name) where company_id is null and deleted_at is null;

drop trigger if exists trg_service_packages_updated_at on service_packages;
create trigger trg_service_packages_updated_at
  before update on service_packages
  for each row execute function set_service_catalog_updated_at();

alter table service_packages enable row level security;

-- Packages are shared catalog master data: every signed-in user may READ.
drop policy if exists "service_packages_select_global" on service_packages;
create policy "service_packages_select_global" on service_packages
  for select to authenticated
  using (company_id is null);

drop policy if exists "service_packages_select_super_admin" on service_packages;
create policy "service_packages_select_super_admin" on service_packages
  for select to authenticated
  using (is_super_admin());

-- WRITES: super-admin only (global master data is Super-Admin governed; the
-- in-browser migration utility populates the shadow copy as a super admin).
drop policy if exists "service_packages_insert_super_admin" on service_packages;
create policy "service_packages_insert_super_admin" on service_packages
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "service_packages_update_super_admin" on service_packages;
create policy "service_packages_update_super_admin" on service_packages
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on any table — removal is a soft-delete UPDATE.
