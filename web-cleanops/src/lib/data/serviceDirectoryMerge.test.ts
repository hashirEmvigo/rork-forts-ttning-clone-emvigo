import { describe, expect, it } from "vitest";

import type { Service } from "@/types";
import {
  mergeServiceDirectory,
  DEFAULT_MIRROR_WINDOW_MS,
} from "./serviceDirectoryMerge";

const NOW = Date.parse("2026-06-04T10:00:00.000Z");
const RECENT = "2026-06-04T09:59:30.000Z"; // 30s ago — inside the window
const STALE = "2026-06-04T09:30:00.000Z"; // 30m ago — outside the 10m window

function service(id: string, updatedAt: string, name: string = id): Service {
  return {
    id,
    companyId: "A",
    categoryId: null,
    name,
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("mergeServiceDirectory", () => {
  it("serves remote rows unchanged when local adds nothing new", () => {
    const remote = [service("a", RECENT), service("b", RECENT)];
    const local = [service("a", RECENT), service("b", RECENT)];
    const merged = mergeServiceDirectory(remote, local, NOW);
    expect(merged.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("preserves a freshly-created local-only service while inside the mirror window", () => {
    const remote = [service("a", RECENT)];
    const local = [service("a", RECENT), service("new", RECENT)];
    const merged = mergeServiceDirectory(remote, local, NOW);
    expect(merged.map((s) => s.id)).toContain("new");
  });

  it("does NOT resurrect a local-only service that is outside the mirror window", () => {
    // Simulates a service deleted on another client: gone from remote, lingering
    // in this client's localStorage with a stale stamp.
    const remote = [service("a", RECENT)];
    const local = [service("a", RECENT), service("deleted-elsewhere", STALE)];
    const merged = mergeServiceDirectory(remote, local, NOW);
    expect(merged.map((s) => s.id)).not.toContain("deleted-elsewhere");
  });

  it("prefers a strictly-newer local edit of a remote row (pending mirror)", () => {
    const remote = [service("a", STALE, "old name")];
    const local = [service("a", RECENT, "new name")];
    const merged = mergeServiceDirectory(remote, local, NOW);
    expect(merged.find((s) => s.id === "a")?.name).toBe("new name");
  });

  it("keeps the remote copy when remote is newer than local (cross-client update wins)", () => {
    const remote = [service("a", RECENT, "remote name")];
    const local = [service("a", STALE, "local name")];
    const merged = mergeServiceDirectory(remote, local, NOW);
    expect(merged.find((s) => s.id === "a")?.name).toBe("remote name");
  });

  it("never duplicates a service present in both remote and local", () => {
    const remote = [service("a", RECENT)];
    const local = [service("a", RECENT)];
    const merged = mergeServiceDirectory(remote, local, NOW);
    expect(merged.filter((s) => s.id === "a")).toHaveLength(1);
  });

  it("uses a ~10 minute default window", () => {
    expect(DEFAULT_MIRROR_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});
