-- ============================================================================
-- CleanOps — SVC-1: SERVICES table (service catalog master data)
-- ============================================================================
--
-- Introduces the Service catalog into Supabase. Like Teams/Employees, a Service
-- is a FLAT, low-dependency record: a single row per service with no
-- schedule-critical child collections. (A service's category / time-code /
-- payroll-group are soft references by id, carried in the lossless `data` jsonb.)
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors teams 0017):
--   Flat, indexed columns (name / company scope / category / status) carry
--   everything list / RLS / id-resolution needs; `data jsonb` holds the COMPLETE
--   Service record for lossless detail reconstruction.
--
-- GLOBAL services (THE key difference from teams):
--   A Service can be GLOBAL (app-facing companyId === null → the Super Admin
--   catalog) or company-owned. Global rows store `company_id = null` and
--   `company_legacy_id = null`; company rows carry both. RLS lets every
--   authenticated user READ global rows (they are shared catalog master data),
--   while WRITES to global rows stay super-admin-only.
--
-- legacy_id / company_legacy_id:
--   Mirrors the teams-table convention. `legacy_id` is the app-facing service id
--   and is the migration upsert key — it survives verbatim because work-order
--   service rows + packages soft-reference services by it.
--
-- deleted_at:
--   Follows the WO-5.6 / teams soft-delete convention. Active reads filter
--   `deleted_at is null`; an upsert always writes `deleted_at = null`, so
--   re-creating a service (same legacy_id) atomically UNDELETES it. Removal is an
--   UPDATE that sets `deleted_at`; hard delete stays blocked under RLS.
-- ============================================================================

create table if not exists services (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing service id from localStorage; migration upsert key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  -- NULL for GLOBAL (Super Admin) services.
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); NULL for global services.
  company_legacy_id  text,
  -- App-facing owning category id, or null if uncategorised.
  category_legacy_id text,
  -- Flat, indexed summary columns.
  name               text not null,
  status             text not null default 'active',
  -- Lossless full Service record.
  data               jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (SVC-1 set)
--   (company_id, name)              — company-scoped name listing
--   (company_legacy_id, name)       — query-layer scope (app-facing id)
--   (category_legacy_id)            — category roll-up reads
-- NOTE: a UNIQUE (company_id, lower(name)) index is intentionally DEFERRED —
-- uniqueness is enforced in app code today; a DB-level unique constraint would
-- risk failing the migration on any pre-existing duplicate.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_services_company_name        on services(company_id, name);
create index if not exists idx_services_companylegacy_name   on services(company_legacy_id, name);
create index if not exists idx_services_category             on services(category_legacy_id);

-- Partial index for the active-row fast path (mirrors soft-delete convention).
create index if not exists idx_services_active
  on services(company_id)
  where deleted_at is null;

-- Partial index for the GLOBAL catalog fast path (company_id is null).
create index if not exists idx_services_global_active
  on services(name)
  where company_id is null and deleted_at is null;

-- Keep updated_at fresh on every update (reuses the teams pattern).
create or replace function set_services_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_services_updated_at on services;
create trigger trg_services_updated_at
  before update on services
  for each row
  execute function set_services_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped + GLOBAL catalog (extends teams 0017)
--
--   * anon   — NO access at all (real operational data).
--   * READ   — signed-in user reads their own company's services AND every
--              GLOBAL service (company_id is null); super_admin reads all.
--   * WRITE  — INSERT/UPDATE within own company; GLOBAL rows are super-admin
--              only (so only Super Admin manages the shared catalog and the
--              in-browser migration utility populates the shadow copy without a
--              service-role key).
--   * DELETE — no policy -> blocked for everyone. Removal is an UPDATE that sets
--              `deleted_at` (authorised by the UPDATE policies).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table services enable row level security;

-- READ: own company
drop policy if exists "services_select_own_company" on services;
create policy "services_select_own_company" on services
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: global catalog (shared, readable by every authenticated user)
drop policy if exists "services_select_global" on services;
create policy "services_select_global" on services
  for select
  to authenticated
  using (company_id is null);

-- READ: super admin → all
drop policy if exists "services_select_super_admin" on services;
create policy "services_select_super_admin" on services
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "services_insert_own_company" on services;
create policy "services_insert_own_company" on services
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company OR global (company_id is null)
drop policy if exists "services_insert_super_admin" on services;
create policy "services_insert_super_admin" on services
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "services_update_own_company" on services;
create policy "services_update_own_company" on services
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company OR global
drop policy if exists "services_update_super_admin" on services;
create policy "services_update_super_admin" on services
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — service deletion stays blocked under RLS
-- (removal is a soft-delete UPDATE; mirrors the teams / WO-5.6 convention).
