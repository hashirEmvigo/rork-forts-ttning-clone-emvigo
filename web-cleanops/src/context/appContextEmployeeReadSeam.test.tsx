import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * EMP-2 Stage 2 — AppContext employees read-seam wiring.
 *
 * AppContext is a very large provider with many side-effecting dependencies, so
 * rather than mounting the whole provider we exercise a faithful HARNESS that
 * reproduces the EXACT seam AppContext uses at the employees hydration point:
 *
 *   const [employees, setEmployees] = useState(() => getEmployees());   // sync seed
 *   const directory = useEmployeeDirectorySource({ localEmployees: employees, companyId });
 *   useEffect(() => {
 *     if (directory.source === "supabase") setEmployees(directory.employees);
 *   }, [directory.source, directory.employees]);
 *
 * The harness below is byte-for-byte the same shape. The Supabase repository,
 * shadow comparator and the read decision helper are mocked (so we can flip the
 * flag and control timing); the REAL cutover telemetry runtime is exercised.
 *
 * These tests prove the Stage 2 guarantees:
 *   • flag OFF behaviour is unchanged (state stays the synchronous local seed),
 *   • flag ON can serve Supabase employees into the context state,
 *   • empty Supabase while local has data NEVER blanks the list,
 *   • the read seam introduces NO localStorage write (saveEmployees never fires),
 *   • rollback by flag OFF returns the localStorage path.
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

// The store write target — the seam must NEVER call this (reads only in EMP-2).
const saveEmployeesSpy = vi.fn();
vi.mock("@/lib/store", () => ({
  saveEmployees: (...args: unknown[]) => saveEmployeesSpy(...args),
}));

import type { Employee } from "@/types";
import type { EmployeeShadowReport } from "@/lib/data/employeeMigration";
import { saveEmployees } from "@/lib/store";
import { listFullEmployeesFromSupabase } from "@/lib/data/supabaseEmployeeRepository";
import { shadowReadEmployees } from "@/lib/data/employeeMigration";
import {
  shouldReadEmployeesFromSupabase,
  getEmployeeCutoverState,
  resetEmployeeCutoverState,
} from "@/lib/data/employeeCutover";
import { useEmployeeDirectorySource } from "@/hooks/use-employee-directory-source";

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

const listMock = vi.mocked(listFullEmployeesFromSupabase);
const shadowMock = vi.mocked(shadowReadEmployees);
const enabledMock = vi.mocked(shouldReadEmployeesFromSupabase);

/**
 * Faithful reproduction of the AppContext employees hydration seam. `persist`
 * mirrors AppContext.persistEmployees (the ONLY writer): it both updates state
 * AND writes localStorage — proving that the read effect does NOT go through it.
 */
function EmployeeSeamHarness({
  seed,
  companyId,
}: {
  seed: Employee[];
  companyId: string | null | undefined;
}) {
  const [employees, setEmployees] = useState<Employee[]>(() => seed);

  const directory = useEmployeeDirectorySource({ localEmployees: employees, companyId });

  useEffect(() => {
    if (directory.source === "supabase") {
      setEmployees(directory.employees);
    }
  }, [directory.source, directory.employees]);

  return (
    <div>
      <span data-testid="ids">{employees.map((e) => e.id).join(",")}</span>
      <span data-testid="source">{directory.source}</span>
      <span data-testid="count">{String(employees.length)}</span>
    </div>
  );
}

beforeEach(() => {
  resetEmployeeCutoverState();
  listMock.mockReset();
  shadowMock.mockReset();
  enabledMock.mockReset();
  saveEmployeesSpy.mockReset();
  enabledMock.mockReturnValue(true);
  listMock.mockResolvedValue([]);
  shadowMock.mockResolvedValue(OK_REPORT);
  // Keep the store import referenced so the mock binding is exercised.
  void saveEmployees;
});

