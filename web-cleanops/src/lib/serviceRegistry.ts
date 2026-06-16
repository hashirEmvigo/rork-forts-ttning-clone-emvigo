import { getModuleDefinition } from "@/lib/modules";
import type {
  CompanyServiceEntitlement,
  ServiceEntitlementStatus,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
  SystemSettings,
} from "@/types";

/**
 * Central registry and pure resolution layer for optional, entitlement-gated
 * platform features (paid add-ons). This is the single source of truth for
 * which features exist and how their availability is resolved from the three
 * independent layers:
 *
 *  1. Global availability  — Super Admin: is the feature available at all?
 *  2. Company entitlement   — Super Admin: does this company have access?
 *  3. Company setting        — Company Admin: has the company turned it on?
 *
 * A feature is usable for a company only when all applicable layers agree. This
 * module is framework- and storage-agnostic so it can be reused by the context,
 * the UI and future invoicing.
 */

/**
 * One product surface a platform feature touches. Phase 0 is diagnostic/display
 * only — these have NO effect on runtime access, entitlement, or navigation.
 *
 *  - `module` references a {@link ModuleDefinition.id} (visibility/role surface).
 *  - `route`  references an in-app path the feature influences.
 *  - `area`   is a free-form functional area when no module/route fits (the
 *             common case for cross-cutting capabilities).
 */
export type FeatureSurface =
  | { kind: "module"; moduleId: string; note?: string }
  | { kind: "route"; path: string; note?: string }
  | { kind: "area"; area: string; note?: string };

/** A human-readable label for a {@link FeatureSurface}, for UI display. */
export function describeFeatureSurface(surface: FeatureSurface): string {
  switch (surface.kind) {
    case "module":
      return getModuleDefinition(surface.moduleId)?.name ?? surface.moduleId;
    case "route":
      return surface.path;
    case "area":
      return surface.area;
  }
}

/**
 * The closed set of strategies for merging the *same* configurable value when a
 * company is assigned several stacked bundles (later phases). The merge rule is
 * a property of the value's declaration in the registry — the resolver only
 * dispatches over these kinds and never guesses. Keep this set small; adding a
 * new kind is a deliberate contract change.
 *
 *  - `boolean-or`       — capability flags; any bundle granting it wins (`true`).
 *  - `numeric-max`      — generous numeric limits; the highest value wins.
 *  - `numeric-sum`      — explicit top-up add-ons only; values are summed.
 *  - `unlimited-wins`   — numeric limits where `null` means unlimited; `null`
 *                         beats every number.
 *  - `enum-priority`    — enum settings resolved by a declared priority order
 *                         (see {@link FeatureLimitDefinition.enumPriority}).
 *  - `exclusive-pinned` — singular settings that must NOT be set by stacked
 *                         add-ons; resolved only from the base plan or an
 *                         explicit company override.
 *
 * NOTE (Phase 0): declaration-only. No runtime merging consumes this yet.
 */
export type MergeKind =
  | "boolean-or"
  | "numeric-max"
  | "numeric-sum"
  | "unlimited-wins"
  | "enum-priority"
  | "exclusive-pinned";

/**
 * Stable identifier for a per-feature configurable limit/setting. Like
 * {@link ServiceFeatureKey} this is a hard-coded union so bundle grants,
 * overrides and the audit log stay strongly typed. Add new keys here as
 * features gain configurable limits.
 */
export type LimitKey = "media_upload_count";

/** The value type a {@link FeatureLimitDefinition} carries. */
export type LimitValueType = "count" | "boolean" | "enum";

/**
 * Declares one configurable limit/setting a feature exposes, including how its
 * value merges across stacked bundles. This generalises today's single
 * {@link ServiceFeatureDefinition.trialLimit}/`trialLimitType` pair into a
 * first-class, multi-limit declaration.
 *
 * Phase 0 (additive, declaration-only): nothing in the live resolver reads
 * these yet — `evaluateUsageGate` still reads `trialLimit`/`trialLimitType`.
 * This is the forward shape that bundle merging (later phases) will consume.
 */
