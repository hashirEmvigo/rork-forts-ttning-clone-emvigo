import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationSource = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/0042_remove_service_row_cleans_booking_ledger.sql"),
  "utf8",
);
const ledgerReaderSource = readFileSync(
  path.resolve(__dirname, "./supabaseBookingLedgerRepository.ts"),
  "utf8",
);

describe("BL-1 booking ledger cleanup on service-row removal", () => {
  it("replaces the remove RPC while preserving the protected-history guards", () => {
    expect(migrationSource).toMatch(/create or replace function public\.remove_work_order_service_row/i);
    // Guards still run BEFORE any mutation, so a blocked removal never touches the ledger.
    expect(migrationSource).toMatch(/from public\.time_reports/i);
    expect(migrationSource).toMatch(/from public\.mission_log_entries/i);
    expect(migrationSource).toMatch(/protected time reporting history/i);
    expect(migrationSource).toMatch(/protected execution history/i);
  });

  it("soft-deletes booking_ledger rows for exactly the removed service_row_id, scoped to its company", () => {
    expect(migrationSource).toMatch(/update public\.booking_ledger/i);
    expect(migrationSource).toMatch(/set deleted_at = removed_at/i);
    expect(migrationSource).toMatch(/where company_id = parent_row\.company_id/i);
    expect(migrationSource).toMatch(/and service_row_id = input_service_row_legacy_id/i);
    // Idempotent: only active rows are touched, so re-running never double-processes.
    expect(migrationSource).toMatch(/and deleted_at is null/i);
    // Guarded so environments without booking_ledger still remove service rows safely.
    expect(migrationSource).toMatch(/to_regclass\('public\.booking_ledger'\)/i);
    expect(migrationSource).toMatch(/'removedBookingCount', removed_booking_count/i);
  });

  it("never hard-deletes and never touches the legacy queue or out-of-scope domains", () => {
    expect(migrationSource).not.toMatch(/delete\s+from/i);
    expect(migrationSource).not.toMatch(/from public\.booking_queue/i);
    expect(migrationSource).not.toMatch(/update public\.booking_queue/i);
    expect(migrationSource).not.toMatch(/work_order_occurrence_exceptions/i);
    expect(migrationSource).not.toMatch(/payroll_basis/i);
    expect(migrationSource).not.toMatch(/invoice_basis/i);
    expect(migrationSource).not.toMatch(/localStorage/i);
  });

  it("keeps Booking List excluding soft-deleted ledger rows so removals do not resurrect", () => {
    // The reader filters deleted_at, so soft-deleting on removal hides bookings immediately.
    expect(ledgerReaderSource).toMatch(/filter\(\(row\) => !row\.deleted_at\)/);
    expect(ledgerReaderSource).toMatch(/from\("booking_ledger"\)/);
    expect(ledgerReaderSource).not.toMatch(/booking_queue/i);
  });
});
