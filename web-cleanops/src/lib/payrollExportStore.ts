import type {
  PayrollExportCapability,
  PayrollExportProfile,
  PayrollExportRun,
  PayrollExportTargetKey,
} from "@/types";

/**
 * Payroll Export — persistence layer (architecture foundation).
 *
 * Like {@link timeCodeStore.ts}, this is a backend-shaped abstraction over
 * localStorage so it can be swapped for the Supabase tables in migration
 * `0012_payroll_export.sql` without touching callers. The store owns persistence
 * and normalization only; authorization, entitlement gating and audit logging
 * live in the AppContext (consistent with Time Codes / Services).
 *
 * Three independent collections are persisted:
 *  - capabilities — per-(company,target) Super-Admin activation records,
 *  - profiles     — company-specific export setups,
 *  - runs         — the immutable history of export attempts.
 */

const CAPABILITIES_KEY = "cleanops.payroll.exportCapabilities";
const PROFILES_KEY = "cleanops.payroll.exportProfiles";
const RUNS_KEY = "cleanops.payroll.exportRuns";

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to persist ${key}`, err);
  }
}

// ── Capabilities ─────────────────────────────────────────────────────────────

export function getPayrollExportCapabilities(): PayrollExportCapability[] {
  return read<PayrollExportCapability>(CAPABILITIES_KEY);
}

export function savePayrollExportCapabilities(capabilities: PayrollExportCapability[]): void {
  write(CAPABILITIES_KEY, capabilities);
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export function getPayrollExportProfiles(): PayrollExportProfile[] {
  return read<PayrollExportProfile>(PROFILES_KEY);
}

export function savePayrollExportProfiles(profiles: PayrollExportProfile[]): void {
  write(PROFILES_KEY, profiles);
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export function getPayrollExportRuns(): PayrollExportRun[] {
  return read<PayrollExportRun>(RUNS_KEY);
}

export function savePayrollExportRuns(runs: PayrollExportRun[]): void {
  write(RUNS_KEY, runs);
}

/** Stable key for a (company, target) capability pair. */
export function capabilityKey(companyId: string, target: PayrollExportTargetKey): string {
  return `${companyId}::${target}`;
}