export interface FeatureLimitDefinition {
  /** Stable identifier for this limit, unique across the whole registry. */
  limitKey: LimitKey;
  /** Human-readable name for admin/packaging UI. */
  name: string;
  /** The value type this limit holds. */
  valueType: LimitValueType;
  /** How values for this limit merge across stacked bundles. */
  mergeKind: MergeKind;
  /**
   * The default value when no bundle or override provides one. For `count`
   * limits, `null` denotes unlimited.
   */
  defaultValue: number | boolean | string | null;
  /**
   * For `enum-priority` limits, the declared priority order from lowest to
   * highest rank; the highest-ranked value present wins. Required when
   * {@link mergeKind} is `enum-priority`, otherwise omitted.
   */
  enumPriority?: string[];
  /** Whether configuring this limit is a billable differentiator. */
  billingEligible: boolean;
  /** Label for a future invoice/packaging specification line. */
  billingLabel?: string;
}

/** A definition describing one optional service/feature in the registry. */
export interface ServiceFeatureDefinition {
  serviceKey: ServiceFeatureKey;
  name: string;
  description: string;
  /** Grouping label, e.g. "Work Orders". */
  category: string;
  /** lucide-react icon identifier, used by the entitlements UI. */
  icon: string;
  /** Whether enabling this for a company can later appear on an invoice. */
  billingEligible: boolean;
  /** The label to show on a future invoice specification line. */
  billingLabel: string;
  /** Platform-wide default availability when no global record exists. */
  defaultGlobalEnabled: boolean;
  /**
   * Whether this service can be granted on a time/usage-limited trial. When
   * false, the company status is only ever `disabled` or `enabled`.
   */
  supportsTrial: boolean;
  /**
   * The kind of trial limit. `count` caps a number of usages (e.g. uploads).
   * Stored in the registry so future services can add their own limit kinds
   * without code changes at the call site.
   */
  trialLimitType?: "count";
  /**
   * The trial allowance for {@link trialLimitType}. For `count` this is the
   * maximum number of usages permitted during the trial. Never hard-code this
   * value at call sites — always read it from the registry.
   */
  trialLimit?: number;
  /**
   * Default company entitlement when no per-company record exists. For features
   * that predate the entitlement model this is `true` so existing companies
   * keep working (compatibility) until the Super Admin curates entitlements.
   */
  defaultCompanyEnabled: boolean;
  /** Where the company-level setting lives, for UI hints. */
  settingsPath?: string;
  /**
   * Phase 0 (additive, diagnostic-only): the product surfaces this feature
   * affects. This documents *where* a capability has impact and has NO effect
   * on runtime access, entitlement resolution, navigation, or permissions.
   */
  affects?: FeatureSurface[];
  /**
   * Phase 0 (additive, declaration-only): the configurable limits/settings this
   * feature exposes, each declaring its own {@link MergeKind}. The feature's own
   * `enabled` flag always merges as `boolean-or` and is not listed here. NO
   * runtime effect yet — the live resolver still reads `trialLimit`/
   * `trialLimitType`. This is the forward shape bundle merging will consume.
   */
  limits?: FeatureLimitDefinition[];
}

/** The Preferred Time Evaluation feature key, surfaced for callers. */
export const PREFERRED_TIME_EVALUATION_KEY: ServiceFeatureKey =
  "preferred_time_evaluation";

/** The Media Uploads premium service key, surfaced for callers. */
export const MEDIA_UPLOADS_KEY: ServiceFeatureKey = "media_uploads";

/** The Time Bank premium service key, surfaced for callers. */
export const TIME_BANK_KEY: ServiceFeatureKey = "time_bank";

/**
 * Operational Execution feature keys (Phase 1 foundation). These register the
 * modules with the existing bundle-first entitlement system; they carry NO
 * runtime UI/behaviour yet. The architecture's entitlement vocabulary maps onto
 * the platform's {@link ServiceEntitlementStatus}: active → enabled, trial →
 * trial, inactive → disabled (see `mapEntitlementStateToStatus`).
 */
export const MISSION_LOG_KEY: ServiceFeatureKey = "mission_log";
export const TIME_REPORTING_KEY: ServiceFeatureKey = "time_reporting";
export const OPERATIONAL_FLAGS_KEY: ServiceFeatureKey = "operational_flags";
export const NOTIFICATION_CENTER_KEY: ServiceFeatureKey = "notification_center";
export const INCIDENT_MANAGEMENT_KEY: ServiceFeatureKey = "incident_management";
export const ACTION_CENTER_KEY: ServiceFeatureKey = "action_center";
export const TIME_QUALITY_ANALYTICS_KEY: ServiceFeatureKey = "time_quality_analytics";
export const PAYROLL_BASIS_KEY: ServiceFeatureKey = "payroll_basis";
export const INVOICE_BASIS_KEY: ServiceFeatureKey = "invoice_basis";

