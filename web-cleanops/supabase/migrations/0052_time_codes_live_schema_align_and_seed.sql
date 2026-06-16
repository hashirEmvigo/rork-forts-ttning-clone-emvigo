-- ============================================================================
-- CleanOps — TIMECODE: align live time_codes schema + seed the master library
-- ============================================================================
--
-- ROOT CAUSE THIS MIGRATION FIXES
--   Two earlier migrations both `create table if not exists time_codes`:
--     * 0011_time_codes.sql — the SIMPLE schema (flat name/description columns,
--       `active` boolean, NO `data` jsonb, NO `deleted_at`, and only a single
--       SELECT RLS policy `time_codes_read`).
--     * 0024_time_codes_table.sql — the FULL schema the app code expects
--       (`data` jsonb + `deleted_at` soft-delete + the complete read/insert/update
--       RLS policy set + updated_at trigger + soft-delete indexes).
--   Because 0011 created the table first, 0024's `create table if not exists` was
--   a no-op and its `deleted_at`-dependent indexes errored, rolling back the rest
--   of 0024 (its columns AND its write policies). The LIVE table is therefore the
--   0011 schema with 0 rows: it has NO `data`/`deleted_at` columns and (most
--   likely) only the SELECT policy — so the app's Supabase reads
--   (`select data, ..., deleted_at`) fail and every create/edit/archive write is
--   blocked by RLS. Verified live: time_codes exists, row count = 0.
--
-- WHAT THIS MIGRATION DOES (idempotent, additive, no data loss)
--   1. Adds the missing columns `data jsonb` + `deleted_at` (+ name/description
--      add-if-not-exists for cross-environment parse safety).
--   2. Backfills `data` for any pre-existing row that has an empty `data` (a no-op
--      on the live table since it has 0 rows; defensive for dev databases).
--   3. Recreates 0024's indexes, updated_at trigger, and the FULL RLS policy set
--      (read own/global/super_admin; insert own/super_admin; update own/super_admin;
--      DELETE intentionally has no policy → blocked, removal is a soft-delete
--      UPDATE). Drops the now-redundant 0011 `time_codes_read` policy.
--   4. Seeds the 6 GLOBAL master time codes (company_id null, system_managed) into
--      BOTH the flat columns AND the `data` jsonb the read path returns.
--
-- ARCHIVE / RESTORE SEMANTICS (after this migration)
--   * Archive  = `active = false` (UI toggle → setTimeCodeActive). The flat
--     `active` column already exists; the value is also carried in `data`.
--   * Restore  = `active = true`.
--   * Delete   = soft-delete via `deleted_at` (deleteTimeCode → mirror), allowed
--     only for non-system, unreferenced custom codes. System-managed master codes
--     are never deletable.
--
-- SCOPE: GLOBAL master library only (company_id null). Company-owned time codes
--        (future) are untouched. This migration does not read or change services,
--        time reporting, payroll, or any other domain.
-- ============================================================================

-- ── 1. Additive columns (no data loss) ─────────────────────────────────────
alter table time_codes add column if not exists data       jsonb not null default '{}'::jsonb;
alter table time_codes add column if not exists deleted_at  timestamptz;
-- Parse-safety only: guarantees the backfill statement below compiles on a DB
-- that started from the 0024 schema (which lacks the flat name/description
-- columns). No-ops on the live 0011 table where both already exist.
alter table time_codes add column if not exists name        text;
alter table time_codes add column if not exists description text;

