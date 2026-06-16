/**
 * REQUEST CRM automation candidates — in-`src` mock fixtures (Slice 0).
 *
 * Authoring source: `mock-data/request-crm/automation-candidates.seed.json`.
 * These rows are DISPLAY-ONLY quick-review records. REQUEST CRM never owns the
 * automation registry, risk policy, approval policy, or execution — the single
 * source of truth is Automation & AI Center
 * (`docs/architecture/automation-ai-center/00-automation-ai-center-index.md`).
 *
 * Mapped into the shipped `AutomationQuickReview` contract shape (+ display
 * context), so the AI & Automation tab can render the canonical
 * Trigger → Condition → Risk → Guard → Runtime flag → Log → Resolution intent
 * without any local engine.
 */
import type { RequestAutomationCandidateView } from "@/lib/requestCrm/types";
import { REQUEST_CRM_TEST_BATCH_ID } from "@/lib/requestCrm/mockData/settingsShell";

function candidate(
  view: Omit<RequestAutomationCandidateView, "sourceOfTruth" | "isTestData" | "testBatchId">,
): RequestAutomationCandidateView {
  return {
    ...view,
    sourceOfTruth: "Automation & AI Center",
    isTestData: true,
    testBatchId: REQUEST_CRM_TEST_BATCH_ID,
  };
}

/** Display-only automation quick-review rows for the AI & Automation tab. */
export const REQUEST_CRM_AUTOMATION_CANDIDATES: RequestAutomationCandidateView[] = [
  candidate({
    centralActionKey: "request.customer_message_received",
    riskLevel: "medium",
    aiExtensionCandidate: true,
    slice0Behavior: "render quick-review only",
    trigger: "Customer-visible message created",
    guardAction: "notify owner/support and unsnooze if needed",
    ownerModule: "request",
  }),
  candidate({
    centralActionKey: "request.sla_due_soon",
    riskLevel: "high",
    aiExtensionCandidate: true,
    slice0Behavior: "mock badge only",
    trigger: "SLA due soon",
    guardAction: "create prio dashboard/notification candidate",
    ownerModule: "request",
  }),
  candidate({
    centralActionKey: "request.access_requested",
    riskLevel: "high",
    aiExtensionCandidate: false,
    slice0Behavior: "mock notification only",
    trigger: "Admin requests access to locked request",
    guardAction: "notify owner/support; escalate on timeout",
    ownerModule: "request",
  }),
  candidate({
    centralActionKey: "chat.ai_unable_to_resolve",
    riskLevel: "medium",
    aiExtensionCandidate: true,
    slice0Behavior: "render mock draft state only",
    trigger: "Mock/AI reports cannot solve chat",
    guardAction: "create request draft or notify admin per central policy",
    ownerModule: "chat",
  }),
  candidate({
    centralActionKey: "request.emergency_created",
    riskLevel: "critical",
    aiExtensionCandidate: false,
    slice0Behavior: "mock emergency card only",
    trigger: "Emergency request created",
    guardAction: "emergency popup/ack flow per central policy",
    ownerModule: "request",
  }),
];
