import type {
  LimitKey,
  LimitValueType,
  MergeKind,
  ServiceFeatureDefinition,
} from "@/lib/serviceRegistry";
import type {
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
} from "@/types";

/**
 * Phase 2A — Read-side loader + normalizer types for the bundle-first
 * entitlement system.
 *
 * This module defines two layers of shapes:
 *
 *  1. **Raw row types** — faithful mirrors of the Supabase tables created in
 *     Phase 1 (`0006_entitlement_schema.sql`). These exist only so the loader
 *     can type the PostgREST `select` result before normalization.
 *  2. **Runtime types** — flat, self-contained objects the pure resolver (a
 *     later phase) will consume, assembled into a {@link ResolutionContext}.
 *
 * Phase 2A is read-only and unwired: nothing in the app imports these yet, so
 * existing behaviour is unchanged. No resolver, shadow comparison, or backfill
 * lives here.
 */

// ── Bundle classification ────────────────────────────────────────────────────

/** A bundle's classification, mirroring `entitlement_bundles.bundle_type`. */
export type BundleType =
  | "base_plan"
  | "addon"
  | "campaign"
  | "partner"
  | "internal";

/** Soft-delete state of a bundle, mirroring `entitlement_bundles.status`. */
export type BundleStatus = "active" | "archived";

/** Role of a company → bundle assignment, mirroring the `role` column. */
export type AssignmentRole = "base" | "addon";

/** Lifecycle of a company → bundle assignment, mirroring the `status` column. */
export type AssignmentStatus = "active" | "cancelled";

// ── Raw Supabase row types (PostgREST select results) ────────────────────────

/** A row of `entitlement_bundles`. */
export interface BundleRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  bundle_type: string;
  status: string;
  is_assignable: boolean;
  billing_provider: string | null;
  billing_product_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** A row of `entitlement_bundle_grants`. */
export interface BundleGrantRow {
  id: string;
  bundle_id: string;
  service_key: string;
  status: string;
}

/** A row of `entitlement_bundle_grant_limits`. */
export interface BundleGrantLimitRow {
  id: string;
  grant_id: string;
  limit_key: string;
  limit_value: number | null;
  value_text: string | null;
}

/** A row of `company_bundle_assignments`. */
export interface BundleAssignmentRow {
  id: string;
  company_id: string;
  bundle_id: string;
  role: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
}

/** A row of `company_feature_overrides`. */
export interface CompanyOverrideRow {
  id: string;
  company_id: string;
  service_key: string;
  status: string | null;
  reason: string;
  starts_at: string;
  ends_at: string | null;
}

/** A row of `company_feature_override_limits`. */
export interface CompanyOverrideLimitRow {
  id: string;
  override_id: string;
  limit_key: string;
  limit_value: number | null;
  value_text: string | null;
}

// ── Normalized runtime types ─────────────────────────────────────────────────

/**
 * A single resolved limit value. Mirrors the Phase 1 one-of constraint
 * (`num_nonnulls(limit_value, value_text) = 1`): exactly one of numeric/text
 * carries the value, modelled here as a discriminated union so consumers never
 * have to test two nullable fields.
 */
export type RuntimeLimitValue =
  | { limitKey: LimitKey; kind: "numeric"; value: number }
  | { limitKey: LimitKey; kind: "text"; value: string };

/** A feature grant inside a runtime bundle, with its limit values flattened. */
export interface RuntimeBundleGrant {
  serviceKey: ServiceFeatureKey;
  status: ServiceEntitlementStatus;
  limits: RuntimeLimitValue[];
}

/**
 * A flat, self-contained bundle: its grants and their limit values are already
 * joined in. This matches the locked "runtime bundles are flat" decision.
 */
export interface RuntimeBundle {
  id: string;
  slug: string;
  name: string;
  bundleType: BundleType;
  status: BundleStatus;
  grants: RuntimeBundleGrant[];
}

/**
 * An *active* company → bundle assignment within the `now` window. The loader
 * and normalizer exclude cancelled, expired, and not-yet-started assignments,
 * so every assignment present here is currently in force.
 */
export interface RuntimeBundleAssignment {
  id: string;
  companyId: string;
  bundleId: string;
  role: AssignmentRole;
  startsAt: string;
  endsAt: string | null;
}

/**
 * A sparse per-company override that is currently in force within the `now`
 * window. `status` is null when the override only adjusts limits (not the
 * enabled state). Its limit values are flattened in.
 */
