import { beforeEach, describe, expect, it } from "vitest";

/**
 * P5J — WO-6: Work Order export / backout snapshot validation.
 *
 * Exercises the REAL backout tooling against the seeded localStorage store
 * (`getWorkOrders()` / `getBookingOccurrenceExceptions()` seed on first read).
 * Proves the snapshot is complete (work orders + nested service rows + embedded
 * variations + the SEPARATE occurrence-exception store), per-company counts +
 * checksum are stable, the META persists across reads, and
 * `verifyWorkOrderBackout` detects divergence after a write.
 */
import {
  getWorkOrders,
  saveWorkOrders,
  getBookingOccurrenceExceptions,
} from "@/lib/store";
import {
  exportWorkOrderBackout,
  getWorkOrderBackoutMeta,
  verifyWorkOrderBackout,
} from "./workOrderBackout";

beforeEach(() => {
  localStorage.removeItem("cleanops:workOrders:backout:meta");
});

describe("work order backout snapshot", () => {
  it("captures every localStorage work order + exception with per-company counts", () => {
    const workOrders = getWorkOrders();
    const exceptions = getBookingOccurrenceExceptions();
    const snapshot = exportWorkOrderBackout();

    expect(snapshot.total).toBe(workOrders.length);
    expect(snapshot.workOrders).toHaveLength(workOrders.length);
    expect(snapshot.exceptionTotal).toBe(exceptions.length);

    const summed = snapshot.perCompany.reduce((acc, c) => acc + c.count, 0);
    expect(summed).toBe(workOrders.length);
    expect(snapshot.companyIds).toEqual(snapshot.perCompany.map((c) => c.companyId));

    const expectedServiceRows = workOrders.reduce(
      (sum, w) => sum + (w.serviceRows?.length ?? 0),
      0,
    );
    expect(snapshot.serviceRowTotal).toBe(expectedServiceRows);
  });

  it("scopes a snapshot to a single company", () => {
    const all = getWorkOrders();
    const companyId = all[0]?.companyId;
    expect(companyId).toBeTruthy();
    const expected = all.filter((w) => w.companyId === companyId).length;

    const snapshot = exportWorkOrderBackout({ companyId });
    expect(snapshot.total).toBe(expected);
    expect(snapshot.companyIds).toEqual([companyId]);
  });

  it("produces a stable checksum for an unchanged dataset", () => {
    const a = exportWorkOrderBackout({ persistMeta: false });
    const b = exportWorkOrderBackout({ persistMeta: false });
    expect(b.checksum).toBe(a.checksum);
  });

  it("persists lightweight META (no records) for the monitoring panel", () => {
    const snapshot = exportWorkOrderBackout();
    const meta = getWorkOrderBackoutMeta();
    expect(meta).not.toBeNull();
    expect(meta?.checksum).toBe(snapshot.checksum);
    expect(meta?.total).toBe(snapshot.total);
    expect(meta?.exceptionTotal).toBe(snapshot.exceptionTotal);
    // The persisted META must not carry the heavy records arrays.
    expect((meta as unknown as { workOrders?: unknown }).workOrders).toBeUndefined();
    expect((meta as unknown as { exceptions?: unknown }).exceptions).toBeUndefined();
  });

  it("verifyWorkOrderBackout matches an unchanged store and detects drift", () => {
    const snapshot = exportWorkOrderBackout({ persistMeta: false });
    expect(verifyWorkOrderBackout(snapshot).matches).toBe(true);

    // Mutate the store → checksum diverges, verify() reports a mismatch.
    const all = getWorkOrders();
    saveWorkOrders([
      ...all,
      { ...all[0], id: "wo_backout_test", number: "WO-TEST" },
    ]);
    const after = verifyWorkOrderBackout(snapshot);
    expect(after.matches).toBe(false);
    expect(after.currentTotal).toBe(all.length + 1);

    saveWorkOrders(all); // restore
    expect(verifyWorkOrderBackout(snapshot).matches).toBe(true);
  });
});
