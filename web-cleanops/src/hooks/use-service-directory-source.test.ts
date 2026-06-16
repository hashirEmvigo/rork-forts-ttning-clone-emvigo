import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * SVC-2 — Service directory read-seam hook.
 *
 * Proves the read-source switch {@link useServiceDirectorySource} is safe and
 * behaviour-neutral when OFF, and correctly reconciles to Supabase when ON — with
 * the SVC-2 safety guarantees: synchronous localStorage fallback, unsafe-empty
 * protection (never blanks the directory), and background shadow-drift reporting.
 */

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

// Supabase Auth enabled so the pre-auth skip path is exercised. Existing tests
// pass a non-null authNonce, so they are unaffected (awaitingAuth stays false).
vi.mock("@/lib/authSupabase", () => ({
  isSupabaseAuthEnabled: true,
}));

vi.mock("@/lib/data/supabaseServiceRepository", () => ({
  listFullServicesFromSupabase: vi.fn(),
}));

vi.mock("@/lib/data/serviceMigration", () => ({
  shadowReadServices: vi.fn(),
}));

vi.mock("@/lib/data/serviceCutover", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/data/serviceCutover");
  return { ...actual, shouldReadServicesFromSupabase: vi.fn(() => true) };
});

import type { Service } from "@/types";
import type { ServiceShadowReport } from "@/lib/data/serviceMigration";
import { listFullServicesFromSupabase } from "@/lib/data/supabaseServiceRepository";
import { shadowReadServices } from "@/lib/data/serviceMigration";
import {
  shouldReadServicesFromSupabase,
  getServiceCutoverState,
  resetServiceCutoverState,
} from "@/lib/data/serviceCutover";
import { useServiceDirectorySource } from "./use-service-directory-source";

function service(id: string, companyId: string | null = "A"): Service {
  return {
    id,
    companyId,
    categoryId: null,
    name: id,
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const OK_REPORT: ServiceShadowReport = {
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

const listMock = vi.mocked(listFullServicesFromSupabase);
const shadowMock = vi.mocked(shadowReadServices);
const enabledMock = vi.mocked(shouldReadServicesFromSupabase);

beforeEach(() => {
  resetServiceCutoverState();
  listMock.mockReset();
  shadowMock.mockReset();
  enabledMock.mockReset();
  enabledMock.mockReturnValue(true);
  listMock.mockResolvedValue([]);
  shadowMock.mockResolvedValue(OK_REPORT);
});

describe("SVC-2 · useServiceDirectorySource", () => {
  it("flag OFF — serves the local seed synchronously, never calls Supabase", () => {
    enabledMock.mockReturnValue(false);
    const local = [service("svc_local")];

    const { result } = renderHook(() =>
      useServiceDirectorySource({ companyId: "A", localServices: local, authNonce: "u1" }),
    );

    expect(result.current.services).toBe(local);
    expect(result.current.source).toBe("local");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("flag ON — reconciles the directory to a healthy non-empty Supabase result", async () => {
    const local = [service("svc_local")];
    const remote = [service("svc_remote_1"), service("svc_global", null)];
    listMock.mockResolvedValue(remote);

    const { result } = renderHook(() =>
      useServiceDirectorySource({ companyId: "A", localServices: local, authNonce: "u1" }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.services).toEqual(remote);
    expect(listMock).toHaveBeenCalledWith("A");
    expect(getServiceCutoverState().supabaseReads).toBe(1);
  });

  it("query error — keeps the local seed and records a fallback (never blanks)", async () => {
    const local = [service("svc_local")];
    listMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useServiceDirectorySource({ companyId: "A", localServices: local, authNonce: "u1" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.services).toBe(local);
    expect(result.current.source).toBe("local");
    expect(result.current.error).toBe("network down");
    expect(getServiceCutoverState().fallbacks).toBe(1);
  });

  it("unsafe empty — empty Supabase while local has data keeps the local seed", async () => {
    const local = [service("svc_local")];
    listMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useServiceDirectorySource({ companyId: "A", localServices: local, authNonce: "u1" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.services).toBe(local);
    expect(result.current.source).toBe("local");
    expect(getServiceCutoverState().unsafeEmptyReads).toBe(1);
  });

  it("Supabase Auth ON — skips the pre-auth read, then re-fetches on null → id", async () => {
    const local = [service("svc_local")];
    const remote = [service("svc_remote_1")];
    listMock.mockResolvedValue(remote);

    const { result, rerender } = renderHook(
      ({ authNonce }: { authNonce: string | null }) =>
        useServiceDirectorySource({ companyId: "A", localServices: local, authNonce }),
      { initialProps: { authNonce: null as string | null } },
    );

    // Pre-auth: no Supabase read fired, local seed served.
    expect(listMock).not.toHaveBeenCalled();
    expect(result.current.source).toBe("local");
    expect(result.current.services).toBe(local);

    // Auth becomes ready (null → id): the read now fires and reconciles.
    rerender({ authNonce: "u1" });
    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith("A");
    expect(result.current.services).toEqual(remote);
  });

  it("shadow drift — a background mismatch is recorded after a healthy serve", async () => {
    const local = [service("svc_local")];
    listMock.mockResolvedValue([service("svc_remote")]);
    shadowMock.mockResolvedValue({
      ...OK_REPORT,
      ok: false,
      countMatch: false,
      notes: ["count mismatch: local 1 vs supabase 2"],
    });

    const { result } = renderHook(() =>
      useServiceDirectorySource({ companyId: "A", localServices: local, authNonce: "u1" }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    await waitFor(() => expect(getServiceCutoverState().shadowDrift).toBe(1));
    expect(getServiceCutoverState().lastMismatch).toBe(
      "count mismatch: local 1 vs supabase 2",
    );
  });
});
