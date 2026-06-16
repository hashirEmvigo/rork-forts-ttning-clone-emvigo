import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  Clock,
  Contact,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  KeyRound,
  MapPin,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  Plus,
  Power,
  Rocket,
  ScrollText,
  Search,
  Target,
  Settings2,
  UserCheck,
  Users,
  X,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { CustomerDialog } from "@/components/customers/CustomerDialog";
import { CustomerAreaSetupDialog } from "@/components/customers/CustomerAreaSetupDialog";
import { CustomerProtocolsWorkspace } from "@/components/checklist/CustomerProtocolsWorkspace";
import { CustomerMediaLibrary } from "@/components/customer/CustomerMediaLibrary";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContactInformationTab,
  NotesTab,
  SchedulingTab,
} from "@/pages/admin/CustomerCard";
import { PaginationControl } from "@/components/PaginationControl";
import { useApp } from "@/context/AppContext";
import { useCustomerListSource } from "@/hooks/use-customer-list-source";
import { useCustomerMutations } from "@/hooks/use-customer-mutations";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePagination } from "@/hooks/use-pagination";
import { DEFAULT_SEARCH_MIN_LENGTH, evaluateSearchThreshold } from "@/lib/searchThreshold";
import { useToast } from "@/hooks/use-toast";
import { customerNumberDisplay, initials } from "@/lib/format";
import { makeId } from "@/lib/store";
import { activeAreas, resolveAreaWriteFields, resolveCustomerArea } from "@/lib/area";
import { classifyCustomerAreaReadiness, resolveSuggestedArea } from "@/lib/areaReadiness";
import { activePostalCities, addressCityLabel } from "@/lib/postalCity";
import { resolvePrimaryContact } from "@/lib/customerContacts";
import { filterByAreaScope, isAreaScopeExempt } from "@/lib/areaScope";
import { getRecentCustomerIds, recordRecentCustomer } from "@/lib/recentCustomers";
import {
  getCustomerDeleteTombstones,
  subscribeCustomerDeleteTombstones,
} from "@/lib/data";
import {
  fetchCustomerDeleteDependencyContext,
  type CustomerDeleteDependencyResult,
} from "@/lib/data/customerDeleteDependencies";
import type { EntityDeleteValidationResult } from "@/lib/entityDeleteValidation";
import type { Customer, CustomerAddress } from "@/types";

/** Select sentinel for "no selection" (Radix Select disallows empty values). */
const NONE = "__none__";

/**
 * Discovery shortcuts shown on the Customers workspace landing state. The page
 * intentionally opens blank: the list only renders once the user searches,
 * picks a shortcut, or opens an area filter — so Customers reads like a
 * discovery hub rather than a full data dump.
 */
const DISCOVERY_CHIPS = [
  { value: "recent", label: "Recent", icon: Clock },
  { value: "active", label: "Active", icon: CircleCheck },
  { value: "paused", label: "Paused", icon: PauseCircle },
  { value: "all", label: "All customers", icon: Users },
  { value: "archived", label: "Archived", icon: Archive },
] as const;

type Discovery = (typeof DISCOVERY_CHIPS)[number]["value"];

/**
 * Collapsible workspace sections rendered below Section 1. These build the
 * Customer command center: Section 1 (the list) owns the active-customer
 * context, and every section below scopes itself to it. Future sections
 * (Invoices, Agreements, Documents, Activity, …) slot into the same accordion
 * model.
 */
type DashboardSection =
  | "onboarding"
  | "details"
  | "protocols"
  | "scheduling"
  | "notes"
  | "documents"
  | "keys";

/** How many most-recently-worked-with customers the "Recent" shortcut surfaces. */
const RECENT_LIMIT = 5;

/**
 * Collapsible workspace panel shell. The header toggles open/closed; the body
 * only mounts when open so heavy section content (editors, lists) stays unmounted
 * while collapsed. Section 1 (the customer list) never uses this — it never
 * collapses.
 */
function WorkspaceSection({
  title,
  subtitle,
  icon,
  open,
  onToggle,
  headerAction,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  /**
   * Optional inline action rendered on the header row (e.g. "+ Add", "Edit").
   * It sits beside the collapse chevron and is its own button, so clicking it
   * fires the action without toggling the section; clicking anywhere else on
   * the row still expands/collapses.
   */
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex w-full items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="block text-xs text-muted-foreground">{subtitle}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {headerAction}
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? "Collapse section" : "Expand section"}
            className="text-muted-foreground"
          >
            <ChevronDown
              className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-border bg-background/40 p-5">{children}</div>
      ) : null}
    </section>
  );
}

/**
 * Shown inside a customer-scoped section when no customer is locked yet. Sections
 * intentionally do not repeat the customer name — the selected-customer banner
 * above Section 1 is the single source of truth for the active context.
 */
function NeedsCustomerHint() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center text-muted-foreground">
      <Users className="h-6 w-6 opacity-40" />
      <p className="text-sm">Select a customer above to manage this section.</p>
    </div>
  );
}

/** Most recent activity timestamp for a customer (updated, else created). */
function recentTs(c: Customer): number {
  const stamp = c.updatedAt ?? c.createdAt;
  const n = stamp ? new Date(stamp).getTime() : 0;
  return Number.isNaN(n) ? 0 : n;
}

/** Inline-editable fields for a customer row in Edit mode. */
interface RowDraft {
  phone: string;
  email: string;
  street: string;
  postalCityId: string;
  ownerId: string;
  areaId: string;
}

/** The address inline edit acts on: invoice → delivery → first. */
function primaryAddress(customer: Customer): CustomerAddress | undefined {
  return (
    customer.addresses?.find((a) => a.isInvoice) ??
    customer.addresses?.find((a) => a.isDelivery) ??
    customer.addresses?.[0]
  );
}

