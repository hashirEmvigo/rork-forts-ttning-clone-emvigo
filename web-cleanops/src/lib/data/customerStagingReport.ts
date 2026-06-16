/**
 * Customer staging verification report (operator helper).
 *
 * A single READ-ONLY aggregator the operator runs in the staging dev console
 * after each customer flag wave. It collects, in one pass, every signal the
 * Customers Staging Activation Runbook asks an operator to read by hand, then
 * prints a copy-pasteable report with a clear GREEN / ABORT recommendation.
 *
 * Hard guarantees (this helper is observation-only):
 *   • Reads localStorage + Supabase — never writes either.
 *   • Never mutates a feature flag (flags are build-time `import.meta.env`).
 *   • Never runs the migration, dual-write mirror, soak, or backout export.
 *   • Never touches production logic — it only reads existing telemetry +
 *     re-runs the already-shipped READ-ONLY shadow comparisons.
 *
 * Safe to call repeatedly. Intended for the Super Admin dev console:
 *   `await window.__cleanopsData.runCustomerStagingReport()`
 */
import { getCustomers } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  CUSTOMERS_LIST_SUPABASE_READ,
  CUSTOMERS_DETAIL_SUPABASE_READ,
  CUSTOMERS_DUAL_WRITE,
  CUSTOMERS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";
import { supabaseCustomerRepository } from "./supabaseCustomerRepository";
import { shadowReadCustomers, shadowReadCustomerDetail } from "./customerMigration";
import { getCustomerDualWriteState } from "./customerDualWrite";
import { getCustomerCutoverState } from "./customerCutover";
import { getCustomerBackoutMeta } from "./customerBackout";

/** The four customer migration flags, as resolved in this build. */
export interface CustomerStagingFlagStates {
  CUSTOMERS_LIST_SUPABASE_READ: boolean;
  CUSTOMERS_DETAIL_SUPABASE_READ: boolean;
  CUSTOMERS_DUAL_WRITE: boolean;
  CUSTOMERS_SUPABASE_AUTHORITATIVE: boolean;
  /** Human label for which runbook wave these flags correspond to. */
  wave: string;
}

/** Per-company localStorage-vs-Supabase row-count comparison. */
export interface CustomerStagingCompanyCount {
  companyId: string;
  localCount: number;
  supabaseCount: number;
  match: boolean;
}

/** Structured outcome of a staging report run. */
export interface CustomerStagingReport {
  at: string;
  supabaseConfigured: boolean;
  flags: CustomerStagingFlagStates;

  // ── Row counts ──────────────────────────────
  perCompany: CustomerStagingCompanyCount[];
  totalLocal: number;
  totalSupabase: number;
  rowCountParity: boolean;
  /** Companies whose local/Supabase counts diverge. */
  countMismatchCompanies: string[];

  // ── Shadow reads ────────────────────────────
  listShadowOk: boolean;
  listShadowNotes: string[];
  detailShadowOk: boolean;
  detailShadowSampleId: string | null;
  detailShadowNotes: string[];
  /** Customers (present in both sources) whose `userIds` set diverges. */
  userIdsDriftCount: number;
  userIdsDriftSample: string[];
  /** Detail rows compared for the userIds drift sweep. */
  userIdsChecked: boolean;

  // ── Cut-over telemetry ──────────────────────
  readFallbacks: number;
  writeFailures: number;

  // ── Dual-write telemetry ────────────────────
  dualWriteFailures: number;
  dualWriteSkipped: number;
  dualWriteMismatches: number;

  // ── Backout ─────────────────────────────────
  backoutChecksum: string | null;
  backoutAt: string | null;
  backoutTotal: number | null;

  // ── Verdict ─────────────────────────────────
  recommendation: "GREEN" | "REVIEW" | "ABORT";
  reasons: string[];
}

/** Bound on how many shared customers the userIds drift sweep inspects. */
const USER_IDS_DRIFT_LIMIT = 500;

