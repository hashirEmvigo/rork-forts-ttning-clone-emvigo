/**
 * REQUEST CRM request list — in-`src` mock fixtures (Slice 0).
 *
 * Authoring sources:
 *  - `mock-data/request-crm/request-list.seed.json` (the three canonical rows are
 *    preserved verbatim)
 *  - `mock-data/request-crm/request-categories.seed.json`
 *  - `mock-data/request-crm/request-types.seed.json`
 *  - `mock-data/request-crm/automation-candidates.seed.json` (risk-level lookup)
 *
 * Following the settings-shell precedent, additional demo rows are authored on
 * top of the three seed rows so the list + read-only filters render meaningfully.
 * Every row is visibly test/demo data (`isTestData: true`, batch "RC-DEMO").
 *
 * READ-ONLY. No row implies a live mutation. The `automationQuickReviewKey` /
 * `automationRiskLevel` reference Automation & AI Center, which is the single
 * source of truth for automation, AI and runtime policy — REQUEST CRM only
 * displays them.
 */
import type {
  RequestCategoryView,
  RequestListRow,
  RequestRiskLevel,
  RequestSlaState,
  RequestSource,
  RequestPriority,
  RequestSeverity,
  RequestStatus,
  RequestTypeView,
} from "@/lib/requestCrm/types";
import { REQUEST_CRM_TEST_BATCH_ID } from "@/lib/requestCrm/mockData/settingsShell";

/** Request categories (mirrors `request-categories.seed.json`). */
export const REQUEST_CRM_CATEGORIES: RequestCategoryView[] = [
  {
    id: "cat-customer-service",
    name: "Customer Service",
    defaultPriority: "normal",
    defaultSlaMinutes: 240,
    emailPolicy: "email_allowed",
    automationPolicyRef: "request.customer_message_received",
    aiExtensionRef: "request.ai_suggest_reply",
    active: true,
  },
  {
    id: "cat-finance",
    name: "Finance",
    defaultPriority: "normal",
    defaultSlaMinutes: 480,
    emailPolicy: "notify_only",
    automationPolicyRef: "invoice.question_received",
    aiExtensionRef: "request.ai_summarize_invoice_context",
    active: true,
  },
  {
    id: "cat-worklead",
    name: "Worklead",
    defaultPriority: "high",
    defaultSlaMinutes: 120,
    emailPolicy: "portal_only",
    automationPolicyRef: "schedule.delay_or_staff_issue",
    aiExtensionRef: "request.ai_suggest_internal_task",
    active: true,
  },
  {
    id: "cat-payroll",
    name: "Payroll",
    defaultPriority: "high",
    defaultSlaMinutes: 480,
    emailPolicy: "portal_only",
    automationPolicyRef: "payroll.question_received",
    aiExtensionRef: null,
    active: true,
  },
];

/** Request types (mirrors `request-types.seed.json`). */
export const REQUEST_CRM_REQUEST_TYPES: RequestTypeView[] = [
  { key: "cancellation_rescheduling", label: "Cancellation / Rescheduling", categoryId: "cat-customer-service", hardCoded: true },
  { key: "book_service", label: "Customer wants to book service", categoryId: "cat-customer-service", hardCoded: true },
  { key: "complaint", label: "Complaint", categoryId: "cat-customer-service", hardCoded: true },
  { key: "something_broke", label: "Something broke", categoryId: "cat-worklead", hardCoded: true },
  { key: "customer_information", label: "Customer information", categoryId: "cat-customer-service", hardCoded: true },
  { key: "invoice_question", label: "Invoice question", categoryId: "cat-finance", hardCoded: true },
  { key: "general_message", label: "General message to office", categoryId: null, hardCoded: true },
  { key: "payroll_question", label: "Payroll question", categoryId: "cat-payroll", hardCoded: true },
  { key: "schedule_system_request", label: "Schedule system request", categoryId: "cat-worklead", hardCoded: true },
];

const CATEGORY_NAMES: Record<string, string> = Object.fromEntries(
  REQUEST_CRM_CATEGORIES.map((category) => [category.id, category.name]),
);

/** Display-only owner directory (admin id → name), demo data. */
export const REQUEST_CRM_OWNERS: Record<string, string> = {
  "admin-sebastian": "Sebastian Rios",
  "admin-marcus": "Marcus Lind",
};

/** Display-only customer directory (customer id → name), demo data. */
export const REQUEST_CRM_CUSTOMERS: Record<string, string> = {
  "customer-anna": "Anna Bergström",
  "customer-lena": "Lena Sjöberg",
};

/**
 * Risk-level lookup grounded in `automation-candidates.seed.json`. Keys not
 * present centrally resolve to "none" — REQUEST CRM never invents a risk level.
 */
const AUTOMATION_RISK: Record<string, RequestRiskLevel> = {
  "request.customer_message_received": "medium",
  "request.sla_due_soon": "high",
  "request.access_requested": "high",
  "chat.ai_unable_to_resolve": "medium",
  "internal_task.comment_created": "low",
  "email.delivery_failed": "medium",
  "request.owner_inactive_on_handle_self": "high",
  "request.emergency_created": "critical",
};

