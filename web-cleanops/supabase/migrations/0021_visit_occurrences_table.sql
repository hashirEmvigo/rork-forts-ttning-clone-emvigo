-- ============================================================================
-- CleanOps — MISSION-1: Missions / Visit Occurrences table
--   visit_occurrences
-- ============================================================================
--
-- A VisitOccurrence is the operational execution anchor (a "mission") that sits
-- between a customer protocol / work order and an executable run:
--
--   CustomerProtocolV2 → VisitOccurrence → ProtocolRunV2
--
-- A recurring service produces many occurrences of the same work; each gets a
-- unique operational identity so check-in / mobile execution / reporting can
-- attach runs (and employees) to a SPECIFIC occurrence. This is the highest-
-- priority operational area still on localStorage, so it moves to a Supabase-
-- authoritative source for cross-device consistency.
--
-- It follows the EXACT teams/areas pattern (migrations 0017 / 0020): a FLAT,
-- low-dependency record — flat indexed columns for list / RLS / id-resolution +
-- a lossless `data jsonb` for detail reconstruction, `legacy_id` as the
-- migration/dual-write upsert key, and the WO-5.6 `deleted_at` soft-delete
-- convention (an upsert always UNDELETES).
--
-- SCOPE: every occurrence is COMPANY-scoped (non-null companyId) and additionally
-- carries the customer / work order / service-row references it was created
-- from. There are NO global rows, so the RLS mirrors teams/areas exactly
-- (own-company + super_admin).
--
-- LIFECYCLE: occurrences are NEVER hard-deleted by the app — they transition to
-- the `cancelled` status (soft lifecycle). `deleted_at` exists only for the
-- shared WO-5.6 convention; the mirror never sets it because the store never
-- removes rows.
-- ============================================================================

create or replace function set_visit_occurrence_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists visit_occurrences (
  id                    uuid primary key default gen_random_uuid(),
  legacy_id             text unique not null,
  company_id            uuid references companies(id) on delete cascade,
  company_legacy_id     text not null,
  -- App-facing references (legacy ids) this occurrence was created from. Soft
  -- references — the lossless `data` jsonb carries the full record.
  customer_legacy_id    text not null,
  work_order_legacy_id  text not null,
  service_row_id        text not null,
  -- ISO date of the occurrence, e.g. "2026-06-03". Kept as text for a verbatim
  -- round-trip with the app model.
  scheduled_date        text not null,
  status                text not null default 'scheduled',
  data                  jsonb not null default '{}'::jsonb,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_visit_occurrences_company_date
  on visit_occurrences(company_id, scheduled_date);
create index if not exists idx_visit_occurrences_companylegacy_date
  on visit_occurrences(company_legacy_id, scheduled_date);
create index if not exists idx_visit_occurrences_customer
  on visit_occurrences(company_legacy_id, customer_legacy_id);
create index if not exists idx_visit_occurrences_workorder
  on visit_occurrences(company_legacy_id, work_order_legacy_id);
create index if not exists idx_visit_occurrences_active
  on visit_occurrences(company_id) where deleted_at is null;

drop trigger if exists trg_visit_occurrences_updated_at on visit_occurrences;
create trigger trg_visit_occurrences_updated_at
  before update on visit_occurrences
  for each row execute function set_visit_occurrence_updated_at();

alter table visit_occurrences enable row level security;

drop policy if exists "visit_occurrences_select_own_company" on visit_occurrences;
create policy "visit_occurrences_select_own_company" on visit_occurrences
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "visit_occurrences_select_super_admin" on visit_occurrences;
create policy "visit_occurrences_select_super_admin" on visit_occurrences
  for select to authenticated
  using (is_super_admin());

drop policy if exists "visit_occurrences_insert_own_company" on visit_occurrences;
create policy "visit_occurrences_insert_own_company" on visit_occurrences
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "visit_occurrences_insert_super_admin" on visit_occurrences;
create policy "visit_occurrences_insert_super_admin" on visit_occurrences
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "visit_occurrences_update_own_company" on visit_occurrences;
create policy "visit_occurrences_update_own_company" on visit_occurrences
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "visit_occurrences_update_super_admin" on visit_occurrences;
create policy "visit_occurrences_update_super_admin" on visit_occurrences
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is a soft lifecycle transition to `cancelled`
-- (the WO-5.6 `deleted_at` column exists only for shared convention).
