import type { Tone } from "@/components/calculator/configBadges";
import type { CalculatorServiceConfig } from "@/lib/calculator/calculatorConfigAdmin";
import { LEGACY_PRICING_MODELS } from "@/lib/calculator/v2/pricingModel";

/**
 * Admin Services-list presentation helpers (Slice GPM-2a).
 *
 * Pure + presentation-only. These helpers decide WHERE a calculator service
 * renders in the admin Services list and WHICH status badges it shows. They NEVER
 * change pricing, public visibility, or DB state — GPM-2a is an admin-list filter
 * only. No new schema fields are introduced: every signal is derived from existing
 * fields (`serviceKey`, `pricingModel`, `enabled`, `comingSoon`).
 */

/** The service_key of the active V2 pilot (Home Cleaning). */
export const HOME_PILOT_SERVICE_KEY = "home_cleaning";

/**
 * Which admin-list group a service belongs to.
 *  • `pilot`  — the V2 pilot (Home Cleaning) plus any forward-looking,
 *               admin-created generic-model service. Shown by default.
 *  • `legacy` — the seeded, service-named legacy services (move-out / office /
 *               window / deep / stairwell / procurement). Collapsed behind a
 *               "show legacy/default services" toggle.
 */
export type CalculatorServiceGroup = "pilot" | "legacy";

const LEGACY_PRICING_MODEL_SET: ReadonlySet<string> = new Set(LEGACY_PRICING_MODELS);

type ServiceGroupInput = Pick<CalculatorServiceConfig, "serviceKey" | "pricingModel">;

/**
 * Classifies a calculator service into the admin-list group it renders in.
 *
 * Home Cleaning is always the pilot. Every other service that still carries a
 * legacy, service-named pricing model is a seeded/default legacy service. Anything
 * else — a future service the admin builds on a generic pricing model — belongs in
 * the default (builder) group alongside the pilot, so the list stops feeling like a
 * permanent hardcoded catalogue of old seeded rows.
 */
export function classifyServiceGroup(service: ServiceGroupInput): CalculatorServiceGroup {
  if (service.serviceKey === HOME_PILOT_SERVICE_KEY) return "pilot";
  if (LEGACY_PRICING_MODEL_SET.has(service.pricingModel)) return "legacy";
  return "pilot";
}

/** True when the service is the active V2 pilot (Home Cleaning). */
export function isPilotService(service: ServiceGroupInput): boolean {
  return classifyServiceGroup(service) === "pilot";
}

/** True when the service is a seeded/default legacy service. */
export function isLegacyService(service: ServiceGroupInput): boolean {
  return classifyServiceGroup(service) === "legacy";
}

// ── Default workspace visibility (GPM-ADMIN-FILTER-1) ───────────────────────
//
// The Admin Calculator "default workspace" is the set of services an operator
// should see while running the live product — today that is Home Cleaning only.
// Everything else (disabled services + seeded legacy-model services) is
// legacy/hidden and collapses behind a "show legacy / default services" toggle.
// Soft-deleted rows never reach this layer: the admin loaders already filter
// `deleted_at is null`, so these helpers only reason about live rows.

/**
 * The signals needed to decide a service's WORKSPACE visibility: its group
 * signals (serviceKey + pricingModel) plus whether it is currently enabled.
 * Satisfied by both the overview `CalculatorServiceView` rows and the full
 * {@link CalculatorServiceConfig}.
 */
export type WorkspaceServiceInput = ServiceGroupInput & { enabled: boolean };

/**
 * True when a service belongs to the DEFAULT admin workspace — i.e. it is the
 * active (enabled) pilot/builder service. Disabled services and seeded
 * legacy-model services are excluded (they are legacy/hidden). With the current
 * data this resolves to Home Cleaning only.
 */
export function isDefaultWorkspaceService(service: WorkspaceServiceInput): boolean {
  return service.enabled === true && isPilotService(service);
}

/** True when a service is hidden from the default workspace (disabled OR legacy-model). */
export function isLegacyWorkspaceService(service: WorkspaceServiceInput): boolean {
  return !isDefaultWorkspaceService(service);
}

/** Splits services into the default-workspace set and the legacy/hidden set, preserving order. */
export function partitionWorkspaceServices<T extends WorkspaceServiceInput>(
  services: readonly T[],
): { defaultServices: T[]; legacyServices: T[] } {
  const defaultServices: T[] = [];
  const legacyServices: T[] = [];
  for (const service of services) {
    if (isDefaultWorkspaceService(service)) defaultServices.push(service);
    else legacyServices.push(service);
  }
  return { defaultServices, legacyServices };
}

