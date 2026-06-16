import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  Siren,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import { MockDataNotice } from "@/components/crm/MockDataNotice";
import { AutomationCenterReference } from "@/components/crm/AutomationCenterReference";
import { CrmShellNav } from "@/components/crm/CrmShellNav";
import { RequestDetailSheet } from "@/components/crm/RequestDetailSheet";
import {
  RequestStatusBadge,
  SeverityBadge,
  PriorityBadge,
  SlaStateBadge,
  AutomationQuickReviewChip,
  RiskLevelBadge,
} from "@/components/crm/badges/RequestCrmBadges";
import {
  REQUEST_CRM_DASHBOARD_CARDS,
  REQUEST_CRM_REQUESTS,
  REQUEST_CRM_AUTOMATION_CANDIDATES,
} from "@/lib/requestCrm/mockData";
import {
  REQUEST_CRM_VIEW_PERMISSION,
  REQUEST_CRM_REQUESTS_PATH,
} from "@/lib/requestCrm/shellNav";
import { ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW } from "@/lib/featureFlags";
import type {
  RequestDashboardCardTone,
  RequestListRow,
  RequestSeverity,
  RequestSlaState,
} from "@/lib/requestCrm/types";

/**
 * REQUEST CRM Dashboard shell (Slice 0 / TICKET-003B).
 *
 * A feature-flagged, shared-admin-only, read-only dashboard at `/crm/dashboard`.
 * It renders mock KPI cards, a derived "needs attention" list, and display-only
 * Automation & AI Center quick-review references. Route access is gated by
 * `ProtectedRoute` (flags + role + permission) in `App.tsx`; this component adds
 * a defensive permission check so a direct mount still fails closed.
 */

const CARD_TONE: Record<RequestDashboardCardTone, { icon: LucideIcon; iconWrap: string; value: string; border: string }> = {
  neutral: { icon: Inbox, iconWrap: "bg-muted text-muted-foreground", value: "text-foreground", border: "border-border" },
  info: { icon: Inbox, iconWrap: "bg-sky-100 text-sky-700", value: "text-sky-700", border: "border-border" },
  attention: { icon: AlertTriangle, iconWrap: "bg-amber-100 text-amber-700", value: "text-amber-700", border: "border-amber-200" },
  critical: { icon: Siren, iconWrap: "bg-red-100 text-red-700", value: "text-red-700", border: "border-red-200" },
  ai: { icon: Sparkles, iconWrap: "bg-violet-100 text-violet-700", value: "text-violet-700", border: "border-border" },
  automation: { icon: Workflow, iconWrap: "bg-indigo-100 text-indigo-700", value: "text-indigo-700", border: "border-border" },
};

const SEVERITY_RANK: Record<RequestSeverity, number> = { emergency: 0, prio: 1, normal: 2 };
const SLA_RANK: Record<RequestSlaState, number> = { overdue: 0, due_soon: 1, on_track: 2, none: 3 };

/** Rows that need attention: emergency/prio, unassigned, or overdue SLA. */
function selectAttentionRows(rows: RequestListRow[]): RequestListRow[] {
  return rows
    .filter(
      (row) =>
        row.severity !== "normal" || row.ownerAdminId === null || row.slaState === "overdue",
    )
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        SLA_RANK[a.slaState] - SLA_RANK[b.slaState] ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 5);
}

export default function CrmDashboard() {
  const { hasPermission } = useApp();
  const attentionRows = useMemo(() => selectAttentionRows(REQUEST_CRM_REQUESTS), []);
  const [selectedRow, setSelectedRow] = useState<RequestListRow | null>(null);
  const quickReviewEnabled = ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW;

  if (!hasPermission(REQUEST_CRM_VIEW_PERMISSION)) return <AccessDenied />;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="REQUEST CRM Dashboard"
        description="A read-only Slice 0 overview of REQUEST CRM activity using mock data. No requests are created or modified here."
        action={
          <div className="flex flex-wrap items-center gap-1.5" data-testid="crm-dashboard-badges">
            <Badge variant="outline" className="border-sky-200 bg-sky-50 font-medium text-sky-700">
              Mock
            </Badge>
            <Badge variant="outline" className="border-border bg-muted font-medium text-muted-foreground">
              Read-only
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 font-medium text-amber-700">
              Slice 0
            </Badge>
          </div>
        }
      />

      <div className="space-y-4" data-testid="crm-dashboard">
        <CrmShellNav />
        <MockDataNotice />
        <AutomationCenterReference />

        <section
          data-testid="crm-dashboard-cards"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {REQUEST_CRM_DASHBOARD_CARDS.map((card) => {
            const tone = CARD_TONE[card.tone];
            const Icon = tone.icon;
            return (
              <Card
                key={card.key}
                data-testid={`crm-dashboard-card-${card.key}`}
                className={cn("border", tone.border)}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                    <p className={cn("mt-1 text-3xl font-semibold tabular-nums", tone.value)}>
                      {card.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
                  </div>
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone.iconWrap)}>
                    <Icon className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section className="rounded-2xl border border-border bg-card" data-testid="crm-attention-list">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold">Needs attention</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Emergency, priority, unassigned or overdue requests from the mock dataset.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to={REQUEST_CRM_REQUESTS_PATH}>
                View all requests
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </header>

          <ul className="divide-y divide-border">
            {attentionRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRow(row)}
                  data-testid={`crm-attention-row-${row.id}`}
                  className="flex w-full flex-wrap items-start justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 sm:px-6"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {row.requestNumber}
                      </code>
                      <span className="truncate text-sm font-medium text-foreground">{row.title}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <RequestStatusBadge status={row.status} />
                      <PriorityBadge priority={row.priority} />
                      {row.severity !== "normal" ? <SeverityBadge severity={row.severity} /> : null}
                      <SlaStateBadge state={row.slaState} />
                      {row.automationQuickReviewKey ? (
                        <AutomationQuickReviewChip centralKey={row.automationQuickReviewKey} />
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.ownerName ?? "Unassigned"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card" data-testid="crm-dashboard-automation">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold">Automation &amp; AI quick review</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Display-only candidates. The registry, risk and approval policy are owned centrally.
              </p>
            </div>
          </header>
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <AutomationCenterReference compact />
            <Separator />
            {quickReviewEnabled ? (
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="crm-dashboard-automation-candidates">
                {REQUEST_CRM_AUTOMATION_CANDIDATES.map((candidate) => (
                  <li
                    key={candidate.centralActionKey}
                    className="rounded-xl border border-border bg-background/60 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                        {candidate.centralActionKey}
                      </code>
                      <RiskLevelBadge risk={candidate.riskLevel} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{candidate.trigger}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div
                data-testid="crm-dashboard-automation-disabled"
                className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground"
              >
                Automation quick-review is turned off. Enable{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  enable_request_crm_automation_quick_review
                </code>{" "}
                to preview the display-only automation candidates.
              </div>
            )}
          </div>
        </section>
      </div>

      <RequestDetailSheet
        row={selectedRow}
        open={selectedRow !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedRow(null);
        }}
      />
    </DashboardLayout>
  );
}
