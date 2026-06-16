import { describe, it, expect } from "vitest";

import {
  SERVICE_FEATURE_REGISTRY,
  evaluateUsageGate,
  getServiceDefinition,
  resolveEffectiveCompanyStatus,
} from "@/lib/serviceRegistry";
import { defaultSystemSettings } from "@/types";
import type {
  CompanyServiceEntitlement,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
  SystemSettings,
} from "@/types";

import {
  BASELINE_BUNDLE_ID,
  BASELINE_BUNDLE_SLUG,
  buildSyntheticBackfill,
  type LegacyEntitlementState,
} from "./backfill";
import {
  buildResolutionContext,
  normalizeAssignments,
  normalizeBundles,
  normalizeOverrides,
} from "./normalize";
import { resolveCompanyEntitlements } from "./resolver";

/**
 * Phase 4 — Synthetic Bundle Backfill verification.
 *
 * These tests prove the backfill TRANSLATION is correct: structural invariants,
 * sparsity, normalizer-validity, and per-service parity with the legacy
 * resolver over synthetic fixtures. This is NOT the Phase 5 production shadow
 * comparison — parity is computed here against the legacy functions on
 * deterministic fixtures purely to verify the translation itself.
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

function systemSettings(allowPTE: boolean): SystemSettings {
  return { ...defaultSystemSettings(), allowPreferredTimeEvaluation: allowPTE };
}

/** Runs the synthetic rows through the real normalizer → resolver pipeline. */
function resolveSynthetic(state: LegacyEntitlementState, companyId: string) {
  const backfill = buildSyntheticBackfill({ ...state, now: NOW });
  const { bundles, issues: bundleIssues } = normalizeBundles({
    bundles: backfill.bundles,
    grants: backfill.grants,
    grantLimits: backfill.grantLimits,
  });
  const assignments = normalizeAssignments(backfill.assignments, NOW);
  const { overrides, issues: overrideIssues } = normalizeOverrides(
    { overrides: backfill.overrides, overrideLimits: backfill.overrideLimits },
    NOW,
  );
  const context = buildResolutionContext({
    globalEntitlements: backfill.globalEntitlements,
    bundles,
    assignments,
    overrides,
    now: NOW,
  });
  return {
    backfill,
    issues: [...bundleIssues, ...overrideIssues],
    resolved: resolveCompanyEntitlements(context, companyId),
  };
}

// ── 1. Structural invariants ───────────────────────────────────────────────

describe("Phase 4 · backfill structure", () => {
  it("emits exactly one base plan and one base assignment per company", () => {
    const state: LegacyEntitlementState = {
      companyIds: ["cmp_b", "cmp_a", "cmp_c"],
      companyEntitlements: [],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
    };
    const { bundles, assignments, stats } = buildSyntheticBackfill({ ...state, now: NOW });

    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.id).toBe(BASELINE_BUNDLE_ID);
    expect(bundles[0]?.slug).toBe(BASELINE_BUNDLE_SLUG);
    expect(bundles[0]?.bundle_type).toBe("base_plan");

    expect(assignments).toHaveLength(3);
    expect(assignments.every((a) => a.role === "base" && a.status === "active")).toBe(true);
    expect(assignments.every((a) => a.bundle_id === BASELINE_BUNDLE_ID && a.ends_at === null)).toBe(true);
    // Deterministically sorted by company id.
    expect(assignments.map((a) => a.company_id)).toEqual(["cmp_a", "cmp_b", "cmp_c"]);
    expect(stats.assignmentCount).toBe(3);
  });

  it("grants only default-enabled services in the baseline plan", () => {
    const { grants } = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    const granted = grants.map((g) => g.service_key);
    for (const def of SERVICE_FEATURE_REGISTRY) {
      if (def.defaultCompanyEnabled) {
        expect(granted).toContain(def.serviceKey);
      } else {
        expect(granted).not.toContain(def.serviceKey);
      }
    }
    expect(grants.every((g) => g.status === "enabled")).toBe(true);
    // PTE defaults enabled, media_uploads defaults disabled.
    expect(granted).toContain(PTE);
    expect(granted).not.toContain(MEDIA);
  });

  it("includes companies referenced only by a record, even if absent from companyIds", () => {
    const { assignments } = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [companyEntitlement({ companyId: "cmp_z", serviceKey: MEDIA, status: "trial" })],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    expect(assignments.map((a) => a.company_id).sort()).toEqual(["cmp_a", "cmp_z"]);
  });
});

