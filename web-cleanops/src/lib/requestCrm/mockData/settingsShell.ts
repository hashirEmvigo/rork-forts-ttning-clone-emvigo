/**
 * REQUEST CRM Settings Shell — in-`src` mock fixtures (Slice 0).
 *
 * Authoring source: `mock-data/request-crm/settings-shell.seed.json` (validated
 * by `schemas/request-crm/request-settings-shell.schema.json`). Vite only
 * bundles assets imported from `src`, so that package JSON is mirrored here as a
 * typed module. The package JSON remains the spec; this is the importable copy.
 *
 * Every row is visibly test/demo data: `isTestData: true` + a shared
 * `testBatchId` ("RC-DEMO"). These rows are READ-ONLY display data — REQUEST CRM
 * owns no central automation/AI/runtime policy (that is Automation & AI Center).
 */
import type { RequestSettingsShellItem } from "@/lib/requestCrm/types";

/** Shared test batch id for every REQUEST CRM Slice 0 fixture entity. */
export const REQUEST_CRM_TEST_BATCH_ID = "RC-DEMO" as const;

/** Helper that stamps the required test-data markers onto a settings row. */
function row(
  item: Omit<RequestSettingsShellItem, "isTestData" | "testBatchId">,
): RequestSettingsShellItem {
  return { ...item, isTestData: true, testBatchId: REQUEST_CRM_TEST_BATCH_ID };
}

/**
 * Read-only settings rows grouped by section id. The four rows that exist in
 * `settings-shell.seed.json` (request categories, notification type labels, AI
 * policy placeholders, runtime safety links) are preserved verbatim; the other
 * sections are authored as demo rows grounded in the REQUEST CRM contracts and
 * seed package so all eleven sections render meaningfully.
 */
