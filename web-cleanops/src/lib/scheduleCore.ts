import {
  RECURRENCE_INTERVAL_LABELS,
  indexOccurrenceExceptions,
} from "@/types";
import type {
  BookingOccurrenceException,
  Customer,
  Employee,
  PostalCity,
  RecurrenceInterval,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";
import { addressCityLabel } from "./postalCity";
import { parseDateOnly, toDateOnly } from "./recurrence";
import {
  resolveBookingOperationalStatus,
  type OperationalStatusBadge,
} from "./bookingStatus";
import { buildOccurrenceChangeMessage } from "./rescheduleMessaging";
import { isLiveSourceRow, isLiveWorkOrder } from "./serviceEndDateGuard";
import {
  generateServiceRowOccurrences,
  type ServiceRowOccurrenceStatus,
} from "./serviceRowOccurrences";

/**
 * Shared Schedule Core — Phase 1 foundation.
 *
 * This is the single, framework-agnostic source of scheduling truth that every
 * future Schedule surface (read-only Production Schedule, dispatcher workflows,
 * conflict detection, optimization) consumes. It deliberately does NOT build any
 * scheduling UX, drag & drop, conflict handling or routing — it only RESOLVES
 * the concrete occurrences that exist for a date range and exposes them in one
 * canonical shape, so no two surfaces can re-derive (and diverge on) the truth.
 *
 * It is built on the already-tested per-row generator
 * ({@link generateServiceRowOccurrences} — base rule → variation resolver →
 * occurrence exception), iterated across every LIVE work-order service row and
 * enriched with the customer / work-order / employee metadata a schedule needs.
 * Pure: no persistence, no side effects, safe to call during render.
 */

/** A single resolved schedule entry — one concrete occurrence of one service. */
export interface ScheduleEntry {
  /** Stable identity: `parentServiceRowId:occurrenceDate` (never shifted). */
  occurrenceKey: string;
  /** The work-order service row that produced this entry. */
  parentServiceRowId: string;
  workOrderId: string;
  workOrderNumber: string;
  companyId: string;
  customerId: string;
  customerName: string;
  /** Resolved customer delivery (or first) address street line, or "". */
  customerStreet: string;
  /** Resolved customer postal code, or "". */
  customerPostalCode: string;
  /** Resolved customer city, or "". */
  customerCity: string;
  serviceName: string;
  recurrenceInterval: RecurrenceInterval;
  /** Human label for the recurrence (e.g. "Weekly", "One time"). */
  recurrenceLabel: string;
  /** Rule-derived identity date "YYYY-MM-DD" (never shifted by a reschedule). */
  occurrenceDate: string;
  /** Visible date "YYYY-MM-DD" — equals occurrenceDate unless rescheduled. */
  displayDate: string;
  /** Resolved planned start "HH:MM" (after variation/exception), or null. */
  startTime: string | null;
  /** Resolved planned end "HH:MM" (after variation/exception), or null. */
  endTime: string | null;
  /** Wall-clock visit duration in minutes (or null when no valid window). */
  visitMinutes: number | null;
  /** Total planned labour effort in minutes (or null when no valid window). */
  labourMinutes: number | null;
  /**
   * Planned labour minutes carried by each ASSIGNED employee. Equals the visit
   * window normally, or the pinned total ÷ assigned crew for a redistributed
   * job (so a reduced crew shows the larger per-person workload). Null when the
   * visit window is invalid.
   */
  perEmployeeMinutes: number | null;
  /**
   * True when this occurrence's total labour is pinned and redistributed across
   * the crew (the row carries a total-labour override) rather than scaling with
   * headcount. Drives the "redistributed" indicator and keeps board labour
   * totals stable when a crew is reduced.
   */
  isLabourRedistributed: boolean;
  assignedEmployeeIds: string[];
  assignedEmployeeNames: string[];
  /**
   * Open employee slots on this occurrence (staffing intent minus assignees).
   * Always a non-negative integer. Alias for the planning board's clearer
   * {@link ScheduleEntry.openSlotCount}; kept for backwards compatibility.
   */
  unassignedEmployeeSlots: number;
  /**
   * Open employee slots on this occurrence — `Math.max(0, requiredStaffCount −
   * assignedEmployeeIds.length)`. Mirrors {@link unassignedEmployeeSlots} and is
   * always a non-negative integer, even when the source data is missing.
   */
  openSlotCount: number;
  /**
   * Total planned headcount for this occurrence: assignees plus open slots,
   * always at least 1. Used to drive staffing/Unassigned-row logic safely.
   */
  requiredStaffCount: number;
  /**
   * True when the occurrence has at least one assignee AND at least one open
   * slot — it belongs under each assigned employee AND in the Unassigned /
   * Open-slots row.
   */
  isPartiallyAssigned: boolean;
  /** Effective status after the exception overlay. */
  status: ServiceRowOccurrenceStatus;
  /** True when at least one variation applied to this occurrence. */
  isVariation: boolean;
  /** True when this occurrence was moved by an exception (displayDate ≠ rule). */
  isRescheduled: boolean;
  /**
   * The authoritative move (date and/or time) for this occurrence, sourced from
   * the occurrence exception — never inferred from display values. Null when the
   * occurrence sits on its rule-derived date/time. Drives the "Rebooked" status
   * and the change information, exactly like the Booking Queue.
   */
  reschedule: ScheduleEntryReschedule | null;
  /**
   * A manual time override exists on this occurrence (its planned window differs
   * from the generated one). Derived from the same source as the Booking Queue's
   * change-information copy, so the "Changed" modifier never diverges.
   */
  isTimeChanged: boolean;
}

/** The authoritative original→new date/time of an occurrence-level move. */
export interface ScheduleEntryReschedule {
  /** Original (rule-derived) date "YYYY-MM-DD". */
  originalDate: string;
  /** New date the occurrence moved to "YYYY-MM-DD". */
  newDate: string;
  originalStartTime: string | null;
  originalEndTime: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
}

/** Minimal `{ id, name }` lookup shape so the core is trivially testable. */
export interface NamedRef {
  id: string;
  name: string;
}

/** Input for {@link resolveScheduleProgram}. */
export interface ScheduleCoreInput {
  /** All work orders (their live service rows are the source of truth). */
  workOrders: WorkOrder[];
  /** Customers, used to resolve the customer name and address for each entry. */
  customers: Pick<Customer, "id" | "name" | "addresses">[];
  /** Employees, used to resolve assigned employee names. */
  employees: Pick<Employee, "id" | "name">[];
  /**
   * Optional postal cities, used to resolve an address's structured city for
   * display. When omitted, the legacy free-text `city` is used unchanged.
   */
  postalCities?: PostalCity[];
  /** Persisted occurrence exception overlays (cancel / reschedule). */
  exceptions: BookingOccurrenceException[];
  /** Inclusive lower bound "YYYY-MM-DD". */
  fromDate: string;
  /** Inclusive upper bound "YYYY-MM-DD". */
  toDate: string;
  /**
   * Include cancelled occurrences in the result. Defaults to FALSE, matching the
   * Schedule, Schedule Lab and Booking Queue defaults — a caller must opt in to
   * see cancelled work.
   */
  includeCancelled?: boolean;
}

/** Per-row hard cap mirrors the generator's own guard for date-range scans. */
const PER_ROW_LIMIT = 500;

/**
 * Resolves every concrete schedule entry whose DISPLAY date falls within
 * `[fromDate, toDate]`, across all LIVE work-order service rows. Service rows of
 * a non-live work order (inactivated/archived — see {@link isLiveWorkOrder}) and
 * archived/orphaned rows (see {@link isLiveSourceRow}) are skipped: they no
 * longer drive active future work. This is the guard that prevents an
 * inactivated ("deleted") work order from leaving orphaned live bookings on the
 * board — its occurrences vanish from live planning while history is preserved
 * by the Booking Queue's audit path.
 *
 * PRODUCT BOUNDARY (item C — deliberate, not a bug): the operational Schedule
 * is intentionally focused on live/plannable service rows only. The Booking
 * Queue may still preserve PAST orphan/archived occurrences for audit
 * visibility, so the two surfaces can legitimately differ on historical
 * orphaned rows. We do NOT mix that historical/audit behaviour into the live
 * dispatcher Schedule. A future Historical Schedule / Audit View will decide how
 * archived/orphaned rows should be surfaced; until then this divergence is an
 * accepted decision, not a parity failure.
 *
 * The range is filtered on the **display (planning) date** — the date the
 * occurrence is actually planned for — not the rule-derived identity date. This
 * is the user-facing dimension every surface (Schedule, Schedule Lab, Booking
 * Queue) shares, so a rescheduled booking appears on the day it was moved TO. A
 * reschedule can cross the range boundary in either direction:
 *  - a rule date inside the range moved OUT → dropped (display-date filter),
 *  - a rule date outside the range moved IN → still surfaced, because the scan
 *    window is widened to include the rule date of any reschedule whose override
 *    lands in range.
 *
 * Entries are returned in chronological display order (date → start time →
 * customer), the natural reading order for any schedule surface. Pure.
 */
export function resolveScheduleProgram(input: ScheduleCoreInput): ScheduleEntry[] {
  const includeCancelled = input.includeCancelled ?? false;
  const exceptionsByKey = indexOccurrenceExceptions(input.exceptions);

  // Widen the generation scan so a reschedule whose override lands in range, but
  // whose rule-derived date sits outside it, is still generated (then kept by
  // the display-date filter). Date-only strings compare lexically.
  let scanFrom = input.fromDate;
  let scanTo = input.toDate;
  for (const ex of input.exceptions) {
    if (ex.status !== "rescheduled") continue;
    const override = ex.overrideOccurrenceDate;
    if (!override || override < input.fromDate || override > input.toDate) continue;
    if (ex.occurrenceDate < scanFrom) scanFrom = ex.occurrenceDate;
    if (ex.occurrenceDate > scanTo) scanTo = ex.occurrenceDate;
  }

  const customerName = new Map<string, string>();
  const customerAddress = new Map<
    string,
    { street: string; postalCode: string; city: string }
  >();
  const postalCities = input.postalCities ?? [];
  for (const c of input.customers) {
    customerName.set(c.id, c.name);
    // Prefer the flagged delivery address (where work happens), else the first.
    const addr = (c.addresses ?? []).find((a) => a.isDelivery) ?? (c.addresses ?? [])[0];
    customerAddress.set(c.id, {
      street: addr?.street ?? "",
      postalCode: addr?.postalCode ?? "",
      // Address-level structured city from its explicit postal-city link, else "".
      city: addressCityLabel(addr, postalCities),
    });
  }
  const employeeName = new Map<string, string>();
  for (const e of input.employees) employeeName.set(e.id, e.name);

  const entries: ScheduleEntry[] = [];
  for (const wo of input.workOrders) {
    // A non-live (inactivated/archived) work order no longer drives the live
    // schedule — skip every row it owns so its bookings can't orphan the board.
    if (!isLiveWorkOrder(wo)) continue;
    for (const row of wo.serviceRows ?? []) {
      if (!isLiveSourceRow(row)) continue;

      const occurrences = generateServiceRowOccurrences({
        row,
        fromDate: scanFrom,
        toDate: scanTo,
        limit: PER_ROW_LIMIT,
        exceptions: exceptionsByKey,
      });

      for (const occ of occurrences) {
        if (!includeCancelled && occ.status === "cancelled") continue;
        // Range is filtered on the display date — drop occurrences planned
        // outside [fromDate, toDate], including ones moved out by a reschedule.
        if (occ.displayDate < input.fromDate || occ.displayDate > input.toDate) continue;
        // Defensive staffing math — never assume the generator populated these.
        const assignedEmployeeIds = occ.assignedEmployeeIds ?? [];
        const openSlotCount = Math.max(0, occ.unassignedEmployeeSlots ?? 0);
        const requiredStaffCount = Math.max(1, assignedEmployeeIds.length + openSlotCount);
        const isPartiallyAssigned = assignedEmployeeIds.length > 0 && openSlotCount > 0;
        const interval = row.recurrenceInterval ?? "one_time";
        // Authoritative move + manual-time-change, sourced from the exception
        // overlay only (mirrors the Booking Queue's occurrence path). The change
        // message is the single source of truth for `timeChanged`.
        const reschedule: ScheduleEntryReschedule | null =
          occ.status === "rescheduled"
            ? {
                originalDate: occ.occurrenceDate,
                newDate: occ.displayDate,
                originalStartTime: occ.preExceptionStartTime,
                originalEndTime: occ.preExceptionEndTime,
                newStartTime: occ.startTime,
                newEndTime: occ.endTime,
              }
            : null;
        const isTimeChanged = reschedule
          ? buildOccurrenceChangeMessage({
              scope: "occurrence",
              originalDate: reschedule.originalDate,
              newDate: reschedule.newDate,
              originalStartTime: reschedule.originalStartTime,
              originalEndTime: reschedule.originalEndTime,
              newStartTime: reschedule.newStartTime,
              newEndTime: reschedule.newEndTime,
            }).timeChanged
          : false;
        entries.push({
          occurrenceKey: occ.occurrenceKey,
          parentServiceRowId: occ.parentServiceRowId,
          workOrderId: wo.id,
          workOrderNumber: wo.number,
          companyId: wo.companyId,
          customerId: wo.customerId,
          customerName: customerName.get(wo.customerId) ?? "",
          customerStreet: customerAddress.get(wo.customerId)?.street ?? "",
          customerPostalCode: customerAddress.get(wo.customerId)?.postalCode ?? "",
          customerCity: customerAddress.get(wo.customerId)?.city ?? "",
          serviceName: row.serviceName,
          recurrenceInterval: interval,
          recurrenceLabel: RECURRENCE_INTERVAL_LABELS[interval] ?? interval,
          occurrenceDate: occ.occurrenceDate,
          displayDate: occ.displayDate,
          startTime: occ.startTime,
          endTime: occ.endTime,
          visitMinutes: occ.visitMinutes,
          labourMinutes: occ.labourMinutes,
          perEmployeeMinutes: occ.perEmployeeMinutes,
          isLabourRedistributed: occ.isLabourRedistributed,
          assignedEmployeeIds,
          assignedEmployeeNames: assignedEmployeeIds
            .map((id) => employeeName.get(id))
            .filter((n): n is string => Boolean(n)),
          unassignedEmployeeSlots: openSlotCount,
          openSlotCount,
          requiredStaffCount,
          isPartiallyAssigned,
          status: occ.status,
          isVariation: occ.isVariation,
          isRescheduled: occ.status === "rescheduled" || occ.displayDate !== occ.occurrenceDate,
          reschedule,
          isTimeChanged,
        });
      }
    }
  }

  entries.sort((a, b) => {
    if (a.displayDate !== b.displayDate) return a.displayDate < b.displayDate ? -1 : 1;
    const aStart = a.startTime ?? "99:99";
    const bStart = b.startTime ?? "99:99";
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    return a.customerName.localeCompare(b.customerName);
  });
  return entries;
}

// ── Day-view grouping ─────────────────────────────────────

/** One bucket of items grouped under a single assignee (or Unassigned). */
export interface EmployeeBucket<T> {
  /** Stable bucket key — the employee name, or `__unassigned`. */
  key: string;
  /** Display name for the bucket header. */
  name: string;
  /** True for the catch-all open-slot / no-assignee bucket (sorts last). */
  isUnassigned: boolean;
  rows: T[];
}

/**
 * Groups items under each assigned employee, with a single catch-all
 * "Unassigned" bucket for items that have no assignee. A multi-employee item is
 * listed under EVERY assignee it has (so each dispatcher sees their own work),
 * but it remains ONE distinct item — callers count occurrences from the entry
 * list, never from the buckets. Buckets are returned alphabetically with
 * Unassigned last. Pure — safe during render and shared by the Schedule day
 * view so the grouping rule lives in exactly one place.
 */
export function groupByEmployee<T>(
  items: T[],
  getEmployeeNames: (item: T) => string[],
): EmployeeBucket<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, EmployeeBucket<T>>();
  const push = (key: string, name: string, isUnassigned: boolean, item: T) => {
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(item);
    } else {
      order.push(key);
      byKey.set(key, { key, name, isUnassigned, rows: [item] });
    }
  };
  for (const item of items) {
    const names = getEmployeeNames(item);
    if (names.length > 0) {
      for (const name of names) push(name, name, false, item);
    } else {
      push("__unassigned", "Unassigned", true, item);
    }
  }
  const buckets = order.map((k) => byKey.get(k) as EmployeeBucket<T>);
  buckets.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return buckets;
}

