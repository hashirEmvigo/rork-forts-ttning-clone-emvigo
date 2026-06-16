/**
 * REQUEST CRM — in-`src` type mirror (Slice 0, frontend shell only).
 *
 * The canonical TypeScript contracts ship at
 * `contracts/typescript/request-crm/request-crm-contracts.ts`. That file lives
 * OUTSIDE `src`, and this app's `tsconfig.app.json` only includes `src` (the
 * `@/*` alias maps to `src/*`), so the shipped file cannot be imported across
 * the boundary without changing the build. To honour the ticket's "reuse the
 * shipped types, do not redefine them" intent while keeping the build clean,
 * this module is a faithful in-`src` mirror of the contract shapes — keep it
 * byte-aligned with the contracts file if that file changes.
 *
 * Nothing here implements behaviour. These are display/mock types for the
 * read-only REQUEST CRM Settings Shell.
 */

/** Mirrors `RequestStatus` from the shipped contracts. */
export type RequestStatus =
  | "new"
  | "open"
  | "in_progress"
  | "waiting_customer"
  | "waiting_employee"
  | "waiting_internal"
  | "action_planned"
  | "resolved"
  | "closed"
  | "reopened";

/** Mirrors `RequestPriority` from the shipped contracts. */
export type RequestPriority = "low" | "normal" | "high";

/** Mirrors `RequestSeverity` from the shipped contracts. */
export type RequestSeverity = "normal" | "prio" | "emergency";

/** Mirrors `ThreadType` from the shipped contracts. */
export type ThreadType =
  | "customer"
  | "employee"
  | "shared_customer_employee"
  | "internal"
  | "ai_intake";

/** Risk level vocabulary shared with Automation & AI Center (central owner). */
export type RequestRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Mirrors `AutomationQuickReview` from the shipped contracts. Display-only in
 * REQUEST CRM — the source of truth is always Automation & AI Center.
 */
export interface AutomationQuickReview {
  centralActionKey: string;
  riskLevel: RequestRiskLevel;
  aiExtensionCandidate: boolean;
  sourceOfTruth: "Automation & AI Center";
  slice0Behavior: "mock/read-only" | string;
}

/**
 * Mirrors `RuntimeSafetyMockStatus` from the shipped contracts. Display-only —
 * runtime guard/kill-switch state is owned centrally, never by REQUEST CRM.
 */
export interface RuntimeSafetyMockStatus {
  surface: string;
  status: "mock_ok" | "mock_warning" | "mock_disabled";
  latencyBudgetMs: number;
  runtimeFlagRef: string;
  sourceOfTruth: "Automation & AI Center";
  slice0Behavior: "display only";
}

/**
 * Composes the {@link AutomationQuickReview} contract with the extra
 * display-only context carried by `mock-data/request-crm/automation-candidates`
 * so the AI & Automation tab can render a richer read-only quick-review row.
 */
export interface RequestAutomationCandidateView extends AutomationQuickReview {
  trigger: string;
  guardAction: string;
  ownerModule: string;
  isTestData: true;
  testBatchId: string;
}

/** Display-only runtime-safety row (mirrors the runtime-safety-mock seed). */
export interface RuntimeSafetyMockRow extends RuntimeSafetyMockStatus {
  isTestData: true;
  testBatchId: string;
}

/**
 * Implementation status for a settings-shell row. Mirrors the `status` enum in
 * `schemas/request-crm/request-settings-shell.schema.json`.
 */
export type RequestSettingsItemStatus = "mock" | "planned" | "active_later" | "disabled";

/**
 * A single read-only row inside a settings section. Mirrors
 * `RequestSettingsShellItem` from `request-settings-shell.schema.json`, plus the
 * test-data markers required by the REQUEST CRM test-data policy.
 *
 * Snake_case JSON fields from the seed are adapted to camelCase here.
 */
export interface RequestSettingsShellItem {
  key: string;
  /** Section id this row belongs to (maps to a settings tab). */
  sectionId: RequestSettingsSectionId;
  label: string;
  status: RequestSettingsItemStatus;
  /** What REQUEST CRM owns locally for this row (display copy). */
  localDomainEffect: string | null;
  /** Reference into Automation & AI Center; null when fully local. */
  centralAutomationLink: string | null;
  riskLevelCandidate: RequestRiskLevel | "none";
  aiExtensionCandidate: boolean;
  /** Related feature flag key (display only). */
  featureFlag: string | null;
  isTestData: true;
  testBatchId: string;
}

