-- ============================================================================
-- CleanOps — TIMECODE-1: TIME_CODES table (Payroll / Time domain wave)
-- ============================================================================
--
-- Introduces the Time Code library into Supabase. A Time Code is a FLAT,
-- low-dependency payroll-foundation record: a single row per code with no
-- schedule-critical child collections. (type/active/systemManaged and the
-- description are carried both as flat columns and losslessly in the `data`
-- jsonb; a code's use on a service/time report is referenced from those records,
-- not from the code.)
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors roles 0022):
--   Flat, indexed columns (code / company scope / type / active / system_managed)
--   carry everything list / RLS / id-resolution needs; `data jsonb` holds the
--   COMPLETE TimeCode record (name, description, timestamps) for lossless detail
--   reconstruction.
--
-- GLOBAL codes (THE key trait, like roles/services):
--   A Time Code can be GLOBAL (app-facing companyId === null → the Super Admin
--   master library) or company-owned (future). Global rows store
--   `company_id = null` and `company_legacy_id = null`; company rows carry both.
--   RLS lets every authenticated user READ global rows (they are the shared
--   master payroll codes), while WRITES to global rows stay super-admin-only.
--
-- legacy_id / company_legacy_id:
--   Mirrors the roles-table convention. `legacy_id` is the app-facing code id
--   (e.g. 'tc_xxx') and is the migration upsert key — it survives verbatim
--   because services.timeCodeId / time reports soft-reference the code by it.
--
-- deleted_at:
--   Follows the WO-5.6 / roles soft-delete convention. Active reads filter
--   `deleted_at is null`; an upsert always writes `deleted_at = null`, so
--   re-creating a code (same legacy_id) atomically UNDELETES it. Removal is an
--   UPDATE that sets `deleted_at`; hard delete stays blocked under RLS.
-- ============================================================================

create table if not exists time_codes (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing time-code id from localStorage; migration upsert key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  -- NULL for GLOBAL (Super Admin master library) codes.
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); NULL for global codes.
  company_legacy_id  text,
  -- Flat, indexed summary columns.
  code               text not null,
  -- attendance | absence. Carried flat for RLS-free list filtering.
  type               text not null,
  -- Whether the code is active/selectable. Inactive codes stay for history.
  active             boolean not null default true,
  -- Seeded master codes that can be deactivated but never deleted.
  system_managed     boolean not null default false,
  -- Lossless full TimeCode record (name, description, timestamps, ...).
  data               jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (TIMECODE-1 set)
--   (company_id, code)              — company-scoped code listing
--   (company_legacy_id, code)       — query-layer scope (app-facing id)
--   (type)                          — attendance/absence roll-up reads
-- NOTE: a UNIQUE (company_id, lower(code)) index is intentionally DEFERRED —
-- uniqueness is enforced in app code today; a DB-level unique constraint would
-- risk failing the migration on any pre-existing duplicate.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_time_codes_company_code       on time_codes(company_id, code);
create index if not exists idx_time_codes_companylegacy_code  on time_codes(company_legacy_id, code);
create index if not exists idx_time_codes_type               on time_codes(type);

-- Partial index for the active-row fast path (mirrors soft-delete convention).
create index if not exists idx_time_codes_active
  on time_codes(company_id)
  where deleted_at is null;

-- Partial index for the GLOBAL master-library fast path (company_id is null).
create index if not exists idx_time_codes_global_active
  on time_codes(code)
  where company_id is null and deleted_at is null;

-- Keep updated_at fresh on every update (reuses the roles pattern).
create or replace function set_time_codes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_time_codes_updated_at on time_codes;
create trigger trg_time_codes_updated_at
  before update on time_codes
  for each row
  execute function set_time_codes_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped + GLOBAL master library (mirrors roles 0022)
--
--   * anon   — NO access at all (real operational data).
--   * READ   — signed-in user reads their own company's codes AND every GLOBAL
--              code (company_id is null); super_admin reads all.
--   * WRITE  — INSERT/UPDATE within own company; GLOBAL rows are super-admin
--              only (so only Super Admin manages the master library and the
--              in-browser migration utility populates the shadow copy without a
--              service-role key).
--   * DELETE — no policy -> blocked for everyone. Removal is an UPDATE that sets
--              `deleted_at` (authorised by the UPDATE policies).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table time_codes enable row level security;

-- READ: own company
drop policy if exists "time_codes_select_own_company" on time_codes;
create policy "time_codes_select_own_company" on time_codes
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: global master library (shared, readable by every authenticated user)
drop policy if exists "time_codes_select_global" on time_codes;
create policy "time_codes_select_global" on time_codes
  for select
  to authenticated
  using (company_id is null);

-- READ: super admin → all
drop policy if exists "time_codes_select_super_admin" on time_codes;
create policy "time_codes_select_super_admin" on time_codes
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "time_codes_insert_own_company" on time_codes;
create policy "time_codes_insert_own_company" on time_codes
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company OR global (company_id is null)
drop policy if exists "time_codes_insert_super_admin" on time_codes;
create policy "time_codes_insert_super_admin" on time_codes
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "time_codes_update_own_company" on time_codes;
create policy "time_codes_update_own_company" on time_codes
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company OR global
drop policy if exists "time_codes_update_super_admin" on time_codes;
create policy "time_codes_update_super_admin" on time_codes
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — time-code deletion stays blocked under RLS
-- (removal is a soft-delete UPDATE; mirrors the roles / WO-5.6 convention).
