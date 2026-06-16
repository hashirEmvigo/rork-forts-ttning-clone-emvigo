/**
 * Pure, side-effect-free roll-up of an employee's planned workload across the
 * Schedule Board range. The board distinguishes two different quantities:
 *
 *  - **On-site time** — the actual visit/customer window the employee is in
 *    front of the customer (visit duration).
 *  - **Labour workload** — the employee's planned labour, which can differ from
 *    on-site time when work is redistributed across a reduced crew. Prefers the
 *    per-employee planned minutes carried by Schedule Core; falls back to the
 *    visit duration when no redistributed labour exists.
 *
 * Capacity/utilisation is computed from the labour workload (actual planned
 * work), not the visible visit window. Cancelled occurrences are excluded from
 * both totals. Open slots never inflate an employee's labour because the
 * per-employee minutes only count work actually assigned to them.
 */

/** The minimal occurrence shape needed to roll up a single employee's row. */
export interface EmployeeRollupEntry {
  /** Occurrence operational status; cancelled occurrences are skipped. */
  status: string;
  /** Wall-clock visit/customer window in minutes (or null when invalid). */
  visitMinutes: number | null;
  /** Planned labour minutes carried by this employee (or null). */
  perEmployeeMinutes: number | null;
}

/** The two workload quantities surfaced on an employee row. */
export interface EmployeeWorkloadRollup {
  /** On-site (visit/customer) minutes across non-cancelled visits. */
  onSiteMinutes: number;
  /** Planned labour workload minutes — the basis for capacity/utilisation. */
  labourMinutes: number;
}

/**
 * Sums on-site and labour minutes for one employee. Cancelled occurrences are
 * excluded. Labour prefers {@link EmployeeRollupEntry.perEmployeeMinutes} and
 * falls back to the visit duration when no redistributed labour is present.
 */
export function rollUpEmployeeWorkload(
  entries: EmployeeRollupEntry[],
): EmployeeWorkloadRollup {
  let onSiteMinutes = 0;
  let labourMinutes = 0;
  for (const e of entries) {
    if (e.status === "cancelled") continue;
    const visit = Math.max(0, e.visitMinutes ?? 0);
    onSiteMinutes += visit;
    const labour = e.perEmployeeMinutes ?? visit;
    labourMinutes += Math.max(0, labour);
  }
  return { onSiteMinutes, labourMinutes };
}
