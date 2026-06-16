/**
 * REQUEST CRM request list — pure, read-only filter + sort logic (Slice 0).
 *
 * This module is intentionally side-effect free: it derives a filtered/sorted
 * view of the in-`src` mock rows from a plain filter state object. It performs no
 * network calls, no mutations, and never touches localStorage or Supabase — the
 * request list shell only ever updates local view state. Keeping the logic here
 * (instead of inside the page) makes the filtering/sorting unit-testable.
 */
import type {
  RequestListRow,
  RequestListSortKey,
  RequestPriority,
  RequestSeverity,
  RequestSlaState,
  RequestSource,
  RequestStatus,
} from "@/lib/requestCrm/types";

/** Local-only filter state for the request list. Defaults show everything. */
export interface RequestListFilterState {
  search: string;
  status: RequestStatus | "all";
  priority: RequestPriority | "all";
  severity: RequestSeverity | "all";
  categoryId: string | "all";
  ownerAdminId: string | "all" | "unassigned";
  source: RequestSource | "all";
  slaState: RequestSlaState | "all";
  onlyUnreadExternal: boolean;
  onlyAutomationLinked: boolean;
  sort: RequestListSortKey;
}

/** The neutral starting filter state — nothing narrowed, sorted by last update. */
export const DEFAULT_REQUEST_LIST_FILTERS: RequestListFilterState = {
  search: "",
  status: "all",
  priority: "all",
  severity: "all",
  categoryId: "all",
  ownerAdminId: "all",
  source: "all",
  slaState: "all",
  onlyUnreadExternal: false,
  onlyAutomationLinked: false,
  sort: "updated_desc",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  open: "Open",
  in_progress: "In progress",
  waiting_customer: "Waiting on customer",
  waiting_employee: "Waiting on employee",
  waiting_internal: "Waiting internal",
  action_planned: "Action planned",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};

export const REQUEST_PRIORITY_LABELS: Record<RequestPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

export const REQUEST_SEVERITY_LABELS: Record<RequestSeverity, string> = {
  normal: "Normal",
  prio: "Priority",
  emergency: "Emergency",
};

export const REQUEST_SLA_LABELS: Record<RequestSlaState, string> = {
  on_track: "On track",
  due_soon: "Due soon",
  overdue: "Overdue",
  none: "No SLA",
};

export const REQUEST_SOURCE_LABELS: Record<RequestSource, string> = {
  customer_portal: "Customer portal",
  employee_app: "Employee app",
  email_inbound: "Inbound email",
  chat: "Chat",
  internal: "Internal",
  system: "System",
};

export const REQUEST_SORT_LABELS: Record<RequestListSortKey, string> = {
  updated_desc: "Last updated",
  created_desc: "Newest",
  sla_due_asc: "SLA most urgent",
  severity_desc: "Severity",
  priority_desc: "Priority",
  unread_first: "Unread first",
  unassigned_first: "Unassigned first",
};

/** Ordered option list for a `<Select>` of statuses. */
export const REQUEST_STATUS_OPTIONS = (Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[]).map(
  (value) => ({ value, label: REQUEST_STATUS_LABELS[value] }),
);

export const REQUEST_PRIORITY_OPTIONS = (Object.keys(REQUEST_PRIORITY_LABELS) as RequestPriority[]).map(
  (value) => ({ value, label: REQUEST_PRIORITY_LABELS[value] }),
);

export const REQUEST_SEVERITY_OPTIONS = (Object.keys(REQUEST_SEVERITY_LABELS) as RequestSeverity[]).map(
  (value) => ({ value, label: REQUEST_SEVERITY_LABELS[value] }),
);

export const REQUEST_SLA_OPTIONS = (Object.keys(REQUEST_SLA_LABELS) as RequestSlaState[]).map(
  (value) => ({ value, label: REQUEST_SLA_LABELS[value] }),
);

