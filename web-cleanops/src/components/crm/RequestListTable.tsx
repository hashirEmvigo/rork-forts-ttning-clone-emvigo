/**
 * REQUEST CRM request list — read-only table (Slice 0).
 *
 * Renders the filtered mock rows. There are NO live mutations: the per-row
 * action opens a READ-ONLY detail/preview drawer (no create/assign/answer/
 * comment). The automation chip is a display-only reference to Automation & AI
 * Center, the single source of truth.
 */
import { Eye, Inbox } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RequestStatusBadge,
  PriorityBadge,
  SeverityBadge,
  SlaStateBadge,
  AutomationQuickReviewChip,
} from "@/components/crm/badges/RequestCrmBadges";
import { REQUEST_SOURCE_LABELS } from "@/lib/requestCrm/requestListFilters";
import { REQUEST_CRM_REQUEST_TYPES } from "@/lib/requestCrm/mockData";
import type { RequestListRow } from "@/lib/requestCrm/types";

const REQUEST_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  REQUEST_CRM_REQUEST_TYPES.map((type) => [type.key, type.label]),
);

interface RequestListTableProps {
  rows: RequestListRow[];
  /** Open the read-only detail/preview drawer for a row. */
  onPreview: (row: RequestListRow) => void;
}

export function RequestListTable({ rows, onPreview }: RequestListTableProps) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="crm-request-empty"
        className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-14 text-center"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-foreground">No requests match these filters</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Adjust or clear the filters to see the mock request set again.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="crm-request-list"
      className="overflow-x-auto rounded-2xl border border-border bg-card"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[260px]">Request</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Automation</TableHead>
            <TableHead className="text-right">Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-testid={`crm-request-row-${row.id}`}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => onPreview(row)}
            >
              <TableCell>
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {row.requestNumber}
                    </code>
                    {row.hasUnreadExternal ? (
                      <span
                        title="Unread external message"
                        className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
                      >
                        Unread
                      </span>
                    ) : null}
                    {row.hasUnacknowledgedInternalTask ? (
                      <span
                        title="Unacknowledged internal task"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                      >
                        Task
                      </span>
                    ) : null}
                  </div>
                  <span className="text-sm font-medium text-foreground">{row.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.categoryName ?? "Uncategorized"}
                    {row.requestTypeKey
                      ? ` · ${REQUEST_TYPE_LABELS[row.requestTypeKey] ?? row.requestTypeKey}`
                      : ""}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <RequestStatusBadge status={row.status} />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PriorityBadge priority={row.priority} />
                  {row.severity !== "normal" ? <SeverityBadge severity={row.severity} /> : null}
                </div>
              </TableCell>
              <TableCell>
                <SlaStateBadge state={row.slaState} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm text-foreground">{row.ownerName ?? "Unassigned"}</span>
                  {row.customerName ? (
                    <span className="text-xs text-muted-foreground">{row.customerName}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {REQUEST_SOURCE_LABELS[row.source]}
                </span>
              </TableCell>
              <TableCell>
                {row.automationQuickReviewKey ? (
                  <AutomationQuickReviewChip centralKey={row.automationQuickReviewKey} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  data-testid={`crm-request-preview-${row.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreview(row);
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
