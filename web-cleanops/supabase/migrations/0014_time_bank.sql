-- ============================================================================
-- CleanOps — Time Bank Phase 4: TIME BANK WALLETS + APPEND-ONLY TRANSACTIONS
-- ============================================================================
--
-- Adds the persistence foundation for the Time Bank minute ledger:
--   Customer → CustomerAgreement → agreementGroupId → TimeBankWallet
--            → TimeBankTransaction (append-only)
--
-- The Time Bank LOGIC layer (src/lib/data/timeBank.ts) is already built and
-- harness-validated. This migration is the missing PERSISTENCE half — the
-- durable Supabase tables the repository write path targets. It mirrors the
-- proven customers (0007) / work_orders (0008) / customer_agreements (0013)
-- conventions: flat indexed columns for list / scope, plus a lossless
-- `data jsonb` carrying the COMPLETE domain record for detail reconstruction.
--
-- ARCHITECTURE / SCHEMA LOCKED (see Development Center `time_bank`).
--
-- IMPORTANT — FOUNDATION ONLY (no activation):
--   * The app STILL runs on localStorage and Time Bank is NOT wired into any UI,
--     billing, payroll or customer flow. These tables are a SECONDARY shadow
--     copy the future write path / migration utilities populate and verify,
--     exactly like the 0013 customer_agreements wave.
--   * No feature flag, no production-authoritative flip, no customer rollout,
--     no live migration is performed by adding this file.
--
-- LOCKED DECISIONS honoured by this schema:
--   (1) ONE wallet per agreementGroupId        → unique index on agreement_group_id.
--   (2) Wallet binds to agreementGroupId, NEVER a version id → no version column;
--       the binding column is `agreement_group_id` only.
--   (4) Signed INTEGER minutes only             → `minutes integer` + non-zero check.
--   (5) No stored balance                       → there is NO balance column on the
--       wallet; balance is ALWAYS derived from the transaction ledger in code.
--   Append-only ledger                          → time_bank_transactions has NO
--       UPDATE and NO DELETE policy: rows can only be inserted and read. History
--       can never be rewritten or destroyed through normal app paths.
--
-- legacy_id / company_legacy_id:
--   Mirrors the established convention. `legacy_id` is the app-facing id (wallet
--   id / transaction id) and the idempotency key for upserts. `company_legacy_id`
--   is the app-facing company id used by the query-layer scope; the real
--   `company_id uuid` FK is what RLS enforces tenancy against.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE 1 — time_bank_wallets (one per agreement group; NO stored balance)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_bank_wallets (
  id                    uuid primary key default gen_random_uuid(),
  -- App-facing wallet id; migration + idempotency key.
  legacy_id             text unique not null,
  -- BINDING KEY — the stable agreement-group id, NEVER an agreement version id.
  agreement_group_id    text not null,
  -- Real tenant FK used by RLS (matches profiles.company_id / companies.id).
  company_id            uuid references companies(id) on delete cascade,
  -- App-facing company id; used by the query layer scope.
  company_legacy_id     text not null,
  -- App-facing customer id this wallet belongs to (soft reference).
  customer_legacy_id    text not null,
  -- Wallet lifecycle state machine (LOCKED decision 3).
  status                text not null default 'active',
  -- The configurable policy half of the wallet (TimeBankRules).
  rules                 jsonb not null default '{}'::jsonb,
  -- Lossless full TimeBankWallet record for detail reconstruction.
  data                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint time_bank_wallets_status_check
    check (status in ('active', 'frozen', 'closed'))
);

-- LOCKED decision 1: exactly ONE wallet per agreement group.
create unique index if not exists uq_time_bank_wallets_group
  on time_bank_wallets(agreement_group_id);

-- List / scope / lookup indexes (mirror the agreements Wave set).
create index if not exists idx_tbw_company_customer
  on time_bank_wallets(company_id, customer_legacy_id);
create index if not exists idx_tbw_company_status
  on time_bank_wallets(company_id, status);
create index if not exists idx_tbw_companylegacy_customer
  on time_bank_wallets(company_legacy_id, customer_legacy_id);
