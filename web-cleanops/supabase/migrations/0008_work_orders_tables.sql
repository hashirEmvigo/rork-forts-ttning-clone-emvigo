-- ============================================================================
-- CleanOps — P5C WO-1: WORK ORDERS tables (second operational entity)
-- ============================================================================
--
-- Introduces the Work Order aggregate into Supabase. Work Orders are an order of
-- magnitude more complex than Customers: a parent container owns nested service
-- rows (with embedded variations), and a SEPARATE occurrence-exception store
-- overlays single occurrences. This migration models them as THREE tables that
-- mirror the proven customers-table convention (0007):
--
--   1. work_orders                     — the parent container
--   2. work_order_service_rows         — the per-service planning rows (the
--                                        schedule occurrence source)
--   3. work_order_occurrence_exceptions— cancel / reschedule / time-change
--                                        overlay per occurrence (separate store)
--
-- IMPORTANT — WO-1 status (infrastructure only):
--   * The app STILL runs on localStorage. The Work Orders list, WorkOrderDetails
--     and the Schedule resolver continue reading from AppContext / store.ts.
--     Nothing in the UI reads or writes through these tables yet.
--   * Supabase is a SECONDARY, shadow copy during this phase. The migration
--     utility (src/lib/data/workOrderMigration.ts) populates it; the shadow-read
--     validator diffs it against localStorage. No cut-over and NO schedule switch
--     happens here.
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors customers):
--   Flat, indexed columns carry everything list / search / RLS / schedule needs;
--   `data jsonb` holds the COMPLETE record for lossless detail reconstruction.
--   Variations stay EMBEDDED inside the service-row jsonb (read/written with the
--   row, only resolved at compute time) — no dedicated table yet (see blueprint).
--
-- legacy_id / company_legacy_id:
--   Mirrors the customers-table convention. `legacy_id` is the app-facing id
--   (e.g. 'wo_001', a service-row id, an exception id) and is the migration
--   upsert key. `company_legacy_id` is the app-facing company id used by the
--   query layer; `company_id uuid` is the real tenant FK RLS enforces.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. work_orders — parent container
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists work_orders (
  id                   uuid primary key default gen_random_uuid(),
  -- App-facing work-order id from localStorage (e.g. 'wo_001'); migration key.
  legacy_id            text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id           uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'); used by the query layer scope.
  company_legacy_id    text not null,
  -- App-facing customer id (soft link to customers.legacy_id).
  customer_legacy_id   text not null,
  -- Denormalised customer name (resolved at migration time) so list / customer
  -- card surfaces render without a per-row lookup (avoids N+1).
  customer_display_name text not null default '',
  -- Flat, indexed summary columns (mirror WorkOrderSummary).
  number               text not null,
  title                text,
  status               text not null default 'planned',
  start_date           text,
  end_date             text,
  -- Count of service rows — list badge without shipping the rows themselves.
  service_row_count    integer not null default 0,
  created_by           text,
  -- Lossless full WorkOrder record (incl. notes / activity / mediaPlacements).
  data                 jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint work_orders_status_check
    check (status in ('draft', 'planned', 'in_progress', 'completed', 'inactive'))
);

