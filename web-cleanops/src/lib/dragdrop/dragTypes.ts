/**
 * Universal Schedule drag engine — pure type vocabulary.
 *
 * The engine has three layers, each a pure function that consumes the layer
 * above's output:
 *
 *   gesture (DragSource + DropTarget)
 *     → evaluateDragAction → DragEvaluation (DragAction | a blocked reason)
 *     → resolveDragScope   → DragScopeResolution (how far the change reaches)
 *     → planDragWrite      → DragWrite (the persistence intent)
 *     → applyDragWrite     → routes to the existing context writers
 *
 * A `DragAction` describes *what physically changed* (employee / date / time),
 * a `DragScope` describes *how far the change reaches* (this occurrence / from
 * here forward / whole series), and a `DragWrite` is the resolved persistence
 * intent that the routing adapter turns into a single context call.
 *
 * Phase 2 only ever produces an `employee` delta at `occurrence` (recurring) or
 * `series` (one-time) scope — exactly Phase 1's behaviour. The date/time deltas
 * and the wider scopes are typed here so later phases slot in without reshaping
 * the engine.
 */

/** The occurrence/source facts a drag gesture starts from. */
export interface DragSource {
  /** `parentServiceRowId:occurrenceDate` — the stable occurrence identity. */
  occurrenceKey: string;
  /** The base service row the occurrence belongs to. */
  parentServiceRowId: string;
  /** The work order owning the service row (for the one-time write path). */
  workOrderId: string;
  /** Whether the occurrence belongs to a recurring series. */
  isRecurring: boolean;
  /**
   * The employee row dragged FROM, or null when dragged out of the Unassigned /
   * open-slots row (a slot-fill rather than a reassignment).
   */
  sourceEmployeeId: string | null;
  /** The display date "YYYY-MM-DD" of the dragged card. */
  sourceDate: string;
  /**
   * The occurrence's currently resolved start time "HH:mm" (after any reschedule
   * overlay), or null. Carried so a date move can PRESERVE the exact window —
   * Phase 3A never changes the time, only the day.
   */
  startTime: string | null;
  /** The occurrence's currently resolved end time "HH:mm" (after overlay), or null. */
  endTime: string | null;
  /** Employees currently assigned to the occurrence. */
  assignedEmployeeIds: string[];
  /** Open staffing slots on the occurrence (non-negative). */
  openSlotCount: number;
  /** Resolved total labour minutes for the occurrence (or null). */
  labourMinutes: number | null;
  /** True when the occurrence carries a pinned/redistributed total labour. */
  isLabourRedistributed: boolean;
}

/**
 * Where a card was dropped. An employee-row drop sets `employeeId`; a drop onto
 * the Unassigned / open-slots row sets `unassigned: true` (which removes the
 * source employee and opens a staffing slot). `startTime` is reserved for the
 * Phase 3 time grid so a time drag can target a slot without reshaping this type.
 */
export interface DropTarget {
  /** The target employee row id; omitted when dropping on the Unassigned row. */
  employeeId?: string;
  /** True when dropped onto the Unassigned / open-slots row (Employee → Unassigned). */
  unassigned?: boolean;
  /** The target column date "YYYY-MM-DD". */
  date: string;
  /** Reserved for Phase 3 time-grid drops ("HH:mm"). */
  startTime?: string;
}

/** A single employee field change produced by a gesture. */
export type EmployeeDelta =
  | { kind: "reassign"; from: string; to: string }
  | { kind: "fill_slot"; to: string }
  /** Remove the source employee and convert the seat into an open staffing slot. */
  | { kind: "unassign"; from: string };

/**
 * What the gesture physically did — independent of how it persists. One or more
 * field deltas; Phase 2 only ever populates `employee`.
 */
export interface DragAction {
  occurrenceKey: string;
  parentServiceRowId: string;
  workOrderId: string;
  isRecurring: boolean;
  deltas: {
    employee?: EmployeeDelta;
    /**
     * Phase 3A — drag to a different date. Carries the window to PRESERVE
     * (`startTime`/`endTime`) so the move keeps the exact same time, duration and
     * total labour; only the day changes.
     */
    date?: { from: string; to: string; startTime: string | null; endTime: string | null };
    /** Phase 3B — drag to a different start time. */
    time?: { startFrom: string; startTo: string; durationMinutes: number };
  };
}

/** Why a gesture produced no actionable change. */
export type DragBlockReason = "invalid" | "blocked_multi" | "no_change";

/** The result of interpreting a gesture into an action (or a blocked reason). */
export type DragEvaluation =
  | { ok: true; action: DragAction }
  | { ok: false; reason: DragBlockReason };

/** How far a change reaches into a (possibly recurring) booking. */
export type DragScope = "occurrence" | "from_here_forward" | "series";

/** The scope an action resolves to, plus what the UI may offer. */
export interface DragScopeResolution {
  /** The scope this drag will write at. */
  scope: DragScope;
  /** Whether the UI should prompt the dispatcher to pick a scope. */
  prompt: boolean;
  /** The scopes the UI may offer (Phase 2 always a single locked scope). */
  allowedScopes: DragScope[];
}

/** The staffing payload a confirmed drop persists (duration/labour preserved). */
export interface DragStaffingWrite {
  assignedEmployeeIds: string[];
  unassignedEmployeeSlots: number;
  totalLabourMinutes: number | null;
}

/** The resolved persistence intent — `applyDragWrite` turns this into one call. */
export interface DragWrite {
  scope: DragScope;
  occurrenceKey: string;
  parentServiceRowId: string;
  workOrderId: string;
  /** Present only for staffing (employee) changes. */
  staffing?: DragStaffingWrite;
  /** Present only for date/time changes (Phase 3). */
  schedule?: { date?: string; startTime?: string; endTime?: string };
}
