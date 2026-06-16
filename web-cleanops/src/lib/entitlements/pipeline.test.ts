import { describe, expect, it } from "vitest";

import type {
  FeatureLimitDefinition,
  LimitKey,
  ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import type {
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import {
  buildResolutionContext,
  normalizeAssignments,
  normalizeBundles,
  normalizeOverrides,
} from "./normalize";
import { resolveCompanyEntitlements } from "./resolver";
import type {
  BundleAssignmentRow,
  BundleGrantLimitRow,
  BundleGrantRow,
  BundleRow,
  CompanyOverrideLimitRow,
  CompanyOverrideRow,
  ResolvedCompanyEntitlements,
} from "./types";

/**
 * Phase 3 — Synthetic Data Verification.
 *
 * These tests exercise the COMPLETE bundle-first read pipeline in isolation:
 *
 *   raw Supabase-shaped rows
 *     → normalizeBundles / normalizeAssignments / normalizeOverrides   (pure)
 *     → buildResolutionContext                                          (pure)
 *     → resolveCompanyEntitlements                                      (pure)
 *     → ResolvedCompanyEntitlements
 *
 * This mirrors exactly what `loadEntitlementContext` does after its Supabase
 * fetch, minus the I/O. The goal is confidence that the new system behaves
 * correctly on its own BEFORE any legacy-parity (shadow) comparison.
 *
 * Scope guardrails honoured here:
 *   - No legacy resolver comparison.
 *   - No real company backfill.
 *   - No production wiring (this file imports nothing from the app surface).
 *   - No behaviour change to existing code.
 */

// Anchored instant so every validity-window and ordering assertion is
// deterministic and never depends on wall-clock time.
const NOW = new Date("2025-06-01T12:00:00.000Z");
const COMPANY = "company-under-test";
const OTHER_COMPANY = "some-other-company";

// ── Synthetic registry ───────────────────────────────────────────────────────
// The normalizer validates `service_key` against the code-owned registry via
// getServiceDefinition(), so fixtures must use REAL service keys. To exercise
// every merge kind end-to-end we redefine those real keys with one limit per
// merge kind; the normalizer validates `limit_key` against the *injected*
// registry, and the resolver reads `context.registry`, so the synthetic limits
// flow through the entire pipeline. (The resolver is generic over the registry
// it is handed — see resolver.test.ts.)

const lk = (s: string): LimitKey => s as LimitKey;

const LIM_MAX = "synthetic_numeric_max";
const LIM_SUM = "synthetic_numeric_sum";
const LIM_UNL = "synthetic_unlimited";
const LIM_ENUM = "synthetic_enum_priority";
const LIM_PINNED = "synthetic_exclusive_pinned";
const LIM_BOOL = "synthetic_boolean_or";

function limitDef(
  over: Partial<Omit<FeatureLimitDefinition, "limitKey">> & { limitKey: string },
): FeatureLimitDefinition {
  return {
    name: over.limitKey,
    valueType: "count",
    mergeKind: "numeric-max",
    defaultValue: null,
    billingEligible: false,
    ...over,
    limitKey: lk(over.limitKey),
  };
}

const MEDIA_KEY: ServiceFeatureKey = "media_uploads";
const PTE_KEY: ServiceFeatureKey = "preferred_time_evaluation";

/**
 * `media_uploads` carries one limit per merge kind so a single service exercises
 * all six approved behaviours when bundles stack.
 */
const SYNTH_REGISTRY: ServiceFeatureDefinition[] = [
  {
    serviceKey: MEDIA_KEY,
    name: "Media Uploads (synthetic)",
    description: "",
    category: "Media",
    icon: "ImagePlus",
    billingEligible: false,
    billingLabel: "Media Uploads",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    limits: [
      limitDef({ limitKey: LIM_MAX, mergeKind: "numeric-max", defaultValue: 10 }),
      limitDef({ limitKey: LIM_SUM, mergeKind: "numeric-sum", defaultValue: 0 }),
      limitDef({ limitKey: LIM_UNL, mergeKind: "unlimited-wins", defaultValue: null }),
      limitDef({
        limitKey: LIM_ENUM,
        valueType: "enum",
        mergeKind: "enum-priority",
        defaultValue: "low",
        enumPriority: ["low", "medium", "high"],
      }),
      limitDef({ limitKey: LIM_PINNED, mergeKind: "exclusive-pinned", defaultValue: 1 }),
      limitDef({
        limitKey: LIM_BOOL,
        valueType: "boolean",
        mergeKind: "boolean-or",
        defaultValue: false,
      }),
    ],
  },
  {
    // No limits: used for default/global/window/isolation assertions. Mirrors
    // the real registry's "default company enabled" posture for this service.
    serviceKey: PTE_KEY,
    name: "Preferred Time Evaluation (synthetic)",
    description: "",
    category: "Work Orders",
    icon: "Clock4",
    billingEligible: false,
    billingLabel: "Preferred Time Evaluation",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: true,
    supportsTrial: true,
  },
];

// ── Raw-row builders ─────────────────────────────────────────────────────────

function bundleRow(over: Partial<BundleRow> = {}): BundleRow {
  return {
    id: "b1",
    slug: "bundle-1",
    name: "Bundle 1",
    description: null,
    bundle_type: "addon",
    status: "active",
    is_assignable: true,
    billing_provider: null,
    billing_product_id: null,
    created_at: null,
    updated_at: null,
    ...over,
  };
}

function grantRow(over: Partial<BundleGrantRow> = {}): BundleGrantRow {
  return { id: "g1", bundle_id: "b1", service_key: MEDIA_KEY, status: "enabled", ...over };
}

function numericLimitRow(over: Partial<BundleGrantLimitRow> & { limit_key: string }): BundleGrantLimitRow {
  return {
    id: `gl-${over.limit_key}-${over.grant_id ?? "g1"}`,
    grant_id: "g1",
    limit_value: null,
    value_text: null,
    ...over,
  };
}

function assignmentRow(over: Partial<BundleAssignmentRow> = {}): BundleAssignmentRow {
  return {
    id: "a1",
    company_id: COMPANY,
    bundle_id: "b1",
    role: "addon",
    status: "active",
    starts_at: "2025-01-01T00:00:00.000Z",
    ends_at: null,
    ...over,
  };
}

function overrideRow(over: Partial<CompanyOverrideRow> = {}): CompanyOverrideRow {
  return {
    id: "o1",
    company_id: COMPANY,
    service_key: MEDIA_KEY,
    status: "enabled",
    reason: "negotiated",
    starts_at: "2025-01-01T00:00:00.000Z",
    ends_at: null,
    ...over,
  };
}

function overrideLimitRow(over: Partial<CompanyOverrideLimitRow> & { limit_key: string }): CompanyOverrideLimitRow {
  return {
    id: `ol-${over.limit_key}`,
    override_id: "o1",
    limit_value: null,
    value_text: null,
    ...over,
  };
}

// ── Pipeline driver ──────────────────────────────────────────────────────────

interface RawFixtures {
  bundles: BundleRow[];
  grants: BundleGrantRow[];
  grantLimits: BundleGrantLimitRow[];
  assignments: BundleAssignmentRow[];
  overrides?: CompanyOverrideRow[];
  overrideLimits?: CompanyOverrideLimitRow[];
  globalEntitlements?: ServiceGlobalEntitlement[];
}

/**
 * Runs raw rows through the real normalizer → context builder → resolver,
 * exactly as the loader would post-fetch. Returns the resolved picture plus the
 * normalization issues, so tests can assert on both behaviour and data quality.
 */
function runPipeline(
  raw: RawFixtures,
  companyId: string = COMPANY,
  now: Date = NOW,
): { resolved: ResolvedCompanyEntitlements; issues: ReturnType<typeof normalizeBundles>["issues"] } {
  const { bundles, issues: bundleIssues } = normalizeBundles(
    { bundles: raw.bundles, grants: raw.grants, grantLimits: raw.grantLimits },
    SYNTH_REGISTRY,
  );
  const assignments = normalizeAssignments(raw.assignments, now);
  const { overrides, issues: overrideIssues } = normalizeOverrides(
    { overrides: raw.overrides ?? [], overrideLimits: raw.overrideLimits ?? [] },
    now,
    SYNTH_REGISTRY,
  );

  const context = buildResolutionContext({
    registry: SYNTH_REGISTRY,
    globalEntitlements: raw.globalEntitlements ?? [],
    bundles,
    assignments,
    overrides,
    now,
  });

  return {
    resolved: resolveCompanyEntitlements(context, companyId),
    issues: [...bundleIssues, ...overrideIssues],
  };
}

function limitValue(
  resolved: ResolvedCompanyEntitlements,
  serviceKey: string,
  limitKey: string,
) {
  return resolved.byService[serviceKey]?.limits.find((l) => l.limitKey === limitKey);
}

// ── 1. Merge behaviours (all six kinds, end-to-end) ──────────────────────────

describe("Phase 3 · merge behaviours through the full pipeline", () => {
  it("numeric-max: highest stacked value wins", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow({ id: "b1", slug: "b1" }), bundleRow({ id: "b2", slug: "b2" })],
      grants: [
        grantRow({ id: "g1", bundle_id: "b1" }),
        grantRow({ id: "g2", bundle_id: "b2" }),
      ],
      grantLimits: [
        numericLimitRow({ grant_id: "g1", limit_key: LIM_MAX, limit_value: 100 }),
        numericLimitRow({ grant_id: "g2", limit_key: LIM_MAX, limit_value: 500 }),
      ],
      assignments: [
        assignmentRow({ id: "a1", bundle_id: "b1" }),
        assignmentRow({ id: "a2", bundle_id: "b2" }),
      ],
    });
    const lim = limitValue(resolved, MEDIA_KEY, LIM_MAX);
    expect(lim?.value).toBe(500);
    expect(lim?.source).toBe("bundle");
  });

  it("numeric-sum: stacked top-ups add together", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow({ id: "b1", slug: "b1" }), bundleRow({ id: "b2", slug: "b2" })],
      grants: [
        grantRow({ id: "g1", bundle_id: "b1" }),
        grantRow({ id: "g2", bundle_id: "b2" }),
      ],
      grantLimits: [
        numericLimitRow({ grant_id: "g1", limit_key: LIM_SUM, limit_value: 25 }),
        numericLimitRow({ grant_id: "g2", limit_key: LIM_SUM, limit_value: 75 }),
      ],
      assignments: [
        assignmentRow({ id: "a1", bundle_id: "b1" }),
        assignmentRow({ id: "a2", bundle_id: "b2" }),
      ],
    });
    expect(limitValue(resolved, MEDIA_KEY, LIM_SUM)?.value).toBe(100);
  });

  it("unlimited-wins: null default stays unlimited with no contribution", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [],
      assignments: [assignmentRow()],
    });
    const lim = limitValue(resolved, MEDIA_KEY, LIM_UNL);
    expect(lim?.value).toBeNull();
    expect(lim?.source).toBe("default");
  });

  it("unlimited-wins: a numeric contribution caps the value", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [numericLimitRow({ limit_key: LIM_UNL, limit_value: 250 })],
      assignments: [assignmentRow()],
    });
    expect(limitValue(resolved, MEDIA_KEY, LIM_UNL)?.value).toBe(250);
  });

  it("enum-priority: highest-ranked value present wins", () => {
    const { resolved } = runPipeline({
      bundles: [
        bundleRow({ id: "b1", slug: "b1" }),
        bundleRow({ id: "b2", slug: "b2" }),
        bundleRow({ id: "b3", slug: "b3" }),
      ],
      grants: [
        grantRow({ id: "g1", bundle_id: "b1" }),
        grantRow({ id: "g2", bundle_id: "b2" }),
        grantRow({ id: "g3", bundle_id: "b3" }),
      ],
      grantLimits: [
        numericLimitRow({ grant_id: "g1", limit_key: LIM_ENUM, value_text: "medium" }),
        numericLimitRow({ grant_id: "g2", limit_key: LIM_ENUM, value_text: "high" }),
        numericLimitRow({ grant_id: "g3", limit_key: LIM_ENUM, value_text: "low" }),
      ],
      assignments: [
        assignmentRow({ id: "a1", bundle_id: "b1" }),
        assignmentRow({ id: "a2", bundle_id: "b2" }),
        assignmentRow({ id: "a3", bundle_id: "b3" }),
      ],
    });
    expect(limitValue(resolved, MEDIA_KEY, LIM_ENUM)?.value).toBe("high");
  });

  it("exclusive-pinned: only the base plan contributes; addons are ignored", () => {
    const { resolved } = runPipeline({
      bundles: [
        bundleRow({ id: "base", slug: "base", bundle_type: "base_plan" }),
        bundleRow({ id: "addon", slug: "addon" }),
      ],
      grants: [
        grantRow({ id: "g-base", bundle_id: "base" }),
        grantRow({ id: "g-addon", bundle_id: "addon" }),
      ],
      grantLimits: [
        numericLimitRow({ grant_id: "g-base", limit_key: LIM_PINNED, limit_value: 3 }),
        numericLimitRow({ grant_id: "g-addon", limit_key: LIM_PINNED, limit_value: 99 }),
      ],
      assignments: [
        assignmentRow({ id: "a-base", bundle_id: "base", role: "base" }),
        assignmentRow({ id: "a-addon", bundle_id: "addon", role: "addon" }),
      ],
    });
    expect(limitValue(resolved, MEDIA_KEY, LIM_PINNED)?.value).toBe(3);
  });

  it("boolean-or: any granting bundle flips the flag true", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow({ id: "b1", slug: "b1" }), bundleRow({ id: "b2", slug: "b2" })],
      grants: [
        grantRow({ id: "g1", bundle_id: "b1" }),
        grantRow({ id: "g2", bundle_id: "b2" }),
      ],
      grantLimits: [
        numericLimitRow({ grant_id: "g1", limit_key: LIM_BOOL, limit_value: 0 }),
        numericLimitRow({ grant_id: "g2", limit_key: LIM_BOOL, limit_value: 1 }),
      ],
      assignments: [
        assignmentRow({ id: "a1", bundle_id: "b1" }),
        assignmentRow({ id: "a2", bundle_id: "b2" }),
      ],
    });
    expect(limitValue(resolved, MEDIA_KEY, LIM_BOOL)?.value).toBe(true);
  });
});