export default function Customers() {
  const {
    currentUser,
    customers: localCustomers,
    employees,
    areas,
    postalCities,
    areaScopedAccessEnabled,
    updateCustomer,
    startViewAsCustomer,
    hasPermission,
    canAccessModule,
    hydrateCustomersFromRemote,
  } = useApp();
  const canManageSettings = hasPermission("settings.manage");
  // Customer archive is restricted to admins. Physical delete is intentionally not exposed.
  const canManageLifecycle =
    currentUser?.role === "super_admin" || currentUser?.role === "company_admin";
  // Object-first access: Customer Protocols and Customer Invoices are reached
  // from here rather than the main sidebar. Shown only when the admin can
  // actually open them, so no dead links appear.
  const canViewProtocols =
    !!currentUser &&
    hasPermission("customer_protocols.view") &&
    canAccessModule(currentUser, "checklist-manager");
  const canViewCustomerInvoices =
    !!currentUser && canAccessModule(currentUser, "customer-invoices");
  // Mirrors the protocols workspace: super admins view but never create.
  const canCreateProtocols =
    canViewProtocols &&
    currentUser?.role !== "super_admin" &&
    hasPermission("customer_protocols.create");
  const { toast } = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState<string>("");
  // Discovery shortcut driving the landing state. Null = blank/discovery view.
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [areaSetupOpen, setAreaSetupOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editMode, setEditMode] = useState<boolean>(false);
  // Customer pending an archive/restore decision.
  const [lifecycleTarget, setLifecycleTarget] = useState<Customer | null>(null);
  const [lifecyclePending, setLifecyclePending] = useState<boolean>(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [rowSaveErrors, setRowSaveErrors] = useState<Record<string, string>>({});
  const [pendingRowSaves, setPendingRowSaves] = useState<Set<string>>(() => new Set());
  // Collapsible dashboard sections rendered below the customer list/search
  // (Section 1). Section 1 itself never collapses and is excluded from this set.
  // Sections are collapsed by default; opening one collapses the others
  // (accordion), unless "Expand all" puts every available section open at once.
  // Currently only Protocols is surfaced so admins stay on /customers instead of
  // jumping to the standalone module page.
  const [openSections, setOpenSections] = useState<Set<DashboardSection>>(
    () => new Set(),
  );
  // The active/locked customer for the workspace. Section 1 controls this; the
  // sections below (currently only Protocols) scope themselves to it. Null keeps
  // every section in its unscoped (Mode A) behaviour.
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // Customer id pending onboarding: set right after a "Start onboarding" create.
  // An effect resolves the freshly-persisted customer (createCustomer's state
  // update is async), then locks it active and expands the workspace.
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  // Bumped whenever a "worked with" interaction is recorded so the Recent
  // shortcut recomputes from the (localStorage-backed) activity log.
  const [recentVersion, setRecentVersion] = useState<number>(0);
  // Incremented by the Protocols section's header "+ Add" button. The embedded
  // protocols workspace watches this token and opens its New Protocol dialog
  // (preselecting the active customer when one is locked).
  const [protocolCreateToken, setProtocolCreateToken] = useState<number>(0);
  const [searchParams, setSearchParams] = useSearchParams();

  // Area readiness filter — deep-linkable via ?area=missing|has|suggested|manual
  // so the readiness overview can send admins straight to the right customers.
  type AreaFilter = "all" | "missing" | "has" | "suggested" | "manual";
  const rawArea = searchParams.get("area");
  const areaFilter: AreaFilter =
    rawArea === "missing" ||
    rawArea === "has" ||
    rawArea === "suggested" ||
    rawArea === "manual"
      ? rawArea
      : "all";

  const setAreaFilter = (next: AreaFilter) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "all") params.delete("area");
        else params.set("area", next);
        return params;
      },
      { replace: true },
    );
  };

  const companyId = currentUser?.companyId ?? "";

  // Wave 1B (P4F): the LIST read source. With the feature flag off (default)
  // this is exactly `localCustomers`; with it on it reads from Supabase and
  // falls back to localStorage. CustomerDialog, the embedded Customer Card
  // contact/details tab, embedded notes/scheduling tabs, inline row saves, and
  // simple suggested-area apply now use the Supabase mutation boundary.
  // Archive/restore lifecycle also uses the Supabase mutation boundary; status
  // toggle and onboarding writes remain intentionally deferred.
  const { customers } = useCustomerListSource(localCustomers, companyId, {
    includeArchived: discovery === "archived",
  });
  const customerMutations = useCustomerMutations({
    companyId,
    canCreateCustomers: hasPermission("customers.create"),
    canEditCustomers: hasPermission("customers.edit"),
  });

  // Read/action seam bridge (same proven pattern as the Customer Card): the list
  // can render rows that exist ONLY in Supabase under the authoritative read
  // path, while some deferred workspace actions still read AppContext state.
  // Back-fill every visible Supabase-only row into local state so those deferred actions can find their target
  // instead of failing with "customer not found". READ-side reconcile only; it
  // never mirrors back and never clobbers a newer local edit, and it converges
  // (once hydrated, the rows are present locally so this becomes a no-op).
  //
  // Resurrection guard: a just-deleted customer is removed from local state but
  // may still sit in the cached Supabase snapshot for a beat. Such ids are
  // tombstoned, so we explicitly exclude them here — hydration must never write
  // a ghost (deleted) row back into AppContext local state, which would make the
  // row reappear and require a second delete. (`customers` already suppresses
  // tombstoned ids; this is the belt-and-suspenders guard at the write seam.)
  const tombstoned = useSyncExternalStore(
    subscribeCustomerDeleteTombstones,
    getCustomerDeleteTombstones,
    getCustomerDeleteTombstones,
  );
  useEffect(() => {
    const localIds = new Set(localCustomers.map((c) => c.id));
    const blocked = tombstoned.length > 0 ? new Set(tombstoned) : null;
    const remoteOnly = customers.filter(
      (c) => !localIds.has(c.id) && !blocked?.has(c.id),
    );
    if (remoteOnly.length > 0) hydrateCustomersFromRemote(remoteOnly);
  }, [customers, localCustomers, tombstoned, hydrateCustomersFromRemote]);

  const companyAreas = useMemo(
    () => activeAreas(areas).filter((a) => a.companyId === companyId),
    [areas, companyId],
  );
  const companyPostalCities = useMemo(
    () => activePostalCities(postalCities).filter((c) => c.companyId === companyId),
    [postalCities, companyId],
  );
  // Active employees that can own customers (account managers).
  const companyEmployees = useMemo(
    () => employees.filter((e) => e.companyId === companyId && e.status === "active"),
    [employees, companyId],
  );
  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);

  // Company scope first, then Area Scoped Access. Scoping is applied before
  // search so a scoped user can never surface an out-of-scope customer by
  // searching. Administrators (Super Admin AND Company Admin) are never
  // area-scoped: they own the company's full picture, so newly created,
  // area-less customers always stay visible to them. Area scoping only narrows
  // ordinary staff.
  const companyCustomers = useMemo(() => {
    const owned = customers.filter((c) => c.companyId === companyId);
    if (isAreaScopeExempt(currentUser?.role)) return owned;
    return filterByAreaScope(
      owned,
      (c) => resolveCustomerArea(c, areas)?.id,
      { enabled: areaScopedAccessEnabled, scope: currentUser?.areaScope },
    );
  }, [customers, companyId, currentUser, areas, areaScopedAccessEnabled]);

  // Apply the Area readiness filter before search so counts stay consistent and
  // a scoped user can never reveal a filtered-out customer by searching.
  const areaScoped = useMemo(() => {
    if (areaFilter === "all") return companyCustomers;
    return companyCustomers.filter((c) => {
      const bucket = classifyCustomerAreaReadiness(c, areas, postalCities);
      switch (areaFilter) {
        case "has":
          return bucket === "has";
        case "missing":
          return bucket !== "has";
        case "suggested":
          return bucket === "suggested";
        case "manual":
          return bucket === "manual";
        default:
          return true;
      }
    });
  }, [companyCustomers, areas, postalCities, areaFilter]);

  // Search hygiene: debounce keystrokes, then apply the shared threshold policy
  // so free-text searches only run at >= 5 chars while identifier-style queries
  // (e.g. customer number "C-1001") execute immediately.
  const debouncedQuery = useDebouncedValue(query, 350);
  // countWhitespace: spaces count toward the min-length threshold, so typing
  // "Anna " (with a trailing space) reaches 5 chars and runs the search.
  const { activeQuery, belowThreshold } = evaluateSearchThreshold(
    debouncedQuery,
    DEFAULT_SEARCH_MIN_LENGTH,
    { countWhitespace: true },
  );

  // The list is only built once the user takes a discovery action: a search, a
  // shortcut chip, or an area-readiness deep link (?area=…). Otherwise the page
  // shows a clean discovery state instead of every customer.
  const listActive =
    discovery !== null || activeQuery.length > 0 || areaFilter !== "all";

  const filtered = useMemo(() => {
    if (!listActive) return [];
    const q = activeQuery.toLowerCase();
    let base = areaScoped;
    if (discovery === "active") base = base.filter((c) => c.status === "active");
    else if (discovery === "paused") base = base.filter((c) => c.status === "inactive");
    else if (discovery === "archived") base = base.filter((c) => c.status === "archived");
    if (q) {
      base = base.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.customerNumber.toLowerCase().includes(q),
      );
    }
    if (discovery === "recent") {
      // "Recently worked with": order by the activity log first, falling back to
      // most-recently-updated when no interactions have been recorded yet. Both
      // paths surface the 5 most relevant customers when not narrowing by search.
      const recentIds = getRecentCustomerIds(companyId);
      if (recentIds.length > 0) {
        const byId = new Map(base.map((c) => [c.id, c]));
        const worked = recentIds
          .map((id) => byId.get(id))
          .filter((c): c is Customer => Boolean(c));
        base =
          worked.length > 0
            ? worked
            : [...base].sort((a, b) => recentTs(b) - recentTs(a));
      } else {
        base = [...base].sort((a, b) => recentTs(b) - recentTs(a));
      }
      if (!q) base = base.slice(0, RECENT_LIMIT);
    }
    return base;
    // recentVersion forces a recompute after recording an interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listActive, areaScoped, discovery, activeQuery, companyId, recentVersion]);

  // Paginate before rendering so large result sets never all mount at once.
  const {
    page,
    pageSize,
    totalPages,
    totalItems,
    pageItems,
    startIndex,
    endIndex,
    setPage,
    setPageSize,
  } = usePagination(filtered, {
    pageSize: 40,
    resetKey: `${activeQuery}|${areaFilter}|${discovery ?? "none"}`,
  });

  const buildDraft = (customer: Customer): RowDraft => {
    const addr = primaryAddress(customer);
    return {
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      street: addr?.street ?? "",
      postalCityId: addr?.postalCityId ?? "",
      ownerId: customer.ownerId ?? "",
      areaId: customer.areaId ?? "",
    };
  };

  /** The current draft for a customer (stored once edited, else freshly built). */
  const getDraft = (customer: Customer): RowDraft => drafts[customer.id] ?? buildDraft(customer);

  const patchDraft = (customer: Customer, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [customer.id]: { ...(prev[customer.id] ?? buildDraft(customer)), ...patch },
    }));
  };

  const toggleEditMode = () => {
    setEditMode((on) => {
      if (on) setDrafts({});
      return !on;
    });
  };

  const cancelRow = (customer: Customer) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[customer.id];
      return next;
    });
    setRowSaveErrors((prev) => {
      const next = { ...prev };
      delete next[customer.id];
      return next;
    });
  };

  const setRowPending = (customerId: string, pending: boolean) => {
    setPendingRowSaves((prev) => {
      const next = new Set(prev);
      if (pending) next.add(customerId);
      else next.delete(customerId);
      return next;
    });
  };

  const clearRowError = (customerId: string) => {
    setRowSaveErrors((prev) => {
      if (!(customerId in prev)) return prev;
      const next = { ...prev };
      delete next[customerId];
      return next;
    });
  };

  const setRowError = (customerId: string, message: string) => {
    setRowSaveErrors((prev) => ({ ...prev, [customerId]: message }));
  };

  const requireCustomerWriteScope = (customer: Customer): string => {
    const scopeCompanyId = customer.companyId?.trim() ?? "";
    if (!customer.id.trim()) throw new Error("Customer update requires a customer id.");
    if (!scopeCompanyId) {
      throw new Error("Customer update requires the customer's existing company scope.");
    }
    return scopeCompanyId;
  };

  /** Saves the inline-edited fields for a single customer row. */
  const saveRow = async (customer: Customer) => {
    const draft = getDraft(customer);
    const street = draft.street.trim();
    const postalCityId = draft.postalCityId || undefined;

    // Update the primary address in place, or create one when needed. Never
    // touches other addresses or their invoice/delivery flags.
    const addresses = (customer.addresses ?? []).map((a) => ({ ...a }));
    const primary = primaryAddress({ ...customer, addresses });
    if (primary) {
      const idx = addresses.findIndex((a) => a.id === primary.id);
      addresses[idx] = {
        ...addresses[idx],
        street: street || undefined,
        postalCityId,
      };
    } else if (street || postalCityId) {
      addresses.push({
        id: makeId("addr"),
        street: street || undefined,
        postalCityId,
        isInvoice: true,
        isDelivery: false,
      });
    }

    const areaFields = resolveAreaWriteFields(draft.areaId, companyAreas);
    clearRowError(customer.id);
    setRowPending(customer.id, true);
    try {
      const scopeCompanyId = requireCustomerWriteScope(customer);
      await customerMutations.updateCustomer({
        customerId: customer.id,
        companyId: scopeCompanyId,
        patch: {
          phone: draft.phone.trim(),
          email: draft.email.trim(),
          areaId: areaFields.areaId,
          area: areaFields.area,
          ownerId: draft.ownerId || undefined,
          addresses,
        },
      });
      toast({ title: "Customer updated", description: `${customer.name} has been saved.` });
      cancelRow(customer);
      setDrafts({});
      setEditMode(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update customer.";
      setRowError(customer.id, message);
      toast({
        title: "Could not save",
        description: message,
        variant: "destructive",
      });
    } finally {
      setRowPending(customer.id, false);
    }
  };

  /** Compact street + city line for read mode. */
  const ownerName = (customer: Customer): string => {
    if (!customer.ownerId) return "";
    return employeeNameById.get(customer.ownerId) ?? "";
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setDialogOpen(true);
  };

  const handleViewAs = (customer: Customer) => {
    const res = startViewAsCustomer(customer.id);
    if (!res.ok) {
      toast({
        title: "Cannot preview",
        description: res.error ?? "Unable to view as this customer.",
        variant: "destructive",
      });
      return;
    }
    navigate("/", { replace: true });
  };

  /** Applies a customer's Postal City -> Area suggestion, never overwriting an existing Area. */
  const applySuggestedArea = async (customer: Customer, areaId: string, areaName: string) => {
    if (resolveCustomerArea(customer, areas)) return; // never overwrite an existing Area
    clearRowError(customer.id);
    setRowPending(customer.id, true);
    try {
      const scopeCompanyId = requireCustomerWriteScope(customer);
      await customerMutations.updateCustomer({
        customerId: customer.id,
        companyId: scopeCompanyId,
        patch: { areaId, area: areaName },
      });
      toast({
        title: "Area assigned",
        description: `${customer.name} is now in ${areaName}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to assign area.";
      setRowError(customer.id, message);
      toast({
        title: "Could not assign area",
        description: message,
        variant: "destructive",
      });
    } finally {
      setRowPending(customer.id, false);
    }
  };

  /** Records a "worked with" interaction and recomputes the Recent shortcut. */
  const recordActivity = (customerId: string) => {
    recordRecentCustomer(companyId, customerId);
    setRecentVersion((v) => v + 1);
  };

  /** Opens the full customer card, recording the interaction first. */
  const openCustomerCard = (customerId: string) => {
    recordActivity(customerId);
    navigate(`/customers/${customerId}`);
  };

  /**
   * Locks a customer as the active workspace context. Sections below stay
   * collapsed by default — the user explicitly opens a section afterwards, so
   * this no longer auto-expands anything. Counts as "working with" the customer.
   */
  const selectForWorkspace = (customer: Customer) => {
    setSelectedCustomer(customer);
    // Mirror the locked customer into the search field so clearing the selection
    // returns the admin to a search pre-filled with that customer's name.
    setQuery(customer.name);
    recordActivity(customer.id);
  };

  /**
   * Two-stage "Clear search" control sitting beside the free-text field.
   * - First click (while a query is present): clears the text and any locked
   *   customer, and shows the full list so results stay visible.
   * - Second click (query already empty): clears every filter and returns the
   *   page to its blank discovery state.
   */
  const handleClearSearch = () => {
    if (query.trim().length > 0) {
      setQuery("");
      setSelectedCustomer(null);
      if (discovery === null && areaFilter === "all") setDiscovery("all");
    } else {
      setSelectedCustomer(null);
      setDiscovery(null);
      setQuery("");
      setAreaFilter("all");
    }
  };

  // The live record for the locked customer (reflects edits made in the sections
  // below). Resolved from the list source by id so saving in Customer Details
  // immediately re-renders every section.
  const activeCustomer = useMemo<Customer | null>(() => {
    if (!selectedCustomer) return null;
    return customers.find((c) => c.id === selectedCustomer.id) ?? selectedCustomer;
  }, [customers, selectedCustomer]);

  // The dashboard sections available to this admin, in render order. Drives the
  // global expand/collapse control and the accordion behaviour below Section 1.
  // Details/Scheduling/Notes/Keys are always available (the admin already has
  // customer access here); Protocols is permission-gated. The Onboard Process
  // step only appears while the active customer is mid-onboarding.
  const availableSections = useMemo<DashboardSection[]>(() => {
    const list: DashboardSection[] = [];
    if (activeCustomer?.onboardingStatus === "in_progress") list.push("onboarding");
    list.push("details");
    if (canViewProtocols) list.push("protocols");
    list.push("scheduling", "notes", "documents", "keys");
    return list;
  }, [canViewProtocols, activeCustomer?.onboardingStatus]);

  const allSectionsOpen =
    availableSections.length > 0 &&
    availableSections.every((s) => openSections.has(s));

  // Onboarding follow-up: once the newly-created customer appears in the list
  // source, lock it as the active context, filter Section 1 to it (search by
  // its customer number so the match is exact regardless of name length), and
  // expand every available workspace section so the admin can keep filling in
  // details without leaving /customers. Missing fields can stay blank.
  useEffect(() => {
    if (!onboardingId) return;
    const created = companyCustomers.find((c) => c.id === onboardingId);
    if (!created) return;
    setSelectedCustomer(created);
    setDiscovery(null);
    setQuery(created.customerNumber);
    setOpenSections(new Set(availableSections));
    recordActivity(created.id);
    setOnboardingId(null);
    // recordActivity is stable enough for this one-shot onboarding effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingId, companyCustomers, availableSections]);

  /**
   * Ends onboarding: collapse every workspace section, clear the locked customer
   * and any onboarding-created search/filter, and return /customers to its clean
   * landing state.
   */
  const finishOnboarding = () => {
    // Mark the active customer's onboarding complete so the badge and Onboard
    // Process step clear, then return /customers to its clean landing state.
    if (selectedCustomer && activeCustomer?.onboardingStatus === "in_progress") {
      updateCustomer(selectedCustomer.id, {
        onboardingStatus: "completed",
        onboardingCompletedAt: new Date().toISOString(),
      });
      toast({
        title: "Onboarding complete",
        description: `${selectedCustomer.name} has finished onboarding.`,
      });
    }
    setOpenSections(new Set());
    setSelectedCustomer(null);
    setQuery("");
    setDiscovery(null);
    setAreaFilter("all");
  };

  /**
   * Handles the create dialog's follow-up. "only" keeps the quick-entry flow
   * untouched; "onboarding" stages the new customer for the effect above.
   */
  const handleCustomerCreated = (customerId: string, mode: "only" | "onboarding") => {
    if (mode === "onboarding") setOnboardingId(customerId);
  };

  /** Accordion toggle: opening a section collapses any other open section. */
  const toggleSection = (key: DashboardSection) => {
    setOpenSections((cur) => {
      if (cur.has(key)) {
        const next = new Set(cur);
        next.delete(key);
        return next;
      }
      return new Set<DashboardSection>([key]);
    });
  };

  /** Expand all available sections, or collapse them all. Section 1 is unaffected. */
  const toggleExpandAll = () => {
    setOpenSections(allSectionsOpen ? new Set() : new Set(availableSections));
  };

  /** Ensures a section is open without collapsing others when already open. */
  const ensureSectionOpen = (key: DashboardSection) => {
    setOpenSections((cur) =>
      cur.has(key) ? cur : new Set<DashboardSection>([key]),
    );
  };

  /**
   * Header "+ Add" on the Protocols section: open the section (if needed) and
   * signal the embedded workspace to launch its New Protocol dialog, which
   * preselects the active customer when one is locked.
   */
  const handleAddProtocol = () => {
    ensureSectionOpen("protocols");
    setProtocolCreateToken((t) => t + 1);
  };

  const toggleStatus = (customer: Customer) => {
    const next = customer.status === "active" ? "inactive" : "active";
    updateCustomer(customer.id, { status: next });
    toast({
      title: next === "active" ? "Customer activated" : "Customer deactivated",
      description: `${customer.name} is now ${next}.`,
    });
  };

  const lifecycleCompanyId = lifecycleTarget?.companyId?.trim() ?? "";
  const lifecycleCustomerId = lifecycleTarget?.id?.trim() ?? "";

  const dependencyQuery = useQuery<CustomerDeleteDependencyResult>({
    queryKey: ["customer-delete-dependencies", lifecycleCompanyId, lifecycleCustomerId || null],
    queryFn: () =>
      fetchCustomerDeleteDependencyContext({
        customerId: lifecycleCustomerId,
        companyId: lifecycleCompanyId,
      }),
    enabled: Boolean(lifecycleCustomerId && lifecycleCompanyId),
    staleTime: 5_000,
    retry: 1,
  });

  // Dependency context is resolved from shared Supabase counts, not browser-local
  // Work Orders / booking queue, so online and preview agree before archiving.
  const lifecycleInfo = useMemo<EntityDeleteValidationResult | null>(() => {
    if (!lifecycleTarget) return null;
    if (dependencyQuery.data) return dependencyQuery.data.validation;
    if (dependencyQuery.isLoading || dependencyQuery.isFetching) {
      return {
        allowed: false,
        blockingFactors: ["dependency_check_loading"],
        reasons: ["Checking shared backend dependencies…"],
        blockedMessage: "Customer dependency check is still running.",
      };
    }
    return {
      allowed: false,
      blockingFactors: ["dependency_check_unavailable"],
      reasons: [
        "The shared backend dependency summary is unavailable right now. Archive remains the safe, non-destructive path.",
      ],
      blockedMessage:
        "Shared dependency summary is unavailable. Archive the customer to preserve the record.",
    };
  }, [lifecycleTarget, dependencyQuery.data, dependencyQuery.isLoading, dependencyQuery.isFetching]);

  const dependencyCounts = dependencyQuery.data?.counts;

  const totalDependencyCount = dependencyCounts
    ? dependencyCounts.workOrderCount +
      dependencyCounts.bookingQueueCount +
      dependencyCounts.missionLogEntryCount +
      dependencyCounts.timeReportCount +
      dependencyCounts.customerAgreementCount +
      dependencyCounts.timeBankWalletCount +
      dependencyCounts.visitOccurrenceCount +
      dependencyCounts.customerProtocolCount +
      dependencyCounts.protocolRunCount +
      dependencyCounts.mediaAssetCount +
      dependencyCounts.appUserLinkCount
    : 0;

  /** Archives or restores the customer in Supabase, preserving operational history. */
  const handleLifecycleAction = async (customer: Customer) => {
    const isRestore = customer.status === "archived";
    setLifecycleError(null);
    try {
      const scopeCompanyId = requireCustomerWriteScope(customer);
      setLifecyclePending(true);
      if (isRestore) {
        await customerMutations.restoreCustomer({
          customerId: customer.id,
          companyId: scopeCompanyId,
        });
      } else {
        await customerMutations.archiveCustomer({
          customerId: customer.id,
          companyId: scopeCompanyId,
        });
      }
      toast({
        title: isRestore ? "Customer restored" : "Customer archived",
        description: isRestore
          ? `${customer.name} is available in normal active lists again.`
          : `${customer.name} was archived. Their history is preserved.`,
      });
      if (!isRestore && selectedCustomer?.id === customer.id) setSelectedCustomer(null);
      setLifecycleTarget(null);
      setDiscovery((current) => (isRestore ? "all" : current === "archived" ? current : "all"));
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : isRestore
          ? "This customer could not be restored."
          : "This customer could not be archived.";
      setLifecycleError(message);
      toast({
        title: isRestore ? "Could not restore" : "Could not archive",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLifecyclePending(false);
    }
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Customers"
        description="Search, open, and manage customer workspaces."
        action={
          <div className="flex items-center gap-2">
            {canViewCustomerInvoices ? (
              <Button
                variant="outline"
                onClick={() => navigate("/modules/customer-invoices")}
              >
                <FileSpreadsheet className="h-4 w-4" /> Invoices
              </Button>
            ) : null}
            <Button
              variant={editMode ? "default" : "outline"}
              onClick={toggleEditMode}
            >
              <Pencil className="h-4 w-4" /> {editMode ? "Done editing" : "Edit mode"}
            </Button>
            {canManageSettings ? (
              <Button variant="outline" onClick={() => setAreaSetupOpen(true)}>
                <MapPin className="h-4 w-4" /> Area setup
              </Button>
            ) : null}
            <Button onClick={openCreate}>
              <UserCheck className="h-4 w-4" /> Add customer
            </Button>
          </div>
        }
      />

      {selectedCustomer ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Target className="h-5 w-5" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Selected customer
              </p>
              <p className="truncate text-sm font-semibold">{selectedCustomer.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openCustomerCard(selectedCustomer.id)}
            >
              <Eye className="h-4 w-4" /> Open customer card
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setSelectedCustomer(null)}
            >
              <X className="h-4 w-4" /> Clear selection
            </Button>
          </div>
        </div>
      ) : null}

      {/* Section 1 search & filters. Hidden once a customer is locked: the
          workspace is then scoped to that one customer, so cross-customer
          search, status chips, and the area filter would be misleading. */}
      {selectedCustomer ? null : (
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full max-w-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search customers by name, email or number…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {belowThreshold ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Type at least {DEFAULT_SEARCH_MIN_LENGTH} characters to search, or enter a
                customer number.
              </p>
            ) : null}
          </div>
          {query.trim().length > 0 || listActive ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearSearch}
              className="shrink-0"
            >
              <X className="h-4 w-4" /> Clear search
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {DISCOVERY_CHIPS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDiscovery((cur) => (cur === value ? null : value))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  discovery === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          {listActive ? (
            <span className="text-sm text-muted-foreground">
              {filtered.length} of {companyCustomers.length}
            </span>
          ) : null}
          {editMode ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              Edit mode — change fields inline, then save each row
            </span>
          ) : null}
        </div>
        {listActive ? (
          <div className="flex w-fit items-center gap-1 rounded-lg border border-border p-0.5">
            <span className="px-2 text-xs font-medium text-muted-foreground">Area</span>
            {(
              [
                ["all", "All"],
                ["missing", "Missing Area"],
                ["has", "Has Area"],
                ["suggested", "Suggested Area"],
                ["manual", "Manual Review"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setAreaFilter(value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  areaFilter === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      )}

      {listActive && filtered.length === 1 && !selectedCustomer && canViewProtocols ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Target className="h-5 w-5" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                One match
              </p>
              <p className="truncate text-sm font-semibold">{filtered[0].name}</p>
            </div>
          </div>
          <Button size="sm" onClick={() => selectForWorkspace(filtered[0])}>
            <Target className="h-4 w-4" /> Load data for selected customer
          </Button>
        </div>
      ) : null}

      {listActive ? (
        <>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Primary contact</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Customer Owner</TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1.5">
                  Area
                  {canManageSettings ? (
                    <button
                      type="button"
                      title="Manage areas"
                      aria-label="Manage areas"
                      onClick={() => setAreaSetupOpen(true)}
                      className="text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <UserCheck className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No customers yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((customer) => {
                const draft = getDraft(customer);
                const addr = primaryAddress(customer);
                const primaryContact = resolvePrimaryContact(customer);
                const contactName = primaryContact?.name ?? customer.mainContact ?? "";
                const rowPending = pendingRowSaves.has(customer.id);
                const rowError = rowSaveErrors[customer.id];
                return (
                  <TableRow
                    key={customer.id}
                    onClick={
                      editMode ? undefined : () => selectForWorkspace(customer)
                    }
                    className={`${editMode ? "" : "cursor-pointer"} ${
                      selectedCustomer?.id === customer.id ? "bg-primary/5" : ""
                    }`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/10 text-xs font-semibold text-warning">
                          {initials(customer.name)}
                        </div>
                        {/* Name is the only element in the row that navigates to
                            the Customer Card. Styled as an explicit link and
                            stops propagation so it never triggers row-select. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCustomerCard(customer.id);
                          }}
                          className="text-left font-medium text-slate-700 underline underline-offset-2 hover:text-primary"
                        >
                          {customer.name}
                        </button>
                      </div>
                    </TableCell>

                    {/* ID — visible customer number (numeric part of the stored "C-" value) */}
                    <TableCell className="text-muted-foreground">
                      <span className="font-mono text-xs">
                        {customerNumberDisplay(customer.customerNumber)}
                      </span>
                    </TableCell>

                    {/* Primary contact person */}
                    <TableCell className="text-muted-foreground">
                      {contactName ? (
                        <span className="block max-w-[160px] truncate" title={contactName}>
                          {contactName}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>

                    {/* Phone */}
                    <TableCell className="text-muted-foreground">
                      {editMode ? (
                        <Input
                          value={draft.phone}
                          onChange={(e) => patchDraft(customer, { phone: e.target.value })}
                          placeholder="Phone"
                          className="h-8 w-36"
                        />
                      ) : customer.phone?.trim() ? (
                        customer.phone
                      ) : (
                        "—"
                      )}
                    </TableCell>

                    {/* Email */}
                    <TableCell className="text-muted-foreground">
                      {editMode ? (
                        <Input
                          type="email"
                          value={draft.email}
                          onChange={(e) => patchDraft(customer, { email: e.target.value })}
                          placeholder="Email"
                          className="h-8 w-48"
                        />
                      ) : customer.email?.trim() ? (
                        customer.email
                      ) : (
                        "—"
                      )}
                    </TableCell>

                    {/* Address (street) */}
                    <TableCell className="text-muted-foreground">
                      {editMode ? (
                        <Input
                          value={draft.street}
                          onChange={(e) => patchDraft(customer, { street: e.target.value })}
                          placeholder="Street"
                          className="h-8 w-44"
                        />
                      ) : addr?.street?.trim() ? (
                        <span className="block max-w-[180px] truncate" title={addr.street}>
                          {addr.street}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>

                    {/* City / postal city */}
                    <TableCell className="text-muted-foreground">
                      {editMode ? (
                        <Select
                          value={draft.postalCityId === "" ? NONE : draft.postalCityId}
                          onValueChange={(v) =>
                            patchDraft(customer, { postalCityId: v === NONE ? "" : v })
                          }
                        >
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue placeholder="City" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Not assigned</SelectItem>
                            {companyPostalCities.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        addressCityLabel(addr, postalCities) || "—"
                      )}
                    </TableCell>

                    {/* Customer owner */}
                    <TableCell className="text-muted-foreground">
                      {editMode ? (
                        <Select
                          value={draft.ownerId === "" ? NONE : draft.ownerId}
                          onValueChange={(v) =>
                            patchDraft(customer, { ownerId: v === NONE ? "" : v })
                          }
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue placeholder="Owner" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Not assigned</SelectItem>
                            {companyEmployees.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        ownerName(customer) || "Not assigned"
                      )}
                    </TableCell>

                    {/* Area */}
                    <TableCell className="text-muted-foreground">
                      {editMode ? (
                        <Select
                          value={draft.areaId === "" ? NONE : draft.areaId}
                          onValueChange={(v) =>
                            patchDraft(customer, { areaId: v === NONE ? "" : v })
                          }
                        >
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue placeholder="Area" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Not assigned</SelectItem>
                            {companyAreas.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        (() => {
                          const resolved = resolveCustomerArea(customer, areas);
                          if (resolved) return resolved.name;
                          const suggested = resolveSuggestedArea(customer, areas, postalCities);
                          if (suggested) {
                            return (
                              <span className="inline-flex items-center gap-2 text-xs">
                                <span>
                                  Suggested:{" "}
                                  <span className="font-medium">{suggested.name}</span>
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs"
                                  disabled={rowPending}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void applySuggestedArea(customer, suggested.id, suggested.name);
                                  }}
                                >
                                  Apply
                                </Button>
                              </span>
                            );
                          }
                          return "Not assigned";
                        })()
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={customer.status} />
                        {customer.onboardingStatus === "in_progress" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            <Rocket className="h-3 w-3" /> Onboarding
                          </span>
                        ) : null}
                      </div>
                    </TableCell>

                    {/* Actions */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {editMode ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              className="h-8 w-8"
                              title={rowPending ? "Saving row" : "Save row"}
                              aria-label={rowPending ? "Saving row" : "Save row"}
                              disabled={rowPending}
                              onClick={() => void saveRow(customer)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Discard row changes"
                              aria-label="Discard row changes"
                              disabled={rowPending}
                              onClick={() => cancelRow(customer)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          {rowPending ? (
                            <span className="text-[11px] text-muted-foreground">Saving…</span>
                          ) : null}
                          {rowError ? (
                            <span role="alert" className="max-w-[180px] text-[11px] text-destructive">
                              {rowError}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openCustomerCard(customer.id)}>
                              <Eye className="h-4 w-4" /> Open customer card
                            </DropdownMenuItem>
                            {canViewProtocols ? (
                              <DropdownMenuItem onClick={() => selectForWorkspace(customer)}>
                                <Target className="h-4 w-4" /> Set as active customer
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onClick={() => openEdit(customer)}>
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewAs(customer)}>
                              <Eye className="h-4 w-4" /> View as customer
                            </DropdownMenuItem>
                            {customer.status !== "archived" ? (
                              <DropdownMenuItem
                                onClick={() => toggleStatus(customer)}
                                className={
                                  customer.status === "active"
                                    ? "text-destructive focus:text-destructive"
                                    : ""
                                }
                              >
                                <Power className="h-4 w-4" />
                                {customer.status === "active" ? "Deactivate" : "Activate"}
                              </DropdownMenuItem>
                            ) : null}
                            {canManageLifecycle ? (
                              <DropdownMenuItem
                                onClick={() => setLifecycleTarget(customer)}
                                className={customer.status === "archived" ? "" : "text-destructive focus:text-destructive"}
                              >
                                {customer.status === "archived" ? (
                                  <ArchiveRestore className="h-4 w-4" />
                                ) : (
                                  <Archive className="h-4 w-4" />
                                )}
                                {customer.status === "archived" ? "Restore…" : "Archive…"}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                          </DropdownMenu>
                          {rowPending ? (
                            <span className="text-[11px] text-muted-foreground">Saving…</span>
                          ) : null}
                          {rowError ? (
                            <span role="alert" className="max-w-[180px] text-[11px] text-destructive">
                              {rowError}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationControl
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        totalItems={totalItems}
        startIndex={startIndex}
        endIndex={endIndex}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        itemLabel="customers"
      />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/10 text-warning">
            <Search className="h-6 w-6" />
          </div>
          <p className="mt-4 text-base font-semibold">Find a customer to get started</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Search by name, email or customer number — or use a shortcut to browse Recent,
            Active, Paused, or All customers.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {DISCOVERY_CHIPS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant="outline"
                size="sm"
                onClick={() => setDiscovery(value)}
              >
                <Icon className="h-4 w-4" /> {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {availableSections.length > 0 ? (
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Customer workspace
          </p>
          <Button variant="outline" size="sm" onClick={toggleExpandAll}>
            {allSectionsOpen ? (
              <>
                <Minimize2 className="h-4 w-4" /> Collapse all sections
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4" /> Expand all sections
              </>
            )}
          </Button>
        </div>
      ) : null}

      {/* Onboard Process — only while the active customer is mid-onboarding */}
      {activeCustomer?.onboardingStatus === "in_progress" ? (
        <WorkspaceSection
          title="Onboard Process"
          subtitle="Guided setup for this new customer"
          icon={<Rocket className="h-5 w-5" />}
          open={openSections.has("onboarding")}
          onToggle={() => toggleSection("onboarding")}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Rocket className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Onboarding in progress
                </p>
                <p className="text-sm text-muted-foreground">
                  Work through the sections below to complete this customer&rsquo;s setup. You
                  can also later return and complete the information here or via the Customer
                  card.
                </p>
              </div>
            </div>
            <ol className="space-y-1.5 text-sm text-muted-foreground">
              <li>1. Confirm customer details, addresses and contacts.</li>
              <li>2. Set cleaning days &amp; times (acceptable and preferred windows).</li>
              <li>3. Add notes, documents and media as needed.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                onClick={() => activeCustomer && updateCustomer(activeCustomer.id, {
                  onboardingStatus: "completed",
                  onboardingCompletedAt: new Date().toISOString(),
                })}
              >
                <CheckCircle2 className="h-4 w-4" /> Mark onboarding complete
              </Button>
              <span className="text-xs text-muted-foreground">
                You can finish onboarding here or with the button at the bottom of the workspace.
              </span>
            </div>
          </div>
        </WorkspaceSection>
      ) : null}

      {/* Section 2 — Customer Details (reuses the Customer Card's contact tab) */}
      <WorkspaceSection
        title="Customer Details"
        subtitle="Details, addresses and contact people"
        icon={<Contact className="h-5 w-5" />}
        open={openSections.has("details")}
        onToggle={() => toggleSection("details")}
      >
        {activeCustomer ? (
          <ContactInformationTab customer={activeCustomer} />
        ) : (
          <NeedsCustomerHint />
        )}
      </WorkspaceSection>

      {/* Protocols — works unscoped (Mode A) or scoped to the active customer */}
      {canViewProtocols ? (
        <WorkspaceSection
          title="Protocols"
          subtitle="Search and manage customer cleaning protocols"
          icon={<ScrollText className="h-5 w-5" />}
          open={openSections.has("protocols")}
          onToggle={() => toggleSection("protocols")}
          headerAction={
            canCreateProtocols ? (
              <Button size="sm" onClick={handleAddProtocol}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            ) : null
          }
        >
          <CustomerProtocolsWorkspace
            embedded
            selectedCustomerId={selectedCustomer?.id ?? null}
            selectedCustomerName={selectedCustomer?.name}
            openCreateToken={protocolCreateToken}
          />
        </WorkspaceSection>
      ) : null}

      {/* Cleaning Days & Times (reuses the Customer Card's scheduling tab) */}
      <WorkspaceSection
        title="Cleaning Days & Times"
        subtitle="Configure cleaning schedule preferences"
        icon={<CalendarClock className="h-5 w-5" />}
        open={openSections.has("scheduling")}
        onToggle={() => toggleSection("scheduling")}
      >
        {activeCustomer ? (
          <SchedulingTab customer={activeCustomer} />
        ) : (
          <NeedsCustomerHint />
        )}
      </WorkspaceSection>

      {/* Notes (reuses the Customer Card's notes tab) */}
      <WorkspaceSection
        title="Notes"
        subtitle="Capture details during customer setup calls"
        icon={<FileText className="h-5 w-5" />}
        open={openSections.has("notes")}
        onToggle={() => toggleSection("notes")}
      >
        {activeCustomer ? (
          <NotesTab customer={activeCustomer} />
        ) : (
          <NeedsCustomerHint />
        )}
      </WorkspaceSection>

      {/* Documents / Media — reuses the Customer Card's media library */}
      <WorkspaceSection
        title="Documents / Media"
        subtitle="Customer images, documents and media"
        icon={<FolderOpen className="h-5 w-5" />}
        open={openSections.has("documents")}
        onToggle={() => toggleSection("documents")}
      >
        {activeCustomer ? (
          <CustomerMediaLibrary
            customerId={activeCustomer.id}
            companyId={activeCustomer.companyId}
          />
        ) : (
          <NeedsCustomerHint />
        )}
      </WorkspaceSection>

      {/* Keys & Alarms — UX placeholder only for this phase */}
      <WorkspaceSection
        title="Keys & Alarms"
        subtitle="Access setup — coming later"
        icon={<KeyRound className="h-5 w-5" />}
        open={openSections.has("keys")}
        onToggle={() => toggleSection("keys")}
      >
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <KeyRound className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold">Keys & Alarms</h3>
          <p className="text-sm text-muted-foreground">This section will be used for:</p>
          <ul className="text-sm text-muted-foreground">
            <li>Keys</li>
            <li>Alarm codes</li>
            <li>Access instructions</li>
            <li>Entry procedures</li>
          </ul>
          <span className="mt-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Coming later
          </span>
        </div>
      </WorkspaceSection>

      {/* Workspace footer: the Selected-customer banner already owns the
          "Open customer card" action, so the footer keeps only the onboarding
          wrap-up control. */}
      {selectedCustomer ? (
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button onClick={finishOnboarding}>
            <CheckCircle2 className="h-4 w-4" /> Finish onboarding
          </Button>
        </div>
      ) : null}

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        customer={editing}
        onCustomerCreated={handleCustomerCreated}
      />

      {canManageSettings ? (
        <CustomerAreaSetupDialog
          open={areaSetupOpen}
          onOpenChange={setAreaSetupOpen}
          companyId={companyId}
        />
      ) : null}

      <AlertDialog
        open={Boolean(lifecycleTarget)}
        onOpenChange={(open) => {
          if (!open && !lifecyclePending) {
            setLifecycleTarget(null);
            setLifecycleError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifecycleTarget?.status === "archived" ? "Restore customer?" : "Archive customer?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lifecycleTarget?.status === "archived"
                ? `${lifecycleTarget.name} will be restored and available in normal active lists and selectors again. Historical work, agreements, time bank, protocols, media, and portal links remain unchanged.`
                : lifecycleTarget
                  ? `${lifecycleTarget.name} will be archived. Historical work, agreements, time bank, protocols, media, and portal links are preserved unchanged. Archived customers are hidden from normal active views and selectors unless the Archived filter is enabled.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dependencyCounts ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {totalDependencyCount > 0
                  ? `${totalDependencyCount} related records found — archive is the safe action.`
                  : "No related records found — hard delete is still deferred for this slice."}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["Work orders", dependencyCounts.workOrderCount],
                  ["Booking lists", dependencyCounts.bookingQueueCount],
                  ["Mission log entries", dependencyCounts.missionLogEntryCount],
                  ["Time reports", dependencyCounts.timeReportCount],
                  ["Customer agreements", dependencyCounts.customerAgreementCount],
                  ["Time bank wallets", dependencyCounts.timeBankWalletCount],
                  ["Visit occurrences", dependencyCounts.visitOccurrenceCount],
                  ["Customer protocols", dependencyCounts.customerProtocolCount],
                  ["Protocol runs", dependencyCounts.protocolRunCount],
                  ["Media assets", dependencyCounts.mediaAssetCount],
                  ["Portal links", dependencyCounts.appUserLinkCount],
                ].map(([label, count]) => (
                  <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-background/70 px-3 py-2">
                    <span>{label}</span>
                    <span className="font-medium text-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {lifecycleInfo && !lifecycleInfo.allowed && lifecycleInfo.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 rounded-lg bg-muted/50 px-5 py-3 text-sm text-muted-foreground">
              {lifecycleInfo.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {lifecycleError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {lifecycleError}
            </div>
          ) : null}
          <AlertDialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              disabled={lifecyclePending}
              onClick={() => {
                setLifecycleTarget(null);
                setLifecycleError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={lifecyclePending || !lifecycleCustomerId || !lifecycleCompanyId}
              onClick={() => {
                if (lifecycleTarget) void handleLifecycleAction(lifecycleTarget);
              }}
            >
              {lifecycleTarget?.status === "archived" ? (
                <ArchiveRestore className="h-4 w-4" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              {lifecyclePending
                ? lifecycleTarget?.status === "archived"
                  ? "Restoring…"
                  : "Archiving…"
                : lifecycleTarget?.status === "archived"
                  ? "Restore customer"
                  : "Archive customer"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