// ── 2. Sparsity of overrides ────────────────────────────────────────────────

describe("Phase 4 · override sparsity", () => {
  it("emits no override when the explicit record matches the registry default", () => {
    // PTE default is enabled; an explicit enabled record is not a deviation.
    const { overrides } = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [companyEntitlement({ companyId: "cmp_a", serviceKey: PTE, status: "enabled" })],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    expect(overrides).toHaveLength(0);
  });

  it("emits a sparse override only for deviating records, carrying the legacy status", () => {
    const { overrides } = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [
        // Deviates: media_uploads default disabled → trial.
        companyEntitlement({ companyId: "cmp_a", serviceKey: MEDIA, status: "trial" }),
        // Deviates: PTE default enabled → disabled.
        companyEntitlement({ companyId: "cmp_a", serviceKey: PTE, status: "disabled", enabled: false }),
      ],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    expect(overrides).toHaveLength(2);
    const media = overrides.find((o) => o.service_key === MEDIA);
    const pte = overrides.find((o) => o.service_key === PTE);
    expect(media?.status).toBe("trial");
    expect(pte?.status).toBe("disabled");
    expect(overrides.every((o) => o.reason.length > 0 && o.ends_at === null)).toBe(true);
  });

  it("skips and counts records with an unknown service key", () => {
    const { overrides, stats } = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [
        companyEntitlement({
          companyId: "cmp_a",
          serviceKey: "ghost_feature" as ServiceFeatureKey,
          status: "trial",
        }),
      ],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    expect(overrides).toHaveLength(0);
    expect(stats.skippedUnknownServiceKeys).toBe(1);
  });
});

// ── 3. Global layer ──────────────────────────────────────────────────────────

describe("Phase 4 · global entitlements", () => {
  it("bridges the PTE master gate into a synthetic global record", () => {
    const off = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [],
      globalEntitlements: [],
      systemSettings: systemSettings(false),
      now: NOW,
    });
    const on = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [],
      globalEntitlements: [],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    expect(off.globalEntitlements.find((g) => g.serviceKey === PTE)?.enabled).toBe(false);
    expect(on.globalEntitlements.find((g) => g.serviceKey === PTE)?.enabled).toBe(true);
  });

  it("preserves an existing global record and defaults the rest", () => {
    const existing: ServiceGlobalEntitlement = {
      serviceKey: MEDIA,
      enabled: false,
      updatedBy: "su_1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const { globalEntitlements } = buildSyntheticBackfill({
      companyIds: ["cmp_a"],
      companyEntitlements: [],
      globalEntitlements: [existing],
      systemSettings: systemSettings(true),
      now: NOW,
    });
    const media = globalEntitlements.find((g) => g.serviceKey === MEDIA);
    expect(media).toEqual(existing);
    // One record per registry service.
    expect(globalEntitlements).toHaveLength(SERVICE_FEATURE_REGISTRY.length);
  });
});

// ── 4. Normalizer validity ───────────────────────────────────────────────────

describe("Phase 4 · synthetic rows are normalizer-clean", () => {
  it("produces zero normalization issues across a mixed fixture", () => {
    const { issues } = resolveSynthetic(
      {
        companyIds: ["cmp_a", "cmp_b"],
        companyEntitlements: [
          companyEntitlement({ companyId: "cmp_a", serviceKey: MEDIA, status: "trial" }),
          companyEntitlement({ companyId: "cmp_b", serviceKey: PTE, status: "disabled", enabled: false }),
        ],
        globalEntitlements: [],
        systemSettings: systemSettings(true),
      },
      "cmp_a",
    );
    expect(issues).toHaveLength(0);
  });
});