/**
 * The Operational Execution feature keys, in module order (2 core + 7 add-ons).
 * A convenience list for diagnostics/registry iteration — never a replacement
 * for {@link SERVICE_FEATURE_REGISTRY}.
 */
export const OPERATIONAL_EXECUTION_FEATURE_KEYS: ServiceFeatureKey[] = [
  MISSION_LOG_KEY,
  TIME_REPORTING_KEY,
  OPERATIONAL_FLAGS_KEY,
  NOTIFICATION_CENTER_KEY,
  INCIDENT_MANAGEMENT_KEY,
  ACTION_CENTER_KEY,
  TIME_QUALITY_ANALYTICS_KEY,
  PAYROLL_BASIS_KEY,
  INVOICE_BASIS_KEY,
];

/**
 * The Admin Requests service key, surfaced for callers. Registry identity only
 * (ratified Model 2): this billable service is granted through Super Admin
 * Services first and later bridges into the existing Company Admin Settings →
 * Modules model (the `admin-requests` module). No runtime access, route gating,
 * company module activation, or Service→Module bridge is wired to this key in
 * this wave.
 *
 * Admin Requests and Employee & Customer Requests are SEPARATE products/modules
 * (they will differ significantly). The Employee & Customer Requests service is
 * deferred: its future key `employee_customer_requests` (affecting the
 * `employee-customer-requests` module) is intentionally NOT implemented here.
 */
export const ADMIN_REQUESTS_KEY: ServiceFeatureKey = "admin_requests";

