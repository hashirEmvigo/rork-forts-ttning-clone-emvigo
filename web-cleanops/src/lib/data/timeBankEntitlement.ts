/**
 * Time Bank — entitlement integration (Phase 10).
 *
 * Connects Time Bank access to the REAL bundle-first entitlement architecture
 * (`@/lib/entitlements`). This is the single place that translates a resolved
 * company entitlement picture into a Time Bank access decision, plus a factory
 * that produces the async gate the orchestration layer consumes.
 *
 * Design contracts:
 *   1. Time Bank access is decided ENTIRELY by the entitlement system. The
 *      registry declares `time_bank` as a premium add-on
 *      (`defaultGlobalEnabled: true`, `defaultCompanyEnabled: false`), so a
 *      company is only entitled when a bundle grant or a company override
 *      enables it. There is no hidden activation path.
 *   2. The decision is STRUCTURED — it carries the resolved status, the
 *      resolution source (default / bundle / override), the contributing
 *      bundle ids, and a human-readable denial reason — so orchestration
 *      reports are useful for support and debugging.
 *   3. This module performs read-only I/O ONLY through the existing
 *      {@link loadEntitlementContext} loader; the loader and resolver are
 *      injectable so the gate can be exercised in a pure harness with no
 *      Supabase, network, env, or session.
 *
 * FOUNDATION ONLY — no UI, no billing, no activation. The gate decides access;
 * it never writes entitlement data and never provisions a wallet itself.
 */
import { TIME_BANK_KEY } from "@/lib/serviceRegistry";
import {
  loadEntitlementContext,
  type EntitlementLoadResult,
  type LoadEntitlementContextInput,
} from "@/lib/entitlements/loadEntitlementContext";
import { resolveCompanyEntitlements } from "@/lib/entitlements/resolver";
import type {
  ResolutionSource,
  ResolvedCompanyEntitlements,
} from "@/lib/entitlements/types";
import type {
  ServiceEntitlementStatus,
  ServiceGlobalEntitlement,
} from "@/types";

/** Where a Time Bank decision's status came from (mirrors the resolver). */
export type TimeBankEntitlementSource = ResolutionSource | "none";

/**
 * A structured Time Bank entitlement decision for one company. `allowed` is the
 * single source of truth the orchestrator gates on; the remaining fields are
 * for reporting/diagnostics and never change the gate outcome.
 */
export interface TimeBankEntitlementDecision {
  /** Whether the company may use Time Bank (status is `trial` or `enabled`). */
  allowed: boolean;
  /** The effective, globally-gated entitlement status. */
  status: ServiceEntitlementStatus;
  /** Where the effective status came from (`none` when no context resolved). */
  source: TimeBankEntitlementSource;
  /** Ids of the assigned bundles that contributed an enabling/trial grant. */
  contributingBundleIds: string[];
  /** Whether the platform offers Time Bank at all (global gate). */
  globallyAvailable: boolean;
  /** A human-readable reason when {@link allowed} is false; null otherwise. */
  denialReason: string | null;
}

/** Builds the canonical "denied — no context" decision. */
function deniedNoContext(reason: string): TimeBankEntitlementDecision {
  return {
    allowed: false,
    status: "disabled",
    source: "none",
    contributingBundleIds: [],
    globallyAvailable: false,
    denialReason: reason,
  };
}

/**
 * Reduces a fully-resolved company entitlement picture to a Time Bank decision.
 * Pure — reads nothing but its argument, so it is trivially testable and can be
 * reused by any caller that already holds a {@link ResolvedCompanyEntitlements}.
 */
export function decideTimeBankEntitlement(
  resolved: ResolvedCompanyEntitlements,
): TimeBankEntitlementDecision {
  const entitlement = resolved.byService[TIME_BANK_KEY];
  if (!entitlement) {
    // The registry guarantees a `time_bank` entry, so this only happens if the
    // resolver was handed a registry without it — treat as denied, never crash.
    return deniedNoContext(
      "Time Bank is not present in the resolved entitlement registry.",
    );
  }

  const allowed = entitlement.entitled;
  const denialReason = allowed
    ? null
    : !entitlement.globallyAvailable
      ? "Time Bank is not available on this platform."
      : "This company is not entitled to Time Bank. Assign a bundle or override that grants it.";

  return {
    allowed,
    status: entitlement.status,
    source: entitlement.statusSource,
    contributingBundleIds: entitlement.contributingBundleIds,
    globallyAvailable: entitlement.globallyAvailable,
    denialReason,
  };
}

/** The loader signature, narrowed for injection in tests. */
export type EntitlementContextLoader = (
  input: LoadEntitlementContextInput,
) => Promise<EntitlementLoadResult>;

/** Options for {@link createTimeBankEntitlementGate}. */
export interface CreateTimeBankEntitlementGateOptions {
  /**
   * Platform-wide availability records. The loader threads these into the
   * resolution context unchanged. Defaults to `[]`, in which case the registry
   * default (`time_bank` globally available) applies.
   */
  globalEntitlements?: ServiceGlobalEntitlement[];
  /** Instant used for validity-window filtering. Defaults to the load time. */
  now?: Date;
  /**
   * The entitlement context loader. Injectable so a harness can drive the gate
   * with an in-memory context and NO Supabase/network. Defaults to the real
   * {@link loadEntitlementContext}.
   */
  loadContext?: EntitlementContextLoader;
}

/**
 * Resolves the full structured Time Bank decision for a company through the
 * real entitlement pipeline (load context → resolve → decide). On any load
 * failure it returns a denied decision carrying the load reason — Time Bank is
 * never silently granted when entitlements cannot be confirmed.
 */
export async function resolveTimeBankEntitlement(
  companyId: string,
  options: CreateTimeBankEntitlementGateOptions = {},
): Promise<TimeBankEntitlementDecision> {
  const load = options.loadContext ?? loadEntitlementContext;
  const result = await load({
    companyId,
    globalEntitlements: options.globalEntitlements ?? [],
    now: options.now,
  });

  if (!result.context) {
    return deniedNoContext(
      `Entitlement context unavailable (reason: ${result.reason}). Time Bank denied.`,
    );
  }

  const resolved = resolveCompanyEntitlements(result.context, companyId);
  return decideTimeBankEntitlement(resolved);
}

/**
 * Builds an async Time Bank entitlement gate backed by the REAL entitlement
 * resolver. The returned gate maps a company id to a structured
 * {@link TimeBankEntitlementDecision} and is the production replacement for the
 * injected boolean gate used during the orchestration foundation phase.
 */
export function createTimeBankEntitlementGate(
  options: CreateTimeBankEntitlementGateOptions = {},
): (companyId: string) => Promise<TimeBankEntitlementDecision> {
  return (companyId: string) => resolveTimeBankEntitlement(companyId, options);
}
