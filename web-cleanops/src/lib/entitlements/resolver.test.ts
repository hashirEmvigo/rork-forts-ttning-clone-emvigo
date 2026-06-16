import { describe, expect, it } from "vitest";

import type {
  FeatureLimitDefinition,
  LimitKey,
  ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import type {
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import { resolveCompanyEntitlements } from "./resolver";
import type {
  AssignmentRole,
  ResolutionContext,
  RuntimeBundle,
  RuntimeBundleAssignment,
  RuntimeBundleGrant,
  RuntimeCompanyOverride,
  RuntimeLimitValue,
} from "./types";

const NOW = new Date("2025-06-01T12:00:00.000Z");
const COMPANY = "c1";

// ── Synthetic registry exercising every merge kind ───────────────────────────
// Keys are cast to the production unions; the resolver is generic over the
// registry it is handed, so synthetic keys resolve identically.

const k = (s: string): ServiceFeatureKey => s as ServiceFeatureKey;
const lk = (s: string): LimitKey => s as LimitKey;

function limitDef(over: Partial<Omit<FeatureLimitDefinition, "limitKey">> & { limitKey: string }): FeatureLimitDefinition {
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

function serviceDef(
  serviceKey: string,
  over: Partial<ServiceFeatureDefinition> = {},
): ServiceFeatureDefinition {
  return {
    serviceKey: k(serviceKey),
    name: serviceKey,
    description: "",
    category: "Test",
    icon: "Box",
    billingEligible: false,
    billingLabel: serviceKey,
    defaultGlobalEnabled: true,
    supportsTrial: true,
    defaultCompanyEnabled: false,
    ...over,
  };
}

const SYNTH_REGISTRY: ServiceFeatureDefinition[] = [
  serviceDef("svc_bool", {
    limits: [limitDef({ limitKey: "lim_bool", valueType: "boolean", mergeKind: "boolean-or", defaultValue: false })],
  }),
  serviceDef("svc_max", {
    limits: [limitDef({ limitKey: "lim_max", mergeKind: "numeric-max", defaultValue: 10 })],
  }),
  serviceDef("svc_sum", {
    limits: [limitDef({ limitKey: "lim_sum", mergeKind: "numeric-sum", defaultValue: 0 })],
  }),
  serviceDef("svc_unlimited", {
    limits: [limitDef({ limitKey: "lim_unl", mergeKind: "unlimited-wins", defaultValue: null })],
  }),
  serviceDef("svc_enum", {
    limits: [
      limitDef({
        limitKey: "lim_enum",
        valueType: "enum",
        mergeKind: "enum-priority",
        defaultValue: "low",
        enumPriority: ["low", "medium", "high"],
      }),
    ],
  }),
  serviceDef("svc_pinned", {
    limits: [limitDef({ limitKey: "lim_pinned", mergeKind: "exclusive-pinned", defaultValue: 1 })],
  }),
];

// ── Builders ─────────────────────────────────────────────────────────────────

function grant(
  serviceKey: string,
  status: ServiceEntitlementStatus,
  limits: { limitKey: string; value: number | string }[] = [],
): RuntimeBundleGrant {
  return {
    serviceKey: k(serviceKey),
    status,
    limits: limits.map(
      (l): RuntimeLimitValue =>
        typeof l.value === "number"
          ? { limitKey: lk(l.limitKey), kind: "numeric", value: l.value }
          : { limitKey: lk(l.limitKey), kind: "text", value: l.value },
    ),
  };
}

function bundle(id: string, grants: RuntimeBundleGrant[]): RuntimeBundle {
  return { id, slug: id, name: id, bundleType: "addon", status: "active", grants };
}

function assignment(bundleId: string, role: AssignmentRole = "addon"): RuntimeBundleAssignment {
  return { id: `as-${bundleId}`, companyId: COMPANY, bundleId, role, startsAt: "2025-01-01T00:00:00.000Z", endsAt: null };
}

function ctx(
  over: Partial<ResolutionContext> & {
    bundles: RuntimeBundle[];
    assignments: RuntimeBundleAssignment[];
  },
): ResolutionContext {
  return {
    registry: SYNTH_REGISTRY,
    globalEntitlements: [],
    overrides: [],
    now: NOW,
    ...over,
  };
}

function resolve(context: ResolutionContext, serviceKey: string) {
  return resolveCompanyEntitlements(context, COMPANY).byService[serviceKey];
}

function limitOf(context: ResolutionContext, serviceKey: string, limitKey: string) {
  return resolve(context, serviceKey).limits.find((l) => l.limitKey === limitKey);
}

// ── Merge-kind cases ─────────────────────────────────────────────────────────

describe("merge kinds", () => {
  it("boolean-or: any true wins", () => {
    const c = ctx({
      bundles: [
        bundle("b1", [grant("svc_bool", "enabled", [{ limitKey: "lim_bool", value: 0 }])]),
        bundle("b2", [grant("svc_bool", "enabled", [{ limitKey: "lim_bool", value: 1 }])]),
      ],
      assignments: [assignment("b1"), assignment("b2")],
    });
    const lim = limitOf(c, "svc_bool", "lim_bool");
    expect(lim?.value).toBe(true);
    expect(lim?.source).toBe("bundle");
  });

  it("numeric-max: highest value wins", () => {
    const c = ctx({
      bundles: [
        bundle("b1", [grant("svc_max", "enabled", [{ limitKey: "lim_max", value: 100 }])]),
        bundle("b2", [grant("svc_max", "enabled", [{ limitKey: "lim_max", value: 500 }])]),
      ],
      assignments: [assignment("b1"), assignment("b2")],
    });
    expect(limitOf(c, "svc_max", "lim_max")?.value).toBe(500);
  });

  it("numeric-sum: top-ups add together", () => {
    const c = ctx({
      bundles: [
        bundle("b1", [grant("svc_sum", "enabled", [{ limitKey: "lim_sum", value: 25 }])]),
        bundle("b2", [grant("svc_sum", "enabled", [{ limitKey: "lim_sum", value: 75 }])]),
      ],
      assignments: [assignment("b1"), assignment("b2")],
    });
    expect(limitOf(c, "svc_sum", "lim_sum")?.value).toBe(100);
  });

  it("unlimited-wins: null default stays unlimited with no contribution", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_unlimited", "enabled")])],
      assignments: [assignment("b1")],
    });
    const lim = limitOf(c, "svc_unlimited", "lim_unl");
    expect(lim?.value).toBeNull();
    expect(lim?.source).toBe("default");
  });

  it("unlimited-wins: a numeric contribution caps the value", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_unlimited", "enabled", [{ limitKey: "lim_unl", value: 250 }])])],
      assignments: [assignment("b1")],
    });
    expect(limitOf(c, "svc_unlimited", "lim_unl")?.value).toBe(250);
  });

  it("enum-priority: highest-ranked value present wins", () => {
    const c = ctx({
      bundles: [
        bundle("b1", [grant("svc_enum", "enabled", [{ limitKey: "lim_enum", value: "medium" }])]),
        bundle("b2", [grant("svc_enum", "enabled", [{ limitKey: "lim_enum", value: "high" }])]),
        bundle("b3", [grant("svc_enum", "enabled", [{ limitKey: "lim_enum", value: "low" }])]),
      ],
      assignments: [assignment("b1"), assignment("b2"), assignment("b3")],
    });
    expect(limitOf(c, "svc_enum", "lim_enum")?.value).toBe("high");
  });

  it("exclusive-pinned: addon contributions are ignored, base wins", () => {
    const c = ctx({
      bundles: [
        bundle("base", [grant("svc_pinned", "enabled", [{ limitKey: "lim_pinned", value: 3 }])]),
        bundle("addon", [grant("svc_pinned", "enabled", [{ limitKey: "lim_pinned", value: 99 }])]),
      ],
      assignments: [assignment("base", "base"), assignment("addon", "addon")],
    });
    expect(limitOf(c, "svc_pinned", "lim_pinned")?.value).toBe(3);
  });

  it("exclusive-pinned: with no base contribution falls back to default", () => {
    const c = ctx({
      bundles: [bundle("addon", [grant("svc_pinned", "enabled", [{ limitKey: "lim_pinned", value: 99 }])])],
      assignments: [assignment("addon", "addon")],
    });
    const lim = limitOf(c, "svc_pinned", "lim_pinned");
    expect(lim?.value).toBe(1);
    expect(lim?.source).toBe("default");
  });
});