/** The catalogue of optional services/features available on the platform. */
export const SERVICE_FEATURE_REGISTRY: ServiceFeatureDefinition[] = [
  {
    serviceKey: "preferred_time_evaluation",
    name: "Preferred Time Evaluation",
    description:
      "Shows whether scheduled service times are optimal, acceptable, or outside the customer's approved time range.",
    category: "Work Orders",
    icon: "Clock4",
    billingEligible: true,
    billingLabel: "Preferred Time Evaluation",
    defaultGlobalEnabled: false,
    // Existing companies were gated only by master + company setting before the
    // entitlement model existed; default to entitled so we don't break them.
    defaultCompanyEnabled: true,
    settingsPath: "Settings → Work Orders",
    supportsTrial: true,
    affects: [
      { kind: "area", area: "Work Orders" },
      { kind: "area", area: "Scheduling" },
      { kind: "area", area: "Booking" },
      { kind: "area", area: "Recurring Service Scheduling" },
      { kind: "area", area: "Customer-Approved Time Windows" },
    ],
  },
  {
    serviceKey: "media_uploads",
    name: "Media Uploads",
    description:
      "Allows image uploads through the Customer Media Library, Work Orders, and future Protocol and Employee uploads. Existing images always remain viewable; only new uploads are gated.",
    category: "Media",
    icon: "ImagePlus",
    billingEligible: true,
    billingLabel: "Media Uploads",
    defaultGlobalEnabled: true,
    // Premium add-on: brand-new companies must be granted access explicitly.
    defaultCompanyEnabled: false,
    settingsPath: "Customer → Media, Work Order → Images",
    supportsTrial: true,
    trialLimitType: "count",
    trialLimit: 30,
    // Declaration-only (Phase 0): mirrors the current trial allowance so future
    // bundle merging can read it. The live gate still reads `trialLimit` above.
    limits: [
      {
        limitKey: "media_upload_count",
        name: "Media Upload Count",
        valueType: "count",
        mergeKind: "numeric-max",
        defaultValue: 30,
        billingEligible: true,
        billingLabel: "Media Uploads",
      },
    ],
    affects: [
      { kind: "area", area: "Customer Media" },
      { kind: "area", area: "Work Order Images" },
      { kind: "area", area: "Protocol Uploads", note: "Planned" },
      { kind: "area", area: "Employee Uploads", note: "Planned" },
    ],
  },
  {
    serviceKey: "time_bank",
    name: "Time Bank",
    description:
      "Prepaid pool of service minutes attached to a customer agreement. Grants access to wallet creation, scheduled refills, carryover/expiry, and cancelled-visit credits. Existing ledgers always remain readable; only wallet creation and accrual are gated.",
    category: "Agreements",
    icon: "PiggyBank",
    billingEligible: true,
    billingLabel: "Time Bank",
    // Platform offers Time Bank; a company must be granted access via a bundle
    // or override before any wallet can be provisioned (no hidden activation).
    defaultGlobalEnabled: true,
    // Premium add-on: brand-new companies are NOT entitled by default.
    defaultCompanyEnabled: false,
    settingsPath: "Agreements → Time Bank",
    supportsTrial: true,
    affects: [
      { kind: "area", area: "Time Bank" },
      { kind: "area", area: "Customer Agreements" },
      { kind: "area", area: "Agreement Templates" },
      { kind: "area", area: "Cancelled Visit Credit" },
    ],
  },
  // ── Operational Execution (Phase 1 foundation — keys + metadata only) ──
  // These register the modules with the bundle-first entitlement system so they
  // can later be granted per company. NO UI, route, navigation or behaviour is
  // wired in Phase 1 — enabling/disabling these has no runtime effect yet.
  {
    serviceKey: "mission_log",
    name: "Mission Log",
    description:
      "Operational execution ledger: what actually happened on each mission — check-in/out sessions, GPS/QR verification, delay projection and the event timeline that feeds Time Reporting. Records execution only; never the financial approval workspace.",
    category: "Operational Execution",
    icon: "ClipboardCheck",
    billingEligible: true,
    billingLabel: "Mission Log",
    // Platform offers it; a company must be granted access via a bundle/override.
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    settingsPath: "Settings → Mission Log",
    supportsTrial: true,
    affects: [
      { kind: "area", area: "Mission Log" },
      { kind: "area", area: "Execution Ledger" },
    ],
  },
  {
    serviceKey: "time_reporting",
    name: "Time Reporting",
    description:
      "Standalone approval, adjustment and time-classification workspace optimised for high-volume exception-based review (saved review queues, advanced filters, bulk actions, flag triage). Consumes Mission Log execution data; separate from Mission Log.",
    category: "Operational Execution",
    icon: "Clock",
    billingEligible: true,
    billingLabel: "Time Reporting",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    settingsPath: "Settings → Time Reporting",
    supportsTrial: true,
    affects: [
      { kind: "area", area: "Time Reporting" },
      { kind: "area", area: "Time Approval" },
      { kind: "area", area: "Time Classification" },
    ],
  },
  {
    serviceKey: "operational_flags",
    name: "Operational Flags",
    description:
      "Add-on: converts Mission Log and Time Reporting conditions into visible operational risk indicators with their own resolution lifecycle. Reserved in Phase 1.",
    category: "Operational Execution",
    icon: "Flag",
    billingEligible: true,
    billingLabel: "Operational Flags",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    affects: [{ kind: "area", area: "Operational Flags" }],
  },
  {
    serviceKey: "notification_center",
    name: "Notification Center",
    description:
      "Add-on: consumes operational events and delivers in-app/push/email/SMS messages to admins, employees and customers under company settings + opt-in. Reserved in Phase 1.",
    category: "Operational Execution",
    icon: "Bell",
    billingEligible: true,
    billingLabel: "Notification Center",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    affects: [{ kind: "area", area: "Notification Center" }],
  },
  {
    serviceKey: "incident_management",
    name: "Incident Management",
    description:
      "Add-on: consumes operational events and creates formal incident cases with their own timeline and handling. Reserved in Phase 1.",
    category: "Operational Execution",
    icon: "ShieldAlert",
    billingEligible: true,
    billingLabel: "Incident Management",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    affects: [{ kind: "area", area: "Incident Management" }],
  },
  {
    serviceKey: "action_center",
    name: "Action Center",
    description:
      "Add-on: central queue of items requiring a human decision or follow-up, sourced from Mission Log, Time Reporting and other modules. Reserved in Phase 1.",
    category: "Operational Execution",
    icon: "ListChecks",
    billingEligible: true,
    billingLabel: "Action Center",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    affects: [{ kind: "area", area: "Action Center" }],
  },
  {
    serviceKey: "time_quality_analytics",
    name: "Time Quality Analytics",
    description:
      "Premium add-on: booked-time accuracy and pattern analysis (customer time fit, employee time patterns, reason-code statistics). Mission Log collects the booked-time rating; this provides the advanced analysis. Reserved in Phase 1.",
    category: "Operational Execution",
    icon: "BarChart3",
    billingEligible: true,
    billingLabel: "Time Quality Analytics",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    affects: [{ kind: "area", area: "Time Quality Analytics" }],
  },
  {
    serviceKey: "payroll_basis",
    name: "Payroll Basis",
    description:
      "Reserved feature key only (Phase 1): the future approved payroll-ready output that consumes approved payroll-relevant time. No behaviour is implemented in this phase; payroll calculations and the time bank stay fully separate.",
    category: "Payroll",
    icon: "Coins",
    billingEligible: true,
    billingLabel: "Payroll Basis",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    // Reserved key: no trial semantics until the payroll architecture is built.
    supportsTrial: false,
    affects: [{ kind: "area", area: "Payroll Basis" }],
  },
  {
    serviceKey: "invoice_basis",
    name: "Invoice Basis",
    description:
      "Reserved feature key only (Phase 1): the future approved invoice/customer-billing output that consumes approved billable time. No behaviour is implemented in this phase; the customer time bank is only ever affected by Invoice Basis, never by Mission Log or Time Reporting.",
    category: "Billing",
    icon: "ReceiptText",
    billingEligible: true,
    billingLabel: "Invoice Basis",
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: false,
    affects: [{ kind: "area", area: "Invoice Basis" }],
  },
  // ── Admin Requests (registry identity only — ratified Model 2) ──
  // Creates the commercial Admin Requests service identity ONLY. It intentionally
  // wires NO runtime behaviour: no route gating, no `/crm/*` access change, no
  // company module activation, and no Service→Module bridge. The single `affects`
  // module reference below reuses the existing Phase 0 diagnostic/display seam
  // (validated by `findInvalidModuleReferences`) and has NO effect on access,
  // entitlement resolution, navigation, or module availability. Bridging this
  // entitlement to Company Admin module availability is a later, separate wave.
  //
  // Admin Requests and Employee & Customer Requests are SEPARATE products/modules
  // (they will differ significantly). This service therefore affects ONLY the
  // `admin-requests` module and must NOT affect `employee-customer-requests`.
  // The Employee & Customer Requests service is deferred to a future wave:
  //   future serviceKey:       "employee_customer_requests"
  //   future affected module:  "employee-customer-requests"
  // It is intentionally NOT registered here.
  {
    serviceKey: "admin_requests",
    name: "Admin Requests",
    description:
      "Internal/admin request and case management for Company Admin. Granted through Super Admin Services first, then activated as the admin-requests module in Company Admin Settings → Modules in a later wave. Separate from the deferred Employee & Customer Requests service.",
    category: "Request / CRM",
    icon: "Inbox",
    billingEligible: true,
    billingLabel: "Admin Requests",
    // Mirrors the closest billable add-on precedent (`notification_center`): the
    // platform offers it, but a company must be granted access explicitly before
    // the admin-requests module is made available to it.
    defaultGlobalEnabled: true,
    defaultCompanyEnabled: false,
    supportsTrial: true,
    // Diagnostic/display-only reference to the single existing admin request
    // module. NOT a runtime entitlement→module-availability bridge (later wave).
    // Deliberately does NOT reference `employee-customer-requests`.
    affects: [
      {
        kind: "module",
        moduleId: "admin-requests",
        note: "Company Admin operational admin request handling",
      },
    ],
  },
];

