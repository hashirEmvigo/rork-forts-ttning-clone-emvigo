import { SERVICE_FEATURE_REGISTRY } from "@/lib/serviceRegistry";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ServiceGlobalEntitlement } from "@/types";

import {
  buildResolutionContext,
  normalizeAssignments,
  normalizeBundles,
  normalizeOverrides,
} from "./normalize";
import type {
  BundleAssignmentRow,
  BundleGrantLimitRow,
  BundleGrantRow,
  BundleRow,
  CompanyOverrideLimitRow,
  CompanyOverrideRow,
  EntitlementLoadIssue,
  ResolutionContext,
} from "./types";

/**
 * Phase 2A — Read-side Supabase loader.
 *
 * Reads the Phase 1 entitlement tables for a single company and delegates all
 * shaping to the pure normalizer, producing a {@link ResolutionContext}.
 *
 * Strictly read-only and UNWIRED: no production screen imports this yet, no
 * resolver consumes the context, no shadow comparison, no data backfill. It
 * exists so the bundle-first read path can be verified in isolation before the
 * resolver is built. Safe-by-design like `companiesSupabase.ts`: it never
 * throws and returns a `null` context with a diagnostic reason on any failure.
 */

/** Why the load resolved to a particular outcome. */
export type EntitlementLoadReason =
  | "ok"
  | "supabase-not-configured"
  | "query-error"
  | "exception";

/** The result of an entitlement context load. */
export interface EntitlementLoadResult {
  /** The assembled context, or null when it could not be loaded. */
  context: ResolutionContext | null;
  source: "supabase" | "none";
  reason: EntitlementLoadReason;
  /** Non-fatal normalization findings (unknown keys, bad values, …). */
  issues: EntitlementLoadIssue[];
}