export interface RuntimeCompanyOverride {
  id: string;
  companyId: string;
  serviceKey: ServiceFeatureKey;
  status: ServiceEntitlementStatus | null;
  reason: string;
  startsAt: string;
  endsAt: string | null;
  limits: RuntimeLimitValue[];
}

/**
 * The normalized, deterministic input the (future) pure resolver consumes.
 * Assembled by {@link buildResolutionContext}. The resolver never fetches from
 * Supabase directly — it only reads this context.
 */
export interface ResolutionContext {
  /** The code-owned feature/limit definitions (single source of truth). */
  registry: ServiceFeatureDefinition[];
  /** Platform-wide availability records, passed in (not loaded in Phase 2A). */
  globalEntitlements: ServiceGlobalEntitlement[];
  /** Flat bundles relevant to the loaded company. */
  bundles: RuntimeBundle[];
  /** Active assignments for the loaded company. */
  assignments: RuntimeBundleAssignment[];
  /** Active sparse overrides for the loaded company. */
  overrides: RuntimeCompanyOverride[];
  /** The instant used for all validity-window filtering. */
  now: Date;
}

// ── Resolver outputs (Phase 2B) ──────────────────────────────────────────────

/**
 * Where a resolved value ultimately came from, lowest precedence first:
 *  - `default`  — no bundle or override provided one; the registry default.
 *  - `bundle`   — produced by merging one or more assigned bundle grants.
 *  - `override` — a sparse company override took precedence.
 */
export type ResolutionSource = "default" | "bundle" | "override";

/**
 * A single fully-resolved limit for a service after merging stacked bundles and
 * applying any company override. `value` is typed by the limit's declared
 * {@link LimitValueType}; `null` denotes unlimited for `count` limits.
 */
export interface ResolvedLimit {
  limitKey: LimitKey;
  valueType: LimitValueType;
  mergeKind: MergeKind;
  value: number | boolean | string | null;
  source: ResolutionSource;
}

/**
 * The fully-resolved entitlement for one service: its effective status (after
 * the global gate, stacked bundles, and any override) plus every declared limit
 * resolved to a concrete value. Pure output of the resolver.
 */
export interface ResolvedEntitlement {
  serviceKey: ServiceFeatureKey;
  /** Whether the service is available platform-wide (global gate). */
  globallyAvailable: boolean;
  /** Effective tri-state status the company sees (after the global gate). */
  status: ServiceEntitlementStatus;
  /**
   * The company-layer tri-state status BEFORE the global gate is applied
   * (merged bundles + any override, else the registry default). Mirrors the
   * legacy `resolveCompanyEntitlementStatus`, which intentionally ignores global
   * availability so callers can combine the gate separately.
   */
  companyStatus: ServiceEntitlementStatus;
  /** Convenience: `status !== "disabled"` (effective, gated). */
  entitled: boolean;
  /** Where the effective status came from. */
  statusSource: ResolutionSource;
  /** Ids of the assigned bundles that contributed an enabling/trial grant. */
  contributingBundleIds: string[];
  /** The override that affected this service, when one did. */
  overrideId: string | null;
  /** Every limit the registry declares for the service, resolved. */
  limits: ResolvedLimit[];
}

/**
 * The complete resolved entitlement picture for a company at `resolvedAt`.
 * Provides both an ordered list and a by-service lookup for ergonomic reads.
 */
export interface ResolvedCompanyEntitlements {
  companyId: string;
  /** The instant resolution was performed against (mirrors context.now). */
  resolvedAt: Date;
  /** One resolved entitlement per registry service, ordered by service key. */
  entitlements: ResolvedEntitlement[];
  /** Lookup of the same entitlements keyed by service key. */
  byService: Record<string, ResolvedEntitlement>;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

/**
 * A non-fatal finding raised while normalizing rows. The normalizer is
 * deterministic and never throws: invalid rows are dropped and recorded here so
 * callers (and tests) can assert on data quality without breaking the load.
 */
export interface EntitlementLoadIssue {
  kind:
    | "unknown-service-key"
    | "invalid-grant-status"
    | "unknown-limit-key"
    | "invalid-limit-value"
    | "invalid-override-status";
  message: string;
  /** The offending service key, when known. */
  serviceKey?: string;
  /** The offending limit key, when the issue is limit-specific. */
  limitKey?: string;
  /** The source row id, when known, for traceability. */
  rowId?: string;
}
