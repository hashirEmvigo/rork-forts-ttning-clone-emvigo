-- ============================================================================
-- CleanOps — ROLE-1: ROLES table (Roles & Permissions identity wave)
-- ============================================================================
--
-- Introduces the Role catalog into Supabase. Like Services, a Role is a FLAT,
-- low-dependency record: a single row per role with no schedule-critical child
-- collections. (Permission keys + base_role + activation are carried in the
-- lossless `data` jsonb; a role's assignment to a user lives on the USER record,
-- not on the role.)
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors services 0018):
--   Flat, indexed columns (name / company scope / base_role / is_system) carry
--   everything list / RLS / id-resolution needs; `data jsonb` holds the COMPLETE
--   Role record (permissions[], templateId, isActive, updatedAt) for lossless
--   detail reconstruction.
--
-- GLOBAL roles (THE key trait, like services):
--   A Role can be GLOBAL (app-facing companyId === null → the Super Admin role
--   templates) or company-owned. Global rows store `company_id = null` and
--   `company_legacy_id = null`; company rows carry both. RLS lets every
--   authenticated user READ global rows (they are shared role templates), while
--   WRITES to global rows stay super-admin-only.
--
-- legacy_id / company_legacy_id:
--   Mirrors the services-table convention. `legacy_id` is the app-facing role id
--   (e.g. 'role_cmp_nordlys_employee' / 'role_tpl_employee') and is the migration
--   upsert key — it survives verbatim because users.roleId soft-references the
--   role by it.
--
-- deleted_at:
--   Follows the WO-5.6 / services soft-delete convention. Active reads filter
--   `deleted_at is null`; an upsert always writes `deleted_at = null`, so
--   re-creating a role (same legacy_id) atomically UNDELETES it. Removal is an
--   UPDATE that sets `deleted_at`; hard delete stays blocked under RLS.
-- ============================================================================

create table if not exists roles (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing role id from localStorage; migration upsert key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  -- NULL for GLOBAL (Super Admin template) roles.
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); NULL for global roles.
  company_legacy_id  text,
  -- Flat, indexed summary columns.
  name               text not null,
  -- The mapped base role (super_admin/company_admin/employee/customer), or null
  -- for custom roles. Carried flat for RLS-free list filtering.
  base_role          text,
  -- Built-in roles cannot be deleted in app code; flat for fast filtering.
  is_system          boolean not null default false,
  -- Lossless full Role record (permissions[], templateId, isActive, ...).
  data               jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (ROLE-1 set)
--   (company_id, name)              — company-scoped name listing
--   (company_legacy_id, name)       — query-layer scope (app-facing id)
--   (base_role)                     — base-role roll-up reads
-- NOTE: a UNIQUE (company_id, lower(name)) index is intentionally DEFERRED —
-- uniqueness is enforced in app code today; a DB-level unique constraint would
-- risk failing the migration on any pre-existing duplicate.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_roles_company_name        on roles(company_id, name);
create index if not exists idx_roles_companylegacy_name   on roles(company_legacy_id, name);
create index if not exists idx_roles_base_role            on roles(base_role);

-- Partial index for the active-row fast path (mirrors soft-delete convention).
create index if not exists idx_roles_active
  on roles(company_id)
  where deleted_at is null;

-- Partial index for the GLOBAL templates fast path (company_id is null).
create index if not exists idx_roles_global_active
  on roles(name)
  where company_id is null and deleted_at is null;

-- Keep updated_at fresh on every update (reuses the services pattern).
create or replace function set_roles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_roles_updated_at on roles;
create trigger trg_roles_updated_at
  before update on roles
  for each row
  execute function set_roles_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped + GLOBAL templates (mirrors services 0018)
--
--   * anon   — NO access at all (real operational data).
--   * READ   — signed-in user reads their own company's roles AND every GLOBAL
--              role (company_id is null); super_admin reads all.
--   * WRITE  — INSERT/UPDATE within own company; GLOBAL rows are super-admin
--              only (so only Super Admin manages the shared templates and the
--              in-browser migration utility populates the shadow copy without a
--              service-role key).
--   * DELETE — no policy -> blocked for everyone. Removal is an UPDATE that sets
--              `deleted_at` (authorised by the UPDATE policies).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table roles enable row level security;

-- READ: own company
drop policy if exists "roles_select_own_company" on roles;
create policy "roles_select_own_company" on roles
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: global templates (shared, readable by every authenticated user)
drop policy if exists "roles_select_global" on roles;
create policy "roles_select_global" on roles
  for select
  to authenticated
  using (company_id is null);

-- READ: super admin → all
drop policy if exists "roles_select_super_admin" on roles;
create policy "roles_select_super_admin" on roles
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "roles_insert_own_company" on roles;
create policy "roles_insert_own_company" on roles
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company OR global (company_id is null)
drop policy if exists "roles_insert_super_admin" on roles;
create policy "roles_insert_super_admin" on roles
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "roles_update_own_company" on roles;
create policy "roles_update_own_company" on roles
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company OR global
drop policy if exists "roles_update_super_admin" on roles;
create policy "roles_update_super_admin" on roles
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — role deletion stays blocked under RLS
-- (removal is a soft-delete UPDATE; mirrors the services / WO-5.6 convention).
