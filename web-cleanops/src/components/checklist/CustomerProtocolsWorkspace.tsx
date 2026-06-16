import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ClipboardList,
  Copy,
  ExternalLink,
  Layers,
  ListChecks,
  MoreHorizontal,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  SquareStack,
  UserCheck,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProtocolDialog } from "@/components/checklist/ProtocolDialog";
import { ProtocolStatusBadge } from "@/components/checklist/ProtocolStatusBadge";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import type { CustomerProtocol } from "@/types";

/** Counts active rooms and tasks within a protocol. */
function protocolStats(p: CustomerProtocol): {
  floors: number;
  rooms: number;
  activeRooms: number;
  activeTasks: number;
} {
  let rooms = 0;
  let activeRooms = 0;
  let activeTasks = 0;
  for (const f of p.floors) {
    for (const r of f.rooms) {
      rooms += 1;
      if (r.active) activeRooms += 1;
      activeTasks += r.tasks.filter((k) => k.state === "active").length;
    }
  }
  return { floors: p.floors.length, rooms, activeRooms, activeTasks };
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
  { value: "inactive_customer", label: "Inactive customer" },
];

const DATE_FILTERS: { value: string; label: string; days: number | null }[] = [
  { value: "all", label: "Any time", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
];

interface ProtocolCardProps {
  protocol: CustomerProtocol;
  customerName: string;
  customerNumber?: string;
  companyName?: string;
  /**
   * Hides the per-card customer chip. Used in scoped mode where the active
   * customer is already shown once in the selected-customer banner above
   * Section 1, so repeating it on every card is redundant noise.
   */
  hideCustomer?: boolean;
  editable: boolean;
  canCreate: boolean;
  canReactivate: boolean;
  onOpen: () => void;
  onOpenCustomer?: () => void;
  onDuplicate?: () => void;
  onReactivate?: () => void;
  onToggleArchive?: () => void;
}

function ProtocolCard({
  protocol,
  customerName,
  customerNumber,
  companyName,
  hideCustomer = false,
  editable,
  canCreate,
  canReactivate,
  onOpen,
  onOpenCustomer,
  onDuplicate,
  onReactivate,
  onToggleArchive,
}: ProtocolCardProps) {
  const stats = protocolStats(protocol);
  const hasMenu = editable || canCreate || onOpenCustomer;
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScrollText className="h-5 w-5" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{protocol.name}</p>
            <p className="text-xs text-muted-foreground">Updated {formatDate(protocol.updatedAt)}</p>
          </div>
        </div>

        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}>
                <ScrollText className="h-4 w-4" /> Open protocol
              </DropdownMenuItem>
              {onOpenCustomer ? (
                <DropdownMenuItem onClick={onOpenCustomer}>
                  <ExternalLink className="h-4 w-4" /> Open customer
                </DropdownMenuItem>
              ) : null}
              {canCreate && onDuplicate ? (
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-4 w-4" /> Duplicate
                </DropdownMenuItem>
              ) : null}
              {canReactivate && onReactivate ? (
                <DropdownMenuItem onClick={onReactivate}>
                  <RotateCcw className="h-4 w-4" /> Reactivate
                </DropdownMenuItem>
              ) : null}
              {editable && onToggleArchive ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onToggleArchive}
                    className={
                      protocol.status === "archived"
                        ? ""
                        : "text-destructive focus:text-destructive"
                    }
                  >
                    {protocol.status === "archived" ? (
                      <>
                        <ArchiveRestore className="h-4 w-4" /> Restore
                      </>
                    ) : (
                      <>
                        <Archive className="h-4 w-4" /> Archive
                      </>
                    )}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {protocol.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{protocol.description}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ProtocolStatusBadge status={protocol.status} />
        {hideCustomer ? null : (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            <UserCheck className="h-3 w-3" /> {customerName}
            {customerNumber ? (
              <span className="text-muted-foreground">· {customerNumber}</span>
            ) : null}
          </span>
        )}
        {companyName ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <Building2 className="h-3 w-3" /> {companyName}
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        From template: <span className="font-medium">{protocol.sourceTemplateName}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> {stats.floors} floors
        </span>
        <span className="inline-flex items-center gap-1.5">
          <SquareStack className="h-3.5 w-3.5" /> {stats.activeRooms}/{stats.rooms} rooms active
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" /> {stats.activeTasks} tasks active
        </span>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <Button variant="outline" size="sm" onClick={onOpen}>
          {editable ? "Open protocol" : "View protocol"}
        </Button>
      </div>
    </div>
  );
}

interface CustomerProtocolsWorkspaceProps {
  /**
   * When embedded inside another page (e.g. the Customers workspace as
   * "Section 2"), the header renders as a lighter section title instead of a
   * full PageHeader, since the host page already owns the primary heading.
   */
  embedded?: boolean;
  /**
   * Optional selected-customer context supplied by the Customers workspace.
   * When present (Mode B), the protocol set is scoped to this customer and a
   * "Load protocols for selected customer" affordance replaces the search-first
   * gate. When absent (Mode A), behaviour is unchanged: independent search and
   * filters across all visible protocols.
   */
  selectedCustomerId?: string | null;
  /** Display name for the selected customer (used in the context panel). */
  selectedCustomerName?: string;
  /**
   * Embedded-only trigger. When this number increments, the New Protocol dialog
   * opens. Lets the host section's header "+ Add" button launch creation
   * (preselecting the active customer) without lifting dialog state out.
   */
  openCreateToken?: number;
}

/**
 * The Customer Protocols surface — search, filters, and protocol cards.
 *
 * Shared by the standalone `/modules/checklist-manager/protocols` route and the
 * inline "Section 2" of the Customers workspace so both stay in lock-step. The
 * outer `DashboardLayout` and (for the standalone page) `ChecklistTabs` are
 * supplied by the caller.
 */
export function CustomerProtocolsWorkspace({
  embedded = false,
  selectedCustomerId = null,
  selectedCustomerName,
  openCreateToken = 0,
}: CustomerProtocolsWorkspaceProps) {
  const {
    currentUser,
    hasPermission,
    canAccessModule,
    getVisibleProtocols,
    canEditProtocol,
    customers,
    companies,
    users,
    setProtocolArchived,
    duplicateProtocol,
    updateProtocol,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  const [inputValue, setInputValue] = useState<string>("");
  const [committed, setCommitted] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  // Mode B only: whether the user has explicitly loaded the selected customer's
  // protocols. Resets whenever the selected customer changes.
  const [loadedScoped, setLoadedScoped] = useState<boolean>(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const scopedMode = Boolean(selectedCustomerId);
  // Embedded + a locked customer = a single-customer workspace panel. We then
  // hide the search box and filters (cross-customer queries don't apply) and
  // surface the customer's protocols directly without a "Load" gate.
  const compactScoped = embedded && scopedMode;

  const allVisible = useMemo(
    () => (currentUser ? getVisibleProtocols(currentUser) : []),
    [currentUser, getVisibleProtocols],
  );

  // In scoped mode the entire surface (filter options, search, cards) operates
  // only on the selected customer's protocols. In Mode A it's the full set.
  const visible = useMemo(
    () =>
      selectedCustomerId
        ? allVisible.filter((p) => p.customerId === selectedCustomerId)
        : allVisible,
    [allVisible, selectedCustomerId],
  );

  // Switching the selected customer (or leaving scoped mode) clears any prior
  // in-progress selection. In embedded scoped mode the customer's protocols
  // auto-load (no "Load" gate); the standalone page keeps its explicit load.
  useEffect(() => {
    setLoadedScoped(embedded && Boolean(selectedCustomerId));
    setSelectedId(null);
    setCommitted(false);
  }, [selectedCustomerId, embedded]);

  // Host "+ Add" button: open the New Protocol dialog when the token advances.
  useEffect(() => {
    if (openCreateToken > 0) setDialogOpen(true);
  }, [openCreateToken]);

  // Access control beyond the UI.
  if (!currentUser || !hasPermission("customer_protocols.view")) return <AccessDenied />;
  if (!isSuperAdmin && !canAccessModule(currentUser, "checklist-manager")) {
    return <AccessDenied />;
  }

  const customerOf = (id: string) => customers.find((c) => c.id === id);
  const customerName = (id: string): string => customerOf(id)?.name ?? "Unknown customer";
  const companyName = (id: string): string | undefined =>
    companies.find((c) => c.id === id)?.name;
  const creatorName = (id?: string | null): string =>
    users.find((u) => u.id === id)?.name ?? "Unknown";

  // Filter option sources, derived from the visible set.
  const templateOptions = useMemo(() => {
    const map = new Map<string, string>();
    visible.forEach((p) => map.set(p.sourceTemplateId, p.sourceTemplateName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [visible]);

  const creatorOptions = useMemo(() => {
    const ids = new Set<string>();
    visible.forEach((p) => p.createdBy && ids.add(p.createdBy));
    return [...ids].map((id) => [id, creatorName(id)] as const).sort((a, b) => a[1].localeCompare(b[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, users]);

  const trimmed = inputValue.trim();
  const isNumericQuery = /^\d+$/.test(trimmed);
  // Numbers search immediately; text needs at least 5 characters.
  const shouldSearch = isNumericQuery ? trimmed.length >= 1 : trimmed.length >= 5;

  // Protocols constrained by the active filters; the search runs on top of this.
  const filteredByFilters = useMemo(() => {
    const dateDays = DATE_FILTERS.find((d) => d.value === dateFilter)?.days ?? null;
    const cutoff = dateDays ? Date.now() - dateDays * 86400000 : null;
    return visible.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (templateFilter !== "all" && p.sourceTemplateId !== templateFilter) return false;
      if (creatorFilter !== "all" && p.createdBy !== creatorFilter) return false;
      if (cutoff && new Date(p.createdAt).getTime() < cutoff) return false;
      return true;
    });
  }, [visible, statusFilter, templateFilter, creatorFilter, dateFilter]);

  const searchMatches = useMemo(() => {
    if (!shouldSearch) return [];
    const q = trimmed.toLowerCase();
    return filteredByFilters.filter((p) => {
      const cust = customerOf(p.customerId);
      const number = cust?.customerNumber ?? "";
      if (isNumericQuery) {
        // Match the exact digits entered against the customer number.
        return number.replace(/\D/g, "").includes(trimmed);
      }
      const haystack = [p.name, cust?.name ?? "", number].join(" ").toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredByFilters, trimmed, isNumericQuery, shouldSearch, customers]);

  const selectedProtocol = selectedId
    ? visible.find((p) => p.id === selectedId) ?? null
    : null;

  const openEditor = (p: CustomerProtocol) =>
    navigate(`/modules/checklist-manager/protocols/${p.id}`);

  const toggleArchive = (p: CustomerProtocol) => {
    const archived = p.status !== "archived";
    const result = setProtocolArchived(p.id, archived);
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: archived ? "Protocol archived" : "Protocol restored",
      description: `${p.name} has been ${archived ? "archived" : "restored"}.`,
    });
  };

  const duplicate = (p: CustomerProtocol) => {
    const result = duplicateProtocol(p.id);
    if (!result.ok || !result.protocol) {
      toast({
        title: "Couldn't duplicate",
        description: result.error ?? "Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Protocol duplicated", description: `“${result.protocol.name}” created as a draft.` });
    openEditor(result.protocol);
  };

  const reactivate = (p: CustomerProtocol) => {
    const result = updateProtocol(p.id, { status: "draft" });
    if (!result.ok) {
      toast({ title: "Couldn't reactivate", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Protocol reactivated",
      description: `${p.name} is back to draft. Set it active when ready.`,
    });
  };

  const onInputChange = (v: string) => {
    setInputValue(v);
    setSelectedId(null);
    setCommitted(false);
    setDropdownOpen(true);
  };

  const runSearch = () => {
    if (!shouldSearch) return;
    setSelectedId(null);
    setCommitted(true);
    setDropdownOpen(false);
  };

  const onSelectResult = (p: CustomerProtocol) => {
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    setSelectedId(p.id);
    setCommitted(false);
    setDropdownOpen(false);
  };

  const clearSelection = () => {
    setSelectedId(null);
    setCommitted(false);
  };

  const canCreate = !isSuperAdmin && hasPermission("customer_protocols.create");
  const canOpenCustomer = hasPermission("users.manage");

  const newButton = canCreate ? (
    embedded ? (
      <Button size="sm" onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    ) : (
      <Button onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4" /> New protocol
      </Button>
    )
  ) : undefined;

  const filtersActive =
    statusFilter !== "all" ||
    templateFilter !== "all" ||
    creatorFilter !== "all" ||
    dateFilter !== "all";

  const clearFilters = () => {
    setStatusFilter("all");
    setTemplateFilter("all");
    setCreatorFilter("all");
    setDateFilter("all");
  };

  // A search action has happened: either a result was selected, or the user
  // committed a query (Enter / Search button). Nothing renders before that.
  const showingResults = committed && shouldSearch;
  // In scoped mode, the "Load protocols" action surfaces the customer's full
  // set without requiring a search first.
  const showingScoped = scopedMode && loadedScoped;
  const hasSearched = Boolean(selectedProtocol) || showingResults || showingScoped;
  // A selected customer is in context but its protocols haven't been loaded yet
  // and no search/selection is active — the empty state offers the load action.
  const scopedNeedsLoad =
    scopedMode && !loadedScoped && !selectedProtocol && !showingResults;
  const cards: CustomerProtocol[] = selectedProtocol
    ? [selectedProtocol]
    : showingResults
      ? searchMatches
      : showingScoped
        ? filteredByFilters
        : [];

  const description = isSuperAdmin
    ? "View customer protocols across every company. Open a customer to support them."
    : "Create and manage customer-specific cleaning protocols. A customer can have many.";

  return (
    <>
      {embedded ? (
        /* The active customer is owned by the selected-customer banner above
           Section 1, and the "+ Add" action now lives on the host section's
           header row, so the embedded surface renders no inline header. In
           compact scoped mode a neutral count is shown above the cards instead. */
        null
      ) : (
        <>
          <PageHeader title="Customer Protocols" description={description} action={newButton} />

          {/* Mode B: selected-customer context panel (standalone only) */}
          {scopedMode ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    Protocols for {selectedCustomerName ?? "selected customer"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {loadedScoped
                      ? `${filteredByFilters.length} protocol${filteredByFilters.length === 1 ? "" : "s"} for this customer.`
                      : "Scoped to the selected customer. Search below stays within this customer."}
                  </p>
                </div>
              </div>
              {loadedScoped ? (
                <Button variant="outline" size="sm" onClick={() => setLoadedScoped(false)}>
                  Hide protocols
                </Button>
              ) : (
                <Button size="sm" onClick={() => setLoadedScoped(true)}>
                  <ClipboardList className="h-4 w-4" /> Load protocols for selected customer
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* Search with autocomplete — hidden in compact scoped mode, where the
          panel is locked to one customer and cross-customer search is moot. */}
      {compactScoped ? null : (
      <div className="mb-3 w-full max-w-xl">
        <div className="flex gap-2">
          <div
            className="relative flex-1"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                blurTimeout.current = setTimeout(() => setDropdownOpen(false), 120);
              }
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by customer name, number or protocol…"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onFocus={() => {
                if (shouldSearch) setDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setDropdownOpen(false);
              }}
              className="pl-9"
            />
            {dropdownOpen && shouldSearch ? (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                {searchMatches.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    No customer protocols found.
                  </div>
                ) : (
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {searchMatches.slice(0, 8).map((p) => {
                      const cust = customerOf(p.customerId);
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onSelectResult(p)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-accent"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {cust?.name ?? "Unknown customer"}
                                {cust?.customerNumber ? (
                                  <span className="text-muted-foreground">
                                    {" "}· {cust.customerNumber}
                                  </span>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{p.name}</p>
                            </div>
                            <ProtocolStatusBadge status={p.status} />
                          </button>
                        </li>
                      );
                    })}
                    {searchMatches.length > 8 ? (
                      <li className="px-4 py-2 text-xs text-muted-foreground">
                        +{searchMatches.length - 8} more — press Enter to see all
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
          <Button onClick={runSearch} disabled={!shouldSearch} className="shrink-0">
            <Search className="h-4 w-4" /> Search
          </Button>
        </div>
        {!shouldSearch && trimmed.length > 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Type at least 5 letters, or enter a customer number.
          </p>
        ) : null}
      </div>
      )}

      {/* Filters — hidden in compact scoped mode. */}
      {compactScoped ? null : (
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={templateFilter} onValueChange={setTemplateFilter}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder="Template" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {templateOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={creatorFilter} onValueChange={setCreatorFilter}>
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder="Created by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any creator</SelectItem>
            {creatorOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Created" />
          </SelectTrigger>
          <SelectContent>
            {DATE_FILTERS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            Clear filters
          </Button>
        ) : null}

        {shouldSearch ? (
          <span className="ml-auto text-sm text-muted-foreground">
            {searchMatches.length} match{searchMatches.length === 1 ? "" : "es"}
          </span>
        ) : null}
      </div>
      )}

      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          {scopedNeedsLoad ? (
            <>
              <p className="mt-4 text-sm font-medium">Load protocols</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Load cleaning protocols to view and manage them.
              </p>
              <Button size="sm" className="mt-4" onClick={() => setLoadedScoped(true)}>
                <ClipboardList className="h-4 w-4" /> Load protocols
              </Button>
            </>
          ) : showingScoped ? (
            <>
              <p className="mt-4 text-sm font-medium">No protocols yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a protocol to get started.
              </p>
              {canCreate ? (
                <Button size="sm" className="mt-4" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" /> Create a protocol
                </Button>
              ) : null}
            </>
          ) : (
            <p className="mt-4 text-sm font-medium">
              {hasSearched
                ? "No customer protocols found."
                : scopedMode
                  ? "Load protocols above, or search to narrow down."
                  : "No search performed. Search by customer name, customer number or protocol name."}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedProtocol
                ? "Selected protocol"
                : showingScoped
                  ? `${filteredByFilters.length} protocol${filteredByFilters.length === 1 ? "" : "s"}`
                  : `${searchMatches.length} result${searchMatches.length === 1 ? "" : "s"}`}
            </span>
            {compactScoped ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={clearSelection}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((p) => {
            const editable = canEditProtocol(currentUser, p);
            const customerActive = customerOf(p.customerId)?.status === "active";
            return (
              <ProtocolCard
                key={p.id}
                protocol={p}
                customerName={customerName(p.customerId)}
                customerNumber={customerOf(p.customerId)?.customerNumber}
                companyName={isSuperAdmin ? companyName(p.companyId) : undefined}
                hideCustomer={scopedMode}
                editable={editable}
                canCreate={canCreate}
                canReactivate={editable && p.status === "inactive_customer" && customerActive}
                onOpen={() => openEditor(p)}
                onOpenCustomer={canOpenCustomer ? () => navigate("/customers") : undefined}
                onDuplicate={() => duplicate(p)}
                onReactivate={() => reactivate(p)}
                onToggleArchive={editable ? () => toggleArchive(p) : undefined}
              />
            );
          })}
          </div>
        </>
      )}

      <ProtocolDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={openEditor}
        initialCustomerId={selectedCustomerId ?? undefined}
      />
    </>
  );
}
