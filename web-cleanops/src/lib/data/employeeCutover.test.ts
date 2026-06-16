import { beforeEach, describe, expect, it } from "vitest";

/**
 * EMP-2 — Employee read-path cutover runtime.
 *
 * Validates the decision helper (default OFF) and the telemetry runtime the
 * future monitoring panel reads: success / fallback / unsafe-empty / drift
 * counters, the bounded recent-failures ring, immutable snapshots and reset.
 *
 * Read-only; the flag is OFF by default in tests (EMP-2 introduces no
 * authoritative mode). The record functions are intentionally NOT flag-gated —
 * the hook gates every call by `enabled` — so they faithfully count here.
 */
import {
  shouldReadEmployeesFromSupabase,
  getEmployeeCutoverState,
  resetEmployeeCutoverState,
  recordEmployeeSupabaseRead,
  recordEmployeeReadFallback,
  recordEmployeeUnsafeEmpty,
  recordEmployeeShadowDrift,
} from "./employeeCutover";

beforeEach(() => {
  resetEmployeeCutoverState();
});

describe("EMP-2 · employee read-path cutover runtime", () => {
  it("flag defaults OFF — directory stays local", () => {
    expect(shouldReadEmployeesFromSupabase()).toBe(false);
    const state = getEmployeeCutoverState();
    expect(state.supabaseRead).toBe(false);
    expect(state.readSource).toBe("localStorage");
  });

  it("records a successful Supabase directory read", () => {
    recordEmployeeSupabaseRead();
    recordEmployeeSupabaseRead();
    const state = getEmployeeCutoverState();
    expect(state.supabaseReads).toBe(2);
    expect(state.fallbacks).toBe(0);
    expect(state.failures).toBe(0);
  });

  it("records a read fallback — surfaced, never silent, counts as a local serve", () => {
    recordEmployeeReadFallback("cmp_nordlys", "network down");
    const state = getEmployeeCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.failures).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
    expect(state.recentFailures[0]?.message).toBe("network down");
    expect(state.lastEventAt).not.toBeNull();
  });

  it("records an unsafe empty read — empty while local has data is a fallback", () => {
    recordEmployeeUnsafeEmpty("cmp_nordlys");
    const state = getEmployeeCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.localReads).toBe(1);
    expect(state.failures).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });

  it("records shadow drift with the mismatch summary", () => {
    recordEmployeeShadowDrift("count mismatch: local 12 vs supabase 11");
    const state = getEmployeeCutoverState();
    expect(state.shadowDrift).toBe(1);
    expect(state.failures).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch: local 12 vs supabase 11");
    expect(state.recentFailures[0]?.kind).toBe("drift");
  });

  it("bounds the recent-failures ring at 50, newest first", () => {
    for (let i = 0; i < 60; i += 1) {
      recordEmployeeReadFallback("cmp", `fail ${i}`);
    }
    const state = getEmployeeCutoverState();
    expect(state.recentFailures.length).toBe(50);
    expect(state.recentFailures[0]?.message).toBe("fail 59");
    expect(state.fallbacks).toBe(60);
    expect(state.failures).toBe(60);
  });

  it("returns an immutable snapshot — mutating it does not corrupt state", () => {
    recordEmployeeReadFallback("cmp", "x");
    const snapshot = getEmployeeCutoverState();
    snapshot.recentFailures.push({
      kind: "read",
      ref: "tamper",
      message: "tamper",
      at: new Date().toISOString(),
    });
    expect(getEmployeeCutoverState().recentFailures.length).toBe(1);
  });

  it("reset clears every counter and the failure ring", () => {
    recordEmployeeSupabaseRead();
    recordEmployeeReadFallback("cmp", "x");
    recordEmployeeUnsafeEmpty("cmp");
    recordEmployeeShadowDrift("drift");
    resetEmployeeCutoverState();
    const state = getEmployeeCutoverState();
    expect(state.supabaseReads).toBe(0);
    expect(state.localReads).toBe(0);
    expect(state.fallbacks).toBe(0);
    expect(state.failures).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.unsafeEmptyReads).toBe(0);
    expect(state.lastMismatch).toBeNull();
    expect(state.lastEventAt).toBeNull();
    expect(state.recentFailures).toEqual([]);
  });
});
