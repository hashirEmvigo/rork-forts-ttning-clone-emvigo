-- ============================================================================
-- CleanOps — EXEC-1: Protocol Runs Supabase table
--   protocol_runs
-- ============================================================================
--
-- Phase 2C-A1 creates the authoritative Supabase persistence target for
-- ProtocolRunV2 execution snapshots, without cutting over the UI and without
-- migrating browser localStorage data.
--
-- DESIGN
--   * One row per protocol run aggregate.
--   * Flat indexed columns carry tenant scope, lookup keys and lifecycle state.
--   * `data jsonb` carries the complete lossless aggregate:
--       { run, sections, items }
--   * `legacy_id` is the app-facing ProtocolRunV2 id and idempotency key.
--   * `deleted_at` is the soft-delete/archive marker. There is intentionally no
--     DELETE policy; app lifecycle should archive/soft-delete rather than hard
--     delete execution history.
--
-- SAFETY
--   * No seed data.
--   * No browser-driven migration.
--   * No localStorage fallback.
--   * RLS mirrors visit_occurrences: own-company rows plus super_admin access.
-- ============================================================================

create or replace function set_protocol_runs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists protocol_runs (
  id                                  uuid primary key default gen_random_uuid(),
  legacy_id                           text unique not null,
  company_id                          uuid references companies(id) on delete cascade,
  company_legacy_id                   text not null,
  customer_legacy_id                  text,
  work_order_legacy_id                text,
  visit_occurrence_legacy_id          text,
  source_customer_protocol_legacy_id  text,
  status                              text not null default 'draft',
  generated_at                        timestamptz not null,
  completed_at                        timestamptz,
  data                                jsonb not null default '{}'::jsonb,
  deleted_at                          timestamptz,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  constraint protocol_runs_status_check
    check (status in ('draft', 'in_progress', 'completed', 'cancelled'))
);

create index if not exists idx_protocol_runs_company_generated
  on protocol_runs(company_id, generated_at desc);
create index if not exists idx_protocol_runs_companylegacy_generated
  on protocol_runs(company_legacy_id, generated_at desc);
create index if not exists idx_protocol_runs_customer
  on protocol_runs(company_legacy_id, customer_legacy_id);
create index if not exists idx_protocol_runs_work_order
  on protocol_runs(company_legacy_id, work_order_legacy_id);
create index if not exists idx_protocol_runs_visit_occurrence
  on protocol_runs(company_legacy_id, visit_occurrence_legacy_id);
create index if not exists idx_protocol_runs_source_customer_protocol
  on protocol_runs(company_legacy_id, source_customer_protocol_legacy_id);
create index if not exists idx_protocol_runs_active
  on protocol_runs(company_id) where deleted_at is null;

-- JSONB containment/index support for future audit/read-model work. The normal
-- repository path still scopes through flat company columns first.
create index if not exists idx_protocol_runs_data_gin
  on protocol_runs using gin (data);

drop trigger if exists trg_protocol_runs_updated_at on protocol_runs;
create trigger trg_protocol_runs_updated_at
  before update on protocol_runs
  for each row execute function set_protocol_runs_updated_at();

alter table protocol_runs enable row level security;

drop policy if exists "protocol_runs_select_own_company" on protocol_runs;
create policy "protocol_runs_select_own_company" on protocol_runs
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "protocol_runs_select_super_admin" on protocol_runs;
create policy "protocol_runs_select_super_admin" on protocol_runs
  for select to authenticated
  using (is_super_admin());

drop policy if exists "protocol_runs_insert_own_company" on protocol_runs;
create policy "protocol_runs_insert_own_company" on protocol_runs
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "protocol_runs_insert_super_admin" on protocol_runs;
create policy "protocol_runs_insert_super_admin" on protocol_runs
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "protocol_runs_update_own_company" on protocol_runs;
create policy "protocol_runs_update_own_company" on protocol_runs
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "protocol_runs_update_super_admin" on protocol_runs;
create policy "protocol_runs_update_super_admin" on protocol_runs
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy. Protocol runs are execution history and should be
-- archived/soft-deleted by setting deleted_at, not hard-deleted from clients.
