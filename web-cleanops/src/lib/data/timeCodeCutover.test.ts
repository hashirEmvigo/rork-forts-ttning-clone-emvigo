import { beforeEach, describe, expect, it } from "vitest";

/**
 * TIMECODE-2 / TIMECODE-4 — Time Code cutover telemetry runtime.
 *
 * Under vitest every Time Codes flag resolves OFF (the granular read / dual-write
 * flags are envFlag()||false and the authoritative cutoverFlag() is OFF in test
 * mode), so `shouldReadTimeCodesFromSupabase` / `shouldMirrorTimeCodeWrites` are
 * false here. This suite exercises the telemetry counters the hook records.
 */

import {
  shouldReadTimeCodesFromSupabase,
  shouldMirrorTimeCodeWrites,
  getTimeCodeCutoverState,
  resetTimeCodeCutoverState,
  recordTimeCodeSupabaseRead,
  recordTimeCodeReadFallback,
  recordTimeCodeUnsafeEmpty,
  recordTimeCodeShadowDrift,
} from "./timeCodeCutover";

beforeEach(() => {
  resetTimeCodeCutoverState();
});

describe("TIMECODE cutover telemetry", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadTimeCodesFromSupabase()).toBe(false);
    expect(shouldMirrorTimeCodeWrites()).toBe(false);
    expect(getTimeCodeCutoverState().readSource).toBe("localStorage");
  });

  it("records a healthy Supabase read", () => {
    recordTimeCodeSupabaseRead();
    expect(getTimeCodeCutoverState().supabaseReads).toBe(1);
  });

  it("records a read fallback as a surfaced failure", () => {
    recordTimeCodeReadFallback("cmp_x", "network down");
    const state = getTimeCodeCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
    expect(state.recentFailures[0]?.message).toBe("network down");
  });

  it("records an unsafe-empty result", () => {
    recordTimeCodeUnsafeEmpty("cmp_x");
    const state = getTimeCodeCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });

  it("records shadow drift with the mismatch summary", () => {
    recordTimeCodeShadowDrift("count mismatch: local 6 vs supabase 5");
    const state = getTimeCodeCutoverState();
    expect(state.shadowDrift).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch: local 6 vs supabase 5");
    expect(state.recentFailures[0]?.kind).toBe("drift");
  });

  it("resets all counters", () => {
    recordTimeCodeSupabaseRead();
    recordTimeCodeShadowDrift("x");
    resetTimeCodeCutoverState();
    const state = getTimeCodeCutoverState();
    expect(state.supabaseReads).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
