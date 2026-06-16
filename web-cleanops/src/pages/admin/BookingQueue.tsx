import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Inbox,
  Info,
  Layers,
  MoreVertical,
  RotateCcw,
  Search,
  Split,
  StickyNote,
  Users,
  XCircle,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { perf } from "@/lib/perf";
import { formatDate, formatDateTime, formatTimeRange, formatWeekday } from "@/lib/format";
import {
  buildOccurrenceChangeMessage,
  buildRescheduleMessage,
  rescheduleLogSummary,
} from "@/lib/rescheduleMessaging";
import {
  resolveBookingModifiers,
  resolveBookingOperationalStatus,
} from "@/lib/bookingStatus";
import {
  BookingModifiers,
  BookingOperationalStatusBadge,
} from "@/components/BookingStatusBadges";
import {
  AssignEmployeesDialog,
  type AssignDialogTarget,
} from "@/components/AssignEmployeesDialog";
import {
  evaluatePreferredTimeStatus,
  isPreferredTimeEvaluationAvailable,
  preferredTimeInputFromPreferences,
} from "@/lib/evaluatePreferredTime";
import { buildVisitChipLabour } from "@/lib/scheduleCellLabour";
import { collectOperationalNotes } from "@/lib/operationalNotes";
import type { OperationalNoteGroup } from "@/lib/operationalNotes";
import {
  applyOccurrenceException,
  bookingHorizonEndDate,
  buildBookingOccurrence,
  calculatePlannedDurationMinutes,
  calculatePlannedLabourMinutes,
  formatBookingDuration,
  indexOccurrenceExceptions,
  makeOccurrenceKey,
  RECURRENCE_INTERVAL_LABELS,
  BOOKING_ASSIGNMENT_STATUS_LABELS,
  normalizeUnassignedSlots,
} from "@/types";
import type {
  BookingOccurrence,
  BookingQueueItem,
  Customer,
  CustomerSchedulingPreferences,
  RecurringVariation,
  WeekDay,
  WorkOrder,
  WorkOrderActivityAction,
  WorkOrderServiceRow,
} from "@/types";
import { recurrenceOccurrences } from "@/lib/recurrence";
import {
  occurrenceIndexFromStart,
  resolveOccurrenceVariations,
} from "@/lib/variationResolver";
import type { OccurrenceVariationResolution } from "@/lib/variationResolver";
import {
  isAfterServiceEnd,
  isHiddenOrphanOccurrence,
  isLiveSourceRow,
  isLiveWorkOrder,
} from "@/lib/serviceEndDateGuard";
import { normalizeBookingQueueItem } from "@/lib/bookingQueueNormalize";
import { resolveOccurrenceDurationMinutes } from "@/lib/bookingQueueDuration";
import { resolveScheduledWindow } from "@/lib/scheduledWindow";
import { StaffingIndicator } from "@/components/StaffingIndicator";

/** The available quick date filters, in display order. */
type DateFilter =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "currentWeek"
  | "previousWeek"
  | "currentMonth"
  | "previousMonth"
  | "nextMonth"
  | "custom";

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "currentWeek", label: "This Week" },
  { value: "previousWeek", label: "Previous Week" },
  { value: "currentMonth", label: "This Month" },
  { value: "previousMonth", label: "Previous Month" },
  { value: "nextMonth", label: "Next Month" },
  { value: "custom", label: "Custom Date Range" },
];

const DATE_FILTER_LABELS: Record<DateFilter, string> = Object.fromEntries(
  DATE_FILTER_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DateFilter, string>;

/**
 * How many rows are shown per page. "all" loads every matching booking (guarded
 * behind a performance confirmation when the result set is large). Pagination is
 * a display concern only — it never affects filtering, sorting or generation.
 */
type PageSize = 25 | 50 | 100 | "all";
const PAGE_SIZE_OPTIONS: PageSize[] = [25, 50, 100, "all"];
const DEFAULT_PAGE_SIZE: PageSize = 50;
/** Loading more than this many rows at once prompts a performance confirmation. */
const LOAD_ALL_WARNING_THRESHOLD = 100;

/**
 * How rows are visually organised. Grouping is a pure display preference: it
 * never changes which rows match, their order, pagination, or any status
 * calculation — only how the visible page is bucketed under collapsible headers.
 */
type GroupBy = "none" | "day" | "customer" | "employee";
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "day", label: "Day" },
  { value: "customer", label: "Customer" },
  { value: "employee", label: "Employee" },
];

/**
 * Session-storage keys for state that should survive a page refresh. The quick
 * filter is intentionally NOT persisted: opening the Booking Queue always
 * defaults to Today.
 */
const STORAGE = {
  customStart: "cleanops.bookingQueue.customStart",
  customEnd: "cleanops.bookingQueue.customEnd",
  showCancelled: "cleanops.bookingQueue.showCancelled",
} as const;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** Monday-start week containing the given date. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  return addDays(x, diff);
}

/** Local YYYY-MM-DD string for <input type="date"> values. */
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface DateRange {
  start: Date;
  end: Date;
}

/** Resolves a quick filter (or custom inputs) to an inclusive date range. */
function resolveRange(
  filter: DateFilter,
  customStart: string,
  customEnd: string,
): DateRange | null {
  const now = new Date();
  switch (filter) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = addDays(now, -1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "tomorrow": {
      const t = addDays(now, 1);
      return { start: startOfDay(t), end: endOfDay(t) };
    }
    case "currentWeek": {
      const s = startOfWeek(now);
      return { start: s, end: endOfDay(addDays(s, 6)) };
    }
    case "previousWeek": {
      const s = addDays(startOfWeek(now), -7);
      return { start: s, end: endOfDay(addDays(s, 6)) };
    }
    case "currentMonth": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: startOfDay(s), end: endOfDay(e) };
    }
    case "previousMonth": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: startOfDay(s), end: endOfDay(e) };
    }
    case "nextMonth": {
      const s = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return { start: startOfDay(s), end: endOfDay(e) };
    }
    case "custom": {
      if (!customStart || !customEnd) return null;
      const start = startOfDay(new Date(`${customStart}T00:00:00`));
      const end = endOfDay(new Date(`${customEnd}T00:00:00`));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return start.getTime() <= end.getTime()
        ? { start, end }
        : { start: end, end: endOfDay(start) };
    }
    default:
      return null;
  }
}

/**
 * The date a booking is planned against. A reschedule wins (the booking moved),
 * then the service row's intended service date, then the future-schedule date,
 * finally the created date as a last-resort fallback. Date-only strings are
 * anchored to local midnight so day-bucketed filters don't shift across
 * timezones.
 */
