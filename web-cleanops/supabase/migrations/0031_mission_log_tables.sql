-- ============================================================================
-- CleanOps — MISSIONLOG-1: Mission Log schema foundation (Phase 2a-1)
--   mission_log_entries
--   mission_staff_sessions
--   mission_log_events            (append-only, immutable)
--   mission_booked_time_ratings   (per staff session)
-- ============================================================================
--
-- Mission Log is the operational EXECUTION LEDGER — what actually happened on a
-- mission (one planned booking occurrence): planned-vs-actual times, per-employee
-- check-in/out sessions, an immutable event stream and an optional per-session
-- booked-time rating. It is the durable foundation that Time Reporting will LATER
-- reference (Time Reporting owns the forward link back to Mission Log, never the
-- other way around).
--
-- SCOPE — execution ledger ONLY. Mission Log NEVER:
--   * mutates Schedule          * approves Time Reporting
--   * creates payroll basis     * creates invoice basis
--   * affects the time bank      * sends notifications directly
--   * infers AI decisions
--
-- DATA MODEL — flat columns + `data jsonb` (mirrors visit_occurrences 0021 and
-- activity_events 0029): flat, indexed columns carry everything list / RLS /
-- review-queue queries need; `data jsonb` preserves the COMPLETE record losslessly
-- (the src/types/missionLog.ts shapes) for round-trip reconstruction.
--
-- SOFT REFERENCES (Phase-2a-1 adjustments applied):
--   * Every cross-entity reference is a LEGACY-ID text column, never an FK —
--     each referenced record (visit occurrence / work order / service row /
--     employee / customer) migrates on its own track. This keeps the migration
--     empty-Supabase-safe: a referenced row need not yet exist in Supabase.
--   * booking_occurrence_legacy_id keeps the visit_occurrences relationship SOFT.
--   * service_row_legacy_id is a FLAT nullable column (NOT only inside `data`) so
--     legacy checkout delete-guards / cut-over parity checks can look it up
--     efficiently; it is indexed by (company_id, service_row_legacy_id).
--   * NO time_report_legacy_id on mission_log_entries — Mission Log carries no
--     forward link to Time Reporting. One mission → many sessions → later many
--     time reports; Time Reporting will own the link back via
--     mission_log_entry_legacy_id in its own (later) wave.
--
-- IDENTITY: legacy_id (text, unique) is the app-facing id and the idempotent
-- upsert key (safe re-import, dual-write-ready), never localStorage-authoritative.
--
-- APPEND-ONLY EVENTS: mission_log_events is IMMUTABLE — INSERT policies only, no
-- UPDATE/DELETE policy, no updated_at, no deleted_at. Events are never altered.
--
-- LIFECYCLE: entries / sessions / ratings use the WO-5.6 `deleted_at` soft-delete
-- convention for shared symmetry (an upsert always UNDELETES).
--
-- FEATURE FLAGS: Mission Log read / dual-write / authoritative flags ship DEFAULT
-- OFF (envFlag, NOT the cutover resolver) — there is no repository, adapter, read
-- seam or dual-write yet, so nothing reads or writes these tables. Schema only.
-- ============================================================================

