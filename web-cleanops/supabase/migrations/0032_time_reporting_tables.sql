-- ============================================================================
-- CleanOps — TIMEREPORTING-1: Time Reporting schema foundation (Phase 2a-2)
--   time_reports
--   time_allocations
--   time_deviation_reason_codes
--   time_report_events            (append-only, immutable)
--   time_report_flags
--   time_report_flag_events       (append-only, immutable — flag resolution history)
--   time_report_messages          (append-only)
--   saved_review_queues
--   saved_filters
-- ============================================================================
--
-- Time Reporting is the standalone APPROVAL, ADJUSTMENT and TIME-CLASSIFICATION
-- workspace. It CONSUMES Mission Log execution data (migration 0031) and decides
-- what time is approved, what is payroll-relevant and what is invoice/billable —
-- optimised for high-volume, exception-based review (saved review queues,
-- advanced filters, bulk actions, flag triage, future AI-assisted prioritising).
--
-- SCOPE — schema foundation ONLY. There is NO repository, Supabase adapter, read
-- seam, dual-write, checkout cut-over, bulk mutation, notification, AI inference
-- or UI wired to these tables yet. Time Reporting NEVER (in this or any phase):
--   * writes payroll basis        * writes invoice basis
--   * affects the time bank        * makes AI decisions (AI only ADVISES)
--
-- RELATIONSHIP TO MISSION LOG (the core directional rule):
--   Time Reporting links BACK to Mission Log; Mission Log never links forward.
--   time_reports.mission_log_entry_legacy_id is the SOFT link back to a
--   mission_log_entries row. Per Phase-2a-2 adjustment #1 it is NULLABLE in this
--   phase (the legacy checkout flow does not yet always have a Mission Log entry;
--   dual-write/parity phases may create a time report before it can safely attach
--   to a mission). It stays INDEXED as the intended future link; not-null is NOT
--   enforced until the behavioural cut-over proves every report can attach.
--
-- DATA MODEL — flat columns + `data jsonb` (mirrors mission_log 0031,
-- visit_occurrences 0021, activity_events 0029): flat, indexed columns carry
-- everything list / RLS / review-queue queries need; `data jsonb` preserves the
-- COMPLETE record losslessly (the src/types/timeReporting.ts shapes).
--
-- SOFT REFERENCES: every cross-entity reference is a LEGACY-ID text column, never
-- an FK (each referenced record migrates on its own track) → empty-Supabase-safe.
--   * service_row_legacy_id is a FLAT nullable column (NOT only inside `data`),
--     indexed by (company_id, service_row_legacy_id), so the legacy checkout
--     delete-guards / cut-over parity checks can look it up efficiently.
--
-- SEPARATION OF CONCERNS (model rules):
--   * APPROVAL status (status / admin / employee) is tracked SEPARATELY from
--     FLAG RESOLUTION status (the time_report_flags lifecycle) — a report can be
--     approved while a related flag is kept-for-review or dismissed.
--   * PAYROLL approval status and INVOICE basis status are INDEPENDENT columns.
--   * time_allocations classify minute slices with payroll / invoice / billable
--     relevance flags so billable / non-billable / payroll / invoice splits are
--     reconstructable without writing any payroll/invoice basis here.
--   * AI recommendation exists ONLY as nullable advisory metadata.
--
-- IDENTITY: legacy_id (text, unique) is the app-facing id and the idempotent
-- upsert key (safe re-import, dual-write-ready), never localStorage-authoritative.
--
-- APPEND-ONLY tables — time_report_events, time_report_flag_events and (per
-- Phase-2a-2 adjustment #2) time_report_messages are IMMUTABLE: INSERT + SELECT
-- policies only, no UPDATE/DELETE policy, no updated_at, no deleted_at. Messages
-- can carry future status metadata losslessly through `data jsonb` WITHOUT any
-- behaviour now.
--
-- LIFECYCLE: the mutable tables (time_reports, time_allocations,
-- time_deviation_reason_codes, time_report_flags, saved_review_queues,
-- saved_filters) use the WO-5.6 `deleted_at` soft-delete convention (an upsert
-- always UNDELETES).
--
-- FEATURE FLAGS: Time Reporting read / dual-write / authoritative flags ship
-- DEFAULT OFF (envFlag, NOT the cutover resolver) — there is no repository,
-- adapter, read seam or dual-write yet, so nothing reads or writes these tables.
-- Schema only.
-- ============================================================================

create or replace function set_time_reporting_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- time_reports — one authoritative time report (one employee session's time).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_reports (
  id                              uuid primary key default gen_random_uuid(),
  legacy_id                       text unique not null,
  company_id                      uuid references companies(id) on delete cascade,
  company_legacy_id               text not null,
  -- SOFT link BACK to Mission Log. NULLABLE in this phase (adjustment #1):
  -- legacy checkout may not yet have a mission entry. Indexed as the future link.
  mission_log_entry_legacy_id     text,
  -- The specific per-employee session this report classifies (when known).
  mission_staff_session_legacy_id text,
  -- Soft references (legacy ids, never FKs — each entity migrates independently).
  booking_legacy_id               text,
  booking_occurrence_legacy_id    text,
  work_order_legacy_id            text,
  -- FLAT nullable service-row reference for delete-guard / cut-over parity.
  service_row_legacy_id           text,
  customer_legacy_id              text,
  employee_legacy_id              text,
  -- Snapshots so the report stays readable even if the source entity changes.
  customer_name_snapshot          text,
  employee_name_snapshot          text,
  -- Flat summary columns for list / review-queue queries.
  scheduled_start_time            timestamptz,
  scheduled_end_time              timestamptz,
  scheduled_duration_minutes      integer,
  actual_duration_minutes         integer,
  total_deviation_minutes         integer,
  -- Workflow status (TimeReportStatus).
  status                          text not null default 'draft',
  -- Payroll readiness — INDEPENDENT of invoice readiness.
  payroll_approval_status         text not null default 'not_ready',
  -- Invoice-basis readiness — INDEPENDENT of payroll readiness.
  invoice_basis_status            text not null default 'not_ready',
  requires_admin_review           boolean not null default false,
  -- DENORMALISED flag-resolution SUMMARY for efficient queue filtering. The
  -- authoritative per-flag lifecycle lives in time_report_flags; this is an
  -- advisory rollup only (kept SEPARATE from approval status).
  flag_resolution_status          text,
  -- ADVISORY ONLY (AiReviewRecommendation). AI never decides; nullable metadata.
  ai_recommendation               text,
  submitted_at                    timestamptz,
  -- Lossless full TimeReport record.
  data                            jsonb not null default '{}'::jsonb,
  deleted_at                      timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- High-volume review-queue indexes.
create index if not exists idx_time_reports_company_status
  on time_reports(company_id, status);
create index if not exists idx_time_reports_company_submitted
  on time_reports(company_id, submitted_at desc);
-- Surfaces the exception-based admin review backlog efficiently.
create index if not exists idx_time_reports_review
  on time_reports(company_id) where requires_admin_review and deleted_at is null;
create index if not exists idx_time_reports_employee
  on time_reports(company_legacy_id, employee_legacy_id);
create index if not exists idx_time_reports_customer
  on time_reports(company_legacy_id, customer_legacy_id);
-- Service-row lookup for legacy checkout delete-guards / cut-over parity.
create index if not exists idx_time_reports_service_row
  on time_reports(company_id, service_row_legacy_id);
-- Intended future link back to Mission Log (kept indexed though nullable).
create index if not exists idx_time_reports_mission_entry
  on time_reports(company_legacy_id, mission_log_entry_legacy_id);
create index if not exists idx_time_reports_payroll_status
  on time_reports(company_id, payroll_approval_status);
create index if not exists idx_time_reports_invoice_status
  on time_reports(company_id, invoice_basis_status);
create index if not exists idx_time_reports_flag_resolution
  on time_reports(company_id, flag_resolution_status);
create index if not exists idx_time_reports_active
  on time_reports(company_id) where deleted_at is null;

drop trigger if exists trg_time_reports_updated_at on time_reports;
create trigger trg_time_reports_updated_at
  before update on time_reports
  for each row execute function set_time_reporting_updated_at();

alter table time_reports enable row level security;

drop policy if exists "time_reports_select_own_company" on time_reports;
create policy "time_reports_select_own_company" on time_reports
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "time_reports_select_super_admin" on time_reports;
create policy "time_reports_select_super_admin" on time_reports
  for select to authenticated
  using (is_super_admin());

drop policy if exists "time_reports_insert_own_company" on time_reports;
create policy "time_reports_insert_own_company" on time_reports
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_reports_insert_super_admin" on time_reports;
create policy "time_reports_insert_super_admin" on time_reports
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "time_reports_update_own_company" on time_reports;
create policy "time_reports_update_own_company" on time_reports
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_reports_update_super_admin" on time_reports;
create policy "time_reports_update_super_admin" on time_reports
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- time_allocations — classified minute slices of a report (payroll/invoice/
--   billable relevance). The sum reconstructs the worked-time split.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_allocations (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  -- SOFT links to the owning report + (for analytics) the mission entry.
  time_report_legacy_id       text not null,
  mission_log_entry_legacy_id text,
  employee_legacy_id          text,
  -- Classification (TimeAllocationType) + relevance flags.
  allocation_type             text not null,
  minutes                     integer not null default 0,
  reason_code_legacy_id       text,
  is_payroll_relevant         boolean not null default false,
  is_invoice_relevant         boolean not null default false,
  is_billable                 boolean not null default false,
  created_by_actor_type       text not null default 'system',
  created_by_actor_id         text,
  -- Lossless full TimeAllocation record.
  data                        jsonb not null default '{}'::jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_time_allocations_report
  on time_allocations(company_legacy_id, time_report_legacy_id);
create index if not exists idx_time_allocations_type
  on time_allocations(company_id, allocation_type);
create index if not exists idx_time_allocations_payroll
  on time_allocations(company_id) where is_payroll_relevant and deleted_at is null;
create index if not exists idx_time_allocations_invoice
  on time_allocations(company_id) where is_invoice_relevant and deleted_at is null;
create index if not exists idx_time_allocations_active
  on time_allocations(company_id) where deleted_at is null;

drop trigger if exists trg_time_allocations_updated_at on time_allocations;
create trigger trg_time_allocations_updated_at
  before update on time_allocations
  for each row execute function set_time_reporting_updated_at();

alter table time_allocations enable row level security;

drop policy if exists "time_allocations_select_own_company" on time_allocations;
create policy "time_allocations_select_own_company" on time_allocations
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "time_allocations_select_super_admin" on time_allocations;
create policy "time_allocations_select_super_admin" on time_allocations
  for select to authenticated
  using (is_super_admin());

drop policy if exists "time_allocations_insert_own_company" on time_allocations;
create policy "time_allocations_insert_own_company" on time_allocations
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_allocations_insert_super_admin" on time_allocations;
create policy "time_allocations_insert_super_admin" on time_allocations
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "time_allocations_update_own_company" on time_allocations;
create policy "time_allocations_update_own_company" on time_allocations
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_allocations_update_super_admin" on time_allocations;
create policy "time_allocations_update_super_admin" on time_allocations
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- time_deviation_reason_codes — company-configurable deviation reason codes.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_deviation_reason_codes (
  id                            uuid primary key default gen_random_uuid(),
  legacy_id                     text unique not null,
  company_id                    uuid references companies(id) on delete cascade,
  company_legacy_id             text not null,
  label                         text not null,
  description                   text,
  default_allocation_type       text not null,
  is_billable_default           boolean not null default false,
  is_payroll_relevant_default   boolean not null default false,
  is_invoice_relevant_default   boolean not null default false,
  requires_comment              boolean not null default false,
  is_active                     boolean not null default true,
  sort_order                    integer not null default 0,
  -- Lossless full TimeDeviationReasonCode record.
  data                          jsonb not null default '{}'::jsonb,
  deleted_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_reason_codes_company_sort
  on time_deviation_reason_codes(company_id, sort_order);
create index if not exists idx_reason_codes_active
  on time_deviation_reason_codes(company_id) where is_active and deleted_at is null;

drop trigger if exists trg_reason_codes_updated_at on time_deviation_reason_codes;
create trigger trg_reason_codes_updated_at
  before update on time_deviation_reason_codes
  for each row execute function set_time_reporting_updated_at();

alter table time_deviation_reason_codes enable row level security;

drop policy if exists "reason_codes_select_own_company" on time_deviation_reason_codes;
create policy "reason_codes_select_own_company" on time_deviation_reason_codes
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "reason_codes_select_super_admin" on time_deviation_reason_codes;
create policy "reason_codes_select_super_admin" on time_deviation_reason_codes
  for select to authenticated
  using (is_super_admin());

drop policy if exists "reason_codes_insert_own_company" on time_deviation_reason_codes;
create policy "reason_codes_insert_own_company" on time_deviation_reason_codes
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "reason_codes_insert_super_admin" on time_deviation_reason_codes;
create policy "reason_codes_insert_super_admin" on time_deviation_reason_codes
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "reason_codes_update_own_company" on time_deviation_reason_codes;
create policy "reason_codes_update_own_company" on time_deviation_reason_codes
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "reason_codes_update_super_admin" on time_deviation_reason_codes;
create policy "reason_codes_update_super_admin" on time_deviation_reason_codes
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- time_report_events — IMMUTABLE append-only event stream for a report.
--   INSERT-only RLS, no UPDATE/DELETE policy, no updated_at, no deleted_at.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_report_events (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  time_report_legacy_id       text not null,
  event_type                  text not null,
  actor_type                  text not null,
  actor_id                    text,
  correlation_id              text,
  idempotency_key             text,
  schema_version              integer not null default 1,
  data                        jsonb not null default '{}'::jsonb,
  occurred_at                 timestamptz not null,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_time_report_events_company_occurred
  on time_report_events(company_id, occurred_at desc);
create index if not exists idx_time_report_events_report_occurred
  on time_report_events(company_legacy_id, time_report_legacy_id, occurred_at desc);
create index if not exists idx_time_report_events_type
  on time_report_events(event_type, occurred_at desc);

alter table time_report_events enable row level security;

drop policy if exists "time_report_events_select_own_company" on time_report_events;
create policy "time_report_events_select_own_company" on time_report_events
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_events_select_super_admin" on time_report_events;
create policy "time_report_events_select_super_admin" on time_report_events
  for select to authenticated
  using (is_super_admin());

drop policy if exists "time_report_events_insert_own_company" on time_report_events;
create policy "time_report_events_insert_own_company" on time_report_events
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_events_insert_super_admin" on time_report_events;
create policy "time_report_events_insert_super_admin" on time_report_events
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: no UPDATE/DELETE policies on purpose — the event stream is IMMUTABLE
-- under RLS (mirrors mission_log_events / activity_events).

-- ─────────────────────────────────────────────────────────────────────────
-- time_report_flags — operational flags attached to a report. The flag's
--   resolution lifecycle is tracked SEPARATELY from the report's approval.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_report_flags (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  time_report_legacy_id       text not null,
  mission_log_entry_legacy_id text,
  -- What raised the flag (e.g. gps_flag / qr_flag / manual_adjustment …).
  flag_type                   text not null,
  -- FlagResolutionStatus — SEPARATE from the report's approval status.
  resolution_status           text not null default 'open',
  severity                    text,
  resolved_by_actor_id        text,
  resolved_at                 timestamptz,
  -- Lossless full flag record.
  data                        jsonb not null default '{}'::jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_time_report_flags_report
  on time_report_flags(company_legacy_id, time_report_legacy_id);
create index if not exists idx_time_report_flags_resolution
  on time_report_flags(company_id, resolution_status);
create index if not exists idx_time_report_flags_type
  on time_report_flags(company_id, flag_type);
-- Surfaces the open/unresolved flag backlog efficiently.
create index if not exists idx_time_report_flags_open
  on time_report_flags(company_id)
  where resolution_status = 'open' and deleted_at is null;
create index if not exists idx_time_report_flags_active
  on time_report_flags(company_id) where deleted_at is null;

drop trigger if exists trg_time_report_flags_updated_at on time_report_flags;
create trigger trg_time_report_flags_updated_at
  before update on time_report_flags
  for each row execute function set_time_reporting_updated_at();

alter table time_report_flags enable row level security;

drop policy if exists "time_report_flags_select_own_company" on time_report_flags;
create policy "time_report_flags_select_own_company" on time_report_flags
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_flags_select_super_admin" on time_report_flags;
create policy "time_report_flags_select_super_admin" on time_report_flags
  for select to authenticated
  using (is_super_admin());

drop policy if exists "time_report_flags_insert_own_company" on time_report_flags;
create policy "time_report_flags_insert_own_company" on time_report_flags
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_flags_insert_super_admin" on time_report_flags;
create policy "time_report_flags_insert_super_admin" on time_report_flags
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "time_report_flags_update_own_company" on time_report_flags;
create policy "time_report_flags_update_own_company" on time_report_flags
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_flags_update_super_admin" on time_report_flags;
create policy "time_report_flags_update_super_admin" on time_report_flags
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- time_report_flag_events — IMMUTABLE append-only flag-resolution history.
--   INSERT-only RLS, no UPDATE/DELETE policy, no updated_at, no deleted_at.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_report_flag_events (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  time_report_flag_legacy_id  text not null,
  time_report_legacy_id       text not null,
  event_type                  text not null,
  -- The resolution transition captured by this event (FlagResolutionStatus).
  from_resolution_status      text,
  to_resolution_status        text,
  actor_type                  text not null,
  actor_id                    text,
  idempotency_key             text,
  schema_version              integer not null default 1,
  data                        jsonb not null default '{}'::jsonb,
  occurred_at                 timestamptz not null,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_flag_events_company_occurred
  on time_report_flag_events(company_id, occurred_at desc);
create index if not exists idx_flag_events_flag_occurred
  on time_report_flag_events(company_legacy_id, time_report_flag_legacy_id, occurred_at desc);
create index if not exists idx_flag_events_report
  on time_report_flag_events(company_legacy_id, time_report_legacy_id, occurred_at desc);

alter table time_report_flag_events enable row level security;

drop policy if exists "flag_events_select_own_company" on time_report_flag_events;
create policy "flag_events_select_own_company" on time_report_flag_events
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "flag_events_select_super_admin" on time_report_flag_events;
create policy "flag_events_select_super_admin" on time_report_flag_events
  for select to authenticated
  using (is_super_admin());

drop policy if exists "flag_events_insert_own_company" on time_report_flag_events;
create policy "flag_events_insert_own_company" on time_report_flag_events
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "flag_events_insert_super_admin" on time_report_flag_events;
create policy "flag_events_insert_super_admin" on time_report_flag_events
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: no UPDATE/DELETE policies on purpose — flag-resolution history is
-- IMMUTABLE under RLS (mirrors mission_log_events / activity_events).

-- ─────────────────────────────────────────────────────────────────────────
-- time_report_messages — admin↔employee thread. APPEND-ONLY (adjustment #2):
--   INSERT + SELECT only, no UPDATE/DELETE. Future message status metadata
--   (read/edited/etc.) is supported losslessly via `data jsonb` — no behaviour
--   now.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_report_messages (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  time_report_legacy_id       text not null,
  sender_type                 text not null,
  sender_id                   text,
  message                     text not null,
  idempotency_key             text,
  schema_version              integer not null default 1,
  -- Lossless message record + room for future status metadata (read/edited…).
  data                        jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_time_report_messages_report
  on time_report_messages(company_legacy_id, time_report_legacy_id, created_at);
create index if not exists idx_time_report_messages_company_created
  on time_report_messages(company_id, created_at desc);

alter table time_report_messages enable row level security;

drop policy if exists "time_report_messages_select_own_company" on time_report_messages;
create policy "time_report_messages_select_own_company" on time_report_messages
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_messages_select_super_admin" on time_report_messages;
create policy "time_report_messages_select_super_admin" on time_report_messages
  for select to authenticated
  using (is_super_admin());

drop policy if exists "time_report_messages_insert_own_company" on time_report_messages;
create policy "time_report_messages_insert_own_company" on time_report_messages
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "time_report_messages_insert_super_admin" on time_report_messages;
create policy "time_report_messages_insert_super_admin" on time_report_messages
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: append-only for now — no UPDATE/DELETE policy. Future status metadata
-- rides in `data jsonb` without any behaviour change in this phase.

-- ─────────────────────────────────────────────────────────────────────────
-- saved_filters — a reusable, named set of advanced-filter criteria. Simple
--   non-behavioural storage only (no evaluation engine in this phase).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists saved_filters (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  name                        text not null,
  -- "all" | "any" — how criteria combine.
  match_mode                  text not null default 'all',
  created_by_user_id          text,
  -- Lossless full SavedFilter record (the criteria array).
  data                        jsonb not null default '{}'::jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_saved_filters_company
  on saved_filters(company_id);
create index if not exists idx_saved_filters_active
  on saved_filters(company_id) where deleted_at is null;

drop trigger if exists trg_saved_filters_updated_at on saved_filters;
create trigger trg_saved_filters_updated_at
  before update on saved_filters
  for each row execute function set_time_reporting_updated_at();

alter table saved_filters enable row level security;

drop policy if exists "saved_filters_select_own_company" on saved_filters;
create policy "saved_filters_select_own_company" on saved_filters
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "saved_filters_select_super_admin" on saved_filters;
create policy "saved_filters_select_super_admin" on saved_filters
  for select to authenticated
  using (is_super_admin());

drop policy if exists "saved_filters_insert_own_company" on saved_filters;
create policy "saved_filters_insert_own_company" on saved_filters
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "saved_filters_insert_super_admin" on saved_filters;
create policy "saved_filters_insert_super_admin" on saved_filters
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "saved_filters_update_own_company" on saved_filters;
create policy "saved_filters_update_own_company" on saved_filters
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "saved_filters_update_super_admin" on saved_filters;
create policy "saved_filters_update_super_admin" on saved_filters
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.

-- ─────────────────────────────────────────────────────────────────────────
-- saved_review_queues — a named, shareable view over time reports built from a
--   saved filter. Simple non-behavioural storage only (no evaluation here).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists saved_review_queues (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text not null,
  name                        text not null,
  description                 text,
  -- SOFT link to the filter that defines queue membership (optional; the full
  -- filter is also carried losslessly inside `data`).
  saved_filter_legacy_id      text,
  -- Shared with the whole company vs. private to its owner.
  shared                      boolean not null default false,
  sort_order                  integer not null default 0,
  created_by_user_id          text,
  -- Lossless full SavedReviewQueue record (incl. the embedded filter).
  data                        jsonb not null default '{}'::jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_saved_queues_company_sort
  on saved_review_queues(company_id, sort_order);
create index if not exists idx_saved_queues_shared
  on saved_review_queues(company_id) where shared and deleted_at is null;
create index if not exists idx_saved_queues_active
  on saved_review_queues(company_id) where deleted_at is null;

drop trigger if exists trg_saved_queues_updated_at on saved_review_queues;
create trigger trg_saved_queues_updated_at
  before update on saved_review_queues
  for each row execute function set_time_reporting_updated_at();

alter table saved_review_queues enable row level security;

drop policy if exists "saved_queues_select_own_company" on saved_review_queues;
create policy "saved_queues_select_own_company" on saved_review_queues
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "saved_queues_select_super_admin" on saved_review_queues;
create policy "saved_queues_select_super_admin" on saved_review_queues
  for select to authenticated
  using (is_super_admin());

drop policy if exists "saved_queues_insert_own_company" on saved_review_queues;
create policy "saved_queues_insert_own_company" on saved_review_queues
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "saved_queues_insert_super_admin" on saved_review_queues;
create policy "saved_queues_insert_super_admin" on saved_review_queues
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "saved_queues_update_own_company" on saved_review_queues;
create policy "saved_queues_update_own_company" on saved_review_queues
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "saved_queues_update_super_admin" on saved_review_queues;
create policy "saved_queues_update_super_admin" on saved_review_queues
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy — removal is the soft `deleted_at` convention.
