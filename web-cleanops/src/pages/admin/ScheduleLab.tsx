import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  CircleDot,
  Clock,
  FlaskConical,
  Layers,
  Repeat,
  Users,
  XCircle,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useApp } from "@/context/AppContext";
import { formatDate, formatTimeRange, formatWeekday } from "@/lib/format";
import {
  overallIntegrity,
  resolveScheduleProgram,
  runScheduleIntegrityChecks,
  summarizeScheduleProgram,
  type IntegrityStatus,
  type ScheduleEntry,
} from "@/lib/scheduleCore";
import { withLegacyReschedules } from "@/lib/legacyReschedule";

/** Quick ranges the Lab can inspect. Custom uses the two date inputs. */
type RangePreset = "thisWeek" | "thisMonth" | "nextMonth" | "custom";
const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "nextMonth", label: "Next Month" },
  { value: "custom", label: "Custom Range" },
];

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
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  return addDays(x, day === 0 ? -6 : 1 - day);
}
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Resolves a preset (or the custom inputs) to an inclusive ISO date range. */
function resolveRange(
  preset: RangePreset,
  customStart: string,
  customEnd: string,
): { fromDate: string; toDate: string } {
  const now = new Date();
  switch (preset) {
    case "thisWeek": {
      const s = startOfWeek(now);
      return { fromDate: isoOf(s), toDate: isoOf(addDays(s, 6)) };
    }
    case "thisMonth": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { fromDate: isoOf(s), toDate: isoOf(e) };
    }
    case "nextMonth": {
      const s = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return { fromDate: isoOf(s), toDate: isoOf(e) };
    }
    case "custom":
    default: {
      if (customStart && customEnd && customStart <= customEnd) {
        return { fromDate: customStart, toDate: customEnd };
      }
      if (customStart && customEnd) return { fromDate: customEnd, toDate: customStart };
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { fromDate: isoOf(s), toDate: isoOf(e) };
    }
  }
}

