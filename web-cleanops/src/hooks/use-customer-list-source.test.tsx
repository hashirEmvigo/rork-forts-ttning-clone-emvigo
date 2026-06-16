import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * Customer list read-seam hook — optimistic delete tombstone coverage.
 *
 * Proves a just-deleted customer is suppressed from the rendered list
 * immediately (even while Supabase, authoritative, still returns it), that the
 * tombstone clearing restores normal read behaviour, that unrelated remote-only
 * customers are never hidden, that the create-race append still works, and that
 * no duplicate rows are produced.
 *
 * The Supabase repository read / shadow comparator / decision helper are mocked;
 * the REAL session tombstone store is exercised so we assert against live state.
 */

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock("@/lib/data", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/data");
  return {
    ...actual,
    shouldReadListFromSupabase: vi.fn(() => true),
    isCustomerSupabaseAuthoritative: vi.fn(() => true),
    listFullCustomersFromSupabase: vi.fn(),
    shadowReadCustomers: vi.fn(),
    recordCutoverRead: vi.fn(),
    recordCutoverFailure: vi.fn(),
  };
});

import type { Customer } from "@/types";
import {
  listFullCustomersFromSupabase,
  shadowReadCustomers,
  shouldReadListFromSupabase,
  addCustomerDeleteTombstone,
  clearCustomerDeleteTombstones,
  getCustomerDeleteTombstones,
  bumpCustomerListReconcile,
  __resetCustomerDeleteTombstones,
  addCustomerPendingCreate,
  getCustomerPendingCreates,
  __resetCustomerPendingCreates,
} from "@/lib/data";
import { bumpCustomerDirectoryRefresh } from "@/lib/data/customerDirectoryRefresh";
import { useCustomerListSource } from "./use-customer-list-source";

function cus(id: string, companyId = "A"): Customer {
  return { id, companyId, name: id, customerNumber: id, status: "active" } as unknown as Customer;
}

function archivedCus(id: string, companyId = "A"): Customer {
  return {
    id,
    companyId,
    name: id,
    customerNumber: id,
    status: "archived",
    archivedAt: "2026-06-05T00:00:00.000Z",
  } as unknown as Customer;
}

/** Customer carrying a status + updatedAt, for mirror-window overlay tests. */
function cusAt(
  id: string,
  updatedAt: string,
  status: "active" | "inactive",
  companyId = "A",
): Customer {
  return {
    id,
    companyId,
    name: id,
    customerNumber: id,
    status,
    updatedAt,
  } as unknown as Customer;
}

const listMock = vi.mocked(listFullCustomersFromSupabase);
const shadowMock = vi.mocked(shadowReadCustomers);
const enabledMock = vi.mocked(shouldReadListFromSupabase);

beforeEach(() => {
  __resetCustomerDeleteTombstones();
  __resetCustomerPendingCreates();
  listMock.mockReset();
  shadowMock.mockReset();
  enabledMock.mockReset();
  enabledMock.mockReturnValue(true);
  listMock.mockResolvedValue([]);
  shadowMock.mockResolvedValue({ ok: true, notes: [] } as never);
});

afterEach(() => {
  __resetCustomerDeleteTombstones();
  __resetCustomerPendingCreates();
});