/** Looks up a service definition by key, or undefined when unknown. */
export function getServiceDefinition(
  serviceKey: ServiceFeatureKey,
): ServiceFeatureDefinition | undefined {
  return SERVICE_FEATURE_REGISTRY.find((s) => s.serviceKey === serviceKey);
}

/**
 * Resolves platform-wide availability for a service. Preferred Time Evaluation
 * bridges to the legacy {@link SystemSettings.allowPreferredTimeEvaluation}
 * master gate so the existing control stays authoritative; other features read
 * their {@link ServiceGlobalEntitlement} record, falling back to the registry
 * default when none exists.
 */
export function resolveGlobalAvailability(
  serviceKey: ServiceFeatureKey,
  opts: {
    systemSettings: SystemSettings;
    globalEntitlements: ServiceGlobalEntitlement[];
  },
): boolean {
  if (serviceKey === PREFERRED_TIME_EVALUATION_KEY) {
    return opts.systemSettings.allowPreferredTimeEvaluation === true;
  }
  const record = opts.globalEntitlements.find((g) => g.serviceKey === serviceKey);
  if (record) return record.enabled === true;
  return getServiceDefinition(serviceKey)?.defaultGlobalEnabled === true;
}

/**
 * Normalises a stored entitlement record to its tri-state status. Records
 * persisted before the trial model omit `status`; they are derived from the
 * legacy `enabled` flag (`enabled ? "enabled" : "disabled"`).
 */
