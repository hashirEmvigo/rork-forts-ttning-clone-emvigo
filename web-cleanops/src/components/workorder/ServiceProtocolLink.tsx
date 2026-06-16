import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardCheck,
  ExternalLink,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CustomerProtocolDialog } from "@/components/customer/CustomerProtocolDialog";
import type { CustomerProtocolDialogSubmit } from "@/components/customer/CustomerProtocolDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import {
  resolveCustomerProtocolForService,
  resolveCustomerProtocols,
  resolveProtocolRun,
  resolveProtocolSections,
  resolveProtocolItems,
} from "@/lib/checklistSettingsResolver";
import { generateCustomerProtocol, createBlankCustomerProtocol } from "@/lib/customerProtocolGenerator";
import { generateProtocolRunFromCustomerProtocol } from "@/lib/protocolRunGenerator";
import { isItemResolved } from "@/lib/runStatusRollup";
import type {
  CustomerProtocolV2,
  ProtocolRunStatus,
  ProtocolRunV2,
  WorkOrderServiceRow,
} from "@/types";

const RUN_STATUS_LABEL: Record<ProtocolRunStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

interface ServiceProtocolLinkProps {
  /** Company that owns the work order's customer. */
  companyId: string;
  /** Customer the work order belongs to (scopes available protocols). */
  customerId: string;
  /** The work order containing the service row. */
  workOrderId: string;
  /** The service row whose protocol link is managed. */
  serviceRow: WorkOrderServiceRow;
  /** Temporarily keeps protocol writes read-only while service-row RPC cutover proceeds. */
  mutationsDisabled?: boolean;
}

const DUPLICATE_MESSAGE = "A protocol with this name already exists.";

/**
 * AO quick action (Phase 3D, Ticket 36): link a single customer-specific
 * {@link CustomerProtocolV2} to a work-order service row as its recommended
 * cleaning protocol. Reads protocols through the resolver and persists the link
 * via {@link useApp().updateWorkOrderServiceRow}. Selecting a protocol does NOT
 * generate a ProtocolRun — this only establishes the recommendation.
 *
 * States:
 *  - Linked → "Recommended Protocol" card with Open / Change / Remove.
 *  - Unlinked + protocols exist → "Link Cleaning Protocol" → selector.
 *  - Unlinked + no protocols → empty-state with create-from-template /
 *    create-empty shortcuts.
 *
 * Permission-gated: viewing requires `customer_protocols.view`; linking/removing
 * requires `customer_protocols.edit`; creating requires `customer_protocols.create`.
 */
