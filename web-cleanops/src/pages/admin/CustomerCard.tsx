import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Archive,
  Building2,
  CalendarClock,
  ClipboardList,
  FileSignature,
  FileText,
  Hash,
  Inbox,
  Images,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  ScrollText,
  ListChecks,
  Send,
  Star,
  Trash2,
  User,
  UserCog,
  Users,
  Tag,
  Timer,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AccessDenied } from "@/components/AccessDenied";
import { StatusBadge } from "@/components/StatusBadge";
import { WorkOrderStatusBadge, WORK_ORDER_BADGE_CLASS } from "@/components/WorkOrderStatusBadge";
import { WorkOrderServiceStatusBadge } from "@/components/WorkOrderServiceStatusBadge";
import { CustomerSchedulingSummary } from "@/components/customer/CustomerSchedulingSummary";
import { SchedulingPreferencesEditor } from "@/components/customer/SchedulingPreferencesEditor";
import { CustomerMediaLibrary } from "@/components/customer/CustomerMediaLibrary";
import { CustomerProtocolsPanel } from "@/components/customer/CustomerProtocolsPanel";
import { CustomerAgreementsPanel } from "@/components/customer/CustomerAgreementsPanel";
import { MediaImage } from "@/components/media/MediaImage";
import { useCustomerCoverImage } from "@/hooks/use-customer-media-library";
import { useNavigationMenu } from "@/hooks/use-navigation-config-admin";
import { getNavigationIcon } from "@/lib/navigation/iconRegistry";
import { perf } from "@/lib/perf";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useCustomerDetailSource } from "@/hooks/use-customer-detail-source";
import { useCustomerMutations } from "@/hooks/use-customer-mutations";
import { useCustomerProtocolReadModel } from "@/hooks/use-customer-protocol-read-model";
import { useWorkOrderListSource, type WorkOrderListSourceResult } from "@/hooks/use-work-order-list-source";
import { useWorkOrderMutations } from "@/hooks/use-work-order-mutations";
import { useToast } from "@/hooks/use-toast";
import { listFullWorkOrdersFromSupabase } from "@/lib/data/supabaseWorkOrderRepository";
import { formatCurrency, formatDate, formatDateTime, initials } from "@/lib/format";
import { makeId } from "@/lib/store";
import { describeCustomerCardChanges } from "@/lib/customerLog";
import { activeAreas, customerAreaLabel, resolveCustomerArea } from "@/lib/area";
import {
  activePostalCities,
  addressCityLabel,
  postalCityLabel,
  resolveAddressPostalCityId,
  resolvePostalCityArea,
} from "@/lib/postalCity";
import {
  setAgreementResponsible,
  setInvoiceResponsible,
  setPrimaryContact,
} from "@/lib/customerContacts";
import { canAccessArea, isAreaScopeExempt } from "@/lib/areaScope";
import {
  CUSTOMER_CARD_LOG_CHANGE_TYPE_LABELS,
  CUSTOMER_CARD_LOG_SOURCE_LABELS,
  CUSTOMER_CARD_NOTE_TYPES,
  normalizeSchedulingPreferencesV2,
  resolveCustomerCardLogChangeType,
  CUSTOMER_SEGMENT_LABELS,
  CUSTOMER_TYPE_DESCRIPTIONS,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  INVOICE_STATUS_LABELS,
  ROLE_LABELS,
  WORK_ORDER_STATUSES,
} from "@/types";
import { cn } from "@/lib/utils";
import type { SupabaseCustomerUpdatePatch } from "@/lib/data/supabaseCustomerRepository";
import type {
  Customer,
  CustomerAddress,
  CustomerCardLogEntry,
  CustomerCardNote,
  CustomerCardNoteType,
  CustomerContact,
  CustomerSchedulingPreferences,
  CustomerType,
  InvoiceStatus,
  WorkOrder,
  WorkOrderServiceRow,
  WorkOrderStatus,
} from "@/types";

/** Service rows that count as active: not archived and not inactive. */
function activeServiceRows(order: WorkOrder): WorkOrderServiceRow[] {
  return (order.serviceRows ?? []).filter(
    (r) => !r.archived && r.status !== "inactive",
  );
}

/** Counts active customer work orders from the same list source used for rows. */
export function countActiveCustomerWorkOrders(workOrders: WorkOrder[]): number {
  return workOrders.filter((w) => w.status !== "inactive").length;
}

async function verifyCreatedWorkOrderReadableFromSupabase(
  created: WorkOrder,
  companyId: string,
  customerId: string,
): Promise<WorkOrder> {
  const rows = await listFullWorkOrdersFromSupabase(companyId);
  const readable = rows.find(
    (w) => w.id === created.id && w.companyId === companyId && w.customerId === customerId,
  );
  if (!readable) {
    throw new Error(
      "Work order was created, but the Supabase work-order list did not return it yet. Please refresh before creating another work order.",
    );
  }
  return readable;
}

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

/** Select sentinel for "no area assigned" (Radix Select disallows empty values). */
const AREA_NONE = "__none__";
/** Select sentinel for "no postal city assigned". */
const POSTAL_CITY_NONE = "__none__";

interface DraftState {
  name: string;
  email: string;
  phone: string;
  mainContact: string;
  customerType: CustomerType | "";
  /** Selected structured area id, or "" when not assigned. */
  areaId: string;
  /** Selected customer owner (employee) id, or "" when not assigned. */
  ownerId: string;
  /** Selected structured postal city id, or "" when not assigned. */
  postalCityId: string;
  tags: string;
  addresses: CustomerAddress[];
  contacts: CustomerContact[];
}

const CUSTOMER_CARD_VISIBLE_TABS = [
  { value: "contact", label: "Contact", icon: User },
  { value: "work_orders", label: "Work-order", icon: ClipboardList },
  { value: "scheduling", label: "Days & Times", icon: CalendarClock },
  { value: "protocols", label: "Cleaning Protocol", icon: ListChecks },
  { value: "reports", label: "Reports", icon: FileText },
  { value: "invoices", label: "Invoice", icon: Receipt },
  { value: "notes", label: "Notes", icon: FileText },
  { value: "keys", label: "Keys & Alarm", icon: KeyRound },
  { value: "documents", label: "Media", icon: Images },
  { value: "my_request", label: "My Request", icon: Inbox },
  { value: "log", label: "Log", icon: ScrollText },
] as const;

const CUSTOMER_CARD_HIDDEN_TAB_VALUES = ["agreements"] as const;

/**
 * Maps each Customer Card tab `value` (the stable in-page section id used for
 * routing/deep-links and `<TabsContent>`) to its Navigation & Menu registry key
 * (`customer_card.*`). The menu presentation (label / icon / order / visibility)
 * is resolved from the registry + Super-Admin override layer (Slice 11A/11B) and
 * keyed back to these tab values. The tab values themselves are NEVER changed —
 * they remain the authoritative route/section identifiers — so deep links and
 * every tab's behaviour are preserved.
 */
const CUSTOMER_CARD_TAB_TO_REGISTRY_KEY: Record<string, string> = {
  contact: "customer_card.contact",
  work_orders: "customer_card.work_order",
  scheduling: "customer_card.days_times",
  protocols: "customer_card.cleaning_protocol",
  reports: "customer_card.reports",
  invoices: "customer_card.invoice",
  notes: "customer_card.notes",
  keys: "customer_card.keys_alarm",
  documents: "customer_card.media",
  my_request: "customer_card.my_request",
  log: "customer_card.log",
};

/** Reverse of {@link CUSTOMER_CARD_TAB_TO_REGISTRY_KEY}: registry key → tab value. */
const CUSTOMER_CARD_REGISTRY_KEY_TO_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(CUSTOMER_CARD_TAB_TO_REGISTRY_KEY).map(([tab, key]) => [key, tab]),
);

