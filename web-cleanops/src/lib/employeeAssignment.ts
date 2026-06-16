import type { Employee, TimeReport, WorkOrder } from "@/types";

/**
 * Pure helpers for the dispatcher "Assign employees" experience: deriving an
 * employee's prior history with a customer, turning that into ranked
 * suggestions with star indicators, safely toggling an assignment while keeping
 * staffing intent intact, and validating a staffing change before it is saved.
 *
 * These are intentionally framework-agnostic so the Schedule board and the
 * Work-order quick-assign can share the exact same suggestion/validation truth
 * and stay testable in isolation. Nothing here mutates state or persists.
 */

/** Default lookback window for "previous experience with this customer". */
export const ASSIGN_HISTORY_LOOKBACK_DAYS = 365;

/** Visits at/above which an employee is treated as "frequently used". */
export const FREQUENT_VISIT_THRESHOLD = 5;

/** What we know about an employee's prior work for a single customer. */
export interface EmployeeCustomerHistory {
  /** Total visits (time reports + assigned rows) within the lookback window. */
  count: number;
  /** Most recent visit date "YYYY-MM-DD", or null when unknown. */
  lastVisitDate: string | null;
}

function takeDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  // Both ISO timestamps and date-only strings start with "YYYY-MM-DD".
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/**
 * Counts how many times each employee has worked for the given customer within
 * the lookback window, and records their most recent visit date. History is
 * tied to the CUSTOMER (any service for them counts), drawn from the two
 * reliable sources in the model: submitted time reports (actual execution) and
 * assigned service rows on the customer's work orders. The current service row
 * can be excluded so its own assignment never counts as prior history. Pure.
 */
export function computeEmployeeCustomerHistory(
  customerId: string,
  workOrders: WorkOrder[],
  timeReports: TimeReport[],
  options?: { lookbackDays?: number; excludeRowId?: string; now?: Date },
): Map<string, EmployeeCustomerHistory> {
  const lookbackDays = options?.lookbackDays ?? ASSIGN_HISTORY_LOOKBACK_DAYS;
  const nowMs = (options?.now ?? new Date()).getTime();
  const cutoff = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  const result = new Map<string, EmployeeCustomerHistory>();

  const bump = (id: string, dateIso: string | null) => {
    if (!id) return;
    const existing = result.get(id) ?? { count: 0, lastVisitDate: null };
    existing.count += 1;
    if (dateIso && (existing.lastVisitDate === null || dateIso > existing.lastVisitDate)) {
      existing.lastVisitDate = dateIso;
    }
    result.set(id, existing);
  };

  const customerOrderIds = new Set(
    workOrders.filter((w) => w.customerId === customerId).map((w) => w.id),
  );

  // Actual execution — each submitted time report by an employee on this
  // customer's work counts as one visit, regardless of which service it was.
  for (const r of timeReports) {
    if (!r.employeeId || !customerOrderIds.has(r.workOrderId)) continue;
    const t = Date.parse(r.submittedAt);
    if (Number.isFinite(t) && t >= cutoff) bump(r.employeeId, takeDateOnly(r.submittedAt));
  }

  // Planned/assigned work on the customer's service rows.
  for (const w of workOrders) {
    if (w.customerId !== customerId) continue;
    for (const row of w.serviceRows ?? []) {
      if (options?.excludeRowId && row.id === options.excludeRowId) continue;
      const ids = row.assignedEmployeeIds ?? [];
      if (ids.length === 0) continue;
      const t = row.serviceDate ? Date.parse(row.serviceDate) : NaN;
      if (Number.isFinite(t) && t >= cutoff) {
        for (const id of ids) bump(id, takeDateOnly(row.serviceDate));
      }
    }
  }

  return result;
}

/** The kind of star to surface next to a suggested employee. */
export type AssignSuggestionStar = "last" | "frequent" | "previous" | null;

/** One ranked employee suggestion for the assign dialog. */
export interface AssignSuggestion {
  employee: Employee;
  /** Currently selected/assigned in the in-progress edit. */
  isAssigned: boolean;
  /** Reliable history for this customer, or null when there is none. */
  history: EmployeeCustomerHistory | null;
  /** Star to render, or null when there is no reliable history. */
  star: AssignSuggestionStar;
  /** Human label, e.g. "Previously worked here 8 times · Last visit: 2026-06-02". */
  historyLabel: string | null;
}