export const REQUEST_CRM_SETTINGS_ITEMS: RequestSettingsShellItem[] = [
  // ── General ────────────────────────────────────────────────────────────────
  row({
    key: "settings.general.module_status",
    sectionId: "general",
    label: "REQUEST CRM module status",
    status: "mock",
    localDomainEffect: "Frontend shell only — mock/read-only, behind feature flags",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_frontend_shell",
  }),
  row({
    key: "settings.general.shared_admin_scope",
    sectionId: "general",
    label: "Shared-admin visibility",
    status: "mock",
    localDomainEffect: "Visible to super_admin and company_admin only",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.general.test_data_mode",
    sectionId: "general",
    label: "Test/demo data mode",
    status: "mock",
    localDomainEffect: "All rows are isTestData with batch RC-DEMO — no persistence",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_test_mode",
  }),

  // ── Categories (from settings-shell.seed.json) ──────────────────────────────
  row({
    key: "settings.request_categories",
    sectionId: "categories",
    label: "Request category configuration",
    status: "mock",
    localDomainEffect: "Defines category labels and default metadata",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.categories.default_owner_strategy",
    sectionId: "categories",
    label: "Default owner strategy per category",
    status: "planned",
    localDomainEffect: "Display-only default owner/support routing labels",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),

  // ── Request Types ───────────────────────────────────────────────────────────
  row({
    key: "settings.request_types",
    sectionId: "request-types",
    label: "Request type catalogue",
    status: "mock",
    localDomainEffect: "Labels per category (e.g. Complaint, Invoice question)",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.request_types.system_locked",
    sectionId: "request-types",
    label: "System (hard-coded) request types",
    status: "mock",
    localDomainEffect: "Read-only seed types cannot be deleted",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),

  // ── Statuses ────────────────────────────────────────────────────────────────
  row({
    key: "settings.statuses.lifecycle",
    sectionId: "statuses",
    label: "Request status lifecycle",
    status: "mock",
    localDomainEffect: "new → open → in_progress → waiting_* → resolved → closed",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.statuses.reopen_policy",
    sectionId: "statuses",
    label: "Reopen handling",
    status: "planned",
    localDomainEffect: "Reopened status label and display rules",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),

  // ── Priority & Severity ─────────────────────────────────────────────────────
  row({
    key: "settings.priority.levels",
    sectionId: "priority-severity",
    label: "Priority levels",
    status: "mock",
    localDomainEffect: "low / normal / high",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.severity.levels",
    sectionId: "priority-severity",
    label: "Severity levels",
    status: "mock",
    localDomainEffect: "normal / prio / emergency",
    centralAutomationLink: "automation_action_registry",
    riskLevelCandidate: "high",
    aiExtensionCandidate: false,
    featureFlag: "enable_emergency_popup",
  }),

  // ── SLA Defaults ────────────────────────────────────────────────────────────
  row({
    key: "settings.sla.default_minutes",
    sectionId: "sla-defaults",
    label: "Default SLA minutes per category",
    status: "planned",
    localDomainEffect: "Display-only SLA placeholders (e.g. 120–480 min)",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.sla.due_soon_candidate",
    sectionId: "sla-defaults",
    label: "SLA due-soon / overdue signal",
    status: "planned",
    localDomainEffect: "Emits request.sla_due_soon event (no local engine)",
    centralAutomationLink: "request.sla_due_soon",
    riskLevelCandidate: "high",
    aiExtensionCandidate: true,
    featureFlag: "enable_request_crm_automation_quick_review",
  }),

  // ── Visibility & Access ─────────────────────────────────────────────────────
  row({
    key: "settings.visibility.thread_separation",
    sectionId: "visibility-access",
    label: "Customer / employee thread separation",
    status: "mock",
    localDomainEffect: "Customer and employee threads never merge by default",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.access.locked_requests",
    sectionId: "visibility-access",
    label: "Locked request access workflow",
    status: "planned",
    localDomainEffect: "Metadata-only preview + access request (display only)",
    centralAutomationLink: "request.access_requested",
    riskLevelCandidate: "high",
    aiExtensionCandidate: false,
    featureFlag: "enable_locked_requests",
  }),
  row({
    key: "settings.access.external_exposure",
    sectionId: "visibility-access",
    label: "External customer/employee exposure",
    status: "disabled",
    localDomainEffect: "Admin-only in Slice 0 — external exposure OFF",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_external_customer_exposure",
  }),

  // ── Notifications (from settings-shell.seed.json) ──────────────────────────
  row({
    key: "settings.notification_type_labels",
    sectionId: "notifications",
    label: "Notification type labels",
    status: "mock",
    localDomainEffect: "Defines labels and display metadata only",
    centralAutomationLink: "automation_action_registry",
    riskLevelCandidate: "medium",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_settings_shell",
  }),
  row({
    key: "settings.notifications.status_model",
    sectionId: "notifications",
    label: "Notification status model",
    status: "mock",
    localDomainEffect: "unread → read → acknowledged → handled → dismissed",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_notification_center",
  }),

  // ── Internal Posts & Tasks ─────────────────────────────────────────────────
  row({
    key: "settings.internal_posts.types",
    sectionId: "internal-posts-tasks",
    label: "Internal post types",
    status: "mock",
    localDomainEffect: "task / phone_call / note / ai_summary / system_note",
    centralAutomationLink: null,
    riskLevelCandidate: "none",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_manager",
  }),
  row({
    key: "settings.internal_tasks.acknowledgement",
    sectionId: "internal-posts-tasks",
    label: "Task acknowledgement & read state",
    status: "planned",
    localDomainEffect: "Assignee ack/unread labels (display only)",
    centralAutomationLink: "internal_task.comment_created",
    riskLevelCandidate: "low",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_automation_quick_review",
  }),

  // ── AI & Automation (from settings-shell.seed.json) ────────────────────────
  row({
    key: "settings.ai_policy_placeholders",
    sectionId: "ai-automation",
    label: "AI extension references",
    status: "planned",
    localDomainEffect: "Displays AI modes per category/type as references",
    centralAutomationLink: "ai_action_extensions",
    riskLevelCandidate: "medium",
    aiExtensionCandidate: true,
    featureFlag: "enable_request_crm_automation_quick_review",
  }),
  row({
    key: "settings.automation.candidate_registry",
    sectionId: "ai-automation",
    label: "Automation candidate references",
    status: "planned",
    localDomainEffect: "Display-only Trigger → … → Resolution quick-review rows",
    centralAutomationLink: "automation_action_registry",
    riskLevelCandidate: "medium",
    aiExtensionCandidate: true,
    featureFlag: "enable_request_crm_automation_quick_review",
  }),

  // ── Runtime Safety Links (from settings-shell.seed.json) ───────────────────
  row({
    key: "settings.runtime_safety_links",
    sectionId: "runtime-safety-links",
    label: "Runtime guard and incident visibility",
    status: "planned",
    localDomainEffect: "Displays mock runtime safety badges",
    centralAutomationLink: "runtime_guard_policies",
    riskLevelCandidate: "high",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_automation_quick_review",
  }),
  row({
    key: "settings.runtime_safety.kill_switch_visibility",
    sectionId: "runtime-safety-links",
    label: "Kill switch / circuit breaker visibility",
    status: "planned",
    localDomainEffect: "Display-only — enforcement owned centrally",
    centralAutomationLink: "runtime_flags_and_kill_switches",
    riskLevelCandidate: "critical",
    aiExtensionCandidate: false,
    featureFlag: "enable_request_crm_automation_quick_review",
  }),
];

/** Returns the read-only settings rows for a given section id. */
export function getRequestCrmSettingsItems(
  sectionId: RequestSettingsShellItem["sectionId"],
): RequestSettingsShellItem[] {
  return REQUEST_CRM_SETTINGS_ITEMS.filter((item) => item.sectionId === sectionId);
}
