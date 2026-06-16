import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity as ActivityIcon,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CircleAlert,
  CircleStop,
  Clock,
  Copy,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  LayoutGrid,
  LogOut,
  Minus,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Star,
  StickyNote,
  Timer,
  Trash2,
  TriangleAlert,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AccessDenied } from "@/components/AccessDenied";
import { WorkOrderStatusBadge } from "@/components/WorkOrderStatusBadge";
import { perf } from "@/lib/perf";
import {
  AssignEmployeesDialog,
  type AssignDialogTarget,
} from "@/components/AssignEmployeesDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { QuickDurationHelper } from "@/components/ui/quick-duration-helper";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TimeReportStatusBadge } from "@/components/TimeReportStatusBadge";
import { CustomerSchedulingSummary } from "@/components/customer/CustomerSchedulingSummary";
import { NotesCard } from "@/components/notes/NotesCard";
import { WorkOrderImages } from "@/components/workorder/WorkOrderImages";
import {
  ServiceRowImages,
  WorkOrderHeaderImages,
} from "@/components/workorder/WorkOrderMediaPlacements";
import { ServiceProtocolLink } from "@/components/workorder/ServiceProtocolLink";
import { makeId } from "@/lib/store";
import {
  compareVariationStaffing,
  resolveCreateStaffing,
} from "@/lib/employeeAssignment";
import { addMinutesToTime } from "@/lib/time";
import { PreferredTimeStatusIcon } from "@/components/PreferredTimeStatusIcon";
import {
  evaluatePreferredTimeStatus,
  isPreferredTimeEvaluationAvailable,
  preferredTimeInputFromPreferences,
  weekdayFromIso,
} from "@/lib/evaluatePreferredTime";
import type { PreferredTimeEvaluationResult } from "@/lib/evaluatePreferredTime";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useCustomerMutations } from "@/hooks/use-customer-mutations";
import { useWorkOrderDetailSource } from "@/hooks/use-work-order-detail-source";
import { useWorkOrderMutations } from "@/hooks/use-work-order-mutations";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeCustomerCardChanges } from "@/lib/customerLog";
import type { SupabaseCustomerUpdatePatch } from "@/lib/data/supabaseCustomerRepository";
import {
  verifyAddedWorkOrderServiceRowReadableFromSupabase,
  verifyRemovedWorkOrderServiceRowReadableFromSupabase,
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase,
  type SupabaseWorkOrderServiceRowUpdatePatch,
} from "@/lib/data/supabaseWorkOrderRepository";
import {
  generateBookingPreview,
  PREVIEW_RANGES,
  DEFAULT_PREVIEW_RANGE,
} from "@/lib/bookingPreview";
import type { PreviewBooking, PreviewRange } from "@/lib/bookingPreview";
import {
  validateServiceRowArchive,
  deriveServiceLifecycleStage,
  validateServiceRowDelete,
  validateServiceRowForceDelete,
  validateVariationDelete,
  isOccurrenceExceptionOperational,
  isForceDeleteConfirmed,
  FORCE_DELETE_CONFIRMATION_WORD,
} from "@/lib/archiveValidation";
import { evaluateVariationConflict } from "@/lib/variationOverlap";
import type { VariationConflict, VariationOverlapSeries } from "@/lib/variationOverlap";
import {
  generateServiceRowOccurrences,
  variationHasPastOccurrence,
  countServiceRowGeneratedOccurrences,
  DEFAULT_OCCURRENCE_LIMIT,
} from "@/lib/serviceRowOccurrences";
import type { ServiceRowOccurrence } from "@/lib/serviceRowOccurrences";
import { variationMatchesOccurrence } from "@/lib/variationResolver";
import { resolveClonedEndDate } from "@/lib/cloneService";
import {
  WORK_ORDER_STATUSES,
  WORK_ORDER_SERVICE_STATUSES,
  RECURRENCE_INTERVALS,
  RECURRENCE_INTERVAL_LABELS,
  DEFAULT_RECURRENCE_INTERVAL,
  WEEK_DAYS,
  WEEK_DAY_LABELS,
  RECURRING_VARIATION_FREQUENCIES,
  RECURRING_VARIATION_FREQUENCY_LABELS,
  VARIATION_TYPES,
  VARIATION_TYPE_LABELS,
  VARIATION_STATUSES,
  VARIATION_STATUS_LABELS,
  VARIATION_DISPLAY_STATE_LABELS,
  getVariationStatus,
  getVariationDisplayState,
  WEEK_OF_MONTH_OPTIONS,
  TIME_REPORT_APPROVAL_STATUS_LABELS,
  calculateTimeDeviationMinutes,
  calculatePlannedDurationMinutes,
  calculatePlannedLabourMinutes,
  indexOccurrenceExceptions,
  resolveTimeReportApproval,
  normalizeUnassignedSlots,
  formatUnassignedSlots,
  resolveCustomerCardLogChangeType,
} from "@/types";
import type {
  Customer,
  CustomerSchedulingPreferences,
  RecurringVariation,
  TimeReport,
  RecurringVariationFrequency,
  RecurrenceInterval,
  Service,
  VariationType,
  VariationStatus,
  VariationDisplayState,
  ServiceCategory,
  WeekDay,
  CustomerCardLogEntry,
  CustomerCardNote,
  CustomerCardNoteType,
  WorkOrder,
  WorkOrderActivity,
  WorkOrderNote,
  WorkOrderServiceRow,
  WorkOrderServiceStatus,
  WorkOrderStatus,
} from "@/types";

const TABS = [
  { value: "services", label: "Services", icon: LayoutGrid },
  { value: "overview", label: "Overview", icon: ClipboardList },
  { value: "images", label: "Images", icon: ImageIcon },
  { value: "time-reports", label: "Time Reports", icon: Clock },
  { value: "activity", label: "Activity Log", icon: ActivityIcon },
] as const;

function withCustomerCardLog(
  customer: Customer,
  patch: SupabaseCustomerUpdatePatch,
  currentUser: ReturnType<typeof useApp>["currentUser"],
): SupabaseCustomerUpdatePatch {
  const changes = describeCustomerCardChanges(customer, patch);
  if (changes.length === 0) return patch;
  const now = new Date().toISOString();
  const changeType = resolveCustomerCardLogChangeType("admin_portal", Boolean(currentUser));
  const logEntries: CustomerCardLogEntry[] = changes.map((change) => ({
    id: makeId("clog"),
    at: now,
    section: change.section,
    field: change.field,
    changeType,
    oldValue: change.oldValue,
    newValue: change.newValue,
    changedById: currentUser?.id ?? null,
    changedByName: currentUser?.name ?? "System",
    changedByRole: currentUser?.role ?? "company_admin",
    source: "admin_portal",
  }));
  return {
    ...patch,
    cardLog: [...logEntries, ...(customer.cardLog ?? [])].slice(0, 500),
  };
}

/**
 * Admin-facing Work Order Details page. Reached by opening a work order from the
 * Customer Card. Access is scoped through the context's getWorkOrder, which only
 * returns orders the signed-in user may see.
 */