function buildHistoryLabel(history: EmployeeCustomerHistory): string {
  const times = `${history.count} time${history.count === 1 ? "" : "s"}`;
  const base = `Previously worked here ${times}`;
  return history.lastVisitDate ? `${base} · Last visit: ${history.lastVisitDate}` : base;
}

/**
 * Turns a candidate employee pool + customer history into ranked suggestions.
 *
 * SORTING (the rule that matters):
 *  1. currently assigned employees,
 *  2. employees with customer history (most visits, then most recent),
 *  3. other employees (alphabetical).
 *
 * STAR (only when reliable history exists — never guessed):
 *  - "last"     → matched the single most-recent visit date across the pool,
 *  - "frequent" → visits ≥ {@link FREQUENT_VISIT_THRESHOLD},
 *  - "previous" → any prior visit.
 *
 * This is a SUGGESTION only: it never changes the selection — `isAssigned`
 * simply reflects the caller's current `selectedIds`. Pure.
 */
export function buildAssignSuggestions(params: {
  employees: Employee[];
  history: Map<string, EmployeeCustomerHistory>;
  selectedIds: string[];
}): AssignSuggestion[] {
  const { employees, history, selectedIds } = params;
  const selected = new Set(selectedIds);

  // The single most-recent visit date across everyone who has history — the
  // anchor for the "last assigned employee" star.
  let mostRecent: string | null = null;
  for (const h of history.values()) {
    if (h.count > 0 && h.lastVisitDate && (mostRecent === null || h.lastVisitDate > mostRecent)) {
      mostRecent = h.lastVisitDate;
    }
  }

  const suggestions: AssignSuggestion[] = employees.map((employee) => {
    const raw = history.get(employee.id);
    const hist = raw && raw.count > 0 ? raw : null;
    let star: AssignSuggestionStar = null;
    if (hist) {
      if (mostRecent && hist.lastVisitDate === mostRecent) star = "last";
      else if (hist.count >= FREQUENT_VISIT_THRESHOLD) star = "frequent";
      else star = "previous";
    }
    return {
      employee,
      isAssigned: selected.has(employee.id),
      history: hist,
      star,
      historyLabel: hist ? buildHistoryLabel(hist) : null,
    };
  });

  suggestions.sort((a, b) => {
    if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
    const aHas = a.history !== null;
    const bHas = b.history !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      const aH = a.history as EmployeeCustomerHistory;
      const bH = b.history as EmployeeCustomerHistory;
      if (aH.count !== bH.count) return bH.count - aH.count;
      const aDate = aH.lastVisitDate ?? "";
      const bDate = bH.lastVisitDate ?? "";
      if (aDate !== bDate) return aDate < bDate ? 1 : -1;
    }
    return a.employee.name.localeCompare(b.employee.name);
  });

  return suggestions;
}

/** Result of toggling one employee in the assign dialog. */
export interface AssignToggleResult {
  selectedIds: string[];
  openSlots: number;
}

/**
 * Safely toggles a single employee, preserving the booking's total required
 * staffing so the planner can never accidentally reduce it just by unchecking:
 *  - REMOVING an employee converts that position into one open slot (+1),
 *  - ADDING an employee fills an existing open slot when one is available (−1),
 *    otherwise it adds genuinely extra staff (open slots unchanged).
 *
 * Open slots are clamped at zero. Pure — returns the next selection + slots.
 */
export function applyAssignToggle(params: {
  selectedIds: string[];
  openSlots: number;
  employeeId: string;
}): AssignToggleResult {
  const { selectedIds, employeeId } = params;
  const openSlots = Math.max(0, params.openSlots);
  if (selectedIds.includes(employeeId)) {
    return {
      selectedIds: selectedIds.filter((id) => id !== employeeId),
      openSlots: openSlots + 1,
    };
  }
  return {
    selectedIds: [...selectedIds, employeeId],
    openSlots: openSlots > 0 ? openSlots - 1 : 0,
  };
}

/**
 * What should happen to a removed employee's workload when they are taken off a
 * staffed booking:
 *  - "keep_open_slot"     → the position becomes an open slot; required staff (and
 *    therefore total labour) is unchanged — someone else still needs assigning.
 *  - "redistribute"       → required staff drops by one and NO open slot is created;
 *    the removed person's labour is absorbed by the remaining crew, so the total
 *    job time is PRESERVED (pinned) while per-employee planned hours rise.
 *  - "reduce_requirement" → the booking genuinely needs fewer people; required
 *    staff drops by one, NO open slot is created, and any pinned total labour is
 *    CLEARED so labour scales naturally back down with the smaller crew. This is
 *    the correct intent when an extra employee was added and is being removed.
 */
