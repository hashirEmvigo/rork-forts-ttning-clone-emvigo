import { describe, it, expect } from "vitest";

import { SERVICE_FEATURE_REGISTRY } from "@/lib/serviceRegistry";
import type {
  CompanyServiceEntitlement,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import type { LegacyEntitlementState } from "./backfill";
import {
  formatShadowReport,
  runShadowComparison,
  type ShadowComparisonReport,
} from "./shadowCompare";

/**
 * Phase 5 — Shadow Comparison harness verification.
 *
 * These tests prove the harness itself is correct: it reports parity when the
 * new bundle-first pipeline reproduces the legacy resolver, and surfaces a
 * mismatch when (in a deliberately corrupted run) the two would diverge. They
 * are pure unit tests — no Supabase, no I/O, no production wiring.
 */

const NOW = new Date("2025-06-01T12:00:00.000Z");
const PTE: ServiceFeatureKey = "preferred_time_evaluation";
const MEDIA: ServiceFeatureKey = "media_uploads";

function companyEntitlement(
  over: Partial<CompanyServiceEntitlement> & {
    companyId: string;
    serviceKey: ServiceFeatureKey;
  },
): CompanyServiceEntitlement {
  return {
    enabled: true,
    enabledAt: NOW.toISOString(),
    disabledAt: null,
    updatedBy: null,
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

function globalRecord(
  serviceKey: ServiceFeatureKey,
  enabled: boolean,
): ServiceGlobalEntitlement {
  return { serviceKey, enabled, updatedBy: null, updatedAt: NOW.toISOString() };
}

function baseState(over: Partial<LegacyEntitlementState> = {}): LegacyEntitlementState {
  return {
    companyIds: ["company-a", "company-b"],
    companyEntitlements: [],
    globalEntitlements: [],
    systemSettings: { allowPreferredTimeEvaluation: true },
    now: NOW,
    ...over,
  };
}

describe("runShadowComparison — parity over synthetic state", () => {
  it("passes on registry-default-only state (no records, PTE gate on)", () => {
    const report = runShadowComparison(baseState());
    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
    expect(report.loadIssues).toEqual([]);
    expect(report.basePlanInvariantHolds).toBe(true);
  });

  it("compares every company × service × field", () => {
    const report = runShadowComparison(baseState());
    // 2 companies × N services × (globallyAvailable, status, entitled) + limits.
    const limitFieldCount = SERVICE_FEATURE_REGISTRY.reduce(
      (n, d) => n + (d.limits?.length ?? 0),
      0,
    );
    const expected =
      report.companyCount * (report.serviceCount * 3 + limitFieldCount);
    expect(report.comparisonCount).toBe(expected);
  });

  it("passes when an explicit company record enables a premium add-on", () => {
    const report = runShadowComparison(
      baseState({
        companyEntitlements: [
          companyEntitlement({ companyId: "company-a", serviceKey: MEDIA, status: "enabled" }),
        ],
      }),
    );
    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
  });

  it("passes when a company is put on a trial of a premium add-on", () => {
    const report = runShadowComparison(
      baseState({
        companyEntitlements: [
          companyEntitlement({ companyId: "company-b", serviceKey: MEDIA, status: "trial" }),
        ],
      }),
    );
    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
  });

  it("passes when a default-enabled feature is explicitly disabled for one company", () => {
    const report = runShadowComparison(
      baseState({
        companyEntitlements: [
          companyEntitlement({
            companyId: "company-a",
            serviceKey: PTE,
            enabled: false,
            status: "disabled",
          }),
        ],
      }),
    );
    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
  });

  it("passes with the PTE master gate OFF (global gate collapses status)", () => {
    const report = runShadowComparison(
      baseState({ systemSettings: { allowPreferredTimeEvaluation: false } }),
    );
    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
  });

  it("passes when a global record disables media platform-wide", () => {
    const report = runShadowComparison(
      baseState({
        globalEntitlements: [globalRecord(MEDIA, false)],
        companyEntitlements: [
          companyEntitlement({ companyId: "company-a", serviceKey: MEDIA, status: "enabled" }),
        ],
      }),
    );
    // Global gate wins in both paths → still disabled for everyone.
    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
  });

  it("is deterministic: identical input yields identical reports", () => {
    const state = baseState({
      companyEntitlements: [
        companyEntitlement({ companyId: "company-b", serviceKey: MEDIA, status: "trial" }),
      ],
    });
    const a = runShadowComparison(state);
    const b = runShadowComparison(state);
    expect(a).toEqual(b);
  });

  it("includes companies referenced only by a record", () => {
    const report = runShadowComparison(
      baseState({
        companyIds: [],
        companyEntitlements: [
          companyEntitlement({ companyId: "company-z", serviceKey: MEDIA, status: "enabled" }),
        ],
      }),
    );
    expect(report.companyCount).toBe(1);
    expect(report.passed).toBe(true);
  });
});

describe("runShadowComparison — mismatch detection", () => {
  it("reports a mismatch when the registries diverge between the two paths", () => {
    // Feed the harness a registry whose media trial allowance differs from the
    // code registry the resolver/backfill default to, forcing a limit mismatch.
    const driftedRegistry = SERVICE_FEATURE_REGISTRY.map((d) =>
      d.serviceKey === MEDIA
        ? {
            ...d,
            trialLimit: 999,
            limits: (d.limits ?? []).map((l) => ({ ...l, defaultValue: 30 })),
          }
        : d,
    );
    const report = runShadowComparison(baseState({ registry: driftedRegistry }));
    expect(report.passed).toBe(false);
    expect(report.mismatchCount).toBeGreaterThan(0);
    expect(report.summaryByField["limit:media_upload_count"]).toBeGreaterThan(0);
    const m = report.mismatches.find((x) => x.field === "limit:media_upload_count");
    expect(m?.legacy).toBe("999");
    expect(m?.new).toBe("30");
  });

  it("sorts mismatches by (companyId, serviceKey, field)", () => {
    const driftedRegistry = SERVICE_FEATURE_REGISTRY.map((d) =>
      d.serviceKey === MEDIA
        ? { ...d, trialLimit: 999 }
        : d,
    );
    const report = runShadowComparison(baseState({ registry: driftedRegistry }));
    const sorted = [...report.mismatches].sort((a, b) => {
      const c = a.companyId.localeCompare(b.companyId);
      if (c !== 0) return c;
      const s = a.serviceKey.localeCompare(b.serviceKey);
      if (s !== 0) return s;
      return a.field.localeCompare(b.field);
    });
    expect(report.mismatches).toEqual(sorted);
  });
});

describe("formatShadowReport", () => {
  it("emits a single summary line when there are no mismatches", () => {
    const report = runShadowComparison(baseState());
    const text = formatShadowReport(report);
    expect(text).toContain("[shadow] summary passed=true");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("emits one line per mismatch plus a summary line", () => {
    const driftedRegistry = SERVICE_FEATURE_REGISTRY.map((d) =>
      d.serviceKey === MEDIA ? { ...d, trialLimit: 999 } : d,
    );
    const report: ShadowComparisonReport = runShadowComparison(
      baseState({ registry: driftedRegistry }),
    );
    const lines = formatShadowReport(report).split("\n");
    expect(lines).toHaveLength(report.mismatchCount + 1);
    expect(lines[lines.length - 1]).toContain("summary passed=false");
  });
});