/** Structural config counts for one set of services (workspace- or legacy-scoped). */
export interface WorkspaceConfigCounts {
  services: number;
  enabledServices: number;
  cleaningPlans: number;
  questions: number;
  pricingRules: number;
}

/** Default-vs-legacy structural counts derived from the full calculator config. */
export interface WorkspaceConfigCountsSummary {
  defaultCounts: WorkspaceConfigCounts;
  legacyCounts: WorkspaceConfigCounts;
}

/** Minimal service shape {@link summarizeWorkspaceConfigCounts} reads. */
type WorkspaceSummaryService = WorkspaceServiceInput & {
  id: string;
  questions: readonly unknown[];
};
/** Minimal cleaning-plan shape (only its owning service key matters here). */
type WorkspaceSummaryPlan = { serviceKey?: string | null };
/** Minimal pricing-rule shape (only its owning service id matters here). */
type WorkspaceSummaryRule = { serviceId: string };

export interface WorkspaceSummaryInput {
  services: readonly WorkspaceSummaryService[];
  cleaningPlans: readonly WorkspaceSummaryPlan[];
  pricingRules: readonly WorkspaceSummaryRule[];
}

function countServiceGroup(
  services: readonly WorkspaceSummaryService[],
  cleaningPlans: readonly WorkspaceSummaryPlan[],
  pricingRules: readonly WorkspaceSummaryRule[],
): WorkspaceConfigCounts {
  const serviceKeys = new Set(services.map((s) => s.serviceKey));
  const serviceIds = new Set(services.map((s) => s.id));
  // A plan with no explicit service key historically belongs to Home Cleaning.
  const planKey = (plan: WorkspaceSummaryPlan): string => plan.serviceKey ?? "home_cleaning";
  return {
    services: services.length,
    enabledServices: services.filter((s) => s.enabled).length,
    cleaningPlans: cleaningPlans.filter((p) => serviceKeys.has(planKey(p))).length,
    questions: services.reduce((total, s) => total + s.questions.length, 0),
    pricingRules: pricingRules.filter((r) => serviceIds.has(r.serviceId)).length,
  };
}

/**
 * Derives default-vs-legacy structural counts (services, plans, questions,
 * pricing rules) from the full calculator config. Pure + deterministic, so the
 * Admin Overview can show counts scoped to the active workspace while reporting
 * the legacy/hidden totals separately. Pipeline counts (prospects / quote
 * requests) are company-wide and intentionally NOT computed here.
 */
export function summarizeWorkspaceConfigCounts(input: WorkspaceSummaryInput): WorkspaceConfigCountsSummary {
  const { defaultServices, legacyServices } = partitionWorkspaceServices(input.services);
  return {
    defaultCounts: countServiceGroup(defaultServices, input.cleaningPlans, input.pricingRules),
    legacyCounts: countServiceGroup(legacyServices, input.cleaningPlans, input.pricingRules),
  };
}

export interface ServiceStatusBadge {
  key: string;
  label: string;
  tone: Tone;
}

type ServiceBadgeInput = Pick<
  CalculatorServiceConfig,
  "serviceKey" | "pricingModel" | "enabled" | "comingSoon"
>;

/**
 * Derives the presentation badges for a service row from EXISTING fields only.
 *
 * Two badge families, never any DB/schema field:
 *  • group  — `V2 Pilot` for Home, `Legacy` for seeded legacy rows.
 *  • state  — `Live` when enabled (so admins are never blind to a public service),
 *             otherwise `Coming soon` or `Hidden`.
 */
export function serviceStatusBadges(service: ServiceBadgeInput): ServiceStatusBadge[] {
  const badges: ServiceStatusBadge[] = [];

  if (service.serviceKey === HOME_PILOT_SERVICE_KEY) {
    badges.push({ key: "pilot", label: "V2 Pilot", tone: "blue" });
  } else if (isLegacyService(service)) {
    badges.push({ key: "legacy", label: "Legacy", tone: "muted" });
  }

  if (service.enabled) {
    badges.push({ key: "public", label: "Live", tone: "green" });
  } else if (service.comingSoon) {
    badges.push({ key: "coming-soon", label: "Coming soon", tone: "amber" });
  } else {
    badges.push({ key: "hidden", label: "Hidden", tone: "muted" });
  }

  return badges;
}