export type RemovalIntent = "keep_open_slot" | "redistribute" | "reduce_requirement";

/** Inputs needed to resolve an employee removal from a staffed booking. Pure. */
export interface ResolveRemovalParams {
  /** Assigned employees BEFORE the removal. */
  assignedIdsBefore: string[];
  /** Open slots BEFORE the removal. */
  openSlotsBefore: number;
  /** The employee being removed (must be in {@link assignedIdsBefore}). */
  removedEmployeeId: string;
  /** Whether to keep the requirement (open slot) or redistribute the workload. */
  intent: RemovalIntent;
  /** Visit window minutes, used to compute the labour to preserve. */
  visitMinutes: number | null;
  /** Any existing pinned total labour on the row (preserved across the change). */
  totalLabourMinutesOverride?: number | null;
}

/** Outcome of resolving an employee removal. Pure — never mutates. */
export interface ResolveRemovalResult {
  /** Assigned employees AFTER the removal. */
  assignedEmployeeIds: string[];
  /** Open slots AFTER the removal. */
  openSlots: number;
  /**
   * Total labour minutes to persist: a pinned value for a redistribute (so the
   * total job time is preserved), or null to leave it scaling with headcount.
   */
  totalLabourMinutesOverride: number | null;
  /** Per-employee planned minutes after the change (null when unknown). */
  perEmployeeMinutes: number | null;
  /**
   * True when a "redistribute" was requested but no employees would remain — the
   * caller must NOT apply it (redistribution needs at least one person to carry
   * the workload). "keep_open_slot" is never blocked.
   */
  blocked: boolean;
}

/**
 * Computes the total planned labour minutes of a booking BEFORE a change, used
 * as the value to pin when redistributing. Prefers an existing override (the
 * job time was already pinned), otherwise scales the visit window by the planned
 * headcount (assigned + open slots) — the same definition the labour calculator
 * uses. Returns null when the visit window is unknown. Pure.
 */
export function computePreservedLabourMinutes(params: {
  visitMinutes: number | null;
  assignedCount: number;
  openSlots: number;
  totalLabourMinutesOverride?: number | null;
}): number | null {
  const existing = params.totalLabourMinutesOverride;
  if (typeof existing === "number" && Number.isFinite(existing) && existing > 0) {
    return existing;
  }
  if (params.visitMinutes == null || params.visitMinutes <= 0) return null;
  const headcount = Math.max(0, params.assignedCount) + Math.max(0, params.openSlots);
  if (headcount <= 0) return null;
  return params.visitMinutes * headcount;
}

/**
 * Resolves an employee removal according to the chosen {@link RemovalIntent},
 * preserving the booking's total job time in both branches:
 *  - KEEP_OPEN_SLOT: remaining employees + one extra open slot; required staff
 *    and labour are unchanged (default headcount scaling still applies, so the
 *    override is left as-is).
 *  - REDISTRIBUTE: remaining employees, no new open slot, required staff drops;
 *    total labour is pinned to its pre-removal value so the remaining crew
 *    absorbs the workload (per-employee minutes rise). Blocked when nobody would
 *    remain — redistribution needs someone to carry the work.
 *
 * Pure — returns the next staffing + labour; never mutates or persists.
 */
