import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, ExternalLink, Minus, Plus, RotateCcw, Star, UserMinus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { calculatePlannedDurationMinutes, occurrenceExceptionHasStaffingOverride } from "@/types";
import {
  applyAssignToggle,
  buildAssignSuggestions,
  computeEmployeeCustomerHistory,
  resolveEmployeeAddition,
  resolveEmployeeRemoval,
  resolveOpenSlotRemoval,
  resolveStaffingSaveGate,
  shouldPromptAdditionIntent,
  shouldPromptOpenSlotRemoval,
  shouldPromptRemovalIntent,
  undoEmployeeAddition,
  validateStaffingChange,
  type AdditionIntent,
  type AssignSuggestion,
  type OpenSlotRemovalIntent,
  type StaffingWarning,
} from "@/lib/employeeAssignment";

/** Formats a minute count as a compact hours label, e.g. 240 → "4h", 90 → "1.5h". */
function formatHours(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** Tooltip copy for the prior-experience star, by suggestion kind. */
const STAR_LABEL: Record<"last" | "frequent" | "previous", string> = {
  last: "Last assigned employee for this customer",
  frequent: "Frequently used for this customer",
  previous: "Previously assigned to this customer",
};

/** Confirmation copy for each staffing concern raised on save. */
const WARNING_TEXT: Record<StaffingWarning, string> = {
  reducing: "You are reducing the required staffing for this booking. Are you sure?",
  increasing:
    "You are increasing the required staffing for this booking. This may create an open staffing need.",
  exceeds:
    "You are assigning more employees than were previously required. The required staffing will increase to match.",
};

/**
 * Describes the work-order service row to be staffed. Every assignment surface
 * (Schedule board, Booking Queue, Work Order quick-assign) maps its own row
 * shape onto this so they all write the same authoritative fields through the
 * same validation/suggestion rules.
 */
export interface AssignDialogTarget {
  /** The work order that owns the service row. */
  workOrderId: string;
  /** The service row staffing is written to (the parent for occurrences). */
  serviceRowId: string;
  companyId: string;
  customerId: string;
  serviceName: string;
  customerName?: string;
  workOrderNumber?: string;
  /** Current assigned employees on the row/occurrence. */
  assignedEmployeeIds: string[];
  /** Current open/unassigned staffing slots. */
  openSlots: number;
  /** Visit (wall-clock) window in minutes, used for labour redistribution math. */
  visitMinutes?: number | null;
  /**
   * Resolved planned start "HH:MM" for this occurrence/row. Needed to compute an
   * extended end time when an open slot is removed and the remaining crew
   * absorbs the work (the visit window grows from this start).
   */
  plannedStartTime?: string | null;
  /** Resolved planned end "HH:MM" for this occurrence/row (display/fallback). */
  plannedEndTime?: string | null;
  /** Existing pinned total labour minutes on the row (a redistributed job). */
  totalLabourMinutesOverride?: number | null;
  /**
   * When set, the dialog edits a SINGLE occurrence via a per-occurrence
   * assignment exception instead of mutating the base service row. Surfaces that
   * act on one concrete occurrence (Schedule board card, Booking Queue row) pass
   * this; for a recurring series only that occurrence is reassigned, leaving the
   * series and every sibling untouched. One-time bookings still write the row.
   */
  occurrence?: {
    /** Stable occurrence identity `parentServiceRowId:occurrenceDate`. */
    occurrenceKey: string;
    /** True when the booking recurs, so a per-occurrence exception is the right target. */
    isRecurring: boolean;
    /**
     * The occurrence's current visible date "YYYY-MM-DD". Used to extend the
     * window in place (via the reschedule overlay) without moving the occurrence
     * off its current day. Falls back to the rule date from the key when absent.
     */
    displayDate?: string;
  };
}

interface AssignEmployeesDialogProps {
  /** The row to staff, or null when closed. */
  target: AssignDialogTarget | null;
  /** Called to close the dialog (cancel or after a successful save). */
  onClose: () => void;
  /** Optional hook invoked after a successful save. */
  onSaved?: () => void;
  /**
   * Optional handler to open the related work order. When provided, an "Open
   * work order" affordance is shown in the dialog header so the dispatcher can
   * inspect the work order without losing context.
   */
  onOpenWorkOrder?: (workOrderId: string) => void;
}

/**
 * Shared "Assign employees" dialog used by every staffing surface. It manages
 * assigned employees + open slots together (so unchecking never silently drops
 * staffing), surfaces ranked customer-history suggestions with stars, validates
 * the change before saving (block on nobody, confirm on reduce/increase/exceed),
 * and persists to the work-order service row via {@link updateWorkOrderServiceRow}.
 *
 * All rules come from {@link "@/lib/employeeAssignment"} — no surface re-implements
 * staffing logic, guaranteeing parity across the board, queue and work order.
 */
export function AssignEmployeesDialog({
  target,
  onClose,
  onSaved,
  onOpenWorkOrder,
}: AssignEmployeesDialogProps) {
  const { toast } = useToast();
  const {
    employees,
    workOrders,
    timeReports,
    updateWorkOrderServiceRow,
    reassignOccurrence,
    rescheduleOccurrence,
    clearOccurrenceAssignment,
    bookingOccurrenceExceptions,
  } = useApp();

  const [selection, setSelection] = useState<string[]>([]);
  const [slots, setSlots] = useState<number>(0);
  // The employees assigned when the dialog opened. Removing one of these is an
  // intentful change (prompt for keep-slot / redistribute / reduce); removing
  // someone added during THIS session is just an undo of the addition.
  const [baselineAssignedIds, setBaselineAssignedIds] = useState<Set<string>>(new Set());
  // Pinned total labour minutes (a redistributed job), or null to scale with
  // headcount. Set when the dispatcher removes someone and redistributes work.
  const [labourOverride, setLabourOverride] = useState<number | null>(null);
  // The assigned employee the dispatcher is removing, pending an intent choice
  // (keep an open slot vs. redistribute the workload). Null when not removing.
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null);
  // An EXTRA employee just added to an already-staffed booking, pending an intent
  // choice (split the existing work vs. increase total labour). Carries the
  // pre-add staffing so the choice always resolves from a clean baseline. Null
  // when not adding. Defaults to "split" until the dispatcher confirms.
  const [pendingAddition, setPendingAddition] = useState<{
    id: string;
    name: string;
    assignedBefore: number;
    slotsBefore: number;
    overrideBefore: number | null;
  } | null>(null);
  // Per-session record of how each added employee was added, so removing them
  // later behaves correctly: a "split" add is a plain undo (labour returns to
  // normal), while an "increase" add is intentful (prompt reduce/slot/redistribute).
  const [sessionAddIntent, setSessionAddIntent] = useState<Map<string, AdditionIntent>>(new Map());
  // Staffing snapshot captured when the dialog opened — validation compares the
  // in-progress edit against this to detect reduce/increase intent.
  const [original, setOriginal] = useState<{ assigned: number; slots: number }>({
    assigned: 0,
    slots: 0,
  });
  // Concerns surfaced on a first save attempt; a second (confirmed) save commits.
  const [confirmWarnings, setConfirmWarnings] = useState<StaffingWarning[]>([]);
  // True while the dispatcher is removing an OPEN slot from a booking that still
  // has assigned employees — they must choose whether the slot was unneeded
  // (reduce) or its work is absorbed by the remaining crew (extend the window).
  const [pendingSlotRemoval, setPendingSlotRemoval] = useState<boolean>(false);
  // An extended planned end "HH:MM" set when the remaining crew absorbs a removed
  // open slot's work (the visit window grows). Null when the window is unchanged.
  const [plannedEndOverride, setPlannedEndOverride] = useState<string | null>(null);

  // The authoritative service row — the single source of truth for the visit
  // window and any existing pinned total labour (a redistributed job). The
  // labour override lives on the row (it applies to the whole series), so every
  // surface resolves it identically here rather than each passing its own copy.
  const row = useMemo(() => {
    if (!target) return null;
    const wo = workOrders.find((w) => w.id === target.workOrderId);
    return wo?.serviceRows?.find((r) => r.id === target.serviceRowId) ?? null;
  }, [target, workOrders]);

  // Visit (customer time) window in minutes — prefer the occurrence's resolved
  // window when provided, else the row's planned window.
  const visitMinutes =
    target?.visitMinutes ??
    (row ? calculatePlannedDurationMinutes(row.plannedStartTime, row.plannedEndTime) : null);

  // Resolved planned start "HH:MM" — prefer the occurrence/row value passed by the
  // surface, else the authoritative row. Needed to extend the window when the
  // remaining crew absorbs a removed open slot's work.
  const effectiveStart = target?.plannedStartTime ?? row?.plannedStartTime ?? null;

  const rowOverride =
    typeof row?.totalLabourMinutesOverride === "number" &&
    Number.isFinite(row.totalLabourMinutesOverride) &&
    row.totalLabourMinutesOverride > 0
      ? row.totalLabourMinutesOverride
      : null;

  useEffect(() => {
    if (!target) return;
    const open = Math.max(0, target.openSlots ?? 0);
    setSelection(target.assignedEmployeeIds ?? []);
    setSlots(open);
    setBaselineAssignedIds(new Set(target.assignedEmployeeIds ?? []));
    setLabourOverride(rowOverride ?? null);
    setPendingRemoval(null);
    setPendingAddition(null);
    setPendingSlotRemoval(false);
    setPlannedEndOverride(null);
    setSessionAddIntent(new Map());
    setOriginal({ assigned: (target.assignedEmployeeIds ?? []).length, slots: open });
    setConfirmWarnings([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, rowOverride]);

  const toggle = useCallback(
    (employeeId: string, employeeName: string) => {
      if (selection.includes(employeeId)) {
        if (!baselineAssignedIds.has(employeeId)) {
          // Someone added during THIS session. How they were added decides what
          // removing them means:
          //  - "increase" add (extra labour) → intentful removal: ask whether to
          //    reduce staffing, keep an open slot, or redistribute the workload.
          //  - "split" add (or a plain fill) → a simple undo: drop them without
          //    inventing an open slot and reset any session labour override back
          //    to the row's saved value, so labour returns to normal.
          if (sessionAddIntent.get(employeeId) === "increase") {
            setPendingRemoval({ id: employeeId, name: employeeName });
            return;
          }
          const next = undoEmployeeAddition({ selectedIds: selection, openSlots: slots, employeeId });
          setSelection(next.selectedIds);
          setSlots(next.openSlots);
          setLabourOverride(rowOverride ?? null);
          setSessionAddIntent((prev) => {
            const m = new Map(prev);
            m.delete(employeeId);
            return m;
          });
          // If the person being undone is the one with an open intent prompt,
          // close the prompt too — there is nothing left to decide for them.
          setPendingAddition((prev) => (prev?.id === employeeId ? null : prev));
          setConfirmWarnings([]);
          return;
        }
        // Removing an established (saved) employee. When at least one other
        // assigned employee remains, the removal is intentful: ask whether to
        // keep the requirement (open slot), redistribute, or reduce staffing.
        // But removing the SOLE assigned employee has only one sensible outcome —
        // the position becomes an open slot — so don't trap the dispatcher behind
        // a prompt (where redistribute is impossible). The original employee is
        // always removable and the booking simply becomes an open staffing need.
        if (!shouldPromptRemovalIntent({ assignedCountBefore: selection.length })) {
          const next = applyAssignToggle({ selectedIds: selection, openSlots: slots, employeeId });
          setSelection(next.selectedIds);
          setSlots(next.openSlots);
          setLabourOverride(rowOverride ?? null);
          setConfirmWarnings([]);
          return;
        }
        setPendingRemoval({ id: employeeId, name: employeeName });
        return;
      }
      const assignedBefore = selection.length;
      const slotsBefore = slots;
      const overrideBefore = labourOverride;
      const next = applyAssignToggle({ selectedIds: selection, openSlots: slots, employeeId });
      setSelection(next.selectedIds);
      setSlots(next.openSlots);
      setConfirmWarnings([]);
      // Adding an EXTRA person to an already-staffed booking is ambiguous: does
      // the same job get split, or does total labour grow? Default to "split"
      // (the customer's booked time must not rise silently) and prompt for the
      // choice. Filling an open slot or making the first assignment never asks.
      if (shouldPromptAdditionIntent({ assignedCountBefore: assignedBefore, openSlotsBefore: slotsBefore })) {
        const split = resolveEmployeeAddition({
          assignedCountAfter: next.selectedIds.length,
          assignedCountBefore: assignedBefore,
          openSlotsBefore: slotsBefore,
          visitMinutes,
          totalLabourMinutesOverride: overrideBefore,
          intent: "split",
        });
        setLabourOverride(split.totalLabourMinutesOverride);
        setSessionAddIntent((prev) => new Map(prev).set(employeeId, "split"));
        // Raise the intent prompt for THIS addition. Any prior pending prompt is
        // overwritten — its default "split" was already applied (labour pinned,
        // intent recorded) when it was raised, so it needs no further decision.
        setPendingAddition({
          id: employeeId,
          name: employeeName,
          assignedBefore,
          slotsBefore,
          overrideBefore,
        });
      } else {
        // Filling an open slot or making the first assignment needs no intent
        // choice. Close any lingering prompt (its default "split" already stands)
        // so it never blocks adding further employees.
        setPendingAddition(null);
      }
    },
    [selection, slots, baselineAssignedIds, rowOverride, labourOverride, visitMinutes, sessionAddIntent],
  );

  const applyAddition = useCallback(
    (intent: AdditionIntent) => {
      if (!pendingAddition) return;
      const res = resolveEmployeeAddition({
        assignedCountAfter: selection.length,
        assignedCountBefore: pendingAddition.assignedBefore,
        openSlotsBefore: pendingAddition.slotsBefore,
        visitMinutes,
        totalLabourMinutesOverride: pendingAddition.overrideBefore,
        intent,
      });
      setLabourOverride(res.totalLabourMinutesOverride);
      setSessionAddIntent((prev) => new Map(prev).set(pendingAddition.id, intent));
      setPendingAddition(null);
      setConfirmWarnings([]);
    },
    [pendingAddition, selection, visitMinutes],
  );

  const cancelAddition = useCallback(() => {
    if (!pendingAddition) return;
    // Back out the add entirely: drop the person and restore the pre-add labour.
    const removedId = pendingAddition.id;
    setSelection((prev) => prev.filter((id) => id !== removedId));
    setLabourOverride(pendingAddition.overrideBefore);
    setSessionAddIntent((prev) => {
      const m = new Map(prev);
      m.delete(removedId);
      return m;
    });
    setPendingAddition(null);
    setConfirmWarnings([]);
  }, [pendingAddition]);

  const applyRemoval = useCallback(
    (intent: "keep_open_slot" | "redistribute" | "reduce_requirement") => {
      if (!pendingRemoval) return;
      const res = resolveEmployeeRemoval({
        assignedIdsBefore: selection,
        openSlotsBefore: slots,
        removedEmployeeId: pendingRemoval.id,
        intent,
        visitMinutes,
        totalLabourMinutesOverride: labourOverride,
      });
      if (res.blocked) {
        toast({
          title: "Cannot redistribute",
          description:
            "At least one employee must remain to absorb the workload. Keep an open slot instead, or change the total job time.",
          variant: "destructive",
        });
        return;
      }
      setSelection(res.assignedEmployeeIds);
      setSlots(res.openSlots);
      setLabourOverride(res.totalLabourMinutesOverride);
      setPendingRemoval(null);
      setConfirmWarnings([]);
    },
    [pendingRemoval, selection, slots, visitMinutes, labourOverride, toast],
  );

  const changeSlots = useCallback((delta: number) => {
    setSlots((prev) => Math.max(0, prev + delta));
    // Adding/clearing slots invalidates any pending absorb decision.
    setPendingSlotRemoval(false);
    setPlannedEndOverride(null);
    setConfirmWarnings([]);
  }, []);

  // "Remove open slot" must never silently drop the slot's labour. With assigned
  // employees still on the booking, ask what happens to the work: reduce the
  // requirement (labour scales down) or have the remaining crew absorb it (the
  // window extends to keep total labour). With nobody assigned there is no crew
  // to absorb, so reducing is the only outcome — decrement directly.
  const removeOpenSlot = useCallback(() => {
    if (slots <= 0) return;
    if (!shouldPromptOpenSlotRemoval({ assignedCount: selection.length, openSlots: slots })) {
      setSlots((prev) => Math.max(0, prev - 1));
      setPlannedEndOverride(null);
      setConfirmWarnings([]);
      return;
    }
    setPendingSlotRemoval(true);
  }, [slots, selection.length]);

  const applySlotRemoval = useCallback(
    (intent: OpenSlotRemovalIntent) => {
      const res = resolveOpenSlotRemoval({
        assignedCount: selection.length,
        openSlotsBefore: slots,
        visitMinutes,
        plannedStartTime: effectiveStart,
        totalLabourMinutesOverride: labourOverride,
        intent,
      });
      if (res.blocked) {
        toast({
          title: "Can't extend this booking",
          description:
            "The remaining crew can't absorb the work here (the visit window is unknown or would run past midnight). Reduce the requirement instead.",
          variant: "destructive",
        });
        return;
      }
      setSlots(res.openSlots);
      setLabourOverride(res.totalLabourMinutesOverride);
      setPlannedEndOverride(res.plannedEndTime);
      setPendingSlotRemoval(false);
      setConfirmWarnings([]);
    },
    [selection.length, slots, visitMinutes, effectiveStart, labourOverride, toast],
  );

  // Prior experience with THIS customer (any service), computed once per opened
  // booking. Drives the star/history hints only — never auto-assigns anyone.
  const history = useMemo(() => {
    if (!target) return new Map();
    return computeEmployeeCustomerHistory(target.customerId, workOrders, timeReports, {
      excludeRowId: target.serviceRowId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.customerId, target?.serviceRowId, workOrders, timeReports]);

  const suggestions = useMemo<AssignSuggestion[]>(() => {
    if (!target) return [];
    const pool = employees.filter(
      (e) => e.companyId === target.companyId && (e.status === "active" || selection.includes(e.id)),
    );
    return buildAssignSuggestions({ employees: pool, history, selectedIds: selection });
  }, [employees, target, selection, history]);

  const totalRequired = selection.length + slots;

  // When the remaining crew absorbs a removed open slot, the visit window grows.
  // Reflect that extended window in the live labour breakdown so the dispatcher
  // sees the preserved total job time and the new per-employee hours.
  const effectiveVisitMinutes =
    plannedEndOverride && effectiveStart
      ? calculatePlannedDurationMinutes(effectiveStart, plannedEndOverride) ?? visitMinutes
      : visitMinutes;

  // Live labour breakdown for the current edit: visit window (customer time)
  // separated from total job labour and the per-employee planned hours, so the
  // dispatcher can see that redistributing preserves the total job time.
  const totalLabourMinutes =
    labourOverride ?? (effectiveVisitMinutes != null ? effectiveVisitMinutes * totalRequired : null);
  const perEmployeeMinutes =
    selection.length > 0 && totalLabourMinutes != null
      ? Math.round(totalLabourMinutes / selection.length)
      : effectiveVisitMinutes;

  const submit = useCallback(
    (confirmed: boolean) => {
      if (!target) return;
      // A pending REMOVAL has no safe default, so it must be resolved first.
      // A pending ADDITION already defaults to the recommended "split" (applied
      // to labourOverride when it was raised), so saving simply commits that
      // default; just close the prompt.
      // A pending OPEN-SLOT removal likewise has no safe default — reduce vs.
      // absorb change labour very differently — so it must be resolved first.
      const saveGate = resolveStaffingSaveGate({
        pendingRemoval: pendingRemoval !== null,
        pendingSlotRemoval,
      });
      if (saveGate.blocked) {
        toast({
          title: "Finish the staffing change",
          description: saveGate.reason ?? "",
          variant: "destructive",
        });
        return;
      }
      if (pendingAddition) setPendingAddition(null);
      const validation = validateStaffingChange({
        previousAssignedCount: original.assigned,
        previousOpenSlots: original.slots,
        nextAssignedCount: selection.length,
        nextOpenSlots: slots,
        // The add-intent prompt already settled what happens to labour, so don't
        // re-surface a contradictory "increasing required staffing" confirmation.
        additionIntentResolved: sessionAddIntent.size > 0,
      });
      // A booking must never silently require nobody — force at least one slot.
      if (validation.blocked) {
        setSlots(validation.correctedOpenSlots);
        setConfirmWarnings([]);
        toast({
          title: "Staffing required",
          description:
            "A booking needs at least one assigned employee or open slot. Added one open slot — review and save again.",
          variant: "destructive",
        });
        return;
      }
      // Surface staffing concerns and wait for an explicit confirmation.
      if (validation.warnings.length > 0 && !confirmed) {
        setConfirmWarnings(validation.warnings);
        return;
      }
      // A recurring occurrence is reassigned via a per-occurrence exception so the
      // series is never touched; everything else (one-time bookings, work-order
      // quick-assign) still writes the authoritative service row.
      const isRecurringOccurrence = Boolean(target.occurrence && target.occurrence.isRecurring);
      const res = isRecurringOccurrence
        ? reassignOccurrence(target.occurrence!.occurrenceKey, {
            assignedEmployeeIds: selection,
            unassignedEmployeeSlots: slots,
            totalLabourMinutes: labourOverride,
          })
        : updateWorkOrderServiceRow(target.workOrderId, target.serviceRowId, {
            assignedEmployeeIds: selection,
            unassignedEmployeeSlots: slots,
            totalLabourMinutesOverride: labourOverride,
            // Persist the extended window when the remaining crew absorbed an
            // open slot's work; otherwise leave the planned window untouched.
            ...(plannedEndOverride ? { plannedEndTime: plannedEndOverride } : {}),
          });
      if (!res.ok) {
        toast({ title: "Couldn't update staffing", description: res.error, variant: "destructive" });
        return;
      }
      // For a recurring occurrence the staffing write goes through the exception
      // overlay; an absorbed open slot also extends the window, which is written
      // via the same occurrence reschedule overlay (in place, same day) so the
      // series and siblings stay untouched.
      if (isRecurringOccurrence && plannedEndOverride && effectiveStart) {
        const occ = target.occurrence!;
        const keySep = occ.occurrenceKey.lastIndexOf(":");
        const ruleDate = keySep >= 0 ? occ.occurrenceKey.slice(keySep + 1) : "";
        const inPlaceDate = occ.displayDate ?? ruleDate;
        if (inPlaceDate) {
          const moveRes = rescheduleOccurrence(occ.occurrenceKey, {
            newDate: inPlaceDate,
            newStartTime: effectiveStart,
            newEndTime: plannedEndOverride,
          });
          if (!moveRes.ok) {
            toast({
              title: "Couldn't extend the booking",
              description: moveRes.error,
              variant: "destructive",
            });
            return;
          }
        }
      }
      const parts: string[] = [];
      if (selection.length > 0) parts.push(`${selection.length} assigned`);
      if (slots > 0) parts.push(`${slots} open slot${slots === 1 ? "" : "s"}`);
      toast({
        title: "Staffing updated",
        description: `${target.serviceName} · ${parts.join(" + ") || "no staffing"}.`,
      });
      onSaved?.();
      onClose();
    },
    [target, original, selection, slots, labourOverride, plannedEndOverride, effectiveStart, pendingAddition, pendingRemoval, pendingSlotRemoval, sessionAddIntent, updateWorkOrderServiceRow, reassignOccurrence, rescheduleOccurrence, toast, onSaved, onClose],
  );

  // True when this dialog is editing a single recurring occurrence that currently
  // carries a per-occurrence staffing override (reassigned employees / open slots /
  // pinned labour). Only then can the dispatcher reset it back to the series.
  const hasSeriesOverride = useMemo(() => {
    const occ = target?.occurrence;
    if (!occ || !occ.isRecurring) return false;
    const exception = bookingOccurrenceExceptions.find(
      (e) => e.occurrenceKey === occ.occurrenceKey,
    );
    return occurrenceExceptionHasStaffingOverride(exception);
  }, [target?.occurrence, bookingOccurrenceExceptions]);

  const resetToSeries = useCallback(() => {
    const occ = target?.occurrence;
    if (!occ) return;
    // Only clears the staffing override fields; any cancel/reschedule overlay on
    // the occurrence is preserved by clearOccurrenceAssignment.
    const res = clearOccurrenceAssignment(occ.occurrenceKey);
    if (!res.ok) {
      toast({
        title: "Couldn't reset staffing",
        description: res.error,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Reset to series",
      description: "This occurrence now uses the recurring series staffing.",
    });
    onSaved?.();
    onClose();
  }, [target?.occurrence, clearOccurrenceAssignment, toast, onSaved, onClose]);

  const subtitle = target
    ? [target.customerName, target.serviceName]
        .filter(Boolean)
        .join(" · ") + (target.workOrderNumber ? ` (${target.workOrderNumber})` : "")
    : "";

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign employees</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
          {onOpenWorkOrder && target ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-7 w-fit gap-1.5 px-2 text-xs"
              onClick={() => onOpenWorkOrder(target.workOrderId)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open work order{target.workOrderNumber ? ` ${target.workOrderNumber}` : ""}
            </Button>
          ) : null}
        </DialogHeader>
        <div className="space-y-3">
          {/* Staffing summary: assigned · open slots · total required */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex flex-col leading-tight">
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {selection.length}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Assigned
                </span>
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-base font-semibold tabular-nums text-amber-600">{slots}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Open slots
                </span>
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {totalRequired}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Required
                </span>
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {formatHours(totalLabourMinutes)}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Total labour
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={slots <= 0 || pendingSlotRemoval}
                onClick={removeOpenSlot}
                aria-label="Remove open slot"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-6 text-center text-sm font-medium tabular-nums text-foreground">
                {slots}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={pendingSlotRemoval}
                onClick={() => changeSlots(1)}
                aria-label="Add open slot"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Reset a per-occurrence override back to the recurring series staffing.
              Subtle, non-destructive — only shown when an override exists. */}
          {hasSeriesOverride ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                Use the recurring series staffing for this occurrence.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                onClick={resetToSeries}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to series
              </Button>
            </div>
          ) : null}

          {/* Explicit, visible warning that staffing is still incomplete. */}
          {slots > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="text-xs font-medium">
                {slots === 1
                  ? "1 employee still needs to be assigned — this booking is missing 1 person."
                  : `${slots} employees still need to be assigned — this booking is missing ${slots} people.`}
              </p>
            </div>
          ) : selection.length > 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              Fully staffed{perEmployeeMinutes != null ? ` · ${formatHours(perEmployeeMinutes)} planned per employee` : ""}
              {labourOverride != null
                ? " · total job time preserved (shared across the crew)"
                : " · labour scales with staffing"}
              .
            </p>
          ) : null}

          {/* Confirmation that the visit window was extended so the remaining crew
              can absorb a removed open slot's work (total labour preserved). */}
          {plannedEndOverride && effectiveStart && !pendingSlotRemoval ? (
            <div className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sky-800">
              <Clock className="h-4 w-4 shrink-0" />
              <p className="text-xs font-medium">
                Visit extended to {effectiveStart}–{plannedEndOverride} so the remaining crew carries
                the same total job time.
              </p>
            </div>
          ) : null}

          {/* Open-slot removal intent: reduce the requirement, or have the
              remaining crew absorb the work (extending the visit window). */}
          {pendingSlotRemoval ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Minus className="h-4 w-4" />
                You removed an open slot. What should happen with its work?
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => applySlotRemoval("reduce_requirement")}
                  className="w-full rounded-md border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="block text-sm font-medium text-foreground">
                    Reduce staffing requirement
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    The open slot was no longer needed. Required staffing drops, total labour
                    decreases, and the scheduled time stays the same.
                  </span>
                </button>
                {(() => {
                  const preview = resolveOpenSlotRemoval({
                    assignedCount: selection.length,
                    openSlotsBefore: slots,
                    visitMinutes,
                    plannedStartTime: effectiveStart,
                    totalLabourMinutesOverride: labourOverride,
                    intent: "absorb",
                  });
                  const disabled = preview.blocked;
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => applySlotRemoval("absorb")}
                      className={cn(
                        "w-full rounded-md border border-border/60 px-3 py-2 text-left transition-colors",
                        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="block text-sm font-medium text-foreground">
                        Remaining employee absorbs the work
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {disabled
                          ? "Can't extend this booking (the visit window is unknown or would run past midnight)."
                          : `The work still needs doing. Required staffing drops, total labour stays the same, and the visit extends${
                              effectiveStart && preview.plannedEndTime
                                ? ` to ${effectiveStart}–${preview.plannedEndTime}`
                                : ""
                            }.`}
                      </span>
                    </button>
                  );
                })()}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => setPendingSlotRemoval(false)}
                >
                  Cancel — keep the open slot
                </Button>
              </div>
            </div>
          ) : null}

          {/* Addition intent: split the existing work, or increase total labour. */}
          {pendingAddition ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <UserPlus className="h-4 w-4" />
                You added {pendingAddition.name}. What should happen with the workload?
              </p>
              <p className="text-[11px] text-muted-foreground">
                Split is selected by default. Pick an option, or just save to keep the split.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => applyAddition("split")}
                  aria-pressed={labourOverride != null}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                    labourOverride != null
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/60 hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      labourOverride != null
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {labourOverride != null ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      Split existing work (recommended)
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Same total cleaning time, now shared. Total labour stays the same and
                      per-employee planned hours drop.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => applyAddition("increase")}
                  aria-pressed={labourOverride == null}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                    labourOverride == null
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/60 hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      labourOverride == null
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {labourOverride == null ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      Increase total labour
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      The customer gets more work. Total labour grows with the extra employee and
                      each person keeps the full visit time.
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={cancelAddition}
                >
                  Cancel — don’t add {pendingAddition.name}
                </Button>
              </div>
            </div>
          ) : null}

          {/* Removal intent: keep the requirement (open slot) or redistribute. */}
          {pendingRemoval ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <UserMinus className="h-4 w-4" />
                You removed {pendingRemoval.name}. What should happen?
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => applyRemoval("keep_open_slot")}
                  className="w-full rounded-md border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="block text-sm font-medium text-foreground">Keep as open slot</span>
                  <span className="block text-[11px] text-muted-foreground">
                    The booking still needs 1 more employee. Required staffing stays the same.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => applyRemoval("reduce_requirement")}
                  className="w-full rounded-md border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="block text-sm font-medium text-foreground">
                    Reduce staffing — fewer people needed
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    The booking needs fewer people. Required staffing drops and labour scales back
                    down to match the remaining crew (no open slot, no preserved labour).
                  </span>
                </button>
                {(() => {
                  const remaining = selection.filter((id) => id !== pendingRemoval.id).length;
                  const disabled = remaining === 0;
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => applyRemoval("redistribute")}
                      className={cn(
                        "w-full rounded-md border border-border/60 px-3 py-2 text-left transition-colors",
                        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="block text-sm font-medium text-foreground">
                        Redistribute workload
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {disabled
                          ? "Needs at least one employee remaining to carry the work."
                          : "The remaining employee(s) cover the removed person's planned time. Total job time is kept."}
                      </span>
                    </button>
                  );
                })()}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => setPendingRemoval(null)}
                >
                  Cancel removal
                </Button>
              </div>
            </div>
          ) : null}

          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active employees in this company.</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {suggestions.map((s) => {
                // While a removal intent is pending for THIS employee, show them
                // as "pending removal" — unchecked and visually distinct — so the
                // row never looks like they're still assigned. Cancelling the
                // removal clears pendingRemoval and the checked state returns.
                const isPendingRemoval = pendingRemoval?.id === s.employee.id;
                const showAssigned = s.isAssigned && !isPendingRemoval;
                return (
                <button
                  key={s.employee.id}
                  type="button"
                  onClick={() => toggle(s.employee.id, s.employee.name)}
                  aria-pressed={showAssigned}
                  disabled={pendingRemoval !== null || pendingSlotRemoval}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                    isPendingRemoval
                      ? "border-dashed border-destructive/50 bg-destructive/5 opacity-70"
                      : showAssigned
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/60 hover:bg-muted/50",
                  )}
                >
                  <Checkbox checked={showAssigned} className="pointer-events-none" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "truncate text-sm font-medium",
                          isPendingRemoval
                            ? "text-muted-foreground line-through"
                            : "text-foreground",
                        )}
                      >
                        {s.employee.name}
                      </span>
                      {s.star ? (
                        <Star
                          className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500"
                          aria-label={STAR_LABEL[s.star]}
                        />
                      ) : null}
                      {isPendingRemoval ? (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                          Pending removal
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {isPendingRemoval
                        ? "Choose what happens with the workload below"
                        : s.historyLabel ?? "No previous history"}
                    </span>
                  </span>
                </button>
                );
              })}
            </div>
          )}

          {confirmWarnings.length > 0 ? (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                Confirm staffing change
              </p>
              {confirmWarnings.map((w) => (
                <p key={w} className="text-[11px] text-amber-700">
                  {WARNING_TEXT[w]}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Stars show prior experience with this customer (suggestion only — nothing is
              auto-assigned). Staffing is stored on the work-order service row, so it applies to the
              whole series.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {confirmWarnings.length > 0 ? (
            <>
              {/* Step back to editing without committing anything. */}
              <Button variant="outline" onClick={() => setConfirmWarnings([])}>
                Back
              </Button>
              <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => submit(true)}>
                Confirm &amp; save
              </Button>
            </>
          ) : (
            <Button onClick={() => submit(false)}>Save staffing</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
