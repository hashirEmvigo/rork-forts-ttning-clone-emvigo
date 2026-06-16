import {
  SERVICE_FEATURE_REGISTRY,
  isServiceUsableForCompany,
  resolveCompanyEntitlement,
  resolveCompanyEntitlementStatus,
  resolveEffectiveCompanyStatus,
  resolveGlobalAvailability,
} from "@/lib/serviceRegistry";
import type {
  CompanyServiceEntitlement,
  EntitlementsResolverMode,
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
  SystemSettings,
} from "@/types";

import { buildSyntheticBackfill, type LegacyEntitlementState } from "./backfill";
import {
  buildResolutionContext,
  normalizeAssignments,
  normalizeBundles,
  normalizeOverrides,
} from "./normalize";
import { resolveCompanyEntitlements } from "./resolver";
import type { ResolutionContext, ResolvedCompanyEntitlements } from "./types";

/**
 * Phase 6 — Resolver adapter (switching mechanism ONLY).
 *
 * Provides the five company-entitlement accessors backed by EITHER the legacy
 * per-company resolver or the new bundle-first pipeline, selected by a feature
 * flag. The new resolver is NOT activated by this module: the default mode is
 * `"legacy"`, so wiring this in leaves production behaviour identical.
 *
 * Guarantees (per the approved cutover plan):
 *  - **Default-safe:** mode `"legacy"` serves exactly the legacy values.
 *  - **Fail-safe:** if the bundle path throws, returns invalid data, or fails to
 *    build its context, the accessor transparently falls back to the legacy
 *    result and emits a `fallback` event. The app can never become unavailable
 *    because of the new resolver.
 *  - **Shadow logging:** when `shadowLog` is on while serving legacy, the bundle
 *    path runs in parallel and divergences are emitted as `divergence` events.
 *    Returned values are never affected.
 *
 * The module is pure: it performs no I/O, reads/writes no Supabase, and flips no
 * flag. The bundle path reproduces today's data via the in-memory synthetic
 * backfill (the same chain the shadow harness validated), so source-of-truth
 * ownership is unchanged.
 */

/** The five company-entitlement accessors the app consumes. */
export interface EntitlementAccessors {
  isServiceGloballyAvailable: (serviceKey: ServiceFeatureKey) => boolean;
  isCompanyEntitledToService: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => boolean;
  isServiceAvailableForCompany: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => boolean;
  getCompanyServiceStatus: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => ServiceEntitlementStatus;
  getEffectiveCompanyServiceStatus: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => ServiceEntitlementStatus;
}

/** The live datasets the adapter resolves against. */
export interface EntitlementResolverInputs {
  /** All current company ids (each receives a synthetic base assignment). */
  companyIds: string[];
  /** Explicit per-company entitlement records (legacy source of truth). */
  companyEntitlements: CompanyServiceEntitlement[];
  /** Platform-wide availability records. */
  globalEntitlements: ServiceGlobalEntitlement[];
  /** Full system settings (carries the PTE master gate). */
  systemSettings: SystemSettings;
  /** Instant used for validity-window filtering. Defaults to now. */
  now?: Date;
}

/** Which accessor produced an adapter event. */
export type AdapterAccessor =
  | "isServiceGloballyAvailable"
  | "isCompanyEntitledToService"
  | "isServiceAvailableForCompany"
  | "getCompanyServiceStatus"
  | "getEffectiveCompanyServiceStatus";

/**
 * An observability event from the adapter. PII-free by construction: it carries
 * only company ids, service keys, and resolved values — never user data.
 */
export type AdapterEvent =
  | {
      kind: "fallback";
      accessor: AdapterAccessor;
      companyId: string | null;
      serviceKey: ServiceFeatureKey;
      error: string;
    }
  | {
      kind: "divergence";
      accessor: AdapterAccessor;
      companyId: string | null;
      serviceKey: ServiceFeatureKey;
      legacy: string;
      bundle: string;
    }
  | {
      kind: "shadow-error";
      accessor: AdapterAccessor;
      companyId: string | null;
      serviceKey: ServiceFeatureKey;
      error: string;
    };

/** A sink for adapter events. */
export type AdapterEventSink = (event: AdapterEvent) => void;

/** Options for {@link createEntitlementAccessors}. */
export interface CreateAccessorsOptions {
  mode: EntitlementsResolverMode;
  shadowLog: boolean;
  inputs: EntitlementResolverInputs;
  /** Receives fallback/divergence/shadow-error events. Defaults to a logger. */
  onEvent?: AdapterEventSink;
}

/** Probe company id used for company-independent global lookups. */
const GLOBAL_PROBE_COMPANY = "__entitlements_global_probe__";

