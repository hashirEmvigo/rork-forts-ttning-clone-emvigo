/**
 * REQUEST CRM — read-only request detail / preview drawer (Slice 0).
 *
 * Opens from the request list and the dashboard "needs attention" list to show
 * the full mock request in a side sheet. It is a DETAIL FOUNDATION only: every
 * field is read-only demo data — no request is fetched, created, assigned,
 * answered, commented on, or mutated, and the operational actions are inert
 * "later slice" placeholders. Automation/AI references stay display-only with
 * Automation & AI Center as the single source of truth.
 */
import {
  CalendarClock,
  CalendarPlus,
  ClipboardList,
  Link2,
  Mail,
  MessageSquare,
  Tag,
  User,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  RequestStatusBadge,
  PriorityBadge,
  SeverityBadge,
  SlaStateBadge,
  RiskLevelBadge,
  AutomationQuickReviewChip,
  ReadOnlyBadge,
} from "@/components/crm/badges/RequestCrmBadges";
import { AutomationCenterReference } from "@/components/crm/AutomationCenterReference";
import { REQUEST_SOURCE_LABELS } from "@/lib/requestCrm/requestListFilters";
import { REQUEST_CRM_REQUEST_TYPES } from "@/lib/requestCrm/mockData";
import type { RequestListRow } from "@/lib/requestCrm/types";

/** key → human label for the mock request types (display only). */
const REQUEST_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  REQUEST_CRM_REQUEST_TYPES.map((type) => [type.key, type.label]),
);

/** Friendly labels for the demo `linkedObjectType` values (display only). */
const LINKED_OBJECT_LABELS: Record<string, string> = {
  work_order: "Work order",
  invoice: "Invoice",
  employee: "Employee",
  chat_session: "Chat session",
  schedule: "Schedule",
  request: "Request",
};

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Format an ISO timestamp for display; fall back to the raw string if invalid. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : TIMESTAMP_FORMAT.format(date);
}

interface DetailFieldProps {
  icon: LucideIcon;
  label: string;
  value: string;
  muted?: boolean;
}

function DetailField({ icon: Icon, label, value, muted = false }: DetailFieldProps) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={cn("text-sm", muted ? "text-muted-foreground" : "font-medium text-foreground")}>
          {value}
        </p>
      </div>
    </div>
  );
}

/** Inert, clearly-disabled operational actions — wired in a later slice. */
const PLACEHOLDER_ACTIONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "assign", label: "Assign owner", icon: UserPlus },
  { key: "reply", label: "Reply", icon: MessageSquare },
  { key: "internal-task", label: "Add internal task", icon: ClipboardList },
];

interface RequestDetailSheetProps {
  /** The request to preview, or `null` when nothing is selected. */
  row: RequestListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only side-sheet that previews a single mock request. Controlled by the
 * parent surface (request list / dashboard); renders no content while closed.
 */
export function RequestDetailSheet({ row, open, onOpenChange }: RequestDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
        data-testid="crm-request-detail"
      >
        {row ? (
          <>
            <SheetHeader className="space-y-3 border-b border-border px-5 py-4 pr-12 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {row.requestNumber}
                </code>
                <ReadOnlyBadge />
              </div>
              <SheetTitle className="text-lg leading-snug" data-testid="crm-request-detail-title">
                {row.title}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Read-only detail foundation for {row.requestNumber}. No request is created or modified.
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-1.5">
                <RequestStatusBadge status={row.status} />
                <PriorityBadge priority={row.priority} />
                {row.severity !== "normal" ? <SeverityBadge severity={row.severity} /> : null}
                <SlaStateBadge state={row.slaState} />
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-5">
                <p
                  data-testid="crm-request-detail-readonly-note"
                  className="rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground"
                >
                  Read-only detail foundation. This preview shows mock request data only —
                  assigning, replying, status changes and comments arrive in a later slice.
                </p>

                <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <DetailField
                    icon={Tag}
                    label="Category"
                    value={row.categoryName ?? "Uncategorized"}
                    muted={row.categoryName === null}
                  />
                  <DetailField
                    icon={ClipboardList}
                    label="Type"
                    value={
                      row.requestTypeKey
                        ? REQUEST_TYPE_LABELS[row.requestTypeKey] ?? row.requestTypeKey
                        : "—"
                    }
                    muted={row.requestTypeKey === null}
                  />
                  <DetailField
                    icon={User}
                    label="Owner"
                    value={row.ownerName ?? "Unassigned"}
                    muted={row.ownerName === null}
                  />
                  <DetailField
                    icon={User}
                    label="Customer"
                    value={row.customerName ?? "—"}
                    muted={row.customerName === null}
                  />
                  <DetailField icon={Mail} label="Source" value={REQUEST_SOURCE_LABELS[row.source]} />
                  <DetailField
                    icon={Link2}
                    label="Linked to"
                    value={
                      row.linkedObjectType
                        ? LINKED_OBJECT_LABELS[row.linkedObjectType] ?? row.linkedObjectType
                        : "—"
                    }
                    muted={row.linkedObjectType === null}
                  />
                  <DetailField icon={CalendarPlus} label="Created" value={formatTimestamp(row.createdAt)} />
                  <DetailField icon={CalendarClock} label="Last updated" value={formatTimestamp(row.updatedAt)} />
                </section>

                {row.hasUnreadExternal || row.hasUnacknowledgedInternalTask ? (
                  <section className="flex flex-wrap gap-1.5" data-testid="crm-request-detail-flags">
                    {row.hasUnreadExternal ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                        Unread external message
                      </span>
                    ) : null}
                    {row.hasUnacknowledgedInternalTask ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        Unacknowledged internal task
                      </span>
                    ) : null}
                  </section>
                ) : null}

                <Separator />

                <section className="space-y-2.5" data-testid="crm-request-detail-automation">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Automation &amp; AI</h3>
                    {row.automationQuickReviewKey ? (
                      <RiskLevelBadge risk={row.automationRiskLevel} />
                    ) : null}
                  </div>
                  {row.automationQuickReviewKey ? (
                    <AutomationQuickReviewChip centralKey={row.automationQuickReviewKey} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No automation candidate linked to this request.
                    </p>
                  )}
                  <AutomationCenterReference compact />
                </section>

                <Separator />

                <section className="space-y-2" data-testid="crm-request-detail-actions">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Actions (later slice)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PLACEHOLDER_ACTIONS.map((action) => {
                      const Icon = action.icon;
                      return (
                        <Tooltip key={action.key}>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled
                                className="pointer-events-none gap-1.5"
                              >
                                <Icon className="h-3.5 w-3.5" />
                                {action.label}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Operational actions arrive in a later slice.</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