export function resolveEmployeeRemoval(params: ResolveRemovalParams): ResolveRemovalResult {
  const before = Array.isArray(params.assignedIdsBefore) ? params.assignedIdsBefore : [];
  const openSlotsBefore = Math.max(0, params.openSlotsBefore);
  const existingOverride =
    typeof params.totalLabourMinutesOverride === "number" &&
    Number.isFinite(params.totalLabourMinutesOverride) &&
    params.totalLabourMinutesOverride > 0
      ? params.totalLabourMinutesOverride
      : null;
  const remaining = before.filter((id) => id !== params.removedEmployeeId);

  if (params.intent === "redistribute") {
    // Redistribution needs at least one person to carry the freed-up workload.
    if (remaining.length === 0) {
      return {
        assignedEmployeeIds: before,
        openSlots: openSlotsBefore,
        totalLabourMinutesOverride: existingOverride,
        perEmployeeMinutes: null,
        blocked: true,
      };
    }
    const preserved = computePreservedLabourMinutes({
      visitMinutes: params.visitMinutes,
      assignedCount: before.length,
      openSlots: openSlotsBefore,
      totalLabourMinutesOverride: existingOverride,
    });
    return {
      assignedEmployeeIds: remaining,
      openSlots: openSlotsBefore,
      totalLabourMinutesOverride: preserved,
      perEmployeeMinutes: preserved != null ? Math.round(preserved / remaining.length) : null,
      blocked: false,
    };
  }

  if (params.intent === "reduce_requirement") {
    // The booking needs fewer people: drop the requirement, add no open slot,
    // and CLEAR any pinned total labour so labour scales naturally with the
    // smaller crew (e.g. removing an extra person returns labour to normal).
    return {
      assignedEmployeeIds: remaining,
      openSlots: openSlotsBefore,
      totalLabourMinutesOverride: null,
      perEmployeeMinutes: params.visitMinutes,
      blocked: false,
    };
  }

  // keep_open_slot: the position becomes an open slot, required staff unchanged.
  return {
    assignedEmployeeIds: remaining,
    openSlots: openSlotsBefore + 1,
    totalLabourMinutesOverride: existingOverride,
    perEmployeeMinutes: params.visitMinutes,
    blocked: false,
  };
}

/**
 * What should happen to a booking's labour when an OPEN (unassigned) slot is
 * removed while assigned employees remain — the slot represented real planned
 * work, so its labour must be resolved rather than silently dropped:
 *  - "reduce_requirement" → the slot was no longer needed: required staffing
 *    drops by one, any pinned total labour is CLEARED so labour scales naturally
 *    back down with the smaller crew, and the visit window is UNCHANGED.
 *  - "absorb"             → the work still needs doing, by the remaining crew:
 *    required staffing drops by one, total labour is PRESERVED, and the visit
 *    window is EXTENDED so the remaining people carry the same total job time
 *    (e.g. 08:00–09:00 with 1 assigned + 1 open slot → 08:00–10:00 with 1
 *    assigned). When required staffing falls but labour is preserved, the
 *    scheduled duration must grow — that is the whole point of this intent.
 */
export type OpenSlotRemovalIntent = "reduce_requirement" | "absorb";

/** Inputs needed to resolve removing one open slot from a staffed booking. Pure. */
export interface ResolveOpenSlotRemovalParams {
  /** Assigned employees on the booking (unchanged by an open-slot removal). */
  assignedCount: number;
  /** Open slots BEFORE the removal (must be ≥ 1). */
  openSlotsBefore: number;
  /** Visit (wall-clock) window minutes, used to compute the labour to preserve. */
  visitMinutes: number | null;
  /** Planned start "HH:MM", needed to compute the extended end time for absorb. */
  plannedStartTime?: string | null;
  /** Any existing pinned total labour on the row/occurrence. */
  totalLabourMinutesOverride?: number | null;
  /** Whether the requirement reduces, or the remaining crew absorbs the work. */
  intent: OpenSlotRemovalIntent;
}

/** Outcome of resolving an open-slot removal. Pure — never mutates. */
export interface ResolveOpenSlotRemovalResult {
  /** Open slots AFTER the removal (openSlotsBefore − 1, clamped at 0). */
  openSlots: number;
  /**
   * Total labour to persist. Always null here: both intents let labour follow
   * the (extended, for absorb) visit window × headcount, so no pin is needed —
   * and any prior pin is cleared.
   */
  totalLabourMinutesOverride: number | null;
  /**
   * Extended planned end "HH:MM" when the duration grew to absorb the work, or
   * null when the window is unchanged (reduce_requirement, or a blocked absorb).
   */
  plannedEndTime: string | null;
  /** Visit window minutes after the change (extended for absorb), for display. */
  visitMinutes: number | null;
  /**
   * True when "absorb" was requested but cannot be applied — there is no crew to
   * absorb the work (0 assigned), the visit window/start is unknown, or the
   * extended window would run past midnight. The caller must NOT apply it.
   */
  blocked: boolean;
}