/** Stable ids for the eleven REQUEST CRM settings sections (also route slugs). */
export type RequestSettingsSectionId =
  | "general"
  | "categories"
  | "request-types"
  | "statuses"
  | "priority-severity"
  | "sla-defaults"
  | "visibility-access"
  | "notifications"
  | "internal-posts-tasks"
  | "ai-automation"
  | "runtime-safety-links";

/** Whether a section's data maps to a central Automation & AI Center owner. */
export type RequestSettingsOwnership = "local" | "central-linked" | "central";

// ── Dashboard + Request List shell (TICKET-003B) ─────────────────────────────
// Display/mock view models for the read-only `/crm/dashboard` and `/crm/requests`
// shells. REQUEST CRM owns none of the central automation/AI/runtime policy these
// rows reference — the source of truth is always Automation & AI Center.

/**
 * Mirrors `RequestListItem` from the shipped contracts
 * (`contracts/typescript/request-crm/request-crm-contracts.ts`). Keep this
 * byte-aligned with the contract if that file changes.
 */
export interface RequestListItem {
  id: string;
  requestNumber: string;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  severity: RequestSeverity;
  categoryId?: string | null;
  ownerAdminId?: string | null;
  customerId?: string | null;
  hasUnreadExternal: boolean;
  hasUnacknowledgedInternalTask: boolean;
  automationQuickReviewKey?: string | null;
  isTestData: boolean;
  testBatchId?: string;
}

/** Display-only SLA state for a request row (UI filter spec "SLA state"). */
export type RequestSlaState = "on_track" | "due_soon" | "overdue" | "none";

/** Display-only origin of a request (UI filter spec "source"). */
export type RequestSource =
  | "customer_portal"
  | "employee_app"
  | "email_inbound"
  | "chat"
  | "internal"
  | "system";

/**
 * Read-only request list row: the shipped {@link RequestListItem} contract plus
 * the extra presentation fields the list + filters render (resolved owner /
 * category / customer labels, SLA state, source, linked object, and mock
 * timestamps). Display only — no field here implies a live mutation, and the
 * `automationQuickReviewKey`/`automationRiskLevel` are owned centrally.
 */
export interface RequestListRow extends RequestListItem {
  categoryId: string | null;
  ownerAdminId: string | null;
  customerId: string | null;
  ownerName: string | null;
  customerName: string | null;
  categoryName: string | null;
  requestTypeKey: string | null;
  slaState: RequestSlaState;
  source: RequestSource;
  linkedObjectType: string | null;
  automationRiskLevel: RequestRiskLevel | "none";
  updatedAt: string;
  createdAt: string;
  isTestData: true;
  testBatchId: string;
}

/** Sort options offered by the request list (UI filter spec "sorting"). */
export type RequestListSortKey =
  | "updated_desc"
  | "created_desc"
  | "sla_due_asc"
  | "severity_desc"
  | "priority_desc"
  | "unread_first"
  | "unassigned_first";

/** Visual emphasis for a dashboard KPI card (display only). */
export type RequestDashboardCardTone =
  | "neutral"
  | "info"
  | "attention"
  | "critical"
  | "ai"
  | "automation";

/**
 * A single read-only dashboard KPI card. Authored from
 * `mock-data/request-crm/request-dashboard.seed.json` and enriched with a
 * display-only tone + hint.
 */
export interface RequestDashboardCard {
  key: string;
  label: string;
  value: number;
  tone: RequestDashboardCardTone;
  hint: string;
  isTestData: true;
  testBatchId: string;
}

/** Email handling policy label for a category (display only). */
export type RequestEmailPolicy = "email_allowed" | "notify_only" | "portal_only";

/**
 * Read-only request category view. Mirrors
 * `mock-data/request-crm/request-categories.seed.json` (snake_case adapted to
 * camelCase). Used for filter labels and category resolution in the list.
 */
export interface RequestCategoryView {
  id: string;
  name: string;
  defaultPriority: RequestPriority;
  defaultSlaMinutes: number;
  emailPolicy: RequestEmailPolicy;
  automationPolicyRef: string | null;
  aiExtensionRef: string | null;
  active: boolean;
}

/**
 * Read-only request type view. Mirrors
 * `mock-data/request-crm/request-types.seed.json`.
 */
export interface RequestTypeView {
  key: string;
  label: string;
  categoryId: string | null;
  hardCoded: boolean;
}