/** Minutes → "20.0 h" (one decimal, trimmed). */
function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${(Math.round(h * 10) / 10).toFixed(1)} h`;
}

const INTEGRITY_STYLES: Record<IntegrityStatus, { badge: string; ring: string; label: string }> = {
  pass: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    ring: "border-emerald-200 dark:border-emerald-500/30",
    label: "Pass",
  },
  warn: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    ring: "border-amber-200 dark:border-amber-500/30",
    label: "Warning",
  },
  fail: {
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
    ring: "border-red-200 dark:border-red-500/30",
    label: "Fail",
  },
};

function IntegrityIcon({ status }: { status: IntegrityStatus }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <XCircle className="h-4 w-4 text-red-600" />;
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}
function Metric({ icon, label, value, hint }: MetricProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

function StatusPill({ entry }: { entry: ScheduleEntry }) {
  if (entry.status === "cancelled") {
    return (
      <Badge variant="outline" className="border-red-200 text-red-600 dark:text-red-400">
        Cancelled
      </Badge>
    );
  }
  if (entry.isRescheduled) {
    return (
      <Badge variant="outline" className="border-blue-200 text-blue-600 dark:text-blue-400">
        Rescheduled
      </Badge>
    );
  }
  if (entry.isVariation) {
    return (
      <Badge variant="outline" className="border-violet-200 text-violet-600 dark:text-violet-400">
        Variation
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-emerald-200 text-emerald-600 dark:text-emerald-400">
      Scheduled
    </Badge>
  );
}

/** How many resolved rows to render in the read-only preview table. */
const PREVIEW_LIMIT = 200;

/**
 * Schedule Integration Lab — the Phase 1 verification surface for the Schedule
 * Program. It runs the Shared Schedule Core against live data for a chosen date
 * range and proves the resolved data behaves correctly (integrity checks, a
 * glance-able roll-up, and a read-only preview of every resolved occurrence)
 * BEFORE any production scheduling UX is built. Read-only by design: no
 * scheduling, drag & drop, conflict handling, routing or workflows here.
 */
export default function ScheduleLab() {
  const { workOrders, customers, postalCities, employees, bookingQueue, bookingOccurrenceExceptions } =
    useApp();

  // Bridge legacy `item.reschedule` moves into the exception stream so the Lab's
  // totals match the Schedule and Booking Queue for pre-occurrence-exception data.
  const exceptionsWithLegacy = useMemo(
    () => withLegacyReschedules(bookingQueue, bookingOccurrenceExceptions),
    [bookingQueue, bookingOccurrenceExceptions],
  );

  const [preset, setPreset] = useState<RangePreset>("thisMonth");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  // Default excludes cancelled, matching the Schedule and Booking Queue defaults.
  const [includeCancelled, setIncludeCancelled] = useState<boolean>(false);

  const range = useMemo(
    () => resolveRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  const entries = useMemo(
    () =>
      resolveScheduleProgram({
        workOrders,
        customers,
        postalCities,
        employees,
        exceptions: exceptionsWithLegacy,
        fromDate: range.fromDate,
        toDate: range.toDate,
        includeCancelled,
      }),
    [workOrders, customers, postalCities, employees, exceptionsWithLegacy, range, includeCancelled],
  );

  const summary = useMemo(() => summarizeScheduleProgram(entries), [entries]);
  const checks = useMemo(() => runScheduleIntegrityChecks(entries, range), [entries, range]);
  const overall = useMemo(() => overallIntegrity(checks), [checks]);

  const handleStartChange = (value: string) => {
    setCustomStart(value);
    setPreset("custom");
  };
  const handleEndChange = (value: string) => {
    setCustomEnd(value);
    setPreset("custom");
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Schedule Integration Lab"
        description="A read-only diagnostics surface that resolves the Shared Schedule Core against live data and verifies it behaves correctly before the production Schedule is built."
        action={
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${INTEGRITY_STYLES[overall].ring} ${INTEGRITY_STYLES[overall].badge}`}
          >
            <FlaskConical className="h-4 w-4" />
            Integrity: {INTEGRITY_STYLES[overall].label}
          </span>
        }
      />

      {/* Range controls */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Range</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Start</Label>
            <Input
              type="date"
              value={range.fromDate}
              onChange={(e) => handleStartChange(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">End</Label>
            <Input
              type="date"
              value={range.toDate}
              onChange={(e) => handleEndChange(e.target.value)}
              className="w-40"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Include cancelled
          </label>
          <div className="ml-auto flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <CalendarRange className="h-4 w-4" />
            <span>
              {formatDate(range.fromDate)} → {formatDate(range.toDate)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Roll-up metrics */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          icon={<Layers className="h-4 w-4" />}
          label="Occurrences"
          value={String(summary.total)}
          hint={`${summary.active} active`}
        />
        <Metric
          icon={<Clock className="h-4 w-4" />}
          label="Visit hours"
          value={formatHours(summary.visitMinutes)}
          hint={`${formatHours(summary.labourMinutes)} labour`}
        />
        <Metric
          icon={<Users className="h-4 w-4" />}
          label="Employees"
          value={String(summary.distinctEmployees)}
          hint={`${summary.distinctCustomers} customers`}
        />
        <Metric
          icon={<Repeat className="h-4 w-4" />}
          label="Variations"
          value={String(summary.variations)}
          hint={`${summary.rescheduled} rescheduled`}
        />
        <Metric
          icon={<CircleDot className="h-4 w-4" />}
          label="Needs staffing"
          value={String(summary.needsStaffing)}
          hint={`${summary.unstaffed} unstaffed`}
        />
        <Metric
          icon={<XCircle className="h-4 w-4" />}
          label="Cancelled"
          value={String(summary.cancelled)}
          hint={`${summary.distinctServices} services`}
        />
      </div>

      {/* Integrity checks */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Integration checks
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {checks.map((check) => (
            <div
              key={check.id}
              className={`flex items-start gap-3 rounded-lg border p-3 ${INTEGRITY_STYLES[check.status].ring}`}
            >
              <IntegrityIcon status={check.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{check.label}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INTEGRITY_STYLES[check.status].badge}`}
                  >
                    {check.status === "pass" ? "OK" : `${check.count}`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{check.description}</p>
                {check.offenders.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground/80">
                    {check.offenders.map((o, i) => (
                      <li key={i} className="truncate">
                        • {o}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Resolved entries preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Resolved schedule ({entries.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No occurrences resolved for this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Employees</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.slice(0, PREVIEW_LIMIT).map((entry) => (
                    <TableRow key={entry.occurrenceKey}>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs text-muted-foreground">
                            {formatWeekday(entry.displayDate)}
                          </span>
                          <span className="font-medium">{formatDate(entry.displayDate)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatTimeRange(entry.startTime, entry.endTime) ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{entry.customerName || "—"}</TableCell>
                      <TableCell className="max-w-48 truncate">{entry.serviceName}</TableCell>
                      <TableCell className="text-sm">
                        {entry.assignedEmployeeNames.length > 0
                          ? entry.assignedEmployeeNames.join(", ")
                          : entry.unassignedEmployeeSlots > 0
                            ? `${entry.unassignedEmployeeSlots} open slot${entry.unassignedEmployeeSlots > 1 ? "s" : ""}`
                            : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {entry.visitMinutes ? `${entry.visitMinutes} min` : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusPill entry={entry} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {entries.length > PREVIEW_LIMIT ? (
                <p className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
                  Showing first {PREVIEW_LIMIT} of {entries.length} resolved occurrences.
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
