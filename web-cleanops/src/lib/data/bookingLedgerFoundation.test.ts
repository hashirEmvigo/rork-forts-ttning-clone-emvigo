import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationSource = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/0040_booking_ledger_foundation.sql"),
  "utf8",
);
const repositorySource = readFileSync(
  path.resolve(__dirname, "./supabaseBookingLedgerRepository.ts"),
  "utf8",
);
const bookingListPageSource = readFileSync(
  path.resolve(__dirname, "../../pages/admin/BookingList.tsx"),
  "utf8",
);

describe("BL-1 booking ledger foundation", () => {
  it("adds a new generated-booking ledger table, not an extension of legacy booking_queue", () => {
    expect(migrationSource).toMatch(/create table if not exists booking_ledger/i);
    expect(migrationSource).toMatch(/booking_id\s+text unique not null/i);
    expect(migrationSource).toMatch(/booking_series_id\s+text not null/i);
    expect(migrationSource).toMatch(/company_id\s+uuid references companies\(id\)/i);
    expect(migrationSource).toMatch(/customer_id\s+text not null/i);
    expect(migrationSource).toMatch(/work_order_id\s+text not null/i);
    expect(migrationSource).toMatch(/service_row_id\s+text not null/i);
    expect(migrationSource).toMatch(/booking_date\s+text not null/i);
    expect(migrationSource).toMatch(/planned_start_time\s+text/i);
    expect(migrationSource).toMatch(/planned_end_time\s+text/i);
    expect(migrationSource).not.toMatch(/alter table\s+booking_queue/i);
    expect(migrationSource).not.toMatch(/insert into public\.booking_queue/i);
    expect(migrationSource).not.toMatch(/update public\.booking_queue/i);
  });

  it("sets the required status defaults on every generated booking", () => {
    expect(migrationSource).toMatch(/booking_status\s+text not null default 'scheduled'/i);
    expect(migrationSource).toMatch(/planning_status\s+text not null default 'unplanned'/i);
    expect(migrationSource).toMatch(/execution_status\s+text not null default 'not_started'/i);
    expect(migrationSource).toMatch(/billing_status\s+text not null default 'not_ready'/i);
    expect(migrationSource).toMatch(/payroll_status\s+text not null default 'not_ready'/i);
    expect(migrationSource).toMatch(/'bookingStatus', 'scheduled'/);
    expect(migrationSource).toMatch(/'planningStatus', 'unplanned'/);
    expect(migrationSource).toMatch(/'executionStatus', 'not_started'/);
    expect(migrationSource).toMatch(/'billingStatus', 'not_ready'/);
    expect(migrationSource).toMatch(/'payrollStatus', 'not_ready'/);
  });

  it("generates one-time and recurring bookings with unique booking IDs and a shared series ID", () => {
    expect(migrationSource).toMatch(/if recurrence_interval = 'one_time' then\s+upper_date := service_start_date;/i);
    expect(migrationSource).toMatch(/exit when recurrence_interval = 'one_time'/i);
    expect(migrationSource).toMatch(/when 'weekly' then step_days := 7/i);
    expect(migrationSource).toMatch(/when 'every_2_weeks' then step_days := 14/i);
    expect(migrationSource).toMatch(/when 'monthly' then step_months := 1/i);
    expect(migrationSource).toMatch(/booking_series_id := 'bks_' \|\| substr\(md5\(input_work_order_id \|\| ':' \|\| row_legacy_id\), 1, 24\)/i);
    expect(migrationSource).toMatch(/booking_id := 'bkg_' \|\| substr\(md5\(row_legacy_id \|\| ':' \|\| occurrence_date::text\), 1, 24\)/i);
    expect(migrationSource).toMatch(/insert into public\.booking_ledger/i);
  });

  it("respects Booking Generation Horizon, service end date, and duplicate protection", () => {
    expect(migrationSource).toMatch(/data ->> 'bookingGenerationHorizonMonths'/i);
    expect(migrationSource).toMatch(/horizon_months integer := 6/i);
    expect(migrationSource).toMatch(/horizon_end := \(current_date \+ make_interval\(months => horizon_months\)\)::date/i);
    expect(migrationSource).toMatch(/upper_date := least\(horizon_end, service_end_date\)/i);
    expect(migrationSource).toMatch(/unique \(company_id, service_row_id, booking_date\)/i);
    expect(migrationSource).toMatch(/on conflict \(company_id, service_row_id, booking_date\) do nothing/i);
  });

  it("wires AO service-row creation to generated bookings transactionally", () => {
    expect(migrationSource).toMatch(/create or replace function public\.add_work_order_service_row/i);
    expect(migrationSource).toMatch(/generated_booking_count := public\.generate_booking_ledger_for_service_row/i);
    expect(migrationSource).toMatch(/if generated_booking_count < 1 then/i);
    expect(migrationSource).toMatch(/'generatedBookingCount', generated_booking_count/i);
  });

  it("keeps the new Booking List reader on booking_ledger without localStorage or legacy queue fallback", () => {
    expect(repositorySource).toMatch(/from\("booking_ledger"\)/);
    expect(repositorySource).not.toMatch(/booking_queue/i);
    expect(repositorySource).not.toMatch(/localStorage/i);
    expect(repositorySource).not.toMatch(/sessionStorage/i);
    expect(repositorySource).not.toMatch(/fallback/i);
    expect(bookingListPageSource).toMatch(/listBookingLedgerEntriesFromSupabase/);
    expect(bookingListPageSource).not.toMatch(/BookingQueueItem/);
    expect(bookingListPageSource).not.toMatch(/getBookingQueue/);
  });
});
