-- ============================================================================
-- CleanOps — P4D Wave 1A: CUSTOMERS table (first operational entity)
-- ============================================================================
--
-- This introduces the first real OPERATIONAL entity into Supabase. Customers are
-- intentionally migrated first because they are relatively flat, low-dependency,
-- and isolated from the Schedule + Work Order resolver logic.
--
-- IMPORTANT — Wave 1A status (infrastructure only):
--   * The app STILL runs on localStorage. The Customers list and Customer Card
--     continue reading from `src/lib/store.ts`. Nothing in the UI reads or writes
--     through this table yet.
--   * Supabase is a SECONDARY, shadow copy during this phase. The migration
--     utility (src/lib/data/customerMigration.ts) populates it; the shadow-read
--     validator diffs it against localStorage. No cut-over happens here.
--
-- DATA MODEL DECISION — flat columns + `data jsonb`:
--   The Customer domain type is wide and nested (addresses, contacts, notes,
--   scheduling preferences, card log, media refs, …). Modelling every nested
--   field as its own column/table is out of scope for Wave 1A (customers only,
--   flat) and would be premature denormalisation. Instead we store:
--     * flat, indexed columns for everything list/search/RLS needs, and
--     * `data jsonb` holding the COMPLETE Customer record for lossless detail.
--   This keeps `listSummaries`/`search`/`count` index-backed while `getDetail`
--   reconstructs the full record from `data` with perfect parity.
--
-- legacy_id / company_legacy_id:
--   Mirrors the companies-table convention. `legacy_id` is the app-facing
--   customer id (e.g. 'cust_001'); `company_legacy_id` is the app-facing company
--   id (e.g. 'cmp_nordlys'). Keeping both an app-facing string id AND a real
--   `company_id uuid` FK lets the query layer scope cheaply by the app id while
--   RLS enforces tenancy via the UUID that matches `profiles.company_id`.
-- ============================================================================

create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing customer id from localStorage (e.g. 'cust_001'); migration key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); used by the query layer scope.
  company_legacy_id  text not null,
  -- Flat, indexed summary columns (mirror CustomerSummary).
  customer_number    text not null,
  name               text not null,
  email              text not null default '',
  status             text not null default 'active',
  customer_type      text,
  area_id            text,
  -- Lossless full Customer record for detail reconstruction.
  data               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint customers_status_check
    check (status in ('active', 'inactive', 'archived')),
  constraint customers_customer_type_check
    check (
      customer_type is null
      or customer_type in ('commercial', 'private', 'one_time', 'special_services')
    )
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (approved Wave 1 set)
--   (company_id, customer_number) — identifier search / uniqueness-style lookup
--   (company_id, name)            — name search + alphabetical listing
--   (company_id, created_at desc) — default newest-first list ordering
-- The query layer scopes by `company_legacy_id` (the app-facing id), so we add
-- the same composite shapes on that column too — without them every scoped list
-- would fall back to a sequential scan once the table grows.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_customers_company_number      on customers(company_id, customer_number);
create index if not exists idx_customers_company_name        on customers(company_id, name);
create index if not exists idx_customers_company_created      on customers(company_id, created_at desc);
create index if not exists idx_customers_companylegacy_number on customers(company_legacy_id, customer_number);
create index if not exists idx_customers_companylegacy_name   on customers(company_legacy_id, name);
create index if not exists idx_customers_companylegacy_created on customers(company_legacy_id, created_at desc);

-- Keep updated_at fresh on every update (reuses the trigger pattern from profiles).
create or replace function set_customers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at
  before update on customers
  for each row
  execute function set_customers_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — real, company-scoped enforcement
--
-- Unlike the companies placeholder (which granted anon read for an early test),
-- customers carry real operational data, so anon gets NO access at all.
--
-- Policy decisions:
--   * READ   — a signed-in user reads ONLY their own company's customers
--              (company_id = current_company_id()); super_admin reads all.
--   * WRITE  — INSERT/UPDATE allowed for a signed-in user within their own
--              company, and for super_admin across companies. This is what lets
--              the in-browser migration utility (run by an admin) populate the
--              shadow copy without a service-role key.
--   * DELETE — no policy → blocked for everyone (safe; migration never deletes).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin), so
-- there is no recursive-RLS risk and the client is never trusted for tenancy.
-- ─────────────────────────────────────────────────────────────────────────
alter table customers enable row level security;

-- READ: own company
drop policy if exists "customers_select_own_company" on customers;
create policy "customers_select_own_company" on customers
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: super admin → all
drop policy if exists "customers_select_super_admin" on customers;
create policy "customers_select_super_admin" on customers
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "customers_insert_own_company" on customers;
create policy "customers_insert_own_company" on customers
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company
drop policy if exists "customers_insert_super_admin" on customers;
create policy "customers_insert_super_admin" on customers
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company
drop policy if exists "customers_update_own_company" on customers;
create policy "customers_update_own_company" on customers
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company
drop policy if exists "customers_update_super_admin" on customers;
create policy "customers_update_super_admin" on customers
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — customer deletion stays blocked under RLS.
