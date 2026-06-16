import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mocks.from,
  },
}));

vi.mock("@/lib/perf", () => ({
  perf: {
    start: mocks.start,
  },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

import { listBookingLedgerEntriesFromSupabase } from "./supabaseBookingLedgerRepository";

function queryWithRows(rows: unknown[]) {
  const query = {
    data: rows,
    error: null,
    select: mocks.select,
    eq: mocks.eq,
    order: mocks.order,
  };
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  return query;
}

describe("Booking Ledger Supabase repository", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.stop.mockReturnValue(undefined);
    mocks.start.mockReturnValue(mocks.stop);
    mocks.from.mockImplementation((table: string) => {
      if (table !== "booking_ledger") throw new Error(`Unexpected table ${table}`);
      return { select: mocks.select };
    });
  });

  it("reads generated bookings from booking_ledger, not legacy booking_queue", async () => {
    queryWithRows([
      {
        booking_id: "bkg_1",
        booking_series_id: "bks_1",
        company_legacy_id: "cmp_demo",
        customer_id: "cust_demo",
        work_order_id: "wo_demo",
        service_row_id: "worow_demo",
        booking_date: "2026-06-10",
        planned_start_time: "09:00",
        planned_end_time: "11:00",
        booking_status: "scheduled",
        planning_status: "unplanned",
        execution_status: "not_started",
        billing_status: "not_ready",
        payroll_status: "not_ready",
        deleted_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      {
        booking_id: "bkg_deleted",
        booking_series_id: "bks_deleted",
        company_legacy_id: "cmp_demo",
        customer_id: "cust_demo",
        work_order_id: "wo_demo",
        service_row_id: "worow_demo",
        booking_date: "2026-06-17",
        planned_start_time: null,
        planned_end_time: null,
        booking_status: "scheduled",
        planning_status: "unplanned",
        execution_status: "not_started",
        billing_status: "not_ready",
        payroll_status: "not_ready",
        deleted_at: "2026-06-02T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
      },
    ]);

    const result = await listBookingLedgerEntriesFromSupabase("cmp_demo");

    expect(mocks.from).toHaveBeenCalledWith("booking_ledger");
    expect(mocks.from).not.toHaveBeenCalledWith("booking_queue");
    expect(mocks.eq).toHaveBeenCalledWith("company_legacy_id", "cmp_demo");
    expect(mocks.order).toHaveBeenCalledWith("booking_date", { ascending: true });
    expect(mocks.order).toHaveBeenCalledWith("planned_start_time", { ascending: true });
    expect(result).toEqual([
      {
        bookingId: "bkg_1",
        bookingSeriesId: "bks_1",
        companyId: "cmp_demo",
        customerId: "cust_demo",
        workOrderId: "wo_demo",
        serviceRowId: "worow_demo",
        bookingDate: "2026-06-10",
        plannedStartTime: "09:00",
        plannedEndTime: "11:00",
        bookingStatus: "scheduled",
        planningStatus: "unplanned",
        executionStatus: "not_started",
        billingStatus: "not_ready",
        payrollStatus: "not_ready",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("does not use browser storage, local fallback, or the legacy booking_queue table", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const source = readFileSync(path.resolve(__dirname, "./supabaseBookingLedgerRepository.ts"), "utf8");

    expect(source).not.toMatch(/localStorage/i);
    expect(source).not.toMatch(/sessionStorage/i);
    expect(source).not.toMatch(/fallback/i);
    expect(source).not.toMatch(/booking_queue/i);
  });
});
