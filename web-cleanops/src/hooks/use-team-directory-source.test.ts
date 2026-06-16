import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * TEAM-2 — Team directory read-seam hook.
 *
 * Proves the read-source switch {@link useTeamDirectorySource} is safe and
 * behaviour-neutral when OFF, and correctly reconciles to Supabase when ON — with
 * the TEAM-2 safety guarantees: synchronous localStorage fallback, unsafe-empty
 * protection (never blanks the directory), and background shadow-drift reporting.
 */

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock("@/lib/data/supabaseTeamRepository", () => ({
  listFullTeamsFromSupabase: vi.fn(),
}));

vi.mock("@/lib/data/teamMigration", () => ({
  shadowReadTeams: vi.fn(),
}));

vi.mock("@/lib/data/teamCutover", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/data/teamCutover");
  return { ...actual, shouldReadTeamsFromSupabase: vi.fn(() => true) };
});

import type { Team } from "@/types";
import type { TeamShadowReport } from "@/lib/data/teamMigration";
import { listFullTeamsFromSupabase } from "@/lib/data/supabaseTeamRepository";
import { shadowReadTeams } from "@/lib/data/teamMigration";
import {
  shouldReadTeamsFromSupabase,
  getTeamCutoverState,
  resetTeamCutoverState,
} from "@/lib/data/teamCutover";
import { useTeamDirectorySource } from "./use-team-directory-source";

function team(id: string, companyId = "A"): Team {
  return { id, companyId, name: id, createdAt: "2026-01-01T00:00:00.000Z" };
}

const OK_REPORT: TeamShadowReport = {
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

const listMock = vi.mocked(listFullTeamsFromSupabase);
const shadowMock = vi.mocked(shadowReadTeams);
const enabledMock = vi.mocked(shouldReadTeamsFromSupabase);

beforeEach(() => {
  resetTeamCutoverState();
  listMock.mockReset();
  shadowMock.mockReset();
  enabledMock.mockReset();
  enabledMock.mockReturnValue(true);
  listMock.mockResolvedValue([]);
  shadowMock.mockResolvedValue(OK_REPORT);
});

describe("TEAM-2 · useTeamDirectorySource", () => {
  it("flag OFF — serves the local seed synchronously, never calls Supabase", () => {
    enabledMock.mockReturnValue(false);
    const local = [team("team_local")];

    const { result } = renderHook(() =>
      useTeamDirectorySource({ companyId: "A", localTeams: local }),
    );

    expect(result.current.teams).toBe(local);
    expect(result.current.source).toBe("local");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("flag ON — reconciles the directory to a healthy non-empty Supabase result", async () => {
    const local = [team("team_local")];
    const remote = [team("team_remote_1"), team("team_remote_2")];
    listMock.mockResolvedValue(remote);

    const { result } = renderHook(() =>
      useTeamDirectorySource({ companyId: "A", localTeams: local }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    expect(result.current.teams).toEqual(remote);
    expect(listMock).toHaveBeenCalledWith("A");
    expect(getTeamCutoverState().supabaseReads).toBe(1);
  });

  it("query error — keeps the local seed and records a fallback (never blanks)", async () => {
    const local = [team("team_local")];
    listMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useTeamDirectorySource({ companyId: "A", localTeams: local }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.teams).toBe(local);
    expect(result.current.source).toBe("local");
    expect(result.current.error).toBe("network down");
    expect(getTeamCutoverState().fallbacks).toBe(1);
  });

  it("unsafe empty — empty Supabase while local has data keeps the local seed", async () => {
    const local = [team("team_local")];
    listMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useTeamDirectorySource({ companyId: "A", localTeams: local }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.teams).toBe(local);
    expect(result.current.source).toBe("local");
    expect(getTeamCutoverState().unsafeEmptyReads).toBe(1);
  });

  it("shadow drift — a background mismatch is recorded after a healthy serve", async () => {
    const local = [team("team_local")];
    listMock.mockResolvedValue([team("team_remote")]);
    shadowMock.mockResolvedValue({
      ...OK_REPORT,
      ok: false,
      countMatch: false,
      notes: ["count mismatch: local 1 vs supabase 2"],
    });

    const { result } = renderHook(() =>
      useTeamDirectorySource({ companyId: "A", localTeams: local }),
    );

    await waitFor(() => expect(result.current.source).toBe("supabase"));
    await waitFor(() => expect(getTeamCutoverState().shadowDrift).toBe(1));
    expect(getTeamCutoverState().lastMismatch).toBe(
      "count mismatch: local 1 vs supabase 2",
    );
  });
});