describe("useCustomerListSource · optimistic delete tombstone", () => {
  it("hides a deleted customer immediately even if Supabase still returns it", async () => {
    const remote = [cus("cus_1"), cus("cus_2")];
    listMock.mockResolvedValue(remote);

    const { result } = renderHook(() => useCustomerListSource([], "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1", "cus_2"]);

    act(() => addCustomerDeleteTombstone("cus_1"));

    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]);
  });

  it("restores normal reads after the tombstone clears (deleted_at filtering takes over)", async () => {
    // After the soft-delete mirror lands, Supabase no longer returns cus_1.
    listMock.mockResolvedValue([cus("cus_2")]);

    const { result } = renderHook(() => useCustomerListSource([], "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    act(() => addCustomerDeleteTombstone("cus_1"));
    act(() => clearCustomerDeleteTombstones(["cus_1"]));

    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]);
  });

  it("never hides unrelated remote-only customers", async () => {
    const remote = [cus("cus_1"), cus("cus_2")];
    listMock.mockResolvedValue(remote);

    const { result } = renderHook(() => useCustomerListSource([], "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    act(() => addCustomerDeleteTombstone("cus_unrelated"));

    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1", "cus_2"]);
  });

  it("does not append pending local-create rows under Supabase-authoritative reads", async () => {
    listMock.mockResolvedValue([cus("cus_1")]);
    const local = [cus("cus_1"), cus("cus_new")];
    act(() => addCustomerPendingCreate("cus_new"));

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1"]);
  });

  it("drops a stale local-only row that is NOT pending-create (cross-browser delete)", async () => {
    // Browser 2 scenario: a successful, non-empty authoritative read omits a row
    // another browser soft-deleted. The row still sits in this browser's local
    // store but is not pending-create, so it must be treated as stale and dropped.
    listMock.mockResolvedValue([cus("cus_1")]);
    const local = [cus("cus_1"), cus("cus_deleted_elsewhere")];

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1"]);
  });

  it("clears the pending-create marker once a successful read confirms the row remotely", async () => {
    listMock.mockResolvedValueOnce([cus("cus_1")]);
    listMock.mockResolvedValue([cus("cus_1"), cus("cus_new")]);
    const local = [cus("cus_1"), cus("cus_new")];
    act(() => addCustomerPendingCreate("cus_new"));

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1"]);
    expect(getCustomerPendingCreates()).toContain("cus_new");

    act(() => bumpCustomerListReconcile());
    await waitFor(() => expect(getCustomerPendingCreates()).not.toContain("cus_new"));
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1", "cus_new"]);
  });

  it("does not fall back to local rows on a failed Supabase-authoritative read", async () => {
    listMock.mockRejectedValue(new Error("network"));
    const local = [cus("cus_1"), cus("cus_2")];

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.source).toBe("supabase");
    expect(result.current.customers).toEqual([]);
  });

  it("treats an empty Supabase read as an authoritative empty state", async () => {
    listMock.mockResolvedValue([]);
    const local = [cus("cus_1"), cus("cus_2")];

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    expect(result.current.customers).toEqual([]);
  });

  it("retires a tombstone once a fresh read confirms the row is gone", async () => {
    // First read (raced ahead of the soft-delete commit) still returns cus_1.
    listMock.mockResolvedValueOnce([cus("cus_1"), cus("cus_2")]);
    // Reconcile-triggered read (after commit) no longer returns cus_1.
    listMock.mockResolvedValue([cus("cus_2")]);

    const { result } = renderHook(() => useCustomerListSource([], "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    act(() => addCustomerDeleteTombstone("cus_1"));
    // Hidden immediately even though the first read still returned it.
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]);
    expect(getCustomerDeleteTombstones()).toContain("cus_1");

    // Mirror landed → reconcile bump → confirming read excludes cus_1.
    act(() => bumpCustomerListReconcile());
    await waitFor(() => expect(getCustomerDeleteTombstones()).not.toContain("cus_1"));
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]);
  });

  it("keeps the tombstone when a read still returns the row (raced the commit)", async () => {
    listMock.mockResolvedValue([cus("cus_1"), cus("cus_2")]);

    const { result } = renderHook(() => useCustomerListSource([], "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    act(() => addCustomerDeleteTombstone("cus_1"));
    act(() => bumpCustomerListReconcile());

    // Read still returns cus_1 → tombstone retained, row stays hidden.
    await waitFor(() => expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]));
    expect(getCustomerDeleteTombstones()).toContain("cus_1");
  });

  it("does not let newer local rows mask the Supabase-authoritative snapshot", async () => {
    listMock.mockResolvedValue([cusAt("cus_1", "2026-06-04T10:00:00.000Z", "active")]);
    const local = [cusAt("cus_1", "2026-06-04T10:00:05.000Z", "inactive")];

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    const row = result.current.customers.find((c) => c.id === "cus_1");
    expect((row as unknown as { status: string }).status).toBe("active");
    expect(result.current.customers.filter((c) => c.id === "cus_1")).toHaveLength(1);
  });

  it("keeps the remote row when it is newer/equal (cross-client edits not masked)", async () => {
    // Remote was edited more recently (e.g. another browser) — it must win.
    listMock.mockResolvedValue([cusAt("cus_1", "2026-06-04T10:00:10.000Z", "active")]);
    const local = [cusAt("cus_1", "2026-06-04T10:00:05.000Z", "inactive")];

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    const row = result.current.customers.find((c) => c.id === "cus_1");
    expect((row as unknown as { status: string }).status).toBe("active");
  });

  it("prunes a tombstoned id from the cached remote snapshot (no resurrection on clear)", async () => {
    // Remote keeps returning cus_1 (e.g. the soft-delete mirror is slow). The
    // render overlay hides it while tombstoned; the snapshot prune must also
    // remove it so clearing the tombstone can't resurface the stale row.
    listMock.mockResolvedValue([cus("cus_1"), cus("cus_2")]);

    const { result } = renderHook(() => useCustomerListSource([], "A"));
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    act(() => addCustomerDeleteTombstone("cus_1"));
    await waitFor(() =>
      expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]),
    );

    // Clear the tombstone WITHOUT a fresh read landing. Because the snapshot was
    // pruned, cus_1 stays gone instead of resurfacing from the stale cache.
    act(() => clearCustomerDeleteTombstones(["cus_1"]));
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_2"]);
  });

  it("hides archived rows by default and includes them only when requested", async () => {
    const remote = [cus("cus_1"), archivedCus("cus_archived")];
    listMock.mockResolvedValue(remote);

    const { result, rerender } = renderHook(
      ({ includeArchived }: { includeArchived: boolean }) =>
        useCustomerListSource([], "A", { includeArchived }),
      { initialProps: { includeArchived: false } },
    );
    await waitFor(() => expect(result.current.source).toBe("supabase"));

    expect(listMock).toHaveBeenLastCalledWith("A", { includeArchived: false });
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1"]);

    rerender({ includeArchived: true });

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith("A", { includeArchived: true }),
    );
    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1", "cus_archived"]);
  });

  it("suppresses a tombstoned local-only row too", async () => {
    enabledMock.mockReturnValue(false);
    const local = [cus("cus_1"), cus("cus_2")];

    const { result } = renderHook(() => useCustomerListSource(local, "A"));
    expect(result.current.source).toBe("local");

    act(() => addCustomerDeleteTombstone("cus_2"));

    expect(result.current.customers.map((c) => c.id)).toEqual(["cus_1"]);
  });
});
