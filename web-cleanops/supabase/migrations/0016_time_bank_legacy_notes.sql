-- ============================================================================
-- CleanOps — Time Bank Phase 11: OPENING BALANCE & LEGACY HISTORY NOTES
-- ============================================================================
--
-- Migration/onboarding support for customers moving INTO CleanOps. It records
-- two STRICTLY SEPARATED concepts:
--
--   1. OPENING BALANCE — handled by the EXISTING time_bank_transactions table as
--      a dedicated `opening_balance` ledger type (added to that table's type
--      CHECK in 0014). It affects the wallet balance like any ledger entry, is
--      append-only/immutable, and is expected AT MOST ONCE per wallet.
--
--   2. LEGACY HISTORY NOTES — INFORMATIONAL ONLY. This file adds a NEW table,
--      time_bank_legacy_notes, for free-text historical summaries carried over
--      from a legacy system ("Customer previously accumulated 8 hours", "3 hours
--      used during March 2025"). These rows NEVER affect any balance: there is
--      deliberately NO `minutes` column and notes are NOT part of the ledger.
--
-- BALANCE SAFETY (LOCKED): only time_bank_transactions move a wallet's balance.
-- A legacy note can never participate in balance, statements, warnings, refill,
-- expiry or carryover — it is reference text for admin/audit views only.
--
-- IMPORTANT — FOUNDATION ONLY (no activation):
--   * The app STILL runs on localStorage; Time Bank is NOT wired into any UI,
--     billing, payroll or customer flow. This table is a SECONDARY shadow copy a
--     future import/onboarding utility populates, exactly like the 0014 wave.
--   * No feature flag, no production-authoritative flip, no customer rollout and
--     NO real customer data import is performed by adding this file.
--
-- Conventions mirror 0014: legacy_id (app-facing id + idempotency key),
-- company_legacy_id query scope, real company_id uuid FK for RLS, flat columns
-- + a lossless `data jsonb`. RLS mirrors time_bank_transactions: company-scoped
-- SELECT + INSERT only (no UPDATE / DELETE) so imported history can never be
-- silently rewritten or destroyed through normal app paths.
-- ============================================================================

create table if not exists time_bank_legacy_notes (
  id                  uuid primary key default gen_random_uuid(),
  -- App-facing note id; import + idempotency key (dedupes re-runs).
  legacy_id           text unique not null,
  -- The wallet (legacy_id) this informational note is attached to.
  wallet_legacy_id    text not null,
  -- Denormalised binding key — must equal the owning wallet's agreement_group_id.
  agreement_group_id  text not null,
  -- Real tenant FK used by RLS.
  company_id          uuid references companies(id) on delete cascade,
  company_legacy_id   text not null,
  -- Free-text, multiline historical summary pasted/imported from the legacy system.
  note                text not null,
  -- Audit metadata (all optional).
  imported_by         text,
  imported_at         timestamptz,
  source_system       text,
  -- Lossless full TimeBankLegacyHistoryNote record (incl. future attachments).
  data                jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()

  -- NOTE: there is deliberately NO `minutes` column — a legacy note can NEVER
  -- affect a wallet's balance. Only time_bank_transactions move the balance.
);

-- List / scope indexes.
create index if not exists idx_tbln_wallet_created
  on time_bank_legacy_notes(wallet_legacy_id, created_at);
create index if not exists idx_tbln_group
  on time_bank_legacy_notes(agreement_group_id);
create index if not exists idx_tbln_company
  on time_bank_legacy_notes(company_id);
create index if not exists idx_tbln_companylegacy
  on time_bank_legacy_notes(company_legacy_id);

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped, SELECT + INSERT only (append-only).
--   READ   — own company; super_admin reads all.
--   INSERT — within own company; super_admin across companies.
--   UPDATE — NO policy → blocked for everyone (imported history is immutable).
--   DELETE — NO policy → blocked for everyone (history is never destroyed).
-- All checks go through the SECURITY DEFINER helpers current_company_id() /
-- is_super_admin() from 0003.
-- ─────────────────────────────────────────────────────────────────────────
alter table time_bank_legacy_notes enable row level security;

drop policy if exists "tbln_select_own_company" on time_bank_legacy_notes;
create policy "tbln_select_own_company" on time_bank_legacy_notes
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "tbln_select_super_admin" on time_bank_legacy_notes;
create policy "tbln_select_super_admin" on time_bank_legacy_notes
  for select to authenticated
  using (is_super_admin());

drop policy if exists "tbln_insert_own_company" on time_bank_legacy_notes;
create policy "tbln_insert_own_company" on time_bank_legacy_notes
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "tbln_insert_super_admin" on time_bank_legacy_notes;
create policy "tbln_insert_super_admin" on time_bank_legacy_notes
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: NO update/delete policy on purpose — imported informational history is
-- append-only and immutable, mirroring the time_bank_transactions ledger.