function resolveWaveLabel(flags: {
  list: boolean;
  detail: boolean;
  dual: boolean;
  authoritative: boolean;
}): string {
  if (flags.authoritative) return "Wave 8 — Supabase authoritative";
  if (flags.dual) return "Wave 5/6 — dual-write enabled";
  if (flags.detail) return "Wave 4 — detail read enabled";
  if (flags.list) return "Wave 3 — list read enabled";
  return "Wave 1/2 — pre-flight (all customer flags OFF)";
}

function groupCountByCompany(companyIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of companyIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/**
 * Runs the full staging verification sweep and returns the structured report.
 * Read-only on every data source. Prefer {@link runCustomerStagingReport} for a
 * copy-pasteable text block; this returns the raw object for programmatic use.
 */
export async function collectCustomerStagingReport(): Promise<CustomerStagingReport> {
  const flags: CustomerStagingFlagStates = {
    CUSTOMERS_LIST_SUPABASE_READ,
    CUSTOMERS_DETAIL_SUPABASE_READ,
    CUSTOMERS_DUAL_WRITE,
    CUSTOMERS_SUPABASE_AUTHORITATIVE,
    wave: resolveWaveLabel({
      list: CUSTOMERS_LIST_SUPABASE_READ,
      detail: CUSTOMERS_DETAIL_SUPABASE_READ,
      dual: CUSTOMERS_DUAL_WRITE,
      authoritative: CUSTOMERS_SUPABASE_AUTHORITATIVE,
    }),
  };

  const dual = getCustomerDualWriteState();
  const cutover = getCustomerCutoverState();
  const backout = getCustomerBackoutMeta();

  const report: CustomerStagingReport = {
    at: new Date().toISOString(),
    supabaseConfigured: isSupabaseConfigured,
    flags,
    perCompany: [],
    totalLocal: 0,
    totalSupabase: 0,
    rowCountParity: false,
    countMismatchCompanies: [],
    listShadowOk: false,
    listShadowNotes: [],
    detailShadowOk: false,
    detailShadowSampleId: null,
    detailShadowNotes: [],
    userIdsDriftCount: 0,
    userIdsDriftSample: [],
    userIdsChecked: false,
    readFallbacks: cutover.readFallbacks,
    writeFailures: cutover.writeFailures,
    dualWriteFailures: dual.failures,
    dualWriteSkipped: dual.skipped,
    dualWriteMismatches: dual.mismatches,
    backoutChecksum: backout?.checksum ?? null,
    backoutAt: backout?.at ?? null,
    backoutTotal: backout?.total ?? null,
    recommendation: "ABORT",
    reasons: [],
  };

  // ── Per-company row counts (one local read + one unscoped Supabase read) ──
  const localCustomers = getCustomers();
  const localByCompany = groupCountByCompany(localCustomers.map((c) => c.companyId));
  report.totalLocal = localCustomers.length;

  if (!isSupabaseConfigured) {
    report.reasons.push("Supabase is not configured in this build — cannot verify staging.");
    report.recommendation = "ABORT";
    return report;
  }

  const supaByCompany = new Map<string, number>();
  try {
    const remote = await supabaseCustomerRepository.listSummaries({});
    for (const item of remote.items) {
      supaByCompany.set(item.companyId, (supaByCompany.get(item.companyId) ?? 0) + 1);
    }
    report.totalSupabase = remote.total;
  } catch (err) {
    report.reasons.push(
      `Supabase customer read failed (RLS / connectivity): ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    );
    report.recommendation = "ABORT";
    return report;
  }

  const companyIds = [...new Set([...localByCompany.keys(), ...supaByCompany.keys()])].sort();
  for (const companyId of companyIds) {
    const localCount = localByCompany.get(companyId) ?? 0;
    const supabaseCount = supaByCompany.get(companyId) ?? 0;
    const match = localCount === supabaseCount;
    report.perCompany.push({ companyId, localCount, supabaseCount, match });
    if (!match) report.countMismatchCompanies.push(companyId);
  }
  report.rowCountParity =
    report.countMismatchCompanies.length === 0 && report.totalLocal === report.totalSupabase;

  // ── List shadow-read (unscoped) ──
  const listShadow = await shadowReadCustomers();
  report.listShadowOk = listShadow.ok;
  report.listShadowNotes = listShadow.notes;

  // ── Detail shadow-read on a sample present in both sources ──
  const sharedIds = localCustomers
    .map((c) => c.id)
    .filter((id) => listShadow.missingInSupabase.indexOf(id) === -1);
  const sampleId = sharedIds[0] ?? null;
  report.detailShadowSampleId = sampleId;
  if (sampleId) {
    const detail = await shadowReadCustomerDetail(sampleId);
    report.detailShadowOk = detail.ok;
    report.detailShadowNotes = detail.notes;
  } else {
    report.detailShadowNotes = ["no customer present in both sources to sample"];
  }

  // ── userIds drift sweep across all shared customers (bounded) ──
  const sweepIds = sharedIds.slice(0, USER_IDS_DRIFT_LIMIT);
  report.userIdsChecked = sweepIds.length > 0;
  for (const id of sweepIds) {
    const detail = await shadowReadCustomerDetail(id);
    if (detail.mismatchedFields.indexOf("userIds") !== -1) {
      report.userIdsDriftCount += 1;
      if (report.userIdsDriftSample.length < 10) report.userIdsDriftSample.push(id);
    }
  }

  // ── Verdict ──
  const reasons: string[] = [];
  if (!report.rowCountParity) {
    reasons.push(
      `row-count parity failed (local ${report.totalLocal} vs Supabase ${report.totalSupabase}` +
        (report.countMismatchCompanies.length
          ? `; companies: ${report.countMismatchCompanies.join(", ")}`
          : "") +
        ")",
    );
  }
  if (report.userIdsDriftCount > 0) {
    reasons.push(`userIds drift > 0 (${report.userIdsDriftCount} customer(s)) — ABORT`);
  }
  if (!report.listShadowOk) reasons.push("list shadow-read not clean (criticalDrift) — ABORT");
  if (sampleId && !report.detailShadowOk) {
    reasons.push("detail shadow-read not clean — ABORT");
  }
  if (report.writeFailures > 0) reasons.push(`writeFailures > 0 (${report.writeFailures}) — ABORT`);
  if (report.dualWriteFailures > 0) {
    reasons.push(`dual-write failures > 0 (${report.dualWriteFailures}) — ABORT`);
  }
  if (report.dualWriteSkipped > 0) {
    reasons.push(`dual-write skipped > 0 (${report.dualWriteSkipped}) — ABORT`);
  }
  if (report.dualWriteMismatches > 0) {
    reasons.push(`dual-write field mismatches > 0 (${report.dualWriteMismatches}) — ABORT`);
  }
  if (report.readFallbacks > 0) {
    reasons.push(
      `readFallbacks = ${report.readFallbacks} — investigate; abort if climbing across snapshots`,
    );
  }

  const hardAbort = reasons.some((r) => r.endsWith("— ABORT"));
  report.reasons = reasons;
  report.recommendation = hardAbort ? "ABORT" : reasons.length > 0 ? "REVIEW" : "GREEN";
  return report;
}

function yesNo(value: boolean): string {
  return value ? "ON" : "OFF";
}

/** Renders a structured report into a copy-pasteable plain-text block. */
export function formatCustomerStagingReport(report: CustomerStagingReport): string {
  const lines: string[] = [];
  lines.push("=== CleanOps · Customers Staging Verification Report ===");
  lines.push(`generated: ${report.at}`);
  lines.push(`supabase configured: ${report.supabaseConfigured ? "yes" : "no"}`);
  lines.push("");

  lines.push("-- Flag states --");
  lines.push(`wave: ${report.flags.wave}`);
  lines.push(`CUSTOMERS_LIST_SUPABASE_READ      : ${yesNo(report.flags.CUSTOMERS_LIST_SUPABASE_READ)}`);
  lines.push(`CUSTOMERS_DETAIL_SUPABASE_READ    : ${yesNo(report.flags.CUSTOMERS_DETAIL_SUPABASE_READ)}`);
  lines.push(`CUSTOMERS_DUAL_WRITE              : ${yesNo(report.flags.CUSTOMERS_DUAL_WRITE)}`);
  lines.push(`CUSTOMERS_SUPABASE_AUTHORITATIVE  : ${yesNo(report.flags.CUSTOMERS_SUPABASE_AUTHORITATIVE)}`);
  lines.push("");

  lines.push("-- Row counts (localStorage vs Supabase) --");
  if (report.perCompany.length === 0) {
    lines.push("(no customers found in either source)");
  } else {
    for (const c of report.perCompany) {
      lines.push(
        `${c.match ? "OK  " : "MISS"} ${c.companyId}: local ${c.localCount} / supabase ${c.supabaseCount}`,
      );
    }
  }
  lines.push(`TOTAL: local ${report.totalLocal} / supabase ${report.totalSupabase}`);
  lines.push(`row-count parity: ${report.rowCountParity ? "PASS" : "FAIL"}`);
  lines.push("");

  lines.push("-- Shadow reads --");
  lines.push(`list shadow-read: ${report.listShadowOk ? "CLEAN" : "DRIFT"}`);
  if (report.listShadowNotes.length) lines.push(`  notes: ${report.listShadowNotes.join("; ")}`);
  lines.push(
    `detail shadow-read: ${
      report.detailShadowSampleId
        ? `${report.detailShadowOk ? "CLEAN" : "DRIFT"} (sample ${report.detailShadowSampleId})`
        : "n/a (no shared sample)"
    }`,
  );
  if (report.detailShadowNotes.length) lines.push(`  notes: ${report.detailShadowNotes.join("; ")}`);
  lines.push(
    `userIds drift: ${report.userIdsChecked ? `${report.userIdsDriftCount} customer(s)` : "not checked (no shared rows)"}`,
  );
  if (report.userIdsDriftSample.length) {
    lines.push(`  drift sample: ${report.userIdsDriftSample.join(", ")}`);
  }
  lines.push("");

  lines.push("-- Cut-over telemetry --");
  lines.push(`readFallbacks : ${report.readFallbacks}`);
  lines.push(`writeFailures : ${report.writeFailures}`);
  lines.push("");

  lines.push("-- Dual-write telemetry --");
  lines.push(`failures   : ${report.dualWriteFailures}`);
  lines.push(`skipped    : ${report.dualWriteSkipped}`);
  lines.push(`mismatches : ${report.dualWriteMismatches}`);
  lines.push("");

  lines.push("-- Backout snapshot --");
  if (report.backoutChecksum) {
    lines.push(`checksum: ${report.backoutChecksum}`);
    lines.push(`taken at: ${report.backoutAt} (total ${report.backoutTotal})`);
  } else {
    lines.push("no backout snapshot recorded this session");
  }
  lines.push("");

  lines.push(`>>> RECOMMENDATION: ${report.recommendation} <<<`);
  if (report.reasons.length) {
    for (const r of report.reasons) lines.push(`  - ${r}`);
  } else {
    lines.push("  - all checked signals clean");
  }
  lines.push("=== end of report ===");
  return lines.join("\n");
}

/**
 * Operator entry point. Runs the read-only sweep, logs the copy-pasteable text
 * block to the console, and returns the same text so it can be captured from a
 * dev-console `await`. Mutates nothing.
 */
export async function runCustomerStagingReport(): Promise<string> {
  const report = await collectCustomerStagingReport();
  const text = formatCustomerStagingReport(report);
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.log(text);
  }
  return text;
}

// Expose console handles for the staging operator. Unlike the other data-layer
// handles (DEV-only), this one attaches in any build because its whole purpose
// is live STAGING verification — and it is strictly read-only, so it is safe to
// expose. Merges with whatever handles the other modules attached.
if (typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    runCustomerStagingReport,
    collectCustomerStagingReport,
    formatCustomerStagingReport,
  };
}
