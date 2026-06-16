import { beforeEach, describe, expect, it } from "vitest";

/**
 * P5J — WO-6: Work Order source-of-truth cut-over runtime.
 *
 * Flags default OFF in the test environment, so this proves the SAFE default:
 * localStorage stays authoritative, the read helpers resolve to localStorage,
 * and the telemetry recorders behave (failures always recorded; primary-read
 * counters are no-ops while authority is OFF). The ON behaviour is exercised
 * end-to-end by the dual-write + soak suites and live staging.
 */
import {
  isWorkOrderSupabaseAuthoritative,
  shouldReadWorkOrderListFromSupabase,
  shouldReadWorkOrderDetailFromSupabase,
  getWorkOrderCutoverState,
  resetWorkOrderCutoverState,
  recordWorkOrderCutoverRead,
  recordWorkOrderCutoverFailure,
} from "./workOrderCutover";
import { shouldMirrorWorkOrderWrites } from "./workOrderDualWrite";

beforeEach(() => {
  resetWorkOrderCutoverState();
});

describe("work order cut-over runtime (default flags OFF)", () => {
  it("keeps localStorage authoritative by default", () => {
    expect(isWorkOrderSupabaseAuthoritative()).toBe(false);
    expect(shouldReadWorkOrderListFromSupabase()).toBe(false);
    expect(shouldReadWorkOrderDetailFromSupabase()).toBe(false);
    expect(shouldMirrorWorkOrderWrites()).toBe(false);
  });

  it("reports localStorage as the resolved read/write source", () => {
    const state = getWorkOrderCutoverState();
    expect(state.authoritative).toBe(false);
    expect(state.readSource).toBe("localStorage");
    expect(state.writeSource).toBe("localStorage");
  });

  it("does not count primary reads while authority is OFF", () => {
    recordWorkOrderCutoverRead("read.list");
    recordWorkOrderCutoverRead("read.detail");
    const state = getWorkOrderCutoverState();
    expect(state.listReadsPrimary).toBe(0);
    expect(state.detailReadsPrimary).toBe(0);
  });

  it("always records divergence/failure events (never silent)", () => {
    recordWorkOrderCutoverFailure("read.list", "cmp_x", "supabase unreachable");
    recordWorkOrderCutoverFailure("write.mirror", "wo_1", "upsert failed");

    const state = getWorkOrderCutoverState();
    expect(state.failures).toBe(2);
    expect(state.readFallbacks).toBe(1);
    expect(state.writeFailures).toBe(1);
    expect(state.lastEventAt).not.toBeNull();
    expect(state.recentFailures[0].kind).toBe("write.mirror");
    expect(state.recentFailures[1].ref).toBe("cmp_x");
  });

  it("resets telemetry cleanly", () => {
    recordWorkOrderCutoverFailure("read.detail", "wo_2", "timeout");
    resetWorkOrderCutoverState();
    const state = getWorkOrderCutoverState();
    expect(state.failures).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
