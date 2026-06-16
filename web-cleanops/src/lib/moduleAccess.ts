/**
 * Single source of truth for the Module access model (Phase 2B).
 *
 * Three independent layers decide whether a company may use a module, and they
 * MUST be combined in this exact order:
 *
 *   1. GLOBAL status      — `modules.status` (Super Admin, platform-wide).
 *                           Inactive ⇒ the module does not exist for anyone.
 *   2. COMPANY available   — `company_modules.available` (Super Admin offers the
 *                           module to a specific company).
 *   3. COMPANY enabled     — `company_modules.enabled` (Company Admin switches an
 *                           offered module on/off for their own team).
 *
 * Every surface (the access gate {@link import("@/context/AppContext").useApp}'s
 * `canAccessModule`, the company-facing ModulesPanel, the Super-Admin
 * PlatformModulesPanel) resolves through here so the layers can never diverge:
 * a globally-inactive module is NEVER available or accessible even when a stale
 * `company_modules` row still says `available/enabled = true`, and a module the
 * Super Admin never offered is "Not available" rather than silently usable.
 *
 * Both inputs are read Supabase-authoritatively; this module is pure (no I/O, no
 * localStorage) so it is exhaustively unit-testable.
 */
import type { CompanyModuleSetting, Module } from "@/types";

/**
 * The resolved state of one module for one company, collapsing global status +
 * per-company availability + per-company enablement into a single value.
 */
export type CompanyModuleState =
  /** Off platform-wide (status !== 'active', or the module row is missing). */
  | "globally_inactive"
  /** Globally active but the Super Admin has not offered it to this company. */
  | "not_offered"
  /** Globally active + offered, but the Company Admin has switched it off. */
  | "available_off"
  /** Globally active + offered + switched on — the module is usable. */
  | "enabled";

export interface ModuleAccessInputs {
  /** The GLOBAL module row (Supabase-authoritative); `undefined` if missing. */
  module: Module | undefined;
  /** The company_modules row for (company, module); `undefined` if none. */
  setting: CompanyModuleSetting | undefined;
  /**
   * Optional entitlement-derived availability for modules bridged from a Super
   * Admin service entitlement (the Service → Module bridge, e.g. `admin-requests`
   * ← `admin_requests`; see {@link import("@/lib/serviceModuleBridge")}). When
   * DEFINED it REPLACES the `company_modules.available` flag as Layer 2 (COMPANY
   * available): the service entitlement now decides whether the module is
   * offered. When `undefined` (the default for every un-bridged module) Layer 2
   * falls back to `setting.available` exactly as before, so existing behavior is
   * unchanged.
   *
   * It governs ONLY Layer 2. Layer 1 (global status) still wins, and Layer 3 (the
   * Company Admin local enabled toggle) stays fully separate.
   */
  entitlementAvailability?: boolean | undefined;
}

/**
 * Collapses the three layers into one discriminated state. Global status is
 * checked FIRST and wins: a globally-inactive module can never be `not_offered`,
 * `available_off` or `enabled`, regardless of what the company_modules row says.
 */
export function resolveCompanyModuleState({
  module,
  setting,
  entitlementAvailability,
}: ModuleAccessInputs): CompanyModuleState {
  // Layer 1 — platform-wide existence. Wins over any stale company row.
  if (!module || module.status !== "active") return "globally_inactive";
  // Layer 2 — COMPANY available. For entitlement-bridged modules this is derived
  // from the Super Admin service entitlement (Service → Module bridge); for every
  // other module it falls back to the raw company_modules row, unchanged. A
  // bridged `false` therefore overrides a stale `available` row, exactly as a
  // globally-inactive status overrides a stale row in Layer 1.
  const available = entitlementAvailability ?? setting?.available ?? false;
  if (!available) return "not_offered";
  // Layer 3 — Company Admin enablement of an offered, globally-active module.
  // Separate from availability: a freshly-offered module with no local row yet
  // (or a switched-off one) is `available_off` until the company turns it on.
  if (!setting?.enabled) return "available_off";
  return "enabled";
}

/**
 * Whether the company may TOGGLE the module on/off — i.e. it is globally active
 * AND offered to the company. Drives the company-facing switch vs. the
 * "Not available" lock. A globally-inactive or never-offered module is not
 * toggleable.
 */
export function isCompanyModuleOffered(state: CompanyModuleState): boolean {
  return state === "available_off" || state === "enabled";
}

/**
 * Whether the module is actually USABLE by the company right now (all three
 * layers satisfied). This is the access-gate predicate — never grant access on
 * `available`/`enabled` alone without the global-status layer.
 */
export function isCompanyModuleUsable(state: CompanyModuleState): boolean {
  return state === "enabled";
}

/**
 * Convenience resolver mirroring {@link isCompanyModuleUsable} directly from the
 * raw rows, for call-sites that don't need the intermediate state.
 */
export function isCompanyModuleAccessible(inputs: ModuleAccessInputs): boolean {
  return isCompanyModuleUsable(resolveCompanyModuleState(inputs));
}
