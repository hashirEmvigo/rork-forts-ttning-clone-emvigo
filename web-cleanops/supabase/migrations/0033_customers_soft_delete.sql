-- ============================================================================
-- CleanOps — Customer removal / soft-delete propagation
-- ============================================================================
--
-- BUG CONTEXT — customer delete divergence under CUSTOMERS_SUPABASE_AUTHORITATIVE:
-- the dual-write mirror only ever UPSERTS created/updated rows, so a customer
-- deleted locally was never removed from the Supabase mirror. Once reads became
-- Supabase-primary, the stale row kept reappearing in the list/detail after a
-- navigation/reconciliation, and a second delete failed with "customer not
-- found" because the local source no longer held the record.
--
-- FIX STRATEGY — soft delete (mirrors the work_orders 0009 / employees 0010
-- convention: never hard delete; RLS already blocks DELETE for everyone). A
-- nullable `deleted_at` timestamp marks a row as removed. Read paths filter
-- `deleted_at is null`, so a soft-deleted customer disappears from every active
-- query while history is preserved.
--
-- RE-CREATE / RESTORE — the upsert builders now always write `deleted_at = null`,
-- so re-creating or reactivating a customer (same legacy_id) atomically UNDELETES
-- it. Removal propagation only ever sets `deleted_at` for ids present-before /
-- absent-after a write.
--
-- ARCHIVE is unaffected: archiving stays a `status`/`archivedAt` UPDATE, NOT a
-- soft delete — an archived customer keeps `deleted_at is null` and remains
-- visible (filtered by status, not by deletion).
--
-- No data is migrated and no behaviour changes here: this only adds the column +
-- supporting partial index. localStorage remains authoritative.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add nullable soft-delete marker to customers
-- ─────────────────────────────────────────────────────────────────────────
alter table customers add column if not exists deleted_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Partial index for the active-row fast path (deleted_at is null)
--    Active reads dominate; the partial index keeps them lean and lets removed
--    rows sit out of the hot path without bloating the index.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_customers_active
  on customers(company_legacy_id, created_at desc)
  where deleted_at is null;

-- NOTE: still no DELETE policy on purpose — removal is an UPDATE that stamps
-- `deleted_at`, which the existing per-company / super_admin UPDATE policies
-- (0007) already authorise. Hard delete stays blocked under RLS.
