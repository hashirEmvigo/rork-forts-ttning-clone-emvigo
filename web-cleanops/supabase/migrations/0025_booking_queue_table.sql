-- ============================================================================
-- CleanOps — BQ-1: BOOKING_QUEUE table (Booking Queue full-wave migration)
-- ============================================================================
--
-- The Booking Queue is the PLANNING layer that sits between Work Orders (the
-- source of work) and the future Schedule module. Every work-order service row
-- produces one queue item; the item carries SNAPSHOT values (customer, service,
-- work-order reference, planned window, recurrence) so the planner list renders
-- without joining back to live records.
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors areas 0020):
--   Flat, indexed columns carry everything list / RLS / id-resolution / cross-
--   entity lookup need (company scope, the soft references to the work order /
--   service row / customer, and the two planning status enums). `data jsonb`
--   holds the COMPLETE BookingQueueItem record (every snapshot field, reschedule,
--   schedule fields, timestamps) for lossless reconstruction.
--
-- SCOPE: every queue item is COMPANY-scoped — BookingQueueItem.companyId is
--   always a non-null app-facing company id. There are NO global rows, so the
--   RLS mirrors areas exactly (own-company + super_admin).
--
-- SOFT REFERENCES (carried flat, never FKs — the referenced records migrate on
--   their own tracks and the queue must survive a source row being re-derived):
--     work_order_legacy_id   → WorkOrder.id
--     service_row_legacy_id   → WorkOrderServiceRow.id (the producing row)
--     customer_legacy_id      → Customer.id
--
-- legacy_id / company_legacy_id: mirror the areas convention. `legacy_id` is the
--   app-facing BookingQueueItem.id and is the migration upsert key — it survives
--   verbatim so re-derivation (normalizeBookingQueueItem) never orphans a row.
--
-- deleted_at: WO-5.6 / areas soft-delete convention. Active reads filter
--   `deleted_at is null`; an upsert always writes `deleted_at = null` (an upsert
--   UNDELETES). Removal is an UPDATE that sets `deleted_at`; hard delete blocked.
-- ============================================================================

create table if not exists booking_queue (
  id                     uuid primary key default gen_random_uuid(),
  -- App-facing BookingQueueItem id from localStorage; migration upsert key.
  legacy_id              text unique not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id             uuid references companies(id) on delete cascade,
  -- App-facing company id (e.g. 'cmp_nordlys'). Always set (never global).
  company_legacy_id      text not null,
  -- Soft references to the producing records (app-facing ids, never FKs).
  work_order_legacy_id   text not null,
  service_row_legacy_id  text not null,
  customer_legacy_id     text not null,
  -- Flat planning status columns (the two queue enums) for list filtering.
  assignment_status      text not null,
  schedule_status        text not null,
  -- Snapshot planning date ("YYYY-MM-DD"); null only for orphaned items.
  service_date           text,
  -- Cancellation marker (queue-level), null when active.
  cancelled_at           timestamptz,
  -- Lossless full BookingQueueItem record (every snapshot + schedule field).
  data                   jsonb not null default '{}'::jsonb,
  -- Soft-delete marker (WO-5.6 convention). Null = active.
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES (BQ-1 set)
--   (company_id, service_date)        — the queue's primary date-scoped listing
--   (company_legacy_id, service_date) — query-layer scope (app-facing id)
--   (work_order_legacy_id)            — "queue items for this work order"
--   (service_row_legacy_id)           — re-derivation / removal by source row
--   (customer_legacy_id)              — customer-scoped lookups
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_booking_queue_company_date
  on booking_queue(company_id, service_date);
create index if not exists idx_booking_queue_companylegacy_date
  on booking_queue(company_legacy_id, service_date);
create index if not exists idx_booking_queue_work_order
  on booking_queue(work_order_legacy_id);
create index if not exists idx_booking_queue_service_row
  on booking_queue(service_row_legacy_id);
create index if not exists idx_booking_queue_customer
  on booking_queue(customer_legacy_id);

-- Partial index for the active-row fast path (mirrors soft-delete convention).
create index if not exists idx_booking_queue_active
  on booking_queue(company_id) where deleted_at is null;

-- Keep updated_at fresh on every update (reuses the established pattern).
create or replace function set_booking_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_booking_queue_updated_at on booking_queue;
create trigger trg_booking_queue_updated_at
  before update on booking_queue
  for each row
  execute function set_booking_queue_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped (mirrors areas 0020; NO global tier)
--
--   * anon   — NO access at all (real operational data).
--   * READ   — signed-in user reads their own company's queue items;
--              super_admin reads all.
--   * WRITE  — INSERT/UPDATE within own company; super_admin any company.
--   * DELETE — no policy -> blocked. Removal is an UPDATE that sets deleted_at.
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table booking_queue enable row level security;

drop policy if exists "booking_queue_select_own_company" on booking_queue;
create policy "booking_queue_select_own_company" on booking_queue
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "booking_queue_select_super_admin" on booking_queue;
create policy "booking_queue_select_super_admin" on booking_queue
  for select to authenticated
  using (is_super_admin());

drop policy if exists "booking_queue_insert_own_company" on booking_queue;
create policy "booking_queue_insert_own_company" on booking_queue
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "booking_queue_insert_super_admin" on booking_queue;
create policy "booking_queue_insert_super_admin" on booking_queue
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "booking_queue_update_own_company" on booking_queue;
create policy "booking_queue_update_own_company" on booking_queue
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "booking_queue_update_super_admin" on booking_queue;
create policy "booking_queue_update_super_admin" on booking_queue
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose — removal is a soft-delete UPDATE
-- (mirrors the areas / WO-5.6 convention).
