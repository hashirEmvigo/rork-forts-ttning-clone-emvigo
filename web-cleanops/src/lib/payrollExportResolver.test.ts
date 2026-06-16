import { describe, expect, it } from "vitest";

import type {
  PayrollExportCapability,
  PayrollExportProfile,
  PayrollExportRun,
  PayrollExportTargetKey,
} from "@/types";

import {
  availableTargetsForCompany,
  buildCapabilityIndex,
  isTargetEnabledForCompany,
  profilesForCompany,
  runnableProfiles,
  runsForCompany,
} from "./payrollExportResolver";

const NOW = "2025-06-01T12:00:00.000Z";

function cap(
  companyId: string,
  target: PayrollExportTargetKey,
  enabled: boolean,
): PayrollExportCapability {
  return { companyId, target, enabled, enabledAt: enabled ? NOW : null, updatedBy: null, updatedAt: NOW };
}

function profile(
  id: string,
  companyId: string,
  target: PayrollExportTargetKey,
  active: boolean,
  createdAt = NOW,
): PayrollExportProfile {
  return {
    id,
    companyId,
    name: id,
    target,
    active,
    config: {},
    credentialsRef: null,
    createdBy: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("payrollExportResolver — capabilities", () => {
  it("treats missing capability records as disabled", () => {
    const index = buildCapabilityIndex([]);
    expect(isTargetEnabledForCompany(index, "c1", "csv")).toBe(false);
  });

  it("reads enabled capabilities by company + target", () => {
    const index = buildCapabilityIndex([cap("c1", "csv", true), cap("c1", "fortnox", false)]);
    expect(isTargetEnabledForCompany(index, "c1", "csv")).toBe(true);
    expect(isTargetEnabledForCompany(index, "c1", "fortnox")).toBe(false);
    expect(isTargetEnabledForCompany(index, "c2", "csv")).toBe(false);
  });

  it("lists enabled targets, optionally only implemented adapters", () => {
    const index = buildCapabilityIndex([
      cap("c1", "csv", true),
      cap("c1", "fortnox", true),
    ]);
    expect(availableTargetsForCompany(index, "c1")).toEqual(["csv", "fortnox"]);
    // Only csv has a real adapter in the foundation phase.
    expect(availableTargetsForCompany(index, "c1", { onlyImplemented: true })).toEqual(["csv"]);
  });
});

describe("payrollExportResolver — profiles & runs", () => {
  it("returns profiles for a company in creation order", () => {
    const profiles = [
      profile("p2", "c1", "csv", true, "2025-02-01T00:00:00.000Z"),
      profile("p1", "c1", "csv", true, "2025-01-01T00:00:00.000Z"),
      profile("p3", "c2", "csv", true),
    ];
    expect(profilesForCompany(profiles, "c1").map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("only returns runnable profiles: active, entitled, implemented", () => {
    const index = buildCapabilityIndex([cap("c1", "csv", true), cap("c1", "fortnox", true)]);
    const profiles = [
      profile("active-csv", "c1", "csv", true),
      profile("inactive-csv", "c1", "csv", false),
      profile("active-fortnox", "c1", "fortnox", true), // not implemented
    ];
    expect(runnableProfiles(profiles, index, "c1").map((p) => p.id)).toEqual(["active-csv"]);
  });

  it("excludes a profile whose target was later disabled", () => {
    const index = buildCapabilityIndex([cap("c1", "csv", false)]);
    const profiles = [profile("p1", "c1", "csv", true)];
    expect(runnableProfiles(profiles, index, "c1")).toHaveLength(0);
  });

  it("returns runs for a company, most recent first", () => {
    const runs: PayrollExportRun[] = [
      { id: "r1", companyId: "c1", profileId: "p1", basisId: null, status: "success", timestamp: "2025-01-01T00:00:00.000Z", userId: null, rowsIncluded: 1, warnings: [], errors: [], resultRef: null, createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "r2", companyId: "c1", profileId: "p1", basisId: null, status: "failed", timestamp: "2025-03-01T00:00:00.000Z", userId: null, rowsIncluded: 0, warnings: [], errors: ["x"], resultRef: null, createdAt: "2025-03-01T00:00:00.000Z" },
      { id: "r3", companyId: "c2", profileId: "p9", basisId: null, status: "success", timestamp: "2025-04-01T00:00:00.000Z", userId: null, rowsIncluded: 2, warnings: [], errors: [], resultRef: null, createdAt: "2025-04-01T00:00:00.000Z" },
    ];
    expect(runsForCompany(runs, "c1").map((r) => r.id)).toEqual(["r2", "r1"]);
  });
});
