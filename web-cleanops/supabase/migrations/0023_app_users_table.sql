-- ============================================================================
-- CleanOps — USER-1: APP_USERS table (Users/logins identity directory)
-- ============================================================================
--
-- Introduces the app-facing Users/logins DIRECTORY into Supabase. This is the
-- localStorage `cleanops.users` login record — the {@link User} the app UI binds
-- to (name / email / role / company / roleId / linked employee|customer / area
-- scope). It is DISTINCT from, and complementary to, the existing Supabase
-- `profiles` identity backbone (0003/0004):
--   • `profiles`  — the auth-side identity row (1:1 with auth.users), the source
--                   of truth for AUTHENTICATION and base_role/company for RLS.
--   • `app_users` — the operational login DIRECTORY the app renders and edits
--                   (role assignment, employee/customer linking, area scope).
--
-- SECURITY — passwords are NEVER stored here. The store already strips passwords
-- from `getUsers()`, and admin authentication runs exclusively through Supabase
-- Auth. The `data` jsonb carries only the non-secret login record.
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors services 0018):
--   Flat, indexed columns (email / company scope / role / status) carry
--   everything list / RLS / id-resolution needs; `data jsonb` holds the COMPLETE
--   (password-free) User record for lossless detail reconstruction.
--
-- GLOBAL logins (THE key trait, like services/roles):
--   A login can be GLOBAL (app-facing companyId === null → a platform super
--   admin) or company-owned. Global rows store `company_id = null` and
--   `company_legacy_id = null`; company rows carry both. RLS lets a super_admin
--   read all rows; company admins read only their own company's logins.
--
-- legacy_id:
--   The app-facing login id from localStorage (e.g. 'usr_emp1'); the migration
--   upsert key. It survives verbatim because employees.userId / customers.userIds
--   soft-reference the login by it.
--
-- deleted_at:
--   Follows the WO-5.6 / services soft-delete convention. Active reads filter
--   `deleted_at is null`; an upsert always writes `deleted_at = null`, so
--   re-creating a login (same legacy_id) atomically UNDELETES it. Removal is an
--   UPDATE that sets `deleted_at`; hard delete stays blocked under RLS.
-- ============================================================================

create table if not exists app_users (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing login id from localStorage; migration upsert key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  -- NULL for a GLOBAL (platform super admin) login.
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); NULL for a global login.
  company_legacy_id  text,
  -- Flat, indexed summary columns.
  email              text not null,
  role               text not null,
  status             text not null default 'active',
  -- Lossless full (password-free) User record.
  data               jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (USER-1 set)
--   (company_id, email)             — company-scoped email listing
--   (company_legacy_id, email)      — query-layer scope (app-facing id)
--   (lower(email))                  — case-insensitive uniqueness lookups
-- NOTE: a UNIQUE (lower(email)) index is intentionally DEFERRED — uniqueness is
-- enforced in app code today; a DB-level unique constraint would risk failing
-- the migration on any pre-existing duplicate.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_app_users_company_email       on app_users(company_id, email);
create index if not exists idx_app_users_companylegacy_email  on app_users(company_legacy_id, email);
create index if not exists idx_app_users_email_lower          on app_users(lower(email));

-- Partial index for the active-row fast path (mirrors soft-delete convention).
create index if not exists idx_app_users_active
  on app_users(company_id)
  where deleted_at is null;

-- Partial index for the GLOBAL logins fast path (company_id is null).
create index if not exists idx_app_users_global_active
  on app_users(email)
  where company_id is null and deleted_at is null;

-- Keep updated_at fresh on every update (reuses the services pattern).
create or replace function set_app_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at on app_users;
create trigger trg_app_users_updated_at
  before update on app_users
  for each row
  execute function set_app_users_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped + GLOBAL super-admin logins
--
--   * anon   — NO access at all (real identity data).
--   * READ   — signed-in user reads ONLY their own company's logins; super_admin
--              reads all (incl. global super-admin logins).
--   * WRITE  — INSERT/UPDATE within own company, and super_admin across companies
--              + global rows (lets the in-browser migration utility populate the
--              shadow copy without a service-role key).
--   * DELETE — no policy -> blocked for everyone. Removal is an UPDATE that sets
--              `deleted_at` (authorised by the UPDATE policies).
--
-- NOTE: unlike services/roles there is NO "select global" policy for everyone —
-- global rows are platform super-admin logins and must NOT be world-readable;
-- only super_admin sees them (via the super-admin policy).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table app_users enable row level security;

-- READ: own company
drop policy if exists "app_users_select_own_company" on app_users;
create policy "app_users_select_own_company" on app_users
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: super admin → all (incl. global super-admin logins)
drop policy if exists "app_users_select_super_admin" on app_users;
create policy "app_users_select_super_admin" on app_users
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "app_users_insert_own_company" on app_users;
create policy "app_users_insert_own_company" on app_users
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company OR global (company_id is null)
drop policy if exists "app_users_insert_super_admin" on app_users;
create policy "app_users_insert_super_admin" on app_users
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "app_users_update_own_company" on app_users;
create policy "app_users_update_own_company" on app_users
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company OR global
drop policy if exists "app_users_update_super_admin" on app_users;
create policy "app_users_update_super_admin" on app_users
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — login deletion stays blocked under RLS
-- (removal is a soft-delete UPDATE; mirrors the services / WO-5.6 convention).
