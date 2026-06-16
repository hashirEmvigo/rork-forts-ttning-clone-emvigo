import { beforeEach, describe, expect, it } from "vitest";

/**
 * BQ-1 — Booking Queue cutover telemetry runtime.
 *
 * Under vitest every Booking Queue flag resolves OFF (the granular read /
 * dual-write flags are envFlag()||false and the authoritative cutoverFlag() is
 * OFF in test mode), so `shouldReadBookingQueueFromSupabase` /
 * `shouldMirrorBookingQueueWrites` are false here. This suite exercises the
 * telemetry counters the read seam records.
 */

import {
  shouldReadBookingQueueFromSupabase,
  shouldMirrorBookingQueueWrites,
  shouldUseBookingQueueLocalBackoutBridge,
  isBookingQueueSupabaseAuthoritative,
  getBookingQueueCutoverState,
  resetBookingQueueCutoverState,
  recordBookingQueueSupabaseRead,
  recordBookingQueueReadFallback,
  recordBookingQueueUnsafeEmpty,
  recordBookingQueueShadowDrift,
} from "./bookingQueueCutover";

beforeEach(() => {
  resetBookingQueueCutoverState();
});

describe("BQ cutover telemetry", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadBookingQueueFromSupabase()).toBe(false);
    expect(shouldMirrorBookingQueueWrites()).toBe(false);
    expect(isBookingQueueSupabaseAuthoritative()).toBe(false);
    expect(shouldUseBookingQueueLocalBackoutBridge()).toBe(false);
    expect(getBookingQueueCutoverState().readSource).toBe("localStorage");
    expect(getBookingQueueCutoverState().localBackoutBridge).toBe(false);
  });

  it("records a healthy Supabase read", () => {
    recordBookingQueueSupabaseRead();
    expect(getBookingQueueCutoverState().supabaseReads).toBe(1);
  });

  it("records a read fallback as a surfaced failure", () => {
    recordBookingQueueReadFallback("cmp_x", "network down");
    const state = getBookingQueueCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
    expect(state.recentFailures[0]?.message).toBe("network down");
  });

  it("records an unsafe-empty result", () => {
    recordBookingQueueUnsafeEmpty("cmp_x");
    const state = getBookingQueueCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
    expect(state.recentFailures[0]?.message).toContain("explicit local-backout bridge");
  });

  it("records shadow drift with the mismatch summary", () => {
    recordBookingQueueShadowDrift("count mismatch: local 6 vs supabase 5");
    const state = getBookingQueueCutoverState();
    expect(state.shadowDrift).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch: local 6 vs supabase 5");
    expect(state.recentFailures[0]?.kind).toBe("drift");
  });

  it("resets all counters", () => {
    recordBookingQueueSupabaseRead();
    recordBookingQueueShadowDrift("x");
    resetBookingQueueCutoverState();
    const state = getBookingQueueCutoverState();
    expect(state.supabaseReads).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