function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClockMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Resolves removing ONE open slot from a booking that still has assigned
 * employees, according to the chosen {@link OpenSlotRemovalIntent}:
 *  - REDUCE_REQUIREMENT: drop one open slot, clear any pinned labour; the visit
 *    window is untouched so total labour scales down with the smaller crew.
 *  - ABSORB: drop one open slot but PRESERVE total labour by extending the visit
 *    window so the remaining headcount (assigned + remaining slots) carries the
 *    same total job time. The new window = preservedLabour ÷ new headcount, and
 *    the end time slides out from the planned start. Blocked when there is no
 *    assigned crew, the window/start is unknown, or the end would cross midnight.
 *
 * Pure — returns the next staffing/labour/time; never mutates or persists.
 */
export function resolveOpenSlotRemoval(
  params: ResolveOpenSlotRemovalParams,
): ResolveOpenSlotRemovalResult {
  const openSlotsBefore = Math.max(0, Math.floor(params.openSlotsBefore) || 0);
  const assignedCount = Math.max(0, Math.floor(params.assignedCount) || 0);
  const nextOpenSlots = Math.max(0, openSlotsBefore - 1);
  const currentVisit =
    params.visitMinutes != null && Number.isFinite(params.visitMinutes) && params.visitMinutes > 0
      ? params.visitMinutes
      : null;

  if (params.intent === "reduce_requirement") {
    return {
      openSlots: nextOpenSlots,
      totalLabourMinutesOverride: null,
      plannedEndTime: null,
      visitMinutes: currentVisit,
      blocked: false,
    };
  }

  // absorb: keep total labour, extend the window so the remaining crew carries it.
  const newHeadcount = assignedCount + nextOpenSlots;
  const preserved = computePreservedLabourMinutes({
    visitMinutes: params.visitMinutes,
    assignedCount,
    openSlots: openSlotsBefore,
    totalLabourMinutesOverride: params.totalLabourMinutesOverride,
  });
  const start = parseClockMinutes(params.plannedStartTime);
  if (assignedCount < 1 || newHeadcount < 1 || preserved == null || start == null) {
    return {
      openSlots: nextOpenSlots,
      totalLabourMinutesOverride: null,
      plannedEndTime: null,
      visitMinutes: currentVisit,
      blocked: true,
    };
  }
  const newWindow = Math.max(1, Math.round(preserved / newHeadcount));
  const endMinutes = start + newWindow;
  // The model has no concept of a booking crossing midnight; refuse rather than
  // emit an invalid "24:30" end time.
  if (endMinutes > 23 * 60 + 59) {
    return {
      openSlots: nextOpenSlots,
      totalLabourMinutesOverride: null,
      plannedEndTime: null,
      visitMinutes: currentVisit,
      blocked: true,
    };
  }
  return {
    openSlots: nextOpenSlots,
    totalLabourMinutesOverride: null,
    plannedEndTime: formatClockMinutes(endMinutes),
    visitMinutes: newWindow,
    blocked: false,
  };
}

/**
 * Decides whether removing ONE open (unassigned) slot should prompt for an
 * intent ({@link OpenSlotRemovalIntent}) instead of decrementing silently. The
 * prompt is only meaningful when the slot represented real planned work that the
 * remaining crew could either shed (reduce) or absorb (extend the window) — i.e.
 * there is a slot to remove AND at least one assigned employee remains. With no
 * assigned crew there is nobody to absorb the work, so reducing the requirement
 * is the only sensible outcome and the slot is simply decremented. Pure.
 */
export function shouldPromptOpenSlotRemoval(params: {
  assignedCount: number;
  openSlots: number;
}): boolean {
  return Math.max(0, params.openSlots) >= 1 && Math.max(0, params.assignedCount) >= 1;
}

/** Outcome of checking whether a staffing edit can be saved yet. Pure. */
export interface StaffingSaveGate {
  /** True when an unresolved staffing prompt must be answered before saving. */
  blocked: boolean;
  /** Human reason to surface when blocked, or null when the save may proceed. */
  reason: string | null;
}

/**
 * Decides whether a staffing edit may be saved, given any pending intent prompt.
 * Both an unresolved ASSIGNED-employee removal and an unresolved OPEN-slot removal
 * have no safe default (reduce vs. redistribute/absorb change labour very
 * differently), so each must be resolved before saving. An assigned-employee
 * removal is checked first to match the dialog's evaluation order. A pending
 * ADDITION is NOT a blocker — it already defaults to the recommended "split" — so
 * it is intentionally not considered here. Pure.
 */