// ── Planning-board grouping (employee × date) ─────────────

/**
 * A pure index of items bucketed by employee id, then by date — the data shape
 * the employee planning board renders from. A multi-employee item is indexed
 * under EVERY assignee it has (so it appears in each employee's row), but it is
 * still ONE distinct item: callers count occurrences from the resolved entry
 * list, never from this index. Items with no assignee land in
 * {@link ScheduleBoardIndex.unassignedByDate} so the board's always-visible
 * "Unassigned / Open slots" row can render them.
 */
export interface ScheduleBoardIndex<T> {
  /** employeeId → (dateIso → items on that date). */
  byEmployee: Map<string, Map<string, T[]>>;
  /** dateIso → items with no assignee on that date. */
  unassignedByDate: Map<string, T[]>;
  /** Set of employee ids that have at least one item across the range. */
  employeeIdsWithWork: Set<string>;
  /** True when any item anywhere has no assignee (open work exists). */
  hasUnassigned: boolean;
}

/**
 * Buckets items into the {@link ScheduleBoardIndex} shape (employee × date) for
 * the planning board. Pure — it only re-groups the already-resolved entries by
 * assignee and date; it never re-derives occurrences, so the board stays a thin
 * presentation layer over {@link resolveScheduleProgram}. Safe during render.
 *
 * An item lands in {@link ScheduleBoardIndex.unassignedByDate} when it has NO
 * assignee, OR — via the optional `getOpenSlotCount` accessor — when it still
 * has open slots despite having assignees (a partially-assigned occurrence). In
 * that partial case the item appears BOTH under each assigned employee AND once
 * in the Unassigned / Open-slots row, while remaining ONE distinct occurrence
 * (callers count from the entry list, never from this index). All accessors are
 * read defensively, so missing/undefined staffing data can never throw.
 */
