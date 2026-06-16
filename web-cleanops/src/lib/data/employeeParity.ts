/**
 * EMP-0 parity validation (development-only).
 *
 * The Employees analogue of {@link import("./parity").validateWave0Parity} and
 * {@link import("./workOrderParity").validateWorkOrderParity}. It confirms the
 * already-existing localStorage employee adapter faithfully represents the
 * current Employee aggregate BEFORE any Supabase migration begins:
 *
 *   • count parity            — adapter total === getter count (scoped)
 *   • id-set parity           — same ids, exactly (id stability for assignments)
 *   • summary-field parity    — name / email / title / status / teamCount / hasLogin
 *   • detail parity           — getDetail reconstructs the FULL record losslessly
 *   • company-scope parity    — only the scoped company's rows are returned
 *   • search parity           — adapter search === reference search
 *   • status coverage         — inactive employees are NOT dropped (no implicit filter)
 *
 * Employees are a FLAT record — no nested schedule-critical child rows — so the
 * key guarantee here is `id` stability: existing service-row `assignedEmployeeIds`
 * and the deferred Time Reports / Activity tracks all soft-reference the employee
 * by this id, so it must survive the migration verbatim.
 *
 * It performs only read operations, mutates nothing, and is exposed on
 * `window.__cleanopsData` in development for manual inspection. No schema, no
 * migration, no UI switch — this is the EMP-0 safety net.
 */
import { getEmployees } from "@/lib/store";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import type { Employee } from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import type { EmployeeSummary, EmployeeDetail } from "./types";

/** Outcome of a single Employee parity dimension. */
export interface EmployeeParityCheck {
  dimension: string;
  ok: boolean;
  /** Records counted from the existing store getter (company-scoped). */
  sourceCount: number;
  /** Records produced by the adapter for the same scope. */
  adapterCount: number;
  /** Human-readable notes for any mismatch. */
  notes: string[];
}

export interface EmployeeParityReport {
  ok: boolean;
  companyId: string | null | undefined;
  checks: EmployeeParityCheck[];
}

function idSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function scoped<T extends { companyId: string | null }>(
  items: T[],
  companyId: string | null | undefined,
): T[] {
  return companyId === undefined ? items : items.filter((i) => i.companyId === companyId);
}

/** The summary fields EMP-0 asserts the adapter projects verbatim. */
function summaryMatchesSource(summary: EmployeeSummary, source: Employee): boolean {
  return (
    summary.id === source.id &&
    summary.companyId === source.companyId &&
    summary.name === source.name &&
    summary.email === source.email &&
    (summary.title ?? undefined) === (source.title ?? undefined) &&
    summary.status === source.status &&
    summary.teamCount === source.teamIds.length &&
    summary.hasLogin === Boolean(source.userId)
  );
}

/** Asserts getDetail returns the SAME (lossless) record as the store getter. */
function detailIsLossless(detail: EmployeeDetail | null, source: Employee): boolean {
  if (!detail) return false;
  // EmployeeDetail === Employee, so a deep-equal of the serialised record proves
  // a lossless round-trip (incl. workingSchedule + every lookup-link field).
  return JSON.stringify(detail) === JSON.stringify(source);
}

/** Reference free-text search applied directly to the source records. */
function referenceSearch(items: Employee[], rawSearch: string | undefined): Employee[] {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return items;
  const needle = activeQuery.toLowerCase();
  return items.filter((e) =>
    [e.name, e.email, e.title].some((field) => (field ?? "").toLowerCase().includes(needle)),
  );
}

/**
 * Runs all EMP-0 parity checks for an optional company scope. When `companyId`
 * is omitted the comparison runs across all companies; pass an id to validate
 * company scoping specifically.
 */
