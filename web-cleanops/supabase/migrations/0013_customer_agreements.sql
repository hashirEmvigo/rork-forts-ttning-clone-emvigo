-- ============================================================================
-- CleanOps — Customer Agreement Phase 1: CUSTOMER AGREEMENT + AGREEMENT LINES
-- ============================================================================
--
-- Introduces the missing COMMERCIAL parent between Customer and operational
-- data:  Customer → CustomerAgreement (versioned header) → CustomerAgreementLine.
-- This is the authoritative commercial source for future Invoice Basis, Time
-- Bank, Pricing Engine and Statistics. Service stays catalog/default data.
--
-- ARCHITECTURE / SCHEMA LOCKED (see Development Center `customer_agreement`).
-- This migration creates ONLY the Phase 1 foundation tables. Explicitly OUT OF
-- SCOPE (no columns/tables here): Time Bank, Invoice Basis, Invoice generation,
-- Agreement Templates, Pricing Engine, RUT, Customer Portal, PayrollBasis.
--
-- IMPORTANT — Phase 1 status (infrastructure only):
--   * The app STILL runs on localStorage. Nothing in the UI reads or writes
--     through these tables yet. Supabase is a SECONDARY shadow copy that the
--     future migration/dual-write utilities will populate and verify, exactly
--     like the customers (0007) and work_orders (0008) waves.
--
-- DATA MODEL DECISION — flat columns + `data jsonb` (mirrors 0007 / 0008):
--   Flat, indexed columns carry everything list / search / RLS / versioning
--   needs; `data jsonb` holds the COMPLETE record for lossless reconstruction.
--
-- VERSIONING STRATEGY (agreementGroupId chain):
--   * `agreement_group_id` groups EVERY version of one logical agreement.
--   * Each version is its own row with its own `legacy_id` (the app-facing
--     agreement id) and an integer `version`.
--   * `supersedes_version_id` / `superseded_by_id` link the chain. Old versions
--     are SUPERSEDED, never overwritten — historical commercial terms are
--     immutable. Exactly one non-terminal version per group is the live one.
--
-- legacy_id / company_legacy_id:
--   Mirrors the customers/work_orders convention. `legacy_id` is the app-facing
--   agreement id; `company_legacy_id` is the app-facing company id. The real
--   `company_id uuid` FK is what RLS enforces tenancy against.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE 1 — customer_agreements (versioned commercial header)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_agreements (
  id                    uuid primary key default gen_random_uuid(),
  -- App-facing agreement id (this specific version); migration key.
  legacy_id             text unique not null,
  -- Groups all versions of one logical agreement (the version chain key).
  agreement_group_id    text not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id            uuid references companies(id) on delete cascade,
  -- App-facing company id; used by the query layer scope.
  company_legacy_id     text not null,
  -- App-facing customer id this agreement belongs to (soft reference).
  customer_legacy_id    text not null,
  -- 1-based version number within the agreement group.
  version               integer not null default 1,
  -- Lifecycle state machine (see CONTRACT 3).
  status                text not null default 'draft',
  -- Header-level commercial model (governed enum, see CONTRACT 1 / REFINEMENT 2).
  billing_model         text not null,
  -- Billing cadence (its own enum, NOT scheduling recurrence — REFINEMENT 1).
  invoice_interval      text not null,
  -- Where this agreement originated (REFINEMENT 4).
  source_type           text not null default 'manual',
  -- Nullable soft reference to the source (template/quote/import). No FK yet.
  source_reference_id   text,
  -- Version chain links (app-facing legacy ids of adjacent versions).
  supersedes_version_id text,
  superseded_by_id      text,
  -- Commercial validity window (ISO dates, stored as text for parity).
  valid_from            text,
  valid_to              text,
  -- Lossless full CustomerAgreement record for detail reconstruction.
  data                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint customer_agreements_status_check
    check (status in ('draft', 'active', 'paused', 'superseded', 'cancelled', 'ended')),
  constraint customer_agreements_billing_model_check
    check (billing_model in ('per_visit', 'monthly_fixed', 'time_bank', 'hybrid')),
  constraint customer_agreements_invoice_interval_check
    check (invoice_interval in (
      'per_visit', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly', 'on_completion'
    )),
  constraint customer_agreements_source_type_check
    check (source_type in ('manual', 'template', 'imported', 'converted_quote')),
  constraint customer_agreements_version_positive
    check (version >= 1)
);

-- Exactly one row per (agreement group, version): the chain is append-only.
create unique index if not exists uq_customer_agreements_group_version
  on customer_agreements(agreement_group_id, version);

-- List / scope / lookup indexes (mirror the customers Wave 1 set).
create index if not exists idx_cust_agr_company_customer
  on customer_agreements(company_id, customer_legacy_id);
create index if not exists idx_cust_agr_company_status
  on customer_agreements(company_id, status);
create index if not exists idx_cust_agr_company_created
  on customer_agreements(company_id, created_at desc);
create index if not exists idx_cust_agr_group
  on customer_agreements(agreement_group_id);
create index if not exists idx_cust_agr_companylegacy_customer
  on customer_agreements(company_legacy_id, customer_legacy_id);