// ── 2. Override precedence ───────────────────────────────────────────────────

describe("Phase 3 · override precedence through the full pipeline", () => {
  it("override status replaces the merged bundle status", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "trial" })],
      grantLimits: [],
      assignments: [assignmentRow()],
      overrides: [overrideRow({ status: "enabled" })],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.status).toBe("enabled");
    expect(e.statusSource).toBe("override");
    expect(e.overrideId).toBe("o1");
  });

  it("override limit value wins over the bundle merge", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [numericLimitRow({ limit_key: LIM_MAX, limit_value: 500 })],
      assignments: [assignmentRow()],
      overrides: [overrideRow({ status: null })],
      overrideLimits: [overrideLimitRow({ limit_key: LIM_MAX, limit_value: 42 })],
    });
    const lim = limitValue(resolved, MEDIA_KEY, LIM_MAX);
    expect(lim?.value).toBe(42);
    expect(lim?.source).toBe("override");
  });

  it("null-status override adjusts limits only, leaving bundle status intact", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "trial" })],
      grantLimits: [],
      assignments: [assignmentRow()],
      overrides: [overrideRow({ status: null })],
      overrideLimits: [overrideLimitRow({ limit_key: LIM_MAX, limit_value: 7 })],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.status).toBe("trial");
    expect(e.statusSource).toBe("bundle");
    expect(limitValue(resolved, MEDIA_KEY, LIM_MAX)?.value).toBe(7);
  });
});