export function statusFromRecord(
  record: CompanyServiceEntitlement,
): ServiceEntitlementStatus {
  if (record.status) return record.status;
  return record.enabled ? "enabled" : "disabled";
}

/**
 * Resolves a company's tri-state entitlement status for a service. Uses the
 * explicit per-company record when present, otherwise the registry default
 * (`enabled` when {@link ServiceFeatureDefinition.defaultCompanyEnabled} is
 * true, else `disabled`). This does NOT consider global availability — callers
 * combine that separately (see {@link resolveEffectiveCompanyStatus}).
 */
export function resolveCompanyEntitlementStatus(
  serviceKey: ServiceFeatureKey,
  companyId: string,
  entitlements: CompanyServiceEntitlement[],
): ServiceEntitlementStatus {
  const record = entitlements.find(
    (e) => e.companyId === companyId && e.serviceKey === serviceKey,
  );
  if (record) return statusFromRecord(record);
  return getServiceDefinition(serviceKey)?.defaultCompanyEnabled ? "enabled" : "disabled";
}

/**
 * Resolves a company's *effective* status, collapsing to `disabled` whenever
 * the service is not globally available (the global gate always wins).
 */
export function resolveEffectiveCompanyStatus(
  serviceKey: ServiceFeatureKey,
  companyId: string,
  opts: {
    systemSettings: SystemSettings;
    globalEntitlements: ServiceGlobalEntitlement[];
    companyEntitlements: CompanyServiceEntitlement[];
  },
): ServiceEntitlementStatus {
  if (!resolveGlobalAvailability(serviceKey, opts)) return "disabled";
  return resolveCompanyEntitlementStatus(serviceKey, companyId, opts.companyEntitlements);
}

/**
 * Resolves whether a company is entitled to a service (has access). Both
 * `trial` and `enabled` count as entitled; only `disabled` does not.
 */
export function resolveCompanyEntitlement(
  serviceKey: ServiceFeatureKey,
  companyId: string,
  entitlements: CompanyServiceEntitlement[],
): boolean {
  return resolveCompanyEntitlementStatus(serviceKey, companyId, entitlements) !== "disabled";
}

/** The outcome of evaluating whether a usage-gated action may proceed. */
export interface UsageGateResult {
  allowed: boolean;
  status: ServiceEntitlementStatus;
  /** The trial allowance, when the service is on a counted trial. */
  limit: number | null;
  /** Current usage counted against the trial. */
  used: number;
  /** Remaining usages during a trial, or null when not trial-limited. */
  remaining: number | null;
  /** A user-facing reason when {@link allowed} is false. */
  reason?: string;
}

/**
 * Evaluates whether a usage-gated action (e.g. a media upload) may proceed for
 * a company, given its effective status and current usage count. This is the
 * generic, registry-driven enforcement core reused by every counted service:
 *  - `disabled` → blocked.
 *  - `trial`    → allowed until the registry's `trialLimit` is reached.
 *  - `enabled`  → always allowed, no limit.
 */