export async function validateEmployeeParity(
  companyId?: string | null,
): Promise<EmployeeParityReport> {
  const checks: EmployeeParityCheck[] = [];
  const source = scoped(getEmployees(), companyId);

  // 1 — Count parity ──
  {
    const result = await localDataLayer.employees.listSummaries({ companyId });
    const count = await localDataLayer.employees.count({ companyId });
    const notes: string[] = [];
    if (result.total !== source.length) notes.push("listSummaries total mismatch");
    if (count !== source.length) notes.push("count() mismatch");
    checks.push({
      dimension: "employees.count",
      ok: notes.length === 0,
      sourceCount: source.length,
      adapterCount: result.total,
      notes,
    });
  }

  // 2 — Id-set parity (id stability for service-row assignments) ──
  {
    const result = await localDataLayer.employees.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((e) => e.id), result.items.map((e) => e.id));
    const notes: string[] = [];
    if (!idsMatch) notes.push("id set mismatch");
    checks.push({
      dimension: "employees.ids",
      ok: notes.length === 0,
      sourceCount: source.length,
      adapterCount: result.items.length,
      notes,
    });
  }

  // 3 — Summary-field parity (incl. teamCount + hasLogin) ──
  {
    const result = await localDataLayer.employees.listSummaries({ companyId });
    const notes: string[] = [];
    for (const e of source) {
      const summary = result.items.find((s) => s.id === e.id);
      if (!summary) {
        notes.push(`summary missing for ${e.id}`);
        continue;
      }
      if (!summaryMatchesSource(summary, e)) notes.push(`summary field mismatch on ${e.id}`);
    }
    checks.push({
      dimension: "employees.summaryFields",
      ok: notes.length === 0,
      sourceCount: source.length,
      adapterCount: result.items.length,
      notes,
    });
  }

  // 4 — Detail parity (lossless full record) ──
  {
    const notes: string[] = [];
    const sample = source[0];
    if (sample) {
      const detail = await localDataLayer.employees.getDetail(sample.id, { companyId });
      if (!detailIsLossless(detail, sample)) notes.push(`detail not lossless for ${sample.id}`);
    }
    checks.push({
      dimension: "employees.detail",
      ok: notes.length === 0,
      sourceCount: sample ? 1 : 0,
      adapterCount: sample ? 1 : 0,
      notes,
    });
  }

  // 5 — Company-scope parity (no foreign rows leak in) ──
  {
    const result = await localDataLayer.employees.listSummaries({ companyId });
    const notes: string[] = [];
    if (companyId !== undefined) {
      const leaked = result.items.filter((s) => s.companyId !== companyId);
      if (leaked.length > 0) notes.push(`${leaked.length} foreign-company rows leaked`);
    }
    checks.push({
      dimension: "employees.companyScope",
      ok: notes.length === 0,
      sourceCount: source.length,
      adapterCount: result.items.length,
      notes,
    });
  }

  // 6 — Search parity (adapter search === reference search) ──
  {
    const notes: string[] = [];
    const sample = source[0];
    // Use a sample name token so the query clears the search threshold.
    const term = sample?.name?.split(" ")[0];
    if (term) {
      const expected = referenceSearch(source, term);
      const result = await localDataLayer.employees.search({ companyId, search: term });
      if (
        !idSetsEqual(expected.map((e) => e.id), result.items.map((e) => e.id))
      ) {
        notes.push("search id set mismatch");
      }
    }
    checks.push({
      dimension: "employees.search",
      ok: notes.length === 0,
      sourceCount: sample ? 1 : 0,
      adapterCount: sample ? 1 : 0,
      notes,
    });
  }

  // 7 — Status coverage (inactive employees are NOT dropped) ──
  {
    const result = await localDataLayer.employees.listSummaries({ companyId });
    const notes: string[] = [];
    const sourceInactive = source.filter((e) => e.status === "inactive").length;
    const adapterInactive = result.items.filter((s) => s.status === "inactive").length;
    if (sourceInactive !== adapterInactive) notes.push("inactive employee count mismatch");
    checks.push({
      dimension: "employees.statusCoverage",
      ok: notes.length === 0,
      sourceCount: sourceInactive,
      adapterCount: adapterInactive,
      notes,
    });
  }

  return { ok: checks.every((c) => c.ok), companyId, checks };
}

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const handle = window as unknown as {
    __cleanopsData?: Record<string, unknown>;
  };
  handle.__cleanopsData = {
    ...(handle.__cleanopsData ?? {}),
    validateEmployeeParity,
  };
}
