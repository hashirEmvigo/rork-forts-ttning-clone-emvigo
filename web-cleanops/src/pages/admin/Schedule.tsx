import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleSlash,
  Clock,
  ExternalLink,
  Inbox,
  Layers,
  MapPin,
  Repeat,
  RotateCcw,
  Sparkles,
  Split,
  StickyNote,
  User as UserIcon,
  UserCheck,
  UserCog,
  UserMinus,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TimePicker } from "@/components/ui/time-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { formatDate, formatTimeRange } from "@/lib/format";
import { buildVisitChipLabour } from "@/lib/scheduleCellLabour";
import { StaffingIndicator } from "@/components/StaffingIndicator";
import { resolveScheduledWindow } from "@/lib/scheduledWindow";
import {
  applyDragWrite,
  buildTimeScheduleWrite,
  detectTimeConflicts,
  evaluateDragAction,
  planDragWrite,
  resolveDragScope,
  type ConflictNeighbour,
  type ConflictWindow,
  type DragAction,
  type DragScope,
  type DragSource,
  type DropTarget,
} from "@/lib/dragdrop";
import { parseTime24 } from "@/lib/time";
import { rollUpEmployeeWorkload, type EmployeeRollupEntry } from "@/lib/scheduleEmployeeRollup";
import {
  buildScheduleBoard,
  computeScheduleBoardMetrics,
  resolveScheduleProgram,
  scheduleEntryOperationalStatus,
  type ScheduleBoardMetrics,
  type ScheduleDateMetrics,
  type ScheduleEntry,
} from "@/lib/scheduleCore";
import { withLegacyReschedules } from "@/lib/legacyReschedule";
import { useScheduleInputSource } from "@/hooks/use-schedule-input-source";
import { useIntervalCache } from "@/hooks/use-interval-cache";
import { buildIntervalCacheKey, referenceToken, perf } from "@/lib/perf";
import {
  AssignEmployeesDialog,
  type AssignDialogTarget,
} from "@/components/AssignEmployeesDialog";
import {
  dailyCapacityMinutes,
  getWorkingDay,
  weekdayOf,
} from "@/lib/employeeSchedule";
import type { EmployeeWorkingScheduleDay, Weekday } from "@/types";
import {
  resolveBookingModifiers,
  type BookingModifierBadge,
  type BookingOperationalStatus,
  type BookingStatusColor,
  type OperationalStatusBadge,
} from "@/lib/bookingStatus";
import {
  evaluatePreferredTimeStatus,
  isPreferredTimeEvaluationAvailable,
  preferredTimeInputFromPreferences,
  type PreferredTimeEvaluationResult,
  type PreferredTimeStatus,
} from "@/lib/evaluatePreferredTime";
import {
  BookingModifiers,
  BookingOperationalStatusBadge,
} from "@/components/BookingStatusBadges";
import type {
  Customer,
  CustomerSchedulingPreferences,
  Employee,
  WorkOrderServiceRow,
} from "@/types";

/**
 * The period presets that drive the planning board's COLUMNS. The selected
 * preset only changes which dates are shown — the rows are always employees and
 * the cells are always occurrences resolved from the shared Schedule Core.
 */
type RangePreset = "day" | "work_week" | "week" | "two_weeks" | "month" | "custom";

const PRESET_LABELS: Record<RangePreset, string> = {
  day: "Day",
  work_week: "Mon–Fri",
  week: "Week",
  two_weeks: "Two weeks",
  month: "Month",
  custom: "Custom",
};

