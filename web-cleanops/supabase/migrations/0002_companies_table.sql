-- ============================================================================
-- CleanOps — Step 2A: COMPANIES table (first real table, read-only test)
-- ============================================================================
--
-- This is the first table actually applied to the staging Supabase project.
-- It replaces the planning-only `companies` definition in 0001_schema_plan.sql
-- with the Step 2A shape (adds legacy_id + updated_at, and 'archived' status).
--
-- IMPORTANT — Step 2A status:
--   * The app still runs on localStorage. Companies are READ from Supabase only
--     when the feature flag USE_SUPABASE_COMPANIES is true (default false).
--   * Nothing WRITES to this table from the app yet.
--   * RLS policies here are PLACEHOLDERS — real enforcement comes after Supabase
--     Auth is implemented. For now the anon role gets read-only access so the
--     read-only test can run before auth exists.
--
-- legacy_id:
--   Keeps the current localStorage id (e.g. 'cmp_nordlys') so existing
--   relationships (users.company_id, customers.company_id, etc.) keep working
--   during the gradual migration. The app maps legacy_id -> Company.id on read.
-- ============================================================================

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  legacy_id   text unique,                       -- current localStorage id, for migration
  name        text not null,
  status      text not null default 'active',    -- active | inactive | archived
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint companies_status_check
    check (status in ('active', 'inactive', 'archived'))
);

create index if not exists idx_companies_legacy_id on companies(legacy_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Seed: one or two test companies (idempotent via legacy_id upsert).
-- These mirror two existing demo companies so the read-only test shows
-- recognisable data. Do NOT migrate the full demo set yet.
-- ─────────────────────────────────────────────────────────────────────────
insert into companies (legacy_id, name, status)
values
  ('cmp_nordlys', 'Nordlys Cleaning AS', 'active'),
  ('cmp_fjord',   'Fjord Facility Services', 'active')
on conflict (legacy_id) do update
  set name = excluded.name,
      status = excluded.status,
      updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — PLACEHOLDER ONLY
-- ----------------------------------------------------------------------------
-- Real, company-scoped enforcement is deferred until Supabase Auth exists
-- (JWT claims for company_id / role). For the Step 2A read-only test we enable
-- RLS and add a permissive SELECT policy so the anon key can read companies.
-- No INSERT/UPDATE/DELETE policies are created, so writes are blocked by default.
-- These policies WILL be replaced when auth lands.
-- ─────────────────────────────────────────────────────────────────────────
alter table companies enable row level security;

drop policy if exists "companies_read_placeholder" on companies;
create policy "companies_read_placeholder" on companies
  for select
  using (true);  -- TODO(auth): scope to caller's company_id / super_admin claim
