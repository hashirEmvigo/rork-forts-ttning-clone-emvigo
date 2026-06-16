/**
 * Usage & Performance Metering — BLUEPRINT ONLY.
 *
 * ⚠️ This file is a design artifact. It declares the *shape* of a future
 * metering system so the architecture is agreed and type-checked, but it
 * contains NO collection logic, NO storage, NO billing, and NO UI. Nothing here
 * runs. It exists to anchor the conversation and give P4+ a concrete target.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GOAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Every cost-driving action in CleanOps must eventually be attributable to a
 * `companyId`, so infrastructure cost can be understood, forecast, and (later)
 * billed per tenant. This is the seam that makes "unlimited companies" viable:
 * cost follows the company that incurred it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE METRIC FAMILIES (keep them separate)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. PERFORMANCE METRICS — engineering health. Render counts, cache hit rates,
 *    resolver durations, query counts. Source: the dev instrumentation layer
 *    (`perf`) today; lightweight server timings post-migration. NOT per-customer
 *    billable. Lives close to the code, short retention.
 *
 * 2. USAGE METRICS — what a company consumed. Storage bytes, media count/bytes,
 *    AI tokens/calls, API calls, schedule generations, exports, notifications,
 *    realtime connection-minutes. Always tagged with `companyId`. Aggregated
 *    over time windows. This is the bridge between raw events and billing.
 *
 * 3. BILLING METRICS — money. Derived from usage via a pricing model
 *    (included quotas, overage rates, plan entitlements). Never measured
 *    directly; always computed from USAGE so it is auditable and reproducible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE MEASUREMENTS SHOULD BE COLLECTED (future)
 * ─────────────────────────────────────────────────────────────────────────────
 * - Server boundary (post-Supabase): the single best choke point. Wrap data
 *   access / edge functions so every read/write/AI/storage call emits a usage
 *   event with `companyId`. Client-reported usage is advisory only — never trust
 *   the client for billing.
 * - Storage/media: hook the upload + delete paths (after base64→object-storage
 *   migration) to record bytes per company.
 * - AI/automation: wrap the model-proxy call site to record tokens/calls.
 * - Realtime: record connection open/close to derive connection-minutes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OUT OF SCOPE (do not build now)
 * ─────────────────────────────────────────────────────────────────────────────
 * - Storage tables / schemas for metrics.
 * - Billing/pricing/invoicing logic.
 * - Customer-facing usage dashboards.
 * - Any client-side counters that pretend to be authoritative.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RECOMMENDED TIMING
 * ─────────────────────────────────────────────────────────────────────────────
 * Implement alongside / just after P4 (operational data migration), once a
 * trustworthy server boundary exists. Building it before the server boundary
 * would mean client-reported, unverifiable, and quickly-stale numbers.
 */

/** The three families a metric can belong to. */
export type MetricFamily = "performance" | "usage" | "billing";

/** Cost-driving action categories that must be attributable to a company. */
export type UsageMetricKind =
  | "storage.bytes"
  | "media.count"
  | "media.bytes"
  | "ai.tokens"
  | "ai.calls"
  | "api.calls"
  | "schedule.generation"
  | "export.count"
  | "notification.count"
  | "realtime.connectionMinutes";

/**
 * A single attributable usage event. Every cost-driving action would emit one
 * of these at the server boundary. (Shape only — nothing emits these yet.)
 */
export interface UsageEvent {
  /** The tenant that incurred the cost. Mandatory — no orphan usage. */
  companyId: string;
  /** What was consumed. */
  kind: UsageMetricKind;
  /** Quantity in the kind's natural unit (bytes, tokens, calls, minutes…). */
  quantity: number;
  /** When it happened (epoch ms). */
  occurredAt: number;
  /** Optional actor for drill-down (employee/user id). Not for billing. */
  actorId?: string;
  /** Optional free-form context (feature, endpoint) for analytics only. */
  context?: Record<string, string | number | boolean>;
}

/** An aggregated usage figure for a company over a window. */
export interface UsageAggregate {
  companyId: string;
  kind: UsageMetricKind;
  windowStart: number;
  windowEnd: number;
  total: number;
}

/**
 * The seam a future implementation (and the eventual Supabase boundary) would
 * satisfy. Intentionally un-implemented: declaring it here lets call sites be
 * planned against a stable interface.
 */
export interface UsageMeter {
  /** Record a single attributable usage event. */
  record(event: UsageEvent): void;
  /** Aggregate usage for a company and kind over a window. */
  aggregate(
    companyId: string,
    kind: UsageMetricKind,
    windowStart: number,
    windowEnd: number,
  ): Promise<UsageAggregate>;
}