export function buildScheduleBoard<T>(
  items: T[],
  getEmployeeIds: (item: T) => string[] | undefined | null,
  getDate: (item: T) => string,
  getOpenSlotCount?: (item: T) => number | undefined | null,
): ScheduleBoardIndex<T> {
  const byEmployee = new Map<string, Map<string, T[]>>();
  const unassignedByDate = new Map<string, T[]>();
  const employeeIdsWithWork = new Set<string>();
  let hasUnassigned = false;

  const pushInto = (map: Map<string, T[]>, date: string, item: T) => {
    const list = map.get(date);
    if (list) list.push(item);
    else map.set(date, [item]);
  };

  for (const item of items) {
    const date = getDate(item);
    const ids = getEmployeeIds(item) ?? [];
    const openSlots = Math.max(0, getOpenSlotCount?.(item) ?? 0);
    for (const id of ids) {
      if (!id) continue;
      employeeIdsWithWork.add(id);
      let dateMap = byEmployee.get(id);
      if (!dateMap) {
        dateMap = new Map<string, T[]>();
        byEmployee.set(id, dateMap);
      }
      pushInto(dateMap, date, item);
    }
    // Open work belongs in the Unassigned row: either there is no assignee at
    // all, or assignees exist but slots are still open (partially assigned).
    if (ids.length === 0 || openSlots > 0) {
      hasUnassigned = true;
      pushInto(unassignedByDate, date, item);
    }
  }

  return { byEmployee, unassignedByDate, employeeIdsWithWork, hasUnassigned };
}

