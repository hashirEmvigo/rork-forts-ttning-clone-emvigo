-- ============================================================================
-- CleanOps — PRICE CALCULATOR (Slice 1B): PROSPECTS + QUOTE REQUESTS  [PROPOSED]
-- ============================================================================
--
-- STATUS: PROPOSED ONLY — `.sql.proposed` is never picked up by the migration
-- runner. Apply 0058 FIRST (this file reuses its set_calculator_updated_at()
-- trigger fn and references calculator_services / cleaning_plans).
--
-- PURPOSE
--   The capture side of the Price Calculator: when a visitor submits the public
--   calculator, the system creates/updates a PROSPECT and records a QUOTE
--   REQUEST with a frozen pricing snapshot. This migration creates:
--     • prospects             — a DEDICATED, ISOLATED lead table (confirmation
--                               #3: NOT the customers table, never overloaded).
--     • quote_requests        — one submitted quote, with full pricing snapshot.
--     • quote_request_answers — per-question answer snapshots (labels frozen).
--
-- WHY A SEPARATE prospects TABLE (NOT customers)
--   customers (0007) is a real operational entity: it carries a customer_number
--   from the durable allocator, feeds Work Orders / Booking Ledger / Mission Log
--   / invoices, and is company-staff readable. A raw web lead must NOT enter any
--   of those flows or consume a customer number. prospects is therefore fully
--   isolated; converted_customer_id is the ONLY (nullable, manual, Phase-2+)
--   bridge to a real customer. No automation promotes a prospect here.
--
-- SNAPSHOT = HISTORICAL TRUTH (confirmation: old quotes must never change)
--   A quote_request copies everything price-relevant AT SUBMISSION TIME into its
--   own columns + pricing_snapshot_json: the plan name & hourly rate, every
--   pricing-rule value used, the inputs, the formula version and the computed
--   totals. The FKs to calculator_services / cleaning_plans are ON DELETE SET
--   NULL and are convenience links ONLY — the snapshot, not the live config row,
--   is the source of truth. So editing or soft-deleting a plan / rule / service
--   later can NEVER mutate an already-submitted quote.
--
-- SECURITY POSTURE (same as 0058)
--   Super-Admin-only active RLS (MVP). NO anon policies: the public submission
--   is NOT a direct anon INSERT — a SECURITY DEFINER Edge Function (service
--   role, Slice 3) validates input, recomputes the trusted price, and writes
--   prospect + quote_request + answers server-side. That keeps the path
--   validated, rate-limitable, and free of client-trusted pricing, and avoids
--   protected-route redirects on the public page. Company-Admin "see my own
--   leads" is Phase 2 (commented templates below). CRM stays preparation-only:
--   prospect_status / source / source_url exist as plain fields with NO
--   pipeline, assignment, automation, or dashboard.
--
-- COMPATIBILITY
--   Purely additive. converted_customer_id references customers(id) ON DELETE
--   SET NULL (a deleted customer simply unlinks; the prospect/quote survive).
--   No existing table/policy/behaviour is modified.
-- ============================================================================

-- ===========================================================================
-- 1. prospects  (isolated web-lead identity — one per company + email)
-- ===========================================================================
create table if not exists prospects (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text not null unique,
  company_id                  uuid not null references companies(id) on delete cascade,
  company_legacy_id           text not null,

  -- CRM-preparation metadata (fields only — no behaviour, confirmation #6).
  prospect_status             text not null default 'new',          -- new | contacted | qualified | converted | lost
  source                      text not null default 'price_calculator',
  source_url                  text,
  campaign_source             text,

  -- Contact details (from the calculator's contact step).
  name                        text,
  email                       text,
  phone                       text,
  postal_code                 text,
  address_json                jsonb not null default '{}'::jsonb,

  -- Manual, Phase-2+ bridges. NO automation sets these in this phase.
  --   converted_customer_id → a real customers row, once a human converts it.
  --   linked_profile_id      → a future portal auth profile (plain uuid, NO FK
  --                            to profiles/auth — keeps the lead table decoupled
  --                            from auth and avoids cascade coupling).
  converted_customer_id       uuid references customers(id) on delete set null,
  converted_customer_legacy_id text,
  linked_profile_id           uuid,

  notes                       text,
  metadata                    jsonb not null default '{}'::jsonb,

  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint prospects_status_check
    check (prospect_status in ('new', 'contacted', 'qualified', 'converted', 'lost'))
);

-- De-dupe within a tenant: at most ONE live prospect per company + email
-- (case-insensitive). Email can legitimately recur across DIFFERENT companies
-- (tenant boundary preserved); the Edge Function upserts on this key.
create unique index if not exists uq_prospects_company_email_live
  on prospects(company_id, lower(email)) where email is not null and deleted_at is null;
create index if not exists idx_prospects_company
  on prospects(company_id) where deleted_at is null;
create index if not exists idx_prospects_company_created
  on prospects(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_prospects_status
  on prospects(company_id, prospect_status) where deleted_at is null;
create index if not exists idx_prospects_converted_customer
  on prospects(converted_customer_id) where converted_customer_id is not null;

drop trigger if exists trg_prospects_updated_at on prospects;
create trigger trg_prospects_updated_at
  before update on prospects
  for each row execute function set_calculator_updated_at();

alter table prospects enable row level security;

drop policy if exists "prospects_select_super_admin" on prospects;
create policy "prospects_select_super_admin" on prospects
  for select to authenticated using (is_super_admin());

drop policy if exists "prospects_insert_super_admin" on prospects;
create policy "prospects_insert_super_admin" on prospects
  for insert to authenticated with check (is_super_admin());

drop policy if exists "prospects_update_super_admin" on prospects;
create policy "prospects_update_super_admin" on prospects
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ── PHASE 2 (Company-Admin sees own leads) — DO NOT ENABLE YET ──────────────
--   create policy "prospects_select_own_company" on prospects
--     for select to authenticated
--     using (company_id is not null and company_id = current_company_id());
-- (Public writes never come through anon RLS — they go through the service-role
--  Edge Function, so NO anon policy is added here on purpose.)

-- ===========================================================================
-- 2. quote_requests  (one submitted quote + frozen pricing snapshot)
-- ===========================================================================
create table if not exists quote_requests (
  id                              uuid primary key default gen_random_uuid(),
  legacy_id                       text not null unique,
  company_id                      uuid not null references companies(id) on delete cascade,
  company_legacy_id               text not null,

  -- Lead linkage. Normally prospect_id in MVP; customer_id stays null unless the
  -- email already maps to a real customer. Both ON DELETE SET NULL.
  prospect_id                     uuid references prospects(id) on delete set null,
  prospect_legacy_id              text,
  customer_id                     uuid references customers(id) on delete set null,
  customer_legacy_id              text,
  user_id                         uuid,                  -- future portal profile (plain uuid, NO FK)

  -- Convenience links to live config (NOT the source of truth — see snapshot).
  calculator_service_id           uuid references calculator_services(id) on delete set null,
  calculator_service_key          text,                  -- snapshot of the service key
  selected_cleaning_plan_id       uuid references cleaning_plans(id) on delete set null,

  -- ── PRICING SNAPSHOT (frozen at submission; never recomputed) ────────────
  selected_cleaning_plan_name     text,                  -- plan name AS SHOWN
  selected_cleaning_plan_hourly_rate numeric,            -- rate AS CHARGED
  estimated_hours                 numeric,
  calculated_price                numeric,
  min_price                       numeric,
  max_price                       numeric,
  currency                        text not null default 'SEK',
  price_display_mode              text,                  -- how the price was presented
  pricing_model                   text,                  -- which formula ran
  formula_version                 text not null default 'v1',
  -- Full internal calc trace: inputs, selectedPlanSnapshot, every rule value
  -- used, steps[], rawPrice/min/max/estimatedHours (doc 04 trace shape).
  pricing_snapshot_json           jsonb not null default '{}'::jsonb,

  -- Lifecycle.
  status                          text not null default 'submitted',
  source                          text not null default 'price_calculator',
  source_url                      text,

  -- Contact details captured with the request (also denormalised on prospect).
  customer_name                   text,
  customer_email                  text,
  customer_phone                  text,
  address_json                    jsonb not null default '{}'::jsonb,

  valid_until                     timestamptz,
  requires_manual_review          boolean not null default false,
  -- Human-facing quote reference. Left NULL in this slice; a later slice may
  -- allocate it via the existing durable allocate_number() RPC (entity_kind
  -- 'quote_request'). No allocation is wired here.
  reference                       text,

  metadata                        jsonb not null default '{}'::jsonb,

  deleted_at                      timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  -- Full lifecycle vocabulary allowed; MVP uses the first three (doc 05).
  constraint quote_requests_status_check
    check (status in (
      'draft', 'submitted', 'pending_review', 'ready_for_customer',
      'viewed', 'accepted', 'rejected', 'expired', 'converted'
    )),
  -- Exactly one of prospect_id / customer_id should anchor the lead (allow both
  -- null only transiently for a draft).
  constraint quote_requests_anchor_check
    check (status = 'draft' or prospect_id is not null or customer_id is not null)
);

create index if not exists idx_quote_requests_company
  on quote_requests(company_id) where deleted_at is null;
create index if not exists idx_quote_requests_company_created
  on quote_requests(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_quote_requests_company_status
  on quote_requests(company_id, status) where deleted_at is null;
create index if not exists idx_quote_requests_prospect
  on quote_requests(prospect_id) where prospect_id is not null;
create index if not exists idx_quote_requests_customer
  on quote_requests(customer_id) where customer_id is not null;
create index if not exists idx_quote_requests_email
  on quote_requests(company_id, lower(customer_email));

drop trigger if exists trg_quote_requests_updated_at on quote_requests;
create trigger trg_quote_requests_updated_at
  before update on quote_requests
  for each row execute function set_calculator_updated_at();

alter table quote_requests enable row level security;

drop policy if exists "quote_requests_select_super_admin" on quote_requests;
create policy "quote_requests_select_super_admin" on quote_requests
  for select to authenticated using (is_super_admin());

drop policy if exists "quote_requests_insert_super_admin" on quote_requests;
create policy "quote_requests_insert_super_admin" on quote_requests
  for insert to authenticated with check (is_super_admin());

drop policy if exists "quote_requests_update_super_admin" on quote_requests;
create policy "quote_requests_update_super_admin" on quote_requests
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
-- PHASE 2 company-admin read: mirror prospects_select_own_company above.

-- ===========================================================================
-- 3. quote_request_answers  (immutable per-question answer snapshots)
--    company_id is DENORMALISED from the parent so the SAME RLS predicate
--    applies and the Phase-2 company read is a pure policy flip. Append-only:
--    rows are written once with the quote and never updated (no updated_at).
-- ===========================================================================
create table if not exists quote_request_answers (
  id                        uuid primary key default gen_random_uuid(),
  legacy_id                 text not null unique,
  quote_request_id          uuid not null references quote_requests(id) on delete cascade,
  quote_request_legacy_id   text,
  company_id                uuid not null references companies(id) on delete cascade,
  company_legacy_id         text,

  question_key              text not null,
  question_label_snapshot   text,                -- label AS SHOWN at submission
  input_type_snapshot       text,
  answer_value_json         jsonb not null default '{}'::jsonb,
  affects_pricing           boolean not null default true,
  sort_order                integer not null default 0,

  created_at                timestamptz not null default now()
);

create index if not exists idx_quote_request_answers_quote
  on quote_request_answers(quote_request_id);
create index if not exists idx_quote_request_answers_company
  on quote_request_answers(company_id);

alter table quote_request_answers enable row level security;

drop policy if exists "quote_request_answers_select_super_admin" on quote_request_answers;
create policy "quote_request_answers_select_super_admin" on quote_request_answers
  for select to authenticated using (is_super_admin());

drop policy if exists "quote_request_answers_insert_super_admin" on quote_request_answers;
create policy "quote_request_answers_insert_super_admin" on quote_request_answers
  for insert to authenticated with check (is_super_admin());
-- No UPDATE/DELETE policy: answer snapshots are immutable; they cascade-delete
-- only with their parent quote_request. PHASE 2 company read mirrors above.

-- ============================================================================
-- INTENTIONALLY NOT INCLUDED YET (scope guard for this slice)
--   • No anon RLS / no public Edge Function — public submission is the
--     service-role function in Slice 3 (validate → recompute → insert).
--   • No prospect→customer conversion logic and no auth/profile creation. The
--     converted_customer_id / linked_profile_id columns are inert bridges only.
--   • No magic-link / portal login handoff (login prompt copy lives in 0058's
--     content json; the actual auth flow is a later slice).
--   • No quote-number allocation (reference stays NULL until wired to
--     allocate_number()).
--   • No CRM pipeline, assignment, automation, notifications, or dashboard
--     (CRM is preparation-only — fields exist, behaviour does not).
--   • No Company-Admin policies (Phase 2; commented templates above).
--   • No DELETE policies (soft-delete via deleted_at; answers cascade w/ parent).
-- ============================================================================