// ── Global gate cases ────────────────────────────────────────────────────────

describe("global gate", () => {
  it("globally unavailable forces disabled even with an enabling bundle", () => {
    const globalEntitlements: ServiceGlobalEntitlement[] = [
      { serviceKey: k("svc_max"), enabled: false, updatedBy: null, updatedAt: NOW.toISOString() },
    ];
    const c = ctx({
      globalEntitlements,
      bundles: [bundle("b1", [grant("svc_max", "enabled")])],
      assignments: [assignment("b1")],
    });
    const e = resolve(c, "svc_max");
    expect(e.globallyAvailable).toBe(false);
    expect(e.status).toBe("disabled");
    expect(e.entitled).toBe(false);
  });

  it("globally available + enabling bundle resolves to enabled", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_max", "enabled")])],
      assignments: [assignment("b1")],
    });
    const e = resolve(c, "svc_max");
    expect(e.globallyAvailable).toBe(true);
    expect(e.status).toBe("enabled");
    expect(e.statusSource).toBe("bundle");
    expect(e.contributingBundleIds).toEqual(["b1"]);
  });

  it("status merges most-generously across bundles (enabled > trial > disabled)", () => {
    const c = ctx({
      bundles: [
        bundle("b1", [grant("svc_max", "trial")]),
        bundle("b2", [grant("svc_max", "enabled")]),
        bundle("b3", [grant("svc_max", "disabled")]),
      ],
      assignments: [assignment("b1"), assignment("b2"), assignment("b3")],
    });
    expect(resolve(c, "svc_max").status).toBe("enabled");
  });

  it("falls back to the registry company default when nothing speaks to a service", () => {
    const c = ctx({ bundles: [], assignments: [] });
    const e = resolve(c, "svc_max");
    expect(e.status).toBe("disabled");
    expect(e.statusSource).toBe("default");
  });
});

