import { beforeEach, describe, expect, it } from "vitest";

/**
 * ROLE-2 / ROLE-4 — Role cutover telemetry runtime.
 *
 * Under vitest every Roles flag resolves OFF (the granular read / dual-write
 * flags are envFlag()||false and the authoritative cutoverFlag() is OFF in test
 * mode), so `shouldReadRolesFromSupabase` / `shouldMirrorRoleWrites` are false
 * here. This suite exercises the telemetry counters the hook records.
 */

import {
  shouldReadRolesFromSupabase,
  shouldMirrorRoleWrites,
  getRoleCutoverState,
  resetRoleCutoverState,
  recordRoleSupabaseRead,
  recordRoleReadFallback,
  recordRoleUnsafeEmpty,
  recordRoleShadowDrift,
} from "./roleCutover";

beforeEach(() => {
  resetRoleCutoverState();
});

describe("ROLE cutover telemetry", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadRolesFromSupabase()).toBe(false);
    expect(shouldMirrorRoleWrites()).toBe(false);
    expect(getRoleCutoverState().readSource).toBe("localStorage");
  });

  it("records a healthy Supabase read", () => {
    recordRoleSupabaseRead();
    expect(getRoleCutoverState().supabaseReads).toBe(1);
  });

  it("records a read fallback as a surfaced failure", () => {
    recordRoleReadFallback("cmp_x", "network down");
    const state = getRoleCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
    expect(state.recentFailures[0]?.message).toBe("network down");
  });

  it("records an unsafe-empty result", () => {
    recordRoleUnsafeEmpty("cmp_x");
    const state = getRoleCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });

  it("records shadow drift with the mismatch summary", () => {
    recordRoleShadowDrift("count mismatch: local 2 vs supabase 1");
    const state = getRoleCutoverState();
    expect(state.shadowDrift).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch: local 2 vs supabase 1");
    expect(state.recentFailures[0]?.kind).toBe("drift");
  });

  it("resets all counters", () => {
    recordRoleSupabaseRead();
    recordRoleShadowDrift("x");
    resetRoleCutoverState();
    const state = getRoleCutoverState();
    expect(state.supabaseReads).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.recentFailures).toHaveLength(0);
  });
});