create or replace function set_mission_log_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- mission_log_entries — one row per planned booking occurrence / mission.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists mission_log_entries (
  id                            uuid primary key default gen_random_uuid(),
  legacy_id                     text unique not null,
  company_id                    uuid references companies(id) on delete cascade,
  company_legacy_id             text not null,
  -- Soft references (legacy ids, never FKs — each entity migrates on its own track).
  booking_legacy_id             text not null,
  -- SOFT visit_occurrences relationship (the planned booking occurrence).
  booking_occurrence_legacy_id  text not null,
  work_order_legacy_id          text,
  -- FLAT nullable service-row reference for delete-guard / cut-over parity lookups.
  service_row_legacy_id         text,
  customer_legacy_id            text,
  -- Flat summary columns for list / review-queue queries.
  scheduled_start_time          timestamptz,
  scheduled_end_time            timestamptz,
  mission_status                text not null default 'scheduled',
  delay_status                  text not null default 'on_time',
  requires_admin_review         boolean not null default false,
  -- Lossless full MissionLogEntry record.
  data                          jsonb not null default '{}'::jsonb,
  deleted_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_mission_entries_company_start
  on mission_log_entries(company_id, scheduled_start_time);
create index if not exists idx_mission_entries_occurrence
  on mission_log_entries(company_legacy_id, booking_occurrence_legacy_id);
create index if not exists idx_mission_entries_workorder
  on mission_log_entries(company_legacy_id, work_order_legacy_id);
-- Service-row lookup for legacy checkout delete-guards / cut-over parity.
create index if not exists idx_mission_entries_service_row
  on mission_log_entries(company_id, service_row_legacy_id);
create index if not exists idx_mission_entries_customer
  on mission_log_entries(company_legacy_id, customer_legacy_id);
create index if not exists idx_mission_entries_status
  on mission_log_entries(company_id, mission_status);
-- Surfaces the exception-based review backlog efficiently.
create index if not exists idx_mission_entries_review
  on mission_log_entries(company_id) where requires_admin_review and deleted_at is null;
create index if not exists idx_mission_entries_active
  on mission_log_entries(company_id) where deleted_at is null;

drop trigger if exists trg_mission_entries_updated_at on mission_log_entries;
create trigger trg_mission_entries_updated_at
  before update on mission_log_entries
  for each row execute function set_mission_log_updated_at();

alter table mission_log_entries enable row level security;

drop policy if exists "mission_entries_select_own_company" on mission_log_entries;
create policy "mission_entries_select_own_company" on mission_log_entries
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_entries_select_super_admin" on mission_log_entries;
create policy "mission_entries_select_super_admin" on mission_log_entries
  for select to authenticated
  using (is_super_admin());

drop policy if exists "mission_entries_insert_own_company" on mission_log_entries;
create policy "mission_entries_insert_own_company" on mission_log_entries
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_entries_insert_super_admin" on mission_log_entries;
create policy "mission_entries_insert_super_admin" on mission_log_entries
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "mission_entries_update_own_company" on mission_log_entries;
create policy "mission_entries_update_own_company" on mission_log_entries
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_entries_update_super_admin" on mission_log_entries;
create policy "mission_entries_update_super_admin" on mission_log_entries
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- mission_staff_sessions — per-employee check-in/out session within a mission.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists mission_staff_sessions (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  -- SOFT link to the owning mission entry.
  mission_log_entry_legacy_id text not null,
  employee_legacy_id          text not null,
  -- Flat summary columns (GPS/QR check method is useful for later review queues).
  status                      text not null default 'scheduled',
  check_in_method             text not null default 'missing',
  check_out_method            text not null default 'missing',
  actual_check_in_time        timestamptz,
  actual_check_out_time       timestamptz,
  -- Lossless full MissionStaffSession record (location status / coords / qr ids).
  data                        jsonb not null default '{}'::jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_mission_sessions_entry
  on mission_staff_sessions(company_legacy_id, mission_log_entry_legacy_id);
create index if not exists idx_mission_sessions_employee
  on mission_staff_sessions(company_legacy_id, employee_legacy_id);
create index if not exists idx_mission_sessions_status
  on mission_staff_sessions(company_id, status);
create index if not exists idx_mission_sessions_active
  on mission_staff_sessions(company_id) where deleted_at is null;

drop trigger if exists trg_mission_sessions_updated_at on mission_staff_sessions;
create trigger trg_mission_sessions_updated_at
  before update on mission_staff_sessions
  for each row execute function set_mission_log_updated_at();

alter table mission_staff_sessions enable row level security;

drop policy if exists "mission_sessions_select_own_company" on mission_staff_sessions;
create policy "mission_sessions_select_own_company" on mission_staff_sessions
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_sessions_select_super_admin" on mission_staff_sessions;
create policy "mission_sessions_select_super_admin" on mission_staff_sessions
  for select to authenticated
  using (is_super_admin());

drop policy if exists "mission_sessions_insert_own_company" on mission_staff_sessions;
create policy "mission_sessions_insert_own_company" on mission_staff_sessions
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_sessions_insert_super_admin" on mission_staff_sessions;
create policy "mission_sessions_insert_super_admin" on mission_staff_sessions
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "mission_sessions_update_own_company" on mission_staff_sessions;
create policy "mission_sessions_update_own_company" on mission_staff_sessions
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_sessions_update_super_admin" on mission_staff_sessions;
create policy "mission_sessions_update_super_admin" on mission_staff_sessions
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- mission_log_events — IMMUTABLE append-only event stream.
--   INSERT-only RLS, no UPDATE/DELETE policy, no updated_at, no deleted_at.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists mission_log_events (
  id                          uuid primary key default gen_random_uuid(),
  -- App-facing event id + idempotent insert key.
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  mission_log_entry_legacy_id text not null,
  event_type                  text not null,
  actor_type                  text not null,
  actor_id                    text,
  correlation_id              text,
  -- Lets a later pipeline de-duplicate re-delivered events.
  idempotency_key             text,
  -- Allows the payload shape to evolve.
  schema_version              integer not null default 1,
  -- Lossless full MissionLogEvent payload.
  data                        jsonb not null default '{}'::jsonb,
  occurred_at                 timestamptz not null,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_mission_events_company_occurred
  on mission_log_events(company_id, occurred_at desc);
create index if not exists idx_mission_events_entry_occurred
  on mission_log_events(company_legacy_id, mission_log_entry_legacy_id, occurred_at desc);
create index if not exists idx_mission_events_type
  on mission_log_events(event_type, occurred_at desc);

alter table mission_log_events enable row level security;

drop policy if exists "mission_events_select_own_company" on mission_log_events;
create policy "mission_events_select_own_company" on mission_log_events
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_events_select_super_admin" on mission_log_events;
create policy "mission_events_select_super_admin" on mission_log_events
  for select to authenticated
  using (is_super_admin());

drop policy if exists "mission_events_insert_own_company" on mission_log_events;
create policy "mission_events_insert_own_company" on mission_log_events
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_events_insert_super_admin" on mission_log_events;
create policy "mission_events_insert_super_admin" on mission_log_events
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: no UPDATE/DELETE policies on purpose — the mission event stream is
-- IMMUTABLE under RLS (mirrors the activity_events append-only convention). No
-- business logic depends on updating event rows.

-- ─────────────────────────────────────────────────────────────────────────
-- mission_booked_time_ratings — optional per-session booked-time rating (0–10).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists mission_booked_time_ratings (
  id                            uuid primary key default gen_random_uuid(),
  legacy_id                     text unique not null,
  company_id                    uuid references companies(id) on delete cascade,
  company_legacy_id             text not null,
  -- SOFT links: a rating is tied to BOTH the mission and the specific staff session.
  mission_log_entry_legacy_id   text not null,
  mission_staff_session_legacy_id text not null,
  employee_legacy_id            text not null,
  customer_legacy_id            text,
  -- 0 = completely insufficient time … 10 = more than enough.
  rating                        integer not null check (rating between 0 and 10),
  -- Lossless full MissionBookedTimeRating record (reason codes, deviation, comment).
  data                          jsonb not null default '{}'::jsonb,
  submitted_at                  timestamptz,
  deleted_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_mission_ratings_entry
  on mission_booked_time_ratings(company_legacy_id, mission_log_entry_legacy_id);
create index if not exists idx_mission_ratings_session
  on mission_booked_time_ratings(company_legacy_id, mission_staff_session_legacy_id);
create index if not exists idx_mission_ratings_employee
  on mission_booked_time_ratings(company_legacy_id, employee_legacy_id);
create index if not exists idx_mission_ratings_rating
  on mission_booked_time_ratings(company_id, rating);
create index if not exists idx_mission_ratings_active
  on mission_booked_time_ratings(company_id) where deleted_at is null;

drop trigger if exists trg_mission_ratings_updated_at on mission_booked_time_ratings;
create trigger trg_mission_ratings_updated_at
  before update on mission_booked_time_ratings
  for each row execute function set_mission_log_updated_at();

alter table mission_booked_time_ratings enable row level security;

drop policy if exists "mission_ratings_select_own_company" on mission_booked_time_ratings;
create policy "mission_ratings_select_own_company" on mission_booked_time_ratings
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_ratings_select_super_admin" on mission_booked_time_ratings;
create policy "mission_ratings_select_super_admin" on mission_booked_time_ratings
  for select to authenticated
  using (is_super_admin());

drop policy if exists "mission_ratings_insert_own_company" on mission_booked_time_ratings;
create policy "mission_ratings_insert_own_company" on mission_booked_time_ratings
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_ratings_insert_super_admin" on mission_booked_time_ratings;
create policy "mission_ratings_insert_super_admin" on mission_booked_time_ratings
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "mission_ratings_update_own_company" on mission_booked_time_ratings;
create policy "mission_ratings_update_own_company" on mission_booked_time_ratings
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "mission_ratings_update_super_admin" on mission_booked_time_ratings;
create policy "mission_ratings_update_super_admin" on mission_booked_time_ratings
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.
