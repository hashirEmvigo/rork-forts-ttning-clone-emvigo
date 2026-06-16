import {
  SERVICE_FEATURE_REGISTRY,
  getServiceDefinition,
  resolveEffectiveCompanyStatus,
  resolveGlobalAvailability,
  type FeatureLimitDefinition,
  type ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import { defaultSystemSettings } from "@/types";
import type {
  ServiceEntitlementStatus,
  ServiceFeatureKey,
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
import type {
  EntitlementLoadIssue,
  ResolvedCompanyEntitlements,
  ResolvedEntitlement,
} from "./types";

/**
 * Phase 5 — Shadow Comparison.
 *
 * A pure, deterministic equivalence harness that runs the legacy entitlement
 * path and the new bundle-first pipeline over the SAME entitlement state and
 * records every divergence. It performs NO I/O, writes nothing, flips no flag,
 * and is not imported by any production screen — running it cannot change app
 * behaviour. Identical input always produces an identical report.
 *
 * It exists to produce a measurable, binary cutover-readiness signal:
 * {@link ShadowComparisonReport.passed} is true only when the new pipeline
 * reproduces the legacy resolver byte-for-byte across every company × every
 * registry service × every compared field, the synthetic rows normalize with
 * zero issues, and the one-base-plan invariant holds for every company.
 *
 * New path (mirrors {@link loadEntitlementContext} after fetch, minus I/O):
 *   buildSyntheticBackfill → normalize* → buildResolutionContext →
 *   resolveCompanyEntitlements.
 *
 * Legacy path:
 *   resolveGlobalAvailability + resolveEffectiveCompanyStatus, plus the
 *   registry-configured limit value for each declared limit.
 */

/** The fields compared per (company, service). Stable, closed set. */
export type ShadowField = "globallyAvailable" | "status" | "entitled" | `limit:${string}`;

/** A single divergence between the legacy path and the new pipeline. */
export interface ShadowMismatch {
  companyId: string;
  serviceKey: ServiceFeatureKey;
  field: ShadowField;
  /** The legacy value, stringified for stable logging/diffing. */
  legacy: string;
  /** The new-pipeline value, stringified for stable logging/diffing. */
  new: string;
}

/** The measurable outcome of a shadow comparison run. */
export interface ShadowComparisonReport {
  /**
   * The cutover-readiness gate: true iff there are zero mismatches, zero
   * normalization issues, and the base-plan invariant holds for every company.
   */
  passed: boolean;
  /** The instant both paths were resolved against (ISO). */
  now: string;
  companyCount: number;
  serviceCount: number;
  /** Total (company × service × field) comparisons performed. */
  comparisonCount: number;
  mismatchCount: number;
  /** Every divergence, sorted by (companyId, serviceKey, field). */
  mismatches: ShadowMismatch[];
  /** Non-fatal normalization findings on the synthetic rows (must be empty). */
  loadIssues: EntitlementLoadIssue[];
  /** True iff every company received exactly one base assignment. */
  basePlanInvariantHolds: boolean;
  /** Count of mismatches grouped by field, for a quick triage summary. */
  summaryByField: Record<string, number>;
}

/** The legacy-configured limit value for one declared limit. */
function legacyLimitValue(
  def: ServiceFeatureDefinition,
  limitDef: FeatureLimitDefinition,
): number | boolean | string | null {
  // The only counted limit today bridges to the service's trial allowance.
  if (
    limitDef.limitKey === "media_upload_count" &&
    def.trialLimitType === "count" &&
    typeof def.trialLimit === "number"
  ) {
    return def.trialLimit;
  }
  return limitDef.defaultValue;
}

/** Stringifies a comparable value deterministically for logging/diffing. */
function show(value: number | boolean | string | null): string {
  return value === null ? "null" : String(value);
}

/**
 * Resolves the complete new-pipeline picture for every company from a single
 * synthetic backfill, mirroring the post-fetch chain of the real loader.
 */
function resolveNewPipeline(
  state: LegacyEntitlementState,
  registry: ServiceFeatureDefinition[],
  now: Date,
): {
  byCompany: Map<string, ResolvedCompanyEntitlements>;
  issues: EntitlementLoadIssue[];
  assignmentCount: number;
  companyCount: number;
} {
  const backfill = buildSyntheticBackfill({ ...state, registry, now });

  const { bundles, issues: bundleIssues } = normalizeBundles(
    {
      bundles: backfill.bundles,
      grants: backfill.grants,
      grantLimits: backfill.grantLimits,
    },
    registry,
  );
  const assignments = normalizeAssignments(backfill.assignments, now);
  const { overrides, issues: overrideIssues } = normalizeOverrides(
    { overrides: backfill.overrides, overrideLimits: backfill.overrideLimits },
    now,
    registry,
  );

  const context = buildResolutionContext({
    registry,
    globalEntitlements: backfill.globalEntitlements,
    bundles,
    assignments,
    overrides,
    now,
  });

  const companyIds = Array.from(
    new Set<string>([
      ...state.companyIds,
      ...state.companyEntitlements.map((e) => e.companyId),
    ]),
  );

  const byCompany = new Map<string, ResolvedCompanyEntitlements>();
  for (const companyId of companyIds) {
    byCompany.set(companyId, resolveCompanyEntitlements(context, companyId));
  }

  return {
    byCompany,
    issues: [...bundleIssues, ...overrideIssues],
    assignmentCount: backfill.stats.assignmentCount,
    companyCount: backfill.stats.companyCount,
  };
}

/**
 * Runs the legacy path and the new bundle-first pipeline over the same
 * {@link LegacyEntitlementState} and reports every divergence. Pure and
 * deterministic — safe to call from a test, a dev script, or an admin-only
 * diagnostic, with no effect on production behaviour.
 */
export function runShadowComparison(
  state: LegacyEntitlementState,
): ShadowComparisonReport {
  const registry = state.registry ?? SERVICE_FEATURE_REGISTRY;
  const now = state.now ?? new Date();

  const companyIds = Array.from(
    new Set<string>([
      ...state.companyIds,
      ...state.companyEntitlements.map((e) => e.companyId),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const newPipeline = resolveNewPipeline(state, registry, now);
  const mismatches: ShadowMismatch[] = [];
  let comparisonCount = 0;

  // The legacy resolver needs a full SystemSettings; only the PTE master gate
  // is relevant here, so build one from the defaults with the gate applied.
  const legacySystemSettings: SystemSettings = {
    ...defaultSystemSettings(),
    allowPreferredTimeEvaluation:
      state.systemSettings.allowPreferredTimeEvaluation === true,
  };

  for (const companyId of companyIds) {
    const resolved = newPipeline.byCompany.get(companyId);
    for (const def of registry) {
      const newEnt: ResolvedEntitlement | undefined =
        resolved?.byService[def.serviceKey];

      // ── Legacy values ──────────────────────────────────────────────────────
      const legacyGloballyAvailable = resolveGlobalAvailability(def.serviceKey, {
        systemSettings: legacySystemSettings,
        globalEntitlements: state.globalEntitlements,
      });
      const legacyStatus: ServiceEntitlementStatus = resolveEffectiveCompanyStatus(
        def.serviceKey,
        companyId,
        {
          systemSettings: legacySystemSettings,
          globalEntitlements: state.globalEntitlements,
          companyEntitlements: state.companyEntitlements,
        },
      );
      const legacyEntitled = legacyStatus !== "disabled";

      // ── Field comparisons ────────────────────────────────────────────────────
      comparisonCount += 1;
      if ((newEnt?.globallyAvailable ?? false) !== legacyGloballyAvailable) {
        mismatches.push({
          companyId,
          serviceKey: def.serviceKey,
          field: "globallyAvailable",
          legacy: show(legacyGloballyAvailable),
          new: show(newEnt?.globallyAvailable ?? false),
        });
      }

      comparisonCount += 1;
      if ((newEnt?.status ?? "disabled") !== legacyStatus) {
        mismatches.push({
          companyId,
          serviceKey: def.serviceKey,
          field: "status",
          legacy: show(legacyStatus),
          new: show(newEnt?.status ?? "disabled"),
        });
      }

      comparisonCount += 1;
      if ((newEnt?.entitled ?? false) !== legacyEntitled) {
        mismatches.push({
          companyId,
          serviceKey: def.serviceKey,
          field: "entitled",
          legacy: show(legacyEntitled),
          new: show(newEnt?.entitled ?? false),
        });
      }

      for (const limitDef of def.limits ?? []) {
        comparisonCount += 1;
        const legacyValue = legacyLimitValue(def, limitDef);
        const newValue =
          newEnt?.limits.find((l) => l.limitKey === limitDef.limitKey)?.value ??
          limitDef.defaultValue;
        if (show(newValue) !== show(legacyValue)) {
          mismatches.push({
            companyId,
            serviceKey: def.serviceKey,
            field: `limit:${limitDef.limitKey}`,
            legacy: show(legacyValue),
            new: show(newValue),
          });
        }
      }
    }
  }

  mismatches.sort((a, b) => {
    const byCompany = a.companyId.localeCompare(b.companyId);
    if (byCompany !== 0) return byCompany;
    const byService = a.serviceKey.localeCompare(b.serviceKey);
    if (byService !== 0) return byService;
    return a.field.localeCompare(b.field);
  });

  const summaryByField: Record<string, number> = {};
  for (const m of mismatches) {
    summaryByField[m.field] = (summaryByField[m.field] ?? 0) + 1;
  }

  const basePlanInvariantHolds =
    newPipeline.assignmentCount === newPipeline.companyCount &&
    newPipeline.companyCount === companyIds.length;

  const passed =
    mismatches.length === 0 &&
    newPipeline.issues.length === 0 &&
    basePlanInvariantHolds;

  return {
    passed,
    now: now.toISOString(),
    companyCount: companyIds.length,
    serviceCount: registry.length,
    comparisonCount,
    mismatchCount: mismatches.length,
    mismatches,
    loadIssues: newPipeline.issues,
    basePlanInvariantHolds,
    summaryByField,
  };
}

/**
 * Formats a {@link ShadowComparisonReport} into deterministic, PII-free log
 * lines. One line per mismatch plus a summary line. Never logs secrets, tokens,
 * or user data — only company ids, service keys, and resolved values.
 */
export function formatShadowReport(report: ShadowComparisonReport): string {
  const lines: string[] = [];
  for (const m of report.mismatches) {
    lines.push(
      `[shadow] company=${m.companyId} service=${m.serviceKey} field=${m.field} legacy=${m.legacy} new=${m.new}`,
    );
  }
  lines.push(
    `[shadow] summary passed=${report.passed} companies=${report.companyCount} ` +
      `comparisons=${report.comparisonCount} mismatches=${report.mismatchCount} ` +
      `issues=${report.loadIssues.length} baseInvariant=${report.basePlanInvariantHolds}`,
  );
  return lines.join("\n");
}

/** Re-exported so callers can build the input without importing the registry. */
export { getServiceDefinition };