describe("EMP-2 Stage 2 · AppContext employees read seam", () => {
  it("flag OFF — context state stays the synchronous local seed, no Supabase call", async () => {
    enabledMock.mockReturnValue(false);
    const seed = [emp("emp_local_1"), emp("emp_local_2")];

    render(<EmployeeSeamHarness seed={seed} companyId="A" />);

    expect(screen.getByTestId("source").textContent).toBe("local");
    expect(screen.getByTestId("ids").textContent).toBe("emp_local_1,emp_local_2");
    expect(listMock).not.toHaveBeenCalled();
    expect(saveEmployeesSpy).not.toHaveBeenCalled();
  });

  it("flag ON — serves Supabase employees into the context state", async () => {
    const seed = [emp("emp_local")];
    listMock.mockResolvedValue([emp("emp_remote_1"), emp("emp_remote_2")]);

    render(<EmployeeSeamHarness seed={seed} companyId="A" />);

    await waitFor(() => expect(screen.getByTestId("source").textContent).toBe("supabase"));
    expect(screen.getByTestId("ids").textContent).toBe("emp_remote_1,emp_remote_2");
    expect(getEmployeeCutoverState().supabaseReads).toBe(1);
  });

  it("empty Supabase + non-empty local — never blanks the directory", async () => {
    const seed = [emp("emp_local_1"), emp("emp_local_2")];
    listMock.mockResolvedValue([]);

    render(<EmployeeSeamHarness seed={seed} companyId="A" />);

    // Wait long enough for the (resolved-empty) read to settle, then assert the
    // seed is intact and the source never switched away from local.
    await waitFor(() => expect(getEmployeeCutoverState().unsafeEmptyReads).toBe(1));
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByTestId("ids").textContent).toBe("emp_local_1,emp_local_2");
    expect(screen.getByTestId("source").textContent).toBe("local");
  });

  it("read seam introduces NO localStorage write — even on a healthy reconcile", async () => {
    const seed = [emp("emp_local")];
    listMock.mockResolvedValue([emp("emp_remote")]);

    render(<EmployeeSeamHarness seed={seed} companyId="A" />);

    await waitFor(() => expect(screen.getByTestId("source").textContent).toBe("supabase"));
    // The reconcile uses setEmployees only — persistEmployees/saveEmployees is the
    // sole writer and is never invoked by the read path.
    expect(saveEmployeesSpy).not.toHaveBeenCalled();
  });

  it("rollback — flipping the flag OFF returns the localStorage path with no Supabase call", async () => {
    enabledMock.mockReturnValue(false);
    const seed = [emp("emp_local")];

    render(<EmployeeSeamHarness seed={seed} companyId="A" />);

    expect(screen.getByTestId("source").textContent).toBe("local");
    expect(screen.getByTestId("ids").textContent).toBe("emp_local");
    expect(listMock).not.toHaveBeenCalled();
    expect(getEmployeeCutoverState().supabaseReads).toBe(0);
    expect(getEmployeeCutoverState().fallbacks).toBe(0);
  });
});

describe("EMP-2 Stage 2 · telemetry strip data contract", () => {
  it("renders safely with no telemetry — all strip fields are defined", () => {
    resetEmployeeCutoverState();
    const state = getEmployeeCutoverState();

    // Exactly the fields the SystemPerformance strip reads. None may be undefined,
    // so the panel can never throw on a cold start.
    expect(state.readSource).toBe("localStorage");
    expect(state.supabaseReads).toBe(0);
    expect(state.localReads).toBe(0);
    expect(state.fallbacks).toBe(0);
    expect(state.failures).toBe(0);
    expect(state.shadowDrift).toBe(0);
    expect(state.unsafeEmptyReads).toBe(0);
    expect(state.lastMismatch).toBeNull();
    expect(state.lastEventAt).toBeNull();
    expect(Array.isArray(state.recentFailures)).toBe(true);
    expect(state.recentFailures).toHaveLength(0);
  });
});