// ── 3. Global gate precedence ────────────────────────────────────────────────

describe("Phase 3 · global gate precedence through the full pipeline", () => {
  it("globally unavailable forces disabled even with an enabling bundle AND override", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [assignmentRow()],
      overrides: [overrideRow({ status: "enabled" })],
      globalEntitlements: [
        { serviceKey: MEDIA_KEY, enabled: false, updatedBy: null, updatedAt: NOW.toISOString() },
      ],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.globallyAvailable).toBe(false);
    expect(e.status).toBe("disabled");
    expect(e.entitled).toBe(false);
  });

  it("globally available + enabling bundle resolves through", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [assignmentRow()],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.globallyAvailable).toBe(true);
    expect(e.status).toBe("enabled");
    expect(e.statusSource).toBe("bundle");
    expect(e.contributingBundleIds).toEqual(["b1"]);
  });
});

// ── 4. Assignment validity windows ───────────────────────────────────────────

describe("Phase 3 · assignment validity windows through the full pipeline", () => {
  it("future-dated assignment is excluded → service falls back to default", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [assignmentRow({ starts_at: "2025-12-01T00:00:00.000Z" })],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.status).toBe("disabled");
    expect(e.statusSource).toBe("default");
    expect(e.contributingBundleIds).toEqual([]);
  });

  it("expired assignment is excluded → service falls back to default", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [assignmentRow({ ends_at: "2025-03-01T00:00:00.000Z" })],
    });
    expect(resolved.byService[MEDIA_KEY].statusSource).toBe("default");
  });

  it("cancelled assignment is excluded → service falls back to default", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [assignmentRow({ status: "cancelled" })],
    });
    expect(resolved.byService[MEDIA_KEY].statusSource).toBe("default");
  });

  it("an assignment active at NOW within a closed window is honoured", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [
        assignmentRow({ starts_at: "2025-05-01T00:00:00.000Z", ends_at: "2025-07-01T00:00:00.000Z" }),
      ],
    });
    expect(resolved.byService[MEDIA_KEY].status).toBe("enabled");
  });
});