// ── Override cases ───────────────────────────────────────────────────────────

function override(
  serviceKey: string,
  over: Partial<RuntimeCompanyOverride> = {},
): RuntimeCompanyOverride {
  return {
    id: "ov1",
    companyId: COMPANY,
    serviceKey: k(serviceKey),
    status: "enabled",
    reason: "negotiated",
    startsAt: "2025-01-01T00:00:00.000Z",
    endsAt: null,
    limits: [],
    ...over,
  };
}

describe("overrides", () => {
  it("override status replaces the merged bundle status", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_max", "trial")])],
      assignments: [assignment("b1")],
      overrides: [override("svc_max", { status: "enabled" })],
    });
    const e = resolve(c, "svc_max");
    expect(e.status).toBe("enabled");
    expect(e.statusSource).toBe("override");
    expect(e.overrideId).toBe("ov1");
  });

  it("override cannot bypass the global gate", () => {
    const c = ctx({
      globalEntitlements: [
        { serviceKey: k("svc_max"), enabled: false, updatedBy: null, updatedAt: NOW.toISOString() },
      ],
      bundles: [],
      assignments: [],
      overrides: [override("svc_max", { status: "enabled" })],
    });
    expect(resolve(c, "svc_max").status).toBe("disabled");
  });

  it("override limit value wins over the bundle merge", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_max", "enabled", [{ limitKey: "lim_max", value: 500 }])])],
      assignments: [assignment("b1")],
      overrides: [
        override("svc_max", {
          status: null,
          limits: [{ limitKey: lk("lim_max"), kind: "numeric", value: 42 }],
        }),
      ],
    });
    const lim = limitOf(c, "svc_max", "lim_max");
    expect(lim?.value).toBe(42);
    expect(lim?.source).toBe("override");
  });

  it("a null-status override only adjusts limits, leaving bundle status intact", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_max", "trial")])],
      assignments: [assignment("b1")],
      overrides: [override("svc_max", { status: null })],
    });
    const e = resolve(c, "svc_max");
    expect(e.status).toBe("trial");
    expect(e.statusSource).toBe("bundle");
  });
});

// ── Determinism / isolation ──────────────────────────────────────────────────

describe("resolver invariants", () => {
  it("is deterministic for identical input", () => {
    const build = () =>
      ctx({
        bundles: [bundle("b1", [grant("svc_max", "enabled", [{ limitKey: "lim_max", value: 200 }])])],
        assignments: [assignment("b1")],
      });
    const a = resolveCompanyEntitlements(build(), COMPANY);
    const b = resolveCompanyEntitlements(build(), COMPANY);
    expect(a).toEqual(b);
  });

  it("ignores assignments and overrides belonging to another company", () => {
    const c = ctx({
      bundles: [bundle("b1", [grant("svc_max", "enabled")])],
      assignments: [{ ...assignment("b1"), companyId: "other" }],
      overrides: [override("svc_max", { companyId: "other", status: "enabled" })],
    });
    const e = resolve(c, "svc_max");
    expect(e.status).toBe("disabled");
    expect(e.statusSource).toBe("default");
  });

  it("resolves one entitlement per registry service, ordered by key", () => {
    const c = ctx({ bundles: [], assignments: [] });
    const all = resolveCompanyEntitlements(c, COMPANY);
    expect(all.entitlements).toHaveLength(SYNTH_REGISTRY.length);
    const keys = all.entitlements.map((e) => e.serviceKey);
    expect(keys).toEqual([...keys].sort((x, y) => x.localeCompare(y)));
    expect(all.resolvedAt).toBe(NOW);
  });
});
