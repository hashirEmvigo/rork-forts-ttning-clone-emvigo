import { beforeEach, describe, expect, it } from "vitest";

/**
 * P4J — Wave 1F: Customer export / backout snapshot validation.
 *
 * Exercises the REAL backout tooling against the seeded localStorage store
 * (`getCustomers()` seeds on first read). Proves the snapshot is complete,
 * per-company counts + checksum are stable, the META persists across reads,
 * and `verifyCustomerBackout` detects divergence after a write.
 */
import { getCustomers, saveCustomers } from "@/lib/store";
import {
  exportCustomerBackout,
  getCustomerBackoutMeta,
  verifyCustomerBackout,
} from "./customerBackout";

beforeEach(() => {
  localStorage.removeItem("cleanops:customers:backout:meta");
});

describe("customer backout snapshot", () => {
  it("captures every localStorage customer with per-company counts", () => {
    const all = getCustomers();
    const snapshot = exportCustomerBackout();

    expect(snapshot.total).toBe(all.length);
    expect(snapshot.records).toHaveLength(all.length);

    const summed = snapshot.perCompany.reduce((acc, c) => acc + c.count, 0);
    expect(summed).toBe(all.length);
    // companyIds is the distinct set from perCompany.
    expect(snapshot.companyIds).toEqual(snapshot.perCompany.map((c) => c.companyId));
  });

  it("scopes a snapshot to a single company", () => {
    const all = getCustomers();
    const companyId = all[0]?.companyId;
    expect(companyId).toBeTruthy();
    const expected = all.filter((c) => c.companyId === companyId).length;

    const snapshot = exportCustomerBackout({ companyId });
    expect(snapshot.total).toBe(expected);
    expect(snapshot.companyIds).toEqual([companyId]);
  });

  it("produces a stable checksum for an unchanged dataset", () => {
    const a = exportCustomerBackout({ persistMeta: false });
    const b = exportCustomerBackout({ persistMeta: false });
    expect(b.checksum).toBe(a.checksum);
  });

  it("persists lightweight META (no records) for the monitoring panel", () => {
    const snapshot = exportCustomerBackout();
    const meta = getCustomerBackoutMeta();
    expect(meta).not.toBeNull();
    expect(meta?.checksum).toBe(snapshot.checksum);
    expect(meta?.total).toBe(snapshot.total);
    // The persisted META must not carry the heavy records array.
    expect((meta as unknown as { records?: unknown }).records).toBeUndefined();
  });

  it("verifyCustomerBackout matches an unchanged store and detects drift", () => {
    const snapshot = exportCustomerBackout({ persistMeta: false });
    expect(verifyCustomerBackout(snapshot).matches).toBe(true);

    // Mutate the store → checksum diverges, verify() reports a mismatch.
    const all = getCustomers();
    saveCustomers([...all, { ...all[0], id: "cust_backout_test", customerNumber: "C-TEST" }]);
    const after = verifyCustomerBackout(snapshot);
    expect(after.matches).toBe(false);
    expect(after.currentTotal).toBe(all.length + 1);

    saveCustomers(all); // restore
    expect(verifyCustomerBackout(snapshot).matches).toBe(true);
  });
});
