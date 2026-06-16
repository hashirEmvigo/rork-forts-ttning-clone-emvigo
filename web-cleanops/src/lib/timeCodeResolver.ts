import type { Service, TimeCode } from "@/types";

/**
 * Time Code resolver — the read/lookup layer for the payroll foundation.
 *
 * This mirrors the cached-resolver pattern used by other Settings modules (e.g.
 * the entitlement resolver): an index is built once from the time-code list,
 * then every lookup is O(1) by id. Usage counts are computed in a single pass
 * over services — there are NO service scans during normal id reads.
 *
 * Everything here is pure and side-effect free so it is trivially unit-tested
 * and reusable by the context, UI and future payroll exports.
 */

/** An immutable, O(1) lookup index over a set of time codes, keyed by id. */
export interface TimeCodeIndex {
  /** Resolve a code by id in O(1). */
  byId: ReadonlyMap<string, TimeCode>;
}

/** Builds an {@link TimeCodeIndex} from a list of time codes. */
export function buildTimeCodeIndex(codes: readonly TimeCode[]): TimeCodeIndex {
  const byId = new Map<string, TimeCode>();
  for (const code of codes) byId.set(code.id, code);
  return { byId };
}

/** Resolves a single time code by id in O(1), or undefined when unknown. */
export function resolveTimeCode(
  index: TimeCodeIndex,
  id: string | null | undefined,
): TimeCode | undefined {
  if (!id) return undefined;
  return index.byId.get(id);
}

/**
 * The time codes available to a company for assignment: active global master
 * codes plus the company's own active codes (future). Inactive codes are
 * excluded so pickers never offer a retired code, but historical references to
 * them still resolve via {@link resolveTimeCode}.
 */
export function availableTimeCodes(
  codes: readonly TimeCode[],
  companyId: string | null,
): TimeCode[] {
  return codes
    .filter(
      (c) =>
        c.active && (c.companyId === null || (companyId !== null && c.companyId === companyId)),
    )
    .sort(sortTimeCodes);
}

/** Stable display ordering: attendance before absence, then by numeric/text code. */
export function sortTimeCodes(a: TimeCode, b: TimeCode): number {
  if (a.type !== b.type) return a.type === "attendance" ? -1 : 1;
  const an = Number(a.code);
  const bn = Number(b.code);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

/**
 * Counts how many services reference each time code, in a single pass. Returns a
 * Map keyed by time-code id so callers get O(1) usage reads without rescanning
 * services per code. Services with no `timeCodeId` are ignored.
 */
export function timeCodeUsageMap(services: readonly Service[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const service of services) {
    const id = service.timeCodeId;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The services that reference a given time code, preserving input order. */
export function linkedServices(
  timeCodeId: string,
  services: readonly Service[],
): Service[] {
  return services.filter((s) => s.timeCodeId === timeCodeId);
}

/**
 * Whether a time code may be hard-deleted: only when it is not system-managed
 * AND no service references it (no historical data). Otherwise callers must
 * deactivate (soft-delete) instead, preserving payroll history.
 */
export function canDeleteTimeCode(
  timeCode: TimeCode,
  usage: ReadonlyMap<string, number>,
): boolean {
  if (timeCode.systemManaged) return false;
  return (usage.get(timeCode.id) ?? 0) === 0;
}