export default function WorkOrderDetails() {
  // Dev-only render accounting (no-op in production).
  perf.count("WorkOrderDetails.render");
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();
  const {
    getWorkOrder,
    customers,
    getTimeReportsForWorkOrder,
    currentUser,
    hydrateWorkOrderFromRemote,
  } = useApp();

  // localStorage access copy (may be null when the order lives only in Supabase
  // under the authoritative read path). Access for Supabase-only orders is
  // enforced by the company-scoped detail read inside useWorkOrderDetailSource.
  const localOrder = workOrderId ? getWorkOrder(workOrderId) : null;
  // WO-3 (P5E): the DETAIL read source. With the feature flag off (default) this
  // is exactly `localOrder`; with it on it reads from Supabase via the repository
  // seam. Empty/missing Supabase data renders absence, not local fallback. Super
  // Admins read unscoped; company users are scoped to their company.
  const detailScope = currentUser
    ? currentUser.role === "super_admin"
      ? undefined
      : currentUser.companyId ?? null
    : null;
  const {
    workOrder: resolvedOrder,
    loading: workOrderLoading,
    error: workOrderReadError,
  } = useWorkOrderDetailSource(localOrder, workOrderId, detailScope);
  const [serverConfirmedOrder, setServerConfirmedOrder] = useState<WorkOrder | null>(null);
  const shouldUseServerConfirmedOrder =
    serverConfirmedOrder != null &&
    resolvedOrder != null &&
    serverConfirmedOrder.id === resolvedOrder.id &&
    hasServerConfirmedServiceRowsChanged(serverConfirmedOrder, resolvedOrder);
  const order = shouldUseServerConfirmedOrder ? serverConfirmedOrder : resolvedOrder;

  // In-memory bridge only: a Supabase-only work order is copied into React state
  // so current-session action seams can operate, but it is not persisted to
  // browser storage and is not mirrored back to Supabase.
  useEffect(() => {
    if (order && !localOrder) {
      hydrateWorkOrderFromRemote(order);
    }
  }, [order, localOrder, hydrateWorkOrderFromRemote]);
  // Only the tab badge needs the count — memoize so tab switches don't re-scan
  // and re-sort the full time-report list. The Time Reports tab fetches its own.
  const timeReportCount = useMemo(
    () => (workOrderId ? getTimeReportsForWorkOrder(workOrderId).length : 0),
    [workOrderId, getTimeReportsForWorkOrder],
  );
  const customer = useMemo(
    () => (order ? customers.find((c) => c.id === order.customerId) : undefined),
    [customers, order],
  );

  const [tab, setTab] = useState<string>("services");
  const [servicesAddOpen, setServicesAddOpen] = useState<boolean>(false);
  const [showArchivedServices, setShowArchivedServices] = useState<boolean>(false);

  useEffect(() => {
    setTab("services");
    setServicesAddOpen(false);
    setShowArchivedServices(false);
    setServerConfirmedOrder(null);
  }, [workOrderId]);

  if (workOrderLoading && !order) {
    return (
      <DashboardLayout wide>
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading work order…
        </div>
      </DashboardLayout>
    );
  }

  if (!order) {
    return (
      <DashboardLayout wide>
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 text-muted-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" /> Go back
        </Button>
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl tracking-tight">Work order unavailable</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                This work order could not be found for your current company scope, may have been removed,
                or is not visible to this session.
              </p>
              {workOrderReadError ? (
                <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {workOrderReadError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const canAccessOrder =
    currentUser?.role === "super_admin" ||
    (currentUser?.companyId != null && order.companyId === currentUser.companyId);

  if (!canAccessOrder) {
    return <AccessDenied />;
  }

  const activeNoteCount = (order.notes ?? []).filter((n) => n.status === "active").length;
  const activeServiceCount = (order.serviceRows ?? []).filter((r) => !r.archived).length;
  const counts: Record<string, number | undefined> = {
    services: activeServiceCount,
    "time-reports": timeReportCount,
  };
  void activeNoteCount;

  return (
    <DashboardLayout wide>
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2 text-muted-foreground"
        onClick={() => (customer ? navigate(`/customers/${customer.id}`) : navigate(-1))}
      >
        <ArrowLeft className="h-4 w-4" /> Back to customer
      </Button>

      {/* Identity header */}
      <div className="mb-6 flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl tracking-tight">{order.title || order.number}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Hash className="h-3.5 w-3.5" /> {order.number}
              </span>
              {customer ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => navigate(`/customers/${customer.id}`)}
                >
                  <Building2 className="h-3.5 w-3.5" /> {customer.name}
                </button>
              ) : null}
              <WorkOrderStatusBadge status={order.status} />
            </div>
          </div>
        </div>
        <div className="lg:max-w-[60%]">
          <WorkOrderHeaderImages order={order} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="-mx-1 mb-6 flex flex-col gap-3 px-1 pb-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tab === "services" ? (
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => setServicesAddOpen((v) => !v)}
              >
                <Plus className="h-4 w-4" /> Add Service
              </Button>
            ) : null}
            <TabsList className="h-auto flex-nowrap gap-1">
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5 whitespace-nowrap">
                  <Icon className="h-4 w-4" />
                  {label}
                  {counts[value] != null && counts[value]! > 0 ? (
                    <span className="ml-0.5 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                      {counts[value]}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {tab === "services" ? (
            <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
              <Switch checked={showArchivedServices} onCheckedChange={setShowArchivedServices} />
              Show archived services
            </label>
          ) : null}
        </div>

        <TabsContent value="overview">
          <OverviewTab order={order} customer={customer} />
        </TabsContent>
        <TabsContent value="services">
          <ServicesTab
            order={order}
            addOpen={servicesAddOpen}
            onAddOpenChange={setServicesAddOpen}
            onServiceAdded={setServerConfirmedOrder}
            showArchived={showArchivedServices}
          />
        </TabsContent>
        <TabsContent value="images">
          <WorkOrderImages order={order} />
        </TabsContent>
        <TabsContent value="time-reports">
          <TimeReportsTab order={order} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab order={order} />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}

// ─────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────

function toDateInput(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function OverviewTab({ order, customer }: { order: WorkOrder; customer?: Customer }) {
  const customerName = customer?.name;
  const { toast } = useToast();
  const { updateWorkOrder } = useApp();
  const [editing, setEditing] = useState<boolean>(false);
  const [title, setTitle] = useState<string>(order.title ?? "");
  const [status, setStatus] = useState<WorkOrderStatus>(order.status);
  const [startDate, setStartDate] = useState<string>(toDateInput(order.startDate));
  const [endDate, setEndDate] = useState<string>(toDateInput(order.endDate));
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setEditing(false);
  }, [order.id]);

  const startEdit = () => {
    setTitle(order.title ?? "");
    setStatus(order.status);
    setStartDate(toDateInput(order.startDate));
    setEndDate(toDateInput(order.endDate));
    setError("");
    setEditing(true);
  };

  const save = () => {
    const res = updateWorkOrder(order.id, {
      title: title.trim() || undefined,
      status,
      startDate: startDate ? new Date(startDate).toISOString() : undefined,
      endDate: endDate ? new Date(endDate).toISOString() : undefined,
    });
    if (!res.ok) {
      setError(res.error ?? "Unable to save changes.");
      return;
    }
    toast({ title: "Work order updated" });
    setEditing(false);
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-end gap-2">
        {!editing ? (
          <Button onClick={startEdit}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button onClick={save}>Save changes</Button>
          </>
        )}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Section title="Work order details">
        {editing ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Title" hint="Optional">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Spring deep clean" />
            </Field>
            <Field label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as WorkOrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_ORDER_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End date">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <InfoRow icon={<Hash className="h-4 w-4" />} label="Work order number" value={order.number} />
            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Customer" value={customerName} />
            <InfoRow label="Status">
              <WorkOrderStatusBadge status={order.status} />
            </InfoRow>
            <InfoRow label="Title" value={order.title} />
            <InfoRow label="Start date" value={order.startDate ? formatDate(order.startDate) : undefined} />
            <InfoRow label="End date" value={order.endDate ? formatDate(order.endDate) : undefined} />
            <InfoRow icon={<User className="h-4 w-4" />} label="Created by" value={order.createdByName} />
            <InfoRow label="Created" value={formatDate(order.createdAt)} />
            <InfoRow label="Last updated" value={formatDate(order.updatedAt)} />
          </div>
        )}
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────
// Services tab (foundation only)
// ─────────────────────────────────────────────

/** Detail fields shared by the add and edit service-row dialogs. */
interface RowDraft {
  serviceName: string;
  articleNumber: string;
  categoryName: string;
  serviceType: string;
  quantity: string;
  unit: string;
  price: string;
  vat: string;
  status: WorkOrderServiceStatus;
  notes: string;
  serviceDate: string;
  serviceEndDate: string;
  plannedStartTime: string;
  plannedEndTime: string;
  assignedEmployeeIds: string[];
  /** Open / unassigned staffing slots (kept as a string for the input). */
  openSlots: string;
  recurrenceInterval: RecurrenceInterval;
  /**
   * Inline Add Service only — remembers the last quick-duration choice (in
   * minutes) so changing the start time recalculates the planned end while
   * preserving the duration. Cleared when Planned end is edited manually.
   */
  quickDurationMinutes?: number | null;
}

function emptyDraft(): RowDraft {
  return {
    serviceName: "",
    articleNumber: "",
    categoryName: "",
    serviceType: "",
    quantity: "1",
    unit: "",
    price: "",
    vat: "",
    status: "planned",
    notes: "",
    serviceDate: "",
    serviceEndDate: "",
    plannedStartTime: "",
    plannedEndTime: "",
    assignedEmployeeIds: [],
    openSlots: "",
    recurrenceInterval: DEFAULT_RECURRENCE_INTERVAL,
  };
}

function numOrUndefined(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const SERVICE_ROW_ACTION_UNAVAILABLE_MESSAGE =
  "This action is being updated and is not available yet.";

function serviceRowActionUnavailableToast() {
  return {
    title: "Temporarily unavailable",
    description: SERVICE_ROW_ACTION_UNAVAILABLE_MESSAGE,
    variant: "destructive" as const,
  };
}

function hasServerConfirmedServiceRowsChanged(
  serverConfirmedOrder: WorkOrder,
  resolvedOrder: WorkOrder,
): boolean {
  const confirmedRows = serverConfirmedOrder.serviceRows ?? [];
  const resolvedRows = resolvedOrder.serviceRows ?? [];
  if (confirmedRows.length !== resolvedRows.length) return true;
  const resolvedById = new Map(resolvedRows.map((row) => [row.id, row]));
  return confirmedRows.some((confirmedRow) => {
    const resolvedRow = resolvedById.get(confirmedRow.id);
    return !resolvedRow || JSON.stringify(confirmedRow) !== JSON.stringify(resolvedRow);
  });
}

/** Human-readable duration from minutes, e.g. 240 → "4 hours", 150 → "2 hours 30 min". */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return parts.length > 0 ? parts.join(" ") : "0 min";
}

/**
 * Compact duration for summaries, e.g. 120 → "2 h", 270 → "4 h 30 min".
 * Returns null for missing / non-positive input so callers can render a dash.
 */
function formatDurationCompact(totalMinutes: number | null | undefined): string | null {
  if (totalMinutes == null || totalMinutes <= 0) return null;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Compact, display-only planned-duration summary shown to the right of the
 * Planned end picker. Renders a placeholder while no valid duration is set so
 * the surrounding grid keeps a stable layout. Purely informational — it never
 * changes scheduling data.
 */
function DurationSummaryBox({ minutes }: { minutes: number | null }) {
  const hasValue = minutes != null && minutes > 0;
  const hours = hasValue ? Math.floor(minutes / 60) : 0;
  const mins = hasValue ? minutes % 60 : 0;
  const main = hasValue
    ? [hours > 0 ? `${hours} h` : null, mins > 0 ? `${mins} min` : null].filter(Boolean).join(" ")
    : "—";
  return (
    <div className="space-y-1.5" aria-label="Planned duration">
      <Label>Duration</Label>
      <div className="flex h-10 min-w-[3.5rem] items-center justify-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium tabular-nums text-foreground">
        {main}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">{hasValue ? `${minutes} min` : "Optional"}</p>
    </div>
  );
}

/** Quick-pick hours offered above the Planned start picker (08:00–17:00). */
const QUICK_START_HOURS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17"] as const;
const QUICK_START_QUARTERS = ["00", "15", "30", "45"] as const;

/**
 * Two-step quick start-time picker. The first step lists whole hours; tapping an
 * hour reveals its four quarter options. Selecting a quarter only sets Planned
 * start (never Planned end) — a UX shortcut on top of the regular manual time
 * input / clock, which keep working independently.
 */
function QuickStartTimePicker({ onSelect }: { onSelect: (value: string) => void }) {
  const [hour, setHour] = useState<string | null>(null);
  const chipClass =
    "rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium tabular-nums text-foreground transition-colors hover:bg-muted";

  if (hour) {
    return (
      <div className="space-y-1.5" aria-label="Quick start time">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Quick start · {hour}:00
          </span>
          <button
            type="button"
            onClick={() => setHour(null)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Back
          </button>
        </div>
        <div className="flex min-h-[3.25rem] flex-wrap content-start gap-1.5">
          {QUICK_START_QUARTERS.map((m) => {
            const value = `${hour}:${m}`;
            return (
              <button
                key={value}
                type="button"
                className={chipClass}
                onClick={() => {
                  onSelect(value);
                  setHour(null);
                }}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" aria-label="Quick start time">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Quick start time
      </span>
      <div className="flex min-h-[3.25rem] flex-wrap content-start gap-1.5">
        {QUICK_START_HOURS.map((h) => (
          <button key={h} type="button" className={chipClass} onClick={() => setHour(h)}>
            {h}:00
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Searchable employee assignment control for the inline Add Service panel.
 * Replaces the flat "every employee is a button" layout, which does not scale to
 * 50–100 employees. A free-text search filters by name; matches are selectable
 * rows, and the chosen employees render as removable chips above the search.
 *
 * UX only — it operates purely on the provided ids/setter and never mutates
 * staffing persistence.
 */
function EmployeeMultiSelect({
  employees,
  selectedIds,
  onToggle,
}: {
  employees: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState<string>("");
  const trimmed = query.trim().toLowerCase();
  const selected = useMemo(
    () => employees.filter((e) => selectedIds.includes(e.id)),
    [employees, selectedIds],
  );
  const matches = useMemo(() => {
    if (trimmed.length === 0) return [];
    return employees.filter((e) => e.name.toLowerCase().includes(trimmed)).slice(0, 8);
  }, [employees, trimmed]);

  if (employees.length === 0) {
    return <p className="text-sm text-muted-foreground">No active employees for this company yet.</p>;
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Selected employees">
          {selected.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 py-1 pl-3 pr-1 text-xs font-medium text-primary"
            >
              {e.name}
              <button
                type="button"
                onClick={() => onToggle(e.id)}
                aria-label={`Remove ${e.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee..."
          aria-label="Search employee"
          className="pl-8"
        />
      </div>
      {trimmed.length > 0 ? (
        matches.length > 0 ? (
          <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border bg-background p-1">
            {matches.map((e) => {
              const active = selectedIds.includes(e.id);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(e.id)}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors ${
                      active ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <span>{e.name}</span>
                    {active ? <Check className="h-4 w-4" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">No employees found.</p>
        )
      ) : null}
    </div>
  );
}

/**
 * Whether a service row recurs (any interval other than "one_time"). Recurring
 * rows lock their recurrence interval and original service date, and expose the
 * End Service / Clone Service actions.
 */
function isRecurringRow(row: WorkOrderServiceRow): boolean {
  const interval = row.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL;
  return interval !== "one_time";
}

/**
 * Resolves which scheduling preferences apply to a service row: the row's own
 * override when {@link WorkOrderServiceRow.scheduleSource} is "override",
 * otherwise the customer's default preferences. Mirrors the booking-preview
 * resolution so the two never diverge.
 */
function resolveRowSchedulingPreferences(
  row: WorkOrderServiceRow,
  customer: Customer | null,
): CustomerSchedulingPreferences | null {
  return row.scheduleSource === "override" && row.schedulePreferences
    ? row.schedulePreferences
    : customer?.schedulingPreferences ?? null;
}

/**
 * Evaluates a service row's planned date/time against the resolved customer
 * preferences using the shared, pure evaluator. Returns `none` when there are
 * no preferences so callers can simply skip rendering an icon.
 */
function evaluateRowPreferredTime(
  row: WorkOrderServiceRow,
  customer: Customer | null,
): PreferredTimeEvaluationResult {
  const prefs = resolveRowSchedulingPreferences(row, customer);
  return evaluatePreferredTimeStatus(
    preferredTimeInputFromPreferences(prefs, {
      scheduledDate: row.serviceDate ?? null,
      plannedStartTime: row.plannedStartTime ?? null,
      plannedEndTime: row.plannedEndTime ?? null,
    }),
  );
}

function ServicesTab({
  order,
  addOpen,
  onAddOpenChange,
  onServiceAdded,
  showArchived,
}: {
  order: WorkOrder;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  onServiceAdded: (workOrder: WorkOrder) => void;
  showArchived: boolean;
}) {
  const { toast } = useToast();
  const {
    customers,
    employees,
    timeReports,
    bookingOccurrenceExceptions,
    systemSettings,
    getWorkOrderSettingsFor,
    isCompanyEntitledToService,
    hasPermission,
    hydrateWorkOrderFromRemote,
  } = useApp();

  const rows = order.serviceRows ?? [];
  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);
  const customer = useMemo(
    () => customers.find((c) => c.id === order.customerId) ?? null,
    [customers, order.customerId],
  );
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const editRow = editRowId ? rows.find((r) => r.id === editRowId) ?? null : null;
  const [_variationRowId, _setVariationRowId] = useState<string | null>(null);
  const [_wizardRowId, _setWizardRowId] = useState<string | null>(null);
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);
  const previewRow = previewRowId ? rows.find((r) => r.id === previewRowId) ?? null : null;
  const [_checkoutRowId, _setCheckoutRowId] = useState<string | null>(null);
  const [changeDateTimeRowId, setChangeDateTimeRowId] = useState<string | null>(null);
  const changeDateTimeRow = changeDateTimeRowId
    ? rows.find((r) => r.id === changeDateTimeRowId) ?? null
    : null;
  const [_assignRowId, _setAssignRowId] = useState<string | null>(null);
  const [endRowId, setEndRowId] = useState<string | null>(null);
  const endRow = endRowId ? rows.find((r) => r.id === endRowId) ?? null : null;
  const [_cloneRowId, _setCloneRowId] = useState<string | null>(null);
  const [archiveRowId, setArchiveRowId] = useState<string | null>(null);
  const archiveRow = archiveRowId ? rows.find((r) => r.id === archiveRowId) ?? null : null;
  const archiveValidation = archiveRow ? validateServiceRowArchive(archiveRow) : null;
  const workOrderMutations = useWorkOrderMutations({
    companyId: order.companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);
  const deleteRow = deleteRowId ? rows.find((r) => r.id === deleteRowId) ?? null : null;
  const deleteValidation = deleteRow
    ? validateServiceRowDelete(deleteRow, {
        hasTimeReports: timeReports.some((t) => t.serviceRowId === deleteRow.id),
        hasOccurrenceExceptions: bookingOccurrenceExceptions.some(
          (e) =>
            e.parentServiceRowId === deleteRow.id &&
            isOccurrenceExceptionOperational(e),
        ),
      })
    : null;
  // Force-delete eligibility for the blocked delete dialog: only offered when a
  // normal delete is blocked, the row produced historical generated occurrences,
  // and no financial/locked dependency is attached.
  const deleteRowCounts = deleteRow
    ? countServiceRowGeneratedOccurrences(deleteRow)
    : null;
  const deleteRowForceValidation = deleteRow
    ? validateServiceRowForceDelete({
        hasPayrollBasis: false,
        hasInvoiceBasis: false,
        hasCompletedTimeReports: timeReports.some((t) => t.serviceRowId === deleteRow.id),
        hasLockedHistory: false,
        hasExportedPayroll: false,
        hasExportedInvoice: false,
      })
    : null;
  const canOfferForceDelete =
    deleteValidation != null &&
    !deleteValidation.allowed &&
    (deleteRowCounts?.past ?? 0) > 0 &&
    deleteRowForceValidation?.allowed === true;

  const [forceDeleteRowId, setForceDeleteRowId] = useState<string | null>(null);
  const forceDeleteRow = forceDeleteRowId
    ? rows.find((r) => r.id === forceDeleteRowId) ?? null
    : null;
  const forceDeleteCounts = forceDeleteRow
    ? countServiceRowGeneratedOccurrences(forceDeleteRow)
    : null;
  const forceDeleteValidation = forceDeleteRow
    ? validateServiceRowForceDelete({
        hasPayrollBasis: false,
        hasInvoiceBasis: false,
        hasCompletedTimeReports: timeReports.some(
          (t) => t.serviceRowId === forceDeleteRow.id,
        ),
        hasLockedHistory: false,
        hasExportedPayroll: false,
        hasExportedInvoice: false,
      })
    : null;
  const [forceDeleteConfirm, setForceDeleteConfirm] = useState<string>("");
  useEffect(() => {
    if (forceDeleteRowId) setForceDeleteConfirm("");
  }, [forceDeleteRowId]);

  const preferredTimeAvailable = isPreferredTimeEvaluationAvailable({
    masterAllows: systemSettings.allowPreferredTimeEvaluation === true,
    companyEntitled: isCompanyEntitledToService(
      order.companyId,
      "preferred_time_evaluation",
    ),
    companyEnabled:
      getWorkOrderSettingsFor(order.companyId).preferredTimeEvaluationEnabled === true,
  });

  const activeSorted = rows.filter((r) => !r.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = rows
    .filter((r) => showArchived || !r.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const showUnavailable = () => {
    toast(serviceRowActionUnavailableToast());
  };

  const showRecurringDateTimeUnavailable = () => {
    toast({
      title: "Temporarily unavailable",
      description: "Temporarily unavailable for recurring services.",
      variant: "destructive",
    });
  };

  const openChangeDateTime = (row: WorkOrderServiceRow) => {
    if (isRecurringRow(row)) {
      showRecurringDateTimeUnavailable();
      return;
    }
    setChangeDateTimeRowId(row.id);
  };

  const move = (_row: WorkOrderServiceRow, _dir: "up" | "down") => {
    showUnavailable();
  };

  const confirmArchive = async () => {
    if (!archiveRow || workOrderMutations.isPending) return;
    if (!archiveValidation?.allowed) {
      toast({
        title: "Cannot archive service",
        description: archiveValidation?.blockedMessage ?? "This service cannot be archived.",
        variant: "destructive",
      });
      return;
    }

    try {
      await workOrderMutations.archiveServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: archiveRow.id,
      });
      const verified = await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: archiveRow.id,
        expectedPatch: { archived: true },
      });
      hydrateWorkOrderFromRemote(verified);
      onServiceAdded(verified);
      toast({ title: "Service archived", description: `${archiveRow.serviceName} has been archived.` });
      setArchiveRowId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to archive service.";
      toast({ title: "Unable to archive", description: message, variant: "destructive" });
    }
  };

  const restoreRow = async (row: WorkOrderServiceRow) => {
    if (workOrderMutations.isPending) return;
    try {
      await workOrderMutations.restoreServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
      });
      const verified = await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        expectedPatch: { archived: false },
      });
      hydrateWorkOrderFromRemote(verified);
      onServiceAdded(verified);
      toast({ title: "Service restored", description: `${row.serviceName} has been restored.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to restore service.";
      toast({ title: "Unable to restore", description: message, variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow || workOrderMutations.isPending || !deleteValidation?.allowed) return;
    try {
      await workOrderMutations.removeServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: deleteRow.id,
      });
      const verified = await verifyRemovedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: deleteRow.id,
      });
      hydrateWorkOrderFromRemote(verified);
      onServiceAdded(verified);
      toast({ title: "Service deleted", description: `${deleteRow.serviceName} has been removed.` });
      setDeleteRowId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete service.";
      toast({ title: "Unable to delete", description: message, variant: "destructive" });
    }
  };

  const confirmForceDelete = () => {
    if (!isForceDeleteConfirmed(forceDeleteConfirm)) return;
    showUnavailable();
  };

  return (
    <div className="grid gap-5">
      {addOpen ? (
        <InlineAddServicePanel
          order={order}
          onClose={() => onAddOpenChange(false)}
          onServiceAdded={onServiceAdded}
        />
      ) : null}

      {visible.length === 0 ? (
        <Section title="Services">
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <LayoutGrid className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">No services added yet.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              A work order can hold multiple services. Add one from the service catalog to get started.
            </p>
          </div>
        </Section>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Service</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Total Time</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead>Recurrence</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Variations</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const activeIdx = activeSorted.findIndex((a) => a.id === r.id);
                const activeVariations = (r.variations ?? []).filter(
                  (v) => getVariationStatus(v) !== "archived",
                );
                const preferredTime = preferredTimeAvailable
                  ? evaluateRowPreferredTime(r, customer)
                  : null;
                return (
                  <Fragment key={r.id}>
                  <TableRow className={r.archived ? "opacity-60" : undefined}>
                    <TableCell className="pr-0">
                      {!r.archived ? (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={activeIdx <= 0}
                            onClick={() => move(r, "up")}
                            aria-label="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={activeIdx >= activeSorted.length - 1}
                            onClick={() => move(r, "down")}
                            aria-label="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.serviceName}</div>
                      {!r.archived && deriveServiceLifecycleStage(r) === "archive_upcoming" ? (
                        <Badge
                          variant="outline"
                          className="mt-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        >
                          Archive Upcoming
                        </Badge>
                      ) : null}
                      {r.archived && isRecurringRow(r) ? (
                        <p className="mt-1 max-w-[14rem] text-xs text-muted-foreground">
                          Archived recurring service. Clone it as a new service
                          (with a fresh start date) instead of restoring — this
                          keeps the history and avoids recreating past bookings.
                        </p>
                      ) : null}
                      {r.notes?.trim() ? (
                        <div className="mt-1.5 flex max-w-[16rem] items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1">
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
                          <p className="whitespace-pre-wrap text-xs leading-snug text-foreground/80">
                            <span className="sr-only">Schedule note: </span>
                            {r.notes.trim()}
                          </p>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {!r.archived ? (
                        <button
                          type="button"
                          onClick={() => openChangeDateTime(r)}
                          className="group -mx-1.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted"
                          aria-label="Change date/time"
                          title={isRecurringRow(r) ? "Temporarily unavailable for recurring services" : "Change date/time"}
                        >
                          <PlannedDate row={r} />
                          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ) : (
                        <PlannedDate row={r} />
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <ServiceEndDateCell
                        row={r}
                        disabled={r.archived || workOrderMutations.isPending}
                        onClick={() => setEndRowId(r.id)}
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      {!r.archived ? (
                        <button
                          type="button"
                          onClick={() => openChangeDateTime(r)}
                          className="group -mx-1.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted"
                          aria-label="Change date/time"
                          title={isRecurringRow(r) ? "Temporarily unavailable for recurring services" : "Change date/time"}
                        >
                          <PlannedTime row={r} preferredTime={preferredTime} />
                          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ) : (
                        <PlannedTime row={r} preferredTime={preferredTime} />
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <VisitDuration row={r} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <TotalTime row={r} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const ids = r.assignedEmployeeIds ?? [];
                          const slots = normalizeUnassignedSlots(r.unassignedEmployeeSlots);
                          if (ids.length === 0 && slots === 0)
                            return <span className="text-muted-foreground">Unassigned</span>;
                          const names = ids.map((id) => employeeNameById.get(id) ?? "Unknown");
                          return (
                            <span className="min-w-0">
                              {names.join(", ")}
                              {slots > 0 ? (
                                <span className={names.length > 0 ? "text-amber-600" : ""}>
                                  {names.length > 0 ? ", " : ""}
                                  {slots === 1 ? "Unassigned slot" : `Unassigned slot x${slots}`}
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
                        {!r.archived ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground"
                            onClick={showUnavailable}
                            aria-label="Assign employees"
                            title="Coming soon"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <RecurrenceLabel interval={r.recurrenceInterval} endDate={r.serviceEndDate} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.price != null ? formatCurrency(r.price) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2"
                        onClick={showUnavailable}
                        title="Coming soon"
                      >
                        <Repeat className="h-3.5 w-3.5" />
                        {(() => {
                          const active = (r.variations ?? []).filter(
                            (v) => getVariationStatus(v) !== "archived",
                          ).length;
                          return active > 0 ? active : "Add";
                        })()}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {!r.archived ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={showUnavailable}
                              aria-label="Check out / report time"
                              title="Coming soon"
                            >
                              <LogOut className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPreviewRowId(r.id)}
                              aria-label="Preview bookings"
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditRowId(r.id)} aria-label="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {isRecurringRow(r) ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={showUnavailable}
                                  aria-label="Clone service"
                                  title="Coming soon"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEndRowId(r.id)}
                                  aria-label="End service"
                                  disabled={workOrderMutations.isPending}
                                >
                                  <CircleStop className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setArchiveRowId(r.id)}
                              aria-label="Archive"
                              disabled={workOrderMutations.isPending}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteRowId(r.id)}
                              aria-label="Delete"
                              disabled={workOrderMutations.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : isRecurringRow(r) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={showUnavailable}
                            aria-label="Clone as new service"
                            title="Coming soon"
                          >
                            <Copy className="h-3.5 w-3.5" /> Clone
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void restoreRow(r)}
                            aria-label="Restore"
                            disabled={workOrderMutations.isPending}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {!r.archived && activeVariations.length > 0 ? (
                    <ServiceVariationsRow orderId={order.id} row={r} variations={activeVariations} colSpan={12} />
                  ) : null}
                  {!r.archived ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={13} className="py-3">
                        <ServiceRowSubSections order={order} row={r} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}


      <Section title="Customer cleaning days & times">
        <CustomerSchedulingSummary preferences={customer?.schedulingPreferences} />
        <p className="mt-4 text-xs text-muted-foreground/70">
          Read-only here. Edit these on the customer's “Cleaning Days &amp; Times” tab.
        </p>
      </Section>

      <WorkOrderNotesSection order={order} customer={customer} />

      <EditServiceDialog order={order} row={editRow} onClose={() => setEditRowId(null)} />
      <ChangeDateTimeDialog
        order={order}
        row={changeDateTimeRow}
        onClose={() => setChangeDateTimeRowId(null)}
      />
      <BookingPreviewDialog
        order={order}
        customer={customer}
        row={previewRow}
        onClose={() => setPreviewRowId(null)}
      />
      <EndServiceDialog
        order={order}
        row={endRow}
        onClose={() => setEndRowId(null)}
        onServiceEnded={(updatedOrder) => {
          hydrateWorkOrderFromRemote(updatedOrder);
          onServiceAdded(updatedOrder);
        }}
      />

      <AlertDialog
        open={archiveRow != null}
        onOpenChange={(open) => {
          if (!open) setArchiveRowId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveValidation?.allowed ? "Archive service?" : "Cannot archive service"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveRow ? archiveRow.serviceName : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {archiveValidation && !archiveValidation.allowed ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{archiveValidation.blockedMessage}</span>
            </div>
          ) : null}

          {archiveValidation?.allowed
            ? archiveValidation.warnings.map((w) => (
                <div
                  key={w}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{w}</span>
                </div>
              ))
            : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {archiveValidation?.allowed ? (
              <AlertDialogAction onClick={() => void confirmArchive()} disabled={workOrderMutations.isPending}>
                Archive anyway
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteRow != null}
        onOpenChange={(open) => {
          if (!open) setDeleteRowId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteValidation?.allowed ? "Delete service?" : "Cannot delete service"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteValidation?.allowed
                ? `Permanently remove “${deleteRow?.serviceName ?? ""}”. This cannot be undone.`
                : deleteRow?.serviceName ?? ""}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteValidation && !deleteValidation.allowed ? (
            <div className="grid gap-2">
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{deleteValidation.blockedMessage}</span>
              </div>
              <ul className="ml-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {deleteValidation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleteValidation?.allowed ? (
              <AlertDialogAction
                onClick={() => void confirmDelete()}
                disabled={workOrderMutations.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            ) : deleteRow ? (
              <>
                {canOfferForceDelete ? (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      const id = deleteRow.id;
                      setDeleteRowId(null);
                      setForceDeleteRowId(id);
                    }}
                  >
                    <TriangleAlert className="h-4 w-4" /> Force Delete Mistaken Service
                  </Button>
                ) : null}
                <AlertDialogAction
                  onClick={() => {
                    const id = deleteRow.id;
                    setDeleteRowId(null);
                    setArchiveRowId(id);
                  }}
                >
                  Archive instead
                </AlertDialogAction>
              </>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ForceDeleteServiceDialog
        row={forceDeleteRow}
        counts={forceDeleteCounts}
        validation={forceDeleteValidation}
        confirmValue={forceDeleteConfirm}
        onConfirmValueChange={setForceDeleteConfirm}
        onConfirm={confirmForceDelete}
        onClose={() => setForceDeleteRowId(null)}
      />
    </div>
  );
}

// ──────────────────────────────
// Force Delete (emergency cleanup of a mistaken service)
// ──────────────────────────────

/**
 * Destructive, typed-confirmation dialog for permanently removing a service row
 * created with the wrong start date. Visually distinct from the everyday delete:
 * a red warning panel, a warning icon, a Swedish explanation, and a Force Delete
 * button that stays disabled until the user types {@link FORCE_DELETE_CONFIRMATION_WORD}.
 */
function ForceDeleteServiceDialog({
  row,
  counts,
  validation,
  confirmValue,
  onConfirmValueChange,
  onConfirm,
  onClose,
}: {
  row: WorkOrderServiceRow | null;
  counts: { past: number; future: number; total: number } | null;
  validation: { allowed: boolean; blockedMessage?: string; reasons: string[] } | null;
  confirmValue: string;
  onConfirmValueChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const allowed = validation?.allowed === true;
  const confirmed = isForceDeleteConfirmed(confirmValue);
  const startDate = row?.serviceDate ? formatDate(row.serviceDate) : "—";
  const endIso = row ? (isRecurringRow(row) ? row.serviceEndDate : row.serviceDate) : null;
  const endDate = endIso ? formatDate(endIso) : "—";

  return (
    <AlertDialog open={row != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent className="border-destructive/40">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-5 w-5" /> Force Delete Mistaken Service
          </AlertDialogTitle>
          <AlertDialogDescription>{row?.serviceName ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>

        {!allowed ? (
          <div className="grid gap-2">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{validation?.blockedMessage}</span>
            </div>
            <ul className="ml-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {(validation?.reasons ?? []).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
              <DetailLine label="Start date" value={startDate} />
              <DetailLine label="End date" value={endDate} />
              <DetailLine label="Past generated occurrences" value={String(counts?.past ?? 0)} />
              <DetailLine label="Future generated occurrences" value={String(counts?.future ?? 0)} />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <p>Du håller på att permanent ta bort denna tjänst och dess genererade bokningar.</p>
              <p>Bokningar finns bakåt i tiden.</p>
              <p>Löne- och fakturaunderlag har ännu inte hämtats för dessa bokningar.</p>
              <p className="font-semibold">Denna åtgärd kan inte ångras.</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="force-delete-confirm">
                För att fortsätta, skriv: <span className="font-mono font-semibold">delete</span>
              </Label>
              <Input
                id="force-delete-confirm"
                autoComplete="off"
                value={confirmValue}
                onChange={(e) => onConfirmValueChange(e.target.value)}
                placeholder={FORCE_DELETE_CONFIRMATION_WORD}
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {allowed ? (
            <Button
              variant="destructive"
              disabled={!confirmed}
              onClick={onConfirm}
            >
              Force Delete
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A compact label/value pair used inside the force-delete summary grid. */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ──────────────────────────────
// Quick actions (date/time + employee assignment)
// ──────────────────────────────

/** Planned service date for a row, with the derived weekday below it. */
function PlannedDate({ row }: { row: WorkOrderServiceRow }) {
  const day = weekdayFromIso(row.serviceDate);
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-medium tabular-nums">
        {row.serviceDate ? formatDate(row.serviceDate) : "—"}
      </span>
      {day ? (
        <span className="text-xs text-muted-foreground">{WEEK_DAY_LABELS[day]}</span>
      ) : null}
    </span>
  );
}

/**
 * Planned time window and visit duration for a row, optionally prefixed with a
 * Preferred Time Evaluation status icon. The icon is only shown when the caller
 * passes an evaluation result (i.e. the add-on is available and enabled).
 */
function ServiceEndDateCell({
  row,
  disabled,
  onClick,
}: {
  row: WorkOrderServiceRow;
  disabled: boolean;
  onClick: () => void;
}) {
  const endDate = row.serviceEndDate?.trim();
  if (!isRecurringRow(row)) {
    const oneTimeEnd = endDate || row.serviceDate?.trim();
    return (
      <span className="text-muted-foreground tabular-nums">
        {oneTimeEnd ? formatDate(oneTimeEnd) : "—"}
      </span>
    );
  }
  if (row.archived) {
    return <span className="text-muted-foreground">{endDate ? formatDate(endDate) : "—"}</span>;
  }
  return (
    <Button
      type="button"
      variant={endDate ? "ghost" : "outline"}
      size="sm"
      className={cn(
        "h-7 min-w-7 px-2 text-xs tabular-nums",
        endDate ? "-mx-2 text-foreground" : "font-semibold",
      )}
      onClick={onClick}
      disabled={disabled}
      aria-label={endDate ? "Change end date" : "Add end date"}
      title={endDate ? "Change end date" : "Add end date"}
    >
      {endDate ? formatDate(endDate) : "+"}
    </Button>
  );
}

function PlannedTime({
  row,
  preferredTime,
}: {
  row: WorkOrderServiceRow;
  preferredTime?: PreferredTimeEvaluationResult | null;
}) {
  const icon = preferredTime ? (
    <PreferredTimeStatusIcon result={preferredTime} />
  ) : null;
  if (row.plannedStartTime && row.plannedEndTime) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {icon}
        <span className="min-w-0">
          <span className="tabular-nums">
            {row.plannedStartTime}–{row.plannedEndTime}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      <span className="text-muted-foreground">No planned time</span>
    </span>
  );
}

/** Planned visit duration (single time window) for a row. */
function VisitDuration({ row }: { row: WorkOrderServiceRow }) {
  const labour = calculatePlannedLabourMinutes(row);
  if (labour.visitMinutes == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="tabular-nums">{formatDuration(labour.visitMinutes)}</span>;
}

/** Total planned labour effort across all assigned staff for a row. */
function TotalTime({ row }: { row: WorkOrderServiceRow }) {
  const labour = calculatePlannedLabourMinutes(row);
  if (labour.labourMinutes == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="tabular-nums">{formatDuration(labour.labourMinutes)}</span>;
}

/** Recurrence interval label for a row, with a subtle treatment for one-time. */
function RecurrenceLabel({
  interval,
  endDate,
}: {
  interval?: RecurrenceInterval;
  endDate?: string | null;
}) {
  const value = interval ?? DEFAULT_RECURRENCE_INTERVAL;
  const label = RECURRENCE_INTERVAL_LABELS[value];
  if (value === "one_time") {
    return <span className="text-muted-foreground">{label}</span>;
  }
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="inline-flex items-center gap-1 font-medium">
        <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />
        {label}
      </span>
      {endDate ? (
        <span className="text-xs text-muted-foreground">Until {formatDate(endDate)}</span>
      ) : null}
    </span>
  );
}

function isValidServiceDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isValidTimeInput(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Changes date/time for one-time service rows only. Recurring rows stay locked
 * until occurrence/series-change logic is designed. The dialog closes only after
 * the update RPC succeeds and a fresh Supabase read verifies parent + flat row.
 */
export function ChangeDateTimeDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { hasPermission } = useApp();
  const workOrderMutations = useWorkOrderMutations({
    companyId: order.companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const [serviceDate, setServiceDate] = useState<string>("");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (row) {
      setServiceDate(row.serviceDate ?? "");
      setStart(row.plannedStartTime ?? "");
      setEnd(row.plannedEndTime ?? "");
      setError("");
      setPending(false);
    }
  }, [row]);

  const busy = pending || workOrderMutations.isPending;
  const normalizedStart = start.trim();
  const normalizedEnd = end.trim();
  const duration = calculatePlannedDurationMinutes(normalizedStart, normalizedEnd);
  const timesInvalid = Boolean(normalizedStart) && Boolean(normalizedEnd) && duration == null;

  const save = async () => {
    if (!row || busy) return;
    setError("");

    const date = serviceDate.trim();
    if (!order.id.trim() || !order.companyId.trim()) {
      const message = "Changing date/time requires a selected company and work order context.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    if (isRecurringRow(row)) {
      const message = "Temporarily unavailable for recurring services.";
      setError(message);
      toast({ title: "Temporarily unavailable", description: message, variant: "destructive" });
      return;
    }
    if (!date) {
      const message = "Service date is required.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    if (!isValidServiceDate(date)) {
      const message = "Service date must use a valid YYYY-MM-DD date.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    if (normalizedStart && !isValidTimeInput(normalizedStart)) {
      const message = "Planned start time must use HH:MM format.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    if (normalizedEnd && !isValidTimeInput(normalizedEnd)) {
      const message = "Planned end time must use HH:MM format.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    if (timesInvalid) {
      const message = "Planned end time must be after planned start time.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }

    const patch: SupabaseWorkOrderServiceRowUpdatePatch = {
      serviceDate: date,
      plannedStartTime: normalizedStart || null,
      plannedEndTime: normalizedEnd || null,
    };

    setPending(true);
    try {
      await workOrderMutations.changeOneTimeServiceRowDateTime({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        recurrenceInterval: row.recurrenceInterval,
        serviceDate: date,
        plannedStartTime: normalizedStart || null,
        plannedEndTime: normalizedEnd || null,
      });
      await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        expectedPatch: patch,
      });
      toast({ title: "Date/time updated" });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save date/time.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={row != null} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change date/time</DialogTitle>
          <DialogDescription>
            Update the planned date and time for this one-time service row.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            This updates the service row date/time. Booking Lists sync is handled separately.
          </div>
          <Field label="Service date" hint="Required">
            <Input
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              aria-label="Service date"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Planned start" hint="Optional">
              <TimePicker value={start} onChange={setStart} aria-label="Planned start time" />
            </Field>
            <div className="grid grid-cols-2 items-end gap-2">
              <Field label="Planned end" hint="Optional">
                <TimePicker value={end} onChange={setEnd} aria-label="Planned end time" />
              </Field>
              <DurationSummaryBox minutes={duration} />
            </div>
          </div>
          {timesInvalid ? (
            <p className="text-xs text-destructive">Planned end time must be after planned start time.</p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save date/time"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Quick employee-assignment dialog for a work-order service row. A thin wrapper
 * around the shared {@link AssignEmployeesDialog} so the Work Order uses the
 * exact same open-slot handling, customer-history suggestions and staffing
 * validation as the Schedule board and Booking Queue. Staffing is written to
 * the service row, with activity + audit through `updateWorkOrderServiceRow`.
 */
function QuickAssignDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const target = useMemo<AssignDialogTarget | null>(() => {
    if (!row) return null;
    return {
      workOrderId: order.id,
      serviceRowId: row.id,
      companyId: order.companyId,
      customerId: order.customerId,
      serviceName: row.serviceName,
      workOrderNumber: order.number,
      assignedEmployeeIds: row.assignedEmployeeIds ?? [],
      openSlots: normalizeUnassignedSlots(row.unassignedEmployeeSlots),
    };
  }, [order, row]);

  return <AssignEmployeesDialog target={target} onClose={onClose} />;
}

/**
 * Ends a recurring service by persisting an inclusive `serviceEndDate` through
 * the same `updateWorkOrderServiceRow` path the Edit dialog uses. The service
 * row is never deleted and its history/occurrences up to and including the end
 * date are preserved — schedule occurrence generation simply stops past the
 * inclusive bound (see {@link serviceRowOccurrences}). Defaults to today.
 */
function EndServiceDialog({
  order,
  row,
  onClose,
  onServiceEnded,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
  onServiceEnded: (workOrder: WorkOrder) => void;
}) {
  const { toast } = useToast();
  const { hasPermission } = useApp();
  const workOrderMutations = useWorkOrderMutations({
    companyId: order.companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const [endDate, setEndDate] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (row) {
      const existing = row.serviceEndDate?.trim();
      setEndDate(existing ? existing : new Date().toISOString().slice(0, 10));
      setError("");
      setPending(false);
    }
  }, [row]);

  const minDate = row?.serviceDate?.trim() || undefined;
  const normalizedEndDate = endDate.trim();
  const endBeforeStart = Boolean(normalizedEndDate) && Boolean(minDate) && normalizedEndDate < (minDate ?? "");
  const busy = pending || workOrderMutations.isPending;

  const confirm = async () => {
    if (!row || busy) return;
    setError("");

    if (!order.id.trim() || !order.companyId.trim()) {
      const message = "Ending a service requires a selected company and work order context.";
      setError(message);
      toast({ title: "Unable to end service", description: message, variant: "destructive" });
      return;
    }
    if (!normalizedEndDate) {
      const message = "End date is required.";
      setError(message);
      toast({ title: "Unable to end service", description: message, variant: "destructive" });
      return;
    }
    if (!isValidServiceDate(normalizedEndDate)) {
      const message = "End date must use a valid YYYY-MM-DD date.";
      setError(message);
      toast({ title: "Unable to end service", description: message, variant: "destructive" });
      return;
    }
    if (endBeforeStart) {
      const message = "The end date must be on or after the service date.";
      setError(message);
      toast({ title: "Unable to end service", description: message, variant: "destructive" });
      return;
    }

    const patch: SupabaseWorkOrderServiceRowUpdatePatch = { serviceEndDate: normalizedEndDate };
    setPending(true);
    try {
      await workOrderMutations.updateServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        patch,
      });
      const verified = await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        expectedPatch: patch,
      });
      onServiceEnded(verified);
      toast({ title: "Service end date saved", description: `${row.serviceName} now ends on ${formatDate(normalizedEndDate)}.` });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to end service.";
      setError(message);
      toast({ title: "Unable to end service", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={row != null} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{row && isRecurringRow(row) ? "End recurring service" : "Set end date"}</DialogTitle>
          <DialogDescription>
            {row && isRecurringRow(row)
              ? `Stop future occurrences of ${row?.serviceName} on and after the chosen end date. The service stays on the work order as history — occurrences up to this date are kept.`
              : `Set the end date for ${row?.serviceName ?? "this service"}. The service stays on the work order as history and becomes eligible for archival once the end date has passed.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <CircleStop className="mt-0.5 h-4 w-4 shrink-0" />
            <span>The end date is inclusive — the Schedule will not show occurrences after it.</span>
          </div>
          <Field label="End date" hint="Inclusive · stops recurring after this date">
            <Input
              type="date"
              value={endDate}
              min={minDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="End date"
            />
            {endBeforeStart ? (
              <p className="mt-1 text-xs text-destructive">
                The end date must be on or after the service date.
              </p>
            ) : null}
          </Field>
        </div>
        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={endBeforeStart || busy}>
            {busy ? "Saving…" : "End service"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Clones a recurring service row into a new independent row. Copies the service
 * name, planned times, assigned employees, recurrence interval, VAT, price and
 * notes (plus catalog snapshot fields for fidelity), and requires the admin to
 * pick a new start date for the clone. The original row is never modified — the
 * clone gets a fresh id via {@link addWorkOrderServiceRow}.
 */
function CloneServiceDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { addWorkOrderServiceRow } = useApp();
  const [newDate, setNewDate] = useState<string>("");

  useEffect(() => {
    if (row) setNewDate(row.serviceDate ?? "");
  }, [row]);

  const clone = () => {
    if (!row) return;
    const startDate = newDate.trim();
    if (!startDate) {
      toast({
        title: "New start date required",
        description: "Pick the date the cloned service should start.",
        variant: "destructive",
      });
      return;
    }
    // A clone keeps the original end date only when it is still valid relative
    // to the new start date. If the old end date now falls before the new
    // service date, drop it so the clone starts open-ended rather than failing
    // validation ("end date must be on or after the service date").
    const clonedEndDate = resolveClonedEndDate(row.serviceEndDate, startDate);
    const res = addWorkOrderServiceRow(order.id, {
      sourceServiceId: row.sourceServiceId ?? null,
      serviceName: row.serviceName,
      articleNumber: row.articleNumber,
      categoryName: row.categoryName,
      serviceType: row.serviceType,
      quantity: row.quantity,
      unit: row.unit,
      price: row.price,
      vat: row.vat,
      status: row.status,
      notes: row.notes,
      serviceDate: startDate,
      serviceEndDate: clonedEndDate,
      plannedStartTime: row.plannedStartTime,
      plannedEndTime: row.plannedEndTime,
      assignedEmployeeIds: [...(row.assignedEmployeeIds ?? [])],
      unassignedEmployeeSlots: normalizeUnassignedSlots(row.unassignedEmployeeSlots),
      recurrenceInterval: row.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL,
    });
    if (!res.ok) {
      toast({ title: "Unable to clone", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Service cloned",
      description: `${row.serviceName} duplicated with a new start date.`,
    });
    onClose();
  };

  return (
    <Dialog open={row != null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clone service</DialogTitle>
          <DialogDescription>
            Create a copy of {row?.serviceName} with the same details and recurrence. Pick a new
            start date for the clone — the original service is left unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
            <div className="font-medium">{row?.serviceName}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>{RECURRENCE_INTERVAL_LABELS[row?.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL]}</span>
              {row?.plannedStartTime && row?.plannedEndTime ? (
                <span className="tabular-nums">
                  {row.plannedStartTime}–{row.plannedEndTime}
                </span>
              ) : null}
              {(row?.assignedEmployeeIds?.length ?? 0) > 0 ? (
                <span>
                  {row?.assignedEmployeeIds.length} employee
                  {row && row.assignedEmployeeIds.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </div>
          <Field label="New start date" hint="Required">
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={clone}>Clone service</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────
// Checkout → time report
// ──────────────────────────────

/**
 * Job checkout flow. An employee confirms the scheduled vs. actual time for a
 * service row; the deviation and approval status are computed from the company's
 * Time Reporting settings and a {@link TimeReport} is stored. After submitting,
 * the resulting status ("Auto Approved" or "Pending Admin Approval") is shown.
 */
function CheckoutDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { getTimeReportSettingsFor, submitTimeReportCheckout } = useApp();
  const [scheduled, setScheduled] = useState<string>("");
  const [actual, setActual] = useState<string>("");
  const [result, setResult] = useState<TimeReport | null>(null);

  useEffect(() => {
    if (row) {
      setScheduled("");
      setActual("");
      setResult(null);
    }
  }, [row]);

  const settings = getTimeReportSettingsFor(order.companyId);

  const scheduledNum = numOrUndefined(scheduled);
  const actualNum = numOrUndefined(actual);
  const canSubmit =
    scheduledNum != null && scheduledNum >= 0 && actualNum != null && actualNum >= 0;

  /** Live forecast of the outcome before the employee confirms. */
  const preview = useMemo(() => {
    if (!canSubmit || scheduledNum == null || actualNum == null) return null;
    const deviation = calculateTimeDeviationMinutes(scheduledNum, actualNum);
    const { autoApprovable } = resolveTimeReportApproval(settings, scheduledNum, actualNum);
    return { deviation, autoApprovable };
  }, [canSubmit, scheduledNum, actualNum, settings]);

  const confirm = () => {
    if (!row || scheduledNum == null || actualNum == null) return;
    const res = submitTimeReportCheckout({
      workOrderId: order.id,
      serviceRowId: row.id,
      jobName: row.serviceName,
      scheduledMinutes: scheduledNum,
      actualMinutes: actualNum,
    });
    if (!res.ok || !res.report) {
      toast({ title: "Checkout failed", description: res.error, variant: "destructive" });
      return;
    }
    setResult(res.report);
    toast({
      title:
        res.report.approvalStatus === "auto_approved"
          ? "Time report auto approved"
          : "Time report submitted for approval",
      description: `${TIME_REPORT_APPROVAL_STATUS_LABELS[res.report.approvalStatus]} · deviation ${res.report.deviationMinutes} min`,
    });
  };

  return (
    <Dialog open={row != null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Check out — {row?.serviceName}</DialogTitle>
          <DialogDescription>
            Confirm the scheduled and actual time for this job. The deviation and approval
            status are calculated automatically from your Time Reporting settings.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-background px-4 py-6 text-center">
              <TimeReportStatusBadge status={result.approvalStatus} />
              <p className="text-sm text-muted-foreground">
                {result.approvalStatus === "auto_approved"
                  ? `Approved automatically by ${result.approvedBy}.`
                  : "This report exceeds the tolerance and now awaits administrator approval."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <CheckoutStat label="Scheduled" value={`${result.scheduledMinutes} min`} />
              <CheckoutStat label="Actual" value={`${result.actualMinutes} min`} />
              <CheckoutStat label="Deviation" value={`${result.deviationMinutes} min`} />
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Scheduled time (minutes)">
                <Input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                  placeholder="180"
                />
              </Field>
              <Field label="Actual time (minutes)">
                <Input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  placeholder="184"
                />
              </Field>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
              <Timer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 text-muted-foreground">
                <p>
                  Tolerance {settings.deviationToleranceMinutes} min · automatic approval{" "}
                  {settings.autoApproveEnabled ? "on" : "off"}.
                </p>
                {preview ? (
                  <p className="mt-1">
                    Deviation{" "}
                    <span className="font-medium text-foreground">{preview.deviation} min</span> —{" "}
                    {preview.autoApprovable ? (
                      <span className="font-medium text-success">will auto approve</span>
                    ) : (
                      <span className="font-medium text-foreground">needs admin approval</span>
                    )}
                    .
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={!canSubmit}>
                Confirm &amp; check out
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CheckoutStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2 text-center">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ──────────────────────────────
// Time Reports tab
// ──────────────────────────────

function TimeReportsTab({ order }: { order: WorkOrder }) {
  const { getTimeReportsForWorkOrder } = useApp();
  // Dev-only render accounting for the time-report (check-out) surface.
  perf.count("TimeReportsTab.render");
  const reports = getTimeReportsForWorkOrder(order.id);

  if (reports.length === 0) {
    return (
      <Section title="Time reports">
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Clock className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium">No time reports yet.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            When an employee checks out of a job (Services tab → check-out action), the
            scheduled vs. actual time is recorded here with its approval status.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <div className="grid gap-3">
      {reports.map((r) => (
        <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{r.jobName}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3.5 w-3.5" /> {r.employeeName}
                </span>
                <span>· {formatDateTime(r.submittedAt)}</span>
              </div>
            </div>
            <TimeReportStatusBadge status={r.approvalStatus} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <CheckoutStat label="Scheduled" value={`${r.scheduledMinutes} min`} />
            <CheckoutStat label="Actual" value={`${r.actualMinutes} min`} />
            <CheckoutStat label="Deviation" value={`${r.deviationMinutes} min`} />
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {r.approvedBy && r.approvedAt
              ? `Approved by ${r.approvedBy} · ${formatDateTime(r.approvedAt)}`
              : "Awaiting administrator approval."}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Add service dialog (search + detail) ──

export function AddServiceDialog({
  order,
  open,
  onOpenChange,
  onServiceAdded,
}: {
  order: WorkOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServiceAdded?: (workOrder: WorkOrder) => void;
}) {
  const { toast } = useToast();
  const {
    getServicesForCompany,
    getServiceCategoriesForCompany,
    getCompanyServiceFavorites,
    isServiceFavorite,
    toggleServiceFavorite,
    customers,
    hasPermission,
    hydrateWorkOrderFromRemote,
  } = useApp();
  const workOrderMutations = useWorkOrderMutations({
    companyId: order.companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const previewPreferences = useMemo(
    () => customers.find((c) => c.id === order.customerId)?.schedulingPreferences ?? null,
    [customers, order.customerId],
  );

  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState<Service | null>(null);
  const [draft, setDraft] = useState<RowDraft>(emptyDraft());
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(null);
      setDraft(emptyDraft());
      setError("");
      setPending(false);
    }
  }, [open]);

  const categories = useMemo(
    () => getServiceCategoriesForCompany(order.companyId),
    [getServiceCategoriesForCompany, order.companyId],
  );
  const categoryName = (id: string | null): string =>
    categories.find((c) => c.id === id)?.name ?? "";

  const allServices = useMemo(
    () => getServicesForCompany(order.companyId),
    [getServicesForCompany, order.companyId],
  );

  const favorites = useMemo(
    () => getCompanyServiceFavorites(order.companyId),
    [getCompanyServiceFavorites, order.companyId],
  );

  const toggleFav = (e: React.MouseEvent, serviceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const res = toggleServiceFavorite(order.companyId, serviceId);
    if (!res.ok) {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
    }
  };

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (trimmed.length < 3) return [];
    return allServices.filter((s) => {
      const cat = categoryName(s.categoryId).toLowerCase();
      return (
        s.name.toLowerCase().includes(trimmed) ||
        (s.articleNumber ?? "").toLowerCase().includes(trimmed) ||
        cat.includes(trimmed) ||
        (s.serviceType ?? "").toLowerCase().includes(trimmed)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allServices, trimmed]);

  const pick = (s: Service) => {
    setSelected(s);
    setError("");
    setDraft({
      serviceName: s.name,
      articleNumber: s.articleNumber ?? "",
      categoryName: categoryName(s.categoryId),
      serviceType: s.serviceType ?? "",
      quantity: "1",
      unit: s.unit ?? "",
      price: s.price != null ? String(s.price) : "",
      vat: s.vat != null ? String(s.vat) : "",
      status: "planned",
      notes: "",
      serviceDate: "",
      serviceEndDate: "",
      plannedStartTime: "",
      plannedEndTime: "",
      assignedEmployeeIds: [],
      openSlots: "",
      recurrenceInterval: DEFAULT_RECURRENCE_INTERVAL,
    });
  };

  const save = async () => {
    if (pending || workOrderMutations.isPending) return;
    setError("");
    if (!order.id.trim()) {
      const message = "Service row add requires a work order id.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
      return;
    }
    if (!order.companyId.trim()) {
      const message = "Service row add requires a selected company context.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
      return;
    }
    if (!selected?.id?.trim()) {
      const message = "Select a service before saving.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
      return;
    }
    if (!draft.serviceDate.trim()) {
      const message = "Pick the date the work should happen before saving.";
      setError(message);
      toast({
        title: "Service date required",
        description: message,
        variant: "destructive",
      });
      return;
    }
    // Same staffing rule as every assignment surface: a row must never be created
    // requiring nobody. When no employee and no open slot is set, default to one
    // open slot so the booking surfaces as an open staffing need.
    const staffing = resolveCreateStaffing({
      assignedEmployeeIds: draft.assignedEmployeeIds,
      openSlots: Math.max(0, Number.parseInt(draft.openSlots, 10) || 0),
    });
    setPending(true);
    try {
      const result = await workOrderMutations.addServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        sourceServiceId: selected.id,
        serviceName: draft.serviceName,
        articleNumber: draft.articleNumber || undefined,
        categoryName: draft.categoryName || undefined,
        serviceType: draft.serviceType || undefined,
        quantity: numOrUndefined(draft.quantity) ?? 1,
        unit: draft.unit || undefined,
        price: numOrUndefined(draft.price),
        vat: numOrUndefined(draft.vat),
        status: draft.status,
        notes: draft.notes || undefined,
        serviceDate: draft.serviceDate,
        serviceEndDate: draft.serviceEndDate || null,
        plannedStartTime: draft.plannedStartTime || undefined,
        plannedEndTime: draft.plannedEndTime || undefined,
        assignedEmployeeIds: staffing.assignedEmployeeIds,
        unassignedEmployeeSlots: staffing.openSlots,
        recurrenceInterval: draft.recurrenceInterval,
      });
      await verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: result.serviceRow.id,
      });
      hydrateWorkOrderFromRemote(result.workOrder);
      onServiceAdded?.(result.workOrder);
      toast({
        title: "Service added",
        description: staffing.corrected
          ? "No employee was selected, so 1 open staffing slot was added."
          : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add service.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  const busy = pending || workOrderMutations.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!busy) onOpenChange(next);
    }}>
      <DialogContent className={selected ? "max-w-2xl" : "max-w-xl"}>
        <DialogHeader>
          <DialogTitle>Add service</DialogTitle>
          <DialogDescription>
            {selected
              ? "Adjust the details for this service row. Values are copied into the work order."
              : "Search the service catalog and select a service to add."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-5">
            {/* Company Favorites */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company Favorites</h3>
              <FavoritesSection
                favorites={favorites}
                categoryName={categoryName}
                onPick={pick}
                onToggleFav={toggleFav}
              />
            </div>

            {/* Search */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</h3>
              <div className="rounded-xl border border-border">
                <Command shouldFilter={false}>
                  <CommandInput
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Search by name, article no., category or type…"
                  />
                  <CommandList>
                    {trimmed.length < 3 ? (
                      <CommandEmpty>
                        <span className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Search className="h-4 w-4" /> Type at least 3 characters to search.
                        </span>
                      </CommandEmpty>
                    ) : results.length === 0 ? (
                      <CommandEmpty>No services found.</CommandEmpty>
                    ) : (
                      <CommandGroup heading={`${results.length} match${results.length === 1 ? "" : "es"}`}>
                        {results.map((s) => (
                          <CommandItem key={s.id} value={s.id} onSelect={() => pick(s)} className="gap-2">
                            <FavoriteStar
                              active={isServiceFavorite(order.companyId, s.id)}
                              onClick={(e) => toggleFav(e, s.id)}
                            />
                            <span className="flex min-w-0 flex-col items-start gap-0.5">
                              <span className="font-medium">{s.name}</span>
                              <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                                {s.articleNumber ? <span className="tabular-nums">#{s.articleNumber}</span> : null}
                                {categoryName(s.categoryId) ? <span>{categoryName(s.categoryId)}</span> : null}
                                {s.serviceType ? <span>{s.serviceType}</span> : null}
                                {s.price != null ? <span>{formatCurrency(s.price)}</span> : null}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </div>
            </div>

            {/* Browse by category */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Browse by category</h3>
              <CategoryBrowser
                categories={categories}
                services={allServices}
                onPick={pick}
                isFavorite={(id) => isServiceFavorite(order.companyId, id)}
                onToggleFav={toggleFav}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div>
                <div className="text-sm font-medium">{selected.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[draft.articleNumber && `#${draft.articleNumber}`, draft.categoryName, draft.serviceType]
                    .filter(Boolean)
                    .join(" · ") || "From service catalog"}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={busy}>
                Change
              </Button>
            </div>
            {error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <RowDraftFields
              draft={draft}
              setDraft={setDraft}
              companyId={order.companyId}
              compact
              includeOpenSlots
              showSummary
              showNotes={false}
              previewPreferences={previewPreferences}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Adding…" : "Add service"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Inline Add Service panel ──

/**
 * Per-service-row collapsible sub-sections for Images and Cleaning Protocol.
 * Both are collapsed by default so the list stays compact; expanding one reveals
 * that row's media or protocol surface. Protocol mutations stay disabled here —
 * the panel is read-only/preview until the protocol write slice lands.
 */
function ServiceRowSubSections({
  order,
  row,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow;
}) {
  const [openImages, setOpenImages] = useState<boolean>(false);
  const [openProtocol, setOpenProtocol] = useState<boolean>(false);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Collapsible open={openProtocol} onOpenChange={setOpenProtocol} className="min-w-0">
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60">
          <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${openProtocol ? "rotate-90" : ""}`} />
          <ClipboardList className="h-4 w-4 shrink-0" />
          Protocol
        </CollapsibleTrigger>
        <CollapsibleContent className="px-1 pt-2">
          <ServiceProtocolLink
            companyId={order.companyId}
            customerId={order.customerId}
            workOrderId={order.id}
            serviceRow={row}
            mutationsDisabled
          />
        </CollapsibleContent>
      </Collapsible>
      <Collapsible open={openImages} onOpenChange={setOpenImages} className="min-w-0">
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60">
          <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${openImages ? "rotate-90" : ""}`} />
          <ImageIcon className="h-4 w-4 shrink-0" />
          Images
        </CollapsibleTrigger>
        <CollapsibleContent className="px-1 pt-2">
          <ServiceRowImages order={order} serviceRowId={row.id} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Inline "Add service" panel rendered directly above the service-row list (no
 * modal). The admin selects a service from the catalog, then fills a full-width,
 * three-column entry form (Date & time · Employees · Unit & price) plus a
 * collapsed Summary / Preview. Save reuses the exact same Supabase-authoritative
 * Add Service Row RPC + fresh read verification as the dialog: the panel stays
 * open on failure and closes only after the row is confirmed readable.
 */
export function InlineAddServicePanel({
  order,
  onClose,
  onServiceAdded,
}: {
  order: WorkOrder;
  onClose: () => void;
  onServiceAdded?: (workOrder: WorkOrder) => void;
}) {
  const { toast } = useToast();
  const {
    getServicesForCompany,
    getServiceCategoriesForCompany,
    getCompanyServiceFavorites,
    isServiceFavorite,
    toggleServiceFavorite,
    customers,
    employees,
    getDurationSettingsFor,
    hasPermission,
    hydrateWorkOrderFromRemote,
  } = useApp();
  const workOrderMutations = useWorkOrderMutations({
    companyId: order.companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const previewPreferences = useMemo(
    () => customers.find((c) => c.id === order.customerId)?.schedulingPreferences ?? null,
    [customers, order.customerId],
  );

  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState<Service | null>(null);
  const [draft, setDraft] = useState<RowDraft>(emptyDraft());
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showSummary, setShowSummary] = useState<boolean>(false);

  const categories = useMemo(
    () => getServiceCategoriesForCompany(order.companyId),
    [getServiceCategoriesForCompany, order.companyId],
  );
  const categoryName = (id: string | null): string =>
    categories.find((c) => c.id === id)?.name ?? "";
  const allServices = useMemo(
    () => getServicesForCompany(order.companyId),
    [getServicesForCompany, order.companyId],
  );
  const favorites = useMemo(
    () => getCompanyServiceFavorites(order.companyId),
    [getCompanyServiceFavorites, order.companyId],
  );
  const companyEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.companyId === order.companyId && e.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees, order.companyId],
  );
  const durationPresets = getDurationSettingsFor(order.companyId).presetMinutes;

  const toggleFav = (e: React.MouseEvent, serviceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const res = toggleServiceFavorite(order.companyId, serviceId);
    if (!res.ok) {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
    }
  };

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (trimmed.length < 3) return [];
    return allServices.filter((s) => {
      const cat = categoryName(s.categoryId).toLowerCase();
      return (
        s.name.toLowerCase().includes(trimmed) ||
        (s.articleNumber ?? "").toLowerCase().includes(trimmed) ||
        cat.includes(trimmed) ||
        (s.serviceType ?? "").toLowerCase().includes(trimmed)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allServices, trimmed]);

  const pick = (s: Service) => {
    setSelected(s);
    setError("");
    setDraft({
      serviceName: s.name,
      articleNumber: s.articleNumber ?? "",
      categoryName: categoryName(s.categoryId),
      serviceType: s.serviceType ?? "",
      quantity: "1",
      unit: s.unit ?? "",
      price: s.price != null ? String(s.price) : "",
      vat: s.vat != null ? String(s.vat) : "",
      status: "planned",
      notes: "",
      serviceDate: "",
      serviceEndDate: "",
      plannedStartTime: "",
      plannedEndTime: "",
      assignedEmployeeIds: [],
      openSlots: "",
      recurrenceInterval: DEFAULT_RECURRENCE_INTERVAL,
      quickDurationMinutes: null,
    });
  };

  const activeQuickDuration = draft.quickDurationMinutes ?? null;

  /**
   * Sets Planned start. When a quick duration is active, the Planned end is
   * recalculated as start + duration so the chosen duration is preserved
   * (e.g. 08:00 + 2 h → 10:00, then start 09:00 → end 11:00).
   */
  const setStartTime = (value: string) => {
    setDraft((prev) => {
      const next = { ...prev, plannedStartTime: value };
      if (prev.quickDurationMinutes != null && value.trim()) {
        const end = addMinutesToTime(value, prev.quickDurationMinutes);
        if (end) next.plannedEndTime = end;
      }
      return next;
    });
  };

  /** Applies a quick duration: sets Planned end and remembers the minutes. */
  const applyQuickDuration = (end: string, minutes: number) => {
    setDraft((prev) => ({ ...prev, plannedEndTime: end, quickDurationMinutes: minutes }));
  };

  /**
   * Manual Planned end edit. Clears the active quick duration so the UI no
   * longer implies a quick duration is active; duration then reflects the
   * manually entered window.
   */
  const setEndTimeManual = (value: string) => {
    setDraft((prev) => ({ ...prev, plannedEndTime: value, quickDurationMinutes: null }));
  };

  const busy = pending || workOrderMutations.isPending;
  const openSlotsNum = Math.max(0, Number.parseInt(draft.openSlots, 10) || 0);
  const setOpenSlots = (n: number) => setDraft({ ...draft, openSlots: String(Math.max(0, n)) });
  const duration = calculatePlannedDurationMinutes(draft.plannedStartTime, draft.plannedEndTime);
  const labour = calculatePlannedLabourMinutes({
    plannedStartTime: draft.plannedStartTime,
    plannedEndTime: draft.plannedEndTime,
    assignedEmployeeIds: draft.assignedEmployeeIds,
    unassignedEmployeeSlots: openSlotsNum,
  });
  const qtyNum = numOrUndefined(draft.quantity) ?? 0;
  const priceNum = numOrUndefined(draft.price);
  const vatNum = numOrUndefined(draft.vat);
  const netTotal = priceNum != null ? qtyNum * priceNum : null;
  const grossTotal = netTotal != null && vatNum != null ? netTotal * (1 + vatNum / 100) : null;

  const missing: string[] = [];
  if (!draft.serviceDate.trim()) missing.push("Service date");
  if (duration == null && draft.plannedStartTime && draft.plannedEndTime) {
    missing.push("Valid time window");
  }
  const summaryStatus = missing.length > 0 ? `${missing.length} to complete` : "Ready to save";

  // ── Summary / Preview labels (display-only, no raw minutes) ──
  const durationCompact = formatDurationCompact(duration);
  const timeSummary =
    draft.plannedStartTime && draft.plannedEndTime && durationCompact
      ? `${draft.plannedStartTime}\u2013${draft.plannedEndTime} (${durationCompact})`
      : draft.plannedStartTime && draft.plannedEndTime
        ? `${draft.plannedStartTime}\u2013${draft.plannedEndTime}`
        : "Not set";
  const totalCleaningTime = formatDurationCompact(labour.visitMinutes) ?? "\u2014";
  const assignedNames = draft.assignedEmployeeIds
    .map((id) => companyEmployees.find((e) => e.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  const employeeSummary =
    assignedNames.length === 1
      ? assignedNames[0]
      : assignedNames.length > 1
        ? `${assignedNames.length} employees${openSlotsNum > 0 ? ` + ${openSlotsNum} open` : ""}`
        : openSlotsNum > 0
          ? `${openSlotsNum} open slot${openSlotsNum === 1 ? "" : "s"}`
          : "Not assigned";

  const toggleEmployee = (id: string) => {
    const next = draft.assignedEmployeeIds.includes(id)
      ? draft.assignedEmployeeIds.filter((e) => e !== id)
      : [...draft.assignedEmployeeIds, id];
    setDraft({ ...draft, assignedEmployeeIds: next });
  };

  const save = async () => {
    if (busy) return;
    setError("");
    if (!order.id.trim()) {
      const message = "Service row add requires a work order id.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
      return;
    }
    if (!order.companyId.trim()) {
      const message = "Service row add requires a selected company context.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
      return;
    }
    if (!selected?.id?.trim()) {
      const message = "Select a service before saving.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
      return;
    }
    if (!draft.serviceDate.trim()) {
      const message = "Pick the date the work should happen before saving.";
      setError(message);
      toast({ title: "Service date required", description: message, variant: "destructive" });
      return;
    }
    const staffing = resolveCreateStaffing({
      assignedEmployeeIds: draft.assignedEmployeeIds,
      openSlots: openSlotsNum,
    });
    setPending(true);
    try {
      const result = await workOrderMutations.addServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        sourceServiceId: selected.id,
        serviceName: draft.serviceName,
        articleNumber: draft.articleNumber || undefined,
        categoryName: draft.categoryName || undefined,
        serviceType: draft.serviceType || undefined,
        quantity: numOrUndefined(draft.quantity) ?? 1,
        unit: draft.unit || undefined,
        price: numOrUndefined(draft.price),
        vat: numOrUndefined(draft.vat),
        status: draft.status,
        notes: draft.notes || undefined,
        serviceDate: draft.serviceDate,
        serviceEndDate: draft.serviceEndDate || null,
        plannedStartTime: draft.plannedStartTime || undefined,
        plannedEndTime: draft.plannedEndTime || undefined,
        assignedEmployeeIds: staffing.assignedEmployeeIds,
        unassignedEmployeeSlots: staffing.openSlots,
        recurrenceInterval: draft.recurrenceInterval,
      });
      await verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: result.serviceRow.id,
      });
      hydrateWorkOrderFromRemote(result.workOrder);
      onServiceAdded?.(result.workOrder);
      toast({
        title: "Service added",
        description: staffing.corrected
          ? "No employee was selected, so 1 open staffing slot was added."
          : undefined,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add service.";
      setError(message);
      toast({ title: "Unable to add service", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-primary/[0.04] p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-lg tracking-tight">Add service</h3>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} disabled={busy} aria-label="Close add service">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!selected ? (
        <div className="space-y-5">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company Favorites</h4>
            <FavoritesSection
              favorites={favorites}
              categoryName={categoryName}
              onPick={pick}
              onToggleFav={toggleFav}
            />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</h4>
            <div className="rounded-xl border border-border bg-card">
              <Command shouldFilter={false}>
                <CommandInput
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search by name, article no., category or type…"
                />
                <CommandList>
                  {trimmed.length < 3 ? (
                    <CommandEmpty>
                      <span className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Search className="h-4 w-4" /> Type at least 3 characters to search.
                      </span>
                    </CommandEmpty>
                  ) : results.length === 0 ? (
                    <CommandEmpty>No services found.</CommandEmpty>
                  ) : (
                    <CommandGroup heading={`${results.length} match${results.length === 1 ? "" : "es"}`}>
                      {results.map((s) => (
                        <CommandItem key={s.id} value={s.id} onSelect={() => pick(s)} className="gap-2">
                          <FavoriteStar
                            active={isServiceFavorite(order.companyId, s.id)}
                            onClick={(e) => toggleFav(e, s.id)}
                          />
                          <span className="flex min-w-0 flex-col items-start gap-0.5">
                            <span className="font-medium">{s.name}</span>
                            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              {s.articleNumber ? <span className="tabular-nums">#{s.articleNumber}</span> : null}
                              {categoryName(s.categoryId) ? <span>{categoryName(s.categoryId)}</span> : null}
                              {s.serviceType ? <span>{s.serviceType}</span> : null}
                              {s.price != null ? <span>{formatCurrency(s.price)}</span> : null}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Browse by category</h4>
            <CategoryBrowser
              categories={categories}
              services={allServices}
              onPick={pick}
              isFavorite={(id) => isServiceFavorite(order.companyId, id)}
              onToggleFav={toggleFav}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <div>
              <div className="text-sm font-medium">{selected.name}</div>
              <div className="text-xs text-muted-foreground">
                {[draft.articleNumber && `#${draft.articleNumber}`, draft.categoryName, draft.serviceType]
                  .filter(Boolean)
                  .join(" · ") || "From service catalog"}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={busy}>
              Change
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Column 1 — Date & time */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date &amp; time</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Service date" hint="Required">
                  <Input
                    type="date"
                    value={draft.serviceDate}
                    onChange={(e) => setDraft({ ...draft, serviceDate: e.target.value })}
                    aria-label="Service date"
                  />
                </Field>
                <Field label="Recurrence" hint="Calculated from the service date">
                  <Select
                    value={draft.recurrenceInterval}
                    onValueChange={(v) => setDraft({ ...draft, recurrenceInterval: v as RecurrenceInterval })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_INTERVALS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <QuickStartTimePicker onSelect={setStartTime} />
              <QuickDurationHelper
                startTime={draft.plannedStartTime}
                onApply={applyQuickDuration}
                activeMinutes={activeQuickDuration}
                presetMinutes={durationPresets}
              />
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Planned start" hint="Optional">
                  <TimePicker
                    value={draft.plannedStartTime}
                    onChange={setStartTime}
                    aria-label="Planned start time"
                  />
                </Field>
                <Field label="Planned end" hint="Optional">
                  <TimePicker
                    value={draft.plannedEndTime}
                    onChange={setEndTimeManual}
                    aria-label="Planned end time"
                  />
                </Field>
                <DurationSummaryBox minutes={duration} />
              </div>
              {duration == null && draft.plannedStartTime && draft.plannedEndTime ? (
                <p className="text-xs text-destructive">End time must be after start time.</p>
              ) : null}
              {draft.recurrenceInterval !== "one_time" ? (
                <Field label="End date" hint="Optional · stops recurring after this date">
                  <Input
                    type="date"
                    value={draft.serviceEndDate}
                    min={draft.serviceDate || undefined}
                    onChange={(e) => setDraft({ ...draft, serviceEndDate: e.target.value })}
                  />
                </Field>
              ) : null}
            </div>

            {/* Column 2 — Employees */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employees</h4>
              <EmployeeMultiSelect
                employees={companyEmployees}
                selectedIds={draft.assignedEmployeeIds}
                onToggle={toggleEmployee}
              />
              <Field label="Open (unassigned) slots" hint="Planned headcount still to assign">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setOpenSlots(openSlotsNum - 1)}
                    disabled={openSlotsNum <= 0}
                    aria-label="Remove open slot"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className="w-20 text-center tabular-nums"
                    value={draft.openSlots}
                    placeholder="0"
                    onChange={(e) => setDraft({ ...draft, openSlots: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setOpenSlots(openSlotsNum + 1)}
                    aria-label="Add open slot"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </Field>
              <ServiceFitStatusPreview
                customerPreferences={previewPreferences}
                serviceDate={draft.serviceDate}
                plannedStartTime={draft.plannedStartTime}
                plannedEndTime={draft.plannedEndTime}
                hasSelectedEmployees={draft.assignedEmployeeIds.length > 0}
              />
            </div>

            {/* Column 3 — Unit & price */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unit &amp; price</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity">
                  <Input
                    type="number"
                    min="0"
                    value={draft.quantity}
                    onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                  />
                </Field>
                <Field label="Unit" hint="e.g. hour, m²">
                  <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
                </Field>
                <Field label="Price">
                  <Input
                    type="number"
                    min="0"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </Field>
                <Field label="VAT %">
                  <Input
                    type="number"
                    min="0"
                    value={draft.vat}
                    onChange={(e) => setDraft({ ...draft, vat: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Status">
                <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as WorkOrderServiceStatus })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_ORDER_SERVICE_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total (excl. VAT)</span>
                  <span className="font-medium tabular-nums">{netTotal != null ? formatCurrency(netTotal) : "—"}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total (incl. VAT)</span>
                  <span className="font-medium tabular-nums">{grossTotal != null ? formatCurrency(grossTotal) : "—"}</span>
                </div>
              </div>
            </div>
          </div>

          <Collapsible open={showSummary} onOpenChange={setShowSummary}>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
              <span className="flex items-center gap-2">
                <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showSummary ? "rotate-90" : ""}`} />
                Summary / Preview
              </span>
              <span className={`text-xs ${missing.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {summaryStatus}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                {/* Main booking summary */}
                <dl className="space-y-1.5">
                  <PreviewLine label="Service" value={selected.name} />
                  <PreviewLine label="Time" value={timeSummary} />
                  <PreviewLine label="Total cleaning time" value={totalCleaningTime} />
                  <PreviewLine label="Employee" value={employeeSummary} />
                </dl>
                <div className="h-px bg-border" />
                {/* Details */}
                <dl className="space-y-1.5">
                  <PreviewLine label="Date" value={draft.serviceDate ? formatDate(draft.serviceDate) : "—"} />
                  <PreviewLine label="Recurrence" value={RECURRENCE_INTERVAL_LABELS[draft.recurrenceInterval]} />
                  <PreviewLine label="Quantity" value={`${draft.quantity || "0"} ${draft.unit}`.trim()} />
                  <PreviewLine label="Price (excl. VAT)" value={netTotal != null ? formatCurrency(netTotal) : "—"} />
                </dl>
              </div>
              {missing.length > 0 ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="h-3.5 w-3.5" /> Missing: {missing.join(", ")}.
                </p>
              ) : null}
            </CollapsibleContent>
          </Collapsible>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Adding…" : "Add service"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact label/value line used in the inline panel's Summary / Preview. */
function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// ── Status preview (read-only scaffolding) ──

/** Lightweight fit status used by the inline panel's Status preview. */
type ServiceFitStatus = "optimal" | "acceptable" | "outside" | "unknown";

/**
 * Maps the customer's stored scheduling preferences against the draft date/time
 * into a coarse fit status. Display-only scaffolding for future scheduling/AI:
 * it never blocks saving and never mutates anything. Falls back to "unknown"
 * ("Not enough data") whenever the date/time or preferences are missing.
 */
function evaluateCustomerFitStatus(
  prefs: CustomerSchedulingPreferences | null,
  occ: { serviceDate: string; plannedStartTime: string; plannedEndTime: string },
): ServiceFitStatus {
  if (!occ.serviceDate.trim()) return "unknown";
  const result = evaluatePreferredTimeStatus(
    preferredTimeInputFromPreferences(prefs, {
      scheduledDate: occ.serviceDate || null,
      plannedStartTime: occ.plannedStartTime || null,
      plannedEndTime: occ.plannedEndTime || null,
    }),
  );
  switch (result.status) {
    case "optimal":
      return "optimal";
    case "acceptable":
      return "acceptable";
    case "outside_range":
      return "outside";
    default:
      return "unknown";
  }
}

const SERVICE_FIT_META: Record<
  ServiceFitStatus,
  { label: string; className: string; Icon: typeof Check }
> = {
  optimal: {
    label: "Optimal",
    className: "text-emerald-600 dark:text-emerald-400",
    Icon: Check,
  },
  acceptable: {
    label: "Acceptable",
    className: "text-amber-600 dark:text-amber-400",
    Icon: Check,
  },
  outside: {
    label: "Outside preference",
    className: "text-destructive",
    Icon: TriangleAlert,
  },
  unknown: {
    label: "Not enough data",
    className: "text-muted-foreground",
    Icon: CircleAlert,
  },
};

/** A single labelled fit row (e.g. "Day" → status badge). */
function ServiceFitRow({ label, status }: { label: string; status: ServiceFitStatus }) {
  const meta = SERVICE_FIT_META[status];
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.className}`}>
        <meta.Icon className="h-3.5 w-3.5" />
        {meta.label}
      </span>
    </div>
  );
}

/**
 * Read-only Status preview shown under the Employees column of the inline Add
 * Service panel. Reserves space for future customer/employee scheduling fit and
 * surfaces a coarse, non-blocking signal today. Customer fit reuses the existing
 * preferred-time evaluator; employee fit is a clearly-labelled placeholder until
 * employee availability data exists. Never blocks save and never mutates.
 */
function ServiceFitStatusPreview({
  customerPreferences,
  serviceDate,
  plannedStartTime,
  plannedEndTime,
  hasSelectedEmployees,
}: {
  customerPreferences: CustomerSchedulingPreferences | null;
  serviceDate: string;
  plannedStartTime: string;
  plannedEndTime: string;
  hasSelectedEmployees: boolean;
}) {
  const customerFit = evaluateCustomerFitStatus(customerPreferences, {
    serviceDate,
    plannedStartTime,
    plannedEndTime,
  });
  // No employee availability model yet — always a clearly-labelled placeholder.
  const employeeFit: ServiceFitStatus = "unknown";
  void hasSelectedEmployees;

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/30 p-3" aria-label="Status">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</h5>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">Customer fit</p>
        <ServiceFitRow label="Day" status={customerFit} />
        <ServiceFitRow label="Time" status={customerFit} />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">Employee fit</p>
        <ServiceFitRow label="Day" status={employeeFit} />
        <ServiceFitRow label="Time" status={employeeFit} />
      </div>
    </div>
  );
}

// ── Browse by category ──

/**
 * Collapsible browser of active service categories. Each category is collapsed
 * by default; expanding it reveals the active services inside, and one click
 * adds the chosen service to the work order.
 */
function CategoryBrowser({
  categories,
  services,
  onPick,
  isFavorite,
  onToggleFav,
}: {
  categories: ServiceCategory[];
  services: Service[];
  onPick: (s: Service) => void;
  isFavorite: (serviceId: string) => boolean;
  onToggleFav: (e: React.MouseEvent, serviceId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const activeCategories = useMemo(
    () =>
      [...categories]
        .filter((c) => c.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories],
  );

  const servicesByCategory = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of services) {
      if (s.status !== "active" || !s.categoryId) continue;
      const list = map.get(s.categoryId) ?? [];
      list.push(s);
      map.set(s.categoryId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [services]);

  if (activeCategories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
        No active service categories.
      </div>
    );
  }

  return (
    <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-border p-1.5">
      {activeCategories.map((cat) => {
        const catServices = servicesByCategory.get(cat.id) ?? [];
        const isOpen = openId === cat.id;
        return (
          <Collapsible
            key={cat.id}
            open={isOpen}
            onOpenChange={(o) => setOpenId(o ? cat.id : null)}
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
              <span className="flex items-center gap-2">
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                {cat.name}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {catServices.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {catServices.length === 0 ? (
                <p className="px-9 py-2 text-xs text-muted-foreground">No active services in this category.</p>
              ) : (
                <ul className="pb-1">
                  {catServices.map((s) => (
                    <li key={s.id} className="flex items-center gap-1 rounded-lg pl-9 pr-2 hover:bg-muted/60">
                      <FavoriteStar active={isFavorite(s.id)} onClick={(e) => onToggleFav(e, s.id)} />
                      <button
                        type="button"
                        onClick={() => onPick(s)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5 text-left"
                      >
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          {s.articleNumber ? <span className="tabular-nums">#{s.articleNumber}</span> : null}
                          {s.serviceType ? <span>{s.serviceType}</span> : null}
                          {s.price != null ? <span>{formatCurrency(s.price)}</span> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ── Company favorites ──

/**
 * A toggle star marking a service as a company favorite. Stops propagation so
 * tapping the star never triggers the surrounding row's add action.
 */
function FavoriteStar({
  active,
  onClick,
}: {
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? "Remove from company favorites" : "Add to company favorites"}
      aria-pressed={active}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted ${
        active ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground"
      }`}
    >
      <Star className="h-4 w-4" fill={active ? "currentColor" : "none"} />
    </button>
  );
}

/**
 * Quick-select list of the company's favorite services. One click adds the
 * favorite to the work order; the star removes it from favorites.
 */
function FavoritesSection({
  favorites,
  categoryName,
  onPick,
  onToggleFav,
}: {
  favorites: Service[];
  categoryName: (id: string | null) => string;
  onPick: (s: Service) => void;
  onToggleFav: (e: React.MouseEvent, serviceId: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(false);

  if (favorites.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
        No company favorites yet. Tap the star on any service to add it here.
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
        <span className="flex items-center gap-2">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          <Star className="h-4 w-4 shrink-0 text-amber-500" fill="currentColor" />
          Favorites
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {favorites.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 space-y-1 rounded-xl border border-border p-1.5">
          {favorites.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded-lg px-2 hover:bg-muted/60">
              <FavoriteStar active onClick={(e) => onToggleFav(e, s.id)} />
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5 text-left"
              >
                <span className="text-sm font-medium">{s.name}</span>
                <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  {s.articleNumber ? <span className="tabular-nums">#{s.articleNumber}</span> : null}
                  {categoryName(s.categoryId) ? <span>{categoryName(s.categoryId)}</span> : null}
                  {s.serviceType ? <span>{s.serviceType}</span> : null}
                  {s.price != null ? <span>{formatCurrency(s.price)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Edit service dialog ──

/**
 * Edits one existing service row through the Supabase-authoritative
 * `update_work_order_service_row` RPC (CORE-WRITES-WORKORDERS-A1.2.3). Only the
 * allowlisted, non-date/time fields are sent; date/time stay read-only here and
 * land in a later slice. The dialog closes only after the RPC succeeds AND a
 * fresh Supabase read verifies both the parent aggregate and the flat child row
 * reflect the saved fields. Failures keep the dialog open with a recoverable
 * error and never fall back to local persistence.
 */
export function EditServiceDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { hasPermission } = useApp();
  const workOrderMutations = useWorkOrderMutations({
    companyId: order.companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const [draft, setDraft] = useState<RowDraft>(emptyDraft());
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (row) {
      setError("");
      setPending(false);
      setDraft({
        serviceName: row.serviceName,
        articleNumber: row.articleNumber ?? "",
        categoryName: row.categoryName ?? "",
        serviceType: row.serviceType ?? "",
        quantity: String(row.quantity),
        unit: row.unit ?? "",
        price: row.price != null ? String(row.price) : "",
        vat: row.vat != null ? String(row.vat) : "",
        status: row.status,
        notes: row.notes ?? "",
        serviceDate: row.serviceDate ?? "",
        serviceEndDate: row.serviceEndDate ?? "",
        plannedStartTime: row.plannedStartTime ?? "",
        plannedEndTime: row.plannedEndTime ?? "",
        assignedEmployeeIds: row.assignedEmployeeIds ?? [],
        openSlots: row.unassignedEmployeeSlots ? String(row.unassignedEmployeeSlots) : "",
        recurrenceInterval: row.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL,
      });
    }
  }, [row]);

  const busy = pending || workOrderMutations.isPending;
  const duration = calculatePlannedDurationMinutes(draft.plannedStartTime, draft.plannedEndTime);
  const qtyNum = numOrUndefined(draft.quantity) ?? 0;
  const priceNum = numOrUndefined(draft.price);
  const vatNum = numOrUndefined(draft.vat);
  const netTotal = priceNum != null ? qtyNum * priceNum : null;
  const grossTotal = netTotal != null && vatNum != null ? netTotal * (1 + vatNum / 100) : null;

  const save = async () => {
    if (!row || busy) return;
    setError("");
    if (!order.id.trim() || !order.companyId.trim()) {
      const message = "Editing a service requires a selected company and work order context.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    if (!draft.serviceName.trim()) {
      const message = "Service name is required.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return;
    }
    // Normal Edit Service Row only patches safe commercial fields. The service
    // snapshot fields (name / article / category / type) are locked to the
    // catalog item chosen when the row was created and changing the underlying
    // service belongs to a separate future Replace service action. Date/time and
    // recurrence editing also land in later, separately validated slices, so all
    // of those are excluded from the patch here.
    const patch: SupabaseWorkOrderServiceRowUpdatePatch = {
      quantity: numOrUndefined(draft.quantity) ?? row.quantity,
      unit: draft.unit.trim() || null,
      price: numOrUndefined(draft.price) ?? null,
      vat: numOrUndefined(draft.vat) ?? null,
      status: draft.status,
      notes: draft.notes.trim() || null,
    };
    setPending(true);
    try {
      await workOrderMutations.updateServiceRow({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        patch,
      });
      await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: row.id,
        expectedPatch: patch,
      });
      toast({ title: "Service updated" });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save changes.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={row != null} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit service</DialogTitle>
          <DialogDescription>This row is an independent copy and won't affect the catalog.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Service snapshot — locked catalog fields */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Service</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Service name" hint="Locked">
                <Input value={draft.serviceName} readOnly disabled aria-label="Service name (locked)" />
              </Field>
              <Field label="Article number" hint="Locked">
                <Input value={draft.articleNumber} readOnly disabled aria-label="Article number (locked)" />
              </Field>
              <Field label="Category" hint="Locked">
                <Input value={draft.categoryName} readOnly disabled aria-label="Category (locked)" />
              </Field>
              <Field label="Service type" hint="Locked">
                <Input value={draft.serviceType} readOnly disabled aria-label="Service type (locked)" />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Locked to the service selected when this row was created. Changing the underlying service will be a
              separate action.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Date & time — read-only in normal edit */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date &amp; time</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Service date" hint="Locked">
                  <Input value={draft.serviceDate} readOnly disabled aria-label="Service date (locked)" />
                </Field>
                <Field label="Recurrence" hint="Locked">
                  <Input
                    value={RECURRENCE_INTERVAL_LABELS[draft.recurrenceInterval]}
                    readOnly
                    disabled
                    aria-label="Recurrence (locked)"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Planned start" hint="Locked">
                  <Input value={draft.plannedStartTime} readOnly disabled aria-label="Planned start (locked)" />
                </Field>
                <Field label="Planned end" hint="Locked">
                  <Input value={draft.plannedEndTime} readOnly disabled aria-label="Planned end (locked)" />
                </Field>
                <DurationSummaryBox minutes={duration} />
              </div>
              <p className="text-xs text-muted-foreground">
                Date &amp; time are changed with the Change date/time action, not normal edit.
              </p>
            </div>

            {/* Unit & price — editable */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unit &amp; price</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity">
                  <Input
                    type="number"
                    min="0"
                    value={draft.quantity}
                    onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                  />
                </Field>
                <Field label="Unit" hint="e.g. hour, m²">
                  <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
                </Field>
                <Field label="Price">
                  <Input
                    type="number"
                    min="0"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </Field>
                <Field label="VAT %">
                  <Input
                    type="number"
                    min="0"
                    value={draft.vat}
                    onChange={(e) => setDraft({ ...draft, vat: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Status">
                <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as WorkOrderServiceStatus })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_ORDER_SERVICE_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total (excl. VAT)</span>
                  <span className="font-medium tabular-nums">{netTotal != null ? formatCurrency(netTotal) : "—"}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total (incl. VAT)</span>
                  <span className="font-medium tabular-nums">{grossTotal != null ? formatCurrency(grossTotal) : "—"}</span>
                </div>
              </div>
            </div>
          </div>

          <Field
            label="Schedule note"
            hint="Optional — operational instructions for schedulers."
          >
            <Textarea
              placeholder="Instructions tied to this service for planning & staffing…"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>

          {error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Planning + commercial fields shared by both dialogs: service date (required),
 * planned start/end time with a derived duration, employee assignment
 * (optional, multiple), plus quantity / unit / price / VAT / status / notes.
 */
function RowDraftFields({
  draft,
  setDraft,
  companyId,
  lockRecurrence = false,
  lockDateTime = false,
  compact = false,
  includeOpenSlots = false,
  showSummary = false,
  showNotes = true,
  showEmployees = true,
  previewPreferences = null,
}: {
  draft: RowDraft;
  setDraft: (d: RowDraft) => void;
  companyId: string;
  /**
   * Resolved customer/override scheduling preferences for a live Preferred Time
   * Evaluation preview. When provided and the add-on is available, a status
   * line is shown beneath the planned duration.
   */
  previewPreferences?: CustomerSchedulingPreferences | null;
  /**
   * When true, the recurrence interval and original service date are read-only.
   * Used for existing recurring rows so these defining values can't be edited
   * through the normal edit dialog.
   */
  lockRecurrence?: boolean;
  /**
   * When true, the service date, planned start/end time and recurrence end date
   * are read-only. Used by the A1.2.3 Edit slice, where date/time changes are
   * not yet Supabase-authoritative and are handled in a later slice.
   */
  lockDateTime?: boolean;
  /** Tighter layout: recurrence + end date and commercial fields share rows. */
  compact?: boolean;
  /** Shows the open / unassigned staffing slots control. */
  includeOpenSlots?: boolean;
  /** Shows the live staffing + labour summary card. */
  showSummary?: boolean;
  /** Whether to render the Notes textarea. */
  showNotes?: boolean;
  /** Whether employee/staffing controls are editable on this surface. */
  showEmployees?: boolean;
}) {
  const {
    employees,
    getDurationSettingsFor,
    systemSettings,
    getWorkOrderSettingsFor,
    isCompanyEntitledToService,
  } = useApp();
  const preferredTimeAvailable = isPreferredTimeEvaluationAvailable({
    masterAllows: systemSettings.allowPreferredTimeEvaluation === true,
    companyEntitled: isCompanyEntitledToService(companyId, "preferred_time_evaluation"),
    companyEnabled: getWorkOrderSettingsFor(companyId).preferredTimeEvaluationEnabled === true,
  });
  const preferredTimeResult =
    preferredTimeAvailable && previewPreferences
      ? evaluatePreferredTimeStatus(
          preferredTimeInputFromPreferences(previewPreferences, {
            scheduledDate: draft.serviceDate || null,
            plannedStartTime: draft.plannedStartTime || null,
            plannedEndTime: draft.plannedEndTime || null,
          }),
        )
      : null;
  const companyEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.companyId === companyId && e.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees, companyId],
  );
  const durationPresets = getDurationSettingsFor(companyId).presetMinutes;
  const duration = calculatePlannedDurationMinutes(draft.plannedStartTime, draft.plannedEndTime);
  const endBeforeStart =
    draft.recurrenceInterval !== "one_time" &&
    Boolean(draft.serviceEndDate) &&
    Boolean(draft.serviceDate) &&
    draft.serviceEndDate < draft.serviceDate;
  const toggleEmployee = (id: string) => {
    const next = draft.assignedEmployeeIds.includes(id)
      ? draft.assignedEmployeeIds.filter((e) => e !== id)
      : [...draft.assignedEmployeeIds, id];
    setDraft({ ...draft, assignedEmployeeIds: next });
  };

  const openSlotsNum = Math.max(0, Number.parseInt(draft.openSlots, 10) || 0);
  const setOpenSlots = (n: number) =>
    setDraft({ ...draft, openSlots: String(Math.max(0, n)) });
  const labour = calculatePlannedLabourMinutes({
    plannedStartTime: draft.plannedStartTime,
    plannedEndTime: draft.plannedEndTime,
    assignedEmployeeIds: draft.assignedEmployeeIds,
    unassignedEmployeeSlots: includeOpenSlots ? openSlotsNum : 0,
  });

  const recurrenceField = (
    <Field
      label="Recurrence"
      hint={lockRecurrence ? "Locked · use Clone to change" : "Calculated from the service date"}
    >
      <Select
        value={draft.recurrenceInterval}
        disabled={lockRecurrence}
        onValueChange={(v) => setDraft({ ...draft, recurrenceInterval: v as RecurrenceInterval })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RECURRENCE_INTERVALS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  const endDateField =
    draft.recurrenceInterval !== "one_time" ? (
      <Field
        label="End date"
        hint={
          endBeforeStart
            ? "Must be on or after the service date"
            : "Optional · stops recurring after this date"
        }
      >
        <Input
          type="date"
          value={draft.serviceEndDate}
          min={draft.serviceDate || undefined}
          disabled={lockDateTime}
          onChange={(e) => setDraft({ ...draft, serviceEndDate: e.target.value })}
        />
        {endBeforeStart ? (
          <p className="mt-1 text-xs text-destructive">
            The end date must be on or after the service date.
          </p>
        ) : null}
      </Field>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Service date"
          hint={lockDateTime ? "Coming soon" : lockRecurrence ? "Locked · recurring" : "Required"}
        >
          <Input
            type="date"
            value={draft.serviceDate}
            disabled={lockRecurrence || lockDateTime}
            onChange={(e) => setDraft({ ...draft, serviceDate: e.target.value })}
          />
        </Field>
        <Field label="Planned start" hint={lockDateTime ? "Coming soon" : "Optional"}>
          <TimePicker
            value={draft.plannedStartTime}
            disabled={lockDateTime}
            onChange={(v) => setDraft({ ...draft, plannedStartTime: v })}
            aria-label="Planned start time"
          />
        </Field>
        <div className="grid grid-cols-2 items-end gap-2">
          <Field label="Planned end" hint={lockDateTime ? "Coming soon" : "Optional"}>
            <TimePicker
              value={draft.plannedEndTime}
              disabled={lockDateTime}
              onChange={(v) => setDraft({ ...draft, plannedEndTime: v })}
              aria-label="Planned end time"
            />
          </Field>
          <DurationSummaryBox minutes={duration} />
        </div>
      </div>
      <QuickDurationHelper
        startTime={draft.plannedStartTime}
        onApply={(end) => setDraft({ ...draft, plannedEndTime: end })}
        presetMinutes={durationPresets}
      />
      {duration == null && draft.plannedStartTime && draft.plannedEndTime ? (
        <p className="text-xs text-destructive">End time must be after start time.</p>
      ) : null}
      {preferredTimeResult && preferredTimeResult.status !== "none" ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PreferredTimeStatusIcon result={preferredTimeResult} />
          <span>{preferredTimeResult.reason ?? "Preferred time status"}</span>
        </div>
      ) : null}

      {compact ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {recurrenceField}
          {endDateField}
        </div>
      ) : (
        <>
          {recurrenceField}
          {endDateField}
        </>
      )}

      {showEmployees ? (
        <Field label="Employees" hint="Optional · assign none, one, or several">
          {companyEmployees.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active employees for this company yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {companyEmployees.map((e) => {
                const active = draft.assignedEmployeeIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggleEmployee(e.id)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {e.name}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Employee assignment is temporarily unavailable here. Use the read-only staffing display for now.
        </div>
      )}

      {includeOpenSlots && showEmployees ? (
        <Field label="Open (unassigned) slots" hint="Planned headcount still to assign">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setOpenSlots(openSlotsNum - 1)}
              disabled={openSlotsNum <= 0}
              aria-label="Remove open slot"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              className="w-20 text-center tabular-nums"
              value={draft.openSlots}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, openSlots: e.target.value })}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setOpenSlots(openSlotsNum + 1)}
              aria-label="Add open slot"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Field>
      ) : null}

      <div className={compact ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-4 sm:grid-cols-2"}>
        <Field label="Quantity">
          <Input
            type="number"
            min="0"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
          />
        </Field>
        <Field label="Unit" hint="e.g. hour, m², piece">
          <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        </Field>
        <Field label="Price">
          <Input
            type="number"
            min="0"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        </Field>
        <Field label="VAT %">
          <Input
            type="number"
            min="0"
            value={draft.vat}
            onChange={(e) => setDraft({ ...draft, vat: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Status">
        <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as WorkOrderServiceStatus })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORK_ORDER_SERVICE_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {showNotes ? (
        <Field
          label="Schedule note"
          hint="Optional — operational instructions for schedulers (e.g. two cleaners, bring ladder, access after 09:00)."
        >
          <Textarea
            placeholder="Instructions tied to this service for planning & staffing…"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Field>
      ) : null}

      {showSummary ? (
        <ServiceDraftSummary
          visitMinutes={labour.visitMinutes}
          assignedEmployeeCount={labour.assignedEmployeeCount}
          openSlots={labour.unassignedEmployeeSlots}
          totalStaff={labour.plannedHeadcount}
          labourMinutes={labour.labourMinutes}
        />
      ) : null}
    </div>
  );
}

/**
 * Read-only live summary of the service draft's staffing and labour, derived
 * from {@link calculatePlannedLabourMinutes} so it always matches the engine.
 */
function ServiceDraftSummary({
  visitMinutes,
  assignedEmployeeCount,
  openSlots,
  totalStaff,
  labourMinutes,
}: {
  visitMinutes: number | null;
  assignedEmployeeCount: number;
  openSlots: number;
  totalStaff: number;
  labourMinutes: number | null;
}) {
  const items: { label: string; value: string }[] = [
    { label: "Visit duration", value: visitMinutes != null ? formatDuration(visitMinutes) : "—" },
    { label: "Assigned employees", value: String(assignedEmployeeCount) },
    { label: "Open slots", value: String(openSlots) },
    { label: "Total staff", value: String(totalStaff) },
    { label: "Total labour time", value: labourMinutes != null ? formatDuration(labourMinutes) : "—" },
  ];
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Summary
      </h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{it.label}</dt>
            <dd className="text-sm font-medium tabular-nums text-foreground">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─────────────────────────────────────────────
// Recurring variations
// ─────────────────────────────────────────────

const NO_OVERRIDE = "__none__";

const NO_TYPE = "__none_type__";

/** Shape passed to add/replace variation mutations (matches AppContext input). */
type VariationSaveInput = Omit<
  RecurringVariation,
  "id" | "enabled" | "archived" | "createdAt" | "updatedAt"
>;

interface VariationDraft {
  name: string;
  type: string;
  status: VariationStatus;
  appliesFrom: string;
  appliesUntil: string;
  frequency: RecurringVariationFrequency;
  interval: string;
  weekOfMonth: string;
  weekday: string;
  day: string;
  startTime: string;
  endTime: string;
  durationMinutes: string;
  /** Legacy field, preserved on save but no longer edited in the UI. */
  employeeCount: string;
  assignedEmployeeIds: string[];
  /** Operational staffing intent (maps to assigned ids + open-slot delta). */
  staffingMode: StaffingMode;
  /** Number of extra/fewer people when staffingMode is "more"/"fewer". */
  staffingCount: string;
  internalNote: string;
  /** Legacy free-text reason, preserved on save but folded into notes in the UI. */
  reason: string;
}

function emptyVariationDraft(): VariationDraft {
  return {
    name: "",
    type: NO_TYPE,
    status: "draft",
    appliesFrom: "",
    appliesUntil: "",
    frequency: "every_n_weeks",
    interval: "4",
    weekOfMonth: "1",
    weekday: "monday",
    day: NO_OVERRIDE,
    startTime: "",
    endTime: "",
    durationMinutes: "",
    employeeCount: "",
    assignedEmployeeIds: [],
    staffingMode: "same",
    staffingCount: "1",
    internalNote: "",
    reason: "",
  };
}

function draftFromVariation(v: RecurringVariation): VariationDraft {
  return {
    name: v.name,
    type: v.type ?? NO_TYPE,
    status: getVariationStatus(v),
    appliesFrom: v.appliesFrom ?? "",
    appliesUntil: v.appliesUntil ?? "",
    frequency: v.frequency,
    interval: v.interval != null ? String(v.interval) : "",
    weekOfMonth: v.weekOfMonth != null ? String(v.weekOfMonth) : "1",
    weekday: v.weekday ?? "monday",
    day: v.day ?? NO_OVERRIDE,
    startTime: v.startTime ?? "",
    endTime: v.endTime ?? "",
    durationMinutes: v.durationMinutes != null ? String(v.durationMinutes) : "",
    employeeCount: v.employeeCount != null ? String(v.employeeCount) : "",
    assignedEmployeeIds: v.assignedEmployeeIds ?? [],
    staffingMode: deriveStaffingMode(v),
    staffingCount:
      v.unassignedSlotsDelta != null && v.unassignedSlotsDelta !== 0
        ? String(Math.abs(v.unassignedSlotsDelta))
        : "1",
    internalNote: v.internalNote ?? "",
    reason: v.reason ?? "",
  };
}

/** Human-readable recurrence description for display. */
function variationFrequencyText(v: RecurringVariation): string {
  switch (v.frequency) {
    case "every_n_weeks":
      return `Every ${v.interval ?? 1} week${(v.interval ?? 1) === 1 ? "" : "s"}`;
    case "every_n_visits":
      return `Every ${v.interval ?? 1} visit${(v.interval ?? 1) === 1 ? "" : "s"}`;
    case "nth_weekday_of_month": {
      const ord = WEEK_OF_MONTH_OPTIONS.find((o) => o.value === v.weekOfMonth)?.label ?? "";
      const wd = v.weekday ? WEEK_DAY_LABELS[v.weekday] : "";
      return `${ord} ${wd} of month`.trim();
    }
    default:
      return RECURRING_VARIATION_FREQUENCY_LABELS[v.frequency];
  }
}

/** Short summary of the overrides a variation carries. */
function variationOverrideText(v: RecurringVariation): string[] {
  const parts: string[] = [];
  if (v.day) parts.push(WEEK_DAY_LABELS[v.day]);
  if (v.startTime || v.endTime) parts.push(`${v.startTime || "–"}–${v.endTime || "–"}`);
  if (v.durationMinutes != null) parts.push(`${v.durationMinutes} min`);
  if (v.employeeCount != null) parts.push(`${v.employeeCount} staff`);
  if (v.assignedEmployeeIds && v.assignedEmployeeIds.length > 0) {
    parts.push(`${v.assignedEmployeeIds.length} assigned`);
  }
  if (v.unassignedSlotsDelta != null && v.unassignedSlotsDelta !== 0) {
    parts.push(
      `${v.unassignedSlotsDelta > 0 ? "+" : ""}${v.unassignedSlotsDelta} open slot${
        Math.abs(v.unassignedSlotsDelta) === 1 ? "" : "s"
      }`,
    );
  }
  return parts;
}

/** Badge styling per calculated display state. */
const VARIATION_STATE_BADGE_CLASS: Record<VariationDisplayState, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  future: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  expired: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  inactive: "border-border bg-muted text-muted-foreground",
  archived: "border-border bg-muted text-muted-foreground",
};

function VariationStateBadge({ state }: { state: VariationDisplayState }) {
  return (
    <Badge variant="outline" className={VARIATION_STATE_BADGE_CLASS[state]}>
      {VARIATION_DISPLAY_STATE_LABELS[state]}
    </Badge>
  );
}

// ── Operational staffing model (UI-only mapping over existing fields) ──

/**
 * Plain-language staffing intent presented to administrators. Each maps onto
 * the existing variation fields (`assignedEmployeeIds` + `unassignedSlotsDelta`)
 * via {@link staffingOverrideFromMode}; the variation engine is unchanged.
 */
type StaffingMode = "same" | "more" | "fewer" | "specific";

const STAFFING_MODE_OPTIONS: { value: StaffingMode; label: string; hint: string }[] = [
  { value: "same", label: "Same as the usual booking", hint: "No change to who attends" },
  { value: "more", label: "More staff", hint: "Add extra people to this booking" },
  { value: "fewer", label: "Fewer staff", hint: "Send fewer people than usual" },
  { value: "specific", label: "Specific people", hint: "Choose exactly who attends" },
];

/** Infers the operational staffing mode from a variation's stored overrides. */
function deriveStaffingMode(input: {
  assignedEmployeeIds?: string[];
  unassignedSlotsDelta?: number | null;
}): StaffingMode {
  if (input.assignedEmployeeIds && input.assignedEmployeeIds.length > 0) return "specific";
  const d = input.unassignedSlotsDelta ?? 0;
  if (d > 0) return "more";
  if (d < 0) return "fewer";
  return "same";
}

/**
 * Translates an operational staffing choice back into the engine's existing
 * override fields. "More/fewer" adjust the open-slot delta; "specific" sets an
 * absolute assigned-employee list; "same" clears both (no override). Pure.
 */
function staffingOverrideFromMode(params: {
  mode: StaffingMode;
  count: number;
  assignedEmployeeIds: string[];
}): { assignedEmployeeIds?: string[]; unassignedSlotsDelta?: number } {
  const count = Math.max(1, Math.floor(params.count) || 1);
  switch (params.mode) {
    case "more":
      return { unassignedSlotsDelta: count };
    case "fewer":
      return { unassignedSlotsDelta: -count };
    case "specific":
      return params.assignedEmployeeIds.length > 0
        ? { assignedEmployeeIds: params.assignedEmployeeIds }
        : {};
    case "same":
    default:
      return {};
  }
}

/**
 * Operational staffing picker shared by the variation wizard and the manage
 * editor. Presents the four plain-language choices, the matching detail input
 * (extra/fewer count or specific people), and a live confirmation of the
 * resulting required crew vs the usual booking. Purely presentational.
 */
function StaffingSection({
  mode,
  count,
  assignedEmployeeIds,
  companyEmployees,
  baseAssignedIds,
  baseOpenSlots,
  onModeChange,
  onCountChange,
  onToggleEmployee,
}: {
  mode: StaffingMode;
  count: string;
  assignedEmployeeIds: string[];
  companyEmployees: { id: string; name: string }[];
  baseAssignedIds: string[];
  baseOpenSlots: number;
  onModeChange: (mode: StaffingMode) => void;
  onCountChange: (value: string) => void;
  onToggleEmployee: (id: string) => void;
}) {
  const override = staffingOverrideFromMode({
    mode,
    count: Number.parseInt(count, 10) || 0,
    assignedEmployeeIds,
  });
  const comparison = compareVariationStaffing({
    baseAssignedIds,
    baseOpenSlots,
    variationAssignedIds: override.assignedEmployeeIds,
    unassignedSlotsDelta: override.unassignedSlotsDelta,
  });
  const baseRequired = baseAssignedIds.length + Math.max(0, baseOpenSlots);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {STAFFING_MODE_OPTIONS.map((opt) => {
          const on = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onModeChange(opt.value)}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                on
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-background hover:border-primary/40",
              )}
            >
              <span className="block text-sm font-medium">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          );
        })}
      </div>

      {(mode === "more" || mode === "fewer") && (
        <div className="max-w-[14rem]">
          <Field label={mode === "more" ? "How many extra people?" : "How many fewer people?"}>
            <Input
              type="number"
              min={1}
              value={count}
              onChange={(e) => onCountChange(e.target.value)}
              placeholder="1"
            />
          </Field>
          {mode === "fewer" && baseOpenSlots === 0 ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              The usual booking has no open slots to remove. To send a smaller
              crew, choose “Specific people” instead.
            </p>
          ) : null}
        </div>
      )}

      {mode === "specific" && (
        <div className="space-y-1.5">
          <Label>Who attends this booking?</Label>
          {companyEmployees.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No active employees in this company.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {companyEmployees.map((e) => {
                const on = assignedEmployeeIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onToggleEmployee(e.id)}
                    className={
                      on
                        ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                        : "rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    }
                  >
                    {e.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug",
          comparison.reduces
            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            : "border-border bg-muted/40 text-muted-foreground",
        )}
      >
        {comparison.reduces ? (
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : null}
        <p>
          This booking will need{" "}
          <span className="font-semibold text-foreground">
            {comparison.variationRequiredStaff} {comparison.variationRequiredStaff === 1 ? "person" : "people"}
          </span>{" "}
          ({comparison.variationAssignedCount} assigned + {comparison.variationOpenSlots} open{" "}
          {comparison.variationOpenSlots === 1 ? "slot" : "slots"}).
          {comparison.differs
            ? ` The usual booking needs ${baseRequired}.`
            : " Same as the usual booking."}
          {comparison.reduces ? " Make sure the smaller crew is intended." : ""}
        </p>
      </div>
    </div>
  );
}

function formatValidity(v: RecurringVariation): string | null {
  if (!v.appliesFrom && !v.appliesUntil) return null;
  const from = v.appliesFrom ? formatDate(v.appliesFrom) : "Anytime";
  const until = v.appliesUntil ? formatDate(v.appliesUntil) : "Indefinitely";
  return `${from} → ${until}`;
}

type VariationSortKey = "status" | "start" | "end";

const VARIATION_STATUS_ORDER: Record<VariationStatus, number> = {
  active: 0,
  draft: 1,
  inactive: 2,
  archived: 3,
};

// ── Booking preview (simulation only — never creates bookings) ──

function PreviewSummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <div
        className={
          tone === "warning" && value > 0
            ? "text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function PreviewSourceBadge({ booking }: { booking: PreviewBooking }) {
  const { source } = booking;
  if (source.kind === "conflict") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
      >
        <CircleAlert className="h-3 w-3" /> Conflict Detected
      </Badge>
    );
  }
  if (source.kind === "variation") {
    return (
      <Badge
        variant="outline"
        className="border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
      >
        Variation: {source.variationNames[0]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      Default Rule
    </Badge>
  );
}

function BookingPreviewDialog({
  order,
  customer,
  row,
  onClose,
}: {
  order: WorkOrder;
  customer: Customer | null;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const [range, setRange] = useState<PreviewRange>(DEFAULT_PREVIEW_RANGE);

  useEffect(() => {
    if (!row) setRange(DEFAULT_PREVIEW_RANGE);
  }, [row]);

  const prefs =
    row?.scheduleSource === "override" && row.schedulePreferences
      ? row.schedulePreferences
      : customer?.schedulingPreferences ?? null;

  const result = useMemo(() => {
    if (!row) return null;
    return generateBookingPreview(
      prefs,
      row.variations ?? [],
      range,
      order.startDate,
    );
  }, [row, prefs, range, order.startDate]);

  return (
    <Dialog open={row != null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Booking preview</DialogTitle>
          <DialogDescription>
            A forecast of how “{row?.serviceName}” would generate future bookings from
            its default schedule and active variations. This is a simulation for
            validation only — no real bookings, calendar entries or schedules are created.
          </DialogDescription>
        </DialogHeader>

        {result?.error ? (
          <div className="rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            {result.error}
          </div>
        ) : result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <PreviewSummaryStat label="Generated Bookings" value={result.summary.generated} />
              <PreviewSummaryStat label="Default Bookings" value={result.summary.defaultBookings} />
              <PreviewSummaryStat label="Variation Bookings" value={result.summary.variationBookings} />
              <PreviewSummaryStat label="Conflicts" value={result.summary.conflicts} tone="warning" />
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Manual exceptions, scheduling conflicts and employee availability are
                ignored in this preview.
              </p>
              <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as PreviewRange)}>
                <SelectTrigger className="w-40 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREVIEW_RANGES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Next {n} bookings
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ol className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {result.bookings.map((b) => (
                <li
                  key={b.index}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                        #{b.index}
                      </span>
                      <span className="font-medium">{WEEK_DAY_LABELS[b.day]}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(b.date)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {b.startTime || "—"} – {b.endTime || "—"}
                      </span>
                      <span>
                        {b.employeeCount} employee{b.employeeCount === 1 ? "" : "s"}
                      </span>
                      {b.durationMinutes != null ? <span>{b.durationMinutes} min</span> : null}
                    </div>
                    {b.source.kind === "conflict" ? (
                      <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Involves: {b.source.variationNames.join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <PreviewSourceBadge booking={b} />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Steps in the Variation Creation Wizard. */
type WizardStep = 1 | 2 | 3;

/** User-facing repeat patterns offered in Step 2 (occurrence-based, not weeks). */
type PatternKind = "every" | "every_2" | "every_4" | "custom";

/** Plain-language pattern choices shown in Step 2. */
const PATTERN_OPTIONS: { kind: PatternKind; label: string; hint: string }[] = [
  { kind: "every", label: "Every booking", hint: "This booking and every booking after it." },
  { kind: "every_2", label: "Every 2nd booking", hint: "This booking, then every 2nd one." },
  { kind: "every_4", label: "Every 4th booking", hint: "This booking, then every 4th one." },
  {
    kind: "custom",
    label: "Every custom number of bookings",
    hint: "Choose your own interval below.",
  },
];

/** How many matching occurrences to surface in the Step 2 live preview. */
const PREVIEW_MATCH_COUNT = 6;

/**
 * Resolves the repeat interval (in bookings) for a chosen pattern. Returns null
 * only when a custom value is invalid (empty / < 1), which disables Next.
 */
function intervalForPattern(kind: PatternKind, custom: string): number | null {
  switch (kind) {
    case "every":
      return 1;
    case "every_2":
      return 2;
    case "every_4":
      return 4;
    case "custom": {
      const n = Number.parseInt(custom, 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    }
    default:
      return null;
  }
}

/** Ordinal suffix helper for plain-language copy (1st, 2nd, 3rd, 4th…). */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Variation Creation Wizard — Step 2: Define Pattern.
 *
 * Pure presentational step: shows the selected start booking, lets the admin
 * pick a booking-based repeat interval, and renders a live preview of the next
 * matching occurrences (computed by the parent via the shared generator). It
 * collects wizard state only and NEVER creates or persists a variation.
 */
function VariationPatternStep({
  anchor,
  patternKind,
  onPatternKindChange,
  customInterval,
  onCustomIntervalChange,
  resolvedInterval,
  previewOccurrences,
  employeesLabel,
}: {
  anchor: ServiceRowOccurrence | null;
  patternKind: PatternKind;
  onPatternKindChange: (kind: PatternKind) => void;
  customInterval: string;
  onCustomIntervalChange: (value: string) => void;
  resolvedInterval: number | null;
  previewOccurrences: ServiceRowOccurrence[];
  employeesLabel: (occ: ServiceRowOccurrence) => string;
}) {
  if (!anchor) return null;

  return (
    <div className="space-y-4">
      {/* Selected start booking summary */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Starts from
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-medium tabular-nums">{formatDate(anchor.displayDate)}</span>
          <Badge variant="secondary">Booking #{anchor.occurrenceIndex + 1}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="h-3 w-3" />
            {anchor.startTime && anchor.endTime
              ? `${anchor.startTime}–${anchor.endTime}`
              : "No time"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {employeesLabel(anchor)}
          </span>
        </div>
      </div>

      {/* Pattern selection */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          How often should this variation repeat?
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PATTERN_OPTIONS.map((opt) => {
            const isActive = patternKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                onClick={() => onPatternKindChange(opt.kind)}
                className={
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors " +
                  (isActive
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/50")
                }
              >
                <span
                  className={
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border " +
                    (isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40")
                  }
                >
                  {isActive ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {patternKind === "custom" ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-3">
            <span className="text-sm text-muted-foreground">Every</span>
            <Input
              type="number"
              min={1}
              className="w-20"
              value={customInterval}
              onChange={(e) => onCustomIntervalChange(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">bookings</span>
          </div>
        ) : null}
      </div>

      {/* Live preview */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Next matching bookings
        </div>
        {resolvedInterval == null ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            Enter a valid interval (1 or more bookings) to preview.
          </div>
        ) : previewOccurrences.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            This pattern produces no upcoming bookings. Pick a different start or interval.
          </div>
        ) : (
          <div className="max-h-[34vh] space-y-2 overflow-y-auto pr-1">
            {previewOccurrences.map((occ, i) => (
              <WizardOccurrenceLine
                key={occ.occurrenceKey}
                occ={occ}
                employeesLabel={employeesLabel(occ)}
                indexLabel={`#${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Plain-language label for a resolved booking interval (1 ⇒ "Every booking"). */
function patternLabelFor(interval: number): string {
  return interval === 1 ? "Every booking" : `Every ${ordinal(interval)} booking`;
}

/** Editable overrides collected in Step 3 (no variation is persisted here). */
interface WizardConfig {
  name: string;
  type: string;
  startTime: string;
  endTime: string;
  assignedEmployeeIds: string[];
  staffingMode: StaffingMode;
  staffingCount: string;
  internalNote: string;
}

/** A blank Step 3 config. The parent seeds time/staffing defaults from the anchor. */
function emptyWizardConfig(): WizardConfig {
  return {
    name: "",
    type: NO_TYPE,
    startTime: "",
    endTime: "",
    assignedEmployeeIds: [],
    staffingMode: "same",
    staffingCount: "1",
    internalNote: "",
  };
}

/**
 * Variation Creation Wizard — Step 3: Configure changes.
 *
 * Lets the admin name the variation and override time, staffing and notes for
 * the matched bookings, then shows a summary before saving. Time is the source
 * of truth for duration (no separate duration field). Purely presentational —
 * state lives in the parent and nothing is persisted until the parent saves.
 */
function VariationConfigureStep({
  anchor,
  resolvedInterval,
  previewOccurrences,
  companyEmployees,
  baseOpenSlots,
  baseAssignedIds,
  config,
  onConfigChange,
  onToggleEmployee,
  employeeNameById,
  employeesLabel,
}: {
  anchor: ServiceRowOccurrence | null;
  resolvedInterval: number | null;
  previewOccurrences: ServiceRowOccurrence[];
  companyEmployees: { id: string; name: string }[];
  baseOpenSlots: number;
  baseAssignedIds: string[];
  config: WizardConfig;
  onConfigChange: (patch: Partial<WizardConfig>) => void;
  onToggleEmployee: (id: string) => void;
  employeeNameById: Map<string, string>;
  employeesLabel: (occ: ServiceRowOccurrence) => string;
}) {
  if (!anchor || resolvedInterval == null) return null;

  const visitMinutes = calculatePlannedDurationMinutes(
    config.startTime || undefined,
    config.endTime || undefined,
  );
  const timeChanged =
    (config.startTime && config.startTime !== (anchor.startTime ?? "")) ||
    (config.endTime && config.endTime !== (anchor.endTime ?? ""));
  const staffingOverride = staffingOverrideFromMode({
    mode: config.staffingMode,
    count: Number.parseInt(config.staffingCount, 10) || 0,
    assignedEmployeeIds: config.assignedEmployeeIds,
  });
  const staffingComparison = compareVariationStaffing({
    baseAssignedIds,
    baseOpenSlots,
    variationAssignedIds: staffingOverride.assignedEmployeeIds,
    unassignedSlotsDelta: staffingOverride.unassignedSlotsDelta,
  });
  const staffingChanged = staffingComparison.differs || config.staffingMode === "specific";

  const selectedNames = config.assignedEmployeeIds.map(
    (id) => employeeNameById.get(id) ?? "Unknown",
  );

  return (
    <div className="space-y-4">
      {/* Context strip: anchor + pattern */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Starts from
          </span>
          <span className="font-medium tabular-nums">{formatDate(anchor.displayDate)}</span>
          <Badge variant="secondary">Booking #{anchor.occurrenceIndex + 1}</Badge>
          <Badge variant="outline" className="text-muted-foreground">
            <Repeat className="mr-1 h-3 w-3" />
            {patternLabelFor(resolvedInterval)}
          </Badge>
        </div>
      </div>

      <Field label="Variation name" hint="Shown in the service list, conflicts and booking lists">
        <Input
          value={config.name}
          onChange={(e) => onConfigChange({ name: e.target.value })}
          placeholder="Deep Clean"
        />
      </Field>

      <Field label="Variation type" hint="Informational only — does not affect scheduling">
        <Select value={config.type} onValueChange={(v) => onConfigChange({ type: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Select a type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TYPE}>No type</SelectItem>
            {VARIATION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Time */}
      <div className="rounded-xl border border-border bg-background p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Time
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start time">
            <TimePicker
              value={config.startTime}
              onChange={(v) => onConfigChange({ startTime: v })}
              aria-label="Variation start time"
            />
          </Field>
          <Field label="End time">
            <TimePicker
              value={config.endTime}
              onChange={(v) => onConfigChange({ endTime: v })}
              aria-label="Variation end time"
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Visit duration:{" "}
          <span className="font-medium text-foreground">
            {visitMinutes != null ? formatDuration(visitMinutes) : "—"}
          </span>{" "}
          (calculated from the time window).
        </p>
      </div>

      {/* Staffing */}
      <div className="rounded-xl border border-border bg-background p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Staffing
        </p>
        <StaffingSection
          mode={config.staffingMode}
          count={config.staffingCount}
          assignedEmployeeIds={config.assignedEmployeeIds}
          companyEmployees={companyEmployees}
          baseAssignedIds={baseAssignedIds}
          baseOpenSlots={baseOpenSlots}
          onModeChange={(m) => onConfigChange({ staffingMode: m })}
          onCountChange={(v) => onConfigChange({ staffingCount: v })}
          onToggleEmployee={onToggleEmployee}
        />
      </div>

      <Field label="Internal notes" hint="Admin-only — not shown to customers (optional)">
        <Textarea
          value={config.internalNote}
          onChange={(e) => onConfigChange({ internalNote: e.target.value })}
          placeholder="Deep cleaning — includes kitchen and windows. Bring extra equipment."
        />
      </Field>

      {/* Summary card */}
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Summary
        </p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Name</dt>
            <dd className="font-medium">{config.name.trim() || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Start booking</dt>
            <dd className="tabular-nums">
              {formatDate(anchor.displayDate)} · Booking #{anchor.occurrenceIndex + 1}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Pattern</dt>
            <dd>{patternLabelFor(resolvedInterval)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Time</dt>
            <dd className="tabular-nums">
              {timeChanged && config.startTime && config.endTime
                ? `${config.startTime}–${config.endTime}`
                : "Unchanged"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Staffing</dt>
            <dd>
              {staffingChanged
                ? config.staffingMode === "specific"
                  ? selectedNames.length > 0
                    ? selectedNames.join(", ")
                    : "No assigned staff"
                  : `${staffingComparison.variationRequiredStaff} people (${staffingComparison.variationAssignedCount} assigned + ${staffingComparison.variationOpenSlots} open)`
                : "Unchanged"}
            </dd>
          </div>
          {config.internalNote.trim() ? (
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Notes</dt>
              <dd>{config.internalNote.trim()}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Next bookings</p>
          {previewOccurrences.length === 0 ? (
            <p className="text-xs text-muted-foreground">No upcoming bookings match this pattern.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {previewOccurrences.slice(0, 5).map((o) => (
                <li key={o.occurrenceKey} className="tabular-nums">
                  {formatDate(o.displayDate)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read-only one-line occurrence summary used by the Step 2 live preview. */
function WizardOccurrenceLine({
  occ,
  employeesLabel,
  indexLabel,
}: {
  occ: ServiceRowOccurrence;
  employeesLabel: string;
  indexLabel?: string;
}) {
  const isCancelled = occ.status === "cancelled";
  return (
    <div
      className={
        "rounded-xl border p-3 " +
        (isCancelled ? "border-border bg-muted/40 opacity-70" : "border-border bg-card")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {indexLabel ? <Badge variant="secondary">{indexLabel}</Badge> : null}
        <span className="font-medium tabular-nums">{formatDate(occ.displayDate)}</span>
        {occ.isVariation ? (
          <Badge variant="outline" className="text-muted-foreground">
            <Repeat className="mr-1 h-3 w-3" /> Variation
          </Badge>
        ) : null}
        {isCancelled ? (
          <Badge
            variant="outline"
            className="border-destructive/40 bg-destructive/10 text-destructive"
          >
            Cancelled
          </Badge>
        ) : null}
        {occ.status === "rescheduled" ? <Badge variant="secondary">Rescheduled</Badge> : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Clock className="h-3 w-3" />
          {occ.startTime && occ.endTime ? `${occ.startTime}–${occ.endTime}` : "No time"}
        </span>
        <span>
          Time:{" "}
          <span className="font-medium text-foreground">
            {occ.visitMinutes != null ? formatDuration(occ.visitMinutes) : "—"}
          </span>
        </span>
        <span>
          Total Time:{" "}
          <span className="font-medium text-foreground">
            {occ.labourMinutes != null ? formatDuration(occ.labourMinutes) : "—"}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" />
          {employeesLabel}
        </span>
      </div>
    </div>
  );
}

/**
 * Variation Creation Wizard — Step 1: Select Start Booking.
 *
 * Lists the upcoming concrete occurrences of a service row (via the shared
 * {@link generateServiceRowOccurrences} pipeline, the same one the Booking Queue
 * uses) so the admin can pick which booking the variation should start from. The
 * selected occurrence's series index becomes the variation's
 * `anchorOccurrenceIndex` in later steps. This step is read-only: it selects an
 * anchor and NEVER creates, saves or mutates a variation.
 */
/**
 * Finds the next upcoming date a variation applies to within the supplied
 * resolved occurrences. Uses the shared {@link variationMatchesOccurrence} rule
 * (so anchored and legacy variations behave identically to the resolver) and
 * respects the variation's validity window. Returns null when none is upcoming.
 */
function nextVariationOccurrenceDate(
  occurrences: ServiceRowOccurrence[],
  v: RecurringVariation,
  todayIso: string,
): string | null {
  for (const o of occurrences) {
    if (o.displayDate < todayIso) continue;
    if (v.appliesFrom && o.occurrenceDate < v.appliesFrom) continue;
    if (v.appliesUntil && o.occurrenceDate > v.appliesUntil) continue;
    const date = new Date(`${o.occurrenceDate}T00:00:00`);
    if (variationMatchesOccurrence(v, o.occurrenceIndex, date)) return o.displayDate;
  }
  return null;
}

/**
 * Child hierarchy row rendered under a service row, listing its active recurring
 * variations (name, lifecycle state, repeat pattern and next occurrence). Makes
 * the parent/child relationship visually obvious in the Services tab. Read-only
 * — management still happens via the variations dialog/wizard.
 */
function ServiceVariationsRow({
  orderId,
  row,
  variations,
  colSpan,
}: {
  orderId: string;
  row: WorkOrderServiceRow;
  variations: RecurringVariation[];
  colSpan: number;
}) {
  const { bookingOccurrenceExceptions } = useApp();
  const { toast } = useToast();
  const exceptionsByKey = useMemo(
    () => indexOccurrenceExceptions(bookingOccurrenceExceptions),
    [bookingOccurrenceExceptions],
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  // Generate a bounded forward window once; each variation is matched against it.
  const occurrences = useMemo<ServiceRowOccurrence[]>(
    () =>
      generateServiceRowOccurrences({
        row,
        fromDate: todayIso,
        limit: 120,
        exceptions: exceptionsByKey,
      }),
    [row, todayIso, exceptionsByKey],
  );

  // The variation pending a Remove/Stop confirmation, with the resolved safe
  // action: "delete" only when the variation has no history, else "stop".
  const [pending, setPending] = useState<
    { variation: RecurringVariation; mode: "delete" | "stop" } | null
  >(null);

  const confirm = () => {
    toast(serviceRowActionUnavailableToast());
    setPending(null);
  };

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell />
      <TableCell colSpan={colSpan - 1} className="pt-0">
        <ul className="space-y-1.5">
          {variations.map((v) => {
            const nextDate = nextVariationOccurrenceDate(occurrences, v, todayIso);
            const appliedInPast = variationHasPastOccurrence(row, v, todayIso);
            const canDelete = validateVariationDelete(v, { appliedInPast }).allowed;
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="select-none font-mono text-muted-foreground">└─</span>
                <span className="font-medium">{v.name}</span>
                <VariationStateBadge state={getVariationDisplayState(v)} />
                <Badge variant="outline" className="text-muted-foreground">
                  <Repeat className="mr-1 h-3 w-3" />
                  {variationFrequencyText(v)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {nextDate ? (
                    <>
                      Next: <span className="font-medium text-foreground tabular-nums">{formatDate(nextDate)}</span>
                    </>
                  ) : (
                    "No upcoming bookings"
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={
                    canDelete
                      ? "ml-auto h-7 px-2 text-destructive hover:text-destructive"
                      : "ml-auto h-7 px-2 text-muted-foreground"
                  }
                  onClick={() => {
                    toast(serviceRowActionUnavailableToast());
                    setPending({ variation: v, mode: canDelete ? "delete" : "stop" });
                  }}
                >
                  {canDelete ? (
                    <>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                    </>
                  ) : (
                    <>
                      <CircleStop className="mr-1 h-3.5 w-3.5" /> Stop
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </TableCell>
      <AlertDialog open={pending != null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.mode === "delete" ? "Remove this variation?" : "Stop this variation?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.mode === "delete" ? (
                <>
                  “{pending?.variation.name}” hasn’t applied to any past booking, so it can be
                  removed completely. This permanently deletes the variation.
                </>
              ) : (
                <>
                  “{pending?.variation.name}” has already applied to past bookings, so it can’t be
                  deleted. Stopping it keeps those past bookings exactly as they were and prevents
                  the variation from applying to any future booking from today onward.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirm}
              className={
                pending?.mode === "delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {pending?.mode === "delete" ? "Remove variation" : "Stop variation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TableRow>
  );
}

function VariationWizardDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const {
    employees,
    bookingOccurrenceExceptions,
    addServiceRowVariation,
    replaceServiceRowVariation,
  } = useApp();
  const [step, setStep] = useState<WizardStep>(1);
  const [searchStart, setSearchStart] = useState<string>("");
  const [searchEnd, setSearchEnd] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(DEFAULT_OCCURRENCE_LIMIT);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The anchor booking captured when advancing to Step 2 — stable regardless of
  // any later search-filter changes. This holds the wizard's primary output:
  // occurrenceIndex / anchorOccurrenceIndex.
  const [anchor, setAnchor] = useState<ServiceRowOccurrence | null>(null);
  // Step 2 pattern selection (occurrence-based, not week-based).
  const [patternKind, setPatternKind] = useState<PatternKind>("every");
  const [customInterval, setCustomInterval] = useState<string>("3");
  // Step 3 configuration (overrides for the matched bookings).
  const [config, setConfig] = useState<WizardConfig>(emptyWizardConfig());
  // Overlap conflict awaiting an admin decision (chain / replace / cancel), plus
  // the candidate captured at save time so the chosen action can persist it.
  const [conflict, setConflict] = useState<VariationConflict | null>(null);
  const [pendingInput, setPendingInput] = useState<VariationSaveInput | null>(null);

  const rowId = row?.id ?? null;
  // Reset the wizard whenever it opens for a different row.
  useEffect(() => {
    setStep(1);
    setSearchStart("");
    setSearchEnd("");
    setVisibleCount(DEFAULT_OCCURRENCE_LIMIT);
    setSelectedKey(null);
    setAnchor(null);
    setPatternKind("every");
    setCustomInterval("3");
    setConfig(emptyWizardConfig());
    setConflict(null);
    setPendingInput(null);
  }, [rowId]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);

  const exceptionsByKey = useMemo(
    () => indexOccurrenceExceptions(bookingOccurrenceExceptions),
    [bookingOccurrenceExceptions],
  );

  // Generate one extra beyond the visible window so we know whether to show the
  // "Load more" control without a second pass.
  const occurrences = useMemo<ServiceRowOccurrence[]>(() => {
    if (!row) return [];
    return generateServiceRowOccurrences({
      row,
      fromDate: searchStart || undefined,
      toDate: searchEnd || undefined,
      limit: visibleCount + 1,
      exceptions: exceptionsByKey,
    });
  }, [row, searchStart, searchEnd, visibleCount, exceptionsByKey]);

  // The repeat interval (in bookings) implied by the chosen pattern, or null when
  // a custom value is invalid. Drives both the live preview and Step 3's mapping.
  const resolvedInterval = intervalForPattern(patternKind, customInterval);

  // Live preview of the next occurrences the variation would apply to, anchored
  // to the selected booking. Reuses the shared generator (no duplicate logic):
  // generate forward from the anchor date, then keep only occurrences that match
  // `index >= anchor && (index - anchor) % interval === 0` — the same rule the
  // resolver's matcher uses for anchored variations.
  const previewOccurrences = useMemo<ServiceRowOccurrence[]>(() => {
    if (!row || !anchor || resolvedInterval == null) return [];
    const anchorIdx = anchor.occurrenceIndex;
    const generated = generateServiceRowOccurrences({
      row,
      fromDate: anchor.occurrenceDate,
      limit: resolvedInterval * PREVIEW_MATCH_COUNT + resolvedInterval,
      exceptions: exceptionsByKey,
    });
    return generated
      .filter(
        (o) =>
          o.occurrenceIndex >= anchorIdx &&
          (o.occurrenceIndex - anchorIdx) % resolvedInterval === 0,
      )
      .slice(0, PREVIEW_MATCH_COUNT);
  }, [row, anchor, resolvedInterval, exceptionsByKey]);

  const hasMore = occurrences.length > visibleCount;
  const visible = occurrences.slice(0, visibleCount);
  const selected = visible.find((o) => o.occurrenceKey === selectedKey) ?? null;

  if (!row) return null;

  const employeesLabel = (occ: ServiceRowOccurrence): string => {
    const names = occ.assignedEmployeeIds.map((id) => employeeNameById.get(id) ?? "Unknown");
    const slots = occ.unassignedEmployeeSlots;
    const parts: string[] = [...names];
    if (slots > 0) parts.push(slots === 1 ? "1 unassigned slot" : `${slots} unassigned slots`);
    return parts.length > 0 ? parts.join(", ") : "Unassigned";
  };

  const companyEmployees = employees.filter(
    (e) => e.companyId === order.companyId && e.status === "active",
  );
  const baseOpenSlots = normalizeUnassignedSlots(row.unassignedEmployeeSlots);
  const baseAssignedIds = row.assignedEmployeeIds ?? [];

  const toggleConfigEmployee = (id: string): void => {
    setConfig((c) => ({
      ...c,
      assignedEmployeeIds: c.assignedEmployeeIds.includes(id)
        ? c.assignedEmployeeIds.filter((x) => x !== id)
        : [...c.assignedEmployeeIds, id],
    }));
  };

  // Seeds Step 3 with the anchor's current values so "unchanged" is the default.
  // Staffing defaults to "same"; the selected crew is pre-filled from the anchor
  // so switching to "Specific people" starts from the current assignment.
  const goToConfigure = (): void => {
    if (!anchor) return;
    setConfig((c) => ({
      ...c,
      startTime: c.startTime || anchor.startTime || "",
      endTime: c.endTime || anchor.endTime || "",
      assignedEmployeeIds:
        c.assignedEmployeeIds.length > 0 ? c.assignedEmployeeIds : [...anchor.assignedEmployeeIds],
    }));
    setStep(3);
  };

  /**
   * Maps the collected wizard state to a {@link VariationSaveInput}. Anchored to
   * the selected booking via `anchorOccurrenceIndex` (Step 1) with an occurrence
   * interval (Step 2). Only fields the admin actually changed are emitted as
   * overrides; time is the source of truth for duration (no duration field).
   */
  const buildWizardInput = (): VariationSaveInput | null => {
    if (!anchor || resolvedInterval == null) return null;
    const startTime = config.startTime.trim();
    const endTime = config.endTime.trim();
    const timeChanged =
      (startTime !== "" && startTime !== (anchor.startTime ?? "")) ||
      (endTime !== "" && endTime !== (anchor.endTime ?? ""));
    // Map the operational staffing choice onto the engine's override fields.
    const staffing = staffingOverrideFromMode({
      mode: config.staffingMode,
      count: Number.parseInt(config.staffingCount, 10) || 0,
      assignedEmployeeIds: config.assignedEmployeeIds,
    });
    return {
      name: config.name.trim(),
      type: config.type === NO_TYPE ? undefined : (config.type as VariationType),
      status: "active",
      frequency: "every_n_visits",
      interval: resolvedInterval,
      anchorOccurrenceIndex: anchor.occurrenceIndex,
      // Bound the variation to start no earlier than the anchor's date as well as
      // its index, so it never resolves onto earlier bookings.
      appliesFrom: anchor.occurrenceDate,
      startTime: timeChanged && startTime ? startTime : undefined,
      endTime: timeChanged && endTime ? endTime : undefined,
      assignedEmployeeIds: staffing.assignedEmployeeIds,
      unassignedSlotsDelta: staffing.unassignedSlotsDelta,
      internalNote: config.internalNote.trim() || undefined,
    };
  };

  /** Candidate variation built from input for overlap evaluation. */
  const candidateFromInput = (input: VariationSaveInput): RecurringVariation => {
    const nowIso = new Date().toISOString();
    return {
      ...input,
      id: "__candidate__",
      enabled: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  };

  const commitSave = (input: VariationSaveInput): void => {
    const res = addServiceRowVariation(order.id, row.id, input);
    if (!res.ok) {
      toast({ title: "Unable to save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Variation added", description: `“${input.name}” is now active.` });
    onClose();
  };

  const handleSave = (): void => {
    const input = buildWizardInput();
    if (!input) return;
    if (!input.name.trim()) {
      toast({
        title: "Name required",
        description: "Give the variation a name before saving.",
        variant: "destructive",
      });
      return;
    }
    const variations = row.variations ?? [];
    const series: VariationOverlapSeries = {
      serviceDate: row.serviceDate,
      recurrenceInterval: row.recurrenceInterval ?? null,
      serviceEndDate: row.serviceEndDate ?? null,
      variations,
      startTime: row.plannedStartTime ?? null,
      endTime: row.plannedEndTime ?? null,
      durationMinutes: calculatePlannedDurationMinutes(
        row.plannedStartTime,
        row.plannedEndTime,
      ),
    };
    const result = evaluateVariationConflict({
      series,
      candidate: candidateFromInput(input),
      existingVariations: variations,
    });
    if (result.kind === "conflict") {
      setPendingInput(input);
      setConflict(result);
      return;
    }
    commitSave(input);
  };

  const handleCancelConflict = (): void => {
    setConflict(null);
    setPendingInput(null);
  };

  const handleChainVariation = (): void => {
    if (pendingInput) commitSave(pendingInput);
    setConflict(null);
    setPendingInput(null);
  };

  const handleReplaceVariation = (): void => {
    if (!pendingInput || !conflict) return;
    const res = replaceServiceRowVariation(order.id, row.id, {
      variationId: null,
      input: pendingInput,
      replacedVariationIds: conflict.overlappingVariationIds,
    });
    if (!res.ok) {
      toast({ title: "Unable to replace", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Variation saved",
      description:
        conflict.overlapCount === 1
          ? "The overlapping variation was archived."
          : `${conflict.overlapCount} overlapping variations were archived.`,
    });
    setConflict(null);
    setPendingInput(null);
    onClose();
  };

  return (
    <>
    <Dialog open={row != null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === 1
              ? "New variation · Select start booking"
              : step === 2
                ? "New variation · Define pattern"
                : "New variation · Configure changes"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `Choose the upcoming booking for “${row.serviceName}” that this variation should start from. It will be anchored to that booking.`
              : step === 2
                ? "Choose how often this variation repeats. Intervals are counted in bookings, not weeks."
                : "Set what changes on the matched bookings, then review and save."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {step}
            </span>
            <span>
              {step === 1
                ? "Step 1 of 3 · Select start booking"
                : step === 2
                  ? "Step 2 of 3 · Define pattern"
                  : "Step 3 of 3 · Configure changes"}
            </span>
          </div>

          {step === 1 ? (
          <>
          <div className="grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Search from" hint="Defaults to today">
              <Input
                type="date"
                value={searchStart}
                max={searchEnd || undefined}
                onChange={(e) => {
                  setSearchStart(e.target.value);
                  setVisibleCount(DEFAULT_OCCURRENCE_LIMIT);
                }}
              />
            </Field>
            <Field label="Search until" hint="Optional">
              <Input
                type="date"
                value={searchEnd}
                min={searchStart || undefined}
                onChange={(e) => {
                  setSearchEnd(e.target.value);
                  setVisibleCount(DEFAULT_OCCURRENCE_LIMIT);
                }}
              />
            </Field>
            {searchStart || searchEnd ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchStart("");
                  setSearchEnd("");
                  setVisibleCount(DEFAULT_OCCURRENCE_LIMIT);
                }}
              >
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <CalendarClock className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium">No upcoming bookings found.</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {searchStart || searchEnd
                  ? "No occurrences fall in this date range. Try widening the search."
                  : "This service has no upcoming occurrences to anchor a variation to."}
              </p>
            </div>
          ) : (
            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {visible.map((occ) => {
                const isSelected = occ.occurrenceKey === selectedKey;
                const isCancelled = occ.status === "cancelled";
                return (
                  <button
                    key={occ.occurrenceKey}
                    type="button"
                    disabled={isCancelled}
                    onClick={() => setSelectedKey(occ.occurrenceKey)}
                    className={
                      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors " +
                      (isCancelled
                        ? "cursor-not-allowed border-border bg-muted/40 opacity-70"
                        : isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-primary/50")
                    }
                  >
                    <span
                      className={
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border " +
                        (isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40")
                      }
                    >
                      {isSelected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {formatDate(occ.displayDate)}
                        </span>
                        {occ.isVariation ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            <Repeat className="mr-1 h-3 w-3" /> Variation
                          </Badge>
                        ) : null}
                        {isCancelled ? (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 bg-destructive/10 text-destructive"
                          >
                            Cancelled
                          </Badge>
                        ) : null}
                        {occ.status === "rescheduled" ? (
                          <Badge variant="secondary">Rescheduled</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Clock className="h-3 w-3" />
                          {occ.startTime && occ.endTime
                            ? `${occ.startTime}–${occ.endTime}`
                            : "No time"}
                        </span>
                        <span>
                          Time:{" "}
                          <span className="font-medium text-foreground">
                            {occ.visitMinutes != null ? formatDuration(occ.visitMinutes) : "—"}
                          </span>
                        </span>
                        <span>
                          Total Time:{" "}
                          <span className="font-medium text-foreground">
                            {occ.labourMinutes != null ? formatDuration(occ.labourMinutes) : "—"}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {employeesLabel(occ)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
              {hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setVisibleCount((c) => c + DEFAULT_OCCURRENCE_LIMIT)}
                >
                  Load more bookings
                </Button>
              ) : null}
            </div>
          )}
          </>
          ) : step === 2 ? (
            <VariationPatternStep
              anchor={anchor}
              patternKind={patternKind}
              onPatternKindChange={setPatternKind}
              customInterval={customInterval}
              onCustomIntervalChange={setCustomInterval}
              resolvedInterval={resolvedInterval}
              previewOccurrences={previewOccurrences}
              employeesLabel={employeesLabel}
            />
          ) : (
            <VariationConfigureStep
              anchor={anchor}
              resolvedInterval={resolvedInterval}
              previewOccurrences={previewOccurrences}
              companyEmployees={companyEmployees}
              baseOpenSlots={baseOpenSlots}
              baseAssignedIds={baseAssignedIds}
              config={config}
              onConfigChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
              onToggleEmployee={toggleConfigEmployee}
              employeeNameById={employeeNameById}
              employeesLabel={employeesLabel}
            />
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            {step === 1 ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {selected ? (
                    <>
                      Anchored to{" "}
                      <span className="font-medium text-foreground">
                        {formatDate(selected.displayDate)}
                      </span>{" "}
                      (booking #{selected.occurrenceIndex + 1} in the series).
                    </>
                  ) : (
                    "Select a booking to anchor the variation."
                  )}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!selected}
                    onClick={() => {
                      if (!selected) return;
                      setAnchor(selected);
                      setStep(2);
                    }}
                  >
                    Next: Define pattern
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : step === 2 ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {resolvedInterval == null
                    ? "Enter how many bookings between each repeat."
                    : previewOccurrences.length === 0
                      ? "This pattern produces no upcoming bookings."
                      : `Applies to ${
                          resolvedInterval === 1
                            ? "every booking"
                            : `every ${ordinal(resolvedInterval)} booking`
                        } from the selected start.`}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    disabled={resolvedInterval == null || previewOccurrences.length === 0}
                    onClick={goToConfigure}
                  >
                    Next: Configure
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {config.name.trim()
                    ? "Review the summary, then save this variation."
                    : "Name the variation to save it."}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    disabled={!config.name.trim() || previewOccurrences.length === 0}
                    onClick={handleSave}
                  >
                    Save variation
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={conflict != null}
      onOpenChange={(o) => (!o ? handleCancelConflict() : undefined)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Variation Conflict Detected</AlertDialogTitle>
          <AlertDialogDescription>
            This variation overlaps with one or more existing variations.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {conflict ? (
          <div className="space-y-3">
            {conflict.hasScheduleConflict ? (
              <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  One or more overlapping variations affect the same occurrence
                  and have overlapping time windows.
                </p>
              </div>
            ) : (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  The variations affect the same occurrence but do not overlap
                  in time.
                </p>
              </div>
            )}

            <ul className="max-h-52 space-y-2 overflow-y-auto">
              {conflict.overlaps.map((o) => {
                const hasSchedule = o.scheduleConflictDates.length > 0;
                const first = o.overlapDates[0];
                return (
                  <li
                    key={o.variation.id}
                    className="rounded-lg border border-border bg-muted/40 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.variation.name}</span>
                      <Badge variant="outline" className="text-muted-foreground">
                        {variationFrequencyText(o.variation)}
                      </Badge>
                      {hasSchedule ? (
                        <Badge
                          variant="outline"
                          className="border-destructive/50 text-destructive"
                        >
                          Time clash
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      First overlap: {first ? formatDate(first) : "—"} ·{" "}
                      {o.overlapDates.length} overlapping occurrence
                      {o.overlapDates.length === 1 ? "" : "s"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel onClick={handleCancelConflict}>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={handleChainVariation}>
            Chain variation
          </Button>
          <AlertDialogAction onClick={handleReplaceVariation}>
            Replace existing variation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function ManageVariationsDialog({
  order,
  row,
  onClose,
}: {
  order: WorkOrder;
  row: WorkOrderServiceRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const {
    employees,
    addServiceRowVariation,
    updateServiceRowVariation,
    replaceServiceRowVariation,
    setServiceRowVariationStatus,
  } = useApp();

  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<VariationSortKey>("status");
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<VariationDraft>(emptyVariationDraft());
  // Overlap conflict awaiting an admin decision (chain / replace / cancel), plus
  // the pending input captured at save time so the chosen action can persist it.
  const [conflict, setConflict] = useState<VariationConflict | null>(null);
  const [pendingInput, setPendingInput] = useState<VariationSaveInput | null>(null);
  // Whether the optional "Internal notes" area is expanded in the editor.
  const [showNotes, setShowNotes] = useState<boolean>(false);

  useEffect(() => {
    if (!row) {
      setEditing(null);
      setShowArchived(false);
    }
  }, [row]);

  const companyEmployees = useMemo(
    () => employees.filter((e) => e.companyId === order.companyId && e.status === "active"),
    [employees, order.companyId],
  );

  if (!row) return null;

  const variations = row.variations ?? [];
  const visible = variations
    .filter((v) => showArchived || getVariationStatus(v) !== "archived")
    .sort((a, b) => {
      switch (sortKey) {
        case "start":
          return (a.appliesFrom ?? "").localeCompare(b.appliesFrom ?? "") ||
            a.createdAt.localeCompare(b.createdAt);
        case "end":
          // Indefinite (no end date) sorts last.
          return (a.appliesUntil || "9999-99-99").localeCompare(b.appliesUntil || "9999-99-99") ||
            a.createdAt.localeCompare(b.createdAt);
        case "status":
        default:
          return (
            VARIATION_STATUS_ORDER[getVariationStatus(a)] -
              VARIATION_STATUS_ORDER[getVariationStatus(b)] ||
            a.createdAt.localeCompare(b.createdAt)
          );
      }
    });

  const startNew = () => {
    setDraft(emptyVariationDraft());
    setShowNotes(false);
    setEditing("new");
  };

  const startEdit = (v: RecurringVariation) => {
    setDraft(draftFromVariation(v));
    // Expand the notes area up-front when there's existing content to show.
    setShowNotes(Boolean(v.internalNote?.trim() || v.reason?.trim()));
    setEditing(v.id);
  };

  const buildInput = (): VariationSaveInput => {
    const isMonthly = draft.frequency === "nth_weekday_of_month";
    const staffing = staffingOverrideFromMode({
      mode: draft.staffingMode,
      count: Number.parseInt(draft.staffingCount, 10) || 0,
      assignedEmployeeIds: draft.assignedEmployeeIds,
    });
    return {
      name: draft.name,
      type: draft.type === NO_TYPE ? undefined : (draft.type as VariationType),
      status: draft.status,
      appliesFrom: draft.appliesFrom.trim() || undefined,
      appliesUntil: draft.appliesUntil.trim() || undefined,
      frequency: draft.frequency,
      interval: isMonthly ? undefined : numOrUndefined(draft.interval),
      weekOfMonth: isMonthly ? numOrUndefined(draft.weekOfMonth) : undefined,
      weekday: isMonthly ? (draft.weekday as WeekDay) : undefined,
      day: draft.day === NO_OVERRIDE ? undefined : (draft.day as WeekDay),
      startTime: draft.startTime.trim() || undefined,
      endTime: draft.endTime.trim() || undefined,
      durationMinutes: numOrUndefined(draft.durationMinutes),
      // Legacy field preserved untouched (no longer edited in the UI).
      employeeCount: numOrUndefined(draft.employeeCount),
      assignedEmployeeIds: staffing.assignedEmployeeIds,
      unassignedSlotsDelta: staffing.unassignedSlotsDelta,
      internalNote: draft.internalNote.trim() || undefined,
      // Legacy free-text reason preserved untouched (folded into notes in the UI).
      reason: draft.reason.trim() || undefined,
    };
  };

  /** Builds a candidate variation from the current input for overlap evaluation. */
  const candidateFromInput = (input: VariationSaveInput): RecurringVariation => {
    const nowIso = new Date().toISOString();
    return {
      ...input,
      id: editing && editing !== "new" ? editing : "__candidate__",
      enabled: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  };

  /** Persists the input as a plain add/update (used directly and by Chain). */
  const commitSave = (input: VariationSaveInput): void => {
    const res =
      editing === "new"
        ? addServiceRowVariation(order.id, row.id, input)
        : updateServiceRowVariation(order.id, row.id, editing as string, input);
    if (!res.ok) {
      toast({ title: "Unable to save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: editing === "new" ? "Variation added" : "Variation updated" });
    setEditing(null);
  };

  const save = () => {
    if (!draft.name.trim()) {
      toast({ title: "Name required", description: "Give the variation a name.", variant: "destructive" });
      return;
    }
    if (
      draft.appliesFrom &&
      draft.appliesUntil &&
      draft.appliesUntil < draft.appliesFrom
    ) {
      toast({
        title: "Invalid validity period",
        description: "The end date cannot be before the start date.",
        variant: "destructive",
      });
      return;
    }
    const input = buildInput();
    // Detect overlap with existing variations before committing. The series is
    // anchored to the row's start/recurrence so detection never drifts.
    const series: VariationOverlapSeries = {
      serviceDate: row.serviceDate,
      recurrenceInterval: row.recurrenceInterval ?? null,
      serviceEndDate: row.serviceEndDate ?? null,
      variations,
      startTime: row.plannedStartTime ?? null,
      endTime: row.plannedEndTime ?? null,
      durationMinutes: calculatePlannedDurationMinutes(
        row.plannedStartTime,
        row.plannedEndTime,
      ),
    };
    const result = evaluateVariationConflict({
      series,
      candidate: candidateFromInput(input),
      existingVariations: variations,
    });
    if (result.kind === "conflict") {
      setPendingInput(input);
      setConflict(result);
      return;
    }
    commitSave(input);
  };

  const handleCancelConflict = () => {
    setConflict(null);
    setPendingInput(null);
  };

  /** Chain: save the new variation and keep the existing overlapping ones. */
  const handleChainVariation = () => {
    if (pendingInput) commitSave(pendingInput);
    setConflict(null);
    setPendingInput(null);
  };

  /** Replace: archive/supersede the overlapping variations, then save the new one. */
  const handleReplaceVariation = () => {
    if (!pendingInput || !conflict) return;
    const res = replaceServiceRowVariation(order.id, row.id, {
      variationId: editing === "new" ? null : (editing as string),
      input: pendingInput,
      replacedVariationIds: conflict.overlappingVariationIds,
    });
    if (!res.ok) {
      toast({ title: "Unable to replace", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Variation saved",
      description:
        conflict.overlapCount === 1
          ? "The overlapping variation was archived."
          : `${conflict.overlapCount} overlapping variations were archived.`,
    });
    setConflict(null);
    setPendingInput(null);
    setEditing(null);
  };

  const changeStatus = (v: RecurringVariation, status: VariationStatus) => {
    if (getVariationStatus(v) === status) return;
    const res = setServiceRowVariationStatus(order.id, row.id, v.id, status);
    if (!res.ok) {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Variation set to ${VARIATION_STATUS_LABELS[status]}` });
  };

  const toggleEmployee = (id: string) => {
    setDraft((d) => ({
      ...d,
      assignedEmployeeIds: d.assignedEmployeeIds.includes(id)
        ? d.assignedEmployeeIds.filter((x) => x !== id)
        : [...d.assignedEmployeeIds, id],
    }));
  };

  const isMonthly = draft.frequency === "nth_weekday_of_month";

  return (
    <>
    <Dialog open={row != null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Recurring variations</DialogTitle>
          <DialogDescription>
            Planned recurring differences from the default schedule for “{row.serviceName}”. These
            are not one-off manual changes. Scheduling automation is added later.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {/* Basics */}
            <div className="space-y-4 rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Basic information
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Variation name" hint="Shown in the service list and booking lists">
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Deep clean"
                  />
                </Field>
                <Field label="Type" hint="Informational only — does not affect scheduling">
                  <Select
                    value={draft.type}
                    onValueChange={(v) => setDraft({ ...draft, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TYPE}>No type</SelectItem>
                      {VARIATION_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Status" hint="Drafts are ignored by scheduling">
                  <Select
                    value={draft.status}
                    onValueChange={(v) => setDraft({ ...draft, status: v as VariationStatus })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VARIATION_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Applies from" hint="Optional">
                  <Input
                    type="date"
                    value={draft.appliesFrom}
                    max={draft.appliesUntil || undefined}
                    onChange={(e) => setDraft({ ...draft, appliesFrom: e.target.value })}
                  />
                </Field>
                <Field label="Applies until" hint="Empty = no end">
                  <Input
                    type="date"
                    value={draft.appliesUntil}
                    min={draft.appliesFrom || undefined}
                    onChange={(e) => setDraft({ ...draft, appliesUntil: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            {/* Repeat pattern */}
            <div className="space-y-4 rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Repeat pattern
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How often?">
                  <Select
                    value={draft.frequency}
                    onValueChange={(v) =>
                      setDraft({ ...draft, frequency: v as RecurringVariationFrequency })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRING_VARIATION_FREQUENCIES.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {!isMonthly ? (
                  <Field
                    label={
                      draft.frequency === "every_n_weeks"
                        ? "Repeat every (weeks)"
                        : "Repeat every (visits)"
                    }
                    hint={
                      draft.frequency === "every_n_weeks"
                        ? "e.g. 4 = applies on the same weekday every 4th week"
                        : "e.g. 3 = applies to every 3rd booking"
                    }
                  >
                    <Input
                      type="number"
                      min="1"
                      value={draft.interval}
                      onChange={(e) => setDraft({ ...draft, interval: e.target.value })}
                    />
                  </Field>
                ) : null}
              </div>
              {isMonthly ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Which week?">
                    <Select
                      value={draft.weekOfMonth}
                      onValueChange={(v) => setDraft({ ...draft, weekOfMonth: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEK_OF_MONTH_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Which weekday?" hint="e.g. the first Monday of each month">
                    <Select
                      value={draft.weekday}
                      onValueChange={(v) => setDraft({ ...draft, weekday: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEK_DAYS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              ) : null}
            </div>

            {/* Changes to the booking */}
            <div className="space-y-4 rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Changes to the booking{" "}
                <span className="font-normal normal-case">(optional)</span>
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start time">
                  <TimePicker
                    value={draft.startTime}
                    onChange={(v) => setDraft({ ...draft, startTime: v })}
                  />
                </Field>
                <Field label="End time">
                  <TimePicker
                    value={draft.endTime}
                    onChange={(v) => setDraft({ ...draft, endTime: v })}
                  />
                </Field>
                <Field label="Day" hint="Move this booking to a different weekday">
                  <Select value={draft.day} onValueChange={(v) => setDraft({ ...draft, day: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_OVERRIDE}>Same as usual</SelectItem>
                      {WEEK_DAYS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Duration (minutes)" hint="Leave empty to use the time window">
                  <Input
                    type="number"
                    min="0"
                    value={draft.durationMinutes}
                    onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            {/* Staffing */}
            <div className="space-y-3 rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Staffing
              </p>
              <StaffingSection
                mode={draft.staffingMode}
                count={draft.staffingCount}
                assignedEmployeeIds={draft.assignedEmployeeIds}
                companyEmployees={companyEmployees}
                baseAssignedIds={row.assignedEmployeeIds ?? []}
                baseOpenSlots={normalizeUnassignedSlots(row.unassignedEmployeeSlots)}
                onModeChange={(m) => setDraft({ ...draft, staffingMode: m })}
                onCountChange={(v) => setDraft({ ...draft, staffingCount: v })}
                onToggleEmployee={toggleEmployee}
              />
            </div>

            {/* Advanced / internal notes */}
            <div className="rounded-xl border border-border bg-background p-4">
              {showNotes ? (
                <Field
                  label="Internal notes"
                  hint="Admin-only — not shown to customers (optional)"
                >
                  <Textarea
                    value={draft.internalNote}
                    onChange={(e) => setDraft({ ...draft, internalNote: e.target.value })}
                    placeholder="Bring extra equipment; customer prefers afternoons."
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowNotes(true)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-4 w-4" /> Add internal notes
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save}>{editing === "new" ? "Add variation" : "Save changes"}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={showArchived} onCheckedChange={setShowArchived} />
                  Show archived
                </label>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Sort by</Label>
                  <Select value={sortKey} onValueChange={(v) => setSortKey(v as VariationSortKey)}>
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status">Status</SelectItem>
                      <SelectItem value="start">Start date</SelectItem>
                      <SelectItem value="end">End date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={startNew}>
                <Plus className="h-4 w-4" /> Add variation
              </Button>
            </div>

            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Repeat className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">No recurring variations yet.</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Add a planned recurring difference, e.g. “Every 4th week” or “First Monday of
                  every month”.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((v) => {
                  const overrides = variationOverrideText(v);
                  const status = getVariationStatus(v);
                  const state = getVariationDisplayState(v);
                  const validity = formatValidity(v);
                  return (
                    <li
                      key={v.id}
                      className={
                        "rounded-xl border border-border bg-card p-4" +
                        (status === "archived" || status === "inactive" || status === "draft"
                          ? " opacity-60"
                          : "")
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{v.name}</span>
                            <VariationStateBadge state={state} />
                            <Badge variant="outline" className="text-muted-foreground">
                              {variationFrequencyText(v)}
                            </Badge>
                            {v.type ? (
                              <Badge variant="secondary">
                                {VARIATION_TYPE_LABELS[v.type]}
                              </Badge>
                            ) : null}
                          </div>
                          {validity ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">Valid:</span> {validity}
                            </p>
                          ) : null}
                          {overrides.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              {overrides.map((o, i) => (
                                <span key={i}>{o}</span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">No overrides set.</p>
                          )}
                          {v.reason ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">Reason:</span> {v.reason}
                            </p>
                          ) : null}
                          {v.internalNote ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">Internal:</span>{" "}
                              {v.internalNote}
                            </p>
                          ) : null}
                          {v.notes ? (
                            <p className="mt-1 text-xs text-muted-foreground">{v.notes}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {status !== "archived" ? (
                            <>
                              <Select
                                value={status}
                                onValueChange={(s) => changeStatus(v, s as VariationStatus)}
                              >
                                <SelectTrigger className="h-8 w-[110px]" aria-label="Status">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {VARIATION_STATUSES.map((s) => (
                                    <SelectItem key={s.value} value={s.value}>
                                      {s.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="sm" onClick={() => startEdit(v)} aria-label="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => changeStatus(v, "active")} aria-label="Restore">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

      <AlertDialog
        open={conflict != null}
        onOpenChange={(o) => (!o ? handleCancelConflict() : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Variation Conflict Detected</AlertDialogTitle>
            <AlertDialogDescription>
              This variation overlaps with one or more existing variations.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {conflict ? (
            <div className="space-y-3">
              {conflict.hasScheduleConflict ? (
                <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    One or more overlapping variations affect the same occurrence
                    and have overlapping time windows.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    The variations affect the same occurrence but do not overlap
                    in time.
                  </p>
                </div>
              )}

              <ul className="max-h-52 space-y-2 overflow-y-auto">
                {conflict.overlaps.map((o) => {
                  const hasSchedule = o.scheduleConflictDates.length > 0;
                  const first = o.overlapDates[0];
                  return (
                    <li
                      key={o.variation.id}
                      className="rounded-lg border border-border bg-muted/40 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{o.variation.name}</span>
                        <Badge variant="outline" className="text-muted-foreground">
                          {variationFrequencyText(o.variation)}
                        </Badge>
                        {hasSchedule ? (
                          <Badge
                            variant="outline"
                            className="border-destructive/50 text-destructive"
                          >
                            Time clash
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        First overlap: {first ? formatDate(first) : "—"} ·{" "}
                        {o.overlapDates.length} overlapping occurrence
                        {o.overlapDates.length === 1 ? "" : "s"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel onClick={handleCancelConflict}>
              Cancel
            </AlertDialogCancel>
            <Button variant="outline" onClick={handleChainVariation}>
              Chain variation
            </Button>
            <AlertDialogAction onClick={handleReplaceVariation}>
              Replace existing variation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─────────────────────────────────────────────
// Notes tab
// ─────────────────────────────────────────────

/**
 * The Services-workspace notes header: Customer, Work Order and Economic notes
 * shown side-by-side. Each card edits its single source of truth directly —
 * Customer & Economic notes live on the customer card (`cardNotes`, types
 * "admin"/"finance"); Work Order notes live on the work order. No copies are
 * synced. Per-service-row "Schedule notes" are edited on the rows themselves.
 */
export function WorkOrderNotesSection({
  order,
  customer,
}: {
  order: WorkOrder;
  customer: Customer | null | undefined;
}) {
  const { toast } = useToast();
  const {
    currentUser,
    hasPermission,
    hydrateCustomerFromRemote,
    addWorkOrderNote,
    updateWorkOrderNote,
    setWorkOrderNoteArchived,
  } = useApp();
  const customerMutations = useCustomerMutations({
    companyId: customer?.companyId,
    canCreateCustomers: false,
    canEditCustomers: hasPermission("customers.edit"),
  });

  const cardNotes = customer?.cardNotes ?? [];
  const customerNotes = cardNotes.filter((n) => n.type === "admin");
  const economicNotes = cardNotes.filter((n) => n.type === "finance");
  const workOrderNotes = order.notes ?? [];

  /** Add/update/archive helpers that persist the whole customer `cardNotes` array via Supabase. */
  const persistCardNotes = async (next: CustomerCardNote[]): Promise<boolean> => {
    if (!customer?.id || !customer.companyId) {
      const message = "Customer note save requires customer and company context.";
      toast({ title: "Unable to save note", description: message, variant: "destructive" });
      throw new Error(message);
    }
    try {
      const updated = await customerMutations.updateCustomer({
        customerId: customer.id,
        companyId: customer.companyId,
        patch: withCustomerCardLog(customer, { cardNotes: next }, currentUser),
      });
      hydrateCustomerFromRemote(updated);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save note.";
      toast({ title: "Unable to save note", description: message, variant: "destructive" });
      throw new Error(message);
    }
  };

  const addCardNote = (type: CustomerCardNoteType) => (draft: { title: string; content: string }) => {
    const now = new Date().toISOString();
    const note: CustomerCardNote = {
      id: makeId("cnote"),
      type,
      title: draft.title.trim() || "Untitled note",
      content: draft.content.trim(),
      authorId: currentUser?.id ?? null,
      authorName: currentUser?.name ?? "Admin",
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    return persistCardNotes([note, ...cardNotes]);
  };

  const updateCardNote = (id: string, draft: { title: string; content: string }) => {
    const now = new Date().toISOString();
    return persistCardNotes(
      cardNotes.map((n) =>
        n.id === id
          ? { ...n, title: draft.title.trim() || "Untitled note", content: draft.content.trim(), updatedAt: now }
          : n,
      ),
    );
  };

  const setCardNoteArchived = (id: string, archived: boolean) => {
    const now = new Date().toISOString();
    return persistCardNotes(
      cardNotes.map((n) =>
        n.id === id ? { ...n, status: archived ? "inactive" : "active", updatedAt: now } : n,
      ),
    );
  };

  const addWoNote = (draft: { title: string; content: string }): boolean => {
    const res = addWorkOrderNote(order.id, draft);
    if (!res.ok) {
      toast({ title: "Unable to add note", description: res.error, variant: "destructive" });
      return false;
    }
    return true;
  };

  const updateWoNote = (id: string, draft: { title: string; content: string }): boolean => {
    const res = updateWorkOrderNote(order.id, id, draft);
    if (!res.ok) {
      toast({ title: "Unable to save note", description: res.error, variant: "destructive" });
      return false;
    }
    return true;
  };

  const setWoNoteArchived = (id: string, archived: boolean): boolean => {
    const res = setWorkOrderNoteArchived(order.id, id, archived);
    if (!res.ok) {
      toast({ title: "Unable to save note", description: res.error, variant: "destructive" });
      return false;
    }
    return true;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <NotesCard
        title="Customer Notes"
        icon={Building2}
        description="General info that applies across all of this customer's work orders."
        notes={customerNotes}
        emptyHint="No customer notes yet."
        onAdd={addCardNote("admin")}
        onUpdate={updateCardNote}
        onArchive={(id) => setCardNoteArchived(id, true)}
        onRestore={(id) => setCardNoteArchived(id, false)}
      />
      <NotesCard
        title="Work Order Notes"
        icon={StickyNote}
        description="Specific to this work order — not shared with the customer's other orders."
        notes={workOrderNotes}
        emptyHint="No work order notes yet."
        onAdd={addWoNote}
        onUpdate={updateWoNote}
        onArchive={(id) => setWoNoteArchived(id, true)}
        onRestore={(id) => setWoNoteArchived(id, false)}
      />
      <NotesCard
        title="Economic Notes"
        icon={Wallet}
        description="Pricing, discounts and billing arrangements. Stored on the customer."
        notes={economicNotes}
        emptyHint="No economic notes yet."
        onAdd={addCardNote("finance")}
        onUpdate={updateCardNote}
        onArchive={(id) => setCardNoteArchived(id, true)}
        onRestore={(id) => setCardNoteArchived(id, false)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Activity Log tab
// ─────────────────────────────────────────────

function ActivityTab({ order }: { order: WorkOrder }) {
  const events: WorkOrderActivity[] = [...(order.activity ?? [])].sort((a, b) =>
    b.at.localeCompare(a.at),
  );

  if (events.length === 0) {
    return (
      <Section title="Activity log">
        <EmptyHint>No activity recorded yet.</EmptyHint>
      </Section>
    );
  }

  return (
    <Section title="Activity log">
      <ol className="relative space-y-5 border-l border-border pl-5">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
            <p className="text-sm font-medium">{e.summary}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {e.actorName} · {formatDateTime(e.at)}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ─────────────────────────────────────────────
// Shared layout helpers
// ─────────────────────────────────────────────

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground/60">{children}</p>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-sm">
        {children ?? (value ? <span>{value}</span> : <span className="text-muted-foreground/60">—</span>)}
      </div>
    </div>
  );
}