interface RequestInput {
  id: string;
  requestNumber: string;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  severity: RequestSeverity;
  categoryId: string | null;
  ownerAdminId: string | null;
  customerId: string | null;
  requestTypeKey: string | null;
  hasUnreadExternal: boolean;
  hasUnacknowledgedInternalTask: boolean;
  automationQuickReviewKey: string | null;
  source: RequestSource;
  slaState: RequestSlaState;
  linkedObjectType: string | null;
  createdAt: string;
  updatedAt: string;
}

function request(input: RequestInput): RequestListRow {
  return {
    ...input,
    ownerName: input.ownerAdminId ? REQUEST_CRM_OWNERS[input.ownerAdminId] ?? input.ownerAdminId : null,
    customerName: input.customerId ? REQUEST_CRM_CUSTOMERS[input.customerId] ?? input.customerId : null,
    categoryName: input.categoryId ? CATEGORY_NAMES[input.categoryId] ?? input.categoryId : null,
    automationRiskLevel: input.automationQuickReviewKey
      ? AUTOMATION_RISK[input.automationQuickReviewKey] ?? "none"
      : "none",
    isTestData: true,
    testBatchId: REQUEST_CRM_TEST_BATCH_ID,
  };
}

/** Read-only request rows for the request list shell. */
export const REQUEST_CRM_REQUESTS: RequestListRow[] = [
  // ── Canonical seed rows (verbatim from request-list.seed.json) ───────────────
  request({
    id: "req-5551",
    requestNumber: "REQ-5551",
    title: "Customer asks to reschedule Friday cleaning",
    status: "open",
    priority: "normal",
    severity: "normal",
    categoryId: "cat-customer-service",
    ownerAdminId: "admin-sebastian",
    customerId: "customer-anna",
    requestTypeKey: "cancellation_rescheduling",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "request.customer_message_received",
    source: "customer_portal",
    slaState: "on_track",
    linkedObjectType: "work_order",
    createdAt: "2026-06-08T09:12:00.000Z",
    updatedAt: "2026-06-11T14:05:00.000Z",
  }),
  request({
    id: "req-5552",
    requestNumber: "REQ-5552",
    title: "Employee reports broken vase",
    status: "waiting_internal",
    priority: "high",
    severity: "prio",
    categoryId: "cat-worklead",
    ownerAdminId: "admin-marcus",
    customerId: "customer-lena",
    requestTypeKey: "something_broke",
    hasUnreadExternal: false,
    hasUnacknowledgedInternalTask: true,
    automationQuickReviewKey: "internal_task.comment_created",
    source: "employee_app",
    slaState: "due_soon",
    linkedObjectType: "work_order",
    createdAt: "2026-06-09T07:40:00.000Z",
    updatedAt: "2026-06-12T08:20:00.000Z",
  }),
  request({
    id: "req-5553",
    requestNumber: "REQ-5553",
    title: "Payroll question - missing hours",
    status: "new",
    priority: "high",
    severity: "normal",
    categoryId: "cat-payroll",
    ownerAdminId: null,
    customerId: null,
    requestTypeKey: "payroll_question",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "request.unassigned_created",
    source: "internal",
    slaState: "on_track",
    linkedObjectType: "employee",
    createdAt: "2026-06-12T06:55:00.000Z",
    updatedAt: "2026-06-12T06:55:00.000Z",
  }),
  // ── Authored demo rows (grounded in the package seeds) ───────────────────────
  request({
    id: "req-5554",
    requestNumber: "REQ-5554",
    title: "Customer complaint about missed window cleaning",
    status: "in_progress",
    priority: "high",
    severity: "prio",
    categoryId: "cat-customer-service",
    ownerAdminId: "admin-sebastian",
    customerId: "customer-anna",
    requestTypeKey: "complaint",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "request.sla_due_soon",
    source: "email_inbound",
    slaState: "overdue",
    linkedObjectType: "work_order",
    createdAt: "2026-06-05T10:30:00.000Z",
    updatedAt: "2026-06-12T11:45:00.000Z",
  }),
  request({
    id: "req-5555",
    requestNumber: "REQ-5555",
    title: "Emergency: water leak reported during visit",
    status: "open",
    priority: "high",
    severity: "emergency",
    categoryId: "cat-worklead",
    ownerAdminId: "admin-marcus",
    customerId: "customer-lena",
    requestTypeKey: "something_broke",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: true,
    automationQuickReviewKey: "request.emergency_created",
    source: "employee_app",
    slaState: "due_soon",
    linkedObjectType: "work_order",
    createdAt: "2026-06-12T13:05:00.000Z",
    updatedAt: "2026-06-12T13:30:00.000Z",
  }),
  request({
    id: "req-5556",
    requestNumber: "REQ-5556",
    title: "Invoice question on April recurring clean",
    status: "waiting_customer",
    priority: "normal",
    severity: "normal",
    categoryId: "cat-finance",
    ownerAdminId: "admin-sebastian",
    customerId: "customer-lena",
    requestTypeKey: "invoice_question",
    hasUnreadExternal: false,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "email.delivery_failed",
    source: "email_inbound",
    slaState: "on_track",
    linkedObjectType: "invoice",
    createdAt: "2026-06-07T15:20:00.000Z",
    updatedAt: "2026-06-10T09:10:00.000Z",
  }),
  request({
    id: "req-5557",
    requestNumber: "REQ-5557",
    title: "Chat handed off: AI could not resolve booking change",
    status: "action_planned",
    priority: "normal",
    severity: "normal",
    categoryId: "cat-customer-service",
    ownerAdminId: "admin-marcus",
    customerId: "customer-anna",
    requestTypeKey: "book_service",
    hasUnreadExternal: false,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "chat.ai_unable_to_resolve",
    source: "chat",
    slaState: "on_track",
    linkedObjectType: "chat_session",
    createdAt: "2026-06-10T12:00:00.000Z",
    updatedAt: "2026-06-11T16:30:00.000Z",
  }),
  request({
    id: "req-5558",
    requestNumber: "REQ-5558",
    title: "Access requested to locked payroll request",
    status: "waiting_internal",
    priority: "normal",
    severity: "prio",
    categoryId: "cat-payroll",
    ownerAdminId: "admin-sebastian",
    customerId: null,
    requestTypeKey: "payroll_question",
    hasUnreadExternal: false,
    hasUnacknowledgedInternalTask: true,
    automationQuickReviewKey: "request.access_requested",
    source: "internal",
    slaState: "due_soon",
    linkedObjectType: "request",
    createdAt: "2026-06-11T08:15:00.000Z",
    updatedAt: "2026-06-12T07:05:00.000Z",
  }),
  request({
    id: "req-5559",
    requestNumber: "REQ-5559",
    title: "Customer wants to add monthly deep clean",
    status: "open",
    priority: "low",
    severity: "normal",
    categoryId: "cat-customer-service",
    ownerAdminId: null,
    customerId: "customer-anna",
    requestTypeKey: "book_service",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "request.customer_message_received",
    source: "customer_portal",
    slaState: "on_track",
    linkedObjectType: "work_order",
    createdAt: "2026-06-09T18:45:00.000Z",
    updatedAt: "2026-06-10T19:00:00.000Z",
  }),
  request({
    id: "req-5560",
    requestNumber: "REQ-5560",
    title: "Schedule system request: staffing gap next week",
    status: "new",
    priority: "high",
    severity: "prio",
    categoryId: "cat-worklead",
    ownerAdminId: null,
    customerId: null,
    requestTypeKey: "schedule_system_request",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "request.owner_inactive_on_handle_self",
    source: "system",
    slaState: "due_soon",
    linkedObjectType: "schedule",
    createdAt: "2026-06-12T05:30:00.000Z",
    updatedAt: "2026-06-12T05:30:00.000Z",
  }),
  request({
    id: "req-5561",
    requestNumber: "REQ-5561",
    title: "General message to office about parking",
    status: "resolved",
    priority: "low",
    severity: "normal",
    categoryId: null,
    ownerAdminId: "admin-marcus",
    customerId: "customer-lena",
    requestTypeKey: "general_message",
    hasUnreadExternal: false,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: null,
    source: "customer_portal",
    slaState: "none",
    linkedObjectType: null,
    createdAt: "2026-06-03T11:10:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
  }),
  request({
    id: "req-5562",
    requestNumber: "REQ-5562",
    title: "Reopened: complaint follow-up not closed",
    status: "reopened",
    priority: "normal",
    severity: "normal",
    categoryId: "cat-customer-service",
    ownerAdminId: "admin-sebastian",
    customerId: "customer-anna",
    requestTypeKey: "complaint",
    hasUnreadExternal: true,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: "request.customer_message_received",
    source: "email_inbound",
    slaState: "overdue",
    linkedObjectType: "work_order",
    createdAt: "2026-05-28T09:00:00.000Z",
    updatedAt: "2026-06-12T10:20:00.000Z",
  }),
  request({
    id: "req-5563",
    requestNumber: "REQ-5563",
    title: "Closed: confirmed reschedule for Tuesday",
    status: "closed",
    priority: "normal",
    severity: "normal",
    categoryId: "cat-customer-service",
    ownerAdminId: "admin-marcus",
    customerId: "customer-anna",
    requestTypeKey: "cancellation_rescheduling",
    hasUnreadExternal: false,
    hasUnacknowledgedInternalTask: false,
    automationQuickReviewKey: null,
    source: "customer_portal",
    slaState: "none",
    linkedObjectType: "work_order",
    createdAt: "2026-06-01T13:25:00.000Z",
    updatedAt: "2026-06-04T15:40:00.000Z",
  }),
];