-- Indexes (approved WO-1 set). The query layer scopes by company_legacy_id, so
-- we mirror the composite shapes on that column too (avoids sequential scans).
create index if not exists idx_work_orders_company_status_created  on work_orders(company_id, status, created_at desc);
create index if not exists idx_work_orders_company_customer        on work_orders(company_id, customer_legacy_id);
create index if not exists idx_work_orders_company_number          on work_orders(company_id, number);
create index if not exists idx_work_orders_companylegacy_status    on work_orders(company_legacy_id, status, created_at desc);
create index if not exists idx_work_orders_companylegacy_customer  on work_orders(company_legacy_id, customer_legacy_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. work_order_service_rows — per-service planning rows (occurrence source)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists work_order_service_rows (
  id                        uuid primary key default gen_random_uuid(),
  -- App-facing service-row id; migration upsert key.
  legacy_id                 text unique not null,
  company_id                uuid references companies(id) on delete cascade,
  company_legacy_id         text not null,
  -- Soft link to work_orders.legacy_id (the parent container).
  work_order_legacy_id      text not null,
  -- Flat, indexed schedule-critical columns (mirror WorkOrderServiceRowSummary).
  service_name              text not null default '',
  article_number            text,
  status                    text not null default 'planned',
  archived                  boolean not null default false,
  service_date              text,
  service_end_date          text,
  planned_start_time        text,
  planned_end_time          text,
  recurrence_interval       text not null default 'one_time',
  assigned_employee_ids     text[] not null default '{}'::text[],
  unassigned_employee_slots integer not null default 0,
  sort_order                integer not null default 0,
  -- Count of embedded variations (the array stays in `data`).
  variation_count           integer not null default 0,
  -- Lossless full WorkOrderServiceRow (incl. variations / overrides / prefs).
  data                      jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint wo_service_rows_status_check
    check (status in ('planned', 'in_progress', 'completed', 'inactive'))
);

create index if not exists idx_wo_rows_company_workorder      on work_order_service_rows(company_id, work_order_legacy_id);
create index if not exists idx_wo_rows_company_servicedate     on work_order_service_rows(company_id, service_date);
create index if not exists idx_wo_rows_company_status_date     on work_order_service_rows(company_id, status, service_date);
create index if not exists idx_wo_rows_companylegacy_workorder on work_order_service_rows(company_legacy_id, work_order_legacy_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. work_order_occurrence_exceptions — per-occurrence overlay (separate store)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists work_order_occurrence_exceptions (
  id                       uuid primary key default gen_random_uuid(),
  -- App-facing exception id; migration upsert key.
  legacy_id                text unique not null,
  company_id               uuid references companies(id) on delete cascade,
  company_legacy_id        text not null,
  -- Soft link to work_order_service_rows.legacy_id (domain parentServiceRowId).
  service_row_legacy_id    text not null,
  -- Stable occurrence identity: `parentServiceRowId:occurrenceDate`.
  occurrence_key           text not null,
  occurrence_date          text not null,
  status                   text not null default 'active',
  override_occurrence_date text,
  override_start_time      text,
  override_end_time        text,
  -- Lossless full BookingOccurrenceException (incl. staffing/labour overrides).
  data                     jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint wo_exceptions_status_check
    check (status in ('active', 'cancelled', 'rescheduled'))
);

create index if not exists idx_wo_exceptions_company_key      on work_order_occurrence_exceptions(company_id, occurrence_key);
create index if not exists idx_wo_exceptions_company_row_date  on work_order_occurrence_exceptions(company_id, service_row_legacy_id, occurrence_date);
create index if not exists idx_wo_exceptions_companylegacy_key on work_order_occurrence_exceptions(company_legacy_id, occurrence_key);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse the customers/profiles trigger pattern)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_work_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_work_orders_updated_at on work_orders;
create trigger trg_work_orders_updated_at
  before update on work_orders
  for each row execute function set_work_orders_updated_at();

drop trigger if exists trg_wo_service_rows_updated_at on work_order_service_rows;
create trigger trg_wo_service_rows_updated_at
  before update on work_order_service_rows
  for each row execute function set_work_orders_updated_at();

drop trigger if exists trg_wo_exceptions_updated_at on work_order_occurrence_exceptions;
create trigger trg_wo_exceptions_updated_at
  before update on work_order_occurrence_exceptions
  for each row execute function set_work_orders_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — real, company-scoped enforcement (mirrors customers)
--
--   * READ   — signed-in user reads ONLY their own company's rows; super_admin
--              reads all.
--   * WRITE  — INSERT/UPDATE within own company, and super_admin across
--              companies (lets the in-browser migration utility populate the
--              shadow copy without a service-role key).
--   * DELETE — no policy → blocked for everyone (migration never deletes).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin), so
-- there is no recursive-RLS risk and the client is never trusted for tenancy.
-- ─────────────────────────────────────────────────────────────────────────
alter table work_orders                       enable row level security;
alter table work_order_service_rows           enable row level security;
alter table work_order_occurrence_exceptions  enable row level security;

-- work_orders ───────────────────────────────────────────────
drop policy if exists "work_orders_select_own_company" on work_orders;
create policy "work_orders_select_own_company" on work_orders
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "work_orders_select_super_admin" on work_orders;
create policy "work_orders_select_super_admin" on work_orders
  for select to authenticated
  using (is_super_admin());

drop policy if exists "work_orders_insert_own_company" on work_orders;
create policy "work_orders_insert_own_company" on work_orders
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "work_orders_insert_super_admin" on work_orders;
create policy "work_orders_insert_super_admin" on work_orders
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "work_orders_update_own_company" on work_orders;
create policy "work_orders_update_own_company" on work_orders
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "work_orders_update_super_admin" on work_orders;
create policy "work_orders_update_super_admin" on work_orders
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- work_order_service_rows ───────────────────────────────────
drop policy if exists "wo_rows_select_own_company" on work_order_service_rows;
create policy "wo_rows_select_own_company" on work_order_service_rows
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "wo_rows_select_super_admin" on work_order_service_rows;
create policy "wo_rows_select_super_admin" on work_order_service_rows
  for select to authenticated
  using (is_super_admin());

drop policy if exists "wo_rows_insert_own_company" on work_order_service_rows;
create policy "wo_rows_insert_own_company" on work_order_service_rows
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "wo_rows_insert_super_admin" on work_order_service_rows;
create policy "wo_rows_insert_super_admin" on work_order_service_rows
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "wo_rows_update_own_company" on work_order_service_rows;
create policy "wo_rows_update_own_company" on work_order_service_rows
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "wo_rows_update_super_admin" on work_order_service_rows;
create policy "wo_rows_update_super_admin" on work_order_service_rows
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- work_order_occurrence_exceptions ──────────────────────────
drop policy if exists "wo_exceptions_select_own_company" on work_order_occurrence_exceptions;
create policy "wo_exceptions_select_own_company" on work_order_occurrence_exceptions
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "wo_exceptions_select_super_admin" on work_order_occurrence_exceptions;
create policy "wo_exceptions_select_super_admin" on work_order_occurrence_exceptions
  for select to authenticated
  using (is_super_admin());

drop policy if exists "wo_exceptions_insert_own_company" on work_order_occurrence_exceptions;
create policy "wo_exceptions_insert_own_company" on work_order_occurrence_exceptions
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "wo_exceptions_insert_super_admin" on work_order_occurrence_exceptions;
create policy "wo_exceptions_insert_super_admin" on work_order_occurrence_exceptions
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "wo_exceptions_update_own_company" on work_order_occurrence_exceptions;
create policy "wo_exceptions_update_own_company" on work_order_occurrence_exceptions
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "wo_exceptions_update_super_admin" on work_order_occurrence_exceptions;
create policy "wo_exceptions_update_super_admin" on work_order_occurrence_exceptions
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policies on purpose — deletion stays blocked under RLS for all
-- three tables (migration never deletes; mirrors the customers convention).