/** A resolved Customer Card menu tile (presentation only; status is applied at render). */
interface CustomerCardNavTab {
  value: string;
  label: string;
  Icon: LucideIcon;
}

/** The hardcoded default menu tiles, used as the resilient fallback when the
 * registry/override layer yields nothing (e.g. a failed/empty fetch). */
const CUSTOMER_CARD_DEFAULT_NAV_TABS: CustomerCardNavTab[] = CUSTOMER_CARD_VISIBLE_TABS.map(
  (t) => ({ value: t.value, label: t.label, Icon: t.icon }),
);

interface CustomerCardNavStatus {
  /** Red setup indicator: the section is expected but missing required setup/info. */
  isMissing?: boolean;
  /** Orange/yellow activity indicator: future unread/new customer requests. */
  needsAttention?: boolean;
  /** Small numeric badge for counts. */
  count?: number;
  /** Show neutral zero for placeholder modules such as My Request. */
  showZeroCount?: boolean;
}

function hasSchedulingPreferenceInfo(preferences: CustomerSchedulingPreferences | undefined): boolean {
  if (!preferences) return false;
  const prefs = normalizeSchedulingPreferencesV2(preferences);
  return Boolean(
    (prefs.preferredRecurringWindows?.length ?? 0) > 0 ||
      (prefs.acceptableRecurringWindows?.length ?? 0) > 0 ||
      (prefs.acceptableTemporaryWindows?.length ?? 0) > 0 ||
      (preferences.preferredDays?.length ?? 0) > 0 ||
      (preferences.secondaryDays?.length ?? 0) > 0 ||
      (preferences.temporaryReschedulingPriority?.length ?? 0) > 0 ||
      (preferences.absencePriority?.length ?? 0) > 0 ||
      preferences.absenceHandling != null ||
      Boolean(prefs.schedulingNotes?.trim()),
  );
}

function hasKeysAlarmInfo(customer: Customer): boolean {
  const candidate = customer as Customer & {
    keysAndAlarm?: unknown;
    keyAlarm?: unknown;
    keyInstructions?: string | null;
    alarmInstructions?: string | null;
  };
  return Boolean(
    candidate.keysAndAlarm != null ||
      candidate.keyAlarm != null ||
      candidate.keyInstructions?.trim() ||
      candidate.alarmInstructions?.trim(),
  );
}

function resolveCustomerCardInitialTab(requestedTab: string | null): string {
  if (requestedTab === "time_bank" || requestedTab === "time-reports" || requestedTab === "time_reports") {
    return "reports";
  }

  const visible = CUSTOMER_CARD_VISIBLE_TABS.some((tab) => tab.value === requestedTab);
  const hidden = CUSTOMER_CARD_HIDDEN_TAB_VALUES.some((value) => value === requestedTab);
  return visible || hidden ? requestedTab ?? "contact" : "contact";
}

/**
 * Admin-facing Customer Card with tab-based navigation. Company Admins reach
 * this by clicking a customer name in the Customers list. Access is scoped:
 * Company Admins see only their own company's customers, Super Admins see all.
 */
