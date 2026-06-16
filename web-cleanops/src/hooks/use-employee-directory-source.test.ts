import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * EMP-2 — Employee directory read-seam hook.
 *
 * Proves the read-source switch {@link useEmployeeDirectorySource} performs is
 * safe and behaviour-neutral when OFF, and correctly reconciles to Supabase when
 * ON — with the EMP-2 safety guarantees: synchronous localStorage fallback, a
 * stale-request guard, unsafe-empty protection (never blanks the directory), and
 * background shadow-drift reporting.
 *
 * Strategy: the Supabase repository read + the shadow comparator are mocked so we
 * can control timing / errors precisely; the decision helper is mocked so we can
 * flip `enabled` per test; the REAL cutover telemetry runtime is exercised so we
 * assert against live counters. localStorage remains the only write target — no
 * write path is touched here.
 */

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock("@/lib/data/supabaseEmployeeRepository", () => ({
  listFullEmployeesFromSupabase: vi.fn(),
}));

vi.mock("@/lib/data/employeeMigration", () => ({
  shadowReadEmployees: vi.fn(),
}));

vi.mock("@/lib/data/employeeCutover", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/data/employeeCutover");
  return { ...actual, shouldReadEmployeesFromSupabase: vi.fn(() => true) };
});

import type { Employee } from "@/types";
import type { EmployeeShadowReport } from "@/lib/data/employeeMigration";
import { listFullEmployeesFromSupabase } from "@/lib/data/supabaseEmployeeRepository";
import { shadowReadEmployees } from "@/lib/data/employeeMigration";
import {
  shouldReadEmployeesFromSupabase,
  getEmployeeCutoverState,
  resetEmployeeCutoverState,
} from "@/lib/data/employeeCutover";
import { useEmployeeDirectorySource } from "./use-employee-directory-source";

function emp(id: string, companyId = "A"): Employee {
  return {
    id,
    companyId,
    name: id,
    email: `${id}@x.test`,
    status: "active",
    teamIds: [],
  } as unknown as Employee;
}

const OK_REPORT: EmployeeShadowReport = {
  ok: true,
  companyId: null,
  localCount: 1,
  supabaseCount: 1,
  countMatch: true,
  idsMatch: true,
  summaryMatch: true,
  detailMatch: true,
  missingInSupabase: [],
  extraInSupabase: [],
  notes: [],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const listMock = vi.mocked(listFullEmployeesFromSupabase);
const shadowMock = vi.mocked(shadowReadEmployees);
const enabledMock = vi.mocked(shouldReadEmployeesFromSupabase);

beforeEach(() => {
  resetEmployeeCutoverState();
  listMock.mockReset();
  shadowMock.mockReset();
  enabledMock.mockReset();
  enabledMock.mockReturnValue(true);
  listMock.mockResolvedValue([]);
  shadowMock.mockResolvedValue(OK_REPORT);
});

describe("EMP-2 · useEmployeeDirectorySource", () => {
  it("flag OFF — serves the local seed synchronously, never calls Supabase", async () => {
    enabledMock.mockReturnValue(false);
    const local = [emp("emp_local")];

    const { result } = renderHook(() =>
      useEmployeeDirectorySource({ companyId: "A", localEmployees: local }),
    );

    expect(result.current.employees).toBe(local);
    expect(result.current.source).toBe("local");
    expect(listMock).not.toHaveBeenCalled();
    expect(getEmployeeCutoverState().supabaseReads).toBe(0);
  });

  it("flag ON — reconciles the directory to a healthy non-empty Supabase result", async () => {
    const local = [emp("emp_local")];
    const remote = [emp("emp_remote_1"), emp("emp_remote_2")];
    listMock.mockResolvedValue(remote);

    const { result } = renderHook(() =>
      useEmployeeDirectorySource({ companyId: "A", localEmployees: local }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.employees).toEqual(remote);
    expect(listMock).toHaveBeenCalledWith("A");
    expect(getEmployeeCutoverState().supabaseReads).toBe(1);
  });

  it("query error — keeps the local seed and records a fallback (never blanks)", async () => {
    const local = [emp("emp_local")];
    listMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useEmployeeDirectorySource({ companyId: "A", localEmployees: local }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employees).toBe(local);
    expect(result.current.source).toBe("local");
    expect(result.current.error).toBe("network down");
    const state = getEmployeeCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("read");
  });

  it("unsafe empty — empty Supabase while local has data keeps the local seed", async () => {
    const local = [emp("emp_local")];
    listMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEmployeeDirectorySource({ companyId: "A", localEmployees: local }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employees).toBe(local);
    expect(result.current.source).toBe("local");
    const state = getEmployeeCutoverState();
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.fallbacks).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });

  it("safe empty — empty Supabase AND empty local is a genuine Supabase read", async () => {
    listMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEmployeeDirectorySource({ companyId: "A", localEmployees: [] }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.employees).toEqual([]);
    const state = getEmployeeCutoverState();
    expect(state.supabaseReads).toBe(1);
    expect(state.unsafeEmptyReads).toBe(0);
  });

  it("stale request guard — a superseded scope fetch never overwrites a newer one", async () => {
    const local = [emp("emp_local")];
    const d1 = deferred<Employee[]>();
    const d2 = deferred<Employee[]>();
    listMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const { result, rerender } = renderHook(
      (props: { companyId: string; localEmployees: Employee[] }) =>
        useEmployeeDirectorySource(props),
      { initialProps: { companyId: "A", localEmployees: local } },
    );

    // Scope change supersedes the in-flight company-A fetch.
    rerender({ companyId: "B", localEmployees: local });

    // The NEWER (company-B) fetch resolves first…
    await act(async () => {
      d2.resolve([emp("emp_B", "B")]);
      await d2.promise;
    });
    // …then the STALE (company-A) fetch resolves late and must be dropped.
    await act(async () => {
      d1.resolve([emp("emp_A", "A")]);
      await d1.promise;
    });

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.employees.map((e) => e.id)).toEqual(["emp_B"]);
  });

  it("shadow drift — a background mismatch is recorded after a healthy serve", async () => {
    const local = [emp("emp_local")];
    listMock.mockResolvedValue([emp("emp_remote")]);
    shadowMock.mockResolvedValue({
      ...OK_REPORT,
      ok: false,
      countMatch: false,
      notes: ["count mismatch: local 1 vs supabase 2"],
    });

    const { result } = renderHook(() =>
      useEmployeeDirectorySource({ companyId: "A", localEmployees: local }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    await waitFor(() => expect(getEmployeeCutoverState().shadowDrift).toBe(1));
    expect(getEmployeeCutoverState().lastMismatch).toBe(
      "count mismatch: local 1 vs supabase 2",
    );
  });
});
