-- ============================================================================
-- CleanOps — ACTIVITY-1: ACTIVITY_EVENTS table (Activity Log wave)
-- ============================================================================
--
-- The append-only audit trail. Until now every meaningful action was recorded
-- ONLY in localStorage (cleanops.auditEvents, hard-capped at the newest 500) and
-- surfaced through the Activity Log + the Super Admin area — a real
-- source-of-truth dependency. This wave moves the trail onto Supabase so the
-- audit history is durable, cross-device and no longer bounded by the 500-cap.
--
-- DATA MODEL — flat columns + `data jsonb` (mirrors areas 0020):
--   Flat, indexed columns (company scope / actor / action / at) carry everything
--   list / RLS / date-paged-query needs; `data jsonb` holds the COMPLETE
--   AuditEvent record for lossless reconstruction.
--
-- SCOPE: an event is COMPANY-scoped, OR platform-level (company_id is NULL for
--   super-admin / cross-company actions). RLS lets a signed-in user read their
--   own company's events; platform-level events + all events are super-admin
--   only. This matches the in-app visibility rule (visibleAuditEvents).
--
-- APPEND-ONLY: events are immutable. There are INSERT policies only — no UPDATE
--   or DELETE policy — so the trail can never be altered under RLS. legacy_id is
--   the app-facing event id and the idempotent upsert key (safe re-import).
--   There is NO soft-delete (an audit trail is never removed).
-- ============================================================================

create table if not exists activity_events (
  id                 uuid primary key default gen_random_uuid(),
  -- App-facing event id from localStorage; idempotent insert/upsert key.
  legacy_id          text unique not null,
  -- Real tenant FK used by RLS; NULL for platform-level events.
  company_id         uuid references companies(id) on delete cascade,
  -- App-facing company id; NULL for platform-level events.
  company_legacy_id  text,
  -- Flat, indexed summary columns.
  actor_id           text,
  actor_name         text not null,
  actor_role         text not null,
  action             text not null,
  -- ISO timestamp of when the action happened (the app-authored `at`).
  occurred_at        timestamptz not null,
  -- Lossless full AuditEvent record (summary, ...).
  data               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDEXES — geared for the date-paged, company-scoped Activity Log query
-- (OP2 activity-log blueprint).
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_activity_company_occurred
  on activity_events(company_id, occurred_at desc);
create index if not exists idx_activity_companylegacy_occurred
  on activity_events(company_legacy_id, occurred_at desc);
create index if not exists idx_activity_actor
  on activity_events(actor_id, occurred_at desc);
create index if not exists idx_activity_action
  on activity_events(action, occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped read; append-only insert
--
--   * anon   — NO access (real operational data).
--   * READ   — signed-in user reads their own company's events; super_admin
--              reads all (incl. platform-level company_id IS NULL events).
--   * INSERT — own-company events by the company, any event by super admin
--              (the in-browser migration utility populates the trail without a
--              service-role key).
--   * UPDATE/DELETE — no policy → blocked for everyone (immutable trail).
--
-- All checks go through the SECURITY DEFINER helpers from
-- 0003_profiles_auth_foundation.sql (current_company_id / is_super_admin).
-- ─────────────────────────────────────────────────────────────────────────
alter table activity_events enable row level security;

-- READ: own company
drop policy if exists "activity_select_own_company" on activity_events;
create policy "activity_select_own_company" on activity_events
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

-- READ: super admin → all (incl. platform-level events)
drop policy if exists "activity_select_super_admin" on activity_events;
create policy "activity_select_super_admin" on activity_events
  for select to authenticated
  using (is_super_admin());

-- INSERT: own company
drop policy if exists "activity_insert_own_company" on activity_events;
create policy "activity_insert_own_company" on activity_events
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- INSERT: super admin → any company OR platform-level (company_id is null)
drop policy if exists "activity_insert_super_admin" on activity_events;
create policy "activity_insert_super_admin" on activity_events
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: no UPDATE/DELETE policies on purpose — the audit trail is immutable
-- under RLS (mirrors the entitlement-log append-only convention).
