/**
 * REQUEST CRM runtime-safety mock — in-`src` fixtures (Slice 0).
 *
 * Authoring source: `mock-data/request-crm/runtime-safety-mock.seed.json`.
 * DISPLAY-ONLY. Runtime guard policy, rate limits, circuit breakers and kill
 * switches are owned by Automation & AI Center, never by REQUEST CRM. Slice 0
 * may only show mock badges and mocked guard state.
 */
import type { RuntimeSafetyMockRow } from "@/lib/requestCrm/types";
import { REQUEST_CRM_TEST_BATCH_ID } from "@/lib/requestCrm/mockData/settingsShell";

function runtimeRow(
  view: Omit<RuntimeSafetyMockRow, "sourceOfTruth" | "slice0Behavior" | "isTestData" | "testBatchId">,
): RuntimeSafetyMockRow {
  return {
    ...view,
    sourceOfTruth: "Automation & AI Center",
    slice0Behavior: "display only",
    isTestData: true,
    testBatchId: REQUEST_CRM_TEST_BATCH_ID,
  };
}

/** Display-only runtime-safety badges for the Runtime Safety Links tab. */
export const REQUEST_CRM_RUNTIME_SAFETY: RuntimeSafetyMockRow[] = [
  runtimeRow({
    surface: "request_list",
    status: "mock_ok",
    latencyBudgetMs: 300,
    runtimeFlagRef: "request_crm_request_list_guard",
  }),
  runtimeRow({
    surface: "chat_session",
    status: "mock_warning",
    latencyBudgetMs: 500,
    runtimeFlagRef: "request_crm_chat_guard",
  }),
  runtimeRow({
    surface: "notification_center",
    status: "mock_ok",
    latencyBudgetMs: 250,
    runtimeFlagRef: "request_crm_notification_guard",
  }),
];