/** Local-midnight helpers (no UTC drift). */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}
/** Monday-start week containing the given date. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  return addDays(x, day === 0 ? -6 : 1 - day);
}
function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  return addDays(addMonths(x, 1), -1);
}
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseIso(iso: string): Date {
  return startOfDay(new Date(`${iso}T00:00:00`));
}
/** Inclusive list of "YYYY-MM-DD" between two dates (capped for safety). */
function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 366) {
    out.push(isoOf(cursor));
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

/** Formats a minutes total as a compact hours label (e.g. "6h", "6.5h"). */
function formatHoursLabel(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

/** A resolved entry paired with its shared status + modifier badges. */
interface EntryViewModel {
  entry: ScheduleEntry;
  operational: OperationalStatusBadge;
  modifiers: BookingModifierBadge[];
  /**
   * The preferred-time evaluation for this occurrence (when the add-on is
   * available), used to drive the card's customer-time signal dot. Null when
   * the feature is unavailable or the occurrence is cancelled.
   */
  confirmation: PreferredTimeEvaluationResult | null;
}

/** One date column of the board. */
interface BoardColumn {
  iso: string;
  weekday: Weekday | null;
  shortLabel: string;
  dayNum: string;
  isToday: boolean;
  isWeekend: boolean;
}

/** A single employee/date cell. */
interface BoardCell {
  column: BoardColumn;
  available: boolean;
  capacityMinutes: number;
  visits: EntryViewModel[];
}

/** One employee row across all columns, with range capacity roll-up. */
interface BoardEmployeeRow {
  employee: Employee;
  cells: BoardCell[];
  /** Distinct occurrences assigned to this employee across the range. */
  occurrenceCount: number;
  /** On-site (visit/customer) minutes across the range (excludes cancelled). */
  plannedMinutes: number;
  /**
   * Planned labour workload minutes across the range (per-employee, excludes
   * cancelled). Basis for capacity/utilisation; differs from on-site time when
   * labour is redistributed across a reduced crew.
   */
  labourMinutes: number;
  /** Plan-able capacity minutes across available days in the range. */
  capacityMinutes: number;
}

/** The full planning-board payload. */
interface BoardData {
  columns: BoardColumn[];
  rows: BoardEmployeeRow[];
  /** Open work with no assignee, aligned to the columns. */
  unassignedCells: BoardCell[];
  /** Distinct occurrences surfaced in the Unassigned / Open-slots row. */
  unassignedTotal: number;
  /** Occurrences in the Unassigned row with NO assignee at all. */
  unassignedUnstaffed: number;
  /** Total open staffing slots across the Unassigned row. */
  unassignedOpenSlots: number;
  /** Per-date occurrence + open-slot counts for the column headers. */
  dateMetrics: Map<string, ScheduleDateMetrics>;
}

/**
 * The dispatcher actions a single occurrence can trigger. Each writes to the
 * SAME authoritative models the Booking Queue uses (occurrence exceptions for
 * reschedule/cancel/restore, the work-order service row for staffing, the
 * work-order note + activity log for notes) — the Schedule never introduces its
 * own occurrence pipeline or persistence.
 */
interface CardActions {
  onOpenWorkOrder: (workOrderId: string) => void;
  onOpenCustomer: (customerId: string) => void;
  onReschedule: (entry: ScheduleEntry) => void;
  onCancel: (entry: ScheduleEntry) => void;
  onRestore: (entry: ScheduleEntry) => void;
  onAssign: (entry: ScheduleEntry) => void;
  onNote: (entry: ScheduleEntry) => void;
}

/**
 * The card currently being dragged across the board, with just enough source
 * context to decide what a drop should do. `sourceEmployeeId` is null when the
 * card is dragged out of the Unassigned / open-slots row (a slot-fill).
 */
interface DragPayload {
  entry: ScheduleEntry;
  sourceEmployeeId: string | null;
  sourceEmployeeName: string | null;
  sourceDate: string;
}

/**
 * Drag-and-drop plumbing threaded down to the cells/chips. Phase 1 only moves an
 * occurrence between employee rows on the SAME date — every drop is confirmed
 * before it writes, and the writes reuse the same authoritative per-occurrence
 * exception (recurring) / service-row (one-time) paths as AssignEmployeesDialog.
 */
interface BoardDnd {
  active: DragPayload | null;
  begin: (payload: DragPayload) => void;
  end: () => void;
  dropOnEmployee: (employee: Employee, dateIso: string) => void;
  /** Drop onto the Unassigned row — removes the source employee, opens a slot. */
  dropOnUnassigned: (dateIso: string) => void;
}

/** A drop awaiting the dispatcher's confirmation before it writes. */
interface DropConfirm {
  entry: ScheduleEntry;
  /** Which kind of change the gesture produced. */
  kind: "employee" | "date" | "time";
  mode: "reassign" | "fill_slot" | "move_date" | "unassign" | "move_time";
  /** The employee row dropped on, or null for an Employee → Unassigned move. */
  targetEmployee: Employee | null;
  /** The source employee name, or "Open slot" for a slot-fill. */
  currentLabel: string;
  /** Date move only: the new day "YYYY-MM-DD". */
  toDate?: string;
  /**
   * Schedule move only (date/time): the editable start time "HH:mm" the
   * dispatcher picks. Seeded with the occurrence's current start; duration is
   * preserved when the write is built. Empty string means "follow the base rule".
   */
  draftStartTime?: string;
  /** Whether to show the (shell) scope selector — recurring date moves only. */
  showScopeShell: boolean;
  /** The normalized action driving the write (universal drag engine). */
  action: DragAction;
  /** The resolved scope this write persists at. */
  scope: DragScope;
}

/** Builds the universal-engine drag source from a board payload + its entry. */
function dragSourceFromPayload(payload: DragPayload): DragSource {
  const { entry } = payload;
  return {
    occurrenceKey: entry.occurrenceKey,
    parentServiceRowId: entry.parentServiceRowId,
    workOrderId: entry.workOrderId,
    isRecurring: (entry.recurrenceInterval ?? "one_time") !== "one_time",
    sourceEmployeeId: payload.sourceEmployeeId,
    sourceDate: payload.sourceDate,
    // Preserve the occurrence's resolved window so a date move never changes the
    // time or duration — only the day.
    startTime: entry.startTime ?? null,
    endTime: entry.endTime ?? null,
    assignedEmployeeIds: entry.assignedEmployeeIds ?? [],
    openSlotCount: Math.max(0, entry.openSlotCount ?? 0),
    labourMinutes: entry.labourMinutes,
    isLabourRedistributed: entry.isLabourRedistributed,
  };
}

/** Maps the shared status colour token to a status accent/dot colour. */
const DOT_COLOR: Record<BookingStatusColor, string> = {
  red: "bg-destructive",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
  neutral: "bg-muted-foreground/50",
};

/** Maps the shared status colour token to a left-accent border colour. */
const ACCENT_BORDER: Record<BookingStatusColor, string> = {
  red: "border-l-destructive",
  blue: "border-l-blue-500",
  violet: "border-l-violet-500",
  green: "border-l-emerald-500",
  orange: "border-l-amber-500",
  neutral: "border-l-muted-foreground/40",
};

/** The compact per-status indicator icon (mirrors BookingStatusBadges). */
const STATUS_ICON: Record<BookingOperationalStatus, LucideIcon> = {
  cancelled: XCircle,
  rebooked: ArrowRightLeft,
  variation: Sparkles,
  scheduled: CalendarCheck,
  unscheduled: CalendarClock,
};

const STATUS_ICON_COLOR: Record<BookingStatusColor, string> = {
  red: "text-destructive",
  blue: "text-blue-600",
  violet: "text-violet-600",
  green: "text-emerald-600",
  orange: "text-amber-600",
  neutral: "text-muted-foreground",
};

/** Number of days each preset spans (used for prev/next navigation). */
function presetStepDays(preset: RangePreset, columns: BoardColumn[]): number {
  switch (preset) {
    case "day":
      return 1;
    case "work_week":
    case "week":
      return 7;
    case "two_weeks":
      return 14;
    default:
      return Math.max(1, columns.length);
  }
}

/**
 * Production Schedule — an employee planning board over the Shared Schedule
 * Core. The selected period preset controls the COLUMNS (dates); EMPLOYEES are
 * the ROWS; occurrences render inside each employee/day cell. A dedicated,
 * always-visible "Unassigned / Open slots" row collects work with no assignee.
 *
 * This is purely a presentation/layout change: every occurrence, status and
 * modifier still comes from {@link resolveScheduleProgram} and the shared
 * resolvers, so the board and the Booking Queue always show the same
 * operational truth. Dispatcher card actions reuse the same authoritative
 * mutations. No drag & drop, routing, balancing or conflict detection here.
 */
export default function Schedule() {
  const {
    workOrders,
    customers,
    postalCities,
    employees,
    bookingQueue,
    bookingOccurrenceExceptions,
    currentUser,
    systemSettings,
    getWorkOrderSettingsFor,
    isCompanyEntitledToService,
    rescheduleOccurrence,
    cancelOccurrence,
    restoreOccurrence,
    addWorkOrderNote,
    reassignOccurrence,
    updateWorkOrderServiceRow,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Dev-only render accounting (no-op in production).
  perf.count("Schedule.render");

  // Interval cache: revisiting a period reuses the resolved program instantly.
  // Keyed by view mode + date range + filters + input source; invalidated
  // whenever any source array reference changes (a mutation), so cached results
  // can never be stale and the local/Supabase intervals can never collide.
  const scheduleCache = useIntervalCache<ScheduleEntry[]>({
    label: "schedule.interval",
    maxEntries: 24,
  });

  const [preset, setPreset] = useState<RangePreset>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [customFrom, setCustomFrom] = useState<string>(() => isoOf(startOfDay(new Date())));
  const [customTo, setCustomTo] = useState<string>(() => isoOf(addDays(startOfDay(new Date()), 6)));
  const [showCancelled, setShowCancelled] = useState<boolean>(false);

  // ── Columns: the selected preset determines which dates are shown ─────────
  const columns = useMemo<BoardColumn[]>(() => {
    let isoList: string[];
    if (preset === "day") {
      isoList = [isoOf(anchor)];
    } else if (preset === "work_week") {
      const start = startOfWeek(anchor);
      isoList = daysBetween(start, addDays(start, 4));
    } else if (preset === "week") {
      const start = startOfWeek(anchor);
      isoList = daysBetween(start, addDays(start, 6));
    } else if (preset === "two_weeks") {
      const start = startOfWeek(anchor);
      isoList = daysBetween(start, addDays(start, 13));
    } else if (preset === "month") {
      isoList = daysBetween(startOfMonth(anchor), endOfMonth(anchor));
    } else {
      const from = parseIso(customFrom);
      const to = parseIso(customTo);
      isoList = to.getTime() < from.getTime() ? [customFrom] : daysBetween(from, to);
    }
    const todayIso = isoOf(startOfDay(new Date()));
    return isoList.map((iso) => {
      const wd = weekdayOf(iso);
      const d = parseIso(iso);
      return {
        iso,
        weekday: wd,
        shortLabel: d.toLocaleDateString("en-GB", { weekday: "short" }),
        dayNum: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        isToday: iso === todayIso,
        isWeekend: wd === "saturday" || wd === "sunday",
      };
    });
  }, [preset, anchor, customFrom, customTo]);

  const range = useMemo(
    () => ({
      fromDate: columns[0]?.iso ?? isoOf(anchor),
      toDate: columns[columns.length - 1]?.iso ?? isoOf(anchor),
    }),
    [columns, anchor],
  );

  // Super Admins read unscoped; company users are scoped to their company.
  const scheduleScope =
    currentUser?.role === "super_admin" ? undefined : currentUser?.companyId ?? undefined;

  // Lookups are held constant from the local store (same object on both sides)
  // until customers / employees / postal cities migrate on their own tracks.
  const scheduleLookups = useMemo(
    () => ({ customers, employees, postalCities }),
    [customers, employees, postalCities],
  );

  // P6B — Schedule interval read switch. Flag OFF (default) → the resolver input
  // is the in-memory localStorage work orders + base exceptions, exactly as
  // today. Flag ON → the SAME input shape is built from Supabase (work orders +
  // exceptions), with local fallback. Only the input SOURCE moves; the resolver,
  // board, metrics, filters and interactions are untouched. A background interval
  // shadow comparison surfaces any drift.
  const scheduleInput = useScheduleInputSource({
    localWorkOrders: workOrders,
    localExceptions: bookingOccurrenceExceptions,
    companyId: scheduleScope,
    fromDate: range.fromDate,
    toDate: range.toDate,
    includeCancelled: showCancelled,
    lookups: scheduleLookups,
  });
  const scheduleWorkOrders = scheduleInput.workOrders;

  // Bridge legacy `item.reschedule` moves into the exception stream the Schedule
  // Core reads, so pre-occurrence-exception reschedules converge with new ones.
  // The bridge is applied identically on top of whichever exception source is
  // active (local or Supabase), so board behaviour is preserved.
  const exceptionsWithLegacy = useMemo(
    () => withLegacyReschedules(bookingQueue, scheduleInput.exceptions),
    [bookingQueue, scheduleInput.exceptions],
  );

  // Token over the ACTUAL arrays fed to the resolver, so a source switch or any
  // mutation drops the cache.
  const scheduleDataToken = referenceToken(
    scheduleWorkOrders,
    customers,
    postalCities,
    employees,
    exceptionsWithLegacy,
  );

  const entries = useMemo(
    () =>
      scheduleCache.getOrCompute(
        buildIntervalCacheKey({
          viewMode: preset,
          fromDate: range.fromDate,
          toDate: range.toDate,
          filters: {
            includeCancelled: showCancelled,
            source: scheduleInput.source,
            dataToken: scheduleInput.dataToken,
          },
        }),
        scheduleDataToken,
        () =>
          resolveScheduleProgram({
            workOrders: scheduleWorkOrders,
            customers,
            postalCities,
            employees,
            exceptions: exceptionsWithLegacy,
            fromDate: range.fromDate,
            toDate: range.toDate,
            includeCancelled: showCancelled,
          }),
      ),
    [
      scheduleCache,
      scheduleDataToken,
      preset,
      scheduleWorkOrders,
      scheduleInput.source,
      scheduleInput.dataToken,
      customers,
      postalCities,
      employees,
      exceptionsWithLegacy,
      range,
      showCancelled,
    ],
  );

  // Cancelled-inclusive resolve for the same period. "Show cancelled" only
  // controls board rendering; the Cancelled metric must always reflect the true
  // count, so we resolve this once and feed it to the metrics as the cancelled
  // source. When showCancelled is already ON this matches `entries`.
  const allEntriesForMetrics = useMemo(
    () =>
      showCancelled
        ? entries
        : scheduleCache.getOrCompute(
            buildIntervalCacheKey({
              viewMode: preset,
              fromDate: range.fromDate,
              toDate: range.toDate,
              filters: { includeCancelled: true, source: scheduleInput.source },
            }),
            scheduleDataToken,
            () =>
              resolveScheduleProgram({
                workOrders: scheduleWorkOrders,
                customers,
                postalCities,
                employees,
                exceptions: exceptionsWithLegacy,
                fromDate: range.fromDate,
                toDate: range.toDate,
                includeCancelled: true,
              }),
          ),
    [
      scheduleCache,
      scheduleDataToken,
      preset,
      showCancelled,
      entries,
      scheduleWorkOrders,
      scheduleInput.source,
      customers,
      postalCities,
      employees,
      exceptionsWithLegacy,
      range,
    ],
  );

  // Operational summary metrics for the whole period — every figure is derived
  // from the distinct-occurrence entry list, so a multi-employee occurrence is
  // counted exactly once and the totals never inflate. Visible `entries` drive
  // totals/staffing/labour/headers; the cancelled-inclusive list drives only the
  // Cancelled tile so it never reads 0 while cancelled rows are hidden.
  const metrics = useMemo<ScheduleBoardMetrics>(
    () =>
      perf.measure("schedule.metrics", () =>
        computeScheduleBoardMetrics(entries, allEntriesForMetrics),
      ),
    [entries, allEntriesForMetrics],
  );

  // ── Confirmation modifier wiring (reused from the Booking Queue) ──────────
  const sourceRowById = useMemo(() => {
    const map = new Map<string, WorkOrderServiceRow>();
    for (const wo of workOrders) {
      for (const row of wo.serviceRows ?? []) map.set(row.id, row);
    }
    return map;
  }, [workOrders]);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  const preferredTimeAvailableFor = useCallback(
    (companyId: string): boolean =>
      isPreferredTimeEvaluationAvailable({
        masterAllows: systemSettings.allowPreferredTimeEvaluation === true,
        companyEntitled: isCompanyEntitledToService(companyId, "preferred_time_evaluation"),
        companyEnabled:
          getWorkOrderSettingsFor(companyId).preferredTimeEvaluationEnabled === true,
      }),
    [systemSettings, isCompanyEntitledToService, getWorkOrderSettingsFor],
  );

  const resolveEntryPreferences = useCallback(
    (entry: ScheduleEntry): CustomerSchedulingPreferences | null => {
      const row = sourceRowById.get(entry.parentServiceRowId);
      if (row?.scheduleSource === "override" && row.schedulePreferences) {
        return row.schedulePreferences;
      }
      return customerById.get(entry.customerId)?.schedulingPreferences ?? null;
    },
    [sourceRowById, customerById],
  );

  // Resolve the shared status + modifiers once per entry. Confirmation reuses
  // the exact same gating + evaluation as the Booking Queue (no duplication).
  const viewModels = useMemo<EntryViewModel[]>(() => {
    const stop = perf.start("schedule.entryTransform");
    const result = entries.map((entry) => {
      const cancelled = entry.status === "cancelled";
      const confirmation =
        !cancelled && preferredTimeAvailableFor(entry.companyId)
          ? evaluatePreferredTimeStatus(
              preferredTimeInputFromPreferences(resolveEntryPreferences(entry), {
                scheduledDate: entry.displayDate,
                plannedStartTime: entry.startTime,
                plannedEndTime: entry.endTime,
              }),
            )
          : null;
      return {
        entry,
        operational: scheduleEntryOperationalStatus(entry),
        modifiers: resolveBookingModifiers({
          isCancelled: cancelled,
          isTimeChanged: entry.isTimeChanged,
          confirmation,
        }),
        confirmation,
      };
    });
    stop();
    return result;
  }, [entries, preferredTimeAvailableFor, resolveEntryPreferences]);

  // ── Board assembly: employees become rows, columns are the dates ──────────
  // Re-groups the resolved viewModels by assignee × display date (pure helper);
  // never re-derives occurrences. A multi-employee visit appears in each
  // employee's row but is one distinct occurrence in the headers/totals.
  const board = useMemo<BoardData>(() => {
    const stopBoard = perf.start("schedule.board");
    const index = buildScheduleBoard(
      viewModels,
      (vm) => vm.entry.assignedEmployeeIds ?? [],
      (vm) => vm.entry.displayDate,
      // Partially-assigned occurrences (assignees + open slots) also surface in
      // the always-visible Unassigned / Open-slots row.
      (vm) => vm.entry.openSlotCount,
    );

    const companyIds = new Set(viewModels.map((vm) => vm.entry.companyId));
    const relevant = employees.filter(
      (e) =>
        index.employeeIdsWithWork.has(e.id) ||
        (e.status === "active" && companyIds.has(e.companyId)),
    );

    const sortVisits = (list: EntryViewModel[]): EntryViewModel[] =>
      list.slice().sort((a, b) => {
        const aStart = a.entry.startTime ?? "99:99";
        const bStart = b.entry.startTime ?? "99:99";
        if (aStart !== bStart) return aStart < bStart ? -1 : 1;
        return a.entry.customerName.localeCompare(b.entry.customerName);
      });

    const rows: BoardEmployeeRow[] = relevant.map((emp) => {
      const byDate = index.byEmployee.get(emp.id);
      let capacityMinutes = 0;
      let occurrenceCount = 0;
      const rollupEntries: EmployeeRollupEntry[] = [];
      const cells: BoardCell[] = columns.map((column) => {
        const day: EmployeeWorkingScheduleDay | null = column.weekday
          ? getWorkingDay(emp.workingSchedule, column.weekday)
          : null;
        const dayCapacity = day ? dailyCapacityMinutes(day) : 0;
        capacityMinutes += dayCapacity;
        const visits = sortVisits(byDate?.get(column.iso) ?? []);
        occurrenceCount += visits.length;
        for (const vm of visits) {
          rollupEntries.push({
            status: vm.entry.status,
            visitMinutes: vm.entry.visitMinutes,
            perEmployeeMinutes: vm.entry.perEmployeeMinutes,
          });
        }
        return {
          column,
          available: day?.isAvailable ?? false,
          capacityMinutes: dayCapacity,
          visits,
        };
      });
      const { onSiteMinutes, labourMinutes } = rollUpEmployeeWorkload(rollupEntries);
      return {
        employee: emp,
        cells,
        occurrenceCount,
        plannedMinutes: onSiteMinutes,
        labourMinutes,
        capacityMinutes,
      };
    });

    rows.sort((a, b) => {
      const aHas = a.plannedMinutes > 0 || a.cells.some((c) => c.visits.length > 0) ? 0 : 1;
      const bHas = b.plannedMinutes > 0 || b.cells.some((c) => c.visits.length > 0) ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return a.employee.name.localeCompare(b.employee.name);
    });

    let unassignedTotal = 0;
    let unassignedUnstaffed = 0;
    let unassignedOpenSlots = 0;
    const unassignedCells: BoardCell[] = columns.map((column) => {
      const visits = sortVisits(index.unassignedByDate.get(column.iso) ?? []);
      unassignedTotal += visits.length;
      for (const vm of visits) {
        if ((vm.entry.assignedEmployeeIds?.length ?? 0) === 0) unassignedUnstaffed += 1;
        unassignedOpenSlots += Math.max(0, vm.entry.openSlotCount ?? 0);
      }
      return { column, available: true, capacityMinutes: 0, visits };
    });

    const data: BoardData = {
      columns,
      rows,
      unassignedCells,
      unassignedTotal,
      unassignedUnstaffed,
      unassignedOpenSlots,
      dateMetrics: metrics.byDate,
    };
    stopBoard();
    return data;
  }, [viewModels, metrics, employees, columns]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), []);
  const stepBack = useCallback(() => {
    if (preset === "month") {
      setAnchor((d) => startOfMonth(addMonths(d, -1)));
      return;
    }
    setAnchor((d) => addDays(d, -presetStepDays(preset, columns)));
  }, [preset, columns]);
  const stepForward = useCallback(() => {
    if (preset === "month") {
      setAnchor((d) => startOfMonth(addMonths(d, 1)));
      return;
    }
    setAnchor((d) => addDays(d, presetStepDays(preset, columns)));
  }, [preset, columns]);

  // ── Dispatcher actions ────────────────────────────────────────────────────
  const [rescheduleTarget, setRescheduleTarget] = useState<ScheduleEntry | null>(null);
  const [occDraft, setOccDraft] = useState<{
    newDate: string;
    newStartTime: string;
    newEndTime: string;
  }>({ newDate: "", newStartTime: "", newEndTime: "" });
  const [assignTarget, setAssignTarget] = useState<ScheduleEntry | null>(null);
  const [noteTarget, setNoteTarget] = useState<ScheduleEntry | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ title: string; content: string }>({
    title: "",
    content: "",
  });

  const openWorkOrder = useCallback(
    (id: string) => {
      // Defensive: never navigate to a deleted/inactivated work order. Live
      // board entries already come from live work orders only, but a stale
      // reference (e.g. an orphaned occurrence) must fail safely with a clear
      // message instead of opening a broken work-order path.
      const wo = workOrders.find((w) => w.id === id);
      if (!wo || wo.status === "inactive") {
        toast({
          title: "Deleted / missing work order",
          description: "This work order is no longer available in live planning.",
          variant: "destructive",
        });
        return;
      }
      navigate(`/work-orders/${id}`);
    },
    [navigate, workOrders, toast],
  );
  const openCustomer = useCallback(
    (id: string) => navigate(`/customers/${id}`),
    [navigate],
  );

  const openReschedule = useCallback((entry: ScheduleEntry) => {
    setOccDraft({
      newDate: /^\d{4}-\d{2}-\d{2}$/.test(entry.displayDate)
        ? entry.displayDate
        : isoOf(new Date()),
      newStartTime: entry.startTime ?? "",
      newEndTime: entry.endTime ?? "",
    });
    setRescheduleTarget(entry);
  }, []);

  const submitReschedule = useCallback(() => {
    if (!rescheduleTarget) return;
    const res = rescheduleOccurrence(rescheduleTarget.occurrenceKey, {
      newDate: occDraft.newDate,
      newStartTime: occDraft.newStartTime,
      newEndTime: occDraft.newEndTime,
    });
    if (!res.ok) {
      toast({ title: "Couldn't reschedule", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Occurrence rescheduled",
      description: `${rescheduleTarget.serviceName} → ${formatDate(`${occDraft.newDate}T00:00:00`)}`,
    });
    setRescheduleTarget(null);
  }, [rescheduleTarget, occDraft, rescheduleOccurrence, toast]);

  const handleCancel = useCallback(
    (entry: ScheduleEntry) => {
      const res = cancelOccurrence(entry.occurrenceKey);
      if (!res.ok) {
        toast({ title: "Couldn't cancel", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Occurrence cancelled",
        description: `${entry.serviceName} on ${formatDate(`${entry.displayDate}T00:00:00`)} was cancelled.`,
      });
    },
    [cancelOccurrence, toast],
  );

  const handleRestore = useCallback(
    (entry: ScheduleEntry) => {
      const res = restoreOccurrence(entry.occurrenceKey);
      if (!res.ok) {
        toast({ title: "Couldn't restore", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Occurrence restored",
        description: `${entry.serviceName} on ${formatDate(`${entry.displayDate}T00:00:00`)} is active again.`,
      });
    },
    [restoreOccurrence, toast],
  );

  const openAssign = useCallback((entry: ScheduleEntry) => {
    setAssignTarget(entry);
  }, []);

  // Maps the selected board occurrence onto the shared assign-dialog target so
  // staffing is written to the same work-order service row with the same rules.
  const assignDialogTarget = useMemo<AssignDialogTarget | null>(() => {
    if (!assignTarget) return null;
    return {
      workOrderId: assignTarget.workOrderId,
      serviceRowId: assignTarget.parentServiceRowId,
      companyId: assignTarget.companyId,
      customerId: assignTarget.customerId,
      serviceName: assignTarget.serviceName,
      customerName: assignTarget.customerName,
      workOrderNumber: assignTarget.workOrderNumber,
      assignedEmployeeIds: assignTarget.assignedEmployeeIds,
      openSlots: Math.max(0, assignTarget.openSlotCount ?? 0),
      visitMinutes: assignTarget.visitMinutes,
      plannedStartTime: assignTarget.startTime,
      plannedEndTime: assignTarget.endTime,
      // Board cards act on a single occurrence: a recurring booking is reassigned
      // via a per-occurrence exception so the series stays untouched.
      occurrence: {
        occurrenceKey: assignTarget.occurrenceKey,
        isRecurring: (assignTarget.recurrenceInterval ?? "one_time") !== "one_time",
        displayDate: assignTarget.displayDate,
      },
    };
  }, [assignTarget]);

  const openNote = useCallback((entry: ScheduleEntry) => {
    setNoteDraft({ title: `Schedule note · ${entry.customerName}`, content: "" });
    setNoteTarget(entry);
  }, []);

  const submitNote = useCallback(() => {
    if (!noteTarget) return;
    const res = addWorkOrderNote(noteTarget.workOrderId, {
      title: noteDraft.title,
      content: noteDraft.content,
    });
    if (!res.ok) {
      toast({ title: "Couldn't add note", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Note added", description: `Added to ${noteTarget.workOrderNumber}.` });
    setNoteTarget(null);
  }, [noteTarget, noteDraft, addWorkOrderNote, toast]);

  const cardActions = useMemo<CardActions>(
    () => ({
      onOpenWorkOrder: openWorkOrder,
      onOpenCustomer: openCustomer,
      onReschedule: openReschedule,
      onCancel: handleCancel,
      onRestore: handleRestore,
      onAssign: openAssign,
      onNote: openNote,
    }),
    [openWorkOrder, openCustomer, openReschedule, handleCancel, handleRestore, openAssign, openNote],
  );

  // ── Drag & drop (Phase 1: same-date employee reassignment) ────────────────
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dropConfirm, setDropConfirm] = useState<DropConfirm | null>(null);
  // Time-conflict warnings for a pending schedule move (warning + override, not
  // a hard block — there's no availability data yet, so the dispatcher stays
  // able to deliberately schedule an overlap they know is fine).
  const [conflicts, setConflicts] = useState<ConflictWindow[]>([]);

  // Closing always clears any pending conflict warning so it can't leak into the
  // next drop.
  const closeDropConfirm = useCallback(() => {
    setDropConfirm(null);
    setConflicts([]);
  }, []);

  // Editing the start time invalidates any previously computed conflict list.
  const setDraftStartTime = useCallback((value: string) => {
    setConflicts([]);
    setDropConfirm((prev) => (prev ? { ...prev, draftStartTime: value } : prev));
  }, []);

  // Shared gesture resolution: evaluate (source × target) and, if actionable,
  // open the confirmation. `targetEmployee` is the dropped-on row, or null for an
  // Employee → Unassigned move.
  const beginDropConfirm = useCallback(
    (current: DragPayload, target: DropTarget, targetEmployee: Employee | null) => {
      const evaluation = evaluateDragAction(dragSourceFromPayload(current), target);
      if (evaluation.ok === false) {
        if (evaluation.reason === "blocked_multi") {
          toast({
            title: "Multiple employees assigned",
            description:
              "Use Assign / change employee for bookings with multiple employees.",
            variant: "destructive",
          });
        }
        return;
      }
      const { action } = evaluation;
      const resolution = resolveDragScope(action);
      const dateDelta = action.deltas.date;
      const timeDelta = action.deltas.time;
      const employeeKind = action.deltas.employee?.kind;
      const isSchedule = Boolean(dateDelta || timeDelta);
      setConflicts([]);
      setDropConfirm({
        entry: current.entry,
        kind: dateDelta ? "date" : timeDelta ? "time" : "employee",
        mode: dateDelta
          ? "move_date"
          : timeDelta
            ? "move_time"
            : employeeKind ?? "reassign",
        targetEmployee,
        currentLabel: current.sourceEmployeeName ?? "Open slot",
        toDate: dateDelta?.to,
        // Seed the editable start with the occurrence's current window so a
        // schedule move defaults to "keep the same time" until the dispatcher
        // changes it.
        draftStartTime: isSchedule ? current.entry.startTime ?? "" : undefined,
        showScopeShell: resolution.prompt,
        action,
        scope: resolution.scope,
      });
    },
    [toast],
  );

  const dropOnEmployee = useCallback(
    (targetEmployee: Employee, dateIso: string) => {
      const current = drag;
      setDrag(null);
      if (!current) return;
      beginDropConfirm(current, { employeeId: targetEmployee.id, date: dateIso }, targetEmployee);
    },
    [drag, beginDropConfirm],
  );

  const dropOnUnassigned = useCallback(
    (dateIso: string) => {
      const current = drag;
      setDrag(null);
      if (!current) return;
      beginDropConfirm(current, { unassigned: true, date: dateIso }, null);
    },
    [drag, beginDropConfirm],
  );

  const dnd = useMemo<BoardDnd>(
    () => ({
      active: drag,
      begin: setDrag,
      end: () => setDrag(null),
      dropOnEmployee,
      dropOnUnassigned,
    }),
    [drag, dropOnEmployee, dropOnUnassigned],
  );

  // Other occurrences on `date` that share an assigned employee with `entry` —
  // the only ones a time change could double-book. An unstaffed occurrence (open
  // slots, no assignee) can't clash with anyone, so it has no neighbours.
  const scheduleNeighboursFor = useCallback(
    (entry: ScheduleEntry, date: string): ConflictNeighbour[] => {
      const movingEmployees = entry.assignedEmployeeIds ?? [];
      if (movingEmployees.length === 0) return [];
      const movingSet = new Set(movingEmployees);
      return entries
        .filter(
          (e) =>
            e.occurrenceKey !== entry.occurrenceKey &&
            e.displayDate === date &&
            e.status !== "cancelled" &&
            (e.assignedEmployeeIds ?? []).some((id) => movingSet.has(id)),
        )
        .map((e) => ({
          occurrenceKey: e.occurrenceKey,
          date: e.displayDate,
          startTime: e.startTime,
          endTime: e.endTime,
          customerName: e.customerName,
          serviceName: e.serviceName,
          timeLabel: formatTimeRange(e.startTime, e.endTime) ?? "No time",
        }));
    },
    [entries],
  );

  // `override` skips the time-conflict gate (the dispatcher chose "Move anyway").
  const confirmDrop = useCallback(
    (override = false) => {
      if (!dropConfirm) return;
      const { entry, mode, targetEmployee, toDate, action, scope } = dropConfirm;
      const isSchedule = mode === "move_date" || mode === "move_time";

      // ── Schedule moves (date and/or time) ──────────────────────────────────
      // Both go through the existing reschedule writer: a per-occurrence
      // exception that overlays the day + window and preserves staffing, labour
      // and required headcount. Duration is preserved (the end slides with the
      // start). Only the selected occurrence is touched — no cascading.
      if (isSchedule) {
        const finalDate = mode === "move_date" ? toDate ?? entry.displayDate : entry.displayDate;
        const draftStart = (dropConfirm.draftStartTime ?? "").trim();
        let scheduleWrite: { date: string; startTime?: string; endTime?: string };
        if (draftStart) {
          const parsed = parseTime24(draftStart);
          if (!parsed) {
            toast({
              title: "Invalid time",
              description: "Enter a valid time like 09:00.",
              variant: "destructive",
            });
            return;
          }
          const built = buildTimeScheduleWrite({
            date: finalDate,
            currentStart: entry.startTime,
            currentEnd: entry.endTime,
            newStart: parsed,
          });
          scheduleWrite = {
            date: built.date,
            startTime: built.startTime,
            endTime: built.endTime ?? undefined,
          };
        } else {
          // No explicit time → preserve the occurrence's current window.
          scheduleWrite = {
            date: finalDate,
            startTime: entry.startTime ?? undefined,
            endTime: entry.endTime ?? undefined,
          };
        }

        // Conflict gate (warning + override). Only meaningful with a full window.
        if (!override && scheduleWrite.startTime && scheduleWrite.endTime) {
          const found = detectTimeConflicts(
            {
              occurrenceKey: entry.occurrenceKey,
              date: finalDate,
              startTime: scheduleWrite.startTime,
              endTime: scheduleWrite.endTime,
            },
            scheduleNeighboursFor(entry, finalDate),
          );
          if (found.length > 0) {
            setConflicts(found);
            return;
          }
        }

        const res = applyDragWrite(
          {
            scope,
            occurrenceKey: entry.occurrenceKey,
            parentServiceRowId: entry.parentServiceRowId,
            workOrderId: entry.workOrderId,
            schedule: scheduleWrite,
          },
          {
            reassignOccurrence,
            updateServiceRow: updateWorkOrderServiceRow,
            rescheduleOccurrence,
          },
        );
        if (!res.ok) {
          toast({ title: "Couldn't move", description: res.error, variant: "destructive" });
          return;
        }
        toast({
          title: mode === "move_date" ? "Occurrence moved" : "Time updated",
          description:
            mode === "move_date"
              ? `${entry.serviceName} → ${formatDate(`${finalDate}T00:00:00`)}`
              : `${entry.serviceName} → ${formatTimeRange(scheduleWrite.startTime ?? null, scheduleWrite.endTime ?? null) ?? "No time"}`,
        });
        closeDropConfirm();
        return;
      }

      // ── Employee moves (reassign / fill_slot / unassign) ───────────────────
      const write = planDragWrite({
        action,
        scope,
        staffing: {
          assignedEmployeeIds: entry.assignedEmployeeIds ?? [],
          openSlotCount: Math.max(0, entry.openSlotCount ?? 0),
          labourMinutes: entry.labourMinutes,
          isLabourRedistributed: entry.isLabourRedistributed,
        },
      });
      const res = applyDragWrite(write, {
        reassignOccurrence,
        updateServiceRow: updateWorkOrderServiceRow,
        rescheduleOccurrence,
      });
      if (!res.ok) {
        toast({
          title: mode === "unassign" ? "Couldn't unassign" : "Couldn't reassign",
          description: res.error,
          variant: "destructive",
        });
        return;
      }
      if (mode === "unassign") {
        toast({
          title: "Employee removed",
          description: `${entry.serviceName} → open staffing slot`,
        });
      } else {
        toast({
          title: mode === "fill_slot" ? "Open slot filled" : "Booking reassigned",
          description: `${entry.serviceName} → ${targetEmployee?.name ?? ""}`,
        });
      }
      closeDropConfirm();
    },
    [
      dropConfirm,
      scheduleNeighboursFor,
      reassignOccurrence,
      updateWorkOrderServiceRow,
      rescheduleOccurrence,
      closeDropConfirm,
      toast,
    ],
  );

  const distinctOccurrences = entries.length;
  const periodLabel =
    columns.length <= 1
      ? formatDate(`${range.fromDate}T00:00:00`)
      : `${formatDate(`${range.fromDate}T00:00:00`)} – ${formatDate(`${range.toDate}T00:00:00`)}`;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Schedule"
        description="Employee planning board. The selected period sets the columns, employees are the rows, and every occurrence, status and modifier is resolved from the shared Schedule Core — mirroring the Booking Queue exactly."
      />

      {/* Controls: period presets · navigation · period · show cancelled */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5">
          {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                preset === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        {preset !== "custom" ? (
          <div className="flex items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={stepBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={goToday}>
              Today
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={stepForward}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 w-[9.5rem]"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 w-[9.5rem]"
            />
          </div>
        )}

        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {periodLabel}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span className="font-medium text-foreground">{distinctOccurrences}</span>
            {distinctOccurrences === 1 ? "occurrence" : "occurrences"}
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showCancelled} onCheckedChange={setShowCancelled} />
            Show cancelled
          </label>
        </div>
      </div>

      <SummaryBar metrics={metrics} />

      <PlanningBoard data={board} actions={cardActions} dnd={dnd} />

      {/* Reschedule occurrence dialog — writes a BookingOccurrenceException. */}
      <Dialog
        open={rescheduleTarget !== null}
        onOpenChange={(open) => !open && setRescheduleTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule occurrence</DialogTitle>
            <DialogDescription>
              {rescheduleTarget
                ? `${rescheduleTarget.customerName} · ${rescheduleTarget.serviceName} (${rescheduleTarget.workOrderNumber})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sch-rs-date">New date</Label>
              <Input
                id="sch-rs-date"
                type="date"
                value={occDraft.newDate}
                onChange={(e) => setOccDraft((d) => ({ ...d, newDate: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sch-rs-start">Start time</Label>
                <TimePicker
                  id="sch-rs-start"
                  value={occDraft.newStartTime}
                  onChange={(v) => setOccDraft((d) => ({ ...d, newStartTime: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sch-rs-end">End time</Label>
                <TimePicker
                  id="sch-rs-end"
                  value={occDraft.newEndTime}
                  onChange={(v) => setOccDraft((d) => ({ ...d, newEndTime: v }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Moves only this occurrence. The recurring rule and every other
              occurrence in the series stay unchanged.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitReschedule}>Save move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drag & drop — confirm before any write (employee reassign OR date move). */}
      <Dialog open={dropConfirm !== null} onOpenChange={(open) => !open && closeDropConfirm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dropConfirm?.mode === "move_date"
                ? `Move this occurrence to ${dropConfirm?.toDate ? formatDate(`${dropConfirm.toDate}T00:00:00`) : ""}?`
                : dropConfirm?.mode === "move_time"
                  ? "Move this occurrence to another time?"
                  : dropConfirm?.mode === "unassign"
                    ? "Remove employee from occurrence?"
                    : dropConfirm?.mode === "fill_slot"
                      ? `Fill open slot with ${dropConfirm?.targetEmployee?.name ?? ""}?`
                      : `Assign this occurrence to ${dropConfirm?.targetEmployee?.name ?? ""}?`}
            </DialogTitle>
            <DialogDescription>
              {dropConfirm
                ? `${dropConfirm.entry.customerName} · ${dropConfirm.entry.serviceName} (${dropConfirm.entry.workOrderNumber})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {dropConfirm ? (
            dropConfirm.mode === "unassign" ? (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
                <p className="text-sm text-foreground">
                  You are removing <span className="font-semibold">{dropConfirm.currentLabel}</span>{" "}
                  from this occurrence and leaving the staffing need open.
                </p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatDate(`${dropConfirm.entry.displayDate}T00:00:00`)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatTimeRange(dropConfirm.entry.startTime, dropConfirm.entry.endTime) ?? "No time"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Removed</span>
                  <span className="font-medium text-foreground">{dropConfirm.currentLabel}</span>
                </div>
                <p className="pt-1 text-[11px] text-muted-foreground">
                  This occurrence will have an open staffing slot — same date, time, duration
                  and total labour.
                  {(dropConfirm.entry.recurrenceInterval ?? "one_time") !== "one_time"
                    ? " This affects only this occurrence; the recurring series stays unchanged."
                    : ""}
                </p>
              </div>
            ) : dropConfirm.mode === "move_date" || dropConfirm.mode === "move_time" ? (
              <ScheduleMoveEditor
                entry={dropConfirm.entry}
                mode={dropConfirm.mode}
                toDate={dropConfirm.toDate}
                draftStartTime={dropConfirm.draftStartTime ?? ""}
                onStartTimeChange={setDraftStartTime}
                conflicts={conflicts}
                showScopeShell={dropConfirm.showScopeShell}
              />
            ) : (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatDate(`${dropConfirm.entry.displayDate}T00:00:00`)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatTimeRange(dropConfirm.entry.startTime, dropConfirm.entry.endTime) ?? "No time"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {dropConfirm.mode === "fill_slot" ? "From" : "Current"}
                  </span>
                  <span className="font-medium text-foreground">{dropConfirm.currentLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {dropConfirm.mode === "fill_slot" ? "Assign" : "New"}
                  </span>
                  <span className="font-medium text-foreground">{dropConfirm.targetEmployee?.name ?? ""}</span>
                </div>
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Only the assigned employee changes — same date, time, duration and total
                  labour.
                  {(dropConfirm.entry.recurrenceInterval ?? "one_time") !== "one_time"
                    ? " This affects only this occurrence; the recurring series stays unchanged."
                    : ""}
                </p>
              </div>
            )
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDropConfirm}>
              Cancel
            </Button>
            {conflicts.length > 0 ? (
              <Button variant="destructive" onClick={() => confirmDrop(true)}>
                Move anyway
              </Button>
            ) : (
              <Button onClick={() => confirmDrop()}>
                {dropConfirm?.mode === "move_date"
                  ? "Move"
                  : dropConfirm?.mode === "move_time"
                    ? "Update time"
                    : dropConfirm?.mode === "unassign"
                      ? "Move to Unassigned"
                      : dropConfirm?.mode === "fill_slot"
                        ? "Fill slot"
                        : "Assign"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign / change employees — shared dialog writes the service row. */}
      <AssignEmployeesDialog
        target={assignDialogTarget}
        onClose={() => setAssignTarget(null)}
        onOpenWorkOrder={openWorkOrder}
      />

      {/* Add internal note — appended to the work order with an activity entry. */}
      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && setNoteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add internal note</DialogTitle>
            <DialogDescription>
              {noteTarget
                ? `${noteTarget.customerName} · ${noteTarget.serviceName} (${noteTarget.workOrderNumber})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sch-note-title">Title</Label>
              <Input
                id="sch-note-title"
                value={noteDraft.title}
                onChange={(e) => setNoteDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sch-note-content">Note</Label>
              <Textarea
                id="sch-note-content"
                placeholder="Context for the dispatcher / crew…"
                value={noteDraft.content}
                onChange={(e) => setNoteDraft((d) => ({ ...d, content: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitNote}>Add note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

/**
 * The body of a schedule-move confirmation (date and/or time). Shows the
 * before/after date + time, an EDITABLE start time (duration is preserved — the
 * end slides with the start), the unchanged employee/staffing, any time-conflict
 * warning, and the scope shell for recurring bookings. Only the selected
 * occurrence is affected; no other booking is moved (no cascading, v1).
 */
function ScheduleMoveEditor({
  entry,
  mode,
  toDate,
  draftStartTime,
  onStartTimeChange,
  conflicts,
  showScopeShell,
}: {
  entry: ScheduleEntry;
  mode: "move_date" | "move_time";
  toDate?: string;
  draftStartTime: string;
  onStartTimeChange: (value: string) => void;
  conflicts: ConflictWindow[];
  showScopeShell: boolean;
}) {
  const finalDate = mode === "move_date" ? toDate ?? entry.displayDate : entry.displayDate;
  const parsedStart = draftStartTime.trim() ? parseTime24(draftStartTime.trim()) : null;
  // Preview the resulting window with the preserved duration.
  const preview = parsedStart
    ? buildTimeScheduleWrite({
        date: finalDate,
        currentStart: entry.startTime,
        currentEnd: entry.endTime,
        newStart: parsedStart,
      })
    : null;
  const newWindowLabel = preview
    ? formatTimeRange(preview.startTime, preview.endTime ?? null) ?? preview.startTime
    : null;
  const currentWindowLabel = formatTimeRange(entry.startTime, entry.endTime) ?? "No time";
  const employeeLabel =
    (entry.assignedEmployeeNames ?? []).length > 0
      ? entry.assignedEmployeeNames.join(", ")
      : "Unassigned";
  const isRecurring = (entry.recurrenceInterval ?? "one_time") !== "one_time";

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Date</span>
          {mode === "move_date" ? (
            <span className="flex items-center gap-2 font-medium tabular-nums text-foreground">
              <span className="text-muted-foreground line-through">
                {formatDate(`${entry.displayDate}T00:00:00`)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{formatDate(`${finalDate}T00:00:00`)}</span>
            </span>
          ) : (
            <span className="font-medium tabular-nums text-foreground">
              {formatDate(`${finalDate}T00:00:00`)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Employee</span>
          <span className="font-medium text-foreground">{employeeLabel}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sch-drag-start">Start time</Label>
        <TimePicker
          id="sch-drag-start"
          value={draftStartTime}
          onChange={onStartTimeChange}
        />
        <p className="text-[11px] text-muted-foreground">
          {newWindowLabel
            ? `New window ${newWindowLabel} · was ${currentWindowLabel}. Duration is preserved.`
            : "Pick a start time. The duration is preserved — the end moves with the start."}
        </p>
      </div>

      {conflicts.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Time conflict detected
          </div>
          <p className="text-[11px] text-muted-foreground">
            This booking overlaps with the same employee’s other work. No changes have
            been made yet.
          </p>
          <ul className="space-y-0.5 pt-1">
            {conflicts.map((c) => (
              <li key={c.occurrenceKey} className="text-foreground">
                <span className="font-medium">{c.customerName}</span>{" "}
                <span className="tabular-nums text-muted-foreground">{c.timeLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Only the scheduled window changes — same duration, total labour and staffing.
          {isRecurring
            ? " This affects only this occurrence; the recurring series stays unchanged."
            : ""}
        </p>
      )}

      {showScopeShell ? <DragScopeSelector /> : null}
    </div>
  );
}

/**
 * Scope selector for a recurring date move — Phase 3A UI SHELL.
 *
 * Only "Only this occurrence" is wired (it maps to the per-occurrence reschedule
 * exception). "From this date forward" and "Entire work order" are shown but
 * disabled until their writers land (RecurringVariation / service-row date), so
 * dispatchers can see where future scope choices will live without any new
 * persistence path being reachable yet.
 */
function DragScopeSelector() {
  const options: { id: string; label: string; hint: string; enabled: boolean }[] = [
    {
      id: "occurrence",
      label: "Only this occurrence",
      hint: "Move just this day; the recurring series stays unchanged.",
      enabled: true,
    },
    {
      id: "from_here_forward",
      label: "From this date forward",
      hint: "Coming soon.",
      enabled: false,
    },
    { id: "series", label: "Entire work order", hint: "Coming soon.", enabled: false },
  ];
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Apply to
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {options.map((opt) => (
          <div
            key={opt.id}
            aria-disabled={!opt.enabled}
            className={cn(
              "flex items-start gap-2.5 px-3 py-2.5",
              opt.enabled ? "bg-primary/5" : "opacity-50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                opt.enabled ? "border-primary" : "border-muted-foreground/40",
              )}
            >
              {opt.enabled ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground">{opt.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One tile in the operational summary bar. */
function SummaryTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className={cn("shrink-0", toneClass)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-base font-semibold tabular-nums text-foreground">{value}</p>
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/**
 * The operational summary bar for the selected period. Every figure is derived
 * from the distinct-occurrence entry list via {@link computeScheduleBoardMetrics},
 * so a multi-employee occurrence is counted exactly once and the totals never
 * inflate, regardless of how many employee rows it renders under.
 */
function SummaryBar({ metrics }: { metrics: ScheduleBoardMetrics }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
      <SummaryTile icon={Layers} label="Occurrences" value={metrics.totalOccurrences} />
      <SummaryTile icon={UserCheck} label="Fully staffed" value={metrics.fullyStaffed} tone="good" />
      <SummaryTile
        icon={UserCog}
        label="Partially staffed"
        value={metrics.partiallyStaffed}
        tone={metrics.partiallyStaffed > 0 ? "warn" : "neutral"}
      />
      <SummaryTile
        icon={UserMinus}
        label="Unstaffed"
        value={metrics.unstaffed}
        tone={metrics.unstaffed > 0 ? "warn" : "neutral"}
      />
      <SummaryTile
        icon={XCircle}
        label="Cancelled"
        value={metrics.cancelled}
        tone={metrics.cancelled > 0 ? "bad" : "neutral"}
      />
      <SummaryTile icon={Clock} label="Planned labour" value={formatHoursLabel(metrics.labourMinutes)} />
      <SummaryTile
        icon={CircleSlash}
        label="Open slots"
        value={metrics.openSlots}
        tone={metrics.openSlots > 0 ? "warn" : "neutral"}
      />
    </div>
  );
}

/** Shared grid template: a fixed employee column + one min-width date column each. */
function gridTemplate(columnCount: number): string {
  return `minmax(13rem, 14rem) repeat(${columnCount}, minmax(9.5rem, 1fr))`;
}

/**
 * The planning board: a horizontally scrollable grid. Row 1 is the date header
 * (sticky top). The first column (sticky left) is the employee/capacity rail;
 * each subsequent column is a date. The "Unassigned / Open slots" row is always
 * rendered last.
 */
function PlanningBoard({
  data,
  actions,
  dnd,
}: {
  data: BoardData;
  actions: CardActions;
  dnd: BoardDnd;
}) {
  const { columns, rows, unassignedCells, unassignedUnstaffed, unassignedOpenSlots, dateMetrics } =
    data;
  if (columns.length === 0) {
    return <EmptyState message="No dates in the selected period." />;
  }
  const template = gridTemplate(columns.length);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="min-w-fit">
        {/* Header row */}
        <div
          className="sticky top-0 z-20 grid border-b border-border bg-muted/60 backdrop-blur"
          style={{ gridTemplateColumns: template }}
        >
          <div className="sticky left-0 z-30 flex items-center gap-2 border-r border-border bg-muted/60 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            <Users className="h-3.5 w-3.5" />
            Employee
          </div>
          {columns.map((column) => {
            const dm = dateMetrics.get(column.iso);
            const occurrences = dm?.occurrences ?? 0;
            const openSlots = dm?.openSlots ?? 0;
            return (
              <div
                key={column.iso}
                className={cn(
                  "border-r border-border px-2 py-2 text-center last:border-r-0",
                  column.isWeekend && "bg-muted/40",
                  column.isToday && "bg-primary/10",
                )}
              >
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wide",
                    column.isToday ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {column.shortLabel}
                </p>
                <p className="text-xs font-medium tabular-nums text-foreground">{column.dayNum}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {occurrences} {occurrences === 1 ? "booking" : "bookings"}
                </p>
                <p
                  className={cn(
                    "text-[11px] tabular-nums",
                    openSlots > 0 ? "font-medium text-amber-600" : "text-muted-foreground/60",
                  )}
                >
                  {openSlots} open {openSlots === 1 ? "slot" : "slots"}
                </p>
              </div>
            );
          })}
        </div>

        {/* Employee rows */}
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            No employees to schedule for this period.
          </div>
        ) : (
          rows.map((row) => (
            <EmployeeRow
              key={row.employee.id}
              row={row}
              template={template}
              actions={actions}
              dnd={dnd}
            />
          ))
        )}

        {/* Unassigned / open slots — always visible */}
        <div className="grid border-t-2 border-amber-300/60" style={{ gridTemplateColumns: template }}>
          <div className="sticky left-0 z-10 border-r border-border bg-amber-50/80 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Users className="h-3 w-3" />
              </span>
              <span className="text-sm font-semibold text-amber-800">Unassigned</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-700/80">
              {unassignedUnstaffed} unstaffed {unassignedUnstaffed === 1 ? "occurrence" : "occurrences"}
            </p>
            <p className="text-[11px] font-medium text-amber-700">
              {unassignedOpenSlots} open {unassignedOpenSlots === 1 ? "slot" : "slots"}
            </p>
          </div>
          {unassignedCells.map((cell) => (
            <BoardCellView
              key={cell.column.iso}
              cell={cell}
              actions={actions}
              tone="unassigned"
              dnd={dnd}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** One employee row: sticky capacity rail + a cell per date column. */
function EmployeeRow({
  row,
  template,
  actions,
  dnd,
}: {
  row: BoardEmployeeRow;
  template: string;
  actions: CardActions;
  dnd: BoardDnd;
}) {
  const { employee, cells, occurrenceCount, plannedMinutes, labourMinutes, capacityMinutes } = row;
  // Capacity/utilisation reflects actual planned workload (labour), not the
  // visible visit window.
  const freeMinutes = capacityMinutes - labourMinutes;
  const overbooked = freeMinutes < 0;
  const pct =
    capacityMinutes > 0 ? Math.min(100, Math.round((labourMinutes / capacityMinutes) * 100)) : 0;
  const redistributed = labourMinutes !== plannedMinutes;

  return (
    <div className="grid border-b border-border last:border-b-0" style={{ gridTemplateColumns: template }}>
      {/* Sticky employee rail */}
      <div className="sticky left-0 z-10 border-r border-border bg-card px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserIcon className="h-3 w-3" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{employee.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {occurrenceCount} {occurrenceCount === 1 ? "visit" : "visits"}
              {employee.title ? ` · ${employee.title}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] leading-tight text-muted-foreground">
          <span className="tabular-nums">
            On-site <span className="font-medium text-foreground">{formatHoursLabel(plannedMinutes)}</span>
          </span>
          <span className="tabular-nums">
            Labour{" "}
            <span className={cn("font-medium", redistributed ? "text-amber-600" : "text-foreground")}>
              {formatHoursLabel(labourMinutes)}
            </span>
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] leading-tight">
          <span className="font-medium tabular-nums text-foreground">
            Capacity {formatHoursLabel(labourMinutes)}
            <span className="font-normal text-muted-foreground">
              {" / "}
              {formatHoursLabel(capacityMinutes)}
            </span>
          </span>
          <span
            className={cn(
              "tabular-nums",
              overbooked ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {overbooked ? `${formatHoursLabel(-freeMinutes)} over` : `${formatHoursLabel(freeMinutes)} free`}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", overbooked ? "bg-destructive" : "bg-primary")}
            style={{ width: `${overbooked ? 100 : pct}%` }}
          />
        </div>
      </div>

      {/* Date cells */}
      {cells.map((cell) => (
        <BoardCellView
          key={cell.column.iso}
          cell={cell}
          actions={actions}
          tone="employee"
          dnd={dnd}
          rowEmployee={employee}
        />
      ))}
    </div>
  );
}

/** A single date cell: visit chips, "Free", or an "Unavailable" treatment. */
function BoardCellView({
  cell,
  actions,
  tone,
  dnd,
  rowEmployee,
}: {
  cell: BoardCell;
  actions: CardActions;
  tone: "employee" | "unassigned";
  dnd: BoardDnd;
  /** The employee owning this row (employee cells only) — the drop target. */
  rowEmployee?: Employee;
}) {
  const { column, available, visits } = cell;
  const unavailable = tone === "employee" && !available;
  const [isOver, setIsOver] = useState(false);

  // Both employee cells and the Unassigned row accept drops. Compute the live
  // eligibility against the active drag so the cell can both accept the drop and
  // show the right hover affordance (positive for a real change, "blocked" for a
  // multi-assignee employee drop). A multi-assignee card still "accepts" the drop
  // (so it can surface the blocked hover + toast); only "invalid" drops are inert.
  const dropTarget: DropTarget = rowEmployee
    ? { employeeId: rowEmployee.id, date: column.iso }
    : { unassigned: true, date: column.iso };
  const evaluation = dnd.active
    ? evaluateDragAction(dragSourceFromPayload(dnd.active), dropTarget)
    : ({ ok: false, reason: "invalid" } as const);
  const isBlocked = evaluation.ok === false && evaluation.reason === "blocked_multi";
  const isDateMove = evaluation.ok && Boolean(evaluation.action.deltas.date);
  const isUnassignMove = evaluation.ok && evaluation.action.deltas.employee?.kind === "unassign";
  const accepts = evaluation.ok || isBlocked;
  const sourceEmployeeId = rowEmployee?.id ?? null;
  const sourceEmployeeName = rowEmployee?.name ?? null;

  return (
    <div
      onDragOver={(e) => {
        if (!accepts) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={() => {
        if (isOver) setIsOver(false);
      }}
      onDrop={(e) => {
        if (!accepts) return;
        e.preventDefault();
        setIsOver(false);
        if (rowEmployee) dnd.dropOnEmployee(rowEmployee, column.iso);
        else dnd.dropOnUnassigned(column.iso);
      }}
      className={cn(
        "min-h-[6rem] border-r border-border p-1.5 last:border-r-0 transition-colors",
        column.isWeekend && "bg-muted/30",
        column.isToday && "bg-primary/[0.04]",
        unavailable && "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,hsl(var(--muted))_6px,hsl(var(--muted))_7px)]",
        isOver && !isBlocked && "bg-primary/10 ring-2 ring-inset ring-primary/60",
        isOver && isBlocked && "bg-destructive/5 ring-2 ring-inset ring-destructive/50",
      )}
    >
      {visits.length === 0 ? (
        <div className="flex h-full min-h-[5rem] items-center justify-center">
          <span className="text-[11px] text-muted-foreground/50">
            {isOver
              ? isBlocked
                ? "Multiple employees"
                : isUnassignMove
                  ? "Drop to unassign"
                  : isDateMove
                    ? "Drop to move here"
                    : "Drop to assign"
              : unavailable
                ? "Unavailable"
                : "Free"}
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visits.map((vm) => (
            <VisitChip
              key={vm.entry.occurrenceKey}
              vm={vm}
              actions={actions}
              dnd={dnd}
              sourceEmployeeId={sourceEmployeeId}
              sourceEmployeeName={sourceEmployeeName}
              sourceDate={column.iso}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A dense occurrence chip inside a board cell. A coloured left accent + icon
 * carries the primary operational status (Cancelled / Rebooked / Variation /
 * Scheduled / Unscheduled); modifier chips show Changed / Auto / Pending. The
 * chip opens a dropdown with the full status and the dispatcher actions, all of
 * which delegate to the shared authoritative mutations.
 */
/** Colour token for the customer-time signal dot. */
const PREFERRED_DOT: Partial<Record<PreferredTimeStatus, { className: string; label: string }>> = {
  optimal: { className: "bg-emerald-500", label: "Optimal customer time" },
  acceptable: { className: "bg-amber-500", label: "Acceptable customer time" },
  outside_range: { className: "bg-red-500", label: "Outside preferred customer time" },
};

/**
 * The primary customer-time signal: a small filled dot (🟢/🟡/🔴) shown before
 * the scheduled time. Renders nothing when there's no preference data or the
 * occurrence couldn't be evaluated, keeping the row clean. Intentionally NOT a
 * clock icon — this is reserved as the leading scheduling signal.
 */
function PreferredTimeDot({ confirmation }: { confirmation: PreferredTimeEvaluationResult | null }) {
  if (!confirmation) return null;
  const meta = PREFERRED_DOT[confirmation.status];
  if (!meta) return null;
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={confirmation.reason ? `${meta.label} — ${confirmation.reason}` : meta.label}
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", meta.className)}
    />
  );
}

function VisitChip({
  vm,
  actions,
  dnd,
  sourceEmployeeId,
  sourceEmployeeName,
  sourceDate,
}: {
  vm: EntryViewModel;
  actions: CardActions;
  dnd: BoardDnd;
  /** The employee row this chip is rendered in (null for the Unassigned row). */
  sourceEmployeeId: string | null;
  sourceEmployeeName: string | null;
  sourceDate: string;
}) {
  const { entry, operational, modifiers, confirmation } = vm;
  const cancelled = entry.status === "cancelled";
  // Cancelled occurrences can't be reassigned by drag.
  const draggable = !cancelled;
  const StatusIcon = STATUS_ICON[operational.status];
  const isOneTime = entry.recurrenceInterval === "one_time";
  const RecurrenceIcon = isOneTime ? Circle : Repeat;
  const hasAddress = Boolean(entry.customerStreet || entry.customerPostalCode || entry.customerCity);
  // Scheduled TIME = the actual on-site work window. When work is split across a
  // larger crew (or redistributed onto a smaller one) the on-site duration
  // differs from the customer/booked window, so TIME must reflect the on-site
  // window and the booked window is labelled separately.
  const scheduled = resolveScheduledWindow({
    plannedStartTime: entry.startTime,
    plannedEndTime: entry.endTime,
    visitMinutes: entry.visitMinutes,
    perEmployeeMinutes: entry.perEmployeeMinutes,
  });
  const timeLabel = formatTimeRange(scheduled.scheduledStartTime, scheduled.scheduledEndTime);
  const openSlots = Math.max(0, entry.openSlotCount ?? 0);
  const labour = buildVisitChipLabour({
    // "Visit" reflects the actual on-site duration, not the booked window.
    visitMinutes: scheduled.onSiteMinutes,
    labourMinutes: entry.labourMinutes,
    perEmployeeMinutes: entry.perEmployeeMinutes,
    assignedEmployeeNames: entry.assignedEmployeeNames ?? [],
    isLabourRedistributed: entry.isLabourRedistributed,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          draggable={draggable}
          onDragStart={(e) => {
            if (!draggable) return;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", entry.occurrenceKey);
            dnd.begin({ entry, sourceEmployeeId, sourceEmployeeName, sourceDate });
          }}
          onDragEnd={() => dnd.end()}
          className={cn(
            "relative flex w-full flex-col gap-2 rounded-lg border border-l-[3px] border-border bg-background px-2.5 py-2.5 text-left transition-colors hover:bg-muted/60",
            ACCENT_BORDER[operational.color],
            cancelled && "opacity-70",
            draggable && "cursor-grab active:cursor-grabbing",
          )}
        >
          {/* Staffing indicator — upper-right, assigned-only count + open slots */}
          {!cancelled ? (
            <StaffingIndicator
              assignedCount={entry.assignedEmployeeIds?.length ?? 0}
              openSlots={openSlots}
              className="absolute right-2 top-2"
            />
          ) : null}

          {/* Who + what: recurring/one-time glyph, customer name, service */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 pr-12">
              <RecurrenceIcon
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                strokeWidth={2}
                aria-label={isOneTime ? "One-time booking" : "Recurring booking"}
              />
              <p
                className={cn(
                  "truncate text-sm font-semibold text-foreground",
                  cancelled && "line-through",
                )}
              >
                {entry.customerName || "\u2014"}
              </p>
            </div>
            <p className="truncate pl-5 text-[11px] text-muted-foreground">{entry.serviceName}</p>
          </div>

          {/* Where: customer address */}
          {hasAddress ? (
            <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="min-w-0">
                {entry.customerStreet ? (
                  <span className="block truncate text-foreground">{entry.customerStreet}</span>
                ) : null}
                {entry.customerPostalCode || entry.customerCity ? (
                  <span className="block truncate">
                    {[entry.customerPostalCode, entry.customerCity].filter(Boolean).join(" ")}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}

          {/* When: customer-time dot + scheduled window + [duration / labour] */}
          <div className="flex items-center gap-1.5">
            {cancelled ? (
              <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", STATUS_ICON_COLOR[operational.color])} />
            ) : (
              <PreferredTimeDot confirmation={confirmation} />
            )}
            <span className="truncate text-[11px] font-semibold tabular-nums text-foreground">
              {timeLabel ?? "No time"}
            </span>
            {!cancelled && labour.summaryLabel ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {labour.isRedistributed ? (
                  <Split className="h-2.5 w-2.5 text-sky-600" />
                ) : null}
                {labour.summaryLabel}
              </span>
            ) : null}
          </div>

          {modifiers.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              <BookingModifiers modifiers={modifiers} />
            </div>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="py-2">
          <div className="flex flex-wrap items-center gap-1">
            <BookingOperationalStatusBadge status={operational} />
            <BookingModifiers modifiers={modifiers} />
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!cancelled && (
          <DropdownMenuItem onClick={() => actions.onReschedule(entry)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Reschedule occurrence
          </DropdownMenuItem>
        )}
        {!cancelled && (
          <DropdownMenuItem onClick={() => actions.onAssign(entry)}>
            <UserCog className="mr-2 h-4 w-4" />
            Assign / change employee
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => actions.onNote(entry)}>
          <StickyNote className="mr-2 h-4 w-4" />
          Add internal note
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => actions.onOpenWorkOrder(entry.workOrderId)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open work order
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onOpenCustomer(entry.customerId)}>
          <UserIcon className="mr-2 h-4 w-4" />
          Open customer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {cancelled ? (
          <DropdownMenuItem onClick={() => actions.onRestore(entry)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Restore occurrence
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => actions.onCancel(entry)}
            className="text-destructive focus:text-destructive"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancel occurrence
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        <Inbox className="h-8 w-8 opacity-40" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