create index if not exists idx_cust_agr_companylegacy_status
  on customer_agreements(company_legacy_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE 2 — customer_agreement_lines (children of one agreement version)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_agreement_lines (
  id                       uuid primary key default gen_random_uuid(),
  -- App-facing line id; migration key.
  legacy_id                text unique not null,
  -- The agreement VERSION (legacy_id) this line belongs to.
  agreement_legacy_id      text not null,
  -- Denormalised version-chain key for group-scoped reads.
  agreement_group_id       text not null,
  -- Real tenant FK used by RLS.
  company_id               uuid references companies(id) on delete cascade,
  company_legacy_id        text not null,
  sort_order               integer not null default 0,
  -- Per-line billing override. CONTRACT 1: only legal when the header
  -- billing_model = 'hybrid'; must be null for all non-hybrid agreements.
  billing_model_override   text,
  -- How this line's price is computed (REFINEMENT 3).
  pricing_model            text not null default 'fixed',
  -- Agreed commercial money column. numeric(12,2) — never floating-point hours.
  agreed_price             numeric(12,2),
  quantity                 numeric(12,2),
  unit                     text,
  vat                      numeric(12,2),
  -- Snapshot of catalog/service values at line creation (never a live link).
  source_service_id        text,
  service_name_snapshot    text not null,
  category_name_snapshot   text,
  category_type_snapshot   text,
  service_basis_type_snapshot text,
  -- Lossless full CustomerAgreementLine record.
  data                     jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint cust_agr_line_billing_override_check
    check (
      billing_model_override is null
      or billing_model_override in ('per_visit', 'monthly_fixed', 'time_bank', 'hybrid')
    ),
  constraint cust_agr_line_pricing_model_check
    check (pricing_model in ('fixed', 'per_unit', 'custom')),
  constraint cust_agr_line_basis_type_check
    check (
      service_basis_type_snapshot is null
      or service_basis_type_snapshot in ('billable', 'non_billable', 'excluded')
    )
);

create index if not exists idx_cust_agr_line_agreement
  on customer_agreement_lines(agreement_legacy_id, sort_order);
create index if not exists idx_cust_agr_line_group
  on customer_agreement_lines(agreement_group_id);
create index if not exists idx_cust_agr_line_company
  on customer_agreement_lines(company_id);
create index if not exists idx_cust_agr_line_companylegacy
  on customer_agreement_lines(company_legacy_id);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse the established pattern)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_customer_agreements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customer_agreements_updated_at on customer_agreements;
create trigger trg_customer_agreements_updated_at
  before update on customer_agreements
  for each row
  execute function set_customer_agreements_updated_at();

drop trigger if exists trg_customer_agreement_lines_updated_at on customer_agreement_lines;
create trigger trg_customer_agreement_lines_updated_at
  before update on customer_agreement_lines
  for each row
  execute function set_customer_agreements_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped, mirrors customers (0007)
--   READ   — own company; super_admin reads all.
--   WRITE  — INSERT/UPDATE within own company; super_admin across companies
--            (lets the in-browser migration/dual-write utilities populate the
--            shadow copy without a service-role key).
--   DELETE — no policy → blocked for everyone (agreements are superseded,
--            never deleted; historical commercial terms stay readable).
-- All checks go through the SECURITY DEFINER helpers current_company_id() /
-- is_super_admin() from 0003 — no recursive-RLS risk, client never trusted.
-- ─────────────────────────────────────────────────────────────────────────
alter table customer_agreements enable row level security;
alter table customer_agreement_lines enable row level security;

-- customer_agreements policies
drop policy if exists "cust_agr_select_own_company" on customer_agreements;
create policy "cust_agr_select_own_company" on customer_agreements
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "cust_agr_select_super_admin" on customer_agreements;
create policy "cust_agr_select_super_admin" on customer_agreements
  for select to authenticated
  using (is_super_admin());

drop policy if exists "cust_agr_insert_own_company" on customer_agreements;
create policy "cust_agr_insert_own_company" on customer_agreements
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "cust_agr_insert_super_admin" on customer_agreements;
create policy "cust_agr_insert_super_admin" on customer_agreements
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "cust_agr_update_own_company" on customer_agreements;
create policy "cust_agr_update_own_company" on customer_agreements
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "cust_agr_update_super_admin" on customer_agreements;
create policy "cust_agr_update_super_admin" on customer_agreements
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- customer_agreement_lines policies
drop policy if exists "cust_agr_line_select_own_company" on customer_agreement_lines;
create policy "cust_agr_line_select_own_company" on customer_agreement_lines
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "cust_agr_line_select_super_admin" on customer_agreement_lines;
create policy "cust_agr_line_select_super_admin" on customer_agreement_lines
  for select to authenticated
  using (is_super_admin());

drop policy if exists "cust_agr_line_insert_own_company" on customer_agreement_lines;
create policy "cust_agr_line_insert_own_company" on customer_agreement_lines
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "cust_agr_line_insert_super_admin" on customer_agreement_lines;
create policy "cust_agr_line_insert_super_admin" on customer_agreement_lines
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "cust_agr_line_update_own_company" on customer_agreement_lines;
create policy "cust_agr_line_update_own_company" on customer_agreement_lines
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "cust_agr_line_update_super_admin" on customer_agreement_lines;
create policy "cust_agr_line_update_super_admin" on customer_agreement_lines
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: no DELETE policy on purpose for either table — agreement deletion stays
-- blocked under RLS; versions are superseded, never destroyed.
