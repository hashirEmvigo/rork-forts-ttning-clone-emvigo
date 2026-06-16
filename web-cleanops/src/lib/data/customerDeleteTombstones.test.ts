import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCustomerDeleteTombstone,
  clearCustomerDeleteTombstone,
  clearCustomerDeleteTombstones,
  getCustomerDeleteTombstones,
  subscribeCustomerDeleteTombstones,
  __resetCustomerDeleteTombstones,
  CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS,
  bumpCustomerListReconcile,
  getCustomerListReconcileVersion,
  subscribeCustomerListReconcile,
} from "./customerDeleteTombstones";

/**
 * Session-scoped optimistic customer delete tombstones. Proves: ids are tracked
 * on add, cleared on success, auto-expire after the bounded max age, notify
 * subscribers, and expose a stable snapshot reference for useSyncExternalStore.
 */
describe("customerDeleteTombstones", () => {
  beforeEach(() => {
    __resetCustomerDeleteTombstones();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCustomerDeleteTombstones();
  });

  it("tracks an added id and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeCustomerDeleteTombstones(listener);

    addCustomerDeleteTombstone("cus_1");

    expect(getCustomerDeleteTombstones()).toContain("cus_1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("ignores empty ids", () => {
    addCustomerDeleteTombstone("");
    expect(getCustomerDeleteTombstones()).toHaveLength(0);
  });

  it("returns a stable snapshot reference when unchanged", () => {
    addCustomerDeleteTombstone("cus_1");
    const a = getCustomerDeleteTombstones();
    const b = getCustomerDeleteTombstones();
    expect(a).toBe(b);
  });

  it("clears a single id", () => {
    addCustomerDeleteTombstone("cus_1");
    addCustomerDeleteTombstone("cus_2");
    clearCustomerDeleteTombstone("cus_1");
    expect(getCustomerDeleteTombstones()).toEqual(["cus_2"]);
  });

  it("clears multiple ids (mirror-resolved removals)", () => {
    addCustomerDeleteTombstone("cus_1");
    addCustomerDeleteTombstone("cus_2");
    addCustomerDeleteTombstone("cus_3");
    clearCustomerDeleteTombstones(["cus_1", "cus_3"]);
    expect(getCustomerDeleteTombstones()).toEqual(["cus_2"]);
  });

  it("auto-expires after the bounded max age", () => {
    addCustomerDeleteTombstone("cus_1");
    expect(getCustomerDeleteTombstones()).toContain("cus_1");

    vi.advanceTimersByTime(CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS);

    expect(getCustomerDeleteTombstones()).toHaveLength(0);
  });

  it("forces a fresh read on auto-expiry (bumps reconcile) so a stale snapshot can't resurface", () => {
    const reconcile = vi.fn();
    const unsub = subscribeCustomerListReconcile(reconcile);
    const before = getCustomerListReconcileVersion();

    addCustomerDeleteTombstone("cus_1");
    vi.advanceTimersByTime(CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS);

    expect(getCustomerDeleteTombstones()).toHaveLength(0);
    expect(getCustomerListReconcileVersion()).toBe(before + 1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("does not bump reconcile on a confirmed (read-proven) clear", () => {
    const reconcile = vi.fn();
    const unsub = subscribeCustomerListReconcile(reconcile);

    addCustomerDeleteTombstone("cus_1");
    // A confirming read proved the row is gone → cleared explicitly, no extra read.
    clearCustomerDeleteTombstones(["cus_1"]);

    expect(reconcile).not.toHaveBeenCalled();
    unsub();
  });

  it("does not emit when clearing an unknown id", () => {
    const listener = vi.fn();
    subscribeCustomerDeleteTombstones(listener);
    clearCustomerDeleteTombstone("nope");
    expect(listener).not.toHaveBeenCalled();
  });

  it("bumps the reconcile version and notifies reconcile subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeCustomerListReconcile(listener);
    const before = getCustomerListReconcileVersion();

    bumpCustomerListReconcile();

    expect(getCustomerListReconcileVersion()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("resets the reconcile version on __reset", () => {
    bumpCustomerListReconcile();
    expect(getCustomerListReconcileVersion()).toBeGreaterThan(0);
    __resetCustomerDeleteTombstones();
    expect(getCustomerListReconcileVersion()).toBe(0);
  });
});
