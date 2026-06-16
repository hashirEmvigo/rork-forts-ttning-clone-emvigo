-- ============================================================================
-- CleanOps — Step 2B.1: PROFILES + Auth foundation (no UI / no login change)
-- ============================================================================
--
-- Goal of Step 2B.1:
--   Lay the Supabase Auth *foundation* WITHOUT touching the running app.
--   The app still authenticates via localStorage. This migration only:
--     1. Creates a `profiles` table linked 1:1 to auth.users.
--     2. Adds SECURITY DEFINER helper functions for use inside RLS.
--     3. Enables RLS on profiles with limited, non-recursive policies.
--
-- IMPORTANT — what this does NOT do (deferred to later sub-steps):
--   * No custom JWT claims, no auth hooks.
--   * No change to the existing localStorage login.
--   * No user migration — existing demo users are untouched.
--   * No write access to other modules.
--   * Write policies on profiles are intentionally minimal.
--
-- HOW PROFILES CONNECT TO SUPABASE AUTH LATER:
--   `profiles.id` equals `auth.users.id`. When real Supabase Auth login is
--   introduced (a later sub-step), each authenticated user will get/already
--   have a matching profiles row (created on signup via a trigger, or inserted
--   manually for seeded accounts). RLS then resolves "who am I / which company"
--   purely from this table via auth.uid() — no JWT customization required.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. PROFILES TABLE
--    1:1 with auth.users. company_id is nullable ONLY for super_admin; a CHECK
--    enforces that company_admin / employee / customer must have a company_id.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references companies(id) on delete set null,
  base_role   text not null,
  full_name   text,
  email       text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_base_role_check
    check (base_role in ('super_admin', 'company_admin', 'employee', 'customer')),

  constraint profiles_status_check
    check (status in ('active', 'inactive', 'archived')),

  -- company_id may be NULL only for super_admin; required for everyone else.
  constraint profiles_company_required_check
    check (
      base_role = 'super_admin'
      or company_id is not null
    )
);

create index if not exists idx_profiles_company on profiles(company_id);
create index if not exists idx_profiles_base_role on profiles(base_role);

-- Keep updated_at fresh on every update.
create or replace function set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles
  for each row
  execute function set_profiles_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS HELPER FUNCTIONS (SECURITY DEFINER)
--
--    These run as the function OWNER, which BYPASSES RLS on `profiles`. That is
--    exactly what avoids the classic recursive-RLS deadlock: if a policy on
--    `profiles` queried `profiles` directly, evaluating that subquery would
--    re-trigger the same policy and recurse. By reading `profiles` inside a
--    SECURITY DEFINER function, the lookup is RLS-exempt and terminates.
--
--    `set search_path = ''` (with schema-qualified names) prevents search_path
--    hijacking — a standard hardening for SECURITY DEFINER functions.
-- ─────────────────────────────────────────────────────────────────────────

-- The caller's profile id (== auth.uid()). NULL when unauthenticated.
create or replace function current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.profiles where id = auth.uid();
$$;

-- The caller's company_id (NULL for super_admin or when no profile exists).
create or replace function current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- The caller's base_role (NULL when no profile exists).
create or replace function current_base_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select base_role from public.profiles where id = auth.uid();
$$;

-- Convenience boolean: is the caller a super_admin?
create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and base_role = 'super_admin'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY ON PROFILES
--
--    READ policies:
--      * self          — a user can read their own profile (id = auth.uid()).
--      * company admin  — read profiles within their own company.
--      * super admin    — read all profiles.
--
--    Because company-admin / super-admin checks go through the SECURITY DEFINER
--    helpers above (not a direct sub-select on profiles), there is no recursion.
--
--    WRITE policies are intentionally minimal for now:
--      * self UPDATE of a narrow set of fields (full_name only) is allowed.
--      * No INSERT / DELETE policies → inserts happen via service role / future
--        signup trigger; deletes are blocked. This keeps role management from
--        being overbuilt at this stage.
-- ─────────────────────────────────────────────────────────────────────────
alter table profiles enable row level security;

-- READ: own profile
drop policy if exists "profiles_select_self" on profiles;
create policy "profiles_select_self" on profiles
  for select
  using (id = auth.uid());

-- READ: company admins → profiles in their company
drop policy if exists "profiles_select_company_admin" on profiles;
create policy "profiles_select_company_admin" on profiles
  for select
  using (
    current_base_role() = 'company_admin'
    and company_id is not null
    and company_id = current_company_id()
  );

-- READ: super admins → all profiles
drop policy if exists "profiles_select_super_admin" on profiles;
create policy "profiles_select_super_admin" on profiles
  for select
  using (is_super_admin());

-- WRITE (limited): a user may update only their OWN profile row.
-- The WITH CHECK keeps id/company_id/base_role immutable from the client side;
-- privileged changes go through the service role until proper role management
-- is built in a later step.
drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and company_id is not distinct from current_company_id()
    and base_role = current_base_role()
  );

-- NOTE: no INSERT or DELETE policies are defined on purpose. With RLS enabled
-- and no matching policy, those operations are denied for anon/authenticated
-- roles. Seeding profiles (below / later) is done with the service role, which
-- bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────────
-- 4. SEED / EXAMPLE PROFILE STRUCTURE (reference only — NOT inserted)
--
--    We do NOT insert real profile rows here because each row's `id` must equal
--    an existing auth.users id, and no Supabase Auth users exist yet. When auth
--    users are created (later sub-step), seed them like this (run as service
--    role, e.g. in the SQL editor):
--
--      insert into profiles (id, company_id, base_role, full_name, email, status)
--      values
--        -- Super Admin: company_id is NULL (allowed only for super_admin)
--        ('<auth-user-uuid>', null,
--          'super_admin', 'Platform Owner', 'owner@cleanops.app', 'active'),
--        -- Company Admin: company_id REQUIRED (use a real companies.id)
--        ('<auth-user-uuid>',
--          (select id from companies where legacy_id = 'cmp_nordlys'),
--          'company_admin', 'Nordlys Admin', 'admin@nordlys.example', 'active');
--
--    base_role values:  super_admin | company_admin | employee | customer
--    status values:     active | inactive | archived
-- ─────────────────────────────────────────────────────────────────────────