export default function CustomerCard() {
  // Dev-only render accounting (no-op in production).
  perf.count("CustomerCard.render");
  const { customerId } = useParams<{ customerId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    currentUser,
    customers,
    companies,
    areas,
    areaScopedAccessEnabled,
    getCustomerWorkOrders,
    getCustomerInvoices,
    getUserPermissions,
    hydrateCustomerFromRemote,
  } = useApp();

  const localCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId],
  );

  // Wave 1C (P4G): the DETAIL read source. With the feature flag off (default)
  // this is exactly `localCustomer`; with it on it reads from Supabase via the
  // repository seam. Empty/missing Supabase data renders absence, not local fallback.
  // Super Admins read unscoped; company users are scoped to their company.
  const detailScope =
    currentUser?.role === "super_admin" ? undefined : currentUser?.companyId ?? undefined;
  const { customer, loading: customerLoading } = useCustomerDetailSource(localCustomer, customerId, detailScope);

  // In-memory bridge only: a Supabase-only customer is copied into React state so
  // current-session action/access seams can find it, but it is not persisted to
  // browser storage and is not mirrored back to Supabase.
  useEffect(() => {
    if (customer && !localCustomer) {
      hydrateCustomerFromRemote(customer);
    }
  }, [customer, localCustomer, hydrateCustomerFromRemote]);

  // Allow deep-linking to a tab via `?tab=` (e.g. "Open Protocol" from a work
  // order lands on the protocols workspace). Falls back to Contact.
  const requestedTab = searchParams.get("tab");
  const initialTab = resolveCustomerCardInitialTab(requestedTab);
  const [tab, setTab] = useState<string>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [customerId, initialTab]);

  // Tab count badges need only totals, not the full lists. Memoize so tab
  // switches and unrelated re-renders don't re-scan and re-sort every work
  // order / invoice for this customer. The detail tabs fetch their own data.
  const localCustomerWorkOrders = useMemo(
    () => (customer ? getCustomerWorkOrders(customer.id) : []),
    [customer, getCustomerWorkOrders],
  );
  const customerWorkOrderList = useWorkOrderListSource(
    localCustomerWorkOrders,
    customer?.companyId,
    customer?.id,
    { enabled: Boolean(customer) },
  );
  const activeWorkOrderCount = useMemo(
    () => (customer ? countActiveCustomerWorkOrders(customerWorkOrderList.workOrders) : 0),
    [customer, customerWorkOrderList.workOrders],
  );
  const customerProtocolReadModel = useCustomerProtocolReadModel(customer?.companyId, customer?.id);
  // Cover image resolves from the Supabase Asset Center (signed URL). Falls back
  // to initials when unset, unconfigured, or the referenced asset is gone.
  const coverSource = useCustomerCoverImage(customer?.coverMediaAssetId, customer?.id);
  const invoiceCount = useMemo(
    () => (customer ? getCustomerInvoices(customer.id).length : 0),
    [customer, getCustomerInvoices],
  );

  // Menu presentation (labels / icons / order / visibility) comes from the
  // Navigation & Menu registry + the Super-Admin override layer (Slice 11B).
  // The route already requires `users.manage` (the customer_card permission
  // gate), so this permission-filtered resolver never hides a tab the visitor
  // can currently see; it only relabels/reorders/re-icons or hides per overrides.
  const customerCardMenu = useNavigationMenu("customer_card");
  const navTabs = useMemo<CustomerCardNavTab[]>(() => {
    const mapped = customerCardMenu
      .map((entry) => {
        const value = CUSTOMER_CARD_REGISTRY_KEY_TO_TAB[entry.key];
        if (!value) return null;
        return { value, label: entry.label, Icon: getNavigationIcon(entry.iconKey) };
      })
      .filter((t): t is CustomerCardNavTab => t !== null);
    // Resilient fallback: if the override layer yields nothing (failed/empty
    // fetch, or every item hidden), render the hardcoded defaults so the menu
    // never disappears. Route/section access is unaffected either way.
    return mapped.length > 0 ? mapped : CUSTOMER_CARD_DEFAULT_NAV_TABS;
  }, [customerCardMenu]);

  // Access control: a Company Admin may only view customers in their company.
  const canAccess =
    Boolean(customer) &&
    (currentUser?.role === "super_admin" ||
      (currentUser?.companyId != null && customer?.companyId === currentUser.companyId));

  // Area Scoped Access: when the feature is active, a scoped (ordinary-staff)
  // user may only open a customer within their assigned areas. Administrators
  // (Super Admin AND Company Admin) are never area-scoped, so an admin can
  // always open any company customer — including newly created, area-less ones.
  const withinAreaScope =
    !customer ||
    isAreaScopeExempt(currentUser?.role) ||
    canAccessArea(
      { enabled: areaScopedAccessEnabled, scope: currentUser?.areaScope },
      resolveCustomerArea(customer, areas)?.id,
    );

  if (customerLoading && !customer) {
    return (
      <DashboardLayout wide>
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading customer…
        </div>
      </DashboardLayout>
    );
  }

  if (!customer || !canAccess || !withinAreaScope) {
    return <AccessDenied />;
  }

  const permissions = currentUser ? getUserPermissions(currentUser) : [];

  const company = companies.find((c) => c.id === customer.companyId);
  const noteCount = (customer.cardNotes ?? []).filter((n) => n.status === "active").length;
  const protocolCount = customerProtocolReadModel.active.length;

  const navStatuses: Record<string, CustomerCardNavStatus | undefined> = {
    work_orders: { count: activeWorkOrderCount, isMissing: activeWorkOrderCount === 0 },
    scheduling: { isMissing: !hasSchedulingPreferenceInfo(customer.schedulingPreferences) },
    protocols: {
      count: protocolCount,
      isMissing: !customerProtocolReadModel.isLoading && protocolCount === 0,
    },
    invoices: { count: invoiceCount },
    notes: { count: noteCount, isMissing: noteCount === 0 },
    keys: { isMissing: !hasKeysAlarmInfo(customer) },
    my_request: { count: 0, showZeroCount: true },
  };

  return (
    <DashboardLayout wide>
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2 text-muted-foreground"
        onClick={() => navigate("/customers")}
      >
        <ArrowLeft className="h-4 w-4" /> Back to customers
      </Button>

      {/* Identity header */}
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {coverSource ? (
            <MediaImage
              source={coverSource}
              size="md"
              className="h-14 w-14 rounded-2xl"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 text-base font-semibold text-warning">
              {initials(customer.name)}
            </div>
          )}
          <div>
            <h1 className="font-display text-2xl tracking-tight">{customer.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Hash className="h-3.5 w-3.5" /> {customer.customerNumber}
              </span>
              {company ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> {company.name}
                </span>
              ) : null}
              <StatusBadge status={customer.status} />
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-2">
          <TabsList
            data-testid="customer-card-icon-tabs"
            className="grid h-auto w-max min-w-full grid-flow-col auto-cols-[92px] gap-2 rounded-2xl border border-border bg-muted/35 p-2 text-muted-foreground shadow-sm lg:w-full lg:grid-flow-row lg:grid-cols-6 xl:grid-cols-11"
          >
            {navTabs.map(({ value, label, Icon }) => {
              const status = navStatuses[value];
              const shouldShowCount = status?.count != null && (status.count > 0 || status.showZeroCount);
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  title={label}
                  className={cn(
                    "group relative flex h-20 flex-col gap-2 whitespace-normal rounded-xl px-2 py-3 text-center text-[11px] font-semibold leading-tight transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md",
                    status?.isMissing ? "ring-1 ring-destructive/25" : "",
                  )}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/70 text-muted-foreground transition-colors group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
                    <Icon data-testid={`customer-tab-icon-${value}`} className="h-5 w-5 shrink-0" aria-hidden="true" />
                  </span>
                  {/* Long custom labels clamp to two lines (tile height fixed by the
                      grid); the full label is available via the tile's title tooltip. */}
                  <span className="flex min-h-7 items-center justify-center">
                    <span className="line-clamp-2 text-balance">{label}</span>
                  </span>
                  {status?.isMissing ? (
                    <span
                      aria-hidden="true"
                      data-testid={`customer-tab-missing-${value}`}
                      className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-destructive shadow-sm ring-2 ring-background"
                    />
                  ) : null}
                  {status?.needsAttention ? (
                    <span
                      aria-hidden="true"
                      data-testid={`customer-tab-attention-${value}`}
                      className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm ring-2 ring-background"
                    />
                  ) : null}
                  {shouldShowCount ? (
                    <span
                      aria-hidden="true"
                      data-testid={`customer-tab-count-${value}`}
                      className={cn(
                        "absolute right-2 top-2 rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                        status?.showZeroCount
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {status?.count}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="contact">
          <ContactInformationTab customer={customer} />
        </TabsContent>

        <TabsContent value="work_orders">
          <WorkOrdersTabContent
            customerId={customer.id}
            companyId={customer.companyId}
            workOrderList={customerWorkOrderList}
          />
        </TabsContent>

        <TabsContent value="scheduling">
          <SchedulingTab customer={customer} />
        </TabsContent>

        <TabsContent value="protocols">
          <CleaningProtocolTab customer={customer} permissions={permissions} />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsTab />
        </TabsContent>

        <TabsContent value="invoices">
          <InvoicesTab customerId={customer.id} />
        </TabsContent>

        <TabsContent value="agreements">
          {permissions.includes("users.manage") ? (
            <CustomerAgreementsPanel
              customerId={customer.id}
              companyScope={detailScope}
            />
          ) : (
            <PlaceholderTab
              icon={<FileSignature className="h-6 w-6" />}
              title="Agreements"
              message="You do not have access to view this customer's agreements."
            />
          )}
        </TabsContent>

        <TabsContent value="log">
          <CustomerCardLogTab customer={customer} />
        </TabsContent>

        <TabsContent value="notes">
          <NotesTab customer={customer} />
        </TabsContent>

        <TabsContent value="keys">
          <PlaceholderTab
            icon={<KeyRound className="h-6 w-6" />}
            title="Keys & Alarm Information"
            message="Keys & Alarm Information will be added later."
          />
        </TabsContent>

        <TabsContent value="documents">
          <CustomerMediaLibrary
            customerId={customer.id}
            companyId={customer.companyId}
          />
        </TabsContent>

        <TabsContent value="my_request">
          <PlaceholderTab
            icon={<Inbox className="h-6 w-6" />}
            title="My Request"
            message="Customer cases, requests, and messages will be added here. Current open request count: 0."
          />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}

// ─────────────────────────────────────────────
// Contact Information tab
// ─────────────────────────────────────────────

export function ContactInformationTab({
  customer,
}: {
  customer: ReturnType<typeof useApp>["customers"][number];
}) {
  const { toast } = useToast();
  const {
    areas,
    postalCities,
    employees,
    autoAreaFromPostalCityEnabled,
    currentUser,
    hasPermission,
  } = useApp();
  const customerMutations = useCustomerMutations({
    companyId: customer.companyId,
    canCreateCustomers: false,
    canEditCustomers: hasPermission("customers.edit"),
  });
  const companyAreas = useMemo(
    () => activeAreas(areas).filter((a) => a.companyId === customer.companyId),
    [areas, customer.companyId],
  );
  // Active employees in this company are the assignable customer owners — same
  // source/filtering as the Customer Page inline edit mode.
  const companyEmployees = useMemo(
    () =>
      employees.filter(
        (e) => e.companyId === customer.companyId && e.status === "active",
      ),
    [employees, customer.companyId],
  );
  const ownerName = customer.ownerId
    ? employees.find((e) => e.id === customer.ownerId)?.name
    : undefined;
  const companyPostalCities = useMemo(
    () => activePostalCities(postalCities).filter((c) => c.companyId === customer.companyId),
    [postalCities, customer.companyId],
  );
  // Per-box editing: each info box (details / addresses / contacts) can be
  // edited independently via its own pencil control. A single shared `draft`
  // holds the working copy so multiple boxes can be open at once; it is built
  // lazily on first edit and cleared once no box is editing.
  const [editingDetails, setEditingDetails] = useState<boolean>(false);
  const [editingAddresses, setEditingAddresses] = useState<boolean>(false);
  const [editingContacts, setEditingContacts] = useState<boolean>(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string>("");
  const [savingSection, setSavingSection] = useState<"details" | "addresses" | "contacts" | null>(null);

  useEffect(() => {
    setEditingDetails(false);
    setEditingAddresses(false);
    setEditingContacts(false);
    setDraft(null);
    setError("");
    setSavingSection(null);
  }, [customer.id]);

  /** Builds a fresh working copy from the current customer record. */
  const buildDraft = (): DraftState => ({
    name: customer.name,
    email: customer.email,
    phone: customer.phone ?? "",
    mainContact: customer.mainContact ?? "",
    customerType: customer.customerType ?? "",
    areaId: customer.areaId ?? "",
    ownerId: customer.ownerId ?? "",
    postalCityId: customer.postalCityId ?? "",
    tags: (customer.tags ?? []).join(", "),
    addresses: (customer.addresses ?? []).map((a) => ({
      ...a,
      // Preselect the address's structured postal city from its explicit link.
      postalCityId: resolveAddressPostalCityId(a, postalCities),
    })),
    contacts: (customer.contacts ?? []).map((c) => ({ ...c })),
  });

  // Revert helpers restore a single section's slice from the live customer so
  // cancelling one box never discards another box's in-flight edits.
  const revertDetailsSlice = (d: DraftState): DraftState => ({
    ...d,
    name: customer.name,
    email: customer.email,
    phone: customer.phone ?? "",
    mainContact: customer.mainContact ?? "",
    customerType: customer.customerType ?? "",
    areaId: customer.areaId ?? "",
    ownerId: customer.ownerId ?? "",
    postalCityId: customer.postalCityId ?? "",
    tags: (customer.tags ?? []).join(", "),
  });
  const revertAddressesSlice = (d: DraftState): DraftState => ({
    ...d,
    addresses: (customer.addresses ?? []).map((a) => ({
      ...a,
      postalCityId: resolveAddressPostalCityId(a, postalCities),
    })),
  });
  const revertContactsSlice = (d: DraftState): DraftState => ({
    ...d,
    contacts: (customer.contacts ?? []).map((c) => ({ ...c })),
  });

  const startEditDetails = () => {
    setDraft((d) => d ?? buildDraft());
    setError("");
    setEditingDetails(true);
  };
  const startEditAddresses = () => {
    setDraft((d) => d ?? buildDraft());
    setError("");
    setEditingAddresses(true);
  };
  const startEditContacts = () => {
    setDraft((d) => d ?? buildDraft());
    setError("");
    setEditingContacts(true);
  };

  const cancelDetails = () => {
    setEditingDetails(false);
    setError("");
    setDraft((d) =>
      d && (editingAddresses || editingContacts) ? revertDetailsSlice(d) : null,
    );
  };
  const cancelAddresses = () => {
    setEditingAddresses(false);
    setDraft((d) =>
      d && (editingDetails || editingContacts) ? revertAddressesSlice(d) : null,
    );
  };
  const cancelContacts = () => {
    setEditingContacts(false);
    setDraft((d) =>
      d && (editingDetails || editingAddresses) ? revertContactsSlice(d) : null,
    );
  };

  const saveCustomerPatch = async (
    section: "details" | "addresses" | "contacts",
    patch: SupabaseCustomerUpdatePatch,
  ): Promise<void> => {
    setSavingSection(section);
    setError("");
    try {
      await customerMutations.updateCustomer({
        customerId: customer.id,
        companyId: customer.companyId,
        patch: withCustomerCardLog(customer, patch, currentUser),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save changes.");
      throw err;
    } finally {
      setSavingSection(null);
    }
  };

  /** Saves only the Customer details fields. */
  const saveDetails = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!draft.customerType) {
      setError("Customer type is required.");
      return;
    }
    const tags = draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const selectedArea = companyAreas.find((a) => a.id === draft.areaId);
    try {
      await saveCustomerPatch("details", {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        mainContact: draft.mainContact.trim(),
        customerType: draft.customerType,
        areaId: draft.areaId || undefined,
        // Keep legacy free-text area in sync with the structured selection so the
        // change log stays meaningful; cleared when unassigned.
        area: selectedArea ? selectedArea.name : "",
        postalCityId: draft.postalCityId || undefined,
        ownerId: draft.ownerId || undefined,
        tags,
      });
      toast({ title: "Customer updated", description: `${draft.name.trim()} has been saved.` });
      setError("");
      setEditingDetails(false);
      setDraft((d) => (editingAddresses || editingContacts ? d : null));
    } catch {
      // Error state is set in saveCustomerPatch; keep edit mode open.
    }
  };

  /** Saves only the Addresses. */
  const saveAddresses = async () => {
    if (!draft) return;
    const addresses = draft.addresses
      .map((a) => ({
        ...a,
        label: a.label?.trim(),
        street: a.street?.trim(),
        postalCode: a.postalCode?.trim(),
        country: a.country?.trim(),
      }))
      .filter((a) => a.label || a.street || a.postalCode || a.country || a.postalCityId);
    try {
      await saveCustomerPatch("addresses", { addresses });
      toast({ title: "Addresses updated" });
      setError("");
      setEditingAddresses(false);
      setDraft((d) => (editingDetails || editingContacts ? d : null));
    } catch {
      // Error state is set in saveCustomerPatch; keep edit mode open.
    }
  };

  /** Saves only the Contact people. */
  const saveContacts = async () => {
    if (!draft) return;
    const contacts = draft.contacts
      .map((c) => ({
        ...c,
        name: c.name.trim(),
        title: c.title?.trim(),
        email: c.email?.trim(),
        phone: c.phone?.trim(),
      }))
      .filter((c) => c.name);
    try {
      await saveCustomerPatch("contacts", { contacts });
      toast({ title: "Contacts updated" });
      setError("");
      setEditingContacts(false);
      setDraft((d) => (editingDetails || editingAddresses ? d : null));
    } catch {
      // Error state is set in saveCustomerPatch; keep edit mode open.
    }
  };

  /**
   * Updates the draft's postal city. Auto-sets the Area only when automatic
   * assignment is enabled AND the city maps to a valid active area; otherwise
   * the connected area is merely suggested below. Never silently clears an
   * existing manual area.
   */
  const handlePostalCityChange = (value: string) => {
    if (!draft) return;
    const id = value === POSTAL_CITY_NONE ? "" : value;
    const city = companyPostalCities.find((c) => c.id === id);
    const area = city ? resolvePostalCityArea(city, areas) : undefined;
    if (id && autoAreaFromPostalCityEnabled && area) {
      setDraft({ ...draft, postalCityId: id, areaId: area.id });
      return;
    }
    setDraft({ ...draft, postalCityId: id });
  };

  // Adding an address implicitly enters the Addresses edit box (the "Add
  // address" control lives in the header independent of the pencil).
  const addAddress = () => {
    const next: CustomerAddress = {
      id: makeId("addr"),
      label: "",
      street: "",
      postalCode: "",
      country: "",
      isInvoice: false,
      isDelivery: false,
    };
    setDraft((d) => {
      const base = d ?? buildDraft();
      return { ...base, addresses: [...base.addresses, next] };
    });
    setEditingAddresses(true);
  };

  const updateAddress = (id: string, patch: Partial<CustomerAddress>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      addresses: draft.addresses.map((a) => {
        if (a.id !== id) {
          return {
            ...a,
            isInvoice: patch.isInvoice ? false : a.isInvoice,
            isDelivery: patch.isDelivery ? false : a.isDelivery,
          };
        }
        return { ...a, ...patch };
      }),
    });
  };

  const removeAddress = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, addresses: draft.addresses.filter((a) => a.id !== id) });
  };

  // Adding a contact implicitly enters the Contact people edit box.
  const addContact = () => {
    setDraft((d) => {
      const base = d ?? buildDraft();
      const isFirst = base.contacts.length === 0;
      const next: CustomerContact = {
        id: makeId("con"),
        name: "",
        title: "",
        email: "",
        phone: "",
        isContactPerson: true,
        isPrimary: isFirst,
        isInvoiceResponsible: isFirst,
        isAgreementResponsible: isFirst,
      };
      return { ...base, contacts: [...base.contacts, next] };
    });
    setEditingContacts(true);
  };

  /** Plain field edits (name/title/email/phone, contact-person toggle). */
  const updateContact = (id: string, patch: Partial<CustomerContact>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      contacts: draft.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  /** Makes the contact the sole primary (and a contact person). */
  const makePrimaryContact = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, contacts: setPrimaryContact(draft.contacts, id) });
  };

  /** Makes the contact the sole invoice-responsible person. */
  const makeInvoiceResponsible = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, contacts: setInvoiceResponsible(draft.contacts, id) });
  };

  /** Makes the contact the sole agreement-responsible person. */
  const makeAgreementResponsible = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, contacts: setAgreementResponsible(draft.contacts, id) });
  };

  const removeContact = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, contacts: draft.contacts.filter((c) => c.id !== id) });
  };

  const addressList = customer.addresses ?? [];
  const contactList = customer.contacts ?? [];

  // Each box owns its edit affordance: a compact pencil icon in the top-right
  // when read-only, swapping to Cancel/Save while that box is being edited.
  // `extra` lets a box keep an always-present action (Add address / Add
  // contact) alongside the pencil, independent of edit state.
  const renderBoxControls = (
    isEditing: boolean,
    start: () => void,
    cancel: () => void,
    saveFn: () => void | Promise<void>,
    editLabel: string,
    extra?: React.ReactNode,
    section?: "details" | "addresses" | "contacts",
  ) => {
    const isSaving = section != null && savingSection === section;
    return (
    <div className="flex items-center gap-2">
      {extra}
      {isEditing ? (
        <>
          <Button variant="ghost" size="sm" onClick={cancel} disabled={customerMutations.isPending}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button size="sm" onClick={saveFn} disabled={customerMutations.isPending}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={start}
          aria-label={editLabel}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
    </div>
    );
  };

  return (
    <div className="grid gap-4">
      {error ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Two-column layout: Customer details on the left; Addresses stacked
          over Contact people on the right. Stacks to a single column on
          smaller screens. Each box carries its own pencil edit control. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
      {/* Details */}
      <Section
        title="Customer details"
        action={renderBoxControls(
          editingDetails,
          startEditDetails,
          cancelDetails,
          saveDetails,
          "Edit customer details",
          undefined,
          "details",
        )}
        compact
      >
        {editingDetails && draft ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Customer name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field
              label="Customer type"
              hint={
                draft.customerType
                  ? CUSTOMER_TYPE_DESCRIPTIONS[draft.customerType]
                  : "Required — drives recommendations and reporting"
              }
            >
              <Select
                value={draft.customerType === "" ? undefined : draft.customerType}
                onValueChange={(v) =>
                  setDraft({ ...draft, customerType: v as CustomerType })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a customer type" />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMER_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {CUSTOMER_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {companyPostalCities.length > 0 ? (
              <Field label="Postal city">
                <Select
                  value={draft.postalCityId === "" ? POSTAL_CITY_NONE : draft.postalCityId}
                  onValueChange={handlePostalCityChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Not assigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={POSTAL_CITY_NONE}>Not assigned</SelectItem>
                    {companyPostalCities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field
              label="Area"
              hint={
                companyAreas.length === 0
                  ? "No areas yet — create them in Settings"
                  : undefined
              }
            >
              <Select
                value={draft.areaId === "" ? AREA_NONE : draft.areaId}
                onValueChange={(v) =>
                  setDraft({ ...draft, areaId: v === AREA_NONE ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AREA_NONE}>Not assigned</SelectItem>
                  {companyAreas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const city = companyPostalCities.find((c) => c.id === draft.postalCityId);
                if (!city) return null;
                const suggested = resolvePostalCityArea(city, areas);
                if (!suggested) {
                  return (
                    <p className="mt-1 text-xs text-warning">
                      This postal city has no active Area — set the Area manually.
                    </p>
                  );
                }
                if (autoAreaFromPostalCityEnabled && draft.areaId === suggested.id) {
                  return (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Area set automatically from Postal City.
                    </p>
                  );
                }
                if (draft.areaId !== suggested.id) {
                  return (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      Suggested Area: <span className="font-medium">{suggested.name}</span>
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setDraft({ ...draft, areaId: suggested.id })}
                      >
                        Use
                      </button>
                    </p>
                  );
                }
                return null;
              })()}
            </Field>
            <Field
              label="Customer owner"
              hint={
                companyEmployees.length === 0
                  ? "No active employees yet"
                  : undefined
              }
            >
              <Select
                value={draft.ownerId === "" ? AREA_NONE : draft.ownerId}
                onValueChange={(v) =>
                  setDraft({ ...draft, ownerId: v === AREA_NONE ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AREA_NONE}>Not assigned</SelectItem>
                  {companyEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tags" hint="Separate with commas">
              <Input
                placeholder="e.g. Priority, Office"
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </Field>
            <Field label="Main contact person">
              <Input
                placeholder="Full name"
                value={draft.mainContact}
                onChange={(e) => setDraft({ ...draft, mainContact: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                placeholder="e.g. +47 55 12 34 56"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <InfoRow
              icon={<User className="h-4 w-4" />}
              label="Customer type"
              value={
                customer.customerType
                  ? CUSTOMER_TYPE_LABELS[customer.customerType]
                  : undefined
              }
            />
            <InfoRow
              icon={<Building2 className="h-4 w-4" />}
              label="Segment"
              value={
                customer.customerSegment
                  ? CUSTOMER_SEGMENT_LABELS[customer.customerSegment]
                  : undefined
              }
            />
            <InfoRow
              icon={<MapPin className="h-4 w-4" />}
              label="Area"
              value={customerAreaLabel(customer, areas)}
            />
            <InfoRow
              icon={<UserCog className="h-4 w-4" />}
              label="Customer owner"
              value={ownerName ?? "Not assigned"}
            />
            <InfoRow
              icon={<Building2 className="h-4 w-4" />}
              label="Postal city"
              value={
                customer.postalCityId
                  ? postalCityLabel(
                      postalCities.find((c) => c.id === customer.postalCityId),
                    ) || undefined
                  : undefined
              }
            />
            <InfoRow icon={<Tag className="h-4 w-4" />} label="Tags">
              {customer.tags && customer.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {customer.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </InfoRow>
            <InfoRow icon={<User className="h-4 w-4" />} label="Main contact person" value={customer.mainContact} />
            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={customer.email} />
            <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={customer.phone} />
            <InfoRow label="Created" value={formatDate(customer.createdAt)} />
            <InfoRow
              label="Last updated"
              value={customer.updatedAt ? formatDate(customer.updatedAt) : formatDate(customer.createdAt)}
            />
          </div>
        )}
      </Section>

      {/* Right column: Addresses stacked over Contact people */}
      <div className="grid gap-4">
      {/* Addresses */}
      <Section
        title="Addresses"
        compact
        action={renderBoxControls(
          editingAddresses,
          startEditAddresses,
          cancelAddresses,
          saveAddresses,
          "Edit addresses",
          <Button variant="outline" size="sm" onClick={addAddress} disabled={customerMutations.isPending}>
            <Plus className="h-4 w-4" /> Add address
          </Button>,
          "addresses",
        )}
      >
        {editingAddresses && draft ? (
          draft.addresses.length === 0 ? (
            <EmptyHint>No addresses yet. Add one above.</EmptyHint>
          ) : (
            <div className="space-y-4">
              {draft.addresses.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Label">
                      <Input
                        placeholder="e.g. Head office"
                        value={a.label ?? ""}
                        onChange={(e) => updateAddress(a.id, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="Street">
                      <Input value={a.street ?? ""} onChange={(e) => updateAddress(a.id, { street: e.target.value })} />
                    </Field>
                    <Field label="Postal code">
                      <Input value={a.postalCode ?? ""} onChange={(e) => updateAddress(a.id, { postalCode: e.target.value })} />
                    </Field>
                    {companyPostalCities.length > 0 ? (
                      <Field label="Postal city">
                        <Select
                          value={a.postalCityId ? a.postalCityId : POSTAL_CITY_NONE}
                          onValueChange={(v) =>
                            updateAddress(a.id, {
                              postalCityId: v === POSTAL_CITY_NONE ? undefined : v,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Not assigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={POSTAL_CITY_NONE}>Not assigned</SelectItem>
                            {companyPostalCities.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    ) : null}
                    <Field label="Country">
                      <Input value={a.country ?? ""} onChange={(e) => updateAddress(a.id, { country: e.target.value })} />
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={a.isInvoice}
                        onCheckedChange={(v) => updateAddress(a.id, { isInvoice: v === true })}
                      />
                      <span className="inline-flex items-center gap-1">
                        <Receipt className="h-3.5 w-3.5" /> Invoice address
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={a.isDelivery}
                        onCheckedChange={(v) => updateAddress(a.id, { isDelivery: v === true })}
                      />
                      <span className="inline-flex items-center gap-1">
                        <Send className="h-3.5 w-3.5" /> Delivery address
                      </span>
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => removeAddress(a.id)}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : addressList.length === 0 ? (
          <EmptyHint>No addresses recorded.</EmptyHint>
        ) : (
          <div className="grid gap-4">
            {addressList.map((a) => (
              <div key={a.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    {a.label || "Address"}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.isInvoice ? (
                      <Badge variant="secondary" className="gap-1">
                        <Receipt className="h-3 w-3" /> Invoice
                      </Badge>
                    ) : null}
                    {a.isDelivery ? (
                      <Badge variant="secondary" className="gap-1">
                        <Send className="h-3 w-3" /> Delivery
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {[a.street, [a.postalCode, addressCityLabel(a, postalCities)].filter(Boolean).join(" "), a.country]
                    .filter(Boolean)
                    .map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Contact people */}
      <Section
        title="Contact people"
        compact
        action={renderBoxControls(
          editingContacts,
          startEditContacts,
          cancelContacts,
          saveContacts,
          "Edit contact people",
          <Button variant="outline" size="sm" onClick={addContact} disabled={customerMutations.isPending}>
            <Plus className="h-4 w-4" /> Add contact
          </Button>,
          "contacts",
        )}
      >
        {editingContacts && draft ? (
          draft.contacts.length === 0 ? (
            <EmptyHint>No contacts yet. Add one above.</EmptyHint>
          ) : (
            <div className="space-y-4">
              {draft.contacts.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name">
                      <Input value={c.name} onChange={(e) => updateContact(c.id, { name: e.target.value })} />
                    </Field>
                    <Field label="Title">
                      <Input
                        placeholder="e.g. Facility Manager"
                        value={c.title ?? ""}
                        onChange={(e) => updateContact(c.id, { title: e.target.value })}
                      />
                    </Field>
                    <Field label="Email">
                      <Input type="email" value={c.email ?? ""} onChange={(e) => updateContact(c.id, { email: e.target.value })} />
                    </Field>
                    <Field label="Phone">
                      <Input value={c.phone ?? ""} onChange={(e) => updateContact(c.id, { phone: e.target.value })} />
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.isContactPerson ?? true}
                        onCheckedChange={(v) =>
                          c.isPrimary
                            ? undefined // primary must remain a contact person
                            : updateContact(c.id, { isContactPerson: v === true })
                        }
                        disabled={c.isPrimary}
                      />
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> Contact person
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.isPrimary}
                        onCheckedChange={(v) => (v === true ? makePrimaryContact(c.id) : undefined)}
                      />
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5" /> Primary contact
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.isInvoiceResponsible ?? false}
                        onCheckedChange={(v) =>
                          v === true ? makeInvoiceResponsible(c.id) : undefined
                        }
                      />
                      <span className="inline-flex items-center gap-1">
                        <Receipt className="h-3.5 w-3.5" /> Invoice responsible
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.isAgreementResponsible ?? false}
                        onCheckedChange={(v) =>
                          v === true ? makeAgreementResponsible(c.id) : undefined
                        }
                      />
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" /> Agreement responsible
                      </span>
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => removeContact(c.id)}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : contactList.length === 0 ? (
          <EmptyHint>No contact people recorded.</EmptyHint>
        ) : (
          <div className="grid gap-4">
            {contactList.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {initials(c.name)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {c.name}
                      {c.isPrimary ? (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" /> Primary
                        </Badge>
                      ) : null}
                      {c.isInvoiceResponsible ? (
                        <Badge variant="outline" className="gap-1">
                          <Receipt className="h-3 w-3" /> Invoice
                        </Badge>
                      ) : null}
                      {c.isAgreementResponsible ? (
                        <Badge variant="outline" className="gap-1">
                          <FileText className="h-3 w-3" /> Agreement
                        </Badge>
                      ) : null}
                    </div>
                    {c.title ? <div className="text-xs text-muted-foreground">{c.title}</div> : null}
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {c.email ? (
                    <div className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" /> {c.email}
                    </div>
                  ) : null}
                  {c.phone ? (
                    <div className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" /> {c.phone}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Work Orders tab
// ─────────────────────────────────────────────

export function WorkOrdersTab({
  customerId,
  companyId,
}: {
  customerId: string;
  companyId: string;
}) {
  const { getCustomerWorkOrders } = useApp();
  const localWorkOrders = getCustomerWorkOrders(customerId);
  const workOrderList = useWorkOrderListSource(
    localWorkOrders,
    companyId,
    customerId,
  );

  return (
    <WorkOrdersTabContent
      customerId={customerId}
      companyId={companyId}
      workOrderList={workOrderList}
    />
  );
}

function WorkOrdersTabContent({
  customerId,
  companyId,
  workOrderList,
}: {
  customerId: string;
  companyId: string;
  workOrderList: WorkOrderListSourceResult;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const {
    currentUser,
    hasPermission,
    setWorkOrderActive,
  } = useApp();
  const workOrderMutations = useWorkOrderMutations({
    companyId,
    canCreateWorkOrders: hasPermission("workOrders.manage"),
  });
  const [showInactive, setShowInactive] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);

  // Same authoritative list result backs both the Customer Card badge count and
  // this table. Empty Supabase reads are absence, not local fallback/proof.
  const { workOrders: all, loading: listLoading, error: listError } = workOrderList;
  const visible = showInactive ? all : all.filter((w) => w.status !== "inactive");
  const canOpenWorkOrderDetails = hasPermission("users.manage");

  const createWorkOrder = async (input: CreateWorkOrderDialogInput): Promise<WorkOrder> => {
    const created = await workOrderMutations.createWorkOrder({
      ...input,
      companyId,
      customerId,
      createdBy: currentUser?.id ?? null,
      createdByName: currentUser?.name ?? "System",
    });
    return verifyCreatedWorkOrderReadableFromSupabase(created, companyId, customerId);
  };

  const inactivate = (id: string, active: boolean) => {
    const res = setWorkOrderActive(id, active);
    if (!res.ok) {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: active ? "Work order activated" : "Work order inactivated" });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive work orders
        </label>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Create New Work Order
        </Button>
      </div>

      {listError ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to refresh work orders: {listError}
        </p>
      ) : null}
      {listLoading ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Refreshing work orders…
        </p>
      ) : null}

      {visible.length === 0 ? (
        <Section title="Work orders">
          <EmptyHint>No active work orders found.</EmptyHint>
        </Section>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Work Order</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Active Services</th>
                    <th className="px-4 py-3 font-medium">Start Date</th>
                    <th className="px-4 py-3 font-medium">End Date</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((w) => {
                    const rows = activeServiceRows(w);
                    return (
                      <tr key={w.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium tabular-nums">{w.number}</div>
                          {w.title ? (
                            <div className="text-xs text-muted-foreground">{w.title}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <WorkOrderStatusBadge status={w.status} />
                        </td>
                        <td className="px-4 py-3">
                          <ActiveServicesCount rows={rows} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{w.startDate ? formatDate(w.startDate) : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{w.endDate ? formatDate(w.endDate) : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(w.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canOpenWorkOrderDetails ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/work-orders/${w.id}`)}
                              >
                                Open
                              </Button>
                            ) : null}
                            {w.status !== "inactive" ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => inactivate(w.id, false)}
                                    aria-label="Inactivate Work Order"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Inactivate Work Order</TooltipContent>
                              </Tooltip>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground"
                                    onClick={() => inactivate(w.id, true)}
                                    aria-label="Activate Work Order"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Activate Work Order</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TooltipProvider>
      )}

      <CreateWorkOrderDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={createWorkOrder}
        pending={workOrderMutations.isPending}
      />
    </div>
  );
}

interface CreateWorkOrderDialogInput {
  title?: string;
  startDate?: string;
  endDate?: string;
  status?: WorkOrderStatus;
}

function CreateWorkOrderDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateWorkOrderDialogInput) => Promise<WorkOrder>;
  pending: boolean;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState<string>("");
  const [status, setStatus] = useState<WorkOrderStatus>("draft");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setTitle("");
      setStatus("draft");
      setStartDate("");
      setEndDate("");
      setError("");
    }
  }, [open]);

  const submit = async () => {
    if (pending) return;
    setError("");
    try {
      await onCreate({
        title: title.trim() || undefined,
        status,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
      });
      toast({ title: "Work order created" });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create work order.";
      setError(message);
      toast({ title: "Unable to create work order", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!pending) onOpenChange(next);
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create new work order</DialogTitle>
          <DialogDescription>
            Create the work order container. You'll add service rows after opening it. Full scheduling and billing arrive with the Work Orders module.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Field label="Title" hint="Optional">
            <Input placeholder="e.g. Spring deep clean" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as WorkOrderStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_ORDER_STATUSES.filter((s) => s.value !== "inactive").map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End date">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create work order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Renders the active-service-row count for a work order. Hovering reveals a
 * tooltip listing each active service and its status — a quick overview without
 * opening the work order. Must be used inside a {@link TooltipProvider}.
 */
function ActiveServicesCount({ rows }: { rows: WorkOrderServiceRow[] }) {
  if (rows.length === 0) {
    return <span className="tabular-nums text-muted-foreground">0</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-6 min-w-[28px] cursor-default items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
          {rows.length}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-medium">
          Active services
        </div>
        <ul className="max-h-64 space-y-1 overflow-y-auto p-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-sm">{r.serviceName}</span>
              <WorkOrderServiceStatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

// ─────────────────────────────────────────────
// Cleaning Days & Times tab
// ─────────────────────────────────────────────

export function SchedulingTab({
  customer,
}: {
  customer: ReturnType<typeof useApp>["customers"][number];
}) {
  const { toast } = useToast();
  const { currentUser, hasPermission } = useApp();
  const customerMutations = useCustomerMutations({
    companyId: customer.companyId,
    canCreateCustomers: false,
    canEditCustomers: hasPermission("customers.edit"),
  });
  const [editing, setEditing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setEditing(false);
    setError("");
  }, [customer.id]);

  const current = customer.schedulingPreferences;

  const handleSave = async (prefs: CustomerSchedulingPreferences): Promise<void> => {
    setError("");
    try {
      await customerMutations.updateCustomer({
        customerId: customer.id,
        companyId: customer.companyId,
        patch: withCustomerCardLog(customer, { schedulingPreferences: prefs }, currentUser),
      });
      toast({ title: "Cleaning preferences saved" });
      setEditing(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save cleaning preferences.";
      setError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
    }
  };

  if (editing) {
    return (
      <div className="grid gap-3">
        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <SchedulingPreferencesEditor
          initial={current}
          onCancel={() => {
            setError("");
            setEditing(false);
          }}
          onSave={handleSave}
          isSaving={customerMutations.isPending}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {/* Single, authoritative Edit control — rendered inline in the first
          ("Cleaning days & time preferences") box header, matching the Customer
          Details pattern across the Customer Card and the embedded workspace. */}
      <Section
        title="Cleaning days & time preferences"
        compact
        action={
          <Button
            size="sm"
            onClick={() => {
              setError("");
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        }
      >
        <CustomerSchedulingSummary preferences={current} layout="cards" />
      </Section>
      <p className="text-xs text-muted-foreground/70">
        These preferences appear read-only inside each Work Order's Overview. Each service row will
        later be able to follow these defaults or override them with its own schedule.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Cleaning Protocol + Reports tabs
// ─────────────────────────────────────────────

function CleaningProtocolTab({
  customer,
  permissions,
}: {
  customer: ReturnType<typeof useApp>["customers"][number];
  permissions: string[];
}) {
  const canViewProtocols = permissions.includes("customer_protocols.view");
  const canManageProtocols =
    permissions.includes("customer_protocols.create") ||
    permissions.includes("customer_protocols.edit") ||
    permissions.includes("customer_protocols.archive");

  return canViewProtocols ? (
    <CustomerProtocolsPanel
      companyId={customer.companyId}
      customerId={customer.id}
      customerSegment={customer.customerSegment}
      canManage={canManageProtocols}
    />
  ) : (
    <PlaceholderTab
      icon={<ListChecks className="h-6 w-6" />}
      title="Cleaning Protocol"
      message="You do not have access to view this customer's cleaning protocol."
    />
  );
}

function ReportsTab() {
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Reports</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Customer reports, time reports, and time bank history are grouped here.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit">Grouped workspace</Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ReportWorkspaceCard
          icon={<FileText className="h-5 w-5" />}
          title="Reports"
          message="Customer report summaries will appear here when report publishing is connected."
        />
        <ReportWorkspaceCard
          icon={<Timer className="h-5 w-5" />}
          title="Time reports"
          message="Employee time reports for this customer will be available from this Reports workspace."
        />
        <ReportWorkspaceCard
          icon={<CalendarClock className="h-5 w-5" />}
          title="Time bank"
          message="Time bank balance and history have moved under Reports and will be connected here."
        />
      </div>
    </div>
  );
}

function ReportWorkspaceCard({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// Customer Card Log tab
// ─────────────────────────────────────

/**
 * Read-only Customer Card Log. Shows every recorded change to the customer card
 * (contact info, scheduling, notes, settings, portal access) with who changed
 * it, the old/new value, the role, and whether it came from the admin or
 * customer portal. Visible to Company Admin and Super Admin only.
 */
function CustomerCardLogTab({
  customer,
}: {
  customer: ReturnType<typeof useApp>["customers"][number];
}) {
  const entries = useMemo<CustomerCardLogEntry[]>(
    () =>
      [...(customer.cardLog ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    [customer.cardLog],
  );

  if (entries.length === 0) {
    return (
      <Section title="Customer Card Log">
        <EmptyHint>No changes recorded yet.</EmptyHint>
      </Section>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Change type</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Field</th>
              <th className="px-4 py-3 font-medium">Old value</th>
              <th className="px-4 py-3 font-medium">New value</th>
              <th className="px-4 py-3 font-medium">Changed by</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/60 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatDateTime(e.at)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge variant="outline">
                    {CUSTOMER_CARD_LOG_CHANGE_TYPE_LABELS[e.changeType ?? "system_change"]}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-medium">{e.section}</td>
                <td className="px-4 py-3 text-muted-foreground">{e.field ?? "—"}</td>
                <td className="max-w-[260px] px-4 py-3 text-muted-foreground">
                  <span className="line-clamp-3 break-words">{e.oldValue}</span>
                </td>
                <td className="max-w-[260px] px-4 py-3">
                  <span className="line-clamp-3 break-words">{e.newValue}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div>{e.changedByName}</div>
                  <div className="text-xs text-muted-foreground">{ROLE_LABELS[e.changedByRole]}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge variant="secondary" className={WORK_ORDER_BADGE_CLASS}>
                    {CUSTOMER_CARD_LOG_SOURCE_LABELS[e.source]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Invoices tab
// ─────────────────────────────────────────────

function InvoicesTab({ customerId }: { customerId: string }) {
  const { getCustomerInvoices } = useApp();
  const invoices = getCustomerInvoices(customerId);

  if (invoices.length === 0) {
    return (
      <Section title="Invoices">
        <EmptyHint>No invoices found for this customer.</EmptyHint>
      </Section>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">To pay</th>
              <th className="px-4 py-3 text-right font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Invoice date</th>
              <th className="px-4 py-3 font-medium">Due date</th>
              <th className="px-4 py-3 font-medium">Fully paid</th>
              <th className="px-4 py-3 font-medium">Reminder</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium tabular-nums">{i.number}</td>
                <td className="px-4 py-3">
                  <InvoiceStatusBadge status={i.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(i.amountToPay)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(i.amountPaid)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(i.invoiceDate)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(i.dueDate)}</td>
                <td className="px-4 py-3 text-muted-foreground">{i.fullyPaidDate ? formatDate(i.fullyPaidDate) : "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{i.reminderDate ? formatDate(i.reminderDate) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const variant =
    status === "paid" ? "secondary" : status === "overdue" ? "destructive" : "default";
  return (
    <Badge variant={variant} className={WORK_ORDER_BADGE_CLASS}>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

// ─────────────────────────────────────────────
// Notes tab
// ─────────────────────────────────────────────

interface NoteDraft {
  type: CustomerCardNoteType;
  title: string;
  content: string;
}

export function NotesTab({
  customer,
}: {
  customer: ReturnType<typeof useApp>["customers"][number];
}) {
  const { toast } = useToast();
  const { currentUser, hasPermission } = useApp();
  const customerMutations = useCustomerMutations({
    companyId: customer.companyId,
    canCreateCustomers: false,
    canEditCustomers: hasPermission("customers.edit"),
  });
  const notes = customer.cardNotes ?? [];

  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [composer, setComposer] = useState<NoteDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; content: string }>({ title: "", content: "" });
  const [error, setError] = useState<string>("");
  const [savingAction, setSavingAction] = useState<string | null>(null);

  useEffect(() => {
    setComposer(null);
    setEditingId(null);
    setEditDraft({ title: "", content: "" });
    setError("");
    setSavingAction(null);
  }, [customer.id]);

  const persist = async (next: CustomerCardNote[], actionId: string): Promise<boolean> => {
    setSavingAction(actionId);
    setError("");
    try {
      await customerMutations.updateCustomer({
        customerId: customer.id,
        companyId: customer.companyId,
        patch: withCustomerCardLog(customer, { cardNotes: next }, currentUser),
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save note.";
      setError(message);
      toast({ title: "Unable to save note", description: message, variant: "destructive" });
      return false;
    } finally {
      setSavingAction(null);
    }
  };

  const addNote = async () => {
    if (!composer) return;
    if (!composer.title.trim() && !composer.content.trim()) return;
    const now = new Date().toISOString();
    const note: CustomerCardNote = {
      id: makeId("cnote"),
      type: composer.type,
      title: composer.title.trim() || "Untitled note",
      content: composer.content.trim(),
      authorId: currentUser?.id ?? null,
      authorName: currentUser?.name ?? "Admin",
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    if (await persist([note, ...notes], "add")) {
      setComposer(null);
      toast({ title: "Note added" });
    }
  };

  const saveEdit = async (id: string) => {
    const now = new Date().toISOString();
    const next = notes.map((n) =>
      n.id === id
        ? {
            ...n,
            title: editDraft.title.trim() || "Untitled note",
            content: editDraft.content.trim(),
            updatedAt: now,
          }
        : n,
    );
    if (await persist(next, `edit:${id}`)) {
      setEditingId(null);
    }
  };

  const setArchived = async (id: string, archived: boolean) => {
    const now = new Date().toISOString();
    const nextStatus: CustomerCardNote["status"] = archived ? "inactive" : "active";
    const next = notes.map((n) =>
      n.id === id ? { ...n, status: nextStatus, updatedAt: now } : n,
    );
    await persist(next, `archive:${id}`);
  };

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived notes
        </label>
      </div>

      {/* Three note areas side by side on wide screens, collapsing to two/one
          columns as width shrinks. Each column owns its own composer + list. */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {CUSTOMER_CARD_NOTE_TYPES.map((type) => {
        const typeNotes = notes
          .filter((n) => n.type === type.value && (showArchived || n.status === "active"))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const isComposing = composer?.type === type.value;
        return (
          <Section
            key={type.value}
            title={type.label}
            subtitle={type.visibility}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError("");
                  setComposer(isComposing ? null : { type: type.value, title: "", content: "" });
                }}
              >
                <Plus className="h-4 w-4" /> Add note
              </Button>
            }
          >
            {isComposing && composer ? (
              <div className="mb-4 space-y-3 rounded-xl border border-border bg-background p-4">
                <Field label="Title">
                  <Input
                    placeholder="Short title"
                    value={composer.title}
                    onChange={(e) => setComposer({ ...composer, title: e.target.value })}
                  />
                </Field>
                <Field label="Content">
                  <Textarea
                    placeholder="Write the note…"
                    value={composer.content}
                    onChange={(e) => setComposer({ ...composer, content: e.target.value })}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setError("");
                      setComposer(null);
                    }}
                    disabled={savingAction === "add"}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={addNote}
                    disabled={savingAction === "add" || (!composer.title.trim() && !composer.content.trim())}
                  >
                    {savingAction === "add" ? "Saving…" : "Save note"}
                  </Button>
                </div>
              </div>
            ) : null}

            {typeNotes.length === 0 ? (
              <EmptyHint>No {type.label.toLowerCase()} yet.</EmptyHint>
            ) : (
              <ul className="space-y-3">
                {typeNotes.map((n) => (
                  <li key={n.id} className="rounded-xl border border-border bg-background p-4">
                    {editingId === n.id ? (
                      <div className="space-y-3">
                        <Field label="Title">
                          <Input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                        </Field>
                        <Field label="Content">
                          <Textarea value={editDraft.content} onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })} />
                        </Field>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setError("");
                              setEditingId(null);
                            }}
                            disabled={savingAction === `edit:${n.id}`}
                          >
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => saveEdit(n.id)} disabled={savingAction === `edit:${n.id}`}>
                            {savingAction === `edit:${n.id}` ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {n.title}
                            {n.status !== "active" ? (
                              <Badge variant="outline" className="text-muted-foreground">Archived</Badge>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Edit note"
                              onClick={() => {
                                setError("");
                                setEditingId(n.id);
                                setEditDraft({ title: n.title, content: n.content });
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {n.status === "active" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setArchived(n.id, true)}
                                disabled={savingAction === `archive:${n.id}`}
                                aria-label="Archive note"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setArchived(n.id, false)}
                                disabled={savingAction === `archive:${n.id}`}
                                aria-label="Restore note"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {n.content ? (
                          <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{n.content}</p>
                        ) : null}
                        <div className="mt-2 text-xs text-muted-foreground/70">
                          {n.authorName} · {formatDateTime(n.createdAt)}
                          {n.updatedAt !== n.createdAt ? ` · edited ${formatDateTime(n.updatedAt)}` : ""}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Placeholder tab
// ─────────────────────────────────────────────

function PlaceholderTab({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Shared layout helpers
// ─────────────────────────────────────────────

function Section({
  title,
  subtitle,
  action,
  compact,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Tighter padding/spacing for embedded, space-efficient workspace use. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card ${compact ? "p-4" : "p-6"}`}
    >
      <div
        className={`flex items-start justify-between gap-3 ${compact ? "mb-3" : "mb-5"}`}
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground/70">{subtitle}</p> : null}
        </div>
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