export function resolveStaffingSaveGate(params: {
  pendingRemoval: boolean;
  pendingSlotRemoval: boolean;
}): StaffingSaveGate {
  if (params.pendingRemoval) {
    return {
      blocked: true,
      reason: "Choose what should happen with the workload before saving.",
    };
  }
  if (params.pendingSlotRemoval) {
    return {
      blocked: true,
      reason: "Choose what should happen with the open slot's work before saving.",
    };
  }
  return { blocked: false, reason: null };
}

/**
 * Decides whether removing an ASSIGNED employee should prompt for a removal
 * intent (keep an open slot / reduce the requirement / redistribute the work).
 * The prompt is only meaningful when at least one OTHER assigned employee would
 * remain, so the dispatcher genuinely has to choose what happens to the freed-up
 * workload. Removing the SOLE assigned employee has just one sensible outcome —
 * the position becomes an open slot (the booking turns into an open staffing
 * need) — so it never prompts and the original employee is always removable.
 * Pure.
 */
export function shouldPromptRemovalIntent(params: { assignedCountBefore: number }): boolean {
  return Math.max(0, params.assignedCountBefore) > 1;
}

/**
 * Reverses an employee addition: removes the employee WITHOUT converting their
 * position into an open slot. Adding extra staff never lowered the open-slot
 * count below its genuine level, so undoing that add must not invent one — the
 * required staffing simply returns to where it was before the person was added.
 *
 * Use this when the dispatcher removes someone they only just added (an undo),
 * as opposed to {@link resolveEmployeeRemoval} which is for intentful removal of
 * established staff. Open slots are clamped at zero. Pure.
 */
export function undoEmployeeAddition(params: {
  selectedIds: string[];
  openSlots: number;
  employeeId: string;
}): AssignToggleResult {
  return {
    selectedIds: params.selectedIds.filter((id) => id !== params.employeeId),
    openSlots: Math.max(0, params.openSlots),
  };
}

/**
 * What should happen to a booking's total labour when an EXTRA employee is added
 * to an already-staffed booking:
 *  - "split"    → the customer's total cleaning time does NOT change; the same
 *    total job labour is preserved (pinned) and divided across the now-larger
 *    crew, so per-employee planned hours drop. This is the default — adding a
 *    helper must never silently increase the customer's booked work.
 *  - "increase" → the booking genuinely gets more work; any pinned total labour
 *    is CLEARED so labour scales naturally with the new headcount (each employee
 *    keeps the full visit window).
 */
export type AdditionIntent = "split" | "increase";

/** Inputs needed to resolve an EXTRA employee addition. Pure. */
export interface ResolveAdditionParams {
  /** Assigned employee count AFTER the addition (includes the new person). */
  assignedCountAfter: number;
  /** Assigned employee count BEFORE the addition. */
  assignedCountBefore: number;
  /** Open slots BEFORE the addition (unchanged for an extra add). */
  openSlotsBefore: number;
  /** Visit (wall-clock) window minutes, used to compute the labour to preserve. */
  visitMinutes: number | null;
  /** Any pinned total labour on the row BEFORE the addition. */
  totalLabourMinutesOverride?: number | null;
  /** Whether the same work is split, or total labour grows. */
  intent: AdditionIntent;
}

/** Outcome of resolving an employee addition. Pure — never mutates. */
export interface ResolveAdditionResult {
  /**
   * Total labour minutes to persist: a pinned value for a "split" (so the
   * customer's total job time is preserved across the bigger crew), or null for
   * an "increase" so labour scales naturally with headcount.
   */
  totalLabourMinutesOverride: number | null;
  /** Per-employee planned minutes after the change (null when unknown). */
  perEmployeeMinutes: number | null;
}

/**
 * Decides whether adding an employee should prompt for split-vs-increase intent.
 * Only an EXTRA add to an already-staffed booking is ambiguous: there is no open
 * slot to fill (so this is genuinely extra staff) and at least one employee is
 * already assigned (so total labour would otherwise silently double). Filling an
 * open slot, or making the first assignment, never changes total required labour
 * and so never prompts. Pure.
 */
export function shouldPromptAdditionIntent(params: {
  assignedCountBefore: number;
  openSlotsBefore: number;
}): boolean {
  return (
    Math.max(0, params.assignedCountBefore) >= 1 && Math.max(0, params.openSlotsBefore) === 0
  );
}