export function ServiceProtocolLink({
  companyId,
  customerId,
  workOrderId,
  serviceRow,
  mutationsDisabled = false,
}: ServiceProtocolLinkProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentUser, getUserPermissions, updateWorkOrderServiceRow } = useApp();

  const permissions = currentUser ? getUserPermissions(currentUser) : [];
  const canView = permissions.includes("customer_protocols.view");
  const canLink = permissions.includes("customer_protocols.edit") && !mutationsDisabled;
  const canCreate = permissions.includes("customer_protocols.create") && !mutationsDisabled;
  const canExecute = permissions.includes("checklists.execution.view");
  const canGenerateRun = canExecute && !mutationsDisabled;

  // Resolver reads are non-reactive (localStorage); re-read whenever the linked
  // id changes or a create bumps the tick.
  const [tick, setTick] = useState<number>(0);
  const linked = useMemo<CustomerProtocolV2 | null>(
    () =>
      resolveCustomerProtocolForService(
        companyId,
        customerId,
        serviceRow.customerProtocolId,
      ),
    [companyId, customerId, serviceRow.customerProtocolId, tick],
  );
  const protocols = useMemo<CustomerProtocolV2[]>(
    () => resolveCustomerProtocols(companyId, customerId),
    [companyId, customerId, tick],
  );

  // The executable run snapshot linked to this row, if one has been generated.
  const run = useMemo<ProtocolRunV2 | null>(
    () =>
      serviceRow.protocolRunId
        ? resolveProtocolRun(companyId, serviceRow.protocolRunId)
        : null,
    [companyId, serviceRow.protocolRunId, tick],
  );
  const runProgress = useMemo<{ resolved: number; total: number } | null>(() => {
    if (!run) return null;
    const items = resolveProtocolSections(companyId, run.id).flatMap((section) =>
      resolveProtocolItems(companyId, section.id),
    );
    return {
      resolved: items.filter((i) => isItemResolved(i.status)).length,
      total: items.length,
    };
  }, [companyId, run]);

  const [selectorOpen, setSelectorOpen] = useState<boolean>(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState<boolean>(false);
  const [emptyOpen, setEmptyOpen] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string>("");

  const refresh = () => setTick((t) => t + 1);
  const showUnavailable = () => {
    toast({
      title: "Temporarily unavailable",
      description: "This action is being updated and is not available yet.",
      variant: "destructive",
    });
  };

  const link = (protocolId: string) => {
    if (mutationsDisabled) {
      showUnavailable();
      return;
    }
    const res = updateWorkOrderServiceRow(workOrderId, serviceRow.id, {
      customerProtocolId: protocolId,
    });
    if (!res.ok) {
      toast({ title: "Could not link protocol", description: res.error, variant: "destructive" });
      return;
    }
    refresh();
    toast({ title: "Protocol linked" });
  };

  const remove = () => {
    if (mutationsDisabled) {
      showUnavailable();
      return;
    }
    const res = updateWorkOrderServiceRow(workOrderId, serviceRow.id, {
      customerProtocolId: null,
    });
    if (!res.ok) {
      toast({ title: "Could not remove link", description: res.error, variant: "destructive" });
      return;
    }
    refresh();
    toast({ title: "Protocol link removed" });
  };

  const openProtocol = () => {
    navigate(`/customers/${customerId}?tab=protocols`);
  };

  const openRun = () => {
    if (!run) return;
    navigate(`/protocol-runs?run=${run.id}`);
  };

  const generateRun = () => {
    if (mutationsDisabled) {
      showUnavailable();
      return;
    }
    // A run is generated only on explicit action and never overwritten: if one
    // already exists, open it instead.
    if (run) {
      openRun();
      return;
    }
    if (!linked) {
      toast({
        title: "No protocol linked",
        description: "Link a cleaning protocol before generating a run.",
        variant: "destructive",
      });
      return;
    }
    // Cross-customer / missing protocol guard: the resolver only returns a
    // protocol owned by this company + customer, so a non-null `linked` is
    // already validated. Re-resolve defensively in case it changed.
    if (linked.isArchived) {
      const proceed = window.confirm(
        `“${linked.name}” is archived. Generate a run from this archived protocol anyway?`,
      );
      if (!proceed) return;
    }
    const generated = generateProtocolRunFromCustomerProtocol(
      companyId,
      customerId,
      linked.id,
      { generatedBy: currentUser?.id ?? "unknown", workOrderId, allowArchived: true },
    );
    if (!generated) {
      toast({
        title: "Could not generate run",
        description: "The linked protocol is unavailable for this customer.",
        variant: "destructive",
      });
      return;
    }
    const res = updateWorkOrderServiceRow(workOrderId, serviceRow.id, {
      protocolRunId: generated.id,
    });
    if (!res.ok) {
      toast({ title: "Could not link run", description: res.error, variant: "destructive" });
      return;
    }
    refresh();
    toast({ title: "Protocol run generated" });
  };

  const openSelector = () => {
    setSelectedId(serviceRow.customerProtocolId ?? "");
    setSelectorOpen(true);
  };

  const handleCreateFromTemplate = (input: CustomerProtocolDialogSubmit): string | null => {
    if (input.mode !== "create") return "Unexpected action.";
    const created = generateCustomerProtocol(companyId, customerId, input.templateId, {
      name: input.name,
      description: input.description,
    });
    if (!created) return DUPLICATE_MESSAGE;
    link(created.id);
    return null;
  };

  // View-only users see the linked protocol (read-only) or nothing.
  if (!canView) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" /> Cleaning protocol
      </span>

      {linked ? (
        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1">
          <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-medium">{linked.name}</span>
          {linked.isArchived ? (
            <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
              Archived
            </span>
          ) : null}
          {run ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              aria-label={`Run status ${RUN_STATUS_LABEL[run.status]}`}
            >
              {RUN_STATUS_LABEL[run.status]}
              {runProgress && runProgress.total > 0
                ? ` · ${runProgress.resolved}/${runProgress.total}`
                : ""}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={openProtocol}>
            <ExternalLink className="h-3.5 w-3.5" /> Open protocol
          </Button>
          {run ? (
            canExecute ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={openRun}>
                <ListChecks className="h-3.5 w-3.5" /> Open run
              </Button>
            ) : null
          ) : canGenerateRun ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={generateRun}>
              <Play className="h-3.5 w-3.5" /> Generate run
            </Button>
          ) : null}
          {canLink ? (
            <>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={openSelector}>
                <RefreshCw className="h-3.5 w-3.5" /> Change
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-muted-foreground hover:text-destructive"
                onClick={remove}
              >
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
            </>
          ) : null}
        </div>
      ) : canLink ? (
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2" onClick={openSelector}>
          <Plus className="h-3.5 w-3.5" /> Link Cleaning Protocol
        </Button>
      ) : (
        <span className="text-sm text-muted-foreground">No protocol linked</span>
      )}

      {/* Selector / empty-state dialog */}
      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link cleaning protocol</DialogTitle>
            <DialogDescription>
              Choose the recommended customer protocol for this service. This does
              not start a protocol run.
            </DialogDescription>
          </DialogHeader>

          {protocols.length > 0 ? (
            <ScrollArea className="max-h-60 rounded-md border border-border">
              <div className="p-1">
                {protocols.map((protocol) => {
                  const selected = protocol.id === selectedId;
                  return (
                    <button
                      key={protocol.id}
                      type="button"
                      onClick={() => setSelectedId(protocol.id)}
                      aria-pressed={selected}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        selected ? "bg-primary/10 text-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{protocol.name}</span>
                        {protocol.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {protocol.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center">
              <p className="text-sm font-medium">
                No cleaning protocol exists for this customer.
              </p>
              {canCreate ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Create one to link it to this service.
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {canCreate ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectorOpen(false);
                      setTemplateDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" /> From template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectorOpen(false);
                      setEmptyOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" /> Empty protocol
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectorOpen(false)}>
                Cancel
              </Button>
              {protocols.length > 0 ? (
                <Button
                  size="sm"
                  disabled={!selectedId}
                  onClick={() => {
                    link(selectedId);
                    setSelectorOpen(false);
                  }}
                >
                  Link protocol
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create-from-template reuses the customer protocol dialog. */}
      <CustomerProtocolDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        companyId={companyId}
        protocol={null}
        onSubmit={handleCreateFromTemplate}
      />

      {/* Create empty protocol. */}
      <CreateEmptyProtocolDialog
        open={emptyOpen}
        onOpenChange={setEmptyOpen}
        onCreate={(name, description) => {
          const created = createBlankCustomerProtocol(companyId, customerId, {
            name,
            description,
          });
          if (!created) return DUPLICATE_MESSAGE;
          link(created.id);
          return null;
        }}
      />
    </div>
  );
}

interface CreateEmptyProtocolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns an error message to keep the dialog open, or null on success. */
  onCreate: (name: string, description?: string) => string | null;
}

/** Minimal name/description prompt for the "create empty protocol" shortcut. */
function CreateEmptyProtocolDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateEmptyProtocolDialogProps) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const failure = onCreate(trimmed, description.trim() || undefined);
    if (failure) {
      setError(failure);
      return;
    }
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New empty protocol</DialogTitle>
          <DialogDescription>
            Create a blank customer protocol and link it to this service. You can
            add sections and items afterwards from the customer card.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="empty-protocol-name">Name</Label>
            <Input
              id="empty-protocol-name"
              placeholder="e.g. Bergen Office Park – Conference Rooms"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="empty-protocol-desc">Description</Label>
            <Textarea
              id="empty-protocol-desc"
              placeholder="Optional — what this protocol covers…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create & link</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
