import {
  SERVICE_FEATURE_REGISTRY,
  getServiceDefinition,
  statusFromRecord,
  type ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import type {
  CompanyServiceEntitlement,
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import type {
  BundleAssignmentRow,
  BundleGrantLimitRow,
  BundleGrantRow,
  BundleRow,
  CompanyOverrideLimitRow,
  CompanyOverrideRow,
} from "./types";

/**
 * Phase 4 — Synthetic Bundle Backfill.
 *
 * A pure, deterministic translation of the *current* (pre-bundle) entitlement
 * state into the bundle-first row shapes created in Phase 1. It performs NO I/O:
 * it does not read or write Supabase, does not touch the legacy resolver, and is
 * not imported by any production screen. Identical input always produces
 * identical output.
 *
 * Its only job is to emit synthetic rows that, when run through the Phase 2A
 * normalizer and the Phase 2B resolver, reproduce today's resolved entitlement
 * picture exactly. Those rows feed:
 *   - the Phase 5 shadow-comparison harness (in memory, no DB), and
 *   - a future real migration (rows → SQL inserts).
 *
 * Translation model (locked architecture):
 *   - ONE shared base plan ("legacy-baseline") encodes the registry defaults:
 *     every `defaultCompanyEnabled` service is granted `enabled`. Default-
 *     disabled services and all limit defaults are reproduced by the resolver's
 *     own registry fallback, so no rows are emitted for them (minimal data).
 *   - EVERY company gets exactly one active, open-ended base assignment of that
 *     plan → satisfies the "exactly one base plan per company" invariant.
 *   - Each explicit legacy company record that DEVIATES from the baseline grant
 *     becomes ONE sparse company override carrying the exact legacy status.
 *   - Global availability stays its own layer: global records are passed through
 *     and the Preferred Time Evaluation master gate
 *     (`SystemSettings.allowPreferredTimeEvaluation`) is bridged into a synthetic
 *     global-entitlement record (the pure resolver reads only `globalEntitlements`).
 */

/** Stable id of the single shared synthetic base plan. */
export const BASELINE_BUNDLE_ID = "bundle-legacy-baseline";
/** Stable slug of the single shared synthetic base plan. */
export const BASELINE_BUNDLE_SLUG = "legacy-baseline";

/** Reason recorded on every synthetic override, for governance/audit. */
const SYNTHETIC_OVERRIDE_REASON =
  "Phase 4 synthetic backfill: preserve pre-bundle company entitlement.";
/** Provenance recorded on synthetic assignments/overrides. */
const SYNTHETIC_SOURCE = "migration";

/** The slice of system settings the backfill needs (PTE master gate). */
export interface BackfillSystemSettings {
  allowPreferredTimeEvaluation: boolean;
}

/** The legacy entitlement state to translate. All arrays may be empty. */
export interface LegacyEntitlementState {
  /** Companies that must each receive a base-plan assignment. */
  companyIds: string[];
  /** Explicit per-company entitlement records (the legacy source of truth). */
  companyEntitlements: CompanyServiceEntitlement[];
  /** Platform-wide availability records (the legacy global layer). */
  globalEntitlements: ServiceGlobalEntitlement[];
  /** System settings carrying the PTE master gate. */
  systemSettings: BackfillSystemSettings;
  /** The registry to translate against. Defaults to the code-owned registry. */
  registry?: ServiceFeatureDefinition[];
  /** Instant stamped on synthetic assignment/override windows. Defaults to now. */
  now?: Date;
}

/** Diagnostic counts describing what the backfill produced. */
export interface BackfillStats {
  companyCount: number;
  baselineGrantCount: number;
  assignmentCount: number;
  overrideCount: number;
  /** Legacy records referencing a service key not in the registry (skipped). */
  skippedUnknownServiceKeys: number;
}

/**
 * The synthetic, Supabase-shaped output. `bundles`/`grants`/`assignments`/
 * `overrides` mirror the Phase 1 tables; `globalEntitlements` feeds the separate
 * global layer of {@link ResolutionContext}. Everything is deterministically
 * ordered for reproducible snapshots and diffs.
 */
export interface SyntheticBackfill {
  bundles: BundleRow[];
  grants: BundleGrantRow[];
  grantLimits: BundleGrantLimitRow[];
  assignments: BundleAssignmentRow[];
  overrides: CompanyOverrideRow[];
  overrideLimits: CompanyOverrideLimitRow[];
  globalEntitlements: ServiceGlobalEntitlement[];
  stats: BackfillStats;
}

const PREFERRED_TIME_EVALUATION_KEY: ServiceFeatureKey = "preferred_time_evaluation";

/** The baseline grant status for a service: enabled iff default-company-enabled. */
function baselineStatusFor(
  def: ServiceFeatureDefinition,
): ServiceEntitlementStatus {
  return def.defaultCompanyEnabled ? "enabled" : "disabled";
}

/** Deterministic id helpers (string ids; a real migration maps these to uuids). */
function grantId(serviceKey: string): string {
  return `grant-${BASELINE_BUNDLE_SLUG}-${serviceKey}`;
}
function assignmentId(companyId: string): string {
  return `assign-${BASELINE_BUNDLE_SLUG}-${companyId}`;
}
function overrideId(companyId: string, serviceKey: string): string {
  return `override-${companyId}-${serviceKey}`;
}

/**
 * Translates the legacy entitlement state into synthetic bundle-first rows that
 * reproduce today's resolved entitlements. Pure and deterministic.
 */
export function buildSyntheticBackfill(
  input: LegacyEntitlementState,
): SyntheticBackfill {
  const registry = input.registry ?? SERVICE_FEATURE_REGISTRY;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  // ── Company set: union of provided ids and any referenced by a record, so no
  // company with a legacy record is left without a base plan. ────────────────
  const companies = Array.from(
    new Set<string>([
      ...input.companyIds,
      ...input.companyEntitlements.map((e) => e.companyId),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  // ── Shared baseline base plan ───────────────────────────────────────────────
  const bundles: BundleRow[] = [
    {
      id: BASELINE_BUNDLE_ID,
      slug: BASELINE_BUNDLE_SLUG,
      name: "Legacy Baseline (synthetic)",
      description:
        "Synthetic base plan reproducing pre-bundle registry defaults. Created by Phase 4 backfill.",
      bundle_type: "base_plan",
      status: "active",
      is_assignable: false,
      billing_provider: null,
      billing_product_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  // Grants: positive capabilities only (default-enabled services). Default-
  // disabled services rely on the resolver's registry default (→ disabled).
  const grants: BundleGrantRow[] = registry
    .filter((def) => def.defaultCompanyEnabled)
    .map((def) => ({
      id: grantId(def.serviceKey),
      bundle_id: BASELINE_BUNDLE_ID,
      service_key: def.serviceKey,
      status: "enabled",
    }))
    .sort((a, b) => a.service_key.localeCompare(b.service_key));

  // No grant limits: the only legacy limit (media_upload_count) is registry-
  // global, so the resolver default already reproduces it.
  const grantLimits: BundleGrantLimitRow[] = [];

  // ── One base assignment per company ─────────────────────────────────────────
  const assignments: BundleAssignmentRow[] = companies.map((companyId) => ({
    id: assignmentId(companyId),
    company_id: companyId,
    bundle_id: BASELINE_BUNDLE_ID,
    role: "base",
    status: "active",
    starts_at: nowIso,
    ends_at: null,
  }));

  // ── Sparse overrides for deviating explicit records ─────────────────────────
  const overrides: CompanyOverrideRow[] = [];
  let skippedUnknownServiceKeys = 0;

  // Deterministic processing order so output is stable regardless of input order.
  const sortedRecords = [...input.companyEntitlements].sort((a, b) => {
    const byCompany = a.companyId.localeCompare(b.companyId);
    return byCompany !== 0 ? byCompany : a.serviceKey.localeCompare(b.serviceKey);
  });

  for (const record of sortedRecords) {
    const def = getServiceDefinition(record.serviceKey);
    if (!def) {
      skippedUnknownServiceKeys += 1;
      continue;
    }
    const legacyStatus = statusFromRecord(record);
    if (legacyStatus === baselineStatusFor(def)) continue; // matches default → sparse, skip

    overrides.push({
      id: overrideId(record.companyId, record.serviceKey),
      company_id: record.companyId,
      service_key: record.serviceKey,
      status: legacyStatus,
      reason: SYNTHETIC_OVERRIDE_REASON,
      starts_at: nowIso,
      ends_at: null,
    });
  }
  overrides.sort((a, b) => {
    const byCompany = a.company_id.localeCompare(b.company_id);
    return byCompany !== 0 ? byCompany : a.service_key.localeCompare(b.service_key);
  });

  // No override limits: legacy carries no per-company limit values.
  const overrideLimits: CompanyOverrideLimitRow[] = [];

  // ── Global layer: explicit record per registry service ──────────────────────
  const existingGlobalByKey = new Map<string, ServiceGlobalEntitlement>();
  for (const g of input.globalEntitlements) existingGlobalByKey.set(g.serviceKey, g);

  const globalEntitlements: ServiceGlobalEntitlement[] = registry
    .map((def) => {
      if (def.serviceKey === PREFERRED_TIME_EVALUATION_KEY) {
        // Bridge the legacy master gate into a pure global record.
        return {
          serviceKey: def.serviceKey,
          enabled: input.systemSettings.allowPreferredTimeEvaluation === true,
          updatedBy: null,
          updatedAt: nowIso,
        };
      }
      const existing = existingGlobalByKey.get(def.serviceKey);
      if (existing) return existing; // preserve provenance as-is
      return {
        serviceKey: def.serviceKey,
        enabled: def.defaultGlobalEnabled === true,
        updatedBy: null,
        updatedAt: nowIso,
      };
    })
    .sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));

  return {
    bundles,
    grants,
    grantLimits,
    assignments,
    overrides,
    overrideLimits,
    globalEntitlements,
    stats: {
      companyCount: companies.length,
      baselineGrantCount: grants.length,
      assignmentCount: assignments.length,
      overrideCount: overrides.length,
      skippedUnknownServiceKeys,
    },
  };
}
