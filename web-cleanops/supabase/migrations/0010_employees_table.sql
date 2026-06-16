-- ============================================================================
-- CleanOps — P7C EMP-1: EMPLOYEES table (next operational entity)
-- ============================================================================
--
-- Introduces the Employee directory into Supabase. Unlike Work Orders, Employees
-- are a FLAT, low-dependency record: a single row per person with no nested
-- schedule-critical child collections. The Schedule consumes employees as an
-- id -> name LOOKUP only — the occurrence-driving assignment
-- (assignedEmployeeIds / slots) already lives on the migrated
-- work_order_service_rows, NOT on the employee — so a single table is sufficient
-- (contrast Work Orders' three tables).
--
-- IMPORTANT — EMP-1 status (infrastructure only):
--   * The app STILL runs on localStorage. The Employees page, the profile/edit
--     dialog and every assignable-employee picker continue reading from
--     AppContext / store.ts. Nothing in the UI reads or writes through this table
--     yet, and the Schedule resolver / assignment logic are untouched.
--   * Supabase is a SECONDARY, shadow copy during this phase. The migration
--     utility (src/lib/data/employeeMigration.ts) populates it; the shadow-read
--     validator diffs it against localStorage. No cut-over happens here.
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors customers, 0007):
--   Flat, indexed columns carry everything list / search / RLS / id-resolution
--   needs; `data jsonb` holds the COMPLETE Employee record (incl. the weekly
--   workingSchedule + phone/address + sparse detail) for lossless detail
--   reconstruction. Soft FK columns (team_ids / user_legacy_id / postal_city_id /
--   language_id) stay flat so future tracks (Team / auth / PostalCity / language)
--   can join by id without rewriting jsonb.
--
-- legacy_id / company_legacy_id:
--   Mirrors the customers-table convention. `legacy_id` is the app-facing
--   employee id (e.g. 'emp_001') and is the migration upsert key. The HEADLINE
--   guarantee of the Employees track is that this id survives verbatim, because
--   existing work_order_service_rows.assignedEmployeeIds — and the DEFERRED Time
--   Reports / Activity tracks — soft-reference the employee by it.
--
-- deleted_at:
--   Included for consistency with the WO-5.6 soft-delete convention. Active reads
--   filter `deleted_at is null`; an upsert always writes `deleted_at = null`, so
--   re-creating / reactivating a row (same legacy_id) atomically UNDELETES it.
--   Hard delete stays blocked under RLS (no DELETE policy).
-- ============================================================================

create table if not exists employees (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing employee id from localStorage (e.g. 'emp_001'); migration key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); used by the query layer scope.
  company_legacy_id  text not null,
  -- Flat, indexed summary columns (mirror EmployeeSummary).
  name               text not null,
  email              text not null default '',
  title              text,
  status             text not null default 'active',
  -- Soft FK columns kept flat so future tracks can join without rewriting jsonb.
  team_ids           text[] not null default '{}'::text[],
  user_legacy_id     text,
  postal_city_id     text,
  language_id        text,
  -- Lossless full Employee record (incl. workingSchedule + phone/address).
  data               jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint employees_status_check
    check (status in ('active', 'inactive'))
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (approved EMP-1 set)
--   (company_id, name)              — name search + alphabetical listing
--   (company_id, lower(email))      — email lookup / app-level uniqueness guard
--   (company_id, status)            — assignable-employee filtering
--   (company_id, created_at desc)   — default newest-first list ordering
-- The query layer scopes by `company_legacy_id` (the app-facing id), so we mirror
-- the name shape on that column too (avoids a sequential scan once it grows).
-- NOTE: a UNIQUE (company_id, lower(email)) index is intentionally DEFERRED —
-- uniqueness is enforced in app code today; a DB-level unique constraint would
-- risk failing the migration on any pre-existing duplicate. EMP-1 only adds the
-- non-unique lookup index and the migration report surfaces any duplicates.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_employees_company_name          on employees(company_id, name);
create index if not exists idx_employees_company_email          on employees(company_id, lower(email));
create index if not exists idx_employees_company_status         on employees(company_id, status);
create index if not exists idx_employees_company_created        on employees(company_id, created_at desc);
create index if not exists idx_employees_companylegacy_name     on employees(company_legacy_id, name);

-- Partial index for the active-row fast path (mirrors WO-5.6 soft-delete).
create index if not exists idx_employees_active
  on employees(company_id, status)
  where deleted_at is null;

-- Keep updated_at fresh on every update (reuses the customers/profiles pattern).
create or replace function set_employees_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employees_updated_at on employees;
create trigger trg_employees_updated_at
  before update on employees
  for each row
  execute function set_employees_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — real, company-scoped enforcement (mirrors customers 0007)
--
--   * anon   — NO access at all (real operational data).
--   * READ   — signed-in user reads ONLY their own company's employees
--              (company_id = current_company_id()); super_admin reads all.
--   * WRITE  — INSERT/UPDATE within own company, and super_admin across companies
--              (lets the in-browser migration utility populate the shadow copy
--              without a service-role key).
--   * DELETE — no policy -> blocked for everyone. Removal is an UPDATE that sets
--              `deleted_at` (authorised by the UPDATE policies). Hard delete stays
--              blocked under RLS.
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin), so
-- there is no recursive-RLS risk and the client is never trusted for tenancy.
-- ─────────────────────────────────────────────────────────────────────────
alter table employees enable row level security;

-- READ: own company
drop policy if exists "employees_select_own_company" on employees;
create policy "employees_select_own_company" on employees
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: super admin → all
drop policy if exists "employees_select_super_admin" on employees;
create policy "employees_select_super_admin" on employees
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "employees_insert_own_company" on employees;
create policy "employees_insert_own_company" on employees
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company
drop policy if exists "employees_insert_super_admin" on employees;
create policy "employees_insert_super_admin" on employees
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "employees_update_own_company" on employees;
create policy "employees_update_own_company" on employees
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company
drop policy if exists "employees_update_super_admin" on employees;
create policy "employees_update_super_admin" on employees
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — employee deletion stays blocked under RLS
-- (removal is a soft-delete UPDATE; mirrors the customers / WO-5.6 convention).
