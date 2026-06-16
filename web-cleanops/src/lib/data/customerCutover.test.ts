import { beforeEach, describe, expect, it } from "vitest";

/**
 * P4J — Wave 1F: Customer source-of-truth cut-over runtime.
 *
 * Flags default OFF in the test environment, so this proves the SAFE default:
 * localStorage stays authoritative, the read/write helpers resolve to
 * localStorage, and the telemetry recorders behave (failures always recorded;
 * primary-read counters are no-ops while authority is OFF). The ON behaviour is
 * exercised end-to-end by the dual-write + soak suites and live staging.
 */
import {
  isCustomerSupabaseAuthoritative,
  shouldReadListFromSupabase,
  shouldReadDetailFromSupabase,
  shouldMirrorWrites,
  getCustomerCutoverState,
  resetCustomerCutoverState,
  recordCutoverRead,
  recordCutoverFailure,
} from "./customerCutover";

beforeEach(() => {
  resetCustomerCutoverState();
});

describe("customer cut-over runtime (default flags OFF)", () => {
  it("keeps localStorage authoritative by default", () => {
    expect(isCustomerSupabaseAuthoritative()).toBe(false);
    expect(shouldReadListFromSupabase()).toBe(false);
    expect(shouldReadDetailFromSupabase()).toBe(false);
    expect(shouldMirrorWrites()).toBe(false);
  });

  it("reports localStorage as the resolved read/write source", () => {
    const state = getCustomerCutoverState();
    expect(state.authoritative).toBe(false);
    expect(state.readSource).toBe("localStorage");
    expect(state.writeSource).toBe("localStorage");
  });

  it("does not count primary reads while authority is OFF", () => {
    recordCutoverRead("read.list");
    recordCutoverRead("read.detail");
    const state = getCustomerCutoverState();
    expect(state.listReadsPrimary).toBe(0);
    expect(state.detailReadsPrimary).toBe(0);
  });

  it("always records divergence/failure events (never silent)", () => {
    recordCutoverFailure("read.list", "cmp_x", "supabase unreachable");
    recordCutoverFailure("write.mirror", "cust_1", "upsert failed");

    const state = getCustomerCutoverState();
    expect(state.failures).toBe(2);
    expect(state.readFallbacks).toBe(1);
    expect(state.writeFailures).toBe(1);
    expect(state.lastEventAt).not.toBeNull();
    expect(state.recentFailures[0].kind).toBe("write.mirror");
    expect(state.recentFailures[1].ref).toBe("cmp_x");
  });

  it("resets telemetry cleanly", () => {
    recordCutoverFailure("read.detail", "cust_2", "timeout");
    resetCustomerCutoverState();
    const state = getCustomerCutoverState();
    expect(state.failures).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