/**
 * Resolves the single operational status (Cancelled / Rebooked / Variation /
 * Scheduled / Unscheduled) for a resolved {@link ScheduleEntry}, by delegating
 * to the shared {@link resolveBookingOperationalStatus}. This keeps every
 * Schedule surface a thin layer over the core with NO duplicated status logic.
 * An entry is "scheduled" when it has a concrete planned start, else
 * "unscheduled". Pure — safe during render.
 */
export function scheduleEntryOperationalStatus(entry: ScheduleEntry): OperationalStatusBadge {
  return resolveBookingOperationalStatus({
    isCancelled: entry.status === "cancelled",
    reschedule: entry.reschedule
      ? {
          originalDate: entry.reschedule.originalDate,
          newDate: entry.reschedule.newDate,
          oneTime: true,
        }
      : null,
    isVariation: entry.isVariation,
    isScheduled: entry.startTime != null,
  });
}

// ── Schedule Program roll-up ──────────────────────────────

/** A glance-able roll-up of a resolved schedule program. */
export interface ScheduleProgramSummary {
  /** Total entries in the result (respects the includeCancelled flag). */
  total: number;
  active: number;
  cancelled: number;
  rescheduled: number;
  variations: number;
  /** Active entries with no assignee and no open slot. */
  unstaffed: number;
  /** Active entries that still need staff (assignees < required, or open slots). */
  needsStaffing: number;
  /** Sum of visit (wall-clock) minutes across active entries. */
  visitMinutes: number;
  /** Sum of planned labour minutes across active entries. */
  labourMinutes: number;
  distinctCustomers: number;
  distinctEmployees: number;
  distinctServices: number;
}

