import { beforeEach, describe, expect, it } from "vitest";

/**
 * TEAM-2 / TEAM-4 — Team cutover telemetry runtime.
 *
 * Under vitest every Teams flag resolves OFF (the safe default: the granular read
 * / dual-write flags are envFlag()||false and the authoritative cutoverFlag() is
 * OFF in test mode), so `shouldReadTeamsFromSupabase` / `shouldMirrorTeamWrites`
 * are false here. This suite exercises the telemetry counters the hook records.
 */

import {
  shouldReadTeamsFromSupabase,
  shouldMirrorTeamWrites,
  getTeamCutoverState,
  resetTeamCutoverState,
  recordTeamSupabaseRead,
  recordTeamReadFallback,
  recordTeamUnsafeEmpty,
  recordTeamShadowDrift,
} from "./teamCutover";

beforeEach(() => {
  resetTeamCutoverState();
});

describe("TEAM cutover telemetry", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadTeamsFromSupabase()).toBe(false);
    expect(shouldMirrorTeamWrites()).toBe(false);
    expect(getTeamCutoverState().readSource).toBe("localStorage");
  });

  it("records a healthy Supabase read", () => {
    recordTeamSupabaseRead();
    expect(getTeamCutoverState().supabaseReads).toBe(1);
  });

  it("records a read fallback as a surfaced failure", () => {
    recordTeamReadFallback("cmp_x", "network down");
    const state = getTeamCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
    expect(state.recentFailures[0]?.message).toBe("network down");
  });

  it("records an unsafe-empty result", () => {
    recordTeamUnsafeEmpty("cmp_x");
    const state = getTeamCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });

  it("records shadow drift with the mismatch summary", () => {
    recordTeamShadowDrift("count mismatch: local 2 vs supabase 1");
    const state = getTeamCutoverState();
    expect(state.shadowDrift).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch: local 2 vs supabase 1");
    expect(state.recentFailures[0]?.kind).toBe("drift");
  });

  it("resets all counters", () => {
    recordTeamSupabaseRead();
    recordTeamShadowDrift("x");
    resetTeamCutoverState();
    const state = getTeamCutoverState();
    expect(state.supabaseReads).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
