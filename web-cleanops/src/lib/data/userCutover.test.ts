import { beforeEach, describe, expect, it } from "vitest";

/**
 * USER-2 / USER-4 — User (login) cutover telemetry runtime.
 *
 * Under vitest every Users flag resolves OFF (the granular read / dual-write
 * flags are envFlag()||false and the authoritative cutoverFlag() is OFF in test
 * mode), so `shouldReadUsersFromSupabase` / `shouldMirrorUserWrites` are false
 * here. This suite exercises the telemetry counters the hook records.
 */

import {
  shouldReadUsersFromSupabase,
  shouldMirrorUserWrites,
  getUserCutoverState,
  resetUserCutoverState,
  recordUserSupabaseRead,
  recordUserReadFallback,
  recordUserUnsafeEmpty,
  recordUserShadowDrift,
} from "./userCutover";

beforeEach(() => {
  resetUserCutoverState();
});

describe("USER cutover telemetry", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadUsersFromSupabase()).toBe(false);
    expect(shouldMirrorUserWrites()).toBe(false);
    expect(getUserCutoverState().readSource).toBe("localStorage");
  });

  it("records a healthy Supabase read", () => {
    recordUserSupabaseRead();
    expect(getUserCutoverState().supabaseReads).toBe(1);
  });

  it("records a read fallback as a surfaced failure", () => {
    recordUserReadFallback("cmp_x", "network down");
    const state = getUserCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
    expect(state.recentFailures[0]?.message).toBe("network down");
  });

  it("records an unsafe-empty result", () => {
    recordUserUnsafeEmpty("cmp_x");
    const state = getUserCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });

  it("records shadow drift with the mismatch summary", () => {
    recordUserShadowDrift("count mismatch: local 2 vs supabase 1");
    const state = getUserCutoverState();
    expect(state.shadowDrift).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch: local 2 vs supabase 1");
    expect(state.recentFailures[0]?.kind).toBe("drift");
  });

  it("resets all counters", () => {
    recordUserSupabaseRead();
    recordUserShadowDrift("x");
    resetUserCutoverState();
    const state = getUserCutoverState();
    expect(state.supabaseReads).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