/** Computes the {@link ScheduleProgramSummary} for resolved entries. Pure. */
export function summarizeScheduleProgram(entries: ScheduleEntry[]): ScheduleProgramSummary {
  const customers = new Set<string>();
  const employees = new Set<string>();
  const services = new Set<string>();
  let active = 0;
  let cancelled = 0;
  let rescheduled = 0;
  let variations = 0;
  let unstaffed = 0;
  let needsStaffing = 0;
  let visitMinutes = 0;
  let labourMinutes = 0;

  for (const e of entries) {
    if (e.isVariation) variations += 1;
    if (e.isRescheduled) rescheduled += 1;
    if (e.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    active += 1;
    customers.add(e.customerId);
    services.add(e.serviceName);
    for (const id of e.assignedEmployeeIds) employees.add(id);
    visitMinutes += e.visitMinutes ?? 0;
    labourMinutes += e.labourMinutes ?? 0;
    if (e.assignedEmployeeIds.length === 0 && e.unassignedEmployeeSlots === 0) unstaffed += 1;
    if (e.unassignedEmployeeSlots > 0 || e.assignedEmployeeIds.length === 0) needsStaffing += 1;
  }

  return {
    total: entries.length,
    active,
    cancelled,
    rescheduled,
    variations,
    unstaffed,
    needsStaffing,
    visitMinutes,
    labourMinutes,
    distinctCustomers: customers.size,
    distinctEmployees: employees.size,
    distinctServices: services.size,
  };
}

// ── Operational board metrics ─────────────────────────────

/** Per-date occurrence + open-slot counts for the board column headers. */
export interface ScheduleDateMetrics {
  /** Distinct occurrences planned (display date) on this date. */
  occurrences: number;
  /** Sum of open staffing slots across active occurrences on this date. */
  openSlots: number;
}

/**
 * Operational summary metrics for a resolved schedule program — the numbers the
 * planning board's summary bar and column headers display.
 *
 * COUNTING RULES (the thing that matters): every metric is derived from the
 * resolved {@link ScheduleEntry} list, where each occurrence appears EXACTLY
 * once. A multi-employee occurrence is therefore counted a single time here —
 * the board may render it under several employee rows, but the totals never
 * inflate. The staffing buckets are mutually exclusive across active
 * occurrences (cancelled occurrences are excluded from staffing):
 *  - fullyStaffed     → has assignees and no open slot,
 *  - partiallyStaffed → has assignees AND at least one open slot,
 *  - unstaffed        → no assignee at all.
 * So `fullyStaffed + partiallyStaffed + unstaffed === totalOccurrences − cancelled`.
 */
export interface ScheduleBoardMetrics {
  /** Total distinct occurrences in scope (cancelled included only when shown). */
  totalOccurrences: number;
  /** Active occurrences fully staffed (assignees, no open slot). */
  fullyStaffed: number;
  /** Active occurrences with assignees but at least one open slot. */
  partiallyStaffed: number;
  /** Active occurrences with no assignee at all. */
  unstaffed: number;
  /** Cancelled occurrences in scope. */
  cancelled: number;
  /** Sum of planned labour minutes across active occurrences. */
  labourMinutes: number;
  /** Total open staffing slots across active occurrences. */
  openSlots: number;
  /** dateIso → per-date occurrence + open-slot counts. */
  byDate: Map<string, ScheduleDateMetrics>;
}

/**
 * Computes the {@link ScheduleBoardMetrics} for a resolved schedule program.
 * Pure — safe during render. Derives every figure from the distinct-occurrence
 * entry list so multi-employee occurrences are never double-counted.
 *
 * `entries` are the VISIBLE entries the board renders — totals, staffing buckets,
 * labour, open slots and per-date headers all derive from these so the board and
 * its column headers stay in lock-step with what's on screen.
 *
 * `allEntries` is the optional cancelled-inclusive entry list for the same
 * period. When supplied, the Cancelled count is derived from it, so the Cancelled
 * tile always reflects the true number of cancelled occurrences even when
 * "Show cancelled" is OFF and they're hidden from the board. Cancelled
 * occurrences are still excluded from every staffing/labour/open-slot figure, and
 * each cancelled occurrence is counted exactly once regardless of assignee count.
 */
export function computeScheduleBoardMetrics(
  entries: ScheduleEntry[],
  allEntries?: ScheduleEntry[],
): ScheduleBoardMetrics {
  let fullyStaffed = 0;
  let partiallyStaffed = 0;
  let unstaffed = 0;
  let labourMinutes = 0;
  let openSlots = 0;
  const byDate = new Map<string, ScheduleDateMetrics>();

  for (const e of entries) {
    const bucket = byDate.get(e.displayDate) ?? { occurrences: 0, openSlots: 0 };
    bucket.occurrences += 1;

    if (e.status === "cancelled") {
      // Cancelled occurrences never contribute to staffing/labour, but they DO
      // count toward the visible per-date occurrence header when shown.
      byDate.set(e.displayDate, bucket);
      continue;
    }

    const slots = Math.max(0, e.openSlotCount ?? 0);
    const assigned = e.assignedEmployeeIds.length;
    if (assigned === 0) unstaffed += 1;
    else if (slots > 0) partiallyStaffed += 1;
    else fullyStaffed += 1;

    openSlots += slots;
    labourMinutes += e.labourMinutes ?? 0;
    bucket.openSlots += slots;
    byDate.set(e.displayDate, bucket);
  }

  // The Cancelled count reflects the whole period (cancelled-inclusive list when
  // provided), so hiding cancelled entries from the board never zeroes the tile.
  // Each occurrence is counted once — multi-employee cancellations included.
  const cancelledSource = allEntries ?? entries;
  let cancelled = 0;
  for (const e of cancelledSource) if (e.status === "cancelled") cancelled += 1;

  return {
    totalOccurrences: entries.length,
    fullyStaffed,
    partiallyStaffed,
    unstaffed,
    cancelled,
    labourMinutes,
    openSlots,
    byDate,
  };
}

// ── Integration integrity checks ──────────────────────────

/** Outcome of a single integrity check. */
export type IntegrityStatus = "pass" | "warn" | "fail";

/** One named assertion about the resolved schedule, with its offenders. */
export interface IntegrityCheck {
  id: string;
  label: string;
  description: string;
  status: IntegrityStatus;
  /** Number of entries that failed/triggered the check. */
  count: number;
  /** Up to a handful of human-readable offenders for inspection. */
  offenders: string[];
}

const MAX_OFFENDERS = 8;

function describe(entry: ScheduleEntry): string {
  return `${entry.workOrderNumber} · ${entry.serviceName} · ${entry.displayDate}`;
}

/**
 * Runs the Schedule Integration Lab's integrity assertions against resolved
 * entries — the heart of "verify operational truth before building UX". Each
 * check proves an invariant the production Schedule will rely on. Pure.
 */
export function runScheduleIntegrityChecks(
  entries: ScheduleEntry[],
  range: { fromDate: string; toDate: string },
): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];

  // 1. Identity is unique — no two entries may share an occurrence key.
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.occurrenceKey, (seen.get(e.occurrenceKey) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
  checks.push({
    id: "unique-keys",
    label: "Unique occurrence identity",
    description: "Every entry has a distinct occurrence key (no duplicate bookings).",
    status: dupes.length === 0 ? "pass" : "fail",
    count: dupes.length,
    offenders: dupes.slice(0, MAX_OFFENDERS),
  });

  // 2. Display date stays within the requested window (the range dimension).
  const from = parseDateOnly(range.fromDate);
  const to = parseDateOnly(range.toDate);
  const outOfRange = entries.filter((e) => {
    const d = parseDateOnly(e.displayDate);
    if (!d || !from || !to) return false;
    return d.getTime() < from.getTime() || d.getTime() > to.getTime();
  });
  checks.push({
    id: "within-range",
    label: "Occurrences bounded by range",
    description: "Every occurrence is planned (display date) within the selected date range.",
    status: outOfRange.length === 0 ? "pass" : "fail",
    count: outOfRange.length,
    offenders: outOfRange.slice(0, MAX_OFFENDERS).map(describe),
  });

  // 3. Time windows are valid — when both times exist, the visit is positive.
  const badWindow = entries.filter(
    (e) =>
      e.status !== "cancelled" &&
      e.startTime != null &&
      e.endTime != null &&
      (e.visitMinutes == null || e.visitMinutes <= 0),
  );
  checks.push({
    id: "valid-window",
    label: "Valid time windows",
    description: "When a start and end time exist, the end is after the start.",
    status: badWindow.length === 0 ? "pass" : "fail",
    count: badWindow.length,
    offenders: badWindow.slice(0, MAX_OFFENDERS).map(describe),
  });

  // 4. Metadata resolves — every active entry has a customer and service name.
  const missingMeta = entries.filter(
    (e) => e.status !== "cancelled" && (!e.customerName || !e.serviceName),
  );
  checks.push({
    id: "resolved-metadata",
    label: "Resolved customer & service",
    description: "Every active entry resolves to a known customer and service.",
    status: missingMeta.length === 0 ? "pass" : "warn",
    count: missingMeta.length,
    offenders: missingMeta.slice(0, MAX_OFFENDERS).map(describe),
  });

  // 5. Staffing is defined — an active entry has assignees or open slots.
  const noStaffing = entries.filter(
    (e) =>
      e.status !== "cancelled" &&
      e.assignedEmployeeIds.length === 0 &&
      e.unassignedEmployeeSlots === 0,
  );
  checks.push({
    id: "staffing-defined",
    label: "Staffing intent defined",
    description: "Active entries have an assignee or at least one open slot.",
    status: noStaffing.length === 0 ? "pass" : "warn",
    count: noStaffing.length,
    offenders: noStaffing.slice(0, MAX_OFFENDERS).map(describe),
  });

  return checks;
}

/** The worst status across a set of checks (fail > warn > pass). */
export function overallIntegrity(checks: IntegrityCheck[]): IntegrityStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

/** Local "YYYY-MM-DD" for today, the Lab's default range anchor. */
export function todayIso(now: Date = new Date()): string {
  return toDateOnly(now);
}
