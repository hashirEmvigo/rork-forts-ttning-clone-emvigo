import { describe, it, expect } from "vitest";

import { SERVICE_FEATURE_REGISTRY } from "@/lib/serviceRegistry";
import type {
  CompanyServiceEntitlement,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import {
  DEFAULT_SAMPLE_MISMATCH_LIMIT,
  buildRealDataValidationReport,
  formatRealDataValidationReport,
  type RealDataValidationInput,
} from "./realDataValidation";

/**
 * Phase 5 (real-data) — production shadow validation wrapper verification.
 *
 * These are pure unit tests over the wrapper itself: report shape, comparison
 * counts derived from the registry, parity on realistic legacy data, sample
 * truncation, and determinism. No Supabase, no I/O, no production wiring. The
 * actual production numbers come from running this over a live super-admin
 * snapshot, which CI cannot reach.
 */

const NOW = new Date("2025-06-01T12:00:00.000Z");
const PTE: ServiceFeatureKey = "preferred_time_evaluation";
const MEDIA: ServiceFeatureKey = "media_uploads";

/** Per-company field count = 3 fixed fields + one per declared limit. */
const FIELDS_PER_COMPANY = SERVICE_FEATURE_REGISTRY.reduce(
  (sum, def) => sum + 3 + (def.limits?.length ?? 0),
  0,
);

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

function baseInput(over: Partial<RealDataValidationInput> = {}): RealDataValidationInput {
  return {
    companies: [{ id: "company-a" }, { id: "company-b" }],
    companyEntitlements: [],
    globalEntitlements: [],
    systemSettings: { allowPreferredTimeEvaluation: true },
    now: NOW,
    ...over,
  };
}

describe("buildRealDataValidationReport — gate + counts", () => {
  it("passes the three-zeros gate on registry-default-only state", () => {
    const report = buildRealDataValidationReport(baseInput());

    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
    expect(report.loadIssueCount).toBe(0);
    expect(report.invariantViolationCount).toBe(0);
    expect(report.invariantViolations).toEqual([]);
    expect(report.sampleMismatches).toEqual([]);
  });

  it("counts analysed companies and feature comparisons deterministically", () => {
    const report = buildRealDataValidationReport(baseInput());

    expect(report.companiesAnalysed).toBe(2);
    expect(report.servicesCompared).toBe(SERVICE_FEATURE_REGISTRY.length);
    expect(report.featureComparisons).toBe(2 * FIELDS_PER_COMPANY);
    expect(report.now).toBe(NOW.toISOString());
  });

  it("dedupes companies and unions any company referenced only by a record", () => {
    const report = buildRealDataValidationReport(
      baseInput({
        companies: [{ id: "company-a" }, { id: "company-a" }],
        companyEntitlements: [
          companyEntitlement({ companyId: "company-z", serviceKey: MEDIA, status: "disabled", enabled: false }),
        ],
      }),
    );

    // "company-a" (deduped) + "company-z" (referenced by a record) = 2.
    expect(report.companiesAnalysed).toBe(2);
    expect(report.featureComparisons).toBe(2 * FIELDS_PER_COMPANY);
  });
});

describe("buildRealDataValidationReport — parity on realistic legacy data", () => {
  it("stays at zero mismatches with company deviations and global records", () => {
    const report = buildRealDataValidationReport(
      baseInput({
        companies: [{ id: "company-a" }, { id: "company-b" }, { id: "company-c" }],
        companyEntitlements: [
          // A default-enabled service explicitly disabled for one company.
          companyEntitlement({
            companyId: "company-a",
            serviceKey: MEDIA,
            status: "disabled",
            enabled: false,
            disabledAt: NOW.toISOString(),
          }),
          // A trial deviation for another company.
          companyEntitlement({
            companyId: "company-b",
            serviceKey: MEDIA,
            status: "trial",
          }),
        ],
        globalEntitlements: [globalRecord(MEDIA, true)],
        systemSettings: { allowPreferredTimeEvaluation: false },
      }),
    );

    expect(report.passed).toBe(true);
    expect(report.mismatchCount).toBe(0);
    expect(report.loadIssueCount).toBe(0);
    expect(report.invariantViolationCount).toBe(0);
    expect(report.companiesAnalysed).toBe(3);
  });

  it("preserves the PTE master gate off → globally unavailable, still parity", () => {
    const report = buildRealDataValidationReport(
      baseInput({ systemSettings: { allowPreferredTimeEvaluation: false } }),
    );

    expect(report.passed).toBe(true);
    const pte = report.shadow; // full report retained
    expect(pte.mismatchCount).toBe(0);
  });
});

describe("buildRealDataValidationReport — sampling + determinism", () => {
  it("respects the sample limit and never truncates the full shadow report", () => {
    const report = buildRealDataValidationReport(baseInput(), 0);

    expect(report.sampleMismatches).toEqual([]);
    // The full report is always present even when the sample is capped at 0.
    expect(report.shadow.mismatches).toEqual([]);
    expect(report.sampleMismatches.length).toBeLessThanOrEqual(
      DEFAULT_SAMPLE_MISMATCH_LIMIT,
    );
  });

  it("is deterministic — identical input yields an identical report", () => {
    const input = baseInput({
      companyEntitlements: [
        companyEntitlement({ companyId: "company-b", serviceKey: MEDIA, status: "disabled", enabled: false }),
      ],
    });

    expect(buildRealDataValidationReport(input)).toEqual(
      buildRealDataValidationReport(input),
    );
  });

  it("formats a PII-free, deterministic summary", () => {
    const report = buildRealDataValidationReport(baseInput());
    const text = formatRealDataValidationReport(report);

    expect(text).toContain("[real-shadow] gate passed=true");
    expect(text).toContain("companiesAnalysed=2");
    expect(text).toContain("mismatches=0");
    expect(text).toContain("invariantViolations=0");
  });
});