export const REQUEST_SOURCE_OPTIONS = (Object.keys(REQUEST_SOURCE_LABELS) as RequestSource[]).map(
  (value) => ({ value, label: REQUEST_SOURCE_LABELS[value] }),
);

export const REQUEST_SORT_OPTIONS = (Object.keys(REQUEST_SORT_LABELS) as RequestListSortKey[]).map(
  (value) => ({ value, label: REQUEST_SORT_LABELS[value] }),
);

const SLA_RANK: Record<RequestSlaState, number> = {
  overdue: 0,
  due_soon: 1,
  on_track: 2,
  none: 3,
};

const SEVERITY_RANK: Record<RequestSeverity, number> = {
  emergency: 0,
  prio: 1,
  normal: 2,
};

const PRIORITY_RANK: Record<RequestPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

function matchesSearch(row: RequestListRow, query: string): boolean {
  const haystack = [
    row.requestNumber,
    row.title,
    row.ownerName ?? "",
    row.customerName ?? "",
    row.categoryName ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function matchesFilters(row: RequestListRow, filters: RequestListFilterState): boolean {
  if (filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.priority !== "all" && row.priority !== filters.priority) return false;
  if (filters.severity !== "all" && row.severity !== filters.severity) return false;
  if (filters.categoryId !== "all" && row.categoryId !== filters.categoryId) return false;
  if (filters.source !== "all" && row.source !== filters.source) return false;
  if (filters.slaState !== "all" && row.slaState !== filters.slaState) return false;

  if (filters.ownerAdminId === "unassigned") {
    if (row.ownerAdminId !== null) return false;
  } else if (filters.ownerAdminId !== "all" && row.ownerAdminId !== filters.ownerAdminId) {
    return false;
  }

  if (filters.onlyUnreadExternal && !row.hasUnreadExternal) return false;
  if (filters.onlyAutomationLinked && !row.automationQuickReviewKey) return false;

  const query = filters.search.trim().toLowerCase();
  if (query.length > 0 && !matchesSearch(row, query)) return false;

  return true;
}

function compareRows(
  a: RequestListRow,
  b: RequestListRow,
  sort: RequestListSortKey,
): number {
  const byUpdatedDesc = b.updatedAt.localeCompare(a.updatedAt);
  switch (sort) {
    case "updated_desc":
      return byUpdatedDesc;
    case "created_desc":
      return b.createdAt.localeCompare(a.createdAt) || byUpdatedDesc;
    case "sla_due_asc":
      return SLA_RANK[a.slaState] - SLA_RANK[b.slaState] || byUpdatedDesc;
    case "severity_desc":
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || byUpdatedDesc;
    case "priority_desc":
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byUpdatedDesc;
    case "unread_first":
      return Number(b.hasUnreadExternal) - Number(a.hasUnreadExternal) || byUpdatedDesc;
    case "unassigned_first":
      return (
        Number(b.ownerAdminId === null) - Number(a.ownerAdminId === null) || byUpdatedDesc
      );
    default:
      return byUpdatedDesc;
  }
}

/**
 * Returns a new array of rows that match the filter state, sorted by the chosen
 * sort key. Pure: the input array is never mutated.
 */
export function filterAndSortRequests(
  rows: RequestListRow[],
  filters: RequestListFilterState,
): RequestListRow[] {
  return rows
    .filter((row) => matchesFilters(row, filters))
    .sort((a, b) => compareRows(a, b, filters.sort));
}

/** True when any filter narrows the default (used to show a "clear" affordance). */
export function hasActiveRequestFilters(filters: RequestListFilterState): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.priority !== "all" ||
    filters.severity !== "all" ||
    filters.categoryId !== "all" ||
    filters.ownerAdminId !== "all" ||
    filters.source !== "all" ||
    filters.slaState !== "all" ||
    filters.onlyUnreadExternal ||
    filters.onlyAutomationLinked
  );
}