// ── 5. Cross-company isolation ───────────────────────────────────────────────

describe("Phase 3 · cross-company isolation through the full pipeline", () => {
  it("ignores an assignment belonging to another company", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [],
      assignments: [assignmentRow({ company_id: OTHER_COMPANY })],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.status).toBe("disabled");
    expect(e.statusSource).toBe("default");
  });

  it("ignores an override belonging to another company", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "trial" })],
      grantLimits: [],
      assignments: [assignmentRow()],
      overrides: [overrideRow({ company_id: OTHER_COMPANY, status: "enabled" })],
    });
    const e = resolved.byService[MEDIA_KEY];
    expect(e.status).toBe("trial");
    expect(e.statusSource).toBe("bundle");
    expect(e.overrideId).toBeNull();
  });
});

// ── 6. Determinism & ordering ────────────────────────────────────────────────

describe("Phase 3 · deterministic output ordering", () => {
  it("resolves one entitlement per registry service, ordered by service key", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [],
      assignments: [assignmentRow()],
    });
    expect(resolved.entitlements).toHaveLength(SYNTH_REGISTRY.length);
    const keys = resolved.entitlements.map((e) => e.serviceKey);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(resolved.resolvedAt).toBe(NOW);
  });

  it("sorts contributingBundleIds regardless of input order", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow({ id: "z-bundle", slug: "z" }), bundleRow({ id: "a-bundle", slug: "a" })],
      grants: [
        grantRow({ id: "gz", bundle_id: "z-bundle", status: "enabled" }),
        grantRow({ id: "ga", bundle_id: "a-bundle", status: "enabled" }),
      ],
      grantLimits: [],
      assignments: [
        assignmentRow({ id: "az", bundle_id: "z-bundle" }),
        assignmentRow({ id: "aa", bundle_id: "a-bundle" }),
      ],
    });
    expect(resolved.byService[MEDIA_KEY].contributingBundleIds).toEqual([
      "a-bundle",
      "z-bundle",
    ]);
  });

  it("is byte-identical across repeated runs of the same fixtures", () => {
    const build = (): RawFixtures => ({
      bundles: [bundleRow({ id: "b2", slug: "zeta" }), bundleRow({ id: "b1", slug: "alpha" })],
      grants: [
        grantRow({ id: "g1", bundle_id: "b1", status: "enabled" }),
        grantRow({ id: "g2", bundle_id: "b2", status: "trial" }),
      ],
      grantLimits: [
        numericLimitRow({ grant_id: "g1", limit_key: LIM_MAX, limit_value: 200 }),
        numericLimitRow({ grant_id: "g2", limit_key: LIM_SUM, limit_value: 5 }),
      ],
      assignments: [
        assignmentRow({ id: "a1", bundle_id: "b1" }),
        assignmentRow({ id: "a2", bundle_id: "b2" }),
      ],
    });
    const a = runPipeline(build());
    const b = runPipeline(build());
    expect(a.resolved).toEqual(b.resolved);
    expect(a.issues).toEqual(b.issues);
  });

  it("PTE falls back to its default-company-enabled posture when nothing speaks to it", () => {
    const { resolved } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow()],
      grantLimits: [],
      assignments: [assignmentRow()],
    });
    const pte = resolved.byService[PTE_KEY];
    expect(pte.status).toBe("enabled");
    expect(pte.statusSource).toBe("default");
  });
});

// ── 7. Issue propagation ─────────────────────────────────────────────────────

describe("Phase 3 · data-quality issues surface through the pipeline", () => {
  it("drops a grant with an unknown service key and records an issue", () => {
    const { resolved, issues } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ service_key: "nonexistent_feature" })],
      grantLimits: [],
      assignments: [assignmentRow()],
    });
    expect(issues.some((i) => i.kind === "unknown-service-key")).toBe(true);
    // The bundle still resolves, just with no contribution from the bad grant.
    expect(resolved.byService[MEDIA_KEY].statusSource).toBe("default");
  });

  it("drops a limit row whose key is not declared for the service", () => {
    const { resolved, issues } = runPipeline({
      bundles: [bundleRow()],
      grants: [grantRow({ status: "enabled" })],
      grantLimits: [numericLimitRow({ limit_key: "undeclared_limit", limit_value: 5 })],
      assignments: [assignmentRow()],
    });
    expect(issues.some((i) => i.kind === "unknown-limit-key")).toBe(true);
    // The known LIM_MAX still resolves to its default since no valid row set it.
    expect(limitValue(resolved, MEDIA_KEY, LIM_MAX)?.source).toBe("default");
  });
});
