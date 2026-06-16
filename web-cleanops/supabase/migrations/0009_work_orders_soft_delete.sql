-- ============================================================================
-- CleanOps — P5I WO-5.6: WORK ORDER removal / soft-delete propagation
-- ============================================================================
--
-- The WO-5.5 staging soak surfaced ONE blocker before the WO-6 authoritative
-- cut-over: removed local rows were never removed from the Supabase mirror. The
-- dual-write mirror only UPSERTS created/updated rows, so a deleted work order /
-- dropped service row / removed occurrence exception could linger in Supabase
-- as a STALE row — and stale service rows / exceptions are schedule-critical:
-- they create ghost occurrences, stale cancellations and stale reschedules.
--
-- FIX STRATEGY — soft delete (mirrors the customers convention: never hard
-- delete; RLS already blocks DELETE for everyone). A nullable `deleted_at`
-- timestamp marks a row as removed. Read paths (and therefore shadow-read +
-- schedule reconstruction) filter `deleted_at is null`, so a soft-deleted row
-- disappears from every active / schedule-critical query while history is kept.
--
-- RE-CREATE / RESTORE — the dual-write upsert builders now always write
-- `deleted_at = null`, so re-creating or reactivating a row (same legacy_id)
-- atomically UNDELETES it. Removal propagation only ever sets `deleted_at` for
-- ids that are present-before / absent-after a write.
--
-- No data is migrated and no behaviour changes here: this only adds the column
-- + supporting partial indexes. localStorage remains authoritative; the Schedule
-- resolver is untouched.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add nullable soft-delete marker to all three Work Order tables
-- ─────────────────────────────────────────────────────────────────────────
alter table work_orders                      add column if not exists deleted_at timestamptz;
alter table work_order_service_rows          add column if not exists deleted_at timestamptz;
alter table work_order_occurrence_exceptions add column if not exists deleted_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Partial indexes for the active-row fast path (deleted_at is null)
--    Active reads dominate; partial indexes keep them lean and let removed rows
--    sit out of the hot path without bloating the index.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_work_orders_active
  on work_orders(company_id, status)
  where deleted_at is null;

create index if not exists idx_wo_rows_active
  on work_order_service_rows(company_id, work_order_legacy_id)
  where deleted_at is null;

create index if not exists idx_wo_exceptions_active
  on work_order_occurrence_exceptions(company_id, occurrence_key)
  where deleted_at is null;

-- NOTE: still no DELETE policy on purpose — removal is an UPDATE that sets
-- `deleted_at`, which the existing per-company / super_admin UPDATE policies
-- already authorise. Hard delete stays blocked under RLS for all three tables.