/** Stringifies an accessor result for stable comparison/logging. */
function show(value: boolean | ServiceEntitlementStatus): string {
  return String(value);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Builds the legacy-backed accessors (wraps the registry functions). */
function createLegacyAccessors(
  inputs: EntitlementResolverInputs,
): EntitlementAccessors {
  const opts = {
    systemSettings: inputs.systemSettings,
    globalEntitlements: inputs.globalEntitlements,
    companyEntitlements: inputs.companyEntitlements,
  };
  return {
    isServiceGloballyAvailable: (serviceKey) =>
      resolveGlobalAvailability(serviceKey, opts),
    isCompanyEntitledToService: (companyId, serviceKey) =>
      resolveCompanyEntitlement(serviceKey, companyId, inputs.companyEntitlements),
    isServiceAvailableForCompany: (companyId, serviceKey) =>
      isServiceUsableForCompany(serviceKey, companyId, opts),
    getCompanyServiceStatus: (companyId, serviceKey) =>
      resolveCompanyEntitlementStatus(
        serviceKey,
        companyId,
        inputs.companyEntitlements,
      ),
    getEffectiveCompanyServiceStatus: (companyId, serviceKey) =>
      resolveEffectiveCompanyStatus(serviceKey, companyId, opts),
  };
}

/**
 * Builds the bundle-backed accessors. The {@link ResolutionContext} is built
 * lazily (and cached) from the in-memory synthetic backfill; per-company
 * resolutions are memoized. Any accessor throws if its service is missing from
 * the resolved picture, so the caller's fail-safe falls back to legacy.
 */
function createBundleAccessors(
  inputs: EntitlementResolverInputs,
): EntitlementAccessors {
  const registry = SERVICE_FEATURE_REGISTRY;
  const now = inputs.now ?? new Date();

  let context: ResolutionContext | null = null;
  const resolvedByCompany = new Map<string, ResolvedCompanyEntitlements>();

  const getContext = (): ResolutionContext => {
    if (context) return context;
    const state: LegacyEntitlementState = {
      companyIds: inputs.companyIds,
      companyEntitlements: inputs.companyEntitlements,
      globalEntitlements: inputs.globalEntitlements,
      systemSettings: {
        allowPreferredTimeEvaluation:
          inputs.systemSettings.allowPreferredTimeEvaluation === true,
      },
      registry,
      now,
    };
    const backfill = buildSyntheticBackfill(state);
    const { bundles } = normalizeBundles(
      {
        bundles: backfill.bundles,
        grants: backfill.grants,
        grantLimits: backfill.grantLimits,
      },
      registry,
    );
    const assignments = normalizeAssignments(backfill.assignments, now);
    const { overrides } = normalizeOverrides(
      { overrides: backfill.overrides, overrideLimits: backfill.overrideLimits },
      now,
      registry,
    );
    context = buildResolutionContext({
      registry,
      globalEntitlements: backfill.globalEntitlements,
      bundles,
      assignments,
      overrides,
      now,
    });
    return context;
  };

  const resolveFor = (companyId: string): ResolvedCompanyEntitlements => {
    const cached = resolvedByCompany.get(companyId);
    if (cached) return cached;
    const resolved = resolveCompanyEntitlements(getContext(), companyId);
    resolvedByCompany.set(companyId, resolved);
    return resolved;
  };

  const entOf = (companyId: string, serviceKey: ServiceFeatureKey) => {
    const ent = resolveFor(companyId).byService[serviceKey];
    if (!ent) {
      throw new Error(`bundle resolver produced no entitlement for ${serviceKey}`);
    }
    return ent;
  };

  return {
    isServiceGloballyAvailable: (serviceKey) =>
      entOf(GLOBAL_PROBE_COMPANY, serviceKey).globallyAvailable,
    isCompanyEntitledToService: (companyId, serviceKey) =>
      entOf(companyId, serviceKey).companyStatus !== "disabled",
    isServiceAvailableForCompany: (companyId, serviceKey) => {
      const ent = entOf(companyId, serviceKey);
      return ent.globallyAvailable && ent.companyStatus !== "disabled";
    },
    getCompanyServiceStatus: (companyId, serviceKey) =>
      entOf(companyId, serviceKey).companyStatus,
    getEffectiveCompanyServiceStatus: (companyId, serviceKey) =>
      entOf(companyId, serviceKey).status,
  };
}

/** Default event sink: PII-free console diagnostics. */
function defaultEventSink(event: AdapterEvent): void {
  const where = `${event.accessor} company=${event.companyId ?? "-"} service=${event.serviceKey}`;
  if (event.kind === "fallback") {
    console.error(
      `[entitlements] bundle resolver failed — served legacy (${where}): ${event.error}`,
    );
  } else if (event.kind === "shadow-error") {
    console.warn(
      `[entitlements] shadow bundle resolve threw (${where}): ${event.error}`,
    );
  } else {
    console.warn(
      `[entitlements] shadow divergence (${where}) legacy=${event.legacy} bundle=${event.bundle}`,
    );
  }
}

/**
 * Builds the entitlement accessors for the given mode. With `mode === "legacy"`
 * the returned accessors are byte-for-byte the legacy values (production
 * default). With `mode === "bundle"` they serve the bundle pipeline, falling
 * back to legacy on any failure. When `shadowLog` is on while serving legacy,
 * the bundle path runs in parallel and divergences are reported via `onEvent`.
 */
export function createEntitlementAccessors(
  options: CreateAccessorsOptions,
): EntitlementAccessors {
  const { mode, shadowLog, inputs } = options;
  const onEvent = options.onEvent ?? defaultEventSink;

  const legacy = createLegacyAccessors(inputs);

  // Only build the bundle path when it is actually needed.
  const needsBundle = mode === "bundle" || shadowLog;
  const bundle = needsBundle ? createBundleAccessors(inputs) : null;

  // Dedupe key set so a repeatedly-called accessor does not flood the logs.
  const reported = new Set<string>();
  const reportOnce = (key: string, build: () => AdapterEvent): void => {
    if (reported.has(key)) return;
    reported.add(key);
    onEvent(build());
  };

  /**
   * Resolves one accessor honoring the serving mode, fail-safe fallback, and
   * parallel shadow logging. `legacyCall`/`bundleCall` are thunks so the unused
   * path is never evaluated.
   */
  function resolveOne<T extends boolean | ServiceEntitlementStatus>(
    accessor: AdapterAccessor,
    companyId: string | null,
    serviceKey: ServiceFeatureKey,
    legacyCall: () => T,
    bundleCall: () => T,
  ): T {
    if (mode === "bundle" && bundle) {
      try {
        return bundleCall();
      } catch (err) {
        reportOnce(`fallback:${accessor}:${companyId ?? "-"}:${serviceKey}`, () => ({
          kind: "fallback",
          accessor,
          companyId,
          serviceKey,
          error: errText(err),
        }));
        return legacyCall();
      }
    }

    const legacyValue = legacyCall();
    if (shadowLog && bundle) {
      try {
        const bundleValue = bundleCall();
        if (show(bundleValue) !== show(legacyValue)) {
          reportOnce(
            `divergence:${accessor}:${companyId ?? "-"}:${serviceKey}:${show(legacyValue)}:${show(bundleValue)}`,
            () => ({
              kind: "divergence",
              accessor,
              companyId,
              serviceKey,
              legacy: show(legacyValue),
              bundle: show(bundleValue),
            }),
          );
        }
      } catch (err) {
        reportOnce(`shadow-error:${accessor}:${companyId ?? "-"}:${serviceKey}`, () => ({
          kind: "shadow-error",
          accessor,
          companyId,
          serviceKey,
          error: errText(err),
        }));
      }
    }
    return legacyValue;
  }

  return {
    isServiceGloballyAvailable: (serviceKey) =>
      resolveOne(
        "isServiceGloballyAvailable",
        null,
        serviceKey,
        () => legacy.isServiceGloballyAvailable(serviceKey),
        () => bundle!.isServiceGloballyAvailable(serviceKey),
      ),
    isCompanyEntitledToService: (companyId, serviceKey) =>
      resolveOne(
        "isCompanyEntitledToService",
        companyId,
        serviceKey,
        () => legacy.isCompanyEntitledToService(companyId, serviceKey),
        () => bundle!.isCompanyEntitledToService(companyId, serviceKey),
      ),
    isServiceAvailableForCompany: (companyId, serviceKey) =>
      resolveOne(
        "isServiceAvailableForCompany",
        companyId,
        serviceKey,
        () => legacy.isServiceAvailableForCompany(companyId, serviceKey),
        () => bundle!.isServiceAvailableForCompany(companyId, serviceKey),
      ),
    getCompanyServiceStatus: (companyId, serviceKey) =>
      resolveOne(
        "getCompanyServiceStatus",
        companyId,
        serviceKey,
        () => legacy.getCompanyServiceStatus(companyId, serviceKey),
        () => bundle!.getCompanyServiceStatus(companyId, serviceKey),
      ),
    getEffectiveCompanyServiceStatus: (companyId, serviceKey) =>
      resolveOne(
        "getEffectiveCompanyServiceStatus",
        companyId,
        serviceKey,
        () => legacy.getEffectiveCompanyServiceStatus(companyId, serviceKey),
        () => bundle!.getEffectiveCompanyServiceStatus(companyId, serviceKey),
      ),
  };
}
