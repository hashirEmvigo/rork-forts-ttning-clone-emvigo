/**
 * REQUEST CRM Settings Shell — small read-only status badges (Slice 0).
 *
 * Pure presentational badges built on the shared shadcn `Badge`. They label the
 * implementation status, risk-level candidate, data ownership boundary and mock
 * runtime-safety state. None of them imply behaviour — they are display only.
 */
import { Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  RequestSettingsItemStatus,
  RequestRiskLevel,
  RequestSettingsOwnership,
  RuntimeSafetyMockStatus,
  RequestStatus,
  RequestPriority,
  RequestSeverity,
  RequestSlaState,
} from "@/lib/requestCrm/types";
import {
  REQUEST_STATUS_LABELS,
  REQUEST_PRIORITY_LABELS,
  REQUEST_SEVERITY_LABELS,
  REQUEST_SLA_LABELS,
} from "@/lib/requestCrm/requestListFilters";

const STATUS_STYLES: Record<RequestSettingsItemStatus, { label: string; className: string }> = {
  mock: { label: "Mock", className: "border-sky-200 bg-sky-50 text-sky-700" },
  planned: { label: "Planned", className: "border-amber-200 bg-amber-50 text-amber-700" },
  active_later: { label: "Active later", className: "border-slate-200 bg-slate-50 text-slate-600" },
  disabled: { label: "Disabled", className: "border-border bg-muted text-muted-foreground" },
};

export function SettingStatusBadge({ status }: { status: RequestSettingsItemStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label}
    </Badge>
  );
}

const RISK_STYLES: Record<RequestRiskLevel | "none", { label: string; className: string }> = {
  none: { label: "No risk", className: "border-border bg-muted text-muted-foreground" },
  low: { label: "Low", className: "border-slate-200 bg-slate-50 text-slate-600" },
  medium: { label: "Medium", className: "border-amber-200 bg-amber-50 text-amber-700" },
  high: { label: "High", className: "border-orange-200 bg-orange-50 text-orange-700" },
  critical: { label: "Critical", className: "border-red-200 bg-red-50 text-red-700" },
};

export function RiskLevelBadge({ risk }: { risk: RequestRiskLevel | "none" }) {
  const style = RISK_STYLES[risk];
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label} risk
    </Badge>
  );
}

const OWNERSHIP_STYLES: Record<RequestSettingsOwnership, { label: string; className: string }> = {
  local: { label: "REQUEST CRM", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  "central-linked": {
    label: "Linked to Automation & AI Center",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  central: {
    label: "Owned by Automation & AI Center",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

export function OwnershipBadge({ ownership }: { ownership: RequestSettingsOwnership }) {
  const style = OWNERSHIP_STYLES[ownership];
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label}
    </Badge>
  );
}

const RUNTIME_STYLES: Record<RuntimeSafetyMockStatus["status"], { label: string; className: string }> = {
  mock_ok: { label: "Mock OK", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  mock_warning: { label: "Mock warning", className: "border-amber-200 bg-amber-50 text-amber-700" },
  mock_disabled: { label: "Mock disabled", className: "border-border bg-muted text-muted-foreground" },
};

export function RuntimeSafetyStatusBadge({ status }: { status: RuntimeSafetyMockStatus["status"] }) {
  const style = RUNTIME_STYLES[status];
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label}
    </Badge>
  );
}

const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  new: "border-sky-200 bg-sky-50 text-sky-700",
  open: "border-indigo-200 bg-indigo-50 text-indigo-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  waiting_customer: "border-violet-200 bg-violet-50 text-violet-700",
  waiting_employee: "border-purple-200 bg-purple-50 text-purple-700",
  waiting_internal: "border-slate-200 bg-slate-50 text-slate-600",
  action_planned: "border-teal-200 bg-teal-50 text-teal-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-border bg-muted text-muted-foreground",
  reopened: "border-orange-200 bg-orange-50 text-orange-700",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", REQUEST_STATUS_STYLES[status])}>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

const REQUEST_PRIORITY_STYLES: Record<RequestPriority, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-600",
  normal: "border-border bg-muted text-muted-foreground",
  high: "border-orange-200 bg-orange-50 text-orange-700",
};

export function PriorityBadge({ priority }: { priority: RequestPriority }) {
  return (
    <Badge variant="outline" className={cn("font-medium", REQUEST_PRIORITY_STYLES[priority])}>
      {REQUEST_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const REQUEST_SEVERITY_STYLES: Record<RequestSeverity, string> = {
  normal: "border-border bg-muted text-muted-foreground",
  prio: "border-amber-200 bg-amber-50 text-amber-700",
  emergency: "border-red-200 bg-red-50 text-red-700",
};

export function SeverityBadge({ severity }: { severity: RequestSeverity }) {
  return (
    <Badge variant="outline" className={cn("font-medium", REQUEST_SEVERITY_STYLES[severity])}>
      {REQUEST_SEVERITY_LABELS[severity]}
    </Badge>
  );
}

const REQUEST_SLA_STYLES: Record<RequestSlaState, string> = {
  on_track: "border-emerald-200 bg-emerald-50 text-emerald-700",
  due_soon: "border-amber-200 bg-amber-50 text-amber-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
  none: "border-border bg-muted text-muted-foreground",
};

export function SlaStateBadge({ state }: { state: RequestSlaState }) {
  return (
    <Badge variant="outline" className={cn("font-medium", REQUEST_SLA_STYLES[state])}>
      {REQUEST_SLA_LABELS[state]}
    </Badge>
  );
}

/**
 * Display-only automation quick-review chip. Shows the central action key the
 * request references. Source of truth is Automation & AI Center — REQUEST CRM
 * never owns this policy, so the chip is a passive reference with no action.
 */
export function AutomationQuickReviewChip({
  centralKey,
  className,
}: {
  centralKey: string;
  className?: string;
}) {
  return (
    <span
      data-testid="automation-quick-review-chip"
      title="Source of truth: Automation & AI Center · Display only in REQUEST CRM"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700",
        className,
      )}
    >
      <Workflow className="h-3 w-3" />
      <code className="font-mono">{centralKey}</code>
    </span>
  );
}

/** A small, consistent "Read-only" pill reused across the shell. */
export function ReadOnlyBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-border bg-muted font-medium text-muted-foreground", className)}
    >
      Read-only
    </Badge>
  );
}
