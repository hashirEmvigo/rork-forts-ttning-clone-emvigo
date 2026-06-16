import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCustomerPendingCreate,
  clearCustomerPendingCreate,
  clearCustomerPendingCreates,
  getCustomerPendingCreates,
  subscribeCustomerPendingCreates,
  __resetCustomerPendingCreates,
  CUSTOMER_PENDING_CREATE_MAX_AGE_MS,
} from "./customerPendingCreates";

/**
 * Session-scoped pending-create registry. Proves: ids are tracked on add, cleared
 * on confirmation, auto-expire after the bounded max age, notify subscribers, and
 * expose a stable snapshot reference for useSyncExternalStore.
 */
describe("customerPendingCreates", () => {
  beforeEach(() => {
    __resetCustomerPendingCreates();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCustomerPendingCreates();
  });

  it("tracks an added id and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeCustomerPendingCreates(listener);

    addCustomerPendingCreate("cus_1");

    expect(getCustomerPendingCreates()).toContain("cus_1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("ignores empty ids", () => {
    addCustomerPendingCreate("");
    expect(getCustomerPendingCreates()).toHaveLength(0);
  });

  it("returns a stable snapshot reference when unchanged", () => {
    addCustomerPendingCreate("cus_1");
    const a = getCustomerPendingCreates();
    const b = getCustomerPendingCreates();
    expect(a).toBe(b);
  });

  it("clears a single id", () => {
    addCustomerPendingCreate("cus_1");
    addCustomerPendingCreate("cus_2");
    clearCustomerPendingCreate("cus_1");
    expect(getCustomerPendingCreates()).toEqual(["cus_2"]);
  });

  it("clears multiple ids (read-confirmed creates)", () => {
    addCustomerPendingCreate("cus_1");
    addCustomerPendingCreate("cus_2");
    addCustomerPendingCreate("cus_3");
    clearCustomerPendingCreates(["cus_1", "cus_3"]);
    expect(getCustomerPendingCreates()).toEqual(["cus_2"]);
  });

  it("auto-expires after the bounded max age", () => {
    addCustomerPendingCreate("cus_1");
    expect(getCustomerPendingCreates()).toContain("cus_1");

    vi.advanceTimersByTime(CUSTOMER_PENDING_CREATE_MAX_AGE_MS);

    expect(getCustomerPendingCreates()).toHaveLength(0);
  });

  it("does not emit when clearing an unknown id", () => {
    const listener = vi.fn();
    subscribeCustomerPendingCreates(listener);
    clearCustomerPendingCreate("nope");
    expect(listener).not.toHaveBeenCalled();
  });
});