export function evaluateUsageGate(
  serviceKey: ServiceFeatureKey,
  status: ServiceEntitlementStatus,
  currentUsage: number,
): UsageGateResult {
  const def = getServiceDefinition(serviceKey);
  const limit =
    def?.trialLimitType === "count" && typeof def.trialLimit === "number"
      ? def.trialLimit
      : null;

  if (status === "disabled") {
    return {
      allowed: false,
      status,
      limit,
      used: currentUsage,
      remaining: limit !== null ? Math.max(0, limit - currentUsage) : null,
      reason: def
        ? `${def.name} is not enabled for this company.`
        : "This service is not enabled for this company.",
    };
  }
  if (status === "enabled") {
    return { allowed: true, status, limit: null, used: currentUsage, remaining: null };
  }
  // Trial.
  if (limit === null) {
    // Trial without a counted limit behaves like full access.
    return { allowed: true, status, limit: null, used: currentUsage, remaining: null };
  }
  const remaining = Math.max(0, limit - currentUsage);
  return {
    allowed: currentUsage < limit,
    status,
    limit,
    used: currentUsage,
    remaining,
    reason:
      currentUsage < limit
        ? undefined
        : "Trial limit reached. Contact your administrator to enable Media Uploads.",
  };
}

/**
 * Whether a service is *usable* for a company: globally available AND the
 * company is entitled. This does NOT consider the company's own internal
 * feature setting — callers combine that separately where relevant (e.g.
 * `isPreferredTimeEvaluationAvailable`).
 */
export function isServiceUsableForCompany(
  serviceKey: ServiceFeatureKey,
  companyId: string,
  opts: {
    systemSettings: SystemSettings;
    globalEntitlements: ServiceGlobalEntitlement[];
    companyEntitlements: CompanyServiceEntitlement[];
  },
): boolean {
  return (
    resolveGlobalAvailability(serviceKey, opts) &&
    resolveCompanyEntitlement(serviceKey, companyId, opts.companyEntitlements)
  );
}

// ── Phase 0 diagnostics (additive, display/validation only) ──────────────────
// These helpers describe and validate the optional `affects` metadata. They are
// pure and have NO effect on runtime access, entitlement, or navigation.

/** A single diagnostic finding about feature → affected-area metadata. */
export interface FeatureAffectsIssue {
  serviceKey: ServiceFeatureKey;
  /** The kind of problem detected. */
  kind:
    | "invalid-module-reference"
    | "duplicate-surface"
    | "no-affected-areas";
  /** A human-readable explanation of the issue. */
  message: string;
  /** The offending surface, when the issue is surface-specific. */
  surface?: FeatureSurface;
}

/** A stable string key for a surface, used to detect duplicates. */
function surfaceIdentity(surface: FeatureSurface): string {
  switch (surface.kind) {
    case "module":
      return `module:${surface.moduleId}`;
    case "route":
      return `route:${surface.path}`;
    case "area":
      return `area:${surface.area.trim().toLowerCase()}`;
  }
}

/**
 * Finds `module`-kind surfaces that reference a module id which does not exist
 * in {@link MODULE_DEFINITIONS}. Diagnostic only.
 */
