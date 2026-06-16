-- ============================================================================
-- CleanOps — TEAM-1: TEAMS table (next operational entity)
-- ============================================================================
--
-- Introduces the Team directory into Supabase. Like Employees, a Team is a FLAT,
-- low-dependency record: a single row per team with no schedule-critical child
-- collections. Team membership lives on the EMPLOYEE record (employees.team_ids),
-- not on the team, so a single table is sufficient (mirrors employees 0010).
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors employees 0010):
--   Flat, indexed columns (name / company scope) carry everything list / RLS /
--   id-resolution needs; `data jsonb` holds the COMPLETE Team record for lossless
--   detail reconstruction. There are no soft FK columns — team membership is owned
--   by the employee, not the team.
--
-- legacy_id / company_legacy_id:
--   Mirrors the employees-table convention. `legacy_id` is the app-facing team id
--   (e.g. 'team_nordlys_cleaning') and is the migration upsert key. The HEADLINE
--   guarantee is that this id survives verbatim, because employees.team_ids
--   soft-reference the team by it.
--
-- deleted_at:
--   Follows the WO-5.6 / employees soft-delete convention. Active reads filter
--   `deleted_at is null`; an upsert always writes `deleted_at = null`, so
--   re-creating a team (same legacy_id) atomically UNDELETES it. Team removal is
--   an UPDATE that sets `deleted_at`; hard delete stays blocked under RLS.
-- ============================================================================

create table if not exists teams (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing team id from localStorage (e.g. 'team_nordlys_cleaning'); migration key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); used by the query layer scope.
  company_legacy_id  text not null,
  -- Flat, indexed summary columns.
  name               text not null,
  description        text,
  -- Lossless full Team record.
  data               jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (TEAM-1 set)
--   (company_id, name)              — name listing + app-level uniqueness guard
--   (company_legacy_id, name)       — query-layer scope (app-facing id)
-- NOTE: a UNIQUE (company_id, lower(name)) index is intentionally DEFERRED —
-- uniqueness is enforced in app code today; a DB-level unique constraint would
-- risk failing the migration on any pre-existing duplicate.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_teams_company_name        on teams(company_id, name);
create index if not exists idx_teams_companylegacy_name   on teams(company_legacy_id, name);

-- Partial index for the active-row fast path (mirrors soft-delete convention).
create index if not exists idx_teams_active
  on teams(company_id)
  where deleted_at is null;

-- Keep updated_at fresh on every update (reuses the employees pattern).
create or replace function set_teams_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_teams_updated_at on teams;
create trigger trg_teams_updated_at
  before update on teams
  for each row
  execute function set_teams_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — real, company-scoped enforcement (mirrors employees 0010)
--
--   * anon   — NO access at all (real operational data).
--   * READ   — signed-in user reads ONLY their own company's teams; super_admin all.
--   * WRITE  — INSERT/UPDATE within own company, and super_admin across companies
--              (lets the in-browser migration utility populate the shadow copy
--              without a service-role key).
--   * DELETE — no policy -> blocked for everyone. Removal is an UPDATE that sets
--              `deleted_at` (authorised by the UPDATE policies).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table teams enable row level security;

-- READ: own company
drop policy if exists "teams_select_own_company" on teams;
create policy "teams_select_own_company" on teams
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: super admin → all
drop policy if exists "teams_select_super_admin" on teams;
create policy "teams_select_super_admin" on teams
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "teams_insert_own_company" on teams;
create policy "teams_insert_own_company" on teams
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company
drop policy if exists "teams_insert_super_admin" on teams;
create policy "teams_insert_super_admin" on teams
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "teams_update_own_company" on teams;
create policy "teams_update_own_company" on teams
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company
drop policy if exists "teams_update_super_admin" on teams;
create policy "teams_update_super_admin" on teams
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — team deletion stays blocked under RLS
-- (removal is a soft-delete UPDATE; mirrors the employees / WO-5.6 convention).
