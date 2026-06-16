import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BookingQueueItem } from "@/types";

const mocks = vi.hoisted(() => ({
  listFullBookingQueueFromSupabase: vi.fn(),
  shadowReadBookingQueue: vi.fn(),
  shouldReadBookingQueueFromSupabase: vi.fn(),
  shouldUseBookingQueueLocalBackoutBridge: vi.fn(),
  recordBookingQueueSupabaseRead: vi.fn(),
  recordBookingQueueReadFallback: vi.fn(),
  recordBookingQueueUnsafeEmpty: vi.fn(),
  recordBookingQueueShadowDrift: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
}));

vi.mock("@/lib/data/supabaseBookingQueueRepository", () => ({
  listFullBookingQueueFromSupabase: mocks.listFullBookingQueueFromSupabase,
}));

vi.mock("@/lib/data/bookingQueueMigration", () => ({
  shadowReadBookingQueue: mocks.shadowReadBookingQueue,
}));

vi.mock("@/lib/data/bookingQueueCutover", () => ({
  shouldReadBookingQueueFromSupabase: mocks.shouldReadBookingQueueFromSupabase,
  shouldUseBookingQueueLocalBackoutBridge: mocks.shouldUseBookingQueueLocalBackoutBridge,
  recordBookingQueueSupabaseRead: mocks.recordBookingQueueSupabaseRead,
  recordBookingQueueReadFallback: mocks.recordBookingQueueReadFallback,
  recordBookingQueueUnsafeEmpty: mocks.recordBookingQueueUnsafeEmpty,
  recordBookingQueueShadowDrift: mocks.recordBookingQueueShadowDrift,
}));

import { bumpBookingQueueDirectoryRefreshAfterSuccessfulMirror } from "@/lib/data/bookingQueueDirectoryRefresh";
import { useBookingQueueDirectorySource } from "./use-booking-queue-directory-source";

const COMPANY = "cmp_nordlys";

function queueItem(id: string, overrides: Partial<BookingQueueItem> = {}): BookingQueueItem {
  return {
    id,
    companyId: COMPANY,
    workOrderId: `wo_${id}`,
    workOrderNumber: "WO-1001",
    serviceRowId: `row_${id}`,
    customerId: `cust_${id}`,
    customerName: "Acme",
    serviceName: "Hemstädning",
    serviceDate: "2026-06-08",
    assignmentStatus: "unassigned",
    scheduleStatus: "unscheduled",
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldReadBookingQueueFromSupabase.mockReturnValue(true);
  mocks.shouldUseBookingQueueLocalBackoutBridge.mockReturnValue(false);
  mocks.shadowReadBookingQueue.mockResolvedValue({ ok: true, notes: [] });
});

describe("useBookingQueueDirectorySource", () => {
  it("serves non-empty Supabase queue reads directly", async () => {
    const local = [queueItem("local")];
    const remote = [queueItem("remote")];
    mocks.listFullBookingQueueFromSupabase.mockResolvedValue(remote);

    const { result } = renderHook(() =>
      useBookingQueueDirectorySource({ localItems: local, companyId: COMPANY }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.listFullBookingQueueFromSupabase).toHaveBeenCalledWith(COMPANY);
    expect(result.current.source).toBe("supabase");
    expect(result.current.items).toEqual(remote);
    expect(result.current.readStatus).toBe("supabase_non_empty");
    expect(result.current.localBackoutVisible).toBe(false);
    expect(mocks.recordBookingQueueSupabaseRead).toHaveBeenCalledTimes(1);
    expect(mocks.recordBookingQueueUnsafeEmpty).not.toHaveBeenCalled();
  });

  it("treats a clean successful empty Supabase read as authoritative even when local backout data exists", async () => {
    const dirtyBrowserLocal = [queueItem("stale_local")];
    mocks.listFullBookingQueueFromSupabase.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBookingQueueDirectorySource({ localItems: dirtyBrowserLocal, companyId: COMPANY }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("supabase");
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.readStatus).toBe("supabase_empty_authoritative");
    expect(result.current.localBackoutVisible).toBe(false);
    expect(mocks.recordBookingQueueSupabaseRead).toHaveBeenCalledTimes(1);
    expect(mocks.recordBookingQueueUnsafeEmpty).not.toHaveBeenCalled();
    expect(mocks.recordBookingQueueReadFallback).not.toHaveBeenCalled();
  });

  it("keeps the local backout queue on Supabase read errors and records fallback telemetry", async () => {
    const local = [queueItem("local")];
    mocks.listFullBookingQueueFromSupabase.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useBookingQueueDirectorySource({ localItems: local, companyId: COMPANY }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("local");
    expect(result.current.items).toEqual(local);
    expect(result.current.error).toBe("network down");
    expect(result.current.readStatus).toBe("supabase_read_error");
    expect(result.current.localBackoutVisible).toBe(true);
    expect(mocks.recordBookingQueueReadFallback).toHaveBeenCalledWith(COMPANY, "network down");
  });

  it("keeps the local backout queue on explicit unsafe-empty bridge reads only when flagged", async () => {
    const local = [queueItem("local")];
    mocks.shouldUseBookingQueueLocalBackoutBridge.mockReturnValue(true);
    mocks.listFullBookingQueueFromSupabase.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBookingQueueDirectorySource({ localItems: local, companyId: COMPANY }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("local");
    expect(result.current.items).toEqual(local);
    expect(result.current.error).toBeNull();
    expect(result.current.readStatus).toBe("supabase_read_unsafe_empty");
    expect(result.current.localBackoutVisible).toBe(true);
    expect(mocks.recordBookingQueueUnsafeEmpty).toHaveBeenCalledWith(COMPANY);
    expect(mocks.recordBookingQueueSupabaseRead).not.toHaveBeenCalled();
  });

  it("allows an empty Supabase queue when there is no local backout data", async () => {
    mocks.listFullBookingQueueFromSupabase.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBookingQueueDirectorySource({ localItems: [], companyId: COMPANY }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("supabase");
    expect(result.current.items).toEqual([]);
    expect(result.current.readStatus).toBe("supabase_empty_authoritative");
    expect(result.current.localBackoutVisible).toBe(false);
    expect(mocks.recordBookingQueueSupabaseRead).toHaveBeenCalledTimes(1);
    expect(mocks.recordBookingQueueUnsafeEmpty).not.toHaveBeenCalled();
  });

  it("refetches the Supabase queue after a successful mirror write only", async () => {
    const first = [queueItem("remote_1")];
    const second = [queueItem("remote_2")];
    mocks.listFullBookingQueueFromSupabase
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const { result } = renderHook(() =>
      useBookingQueueDirectorySource({ localItems: [], companyId: COMPANY }),
    );

    await waitFor(() => expect(result.current.items).toEqual(first));

    act(() => {
      bumpBookingQueueDirectoryRefreshAfterSuccessfulMirror({ ok: false });
    });

    expect(mocks.listFullBookingQueueFromSupabase).toHaveBeenCalledTimes(1);

    act(() => {
      bumpBookingQueueDirectoryRefreshAfterSuccessfulMirror({ ok: true });
    });

    await waitFor(() => expect(mocks.listFullBookingQueueFromSupabase).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.items).toEqual(second));
  });
});
