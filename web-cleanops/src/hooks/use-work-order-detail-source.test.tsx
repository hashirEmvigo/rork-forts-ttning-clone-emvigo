import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkOrder } from "@/types";

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  shadowReadWorkOrderDetail: vi.fn(),
  shouldReadWorkOrderDetailFromSupabase: vi.fn(),
  isWorkOrderSupabaseAuthoritative: vi.fn(),
  recordWorkOrderCutoverRead: vi.fn(),
  recordWorkOrderCutoverFailure: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock("@/lib/data", () => ({
  supabaseWorkOrderRepository: {
    getDetail: mocks.getDetail,
  },
  shadowReadWorkOrderDetail: mocks.shadowReadWorkOrderDetail,
  shouldReadWorkOrderDetailFromSupabase: mocks.shouldReadWorkOrderDetailFromSupabase,
  isWorkOrderSupabaseAuthoritative: mocks.isWorkOrderSupabaseAuthoritative,
  recordWorkOrderCutoverRead: mocks.recordWorkOrderCutoverRead,
  recordWorkOrderCutoverFailure: mocks.recordWorkOrderCutoverFailure,
}));

vi.mock("@/lib/data/workOrderDirectoryRefresh", () => ({
  getWorkOrderDirectoryRefreshVersion: vi.fn(() => 0),
  subscribeWorkOrderDirectoryRefresh: vi.fn(() => () => undefined),
}));

import { useWorkOrderDetailSource } from "./use-work-order-detail-source";

const order: WorkOrder = {
  id: "wo_supabase_only",
  companyId: "cmp_stad",
  customerId: "cust_1",
  number: "WO-1007",
  title: "Supabase AO",
  status: "draft",
  notes: [],
  serviceRows: [],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T10:00:00.000Z",
  updatedAt: "2026-06-05T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldReadWorkOrderDetailFromSupabase.mockReturnValue(false);
  mocks.isWorkOrderSupabaseAuthoritative.mockReturnValue(false);
  mocks.getDetail.mockResolvedValue(order);
  mocks.shadowReadWorkOrderDetail.mockResolvedValue({ ok: true, notes: [] });
});

describe("CORE-WRITES-WORKORDERS-A1.1.1 useWorkOrderDetailSource", () => {
  it("opens a Supabase-created AO without requiring a local detail copy", async () => {
    const { result } = renderHook(() =>
      useWorkOrderDetailSource(null, "wo_supabase_only", "cmp_stad"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.getDetail).toHaveBeenCalledWith("wo_supabase_only", {
      companyId: "cmp_stad",
    });
    expect(result.current.source).toBe("supabase");
    expect(result.current.workOrder).toEqual(order);
  });

  it("uses company-scoped detail reads for Company Admin users", async () => {
    renderHook(() => useWorkOrderDetailSource(null, "wo_1", "cmp_company_admin"));

    await waitFor(() => expect(mocks.getDetail).toHaveBeenCalledTimes(1));

    expect(mocks.getDetail).toHaveBeenCalledWith("wo_1", {
      companyId: "cmp_company_admin",
    });
  });

  it("uses an unscoped RLS-visible detail read for Super Admin users", async () => {
    renderHook(() => useWorkOrderDetailSource(null, "wo_1", undefined));

    await waitFor(() => expect(mocks.getDetail).toHaveBeenCalledTimes(1));

    expect(mocks.getDetail).toHaveBeenCalledWith("wo_1", {
      companyId: undefined,
    });
  });

  it("fails closed when a non-super-admin company scope is missing", async () => {
    const { result } = renderHook(() => useWorkOrderDetailSource(null, "wo_1", null));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.getDetail).not.toHaveBeenCalled();
    expect(result.current.workOrder).toBeNull();
    expect(result.current.error).toMatch(/company scope/i);
  });

  it("renders missing or RLS-filtered rows as unavailable without local fallback", async () => {
    const staleLocal = { ...order, id: "wo_missing" };
    mocks.shouldReadWorkOrderDetailFromSupabase.mockReturnValue(true);
    mocks.getDetail.mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useWorkOrderDetailSource(staleLocal, "wo_missing", "cmp_stad"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("supabase");
    expect(result.current.workOrder).toBeNull();
  });

  it("keeps the existing local path when a local copy exists and Supabase detail read is not enabled", () => {
    const { result } = renderHook(() => useWorkOrderDetailSource(order, "wo_1", "cmp_stad"));

    expect(result.current.source).toBe("local");
    expect(result.current.workOrder).toEqual(order);
    expect(mocks.getDetail).not.toHaveBeenCalled();
  });
});