/**
 * Resolves an EXTRA employee addition according to the chosen {@link AdditionIntent}:
 *  - SPLIT: preserve the total job time from before the add (an existing pin, or
 *    the visit window scaled by the pre-add headcount) and divide it across the
 *    now-larger crew. Per-employee minutes drop; the customer's booked work is
 *    unchanged.
 *  - INCREASE: clear any pin so labour scales with the new headcount — each
 *    employee keeps the full visit window.
 *
 * Pure — returns the next labour; never mutates or persists.
 */
export function resolveEmployeeAddition(params: ResolveAdditionParams): ResolveAdditionResult {
  if (params.intent === "increase") {
    return {
      totalLabourMinutesOverride: null,
      perEmployeeMinutes: params.visitMinutes,
    };
  }
  // split: preserve the pre-add total labour, divided across the larger crew.
  const preserved = computePreservedLabourMinutes({
    visitMinutes: params.visitMinutes,
    assignedCount: params.assignedCountBefore,
    openSlots: params.openSlotsBefore,
    totalLabourMinutesOverride: params.totalLabourMinutesOverride,
  });
  const assignedAfter = Math.max(1, params.assignedCountAfter);
  return {
    totalLabourMinutesOverride: preserved,
    perEmployeeMinutes:
      preserved != null ? Math.round(preserved / assignedAfter) : params.visitMinutes,
  };
}

/** A non-blocking staffing concern that needs confirmation before saving. */
export type StaffingWarning = "reducing" | "increasing" | "exceeds";

/** Outcome of validating a proposed staffing change before persisting. */
export interface StaffingValidationResult {
  /** True when the change must NOT be saved as-is (nobody required). */
  blocked: boolean;
  /** Open-slot value to apply when blocked — always ≥ 1 (force one open slot). */
  correctedOpenSlots: number;
  /** Concerns requiring explicit confirmation (empty when none). */
  warnings: StaffingWarning[];
  previousRequiredStaff: number;
  nextRequiredStaff: number;
}

/**
 * Validates a proposed staffing change against the booking's previous staffing.
 *
 * Required staff = assigned employees + open slots. Rules:
 *  - BLOCK when the result requires nobody (0 employees + 0 open slots); the
 *    caller should force at least one open slot ({@link correctedOpenSlots}).
 *  - WARN "reducing" when total required staff drops,
 *  - WARN "increasing" when total required staff grows,
 *  - WARN "exceeds" when assigned employees now exceed the previously required
 *    staff (required staffing rises to match the assigned count).
 *
 * When {@link params.additionIntentResolved} is true, the dispatcher has already
 * made an explicit split-vs-increase choice for the added staff via the assign
 * dialog. In that case the headcount-based "increasing"/"exceeds" concerns are
 * already accounted for and must NOT surface a contradictory second confirmation
 * — UNLESS the change also raised the number of open slots, which is a genuine
 * new open staffing need worth confirming. "reducing" is always evaluated.
 *
 * Pure — computes only; never mutates.
 */
export function validateStaffingChange(params: {
  previousAssignedCount: number;
  previousOpenSlots: number;
  nextAssignedCount: number;
  nextOpenSlots: number;
  /**
   * True when the added staffing was resolved through an explicit add-intent
   * choice (split/increase) in the assign dialog. Suppresses the
   * "increasing"/"exceeds" warnings unless open slots also rose.
   */
  additionIntentResolved?: boolean;
}): StaffingValidationResult {
  const prevReq = Math.max(0, params.previousAssignedCount) + Math.max(0, params.previousOpenSlots);
  const prevOpen = Math.max(0, params.previousOpenSlots);
  const nextAssigned = Math.max(0, params.nextAssignedCount);
  const nextOpen = Math.max(0, params.nextOpenSlots);
  const nextReq = nextAssigned + nextOpen;

  const blocked = nextAssigned === 0 && nextOpen === 0;
  const warnings: StaffingWarning[] = [];
  if (!blocked) {
    if (nextReq < prevReq) warnings.push("reducing");
    // An explicit add-intent choice already settled what happens to labour, so
    // skip the headcount concerns unless the dispatcher also created a real new
    // open staffing need (more open slots than before).
    const suppressAddWarnings = params.additionIntentResolved === true && nextOpen <= prevOpen;
    if (!suppressAddWarnings) {
      if (nextReq > prevReq) warnings.push("increasing");
      if (nextAssigned > prevReq) warnings.push("exceeds");
    }
  }

  return {
    blocked,
    correctedOpenSlots: blocked ? 1 : nextOpen,
    warnings,
    previousRequiredStaff: prevReq,
    nextRequiredStaff: blocked ? 1 : nextReq,
  };
}