-- ── 2. Defensive backfill of `data` for pre-existing rows ───────────────────
-- A no-op on live (0 rows). Reconstructs the lossless TimeCode record the read
-- path returns from the flat columns for any row whose `data` is still empty.
update time_codes
set data = jsonb_build_object(
  'id',            legacy_id,
  'companyId',     company_legacy_id,
  'code',          code,
  'name',          name,
  'type',          type,
  'description',   description,
  'active',        active,
  'systemManaged', system_managed,
  'createdAt',     to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',     to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
where data is null or data = '{}'::jsonb;

-- ── 3. Indexes (0024 set — now that `deleted_at` exists) ────────────────────
create index if not exists idx_time_codes_company_code       on time_codes(company_id, code);
create index if not exists idx_time_codes_companylegacy_code  on time_codes(company_legacy_id, code);
create index if not exists idx_time_codes_type               on time_codes(type);

create index if not exists idx_time_codes_active
  on time_codes(company_id)
  where deleted_at is null;

create index if not exists idx_time_codes_global_active
  on time_codes(code)
  where company_id is null and deleted_at is null;

-- ── 4. updated_at trigger (reuses the roles pattern) ────────────────────────
create or replace function set_time_codes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_time_codes_updated_at on time_codes;
create trigger trg_time_codes_updated_at
  before update on time_codes
  for each row
  execute function set_time_codes_updated_at();

-- ── 5. RLS — full 0024 policy set (idempotent) ──────────────────────────────
-- All checks reuse the SECURITY DEFINER helpers from 0003 (current_company_id /
-- is_super_admin) — the same helpers the live, already-applied services policies
-- (0049) use. DELETE has NO policy on purpose: removal is a soft-delete UPDATE.
alter table time_codes enable row level security;

-- Remove the redundant, broader 0011 read policy (superseded by the explicit
-- own/global/super_admin SELECT policies below).
drop policy if exists time_codes_read on time_codes;

-- READ: own company
drop policy if exists "time_codes_select_own_company" on time_codes;
create policy "time_codes_select_own_company" on time_codes
  for select
  to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: global master library (readable by every authenticated user)
drop policy if exists "time_codes_select_global" on time_codes;
create policy "time_codes_select_global" on time_codes
  for select
  to authenticated
  using (company_id is null);

-- READ: super admin → all
drop policy if exists "time_codes_select_super_admin" on time_codes;
create policy "time_codes_select_super_admin" on time_codes
  for select
  to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "time_codes_insert_own_company" on time_codes;
create policy "time_codes_insert_own_company" on time_codes
  for insert
  to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company OR global (company_id is null)
drop policy if exists "time_codes_insert_super_admin" on time_codes;
create policy "time_codes_insert_super_admin" on time_codes
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: own company (covers archive/restore + soft-delete for company codes)
drop policy if exists "time_codes_update_own_company" on time_codes;
create policy "time_codes_update_own_company" on time_codes
  for update
  to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

-- UPDATE: super admin → any company OR global (master-library archive/restore)
drop policy if exists "time_codes_update_super_admin" on time_codes;
create policy "time_codes_update_super_admin" on time_codes
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ── 6. Seed the GLOBAL master library (idempotent on code, global scope) ────
-- Inserts only codes that do not already exist as a GLOBAL row. Populates the
-- flat summary columns AND the lossless `data` jsonb (id === legacy_id) so both
-- the summary read and the full read return correct records. system_managed = true
-- → deactivatable but never deletable.
insert into time_codes (
  legacy_id, company_id, company_legacy_id,
  code, name, type, description,
  active, system_managed, deleted_at, data
)
select
  s.legacy_id, null, null,
  s.code, s.name, s.type, s.description,
  true, true, null,
  jsonb_build_object(
    'id',            s.legacy_id,
    'companyId',     null,
    'code',          s.code,
    'name',          s.name,
    'type',          s.type,
    'description',   s.description,
    'active',        true,
    'systemManaged', true,
    'createdAt',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
from (values
  ('tc_master_10',  '10',  'Worked Time',            'attendance', 'Standard worked time.'),
  ('tc_master_385', '385', 'Travel Time',            'attendance', 'Compensated travel time.'),
  ('tc_master_355', '355', 'Vacation',               'absence',    'Paid vacation leave.'),
  ('tc_master_360', '360', 'Sick Leave',             'absence',    'Sick-leave absence.'),
  ('tc_master_374', '374', 'VAB / Child Care Leave', 'absence',    'Care of a sick child (VAB).'),
  ('tc_master_380', '380', 'Parental Leave',         'absence',    'Parental leave absence.')
) as s(legacy_id, code, name, type, description)
where not exists (
  select 1 from time_codes t
  where t.company_id is null and lower(t.code) = lower(s.code)
);