function planningDate(item: BookingQueueItem): Date {
  const iso =
    item.reschedule?.newDate ?? item.serviceDate ?? item.scheduledDate ?? item.createdAt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00`);
  return new Date(iso);
}

/**
 * Renders the planned time window "HH:MM – HH:MM", or a neutral placeholder.
 * Takes the start/end directly so callers pass the SAME resolved occurrence the
 * rest of the row renders from (staffing, labour, duration). Reading the display
 * item's snapshot instead let TIME lag behind the resolved occurrence when an
 * exception/variation changed the window without mirroring it back onto the item.
 */
function PlannedTime({
  startTime,
  endTime,
  bookedStartTime,
  bookedEndTime,
}: {
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  /** Customer/original allowed window, shown labelled when it differs. */
  bookedStartTime?: string | null | undefined;
  bookedEndTime?: string | null | undefined;
}) {
  const range = formatTimeRange(startTime, endTime);
  if (!range) return <span className="text-muted-foreground/50">—</span>;
  const bookedRange =
    bookedStartTime != null || bookedEndTime != null
      ? formatTimeRange(bookedStartTime, bookedEndTime)
      : null;
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-xs text-muted-foreground">{range}</span>
      {bookedRange && bookedRange !== range ? (
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          Booked {bookedRange}
        </span>
      ) : null}
    </span>
  );
}

function isCancelled(item: BookingQueueItem): boolean {
  return Boolean(item.cancelledAt);
}

/**
 * Builds a display-only item for a derived recurring occurrence on a specific
 * date. Its id is the stable {@link BookingOccurrence.occurrenceKey} so the
 * occurrence is addressable and refresh-safe (no `@`-mangled ids, no duplicates).
 * Carries the base snapshot but its own service date and a clean (unscheduled,
 * not rescheduled) planning state. Never persisted in this step.
 */
function makeDerivedOccurrenceItem(
  base: BookingQueueItem,
  dateIso: string,
  occurrenceKey: string,
): BookingQueueItem {
  return {
    ...base,
    id: occurrenceKey,
    serviceDate: dateIso,
    scheduledDate: null,
    scheduleStatus: "unscheduled",
    reschedule: null,
  };
}

/**
 * Syncs the display item with a rescheduled occurrence's effective date/time so
 * the row renders (and sorts) on its override date — no duplicate appears on the
 * original recurrence date because the same row is simply moved. Returns the
 * same reference when nothing changed. Pure.
 */
function withOccurrenceOverride(
  item: BookingQueueItem,
  occurrence: BookingOccurrence,
): BookingQueueItem {
  if (occurrence.status !== "rescheduled") return item;
  if (
    item.serviceDate === occurrence.serviceDate &&
    item.plannedStartTime === occurrence.plannedStartTime &&
    item.plannedEndTime === occurrence.plannedEndTime
  ) {
    return item;
  }
  return {
    ...item,
    serviceDate: occurrence.serviceDate,
    scheduledDate: null,
    plannedStartTime: occurrence.plannedStartTime,
    plannedEndTime: occurrence.plannedEndTime,
  };
}

/** JS `Date.getDay()` index (0 = Sunday) for each {@link WeekDay}. */
const WEEKDAY_INDEX: Record<WeekDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const INDEX_TO_WEEKDAY = Object.entries(WEEKDAY_INDEX).reduce<Record<number, WeekDay>>(
  (acc, [day, idx]) => {
    acc[idx] = day as WeekDay;
    return acc;
  },
  {},
);

/** The {@link WeekDay} of an ISO "YYYY-MM-DD" date, anchored to local midnight. */
function weekdayOf(iso: string): WeekDay | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  return INDEX_TO_WEEKDAY[new Date(`${iso}T00:00:00`).getDay()];
}

/**
 * Shifts an ISO date to the given weekday within the same Mon–Sun week, used
 * only to compute a variation's *visible* date. The occurrence identity
 * (occurrenceKey/occurrenceDate) is never derived from this — it stays anchored
 * to the original base date.
 */
function shiftToWeekday(iso: string, target: WeekDay): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + (WEEKDAY_INDEX[target] - d.getDay()));
  return toDateInputValue(d);
}

/**
 * Applies the variation resolver to a freshly built base occurrence. Variations
 * may change the occurrence's visible date/time, staffing and notes, but NEVER
 * its identity: occurrenceKey, parentServiceRowId and occurrenceDate are kept
 * exactly as built. Matching is anchored to the series start (via the occurrence
 * index), so "every fourth week" doesn't drift with the visible range. The
 * caller applies {@link applyOccurrenceException} AFTER this so a manual
 * exception always wins. Pure — safe during render.
 */
function applyVariationsToOccurrence(
  occurrence: BookingOccurrence,
  variations: RecurringVariation[] | undefined,
  seriesStartIso: string | null | undefined,
  resolveEmployeeName: (id: string) => string | undefined,
): { occurrence: BookingOccurrence; resolution: OccurrenceVariationResolution | null } {
  if (!variations || variations.length === 0) return { occurrence, resolution: null };

  const interval = occurrence.recurrenceInterval ?? "one_time";
  const occurrenceIndex = occurrenceIndexFromStart(
    seriesStartIso,
    occurrence.occurrenceDate,
    interval,
  );
  const baseDay = weekdayOf(occurrence.occurrenceDate);
  const resolution = resolveOccurrenceVariations({
    base: {
      occurrenceDate: occurrence.occurrenceDate,
      day: baseDay,
      startTime: occurrence.plannedStartTime,
      endTime: occurrence.plannedEndTime,
      durationMinutes: calculatePlannedDurationMinutes(
        occurrence.plannedStartTime,
        occurrence.plannedEndTime,
      ),
      assignedEmployeeIds: occurrence.assignedEmployeeIds,
      unassignedEmployeeSlots: occurrence.unassignedEmployeeSlots,
      notes: null,
    },
    occurrenceIndex,
    variations,
  });

  if (!resolution.isVariation) return { occurrence, resolution: null };

  const r = resolution.resolved;
  const assignedEmployeeNames = r.assignedEmployeeIds
    .map((id) => resolveEmployeeName(id))
    .filter((name): name is string => Boolean(name));
  const serviceDate =
    r.day && r.day !== baseDay
      ? shiftToWeekday(occurrence.occurrenceDate, r.day)
      : occurrence.serviceDate;

  return {
    occurrence: {
      ...occurrence,
      // Identity is intentionally untouched: occurrenceKey, parentServiceRowId
      // and occurrenceDate stay anchored to the base occurrence.
      serviceDate,
      plannedStartTime: r.startTime,
      plannedEndTime: r.endTime,
      assignedEmployeeIds: r.assignedEmployeeIds,
      assignedEmployeeNames,
      unassignedEmployeeSlots: r.unassignedEmployeeSlots,
      assignmentStatus: r.assignmentStatus,
    },
    resolution,
  };
}

/**
 * Mirrors the final occurrence's display fields (date, planned window, duration,
 * staffing) back onto the display item so every cell renders the resolved
 * variation values consistently. Builds on {@link withOccurrenceOverride} so the
 * reschedule overlay still applies last.
 */
function withOccurrenceDisplay(
  item: BookingQueueItem,
  occurrence: BookingOccurrence,
  resolution: OccurrenceVariationResolution | null,
): BookingQueueItem {
  const base = withOccurrenceOverride(item, occurrence);
  if (!resolution?.isVariation) return base;
  return {
    ...base,
    serviceDate: occurrence.serviceDate,
    plannedStartTime: occurrence.plannedStartTime,
    plannedEndTime: occurrence.plannedEndTime,
    durationMinutes:
      calculatePlannedDurationMinutes(
        occurrence.plannedStartTime,
        occurrence.plannedEndTime,
      ) ??
      resolution.resolved.durationMinutes ??
      base.durationMinutes ??
      null,
    assignedEmployeeIds: occurrence.assignedEmployeeIds,
    assignedEmployeeNames: occurrence.assignedEmployeeNames,
    unassignedEmployeeSlots: occurrence.unassignedEmployeeSlots,
    assignmentStatus: occurrence.assignmentStatus,
  };
}

/**
 * A single Booking Queue row: the stable occurrence identity plus the display
 * item that carries its snapshot. {@link isPersistedBase} marks the row that
 * maps to the stored booking (its own service date) — mutations (reschedule,
 * cancel) currently apply only there; derived occurrences are read-only until
 * per-occurrence actions are built in a later step. {@link resolution} carries
 * any applied variation output for the display indicators (null when none).
 */
/**
 * The authoritative original/new date+time of a row's move, sourced from the
 * occurrence exception (rescheduled occurrence) or the legacy one-time booking
 * reschedule — never inferred from display values. Drives the change-information
 * shown under the customer/work order.
 */
interface RowReschedule {
  scope: "occurrence" | "series";
  originalDate: string;
  newDate: string;
  originalStartTime: string | null;
  originalEndTime: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
}

/**
 * Resolves a row's move from the authoritative sources. A rescheduled occurrence
 * (exception overlay) wins: the original date/time come from the pre-exception
 * occurrence and the new date/time from the final occurrence. Otherwise the
 * legacy one-time booking reschedule is used (date-only; the model carries no
 * times). Returns null when the row hasn't moved.
 */
function buildRowReschedule(
  preException: BookingOccurrence,
  occurrence: BookingOccurrence,
  item: BookingQueueItem,
): RowReschedule | null {
  if (occurrence.status === "rescheduled") {
    return {
      scope: "occurrence",
      originalDate: occurrence.occurrenceDate,
      newDate: occurrence.serviceDate,
      originalStartTime: preException.plannedStartTime ?? null,
      originalEndTime: preException.plannedEndTime ?? null,
      newStartTime: occurrence.plannedStartTime ?? null,
      newEndTime: occurrence.plannedEndTime ?? null,
    };
  }
  const rs = item.reschedule;
  if (rs) {
    return {
      scope: rs.oneTime ? "occurrence" : "series",
      originalDate: rs.originalDate,
      newDate: rs.newDate,
      originalStartTime: null,
      originalEndTime: null,
      newStartTime: null,
      newEndTime: null,
    };
  }
  return null;
}

interface QueueRow {
  occurrence: BookingOccurrence;
  item: BookingQueueItem;
  isPersistedBase: boolean;
  resolution: OccurrenceVariationResolution | null;
  reschedule: RowReschedule | null;
}

/** A bucket of rows shown under one collapsible header when grouping is on. */
interface RenderGroup {
  key: string;
  label: string;
  rows: QueueRow[];
}

/** The ISO date a row is bucketed under for "Group by Day", local-midnight safe. */
function rowDayIso(row: QueueRow): string {
  const item = row.item;
  return item.serviceDate ?? item.scheduledDate ?? toDateInputValue(planningDate(item));
}

/**
 * Buckets already-paginated, already-sorted rows under group headers. Group
 * order follows first appearance, so the existing chronological ordering is
 * preserved (and Day groups stay in date order). Purely presentational — it
 * neither filters nor re-sorts.
 */
function buildRenderGroups(rows: QueueRow[], groupBy: GroupBy): RenderGroup[] {
  if (groupBy === "none") return [{ key: "__all", label: "", rows }];
  const order: string[] = [];
  const byKey = new Map<string, RenderGroup>();
  for (const row of rows) {
    let key: string;
    let label: string;
    if (groupBy === "day") {
      const iso = rowDayIso(row);
      key = iso;
      label = `${formatWeekday(iso)} ${formatDate(iso)}`.toUpperCase();
    } else if (groupBy === "customer") {
      key = row.item.customerName || "—";
      label = key.toUpperCase();
    } else {
      const names = row.occurrence.assignedEmployeeNames ?? [];
      key = names.length > 0 ? names.join(", ") : "Unassigned";
      label = key.toUpperCase();
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      order.push(key);
      byKey.set(key, { key, label, rows: [row] });
    }
  }
  return order.map((k) => byKey.get(k) as RenderGroup);
}

/** Order-preserving de-duplication of a string list. */
function dedupe(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Merges two queue rows that resolve to the SAME occurrence identity
 * (occurrenceKey) into one. The Booking Queue shows one row per work order
 * occurrence, never one row per assigned employee — so when the underlying data
 * splits a single occurrence across multiple items (one per employee), their
 * assigned employees are unioned into a single row.
 *
 * The persisted-base row is preferred as the canonical carrier of the resolved
 * occurrence/exception/variation output and booking-level state; only the
 * staffing fields are combined. Unassigned slots take the max (not the sum) so
 * split-per-employee items don't inflate the open-slot count. The underlying
 * assignment model is never mutated — this is presentation-only grouping.
 */
function mergeQueueRows(a: QueueRow, b: QueueRow): QueueRow {
  const primary = a.isPersistedBase || !b.isPersistedBase ? a : b;
  const secondary = primary === a ? b : a;
  const assignedEmployeeIds = dedupe([
    ...(primary.occurrence.assignedEmployeeIds ?? []),
    ...(secondary.occurrence.assignedEmployeeIds ?? []),
  ]);
  const assignedEmployeeNames = dedupe([
    ...(primary.occurrence.assignedEmployeeNames ?? []),
    ...(secondary.occurrence.assignedEmployeeNames ?? []),
  ]);
  const unassignedEmployeeSlots = Math.max(
    normalizeUnassignedSlots(primary.occurrence.unassignedEmployeeSlots),
    normalizeUnassignedSlots(secondary.occurrence.unassignedEmployeeSlots),
  );
  return {
    ...primary,
    occurrence: {
      ...primary.occurrence,
      assignedEmployeeIds,
      assignedEmployeeNames,
      unassignedEmployeeSlots,
    },
    item: {
      ...primary.item,
      assignedEmployeeIds,
      assignedEmployeeNames,
      unassignedEmployeeSlots,
    },
  };
}

/** Renders the planned duration, falling back to a neutral placeholder. */
function DurationCell({ minutes }: { minutes: number | null | undefined }) {
  const label = formatBookingDuration(minutes);
  if (!label) return <span className="text-muted-foreground/50">—</span>;
  const [head, tail] = label.split(" (");
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Clock className="h-3.5 w-3.5 opacity-60" />
        {head}
      </span>
      <span className="text-xs text-muted-foreground">({tail}</span>
    </span>
  );
}

interface RescheduleDraft {
  newDate: string;
  reason: string;
  comment: string;
  oneTime: boolean;
}

interface OccurrenceRescheduleDraft {
  newDate: string;
  newStartTime: string;
  newEndTime: string;
}

/**
 * Admin Booking Queue — the planning layer between Work Orders (the source of
 * work) and the future Schedule module. Provides an at-a-glance view of all
 * work waiting to be assigned, scheduled, rescheduled or cancelled. Scheduling
 * automation itself (calendars, drag-and-drop, routing, vehicles) is not built
 * here — this is the planning/coordination surface only.
 */
export default function BookingQueue() {
  // Dev-only render accounting (no-op in production).
  perf.count("BookingQueue.render");
  const {
    bookingQueue,
    bookingOccurrenceExceptions,
    workOrders,
    customers,
    employees,
    cancelOccurrence,
    restoreOccurrence,
    rescheduleOccurrence,
    rescheduleBooking,
    systemSettings,
    getWorkOrderSettingsFor,
    isCompanyEntitledToService,
  } = useApp();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [query, setQuery] = useState<string>("");

  const [rescheduleTarget, setRescheduleTarget] = useState<BookingQueueItem | null>(null);
  const [occRescheduleTarget, setOccRescheduleTarget] = useState<QueueRow | null>(null);
  const [occDraft, setOccDraft] = useState<OccurrenceRescheduleDraft>({
    newDate: toDateInputValue(new Date()),
    newStartTime: "",
    newEndTime: "",
  });
  const [detailsTarget, setDetailsTarget] = useState<BookingQueueItem | null>(null);
  const [logTarget, setLogTarget] = useState<BookingQueueItem | null>(null);
  const [assignTarget, setAssignTarget] = useState<QueueRow | null>(null);
  const [draft, setDraft] = useState<RescheduleDraft>({
    newDate: toDateInputValue(new Date()),
    reason: "",
    comment: "",
    oneTime: true,
  });

  // Opening the Booking Queue always defaults to Today (filter + both date
  // fields), so the visible queue shows today's bookings immediately.
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [customStart, setCustomStart] = useState<string>(() => toDateInputValue(new Date()));
  const [customEnd, setCustomEnd] = useState<string>(() => toDateInputValue(new Date()));
  const [showCancelled, setShowCancelled] = useState<boolean>(
    () => sessionStorage.getItem(STORAGE.showCancelled) === "true",
  );

  // Display-only view controls. Pagination and grouping never touch filtering,
  // sorting, generation or status logic — they only shape how rows are shown.
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState<number>(1);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(),
  );
  // The "Show all" performance confirmation, opened only for large result sets.
  const [confirmLoadAll, setConfirmLoadAll] = useState<boolean>(false);

  // Keep the Start/End date fields in sync with the selected quick filter. For
  // any non-custom filter the resolved range drives the inputs, so the dates
  // always reflect the chosen filter (Today, Yesterday, This Week, …). Editing a
  // date input switches the filter to "custom", which short-circuits this sync.
  useEffect(() => {
    if (dateFilter === "custom") return;
    const resolved = resolveRange(dateFilter, "", "");
    if (!resolved) return;
    setCustomStart(toDateInputValue(resolved.start));
    setCustomEnd(toDateInputValue(resolved.end));
  }, [dateFilter]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE.customStart, customStart);
  }, [customStart]);
  useEffect(() => {
    sessionStorage.setItem(STORAGE.customEnd, customEnd);
  }, [customEnd]);
  useEffect(() => {
    sessionStorage.setItem(STORAGE.showCancelled, String(showCancelled));
  }, [showCancelled]);

  const range = useMemo(
    () => resolveRange(dateFilter, customStart, customEnd),
    [dateFilter, customStart, customEnd],
  );

  // Editing either date input always means a manual range — switch to custom
  // mode so the queue refreshes immediately against the typed dates.
  const handleStartChange = (value: string) => {
    setCustomStart(value);
    setDateFilter("custom");
  };
  const handleEndChange = (value: string) => {
    setCustomEnd(value);
    setDateFilter("custom");
  };

  // Persisted overlay layer: one exception per occurrence key, most-recent wins.
  const exceptionsByKey = useMemo(
    () => indexOccurrenceExceptions(bookingOccurrenceExceptions),
    [bookingOccurrenceExceptions],
  );

  // The Work Order service row remains the source of truth for variations; the
  // queue only reads them to resolve the final occurrence. Index by service row.
  const variationsByRowId = useMemo(() => {
    const map = new Map<string, RecurringVariation[]>();
    for (const wo of workOrders) {
      for (const row of wo.serviceRows ?? []) {
        if (row.variations && row.variations.length > 0) {
          map.set(row.id, row.variations);
        }
      }
    }
    return map;
  }, [workOrders]);

  // The work-order service row is the canonical source for scheduling bounds.
  // The persisted Booking Queue snapshot can lag behind (e.g. items created
  // before `serviceEndDate` was synced, which the one-time migration won't
  // re-touch), so the recurring expansion reads the end date straight from the
  // live row to guarantee occurrences never appear past the service end date.
  // Only rows owned by a LIVE work order are a source of truth. An inactivated
  // ("deleted") work order is excluded, so its rows resolve as orphans — their
  // current/future occurrences are hidden from the live queue while past ones
  // stay visible for audit. This mirrors the Schedule Board's isLiveWorkOrder
  // guard so neither surface can show orphaned live bookings.
  const sourceRowById = useMemo(() => {
    const map = new Map<string, WorkOrderServiceRow>();
    for (const wo of workOrders) {
      if (!isLiveWorkOrder(wo)) continue;
      for (const row of wo.serviceRows ?? []) {
        map.set(row.id, row);
      }
    }
    return map;
  }, [workOrders]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);
  const resolveEmployeeName = useCallback(
    (id: string): string | undefined => employeeNameById.get(id),
    [employeeNameById],
  );

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  // Confirmation status only renders when the Preferred Time Evaluation add-on
  // is available for the booking's company (all gates agree). Cached per company
  // so the per-row evaluation in render doesn't re-check the gates each time.
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

  // Resolves which scheduling preferences apply to an occurrence: the source
  // row's own override when set, otherwise the customer's default. Mirrors the
  // Work Order resolution so the two never diverge.
  const resolveOccurrencePreferences = useCallback(
    (item: BookingQueueItem): CustomerSchedulingPreferences | null => {
      const row = sourceRowById.get(item.serviceRowId);
      if (row?.scheduleSource === "override" && row.schedulePreferences) {
        return row.schedulePreferences;
      }
      return customerById.get(item.customerId)?.schedulingPreferences ?? null;
    },
    [sourceRowById, customerById],
  );

  const rows = useMemo<QueueRow[]>(() => {
    const q = query.trim().toLowerCase();
    // The Booking Generation Horizon caps how far recurring occurrences may be
    // shown, regardless of how wide the selected range is.
    const now = new Date();
    const todayIso = toDateInputValue(now);
    const horizonEnd = endOfDay(
      bookingHorizonEndDate(startOfDay(now), systemSettings.bookingGenerationHorizonMonths),
    );

    const matchesQuery = (b: BookingQueueItem): boolean => {
      if (!q) return true;
      const employeeNames = (b.assignedEmployeeNames ?? []).join(" ");
      const haystack = [b.customerName, b.serviceName, b.workOrderNumber, employeeNames]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    };

    const inRange = (d: Date): boolean => {
      if (!range) return true;
      const t = d.getTime();
      return !Number.isNaN(t) && t >= range.start.getTime() && t <= range.end.getTime();
    };

    // Display-date range alignment: widen the recurrence scan so a reschedule
    // whose override lands in range (but whose rule date sits outside it) is
    // still generated, then keep rows by their display/planning date below.
    // Mirrors the Shared Schedule Core so both surfaces show a moved booking on
    // the same day.
    let scanStart = range?.start ?? null;
    let scanEnd = range?.end ?? null;
    if (range) {
      for (const ex of exceptionsByKey.values()) {
        if (ex.status !== "rescheduled" || !ex.overrideOccurrenceDate) continue;
        const overrideD = new Date(`${ex.overrideOccurrenceDate}T00:00:00`);
        if (Number.isNaN(overrideD.getTime())) continue;
        if (
          overrideD.getTime() < range.start.getTime() ||
          overrideD.getTime() > range.end.getTime()
        )
          continue;
        const ruleD = new Date(`${ex.occurrenceDate}T00:00:00`);
        if (Number.isNaN(ruleD.getTime())) continue;
        if (scanStart && ruleD.getTime() < scanStart.getTime()) scanStart = startOfDay(ruleD);
        if (scanEnd && ruleD.getTime() > scanEnd.getTime()) scanEnd = endOfDay(ruleD);
      }
    }

    const out: QueueRow[] = [];
    for (const b of bookingQueue) {
      if (!showCancelled && isCancelled(b)) continue;
      if (!matchesQuery(b)) continue;

      const interval = b.recurrenceInterval ?? "one_time";
      const recurring = interval !== "one_time";
      // The live work-order row is the source of truth for schedule bounds; the
      // persisted snapshot can lag behind an edit. Looked up once per item and
      // reused by the end-date guard, the orphan guard and the recurring
      // expansion below. An ARCHIVED row is NOT live: a superseded/renewed
      // service (cloned into a fresh row) keeps its old archived row in the
      // work order, but it must stop driving active future bookings — so it is
      // treated exactly like an orphan here (sourceRow forced undefined).
      const rawSourceRow = sourceRowById.get(b.serviceRowId);
      const sourceRow = isLiveSourceRow(rawSourceRow) ? rawSourceRow : undefined;
      // The live source row is authoritative: re-derive the item's staffing,
      // planned window and labour-relevant snapshot from it so a stale persisted
      // snapshot (legacy data, pre-sync items) can never drive the queue. Orphans
      // (no live row) are only clamped to safe shapes, never trusted. This is what
      // keeps the Booking Queue, the source row and the Schedule Board in lockstep
      // without needing to delete/recreate a booking.
      const normalized = normalizeBookingQueueItem(b, sourceRow, resolveEmployeeName);
      // Orphan snapshots (no live source row, incl. archived rows) can't be
      // reconciled with AO edits or the service end date, so every
      // current-or-future orphan occurrence is hidden as a stale ghost. Past
      // occurrences stay visible for audit.
      const hasLiveSourceRow = Boolean(sourceRow);

      // Without a resolved range, or for one-time/undated rows, keep the single
      // base item (previous behavior) — never expand unbounded. The display-date
      // range filter is applied to the assembled rows below, so an occurrence
      // moved by an exception is kept/dropped by the date it is planned for.
      if (!range || !recurring || !b.serviceDate) {
        const dateIso = b.serviceDate ?? toDateInputValue(planningDate(b));
        const occKey = makeOccurrenceKey(b.serviceRowId, dateIso);
        const exception = exceptionsByKey.get(occKey);
        // Base → variation resolver → exception (exception always wins last).
        const { occurrence: varOcc, resolution } = applyVariationsToOccurrence(
          buildBookingOccurrence(normalized, dateIso),
          variationsByRowId.get(b.serviceRowId),
          b.serviceDate,
          resolveEmployeeName,
        );
        const occurrence = applyOccurrenceException(varOcc, exception, resolveEmployeeName);
        // Source-of-truth end-date guard: drop a base/one-time item whose
        // identity date is past the live row's end date. This catches stale
        // persisted items that recurring expansion never re-bounds.
        const hiddenOrphan = isHiddenOrphanOccurrence({
          occurrenceDate: occurrence.occurrenceDate,
          hasLiveSourceRow,
          today: todayIso,
        });
        if (
          !isAfterServiceEnd(occurrence.occurrenceDate, sourceRow, Boolean(exception)) &&
          !hiddenOrphan &&
          (showCancelled || occurrence.status !== "cancelled")
        ) {
          out.push({
            occurrence,
            item: withOccurrenceDisplay(normalized, occurrence, resolution),
            isPersistedBase: true,
            resolution,
            reschedule: buildRowReschedule(varOcc, occurrence, normalized),
          });
        }
        continue;
      }

      // Recurring: render a concrete occurrence per recurrence date inside the
      // range, bounded by the horizon and the optional series end date. Each
      // occurrence gets a stable occurrence key so it is individually
      // addressable in later steps.
      // Prefer the live work-order row's end date over the persisted snapshot,
      // which may be stale. Snapshot is only a fallback when the row is gone.
      const effectiveEndDate =
        sourceRow?.serviceEndDate?.trim() ?? b.serviceEndDate ?? null;
      const seriesEnd = effectiveEndDate
        ? endOfDay(new Date(`${effectiveEndDate}T00:00:00`))
        : null;
      const dates = recurrenceOccurrences(b.serviceDate, interval, {
        rangeStart: scanStart ?? range.start,
        rangeEnd: scanEnd ?? range.end,
        horizonEnd,
        seriesEnd,
      });
      for (const dateIso of dates) {
        const isPersistedBase = dateIso === b.serviceDate;
        const derived = buildBookingOccurrence(normalized, dateIso);
        // Base → variation resolver → exception. Variations never change the
        // occurrence key; the exception is matched on the original key and wins.
        const { occurrence: varOcc, resolution } = applyVariationsToOccurrence(
          derived,
          variationsByRowId.get(b.serviceRowId),
          b.serviceDate,
          resolveEmployeeName,
        );
        const exception = exceptionsByKey.get(derived.occurrenceKey);
        const occurrence = applyOccurrenceException(varOcc, exception, resolveEmployeeName);
        // Belt-and-braces: even if a stale snapshot ever slipped a past-end date
        // into the expansion, the live-row guard drops it here too.
        if (isAfterServiceEnd(occurrence.occurrenceDate, sourceRow, Boolean(exception)))
          continue;
        // Hide active future orphan occurrences (no live source row, no history).
        if (
          isHiddenOrphanOccurrence({
            occurrenceDate: occurrence.occurrenceDate,
            hasLiveSourceRow,
            today: todayIso,
          })
        )
          continue;
        if (!showCancelled && occurrence.status === "cancelled") continue;
        const baseItem = isPersistedBase
          ? normalized
          : makeDerivedOccurrenceItem(normalized, dateIso, occurrence.occurrenceKey);
        out.push({
          occurrence,
          item: withOccurrenceDisplay(baseItem, occurrence, resolution),
          isPersistedBase,
          resolution,
          reschedule: buildRowReschedule(varOcc, occurrence, baseItem),
        });
      }
    }

    // Display-date range filter: keep only rows planned within the selected
    // range. `planningDate(item)` reflects the occurrence-exception override (via
    // withOccurrenceDisplay) and the legacy one-time reschedule, so a moved
    // booking is kept/dropped by the date it is actually planned for — exactly
    // like the Shared Schedule Core.
    const ranged = range ? out.filter((r) => inRange(planningDate(r.item))) : out;

    // Collapse rows that resolve to the same occurrence identity into one. This
    // guarantees one row per work order occurrence: multiple assigned employees
    // on a single occurrence are unioned into the same row instead of producing
    // duplicate rows (which would also collide on the React key). occurrenceKey
    // remains the stable identity throughout.
    const byOccurrence = new Map<string, QueueRow>();
    for (const row of ranged) {
      const key = row.occurrence.occurrenceKey;
      const existing = byOccurrence.get(key);
      byOccurrence.set(key, existing ? mergeQueueRows(existing, row) : row);
    }
    const grouped = [...byOccurrence.values()];

    // Planning view reads best in chronological order; ties keep newest first.
    grouped.sort((a, b) => {
      const diff = planningDate(a.item).getTime() - planningDate(b.item).getTime();
      return diff !== 0 ? diff : b.item.createdAt.localeCompare(a.item.createdAt);
    });
    return grouped;
  }, [
    bookingQueue,
    exceptionsByKey,
    variationsByRowId,
    sourceRowById,
    resolveEmployeeName,
    query,
    range,
    showCancelled,
    systemSettings,
  ]);

  // Reset to the first page whenever the underlying result set changes (filters,
  // search, range, cancelled toggle, or page size). Grouping changes do NOT
  // reset the page — grouping only reshapes the rows already on the page.
  useEffect(() => {
    setPage(1);
  }, [query, range, showCancelled, pageSize]);

  // Switching the grouping mode starts fully expanded (spec default).
  useEffect(() => {
    setCollapsedGroups(new Set<string>());
  }, [groupBy]);

  const totalRows = rows.length;
  const totalPages =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = pageSize === "all" ? 0 : (currentPage - 1) * pageSize;
  const endIndex = pageSize === "all" ? totalRows : Math.min(startIndex + pageSize, totalRows);
  const pageRows = useMemo(
    () => (pageSize === "all" ? rows : rows.slice(startIndex, endIndex)),
    [rows, pageSize, startIndex, endIndex],
  );
  const rangeLabel =
    totalRows === 0 ? "0" : `${startIndex + 1}–${endIndex}`;

  // Group the CURRENT PAGE only — pagination decides which rows are present,
  // grouping only decides how those rows are organised on screen.
  const renderGroups = useMemo(
    () => buildRenderGroups(pageRows, groupBy),
    [pageRows, groupBy],
  );

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Selecting a page size. "All" on a large result set is gated behind a
  // performance confirmation; everything else applies immediately.
  const handlePageSizeSelect = useCallback(
    (size: PageSize) => {
      if (size === "all" && totalRows > LOAD_ALL_WARNING_THRESHOLD) {
        setConfirmLoadAll(true);
        return;
      }
      setPageSize(size);
    },
    [totalRows],
  );

  const selectedSummary = useMemo(() => {
    if (dateFilter === "custom") {
      return range
        ? `Custom Range: ${customStart} → ${customEnd}`
        : "Custom Range: select start and end dates";
    }
    return DATE_FILTER_LABELS[dateFilter];
  }, [dateFilter, range, customStart, customEnd]);

  /** Bottom-of-list planning roll-up across the currently filtered rows. */
  const summary = useMemo(() => {
    const active = rows.filter((r) => !isCancelled(r.item));
    // On-site duration = the actual scheduled work window (per-employee minutes
    // when work is split/redistributed, otherwise the booked window). Labour
    // minutes = total planned work effort. Both are computed from the final
    // resolved occurrence so variations/exceptions and merged staffing apply.
    const computed = active.map((r) => {
      const labour = calculatePlannedLabourMinutes({
        plannedStartTime: r.occurrence.plannedStartTime,
        plannedEndTime: r.occurrence.plannedEndTime,
        assignedEmployeeIds: r.occurrence.assignedEmployeeIds,
        unassignedEmployeeSlots: r.occurrence.unassignedEmployeeSlots,
        employeeTimeOverrides: r.occurrence.employeeTimeOverrides,
        // Prefer the per-occurrence pinned labour (an assignment exception) over
        // the series-level row override so a single reassigned occurrence keeps
        // its own resolved total.
        totalLabourMinutesOverride:
          r.occurrence.totalLabourMinutesOverride ??
          sourceRowById.get(r.item.serviceRowId)?.totalLabourMinutesOverride,
      });
      const onSite =
        resolveScheduledWindow({
          plannedStartTime: r.occurrence.plannedStartTime,
          plannedEndTime: r.occurrence.plannedEndTime,
          visitMinutes: labour.visitMinutes,
          perEmployeeMinutes: labour.perEmployeeMinutes,
        }).onSiteMinutes ??
        resolveOccurrenceDurationMinutes(r.occurrence, r.item.durationMinutes) ??
        0;
      return { row: r, onSite, labourMinutes: labour.labourMinutes ?? 0 };
    });
    const totalMinutes = computed.reduce((sum, c) => sum + c.onSite, 0);
    const labourMinutes = computed.reduce((sum, c) => sum + c.labourMinutes, 0);
    // Count moves from the authoritative resolved move (occurrence exception or
    // legacy `item.reschedule` compatibility) — never the legacy field alone, so
    // new exception-based reschedules are included.
    const rescheduled = computed.filter((c) => c.row.reschedule);
    const rescheduledMinutes = rescheduled.reduce((sum, c) => sum + c.onSite, 0);
    return {
      count: active.length,
      totalMinutes,
      labourMinutes,
      rescheduledCount: rescheduled.length,
      rescheduledMinutes,
    };
  }, [rows, sourceRowById]);

  const openReschedule = (item: BookingQueueItem) => {
    const base = item.scheduledDate ? new Date(item.scheduledDate) : new Date();
    setDraft({
      newDate: toDateInputValue(Number.isNaN(base.getTime()) ? new Date() : base),
      reason: "",
      comment: "",
      oneTime: true,
    });
    setRescheduleTarget(item);
  };

  const submitReschedule = () => {
    if (!rescheduleTarget) return;
    const res = rescheduleBooking(rescheduleTarget.id, {
      newDate: draft.newDate,
      reason: draft.reason,
      comment: draft.comment,
      oneTime: draft.oneTime,
    });
    if (!res.ok) {
      toast({ title: "Couldn't reschedule", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Booking rescheduled",
      description: buildRescheduleMessage({
        scope: draft.oneTime ? "occurrence" : "series",
        originalDate: rescheduleTarget.serviceDate ?? rescheduleTarget.scheduledDate ?? draft.newDate,
        newDate: draft.newDate,
      }).summary,
    });
    setRescheduleTarget(null);
  };

  // Cancel/restore target the individual occurrence by its stable occurrenceKey
  // (persisted as an exception), so one occurrence can be cancelled without
  // touching the recurring service row or any sibling occurrence.
  // Per-occurrence reschedule: moves a single occurrence by its stable
  // occurrenceKey via a persisted exception. The recurring rule and sibling
  // occurrences are never touched.
  const openOccReschedule = (row: QueueRow) => {
    const current = row.occurrence.serviceDate || row.occurrence.occurrenceDate;
    setOccDraft({
      newDate: /^\d{4}-\d{2}-\d{2}$/.test(current) ? current : toDateInputValue(new Date()),
      newStartTime: row.occurrence.plannedStartTime ?? "",
      newEndTime: row.occurrence.plannedEndTime ?? "",
    });
    setOccRescheduleTarget(row);
  };

  const submitOccReschedule = () => {
    if (!occRescheduleTarget) return;
    const res = rescheduleOccurrence(occRescheduleTarget.occurrence.occurrenceKey, {
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
      description: buildRescheduleMessage({
        scope: "occurrence",
        originalDate: occRescheduleTarget.occurrence.occurrenceDate,
        newDate: occDraft.newDate,
      }).summary,
    });
    setOccRescheduleTarget(null);
  };

  const handleCancel = (occurrence: BookingOccurrence) => {
    const res = cancelOccurrence(occurrence.occurrenceKey);
    if (!res.ok) {
      toast({ title: "Couldn't cancel", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Occurrence cancelled",
      description: `${occurrence.serviceName} on ${formatDate(`${occurrence.occurrenceDate}T00:00:00`)} was cancelled.`,
    });
  };

  const handleRestore = (occurrence: BookingOccurrence) => {
    const res = restoreOccurrence(occurrence.occurrenceKey);
    if (!res.ok) {
      toast({ title: "Couldn't restore", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Occurrence restored",
      description: `${occurrence.serviceName} on ${formatDate(`${occurrence.occurrenceDate}T00:00:00`)} is active again.`,
    });
  };

  // Maps the selected queue row onto the shared assign-dialog target. Staffing
  // is written to the occurrence's parent work-order service row, so the move is
  // read identically by Schedule Core, Schedule board and the Work Order — the
  // single source of truth. Memoized so the dialog's effect doesn't re-reset on
  // every render.
  const assignDialogTarget = useMemo<AssignDialogTarget | null>(() => {
    if (!assignTarget) return null;
    const { occurrence, item } = assignTarget;
    return {
      workOrderId: item.workOrderId,
      serviceRowId: occurrence.parentServiceRowId,
      companyId: item.companyId,
      customerId: item.customerId,
      serviceName: item.serviceName,
      customerName: item.customerName,
      workOrderNumber: item.workOrderNumber,
      assignedEmployeeIds: occurrence.assignedEmployeeIds ?? [],
      openSlots: normalizeUnassignedSlots(occurrence.unassignedEmployeeSlots),
      visitMinutes: calculatePlannedDurationMinutes(
        occurrence.plannedStartTime,
        occurrence.plannedEndTime,
      ),
      plannedStartTime: occurrence.plannedStartTime,
      plannedEndTime: occurrence.plannedEndTime,
      // Queue rows act on a single occurrence: a recurring booking is reassigned
      // via a per-occurrence exception so the series stays untouched.
      occurrence: {
        occurrenceKey: occurrence.occurrenceKey,
        isRecurring: (occurrence.recurrenceInterval ?? "one_time") !== "one_time",
        displayDate: occurrence.serviceDate,
      },
    };
  }, [assignTarget]);

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Booking Lists"
        description="Generated booking list of work waiting to be scheduled. The layer between Work Orders and the future Schedule module — assign, schedule, reschedule or cancel here."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customer, service, employee, work order…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Quick filter</Label>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bq-start" className="text-xs text-muted-foreground">
              Start date
            </Label>
            <Input
              id="bq-start"
              type="date"
              value={customStart}
              onChange={(e) => handleStartChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bq-end" className="text-xs text-muted-foreground">
              End date
            </Label>
            <Input
              id="bq-end"
              type="date"
              value={customEnd}
              onChange={(e) => handleEndChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pb-2">
          <Switch
            id="bq-show-cancelled"
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
          />
          <Label htmlFor="bq-show-cancelled" className="text-sm text-muted-foreground">
            Show cancelled bookings
          </Label>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <Badge variant="secondary" className="font-medium">
          {selectedSummary}
        </Badge>
        <span className="text-muted-foreground">
          {rows.length} {rows.length === 1 ? "item" : "items"}
          {rows.length !== bookingQueue.length && (
            <span className="text-muted-foreground/60"> · {bookingQueue.length} total</span>
          )}
        </span>
      </div>

      {/* Pagination + grouping controls — display preferences only. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">{rangeLabel}</span> of{" "}
            <span className="font-medium text-foreground">{totalRows}</span>{" "}
            {totalRows === 1 ? "booking" : "bookings"}
          </span>
          <div className="flex items-center gap-1">
            {PAGE_SIZE_OPTIONS.map((size) => {
              const active = pageSize === size;
              return (
                <Button
                  key={String(size)}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-8 min-w-[44px] px-2.5"
                  onClick={() => handlePageSizeSelect(size)}
                >
                  {size === "all" ? "All" : size}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground">Group by</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {pageSize !== "all" && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="px-1 text-xs text-muted-foreground">
                Page {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer / Work order</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totalRows === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8 opacity-40" />
                    <p className="text-sm">
                      {bookingQueue.length === 0
                        ? "No bookings yet. Add a service to a work order to list it here."
                        : "No bookings match the current filters."}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              renderGroups.map((group) => {
                const collapsed =
                  groupBy !== "none" && collapsedGroups.has(group.key);
                return (
                  <Fragment key={group.key}>
                    {groupBy !== "none" && (
                      <TableRow
                        className="cursor-pointer border-t-2 border-border bg-muted/40 hover:bg-muted/60"
                        onClick={() => toggleGroup(group.key)}
                      >
                        <TableCell colSpan={9} className="py-2.5">
                          <div className="flex items-center gap-2">
                            {collapsed ? (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                              {group.label}
                            </span>
                            <Badge variant="secondary" className="font-medium">
                              {group.rows.length}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {!collapsed &&
                      group.rows.map((row) => {
                const item = row.item;
                const cancelled = isCancelled(item) || row.occurrence.status === "cancelled";
                // Recurring occurrences (base or derived) reschedule ONLY via the
                // occurrence-exception path. The legacy booking-level reschedule —
                // which mutates the persisted booking and visibly shifts the whole
                // series — is reserved for true one-time bookings.
                const recurring = Boolean(
                  item.recurrenceInterval && item.recurrenceInterval !== "one_time",
                );
                const employees = row.occurrence.assignedEmployeeNames ?? [];
                const openSlots = normalizeUnassignedSlots(row.occurrence.unassignedEmployeeSlots);
                // Compact labour readout (parity with the Schedule Board chip).
                // Presentation only — derived from the final resolved occurrence
                // using the same labour calculation, including the live row's
                // redistribution override, so a redistributed job shows the
                // preserved total/per-employee figures identically on both
                // surfaces.
                const labourResult = calculatePlannedLabourMinutes({
                  plannedStartTime: row.occurrence.plannedStartTime,
                  plannedEndTime: row.occurrence.plannedEndTime,
                  assignedEmployeeIds: row.occurrence.assignedEmployeeIds,
                  unassignedEmployeeSlots: row.occurrence.unassignedEmployeeSlots,
                  employeeTimeOverrides: row.occurrence.employeeTimeOverrides,
                  totalLabourMinutesOverride:
                    row.occurrence.totalLabourMinutesOverride ??
                    sourceRowById.get(item.serviceRowId)?.totalLabourMinutesOverride,
                });
                // Actual scheduled work window (on-site time) vs the customer's
                // booked/allowed window. When work is split/redistributed the
                // on-site duration differs from the booked window, so TIME and
                // the visit duration follow the on-site window, not the booking.
                const scheduled = resolveScheduledWindow({
                  plannedStartTime: row.occurrence.plannedStartTime,
                  plannedEndTime: row.occurrence.plannedEndTime,
                  visitMinutes: labourResult.visitMinutes,
                  perEmployeeMinutes: labourResult.perEmployeeMinutes,
                });
                const labour = buildVisitChipLabour({
                  // "Visit" reflects the actual on-site duration, not the booked window.
                  visitMinutes: scheduled.onSiteMinutes,
                  labourMinutes: labourResult.labourMinutes,
                  perEmployeeMinutes: labourResult.perEmployeeMinutes,
                  assignedEmployeeNames: row.occurrence.assignedEmployeeNames ?? [],
                  isLabourRedistributed: labourResult.isLabourRedistributed,
                });
                const showLabour = !cancelled && Boolean(labour.summaryLabel);
                // The row's move (date and/or time) from the authoritative
                // occurrence/exception data — never inferred from display values.
                const rsRow = row.reschedule;
                // Change information shown under the customer/work order. We never
                // render "X → X": when nothing actually changed it is hidden and the
                // occurrence is treated as not rescheduled.
                const changeMsg = rsRow
                  ? buildOccurrenceChangeMessage({
                      scope: rsRow.scope,
                      originalDate: rsRow.originalDate,
                      newDate: rsRow.newDate,
                      originalStartTime: rsRow.originalStartTime,
                      originalEndTime: rsRow.originalEndTime,
                      newStartTime: rsRow.newStartTime,
                      newEndTime: rsRow.newEndTime,
                    })
                  : null;
                const variationName =
                  row.resolution?.isVariation &&
                  row.resolution.appliedVariationNames.length > 0
                    ? row.resolution.appliedVariationNames.join(", ")
                    : null;
                const showChange = Boolean(variationName) || Boolean(changeMsg?.changed);
                // Operational status (Schedule column) — only the "what kind of
                // booking" states belong here: Cancelled, Rebooked, Variation.
                // "Rebooked" is sourced from the authoritative move.
                const rebookInput = rsRow
                  ? {
                      originalDate: rsRow.originalDate,
                      newDate: rsRow.newDate,
                      oneTime: rsRow.scope === "occurrence",
                    }
                  : null;
                const operationalStatus = resolveBookingOperationalStatus({
                  isCancelled: cancelled,
                  reschedule: rebookInput,
                  isVariation: Boolean(row.resolution?.isVariation),
                  // Unified definition (matches the Shared Schedule Core): an
                  // occurrence is scheduled when it has a concrete planned start
                  // time, not when a legacy schedule flag was set.
                  isScheduled: row.occurrence.plannedStartTime != null,
                });
                // The Schedule column shows ONLY cancelled / rebooked / variation.
                // Scheduled / unscheduled are not surfaced here.
                const showScheduleBadge =
                  operationalStatus.status === "cancelled" ||
                  operationalStatus.status === "rebooked" ||
                  operationalStatus.status === "variation";
                // Confirmation status (second, independent layer) only appears
                // when the add-on is available and the customer has preferences
                // that classify the time. Display only — no approval workflow.
                const preferredTimeResult = preferredTimeAvailableFor(item.companyId)
                  ? evaluatePreferredTimeStatus(
                      preferredTimeInputFromPreferences(resolveOccurrencePreferences(item), {
                        scheduledDate:
                          row.occurrence.serviceDate || row.occurrence.occurrenceDate,
                        plannedStartTime: row.occurrence.plannedStartTime,
                        plannedEndTime: row.occurrence.plannedEndTime,
                      }),
                    )
                  : null;
                // Modifiers (additional operational information) shown in the
                // Status column: Changed (a manual time override on the
                // occurrence) first, then the confirmation modifier. "Changed"
                // is derived from the SAME source as the change-information copy
                // (buildOccurrenceChangeMessage.timeChanged) to avoid divergence,
                // and is suppressed — along with confirmation — for cancelled.
                const modifiers = resolveBookingModifiers({
                  isCancelled: cancelled,
                  isTimeChanged: Boolean(changeMsg?.timeChanged),
                  confirmation: preferredTimeResult,
                });
                return (
                  <TableRow
                    key={row.occurrence.occurrenceKey}
                    className={cancelled ? "bg-destructive/5" : ""}
                  >
                    {/* Customer / Work order — with the single change-information
                        block directly beneath the customer + work order. */}
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/work-orders/${item.workOrderId}`)}
                          className="flex flex-col text-left"
                        >
                          <span className="font-medium text-foreground hover:text-primary">
                            {item.customerName}
                          </span>
                          <span className="text-xs text-muted-foreground hover:text-primary">
                            {item.workOrderNumber}
                          </span>
                        </button>
                        {showChange && (
                          <div className="flex flex-col gap-1.5">
                            {variationName && (
                              <div className="text-xs leading-snug text-violet-700">
                                <span className="font-medium">Variation applied:</span>
                                <div>{variationName}</div>
                              </div>
                            )}
                            {changeMsg?.changed && (
                              <div className="flex flex-col gap-0.5 text-xs leading-snug">
                                {changeMsg.lines.map((line, i) => (
                                  <span
                                    key={i}
                                    className={
                                      i === 0
                                        ? "font-medium text-foreground/80"
                                        : "text-foreground/70"
                                    }
                                  >
                                    {line}
                                  </span>
                                ))}
                                <span className="text-[11px] font-medium uppercase tracking-wide text-blue-600">
                                  {changeMsg.detail}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    {/* Service */}
                    <TableCell className="align-top text-muted-foreground">
                      <span className="flex flex-col leading-tight">
                        <span>{item.serviceName}</span>
                        {item.recurrenceInterval && item.recurrenceInterval !== "one_time" && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                            {RECURRENCE_INTERVAL_LABELS[item.recurrenceInterval]}
                          </span>
                        )}
                        {/* The variation indicator now lives in the Schedule
                            column as the operational status. Only the conflict
                            warning stays here — it isn't an operational status. */}
                        {showLabour && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-foreground">
                            {labour.isRedistributed ? (
                              <Split className="h-3 w-3 shrink-0 text-sky-600" />
                            ) : null}
                            <span>{labour.summaryLabel}</span>
                          </span>
                        )}
                        {row.resolution?.isVariation &&
                          row.resolution.conflicts.length > 0 && (
                            <span className="mt-1 inline-flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className="border-amber-300 text-amber-600"
                              >
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                Variation Conflict
                              </Badge>
                            </span>
                          )}
                      </span>
                    </TableCell>
                    {/* Employee — names plus the compact staffing indicator.
                        The indicator is the single source of the assigned count
                        and open-slot affordance, kept consistent with Schedule
                        Board cards. */}
                    <TableCell className="align-top">
                      {employees.length > 0 ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                          <span>{employees.join(", ")}</span>
                          <StaffingIndicator
                            assignedCount={employees.length}
                            openSlots={openSlots}
                          />
                        </span>
                      ) : openSlots > 0 ? (
                        <StaffingIndicator assignedCount={0} openSlots={openSlots} />
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>
                    {/* Duration — actual on-site work duration. */}
                    <TableCell className="align-top">
                      <DurationCell
                        minutes={
                          scheduled.onSiteMinutes ??
                          resolveOccurrenceDurationMinutes(
                            row.occurrence,
                            item.durationMinutes,
                          )
                        }
                      />
                    </TableCell>
                    {/* Schedule — operational status only (Cancelled / Rebooked /
                        Variation). Scheduled / unscheduled are not shown here. */}
                    <TableCell className="align-top">
                      {showScheduleBadge ? (
                        <BookingOperationalStatusBadge status={operationalStatus} />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    {/* Status — modifiers (Changed, then Auto / Pending).
                        Suppressed entirely for cancelled bookings. */}
                    <TableCell className="align-top">
                      {modifiers.length > 0 ? (
                        <BookingModifiers modifiers={modifiers} />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    {/* Date — weekday + date only. */}
                    <TableCell className="align-top text-muted-foreground">
                      {item.serviceDate || item.scheduledDate ? (
                        <span className="flex flex-col leading-tight">
                          <span className="text-xs font-medium text-foreground/70">
                            {formatWeekday(
                              (item.serviceDate ?? item.scheduledDate) as string,
                            )}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-foreground">
                            <CalendarClock className="h-3.5 w-3.5 opacity-60" />
                            {formatDate(
                              (item.serviceDate ?? item.scheduledDate) as string,
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    {/* Time — actual scheduled on-site window; the customer's
                        booked window is shown labelled when it differs. */}
                    <TableCell className="align-top">
                      <PlannedTime
                        startTime={scheduled.scheduledStartTime}
                        endTime={scheduled.scheduledEndTime}
                        bookedStartTime={
                          scheduled.differsFromAllowed ? scheduled.allowedStartTime : null
                        }
                        bookedEndTime={
                          scheduled.differsFromAllowed ? scheduled.allowedEndTime : null
                        }
                      />
                    </TableCell>
                    {/* Actions */}
                    <TableCell className="align-top text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailsTarget(item)}>
                            <Info className="mr-2 h-4 w-4" />
                            Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLogTarget(item)}>
                            <History className="mr-2 h-4 w-4" />
                            Log
                          </DropdownMenuItem>
                          {row.isPersistedBase && !recurring && (
                            <DropdownMenuItem onClick={() => openReschedule(item)}>
                              <ArrowRightLeft className="mr-2 h-4 w-4" />
                              Reschedule
                            </DropdownMenuItem>
                          )}
                          {!cancelled && (
                            <DropdownMenuItem onClick={() => openOccReschedule(row)}>
                              <CalendarClock className="mr-2 h-4 w-4" />
                              Reschedule Occurrence
                            </DropdownMenuItem>
                          )}
                          {!cancelled && (
                            <DropdownMenuItem onClick={() => setAssignTarget(row)}>
                              <Users className="mr-2 h-4 w-4" />
                              Assign / change employee
                            </DropdownMenuItem>
                          )}
                          {cancelled ? (
                            <DropdownMenuItem onClick={() => handleRestore(row.occurrence)}>
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Restore Occurrence
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleCancel(row.occurrence)}
                              className="text-destructive focus:text-destructive"
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancel Occurrence
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Planning summary */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<Inbox className="h-4 w-4" />}
          label="Bookings"
          value={`${summary.count}`}
          hint={summary.count === 1 ? "active item" : "active items"}
        />
        <SummaryCard
          icon={<Clock className="h-4 w-4" />}
          label="On-site duration"
          value={`${(summary.totalMinutes / 60).toFixed(1)} h`}
          hint={`(${summary.totalMinutes} min)`}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="Labour time"
          value={`${(summary.labourMinutes / 60).toFixed(1)} h`}
          hint={`(${summary.labourMinutes} min)`}
        />
        <SummaryCard
          icon={<ArrowRightLeft className="h-4 w-4" />}
          label="Rescheduled"
          value={`${summary.rescheduledCount}`}
          hint={`${(summary.rescheduledMinutes / 60).toFixed(1)} h (${summary.rescheduledMinutes} min)`}
        />
      </div>

      {/* Assign / change employees — shared dialog writes the service row. */}
      <AssignEmployeesDialog
        target={assignDialogTarget}
        onClose={() => setAssignTarget(null)}
        onOpenWorkOrder={(workOrderId) => navigate(`/work-orders/${workOrderId}`)}
      />

      {/* Reschedule dialog */}
      <Dialog open={rescheduleTarget !== null} onOpenChange={(open) => !open && setRescheduleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule booking</DialogTitle>
            <DialogDescription>
              {rescheduleTarget
                ? `${rescheduleTarget.customerName} · ${rescheduleTarget.serviceName} (${rescheduleTarget.workOrderNumber})`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rs-date">New date</Label>
              <Input
                id="rs-date"
                type="date"
                value={draft.newDate}
                onChange={(e) => setDraft((d) => ({ ...d, newDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-reason">Reason</Label>
              <Input
                id="rs-reason"
                placeholder="e.g. Customer request"
                value={draft.reason}
                onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-comment">Comment</Label>
              <Textarea
                id="rs-comment"
                placeholder="Optional context for this change…"
                value={draft.comment}
                onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="rs-onetime" className="text-sm font-medium">
                  One-time change
                </Label>
                <p className="text-xs text-muted-foreground">
                  Applies only to this occurrence. Future recurring services stay unchanged.
                </p>
              </div>
              <Switch
                id="rs-onetime"
                checked={draft.oneTime}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, oneTime: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitReschedule}>Reschedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-occurrence reschedule dialog */}
      <Dialog
        open={occRescheduleTarget !== null}
        onOpenChange={(open) => !open && setOccRescheduleTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule occurrence</DialogTitle>
            <DialogDescription>
              {occRescheduleTarget
                ? `${occRescheduleTarget.occurrence.customerName} · ${occRescheduleTarget.occurrence.serviceName} — ${formatDate(`${occRescheduleTarget.occurrence.occurrenceDate}T00:00:00`)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Moves only this occurrence. The recurring service rule and every other
              occurrence in the series stay unchanged.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="occ-date">New date</Label>
              <Input
                id="occ-date"
                type="date"
                value={occDraft.newDate}
                onChange={(e) => setOccDraft((d) => ({ ...d, newDate: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="occ-start">New start time (optional)</Label>
                <TimePicker
                  id="occ-start"
                  value={occDraft.newStartTime}
                  onChange={(v) => setOccDraft((d) => ({ ...d, newStartTime: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="occ-end">New end time (optional)</Label>
                <TimePicker
                  id="occ-end"
                  value={occDraft.newEndTime}
                  onChange={(v) => setOccDraft((d) => ({ ...d, newEndTime: v }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOccRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitOccReschedule}>Reschedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      <Dialog open={detailsTarget !== null} onOpenChange={(open) => !open && setDetailsTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Booking details</DialogTitle>
            <DialogDescription>
              {detailsTarget
                ? `${detailsTarget.customerName} · ${detailsTarget.serviceName}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detailsTarget &&
            (() => {
              const order =
                workOrders.find((w) => w.id === detailsTarget.workOrderId) ?? null;
              const sourceRow =
                order?.serviceRows?.find((r) => r.id === detailsTarget.serviceRowId) ?? null;
              const customer =
                customers.find((c) => c.id === detailsTarget.customerId) ?? null;
              const noteGroups = collectOperationalNotes({
                scheduleNote: sourceRow?.notes ?? null,
                workOrderNotes: (order?.notes ?? [])
                  .filter((n) => n.status === "active")
                  .map((n) => ({ title: n.title, content: n.content })),
                customerNotes: (customer?.cardNotes ?? [])
                  .filter((n) => n.type === "admin" && n.status === "active")
                  .map((n) => ({ title: n.title, content: n.content })),
              });
              return <BookingDetails item={detailsTarget} noteGroups={noteGroups} />;
            })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsTarget(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity log dialog */}
      <Dialog open={logTarget !== null} onOpenChange={(open) => !open && setLogTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activity log</DialogTitle>
            <DialogDescription>
              {logTarget
                ? `${logTarget.customerName} · ${logTarget.serviceName} (${logTarget.workOrderNumber})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {logTarget && (
            <BookingLog
              item={logTarget}
              order={workOrders.find((w) => w.id === logTarget.workOrderId) ?? null}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogTarget(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load-all performance confirmation */}
      <Dialog open={confirmLoadAll} onOpenChange={(open) => !open && setConfirmLoadAll(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Show all {totalRows} listed bookings?</DialogTitle>
            <DialogDescription>
              Loading large result sets may reduce performance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLoadAll(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setPageSize("all");
                setConfirmLoadAll(false);
              }}
            >
              Show All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

/** Read-only metadata for a booking, surfaced from the row actions menu. */
function BookingDetails({
  item,
  noteGroups,
}: {
  item: BookingQueueItem;
  noteGroups: OperationalNoteGroup[];
}) {
  const employees = item.assignedEmployeeNames ?? [];
  const openSlots = normalizeUnassignedSlots(item.unassignedEmployeeSlots);
  const assignedValue =
    employees.length > 0
      ? `${employees.join(", ")}${openSlots > 0 ? ` + ${openSlots} unassigned slot${openSlots === 1 ? "" : "s"}` : ""}`
      : openSlots > 0
        ? `${openSlots} unassigned slot${openSlots === 1 ? "" : "s"}`
        : "Unassigned";
  const recurrence =
    item.recurrenceInterval && item.recurrenceInterval !== "one_time"
      ? RECURRENCE_INTERVAL_LABELS[item.recurrenceInterval]
      : "One-time";
  const dash = <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="rounded-lg border border-border px-3">
      <DetailRow label="Created" value={formatDate(item.createdAt)} />
      {item.updatedAt && <DetailRow label="Last updated" value={formatDate(item.updatedAt)} />}
      <DetailRow
        label="Booking ID"
        value={<span className="font-mono text-xs">{item.id}</span>}
      />
      <DetailRow label="Work order" value={item.workOrderNumber} />
      <DetailRow
        label="Work order ID"
        value={<span className="font-mono text-xs">{item.workOrderId}</span>}
      />
      <DetailRow label="Customer" value={item.customerName} />
      <DetailRow label="Service" value={item.serviceName} />
      <DetailRow
        label="Service date"
        value={item.serviceDate ? formatDate(item.serviceDate) : dash}
      />
      <DetailRow
        label="Planned time"
        value={
          item.plannedStartTime || item.plannedEndTime
            ? `${item.plannedStartTime ?? "—"} – ${item.plannedEndTime ?? "—"}`
            : dash
        }
      />
      <DetailRow
        label="Duration"
        value={formatBookingDuration(item.durationMinutes) || dash}
      />
      <DetailRow label="Recurrence" value={recurrence} />
      <DetailRow label="Assigned" value={assignedValue} />
      <DetailRow
        label="Assignment status"
        value={BOOKING_ASSIGNMENT_STATUS_LABELS[item.assignmentStatus]}
      />
      {noteGroups.length > 0 ? <BookingNotes groups={noteGroups} /> : null}
    </div>
  );
}

/**
 * Operational notes for a booking, read live from the source work order /
 * service row / customer card. The Schedule note is emphasised because it is
 * the instruction most directly tied to staffing and execution.
 */
function BookingNotes({ groups }: { groups: OperationalNoteGroup[] }) {
  return (
    <div className="space-y-3 border-t border-border/60 py-3">
      {groups.map((group) => {
        const isSchedule = group.key === "schedule";
        return (
          <div key={group.key} className="space-y-1.5">
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
                isSchedule ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {isSchedule ? <StickyNote className="h-3.5 w-3.5" aria-hidden /> : null}
              {group.label}
            </div>
            {group.notes.map((note, i) => (
              <div
                key={`${group.key}-${i}`}
                className={`rounded-lg border px-3 py-2 ${
                  isSchedule ? "border-primary/30 bg-primary/5" : "border-border bg-background"
                }`}
              >
                {note.title && note.title !== group.label ? (
                  <p className="text-sm font-medium">{note.title}</p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{note.content}</p>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Work-order activity actions relevant to a booking occurrence. These surface
 * the booking's life-cycle (creation, date/time and assignment edits,
 * reschedules and cancellations) from the existing work-order activity log —
 * no new audit system is introduced.
 */
const BOOKING_LOG_ACTIONS: ReadonlySet<WorkOrderActivityAction> = new Set([
  "created",
  "status_changed",
  "service_added",
  "service_edited",
  "service_archived",
  "service_restored",
  "booking_queued",
  "booking_cancelled",
  "booking_restored",
  "booking_rescheduled",
]);

/**
 * Read-only activity log for a booking occurrence, assembled from existing
 * data: the source work order's activity entries plus the booking's own
 * snapshot events (created, rescheduled, cancelled). Newest first.
 */
function BookingLog({ item, order }: { item: BookingQueueItem; order: WorkOrder | null }) {
  const events = useMemo(() => {
    const list: { id: string; summary: string; actor: string; at: string }[] = [];

    // Existing work-order activity, scoped to booking-relevant actions.
    for (const a of order?.activity ?? []) {
      if (!BOOKING_LOG_ACTIONS.has(a.action)) continue;
      list.push({ id: a.id, summary: a.summary, actor: a.actorName, at: a.at });
    }

    // Booking-level snapshot events not always mirrored in the activity log.
    list.push({
      id: `${item.id}::created`,
      summary: "Booking listed from work order service",
      actor: "System",
      at: item.createdAt,
    });
    if (item.reschedule) {
      const rs = item.reschedule;
      list.push({
        id: `${item.id}::reschedule`,
        summary: rescheduleLogSummary(
          {
            scope: rs.oneTime ? "occurrence" : "series",
            originalDate: rs.originalDate,
            newDate: rs.newDate,
          },
          rs.reason,
        ),
        actor: "System",
        at: rs.newDate,
      });
    }
    if (item.cancelledAt) {
      list.push({
        id: `${item.id}::cancelled`,
        summary: `Booking cancelled${item.cancelReason ? ` (${item.cancelReason})` : ""}`,
        actor: "System",
        at: item.cancelledAt,
      });
    }

    // De-dupe identical summary+timestamp pairs, then sort newest first.
    const seen = new Set<string>();
    return list
      .filter((e) => {
        const key = `${e.summary}@${e.at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [item, order]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
        <History className="h-7 w-7 opacity-40" />
        <p className="text-sm">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <ol className="relative max-h-[55vh] space-y-5 overflow-y-auto border-l border-border pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
          <p className="text-sm font-medium text-foreground">{e.summary}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {e.actor} · {formatDateTime(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