/** Inputs for {@link loadEntitlementContext}. */
export interface LoadEntitlementContextInput {
  /** The company whose assignments/overrides to load. */
  companyId: string;
  /**
   * Platform-wide availability records. Passed in (Phase 2A does not load the
   * global layer) and threaded straight into the context.
   */
  globalEntitlements: ServiceGlobalEntitlement[];
  /** The instant used for validity-window filtering. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Loads and normalizes the bundle-first entitlement data for one company.
 *
 * Read flow:
 *   1. active `company_bundle_assignments` for the company
 *   2. the assigned `entitlement_bundles`
 *   3. their `entitlement_bundle_grants`
 *   4. those grants' `entitlement_bundle_grant_limits`
 *   5. the company's `company_feature_overrides`
 *   6. those overrides' `company_feature_override_limits`
 *
 * Then hands the raw rows to the pure normalizer (registry validation +
 * `now`-window filtering) and assembles a {@link ResolutionContext}.
 */
export async function loadEntitlementContext(
  input: LoadEntitlementContextInput,
): Promise<EntitlementLoadResult> {
  const now = input.now ?? new Date();

  if (!isSupabaseConfigured || !supabase) {
    console.warn(
      "[entitlements] No context loaded — reason: Supabase not configured " +
        "(EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing).",
    );
    return {
      context: null,
      source: "none",
      reason: "supabase-not-configured",
      issues: [],
    };
  }

  try {
    // 1. Active assignments (DB filter; the normalizer re-checks the window).
    const assignmentsRes = await supabase
      .from("company_bundle_assignments")
      .select("id, company_id, bundle_id, role, status, starts_at, ends_at")
      .eq("company_id", input.companyId)
      .eq("status", "active");

    if (assignmentsRes.error) {
      return queryError("company_bundle_assignments", assignmentsRes.error);
    }
    const assignmentRows = (assignmentsRes.data ?? []) as BundleAssignmentRow[];

    // 5. Overrides for the company (loaded in parallel with bundle joins below).
    const overridesRes = await supabase
      .from("company_feature_overrides")
      .select("id, company_id, service_key, status, reason, starts_at, ends_at")
      .eq("company_id", input.companyId);

    if (overridesRes.error) {
      return queryError("company_feature_overrides", overridesRes.error);
    }
    const overrideRows = (overridesRes.data ?? []) as CompanyOverrideRow[];

    const overrideIds = overrideRows.map((o) => o.id);
    let overrideLimitRows: CompanyOverrideLimitRow[] = [];
    if (overrideIds.length > 0) {
      const overrideLimitsRes = await supabase
        .from("company_feature_override_limits")
        .select("id, override_id, limit_key, limit_value, value_text")
        .in("override_id", overrideIds);
      if (overrideLimitsRes.error) {
        return queryError("company_feature_override_limits", overrideLimitsRes.error);
      }
      overrideLimitRows = (overrideLimitsRes.data ?? []) as CompanyOverrideLimitRow[];
    }

    // 2–4. Bundles → grants → grant limits, only for assigned bundles.
    const bundleIds = Array.from(new Set(assignmentRows.map((a) => a.bundle_id)));
    let bundleRows: BundleRow[] = [];
    let grantRows: BundleGrantRow[] = [];
    let grantLimitRows: BundleGrantLimitRow[] = [];

    if (bundleIds.length > 0) {
      const bundlesRes = await supabase
        .from("entitlement_bundles")
        .select(
          "id, slug, name, description, bundle_type, status, is_assignable, billing_provider, billing_product_id, created_at, updated_at",
        )
        .in("id", bundleIds);
      if (bundlesRes.error) {
        return queryError("entitlement_bundles", bundlesRes.error);
      }
      bundleRows = (bundlesRes.data ?? []) as BundleRow[];

      const grantsRes = await supabase
        .from("entitlement_bundle_grants")
        .select("id, bundle_id, service_key, status")
        .in("bundle_id", bundleIds);
      if (grantsRes.error) {
        return queryError("entitlement_bundle_grants", grantsRes.error);
      }
      grantRows = (grantsRes.data ?? []) as BundleGrantRow[];

      const grantIds = grantRows.map((g) => g.id);
      if (grantIds.length > 0) {
        const grantLimitsRes = await supabase
          .from("entitlement_bundle_grant_limits")
          .select("id, grant_id, limit_key, limit_value, value_text")
          .in("grant_id", grantIds);
        if (grantLimitsRes.error) {
          return queryError("entitlement_bundle_grant_limits", grantLimitsRes.error);
        }
        grantLimitRows = (grantLimitsRes.data ?? []) as BundleGrantLimitRow[];
      }
    }

    // Normalize (pure).
    const { bundles, issues: bundleIssues } = normalizeBundles(
      { bundles: bundleRows, grants: grantRows, grantLimits: grantLimitRows },
      SERVICE_FEATURE_REGISTRY,
    );
    const assignments = normalizeAssignments(assignmentRows, now);
    const { overrides, issues: overrideIssues } = normalizeOverrides(
      { overrides: overrideRows, overrideLimits: overrideLimitRows },
      now,
      SERVICE_FEATURE_REGISTRY,
    );

    const context = buildResolutionContext({
      registry: SERVICE_FEATURE_REGISTRY,
      globalEntitlements: input.globalEntitlements,
      bundles,
      assignments,
      overrides,
      now,
    });

    return {
      context,
      source: "supabase",
      reason: "ok",
      issues: [...bundleIssues, ...overrideIssues],
    };
  } catch (err) {
    console.error(
      "[entitlements] No context loaded — reason: exception during Supabase request " +
        "(network/CORS/invalid URL).",
      err,
    );
    return { context: null, source: "none", reason: "exception", issues: [] };
  }
}

/** Builds a uniform query-error result and logs the full PostgREST error. */
function queryError(
  table: string,
  error: { message: string; code?: string; details?: string | null; hint?: string | null },
): EntitlementLoadResult {
  console.error(`[entitlements] No context loaded — reason: query error on “${table}”.`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
  return { context: null, source: "none", reason: "query-error", issues: [] };
}
