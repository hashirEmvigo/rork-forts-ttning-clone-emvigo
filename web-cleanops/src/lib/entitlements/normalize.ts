import {
  SERVICE_FEATURE_REGISTRY,
  getServiceDefinition,
  type LimitKey,
  type ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import type {
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

import type {
  AssignmentRole,
  BundleAssignmentRow,
  BundleGrantLimitRow,
  BundleGrantRow,
  BundleRow,
  BundleStatus,
  BundleType,
  CompanyOverrideLimitRow,
  CompanyOverrideRow,
  EntitlementLoadIssue,
  ResolutionContext,
  RuntimeBundle,
  RuntimeBundleAssignment,
  RuntimeBundleGrant,
  RuntimeCompanyOverride,
  RuntimeLimitValue,
} from "./types";

/**
 * Phase 2A — Pure, deterministic normalizer.
 *
 * Converts raw Supabase rows (Phase 1 schema) into the flat runtime objects the
 * future resolver consumes. This module performs **no I/O**: it is fully
 * testable in isolation and produces identical output for identical input.
 *
 * Responsibilities:
 *   - Validate `service_key` and `limit_key` against the code-owned registry.
 *   - Exclude expired / not-yet-started / cancelled assignments and overrides
 *     based on a passed-in `now`.
 *   - Flatten grants + grant limits into self-contained {@link RuntimeBundle}s.
 *   - Collect non-fatal {@link EntitlementLoadIssue}s instead of throwing.
 *
 * It does NOT resolve, merge, or evaluate anything — that is a later phase.
 */

const VALID_GRANT_STATUSES: ReadonlySet<ServiceEntitlementStatus> = new Set([
  "disabled",
  "trial",
  "enabled",
]);

const VALID_BUNDLE_TYPES: ReadonlySet<BundleType> = new Set([
  "base_plan",
  "addon",
  "campaign",
  "partner",
  "internal",
]);

/** Parses an ISO timestamp; returns null when missing or unparseable. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a validity window [startsAt, endsAt) contains `now`. An open-ended
 * `endsAt` (null) never expires. An unparseable `startsAt` is treated as
 * already-started so a present row is not silently dropped on bad data.
 */
function isWithinWindow(
  startsAt: string | null,
  endsAt: string | null,
  now: Date,
): boolean {
  const nowMs = now.getTime();
  const startMs = parseTime(startsAt);
  if (startMs !== null && startMs > nowMs) return false;
  const endMs = parseTime(endsAt);
  if (endMs !== null && endMs <= nowMs) return false;
  return true;
}

/** Returns the set of limit keys the registry declares for a service. */
function validLimitKeysForService(
  serviceKey: ServiceFeatureKey,
  registry: ServiceFeatureDefinition[],
): Set<LimitKey> {
  const def =
    registry.find((d) => d.serviceKey === serviceKey) ??
    getServiceDefinition(serviceKey);
  return new Set((def?.limits ?? []).map((l) => l.limitKey));
}

/**
 * Normalizes a set of raw limit rows for a single grant/override against the
 * service's declared limit keys. Unknown keys and rows that violate the one-of
 * (numeric XOR text) shape are dropped and recorded as issues.
 */
function normalizeLimits(
  rows: { id: string; limit_key: string; limit_value: number | null; value_text: string | null }[],
  serviceKey: ServiceFeatureKey,
  registry: ServiceFeatureDefinition[],
  issues: EntitlementLoadIssue[],
): RuntimeLimitValue[] {
  const validKeys = validLimitKeysForService(serviceKey, registry);
  const result: RuntimeLimitValue[] = [];

  for (const row of rows) {
    if (!validKeys.has(row.limit_key as LimitKey)) {
      issues.push({
        kind: "unknown-limit-key",
        message: `Limit key “${row.limit_key}” is not declared for service “${serviceKey}”; row dropped.`,
        serviceKey,
        limitKey: row.limit_key,
        rowId: row.id,
      });
      continue;
    }

    const hasNumeric = row.limit_value !== null && row.limit_value !== undefined;
    const hasText = row.value_text !== null && row.value_text !== undefined;

    if (hasNumeric === hasText) {
      issues.push({
        kind: "invalid-limit-value",
        message: `Limit “${row.limit_key}” for service “${serviceKey}” must carry exactly one of numeric/text value; row dropped.`,
        serviceKey,
        limitKey: row.limit_key,
        rowId: row.id,
      });
      continue;
    }

    if (hasNumeric) {
      result.push({
        limitKey: row.limit_key as LimitKey,
        kind: "numeric",
        value: row.limit_value as number,
      });
    } else {
      result.push({
        limitKey: row.limit_key as LimitKey,
        kind: "text",
        value: row.value_text as string,
      });
    }
  }

  // Deterministic ordering by limit key.
  result.sort((a, b) => a.limitKey.localeCompare(b.limitKey));
  return result;
}

/** The bundle-related rows the normalizer joins into flat runtime bundles. */
export interface BundleInputRows {
  bundles: BundleRow[];
  grants: BundleGrantRow[];
  grantLimits: BundleGrantLimitRow[];
}

/**
 * Normalizes bundle + grant + grant-limit rows into flat
 * {@link RuntimeBundle}s. Grants with an unknown service key or invalid status
 * are dropped (and recorded). Bundles are returned sorted by slug; grants by
 * service key, for deterministic output.
 */
export function normalizeBundles(
  input: BundleInputRows,
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): { bundles: RuntimeBundle[]; issues: EntitlementLoadIssue[] } {
  const issues: EntitlementLoadIssue[] = [];

  const limitsByGrant = new Map<string, BundleGrantLimitRow[]>();
  for (const lim of input.grantLimits) {
    const list = limitsByGrant.get(lim.grant_id) ?? [];
    list.push(lim);
    limitsByGrant.set(lim.grant_id, list);
  }

  const grantsByBundle = new Map<string, RuntimeBundleGrant[]>();
  for (const grant of input.grants) {
    if (!getServiceDefinition(grant.service_key as ServiceFeatureKey)) {
      issues.push({
        kind: "unknown-service-key",
        message: `Bundle grant references unknown service key “${grant.service_key}”; grant dropped.`,
        serviceKey: grant.service_key,
        rowId: grant.id,
      });
      continue;
    }
    if (!VALID_GRANT_STATUSES.has(grant.status as ServiceEntitlementStatus)) {
      issues.push({
        kind: "invalid-grant-status",
        message: `Bundle grant for “${grant.service_key}” has invalid status “${grant.status}”; grant dropped.`,
        serviceKey: grant.service_key,
        rowId: grant.id,
      });
      continue;
    }

    const serviceKey = grant.service_key as ServiceFeatureKey;
    const runtimeGrant: RuntimeBundleGrant = {
      serviceKey,
      status: grant.status as ServiceEntitlementStatus,
      limits: normalizeLimits(
        limitsByGrant.get(grant.id) ?? [],
        serviceKey,
        registry,
        issues,
      ),
    };
    const list = grantsByBundle.get(grant.bundle_id) ?? [];
    list.push(runtimeGrant);
    grantsByBundle.set(grant.bundle_id, list);
  }

  const bundles: RuntimeBundle[] = input.bundles.map((row) => {
    const grants = (grantsByBundle.get(row.id) ?? []).sort((a, b) =>
      a.serviceKey.localeCompare(b.serviceKey),
    );
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      bundleType: (VALID_BUNDLE_TYPES.has(row.bundle_type as BundleType)
        ? row.bundle_type
        : "internal") as BundleType,
      status: (row.status === "archived" ? "archived" : "active") as BundleStatus,
      grants,
    };
  });

  bundles.sort((a, b) => a.slug.localeCompare(b.slug));
  return { bundles, issues };
}

/**
 * Normalizes assignment rows, excluding cancelled assignments and those whose
 * validity window does not contain `now`. Returned sorted by bundle id for
 * deterministic output.
 */
export function normalizeAssignments(
  rows: BundleAssignmentRow[],
  now: Date,
): RuntimeBundleAssignment[] {
  const result: RuntimeBundleAssignment[] = [];
  for (const row of rows) {
    if (row.status !== "active") continue;
    if (!isWithinWindow(row.starts_at, row.ends_at, now)) continue;
    if (row.role !== "base" && row.role !== "addon") continue;
    result.push({
      id: row.id,
      companyId: row.company_id,
      bundleId: row.bundle_id,
      role: row.role as AssignmentRole,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    });
  }
  result.sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  return result;
}

/** The override-related rows the normalizer joins together. */
export interface OverrideInputRows {
  overrides: CompanyOverrideRow[];
  overrideLimits: CompanyOverrideLimitRow[];
}

/**
 * Normalizes override + override-limit rows. Overrides referencing an unknown
 * service key or carrying an invalid (non-null) status are dropped; those
 * outside the `now` window are excluded. A null status is valid and means the
 * override only adjusts limits. Returned sorted by service key.
 */
export function normalizeOverrides(
  input: OverrideInputRows,
  now: Date,
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): { overrides: RuntimeCompanyOverride[]; issues: EntitlementLoadIssue[] } {
  const issues: EntitlementLoadIssue[] = [];

  const limitsByOverride = new Map<string, CompanyOverrideLimitRow[]>();
  for (const lim of input.overrideLimits) {
    const list = limitsByOverride.get(lim.override_id) ?? [];
    list.push(lim);
    limitsByOverride.set(lim.override_id, list);
  }

  const overrides: RuntimeCompanyOverride[] = [];
  for (const row of input.overrides) {
    if (!getServiceDefinition(row.service_key as ServiceFeatureKey)) {
      issues.push({
        kind: "unknown-service-key",
        message: `Override references unknown service key “${row.service_key}”; override dropped.`,
        serviceKey: row.service_key,
        rowId: row.id,
      });
      continue;
    }
    if (
      row.status !== null &&
      !VALID_GRANT_STATUSES.has(row.status as ServiceEntitlementStatus)
    ) {
      issues.push({
        kind: "invalid-override-status",
        message: `Override for “${row.service_key}” has invalid status “${row.status}”; override dropped.`,
        serviceKey: row.service_key,
        rowId: row.id,
      });
      continue;
    }
    if (!isWithinWindow(row.starts_at, row.ends_at, now)) continue;

    const serviceKey = row.service_key as ServiceFeatureKey;
    overrides.push({
      id: row.id,
      companyId: row.company_id,
      serviceKey,
      status: (row.status as ServiceEntitlementStatus | null) ?? null,
      reason: row.reason,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      limits: normalizeLimits(
        limitsByOverride.get(row.id) ?? [],
        serviceKey,
        registry,
        issues,
      ),
    });
  }

  overrides.sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));
  return { overrides, issues };
}

/** Inputs for assembling a {@link ResolutionContext} from normalized parts. */
export interface BuildResolutionContextInput {
  registry?: ServiceFeatureDefinition[];
  globalEntitlements: ServiceGlobalEntitlement[];
  bundles: RuntimeBundle[];
  assignments: RuntimeBundleAssignment[];
  overrides: RuntimeCompanyOverride[];
  now: Date;
}

/**
 * Assembles already-normalized parts into a {@link ResolutionContext}. Pure: it
 * only gathers references and defaults the registry to the code-owned one. The
 * future resolver consumes this and nothing else.
 */
export function buildResolutionContext(
  input: BuildResolutionContextInput,
): ResolutionContext {
  return {
    registry: input.registry ?? SERVICE_FEATURE_REGISTRY,
    globalEntitlements: input.globalEntitlements,
    bundles: input.bundles,
    assignments: input.assignments,
    overrides: input.overrides,
    now: input.now,
  };
}