create index if not exists idx_tbw_companylegacy_status
  on time_bank_wallets(company_legacy_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE 2 — time_bank_transactions (immutable, append-only minute ledger)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists time_bank_transactions (
  id                        uuid primary key default gen_random_uuid(),
  -- App-facing transaction id; migration + idempotency key (dedupes re-runs).
  legacy_id                 text unique not null,
  -- The wallet (legacy_id) this entry belongs to.
  wallet_legacy_id          text not null,
  -- Denormalised binding key — must equal the owning wallet's agreement_group_id.
  agreement_group_id        text not null,
  -- Real tenant FK used by RLS.
  company_id                uuid references companies(id) on delete cascade,
  company_legacy_id         text not null,
  -- Ledger type (governed enum, see LOCKED decision 4).
  type                      text not null,
  -- SIGNED INTEGER minutes only — never floating-point hours, never zero.
  minutes                   integer not null,
  -- Effective instant used for historical balance reproduction (as-of reads).
  effective_at              timestamptz not null,
  -- Audit: who/what created this entry.
  actor_id                  text,
  actor_name                text,
  reason                    text,
  -- Statistics hooks for usage breakdowns / payroll.
  service_category_snapshot text,
  billable                  boolean,
  -- Audit links.
  source_work_order_id      text,
  source_occurrence_id      text,
  source_agreement_version_id text,
  -- Lossless full TimeBankTransaction record.
  data                      jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),

  constraint time_bank_tx_type_check
    check (type in (
      'monthly_refill', 'manual_add', 'manual_remove',
      'visit_consumption', 'cancellation_consumption', 'reschedule_consumption',
      'cancelled_visit_credit',
      'reservation', 'reservation_release', 'correction', 'expiry',
      'opening_balance', 'migration'
    )),
  -- LOCKED decision 4/5: minutes are signed integers and never a no-op zero.
  constraint time_bank_tx_minutes_nonzero
    check (minutes <> 0)
);

-- Ledger reads: chronological per wallet (statements, balance as-of).
create index if not exists idx_tbt_wallet_effective
  on time_bank_transactions(wallet_legacy_id, effective_at);
create index if not exists idx_tbt_group_effective
  on time_bank_transactions(agreement_group_id, effective_at);
create index if not exists idx_tbt_company
  on time_bank_transactions(company_id);
create index if not exists idx_tbt_companylegacy
  on time_bank_transactions(company_legacy_id);
-- Statistics: usage by transaction type within a company.
create index if not exists idx_tbt_company_type
  on time_bank_transactions(company_id, type);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at trigger for wallets (transactions are append-only → no updates)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_time_bank_wallets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_time_bank_wallets_updated_at on time_bank_wallets;
create trigger trg_time_bank_wallets_updated_at
  before update on time_bank_wallets
  for each row
  execute function set_time_bank_wallets_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — company-scoped, mirrors customer_agreements (0013)
--   WALLETS:
--     READ   — own company; super_admin reads all.
--     WRITE  — INSERT/UPDATE within own company; super_admin across companies
--              (lets the in-browser shadow-write utilities populate the copy and
--              flip wallet status without a service-role key).
--     DELETE — no policy → blocked for everyone.
--   TRANSACTIONS (APPEND-ONLY):
--     READ   — own company; super_admin reads all.
--     INSERT — within own company; super_admin across companies.
--     UPDATE — NO policy → blocked for everyone (ledger entries are immutable).
--     DELETE — NO policy → blocked for everyone (history is never destroyed).
-- All checks go through the SECURITY DEFINER helpers current_company_id() /
-- is_super_admin() from 0003 — no recursive-RLS risk, client never trusted.
-- ─────────────────────────────────────────────────────────────────────────
alter table time_bank_wallets enable row level security;
alter table time_bank_transactions enable row level security;

-- time_bank_wallets policies
drop policy if exists "tbw_select_own_company" on time_bank_wallets;
create policy "tbw_select_own_company" on time_bank_wallets
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "tbw_select_super_admin" on time_bank_wallets;
create policy "tbw_select_super_admin" on time_bank_wallets
  for select to authenticated
  using (is_super_admin());

drop policy if exists "tbw_insert_own_company" on time_bank_wallets;
create policy "tbw_insert_own_company" on time_bank_wallets
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "tbw_insert_super_admin" on time_bank_wallets;
create policy "tbw_insert_super_admin" on time_bank_wallets
  for insert to authenticated
  with check (is_super_admin());

drop policy if exists "tbw_update_own_company" on time_bank_wallets;
create policy "tbw_update_own_company" on time_bank_wallets
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "tbw_update_super_admin" on time_bank_wallets;
create policy "tbw_update_super_admin" on time_bank_wallets
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- time_bank_transactions policies — SELECT + INSERT only (append-only ledger)
drop policy if exists "tbt_select_own_company" on time_bank_transactions;
create policy "tbt_select_own_company" on time_bank_transactions
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "tbt_select_super_admin" on time_bank_transactions;
create policy "tbt_select_super_admin" on time_bank_transactions
  for select to authenticated
  using (is_super_admin());

drop policy if exists "tbt_insert_own_company" on time_bank_transactions;
create policy "tbt_insert_own_company" on time_bank_transactions
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "tbt_insert_super_admin" on time_bank_transactions;
create policy "tbt_insert_super_admin" on time_bank_transactions
  for insert to authenticated
  with check (is_super_admin());

-- NOTE: NO update/delete policy on time_bank_transactions on purpose — the
-- minute ledger is immutable and append-only. Corrections are made by INSERTING
-- a new `correction` / `expiry` entry, never by editing or deleting history.
-- NOTE: NO delete policy on time_bank_wallets on purpose — wallets are closed
-- (status flip), never destroyed.