export function findInvalidModuleReferences(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureAffectsIssue[] {
  const issues: FeatureAffectsIssue[] = [];
  for (const def of registry) {
    for (const surface of def.affects ?? []) {
      if (surface.kind === "module" && !getModuleDefinition(surface.moduleId)) {
        issues.push({
          serviceKey: def.serviceKey,
          kind: "invalid-module-reference",
          message: `“${def.name}” references unknown module “${surface.moduleId}”.`,
          surface,
        });
      }
    }
  }
  return issues;
}

/**
 * Finds features that list the same affected surface more than once. Area
 * matching is case-insensitive and whitespace-insensitive. Diagnostic only.
 */
export function findDuplicateSurfaces(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureAffectsIssue[] {
  const issues: FeatureAffectsIssue[] = [];
  for (const def of registry) {
    const seen = new Set<string>();
    for (const surface of def.affects ?? []) {
      const id = surfaceIdentity(surface);
      if (seen.has(id)) {
        issues.push({
          serviceKey: def.serviceKey,
          kind: "duplicate-surface",
          message: `“${def.name}” lists the same affected area more than once: ${describeFeatureSurface(surface)}.`,
          surface,
        });
      }
      seen.add(id);
    }
  }
  return issues;
}

/**
 * Finds features that declare no affected areas (missing or empty `affects`).
 * Diagnostic only — an empty list is allowed, this just surfaces it.
 */
export function findFeaturesWithoutAffectedAreas(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureAffectsIssue[] {
  return registry
    .filter((def) => (def.affects?.length ?? 0) === 0)
    .map((def) => ({
      serviceKey: def.serviceKey,
      kind: "no-affected-areas" as const,
      message: `“${def.name}” has no affected areas declared.`,
    }));
}

/** Runs all Phase 0 affected-area diagnostics and returns a flat list. */
export function validateFeatureAffects(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureAffectsIssue[] {
  return [
    ...findInvalidModuleReferences(registry),
    ...findDuplicateSurfaces(registry),
    ...findFeaturesWithoutAffectedAreas(registry),
  ];
}

// ── Phase 0 diagnostics: limit declarations (additive, validation only) ──────────
// These helpers validate the optional `limits` metadata. They are pure and
// have NO effect on runtime access, entitlement resolution, or merging.

/** A single diagnostic finding about a feature's limit declarations. */
export interface FeatureLimitIssue {
  serviceKey: ServiceFeatureKey;
  /** The kind of problem detected. */
  kind:
    | "duplicate-limit-key"
    | "enum-priority-missing"
    | "enum-priority-unexpected"
    | "enum-default-not-in-priority";
  /** A human-readable explanation of the issue. */
  message: string;
  /** The offending limit key, when the issue is limit-specific. */
  limitKey?: LimitKey;
}

/**
 * Finds limit keys declared more than once across the whole registry. A
 * {@link LimitKey} must be globally unique so bundle grants and overrides
 * address exactly one declaration. Diagnostic only.
 */
export function findDuplicateLimitKeys(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureLimitIssue[] {
  const issues: FeatureLimitIssue[] = [];
  const seen = new Map<LimitKey, ServiceFeatureKey>();
  for (const def of registry) {
    for (const limit of def.limits ?? []) {
      const owner = seen.get(limit.limitKey);
      if (owner !== undefined) {
        issues.push({
          serviceKey: def.serviceKey,
          kind: "duplicate-limit-key",
          message: `Limit “${limit.limitKey}” is declared by both “${owner}” and “${def.serviceKey}”; limit keys must be globally unique.`,
          limitKey: limit.limitKey,
        });
      } else {
        seen.set(limit.limitKey, def.serviceKey);
      }
    }
  }
  return issues;
}

/**
 * Validates that {@link FeatureLimitDefinition.enumPriority} is present iff the
 * limit's {@link MergeKind} is `enum-priority`, and that an enum default value
 * (when present) appears in the declared priority order. Diagnostic only.
 */
export function findInvalidEnumPriorities(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureLimitIssue[] {
  const issues: FeatureLimitIssue[] = [];
  for (const def of registry) {
    for (const limit of def.limits ?? []) {
      const hasPriority = (limit.enumPriority?.length ?? 0) > 0;
      if (limit.mergeKind === "enum-priority") {
        if (!hasPriority) {
          issues.push({
            serviceKey: def.serviceKey,
            kind: "enum-priority-missing",
            message: `Limit “${limit.limitKey}” uses merge kind “enum-priority” but declares no priority order.`,
            limitKey: limit.limitKey,
          });
          continue;
        }
        if (
          typeof limit.defaultValue === "string" &&
          !limit.enumPriority?.includes(limit.defaultValue)
        ) {
          issues.push({
            serviceKey: def.serviceKey,
            kind: "enum-default-not-in-priority",
            message: `Limit “${limit.limitKey}” default “${limit.defaultValue}” is not part of its declared priority order.`,
            limitKey: limit.limitKey,
          });
        }
      } else if (hasPriority) {
        issues.push({
          serviceKey: def.serviceKey,
          kind: "enum-priority-unexpected",
          message: `Limit “${limit.limitKey}” declares a priority order but its merge kind is “${limit.mergeKind}”, not “enum-priority”.`,
          limitKey: limit.limitKey,
        });
      }
    }
  }
  return issues;
}

/** Runs all Phase 0 limit-declaration diagnostics and returns a flat list. */
export function validateFeatureLimits(
  registry: ServiceFeatureDefinition[] = SERVICE_FEATURE_REGISTRY,
): FeatureLimitIssue[] {
  return [
    ...findDuplicateLimitKeys(registry),
    ...findInvalidEnumPriorities(registry),
  ];
}