/** Outcome of resolving the initial staffing for a NEW service row. */
export interface CreateStaffingResult {
  /** Assigned employees to persist (unchanged from input). */
  assignedEmployeeIds: string[];
  /** Open/unassigned slots to persist — never leaves the row requiring nobody. */
  openSlots: number;
  /** Total required staff = assigned + open slots (always ≥ 1). */
  requiredStaff: number;
  /** True when an open slot was auto-added because nothing was staffed. */
  corrected: boolean;
}

/**
 * Resolves the staffing to persist when CREATING a service row (Add-row form,
 * clone, etc.). A booking must never silently require nobody, so when no
 * employee is selected and no open slot is set, one open slot is added
 * automatically ({@link corrected} = true). Mirrors the block-on-nobody rule in
 * {@link validateStaffingChange}, but auto-corrects rather than rejecting since
 * there is no prior staffing to fall back to. Pure.
 */
export function resolveCreateStaffing(params: {
  assignedEmployeeIds: string[];
  openSlots: number;
}): CreateStaffingResult {
  const assigned = Array.isArray(params.assignedEmployeeIds) ? params.assignedEmployeeIds : [];
  const requestedSlots = Math.max(0, Math.floor(params.openSlots) || 0);
  const corrected = assigned.length === 0 && requestedSlots === 0;
  const openSlots = corrected ? 1 : requestedSlots;
  return {
    assignedEmployeeIds: assigned,
    openSlots,
    requiredStaff: assigned.length + openSlots,
    corrected,
  };
}

/** How a recurring variation's staffing compares to its base service row. */
export interface VariationStaffingComparison {
  /** Required staff on the base row (assigned + open slots). */
  baseRequiredStaff: number;
  /** Resolved required staff once the variation is applied. */
  variationRequiredStaff: number;
  /** Resolved assigned employee count after the variation. */
  variationAssignedCount: number;
  /** Resolved open slots after the variation (base slots + delta, ≥ 0). */
  variationOpenSlots: number;
  /** True when the variation changes required staffing at all. */
  differs: boolean;
  /** True when the variation lowers required staffing below the base. */
  reduces: boolean;
  /** True when the variation raises required staffing above the base. */
  increases: boolean;
}

/**
 * Compares a recurring variation's resolved staffing against its base service
 * row, mirroring {@link import("@/lib/variationResolver").resolveOccurrenceVariations}:
 * an absolute `assignedEmployeeIds` override replaces the base assignment, and
 * `unassignedSlotsDelta` adds to the base open slots (clamped at zero).
 *
 * Used to surface a clear difference banner and a "reduces staffing" warning so
 * a variation can never silently drop required staffing. Pure.
 */
export function compareVariationStaffing(params: {
  baseAssignedIds: string[];
  baseOpenSlots: number;
  /** Absolute override; undefined keeps the base assignment. */
  variationAssignedIds?: string[];
  /** Additive change to base open slots; undefined means no change. */
  unassignedSlotsDelta?: number;
}): VariationStaffingComparison {
  const baseAssigned = Array.isArray(params.baseAssignedIds) ? params.baseAssignedIds.length : 0;
  const baseOpen = Math.max(0, Math.floor(params.baseOpenSlots) || 0);
  const baseRequiredStaff = baseAssigned + baseOpen;

  const variationAssignedCount = params.variationAssignedIds
    ? params.variationAssignedIds.length
    : baseAssigned;
  const delta = Number.isFinite(params.unassignedSlotsDelta)
    ? (params.unassignedSlotsDelta as number)
    : 0;
  const variationOpenSlots = Math.max(0, baseOpen + delta);
  const variationRequiredStaff = variationAssignedCount + variationOpenSlots;

  return {
    baseRequiredStaff,
    variationRequiredStaff,
    variationAssignedCount,
    variationOpenSlots,
    differs: variationRequiredStaff !== baseRequiredStaff,
    reduces: variationRequiredStaff < baseRequiredStaff,
    increases: variationRequiredStaff > baseRequiredStaff,
  };
}
