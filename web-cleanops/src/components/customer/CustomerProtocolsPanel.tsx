import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FileStack,
  FileText,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Tags,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCustomerProtocolReadModel } from "@/hooks/use-customer-protocol-read-model";
import type { CustomerProtocolV2, CustomerSegment } from "@/types";

interface CustomerProtocolsPanelProps {
  /** Company that owns the customer. */
  companyId: string;
  /** Customer whose protocol library is managed. */
  customerId: string;
  /** Customer segment, used to recommend templates in the create dialog. */
  customerSegment?: CustomerSegment;
  /** When false the list is read-only (no add/edit/archive/restore). */
  canManage: boolean;
}

const DEFERRED_WRITE_MESSAGE =
  "Protocol create, edit, archive and restore actions are temporarily disabled while Supabase writes are connected.";

/** Aggregate counts shown per protocol. */
interface ProtocolCounts {
  categories: number;
  floorPresets: number;
  sections: number;
  items: number;
}

/**
 * Customer-level management UI for a customer's cleaning protocol library.
 * Protocols are created from company {@link ChecklistTemplateV2} templates, then
 * become independent editable definitions for this customer. Mirrors the
 * Settings {@link TemplatesPanel} conventions (soft-delete archive, count
 * badges, in-panel builder) but is customer-scoped.
 *
 * The list/count read path is Supabase-only. Legacy create/edit/archive
 * actions remain disabled here until the write boundary is cut over.
 */
export function CustomerProtocolsPanel({
  companyId,
  customerId,
  customerSegment,
  canManage,
}: CustomerProtocolsPanelProps) {
  void customerSegment;
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const { active, archived, counts, isLoading, error } = useCustomerProtocolReadModel(
    companyId,
    customerId,
  );

  const renderCounts = (protocolId: string) => {
    const c = counts[protocolId];
    if (!c) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" /> {c.sections} sections
        </span>
        <span className="inline-flex items-center gap-1">
          <FileStack className="h-3.5 w-3.5" /> {c.items} items
        </span>
        <span className="inline-flex items-center gap-1">
          <Tags className="h-3.5 w-3.5" /> {c.categories} categories
        </span>
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" /> {c.floorPresets} floor presets
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Active protocols */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileStack className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Cleaning protocols</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  This customer's protocols, created from company templates and
                  customized for their location.
                </p>
              </div>
              {canManage ? (
                <Button
                  className="shrink-0 gap-1.5"
                  disabled
                  title={DEFERRED_WRITE_MESSAGE}
                >
                  <Plus className="h-4 w-4" /> New protocol
                </Button>
              ) : null}
            </div>

            {canManage ? (
              <p className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {DEFERRED_WRITE_MESSAGE}
              </p>
            ) : null}

            {isLoading ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading protocols from Supabase…
              </div>
            ) : error ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-5 text-sm text-destructive">
                Could not load customer protocols from Supabase.
              </div>
            ) : active.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium">No protocols yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canManage
                    ? "Create a protocol from a company template to get started."
                    : "No protocols have been created for this customer yet."}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {active.map((protocol) => (
                  <li
                    key={protocol.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1 text-left">
                      <p className="flex items-center gap-1 truncate text-sm font-medium">
                        {protocol.name}
                      </p>
                      {protocol.description ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {protocol.description}
                        </p>
                      ) : null}
                      {protocol.sourceTemplateName ? (
                        <p className="truncate text-xs text-muted-foreground">
                          From template: {protocol.sourceTemplateName}
                        </p>
                      ) : null}
                      {renderCounts(protocol.id)}
                    </div>
                    {canManage ? (
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          disabled
                          title={DEFERRED_WRITE_MESSAGE}
                        >
                          <ListChecks className="h-4 w-4" /> Edit content
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled
                          title={DEFERRED_WRITE_MESSAGE}
                          aria-label={`Edit ${protocol.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled
                          title={DEFERRED_WRITE_MESSAGE}
                          aria-label={`Archive ${protocol.name}`}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Archived protocols */}
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="cprotocol-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label
              htmlFor="cprotocol-show-archived"
              className="text-sm font-medium"
            >
              Show archived protocols
            </Label>
          </div>
          {archived.length > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {archived.length} archived
            </span>
          ) : null}
        </div>

        {showArchived ? (
          archived.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No archived protocols.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {archived.map((protocol) => (
                <li
                  key={protocol.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-muted-foreground">
                      {protocol.name}
                    </p>
                    {protocol.description ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {protocol.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto gap-1.5"
                      disabled
                      title={DEFERRED_WRITE_MESSAGE}
                    >
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {/* Reports & history — future placeholder (no functionality yet). */}
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Reports & completed history</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Completed protocol runs, inspection reports and history for this
              customer will appear here in a later phase.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Coming soon
          </span>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Protocols are independent once created — editing a protocol never
          changes the company template, and template changes never change
          existing protocols. Archiving keeps a protocol for historical
          references; it is never deleted.
        </p>
      </div>

    </div>
  );
}
