import type {
  FeatureLimitDefinition,
  ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import type {
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import type {
  AssignmentRole,
  ResolutionContext,
  ResolutionSource,
  ResolvedCompanyEntitlements,
  ResolvedEntitlement,
  ResolvedLimit,
  RuntimeBundle,
  RuntimeBundleAssignment,
  RuntimeCompanyOverride,
  RuntimeLimitValue,
} from "./types";

/**
 * Phase 2B — Pure, deterministic entitlement resolver.
 *
 * Consumes a {@link ResolutionContext} (assembled by the Phase 2A loader) and
 * produces a {@link ResolvedCompanyEntitlements}. It performs NO I/O and reads
 * nothing but the context: identical input always yields identical output.
 *
 * Resolution order for each registry service:
 *   1. Global gate — `globalEntitlements` record, else registry default.
 *   2. Bundle merge — collect grants from the company's active assigned bundles
 *      and merge their status (`enabled > trial > disabled`).
 *   3. Override — a sparse company override may replace the status and/or
 *      individual limit values.
 *   4. Global gate wins — if not globally available the effective status is
 *      always `disabled`, regardless of bundles or overrides.
 *
 * Limit values merge per the limit's declared {@link MergeKind} in the
 * code-owned registry; the resolver dispatches over the kind and never guesses.
 *
 * NOTE on the global gate: the locked {@link ResolutionContext} intentionally
 * carries only `globalEntitlements`, not `SystemSettings`. The legacy resolver
 * bridges Preferred Time Evaluation to `SystemSettings.allowPreferredTimeEvaluation`;
 * keeping that bridge here would make the resolver impure. Instead the bridge
 * stays a loader/backfill concern (a synthetic global-entitlement record), so
 * this resolver computes global availability purely from the context. This is
 * deliberate and does not change legacy behaviour, which still runs unchanged.
 */

const STATUS_RANK: Record<ServiceEntitlementStatus, number> = {
  disabled: 0,
  trial: 1,
  enabled: 2,
};

const STATUS_BY_RANK: ServiceEntitlementStatus[] = ["disabled", "trial", "enabled"];

/** A single limit value contributed by one bundle grant, with its role. */
interface LimitContribution {
  value: RuntimeLimitValue;
  role: AssignmentRole;
  bundleId: string;
}

/** Resolves the platform-wide availability of a service from the context. */
function resolveGlobalAvailability(
  serviceKey: ServiceFeatureKey,
  globalEntitlements: ServiceGlobalEntitlement[],
  def: ServiceFeatureDefinition | undefined,
): boolean {
  const record = globalEntitlements.find((g) => g.serviceKey === serviceKey);
  if (record) return record.enabled === true;
  return def?.defaultGlobalEnabled === true;
}

/** Picks the most generous status (`enabled > trial > disabled`). */
function mergeStatus(
  statuses: ServiceEntitlementStatus[],
): ServiceEntitlementStatus {
  let rank = 0;
  for (const s of statuses) {
    if (STATUS_RANK[s] > rank) rank = STATUS_RANK[s];
  }
  return STATUS_BY_RANK[rank];
}

/** Reads a numeric contribution value, or null when it is not numeric. */
function asNumeric(value: RuntimeLimitValue): number | null {
  return value.kind === "numeric" ? value.value : null;
}

/** Interprets a contribution as a boolean (numeric ≠ 0, or text "true"). */
function asBoolean(value: RuntimeLimitValue): boolean {
  if (value.kind === "numeric") return value.value !== 0;
  return value.value.trim().toLowerCase() === "true";
}

/** Reads a string contribution value (text as-is, numeric stringified). */
function asString(value: RuntimeLimitValue): string {
  return value.kind === "numeric" ? String(value.value) : value.value;
}

/**
 * Merges the bundle-level contributions for one limit per its {@link MergeKind}.
 * Returns null when no contribution applies (the caller falls back to the
 * registry default). Pure — never reads anything outside its arguments.
 */
function mergeBundleLimit(
  def: FeatureLimitDefinition,
  contributions: LimitContribution[],
): number | boolean | string | null {
  if (contributions.length === 0) return null;

  switch (def.mergeKind) {
    case "boolean-or":
      return contributions.some((c) => asBoolean(c.value));

    case "numeric-max": {
      const nums = contributions
        .map((c) => asNumeric(c.value))
        .filter((n): n is number => n !== null);
      return nums.length > 0 ? Math.max(...nums) : null;
    }

    case "numeric-sum": {
      const nums = contributions
        .map((c) => asNumeric(c.value))
        .filter((n): n is number => n !== null);
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
    }

    case "unlimited-wins": {
      // `null` (unlimited) only ever originates from the registry default in the
      // current model, so among present numeric contributions the highest cap
      // wins. Returning null here means "no contribution"; the caller then
      // applies the default, which may itself be unlimited (null).
      const nums = contributions
        .map((c) => asNumeric(c.value))
        .filter((n): n is number => n !== null);
      return nums.length > 0 ? Math.max(...nums) : null;
    }

    case "enum-priority": {
      const order = def.enumPriority ?? [];
      let bestRank = -1;
      let best: string | null = null;
      for (const c of contributions) {
        const v = asString(c.value);
        const rank = order.indexOf(v);
        if (rank > bestRank) {
          bestRank = rank;
          best = v;
        }
      }
      return best;
    }

    case "exclusive-pinned": {
      // Singular settings must not be set by stacked add-ons: only the base
      // plan contributes. (Company overrides are applied separately, later.)
      const base = contributions.find((c) => c.role === "base");
      if (!base) return null;
      return def.valueType === "boolean"
        ? asBoolean(base.value)
        : def.valueType === "count"
          ? asNumeric(base.value)
          : asString(base.value);
    }

    default:
      return null;
  }
}

/** Coerces a runtime override value to the limit's declared value type. */
function coerceOverrideValue(
  def: FeatureLimitDefinition,
  value: RuntimeLimitValue,
): number | boolean | string {
  switch (def.valueType) {
    case "boolean":
      return asBoolean(value);
    case "count":
      return asNumeric(value) ?? 0;
    case "enum":
      return asString(value);
  }
}

/** Options for resolving a single service. */
interface ResolveServiceOptions {
  globalEntitlements: ServiceGlobalEntitlement[];
  /** Grants for this service, grouped by their assigned bundle + role. */
  contributions: { status: ServiceEntitlementStatus; bundleId: string }[];
  /** Per-limit contributions for this service, keyed by limit key. */
  limitContributions: Map<string, LimitContribution[]>;
  /** The override affecting this service, if any. */
  override: RuntimeCompanyOverride | undefined;
}

/** Resolves the entitlement for a single registry service. Pure. */
export function resolveServiceEntitlement(
  def: ServiceFeatureDefinition,
  opts: ResolveServiceOptions,
): ResolvedEntitlement {
  const globallyAvailable = resolveGlobalAvailability(
    def.serviceKey,
    opts.globalEntitlements,
    def,
  );

  const bundleStatus = mergeStatus(opts.contributions.map((c) => c.status));
  const contributingBundleIds = opts.contributions
    .filter((c) => c.status !== "disabled")
    .map((c) => c.bundleId)
    .sort((a, b) => a.localeCompare(b));

  // Company-layer status: an override status (when set) replaces the merged
  // bundle status. Default-company-enabled features fall back to that default
  // only when no bundle and no override speak to the service.
  const overrideStatus = opts.override?.status ?? null;
  let companyStatus: ServiceEntitlementStatus;
  let statusSource: ResolutionSource;
  if (overrideStatus !== null) {
    companyStatus = overrideStatus;
    statusSource = "override";
  } else if (opts.contributions.length > 0) {
    companyStatus = bundleStatus;
    statusSource = "bundle";
  } else {
    companyStatus = def.defaultCompanyEnabled ? "enabled" : "disabled";
    statusSource = "default";
  }

  // Global gate always wins.
  const status: ServiceEntitlementStatus = globallyAvailable
    ? companyStatus
    : "disabled";

  const overrideLimits = new Map<string, RuntimeLimitValue>();
  for (const lim of opts.override?.limits ?? []) {
    overrideLimits.set(lim.limitKey, lim);
  }

  const limits: ResolvedLimit[] = (def.limits ?? []).map((limitDef) => {
    const overrideValue = overrideLimits.get(limitDef.limitKey);
    if (overrideValue) {
      return {
        limitKey: limitDef.limitKey,
        valueType: limitDef.valueType,
        mergeKind: limitDef.mergeKind,
        value: coerceOverrideValue(limitDef, overrideValue),
        source: "override",
      };
    }
    const merged = mergeBundleLimit(
      limitDef,
      opts.limitContributions.get(limitDef.limitKey) ?? [],
    );
    if (merged !== null) {
      return {
        limitKey: limitDef.limitKey,
        valueType: limitDef.valueType,
        mergeKind: limitDef.mergeKind,
        value: merged,
        source: "bundle",
      };
    }
    return {
      limitKey: limitDef.limitKey,
      valueType: limitDef.valueType,
      mergeKind: limitDef.mergeKind,
      value: limitDef.defaultValue,
      source: "default",
    };
  });

  return {
    serviceKey: def.serviceKey,
    globallyAvailable,
    status,
    companyStatus,
    entitled: status !== "disabled",
    statusSource,
    contributingBundleIds,
    overrideId: opts.override?.id ?? null,
    limits,
  };
}

/**
 * Resolves the complete entitlement picture for one company from a pure
 * {@link ResolutionContext}.
 *
 * Only assignments/overrides belonging to `companyId` are considered, so a
 * context that happens to carry multiple companies still resolves correctly.
 */
export function resolveCompanyEntitlements(
  context: ResolutionContext,
  companyId: string,
): ResolvedCompanyEntitlements {
  const bundleById = new Map<string, RuntimeBundle>();
  for (const b of context.bundles) bundleById.set(b.id, b);

  const assignments = context.assignments.filter(
    (a: RuntimeBundleAssignment) => a.companyId === companyId,
  );
  const overridesByService = new Map<string, RuntimeCompanyOverride>();
  for (const o of context.overrides) {
    if (o.companyId === companyId) overridesByService.set(o.serviceKey, o);
  }

  // Gather per-service status + limit contributions from assigned bundles.
  const statusContribs = new Map<
    string,
    { status: ServiceEntitlementStatus; bundleId: string }[]
  >();
  const limitContribs = new Map<string, Map<string, LimitContribution[]>>();

  for (const assignment of assignments) {
    const bundle = bundleById.get(assignment.bundleId);
    if (!bundle || bundle.status !== "active") continue;
    for (const grant of bundle.grants) {
      const sList = statusContribs.get(grant.serviceKey) ?? [];
      sList.push({ status: grant.status, bundleId: bundle.id });
      statusContribs.set(grant.serviceKey, sList);

      let perLimit = limitContribs.get(grant.serviceKey);
      if (!perLimit) {
        perLimit = new Map<string, LimitContribution[]>();
        limitContribs.set(grant.serviceKey, perLimit);
      }
      for (const lim of grant.limits) {
        const cList = perLimit.get(lim.limitKey) ?? [];
        cList.push({ value: lim, role: assignment.role, bundleId: bundle.id });
        perLimit.set(lim.limitKey, cList);
      }
    }
  }

  const entitlements: ResolvedEntitlement[] = context.registry
    .map((def) =>
      resolveServiceEntitlement(def, {
        globalEntitlements: context.globalEntitlements,
        contributions: statusContribs.get(def.serviceKey) ?? [],
        limitContributions:
          limitContribs.get(def.serviceKey) ?? new Map<string, LimitContribution[]>(),
        override: overridesByService.get(def.serviceKey),
      }),
    )
    .sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));

  const byService: Record<string, ResolvedEntitlement> = {};
  for (const e of entitlements) byService[e.serviceKey] = e;

  return {
    companyId,
    resolvedAt: context.now,
    entitlements,
    byService,
  };
}