// ── 5. Parity matrix (translation vs legacy resolver) ────────────────────────

interface MatrixCase {
  name: string;
  companyId: string;
  records: CompanyServiceEntitlement[];
  globals: ServiceGlobalEntitlement[];
  allowPTE: boolean;
}

const MATRIX: MatrixCase[] = [
  {
    name: "default-only company (no explicit records)",
    companyId: "cmp_default",
    records: [],
    globals: [],
    allowPTE: true,
  },
  {
    name: "media trial company (the seeded demo case)",
    companyId: "cmp_nordlys",
    records: [companyEntitlement({ companyId: "cmp_nordlys", serviceKey: MEDIA, status: "trial" })],
    globals: [],
    allowPTE: true,
  },
  {
    name: "PTE disabled by explicit record",
    companyId: "cmp_pte_off",
    records: [
      companyEntitlement({ companyId: "cmp_pte_off", serviceKey: PTE, status: "disabled", enabled: false }),
    ],
    globals: [],
    allowPTE: true,
  },
  {
    name: "media fully enabled by explicit record",
    companyId: "cmp_media_on",
    records: [companyEntitlement({ companyId: "cmp_media_on", serviceKey: MEDIA, status: "enabled" })],
    globals: [],
    allowPTE: true,
  },
  {
    name: "PTE master gate OFF collapses PTE to disabled",
    companyId: "cmp_gate_off",
    records: [],
    globals: [],
    allowPTE: false,
  },
  {
    name: "media globally disabled collapses to disabled despite enabled record",
    companyId: "cmp_media_gate_off",
    records: [companyEntitlement({ companyId: "cmp_media_gate_off", serviceKey: MEDIA, status: "enabled" })],
    globals: [
      { serviceKey: MEDIA, enabled: false, updatedBy: null, updatedAt: NOW.toISOString() },
    ],
    allowPTE: true,
  },
];

describe("Phase 4 · parity with the legacy resolver over synthetic fixtures", () => {
  for (const testCase of MATRIX) {
    it(`reproduces legacy effective status & limit — ${testCase.name}`, () => {
      const legacyOpts = {
        systemSettings: systemSettings(testCase.allowPTE),
        globalEntitlements: testCase.globals,
        companyEntitlements: testCase.records,
      };

      const { resolved, issues } = resolveSynthetic(
        {
          companyIds: [testCase.companyId],
          companyEntitlements: testCase.records,
          globalEntitlements: testCase.globals,
          systemSettings: systemSettings(testCase.allowPTE),
        },
        testCase.companyId,
      );
      expect(issues).toHaveLength(0);

      for (const def of SERVICE_FEATURE_REGISTRY) {
        const legacyStatus = resolveEffectiveCompanyStatus(
          def.serviceKey,
          testCase.companyId,
          legacyOpts,
        );
        const resolvedEntitlement = resolved.byService[def.serviceKey];
        expect(resolvedEntitlement?.status).toBe(legacyStatus);
        expect(resolvedEntitlement?.entitled).toBe(legacyStatus !== "disabled");

        // Limit parity: the new media_upload_count must equal the legacy
        // trial allowance the usage gate enforces.
        if (def.serviceKey === MEDIA) {
          const legacyGate = evaluateUsageGate(MEDIA, legacyStatus, 0);
          const resolvedLimit = resolvedEntitlement?.limits.find(
            (l) => l.limitKey === "media_upload_count",
          );
          const registryDefault = getServiceDefinition(MEDIA)?.trialLimit ?? null;
          // Resolver yields the registry default (30); the legacy gate caps trials at the same value.
          expect(resolvedLimit?.value).toBe(registryDefault);
          if (legacyStatus === "trial") {
            expect(legacyGate.limit).toBe(resolvedLimit?.value);
          }
        }
      }
    });
  }
});
