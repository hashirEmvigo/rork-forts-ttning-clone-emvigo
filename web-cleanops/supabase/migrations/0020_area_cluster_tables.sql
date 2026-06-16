-- ============================================================================
-- CleanOps — AREA-1: AREA-CLUSTER master-data tables
--   areas · postal_cities · employee_languages
-- ============================================================================
--
-- The area cluster: the operational geography + language dimensions that
-- customer visibility, employee area access, customer ownership and scheduling
-- all reference by stable id. Each is a FLAT, low-dependency record — a single
-- row per item, no schedule-critical child collections. They follow the EXACT
-- teams pattern (migration 0017): flat indexed columns for list / RLS /
-- id-resolution + a lossless `data jsonb` for detail reconstruction, `legacy_id`
-- as the migration upsert key, and the WO-5.6 `deleted_at` soft-delete
-- convention (an upsert always UNDELETES).
--
-- SCOPE: unlike the service catalog, every row here is COMPANY-scoped — Area,
-- PostalCity and EmployeeLanguage all carry a non-null companyId. There are NO
-- global rows, so the RLS mirrors teams exactly (own-company + super_admin).
--
-- The HEADLINE guarantee is `legacy_id` stability: customers reference an area
-- by Customer.areaId, customers/postal pickers reference a postal city by id,
-- postal cities reference their area by areaId, and employees reference a
-- language by languageId / secondaryLanguageId — all survive verbatim.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Shared updated_at trigger fn (reused by all three tables).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_area_cluster_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. areas
-- ===========================================================================
create table if not exists areas (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  name               text not null,
  is_active          boolean not null default true,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_areas_company_name on areas(company_id, name);
create index if not exists idx_areas_companylegacy_name on areas(company_legacy_id, name);
create index if not exists idx_areas_active
  on areas(company_id) where deleted_at is null;

drop trigger if exists trg_areas_updated_at on areas;
create trigger trg_areas_updated_at
  before update on areas
  for each row execute function set_area_cluster_updated_at();

alter table areas enable row level security;

drop policy if exists "areas_select_own_company" on areas;
create policy "areas_select_own_company" on areas
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "areas_select_super_admin" on areas;
create policy "areas_select_super_admin" on areas
  for select to authenticated
  using (is_super_admin());

drop policy if exists "areas_insert_own_company" on areas;
create policy "areas_insert_own_company" on areas
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "areas_insert_super_admin" on areas;
create policy "areas_insert_super_admin" on areas
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "areas_update_own_company" on areas;
create policy "areas_update_own_company" on areas
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "areas_update_super_admin" on areas;
create policy "areas_update_super_admin" on areas
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 2. postal_cities
-- ===========================================================================
create table if not exists postal_cities (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  name               text not null,
  -- App-facing area id this postal city maps to (Area.legacy_id). Soft reference.
  area_legacy_id     text not null,
  is_active          boolean not null default true,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_postal_cities_company_name on postal_cities(company_id, name);
create index if not exists idx_postal_cities_companylegacy_name
  on postal_cities(company_legacy_id, name);
create index if not exists idx_postal_cities_area on postal_cities(area_legacy_id);
create index if not exists idx_postal_cities_active
  on postal_cities(company_id) where deleted_at is null;

drop trigger if exists trg_postal_cities_updated_at on postal_cities;
create trigger trg_postal_cities_updated_at
  before update on postal_cities
  for each row execute function set_area_cluster_updated_at();

alter table postal_cities enable row level security;

drop policy if exists "postal_cities_select_own_company" on postal_cities;
create policy "postal_cities_select_own_company" on postal_cities
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "postal_cities_select_super_admin" on postal_cities;
create policy "postal_cities_select_super_admin" on postal_cities
  for select to authenticated
  using (is_super_admin());

drop policy if exists "postal_cities_insert_own_company" on postal_cities;
create policy "postal_cities_insert_own_company" on postal_cities
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "postal_cities_insert_super_admin" on postal_cities;
create policy "postal_cities_insert_super_admin" on postal_cities
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "postal_cities_update_own_company" on postal_cities;
create policy "postal_cities_update_own_company" on postal_cities
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "postal_cities_update_super_admin" on postal_cities;
create policy "postal_cities_update_super_admin" on postal_cities
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ===========================================================================
-- 3. employee_languages
-- ===========================================================================
create table if not exists employee_languages (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  code               text not null,
  name               text not null,
  is_active          boolean not null default true,
  is_default         boolean not null default false,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_employee_languages_company_code
  on employee_languages(company_id, code);
create index if not exists idx_employee_languages_companylegacy_name
  on employee_languages(company_legacy_id, name);
create index if not exists idx_employee_languages_active
  on employee_languages(company_id) where deleted_at is null;

drop trigger if exists trg_employee_languages_updated_at on employee_languages;
create trigger trg_employee_languages_updated_at
  before update on employee_languages
  for each row execute function set_area_cluster_updated_at();

alter table employee_languages enable row level security;

drop policy if exists "employee_languages_select_own_company" on employee_languages;
create policy "employee_languages_select_own_company" on employee_languages
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "employee_languages_select_super_admin" on employee_languages;
create policy "employee_languages_select_super_admin" on employee_languages
  for select to authenticated
  using (is_super_admin());

drop policy if exists "employee_languages_insert_own_company" on employee_languages;
create policy "employee_languages_insert_own_company" on employee_languages
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "employee_languages_insert_super_admin" on employee_languages;
create policy "employee_languages_insert_super_admin" on employee_languages
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "employee_languages_update_own_company" on employee_languages;
create policy "employee_languages_update_own_company" on employee_languages
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "employee_languages_update_super_admin" on employee_languages;
create policy "employee_languages_update_super_admin" on employee_languages
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on any table — removal is a soft-delete UPDATE.
