/**
 * REQUEST CRM dashboard — in-`src` mock fixtures (Slice 0).
 *
 * Authoring source: `mock-data/request-crm/request-dashboard.seed.json`. The six
 * KPI cards are preserved verbatim (key/label/value) and enriched with a
 * display-only `tone` + `hint` so the read-only dashboard can render meaningful
 * emphasis. Everything is test/demo data (`isTestData: true`, batch "RC-DEMO").
 *
 * REQUEST CRM owns no central automation/AI/runtime policy — the "AI drafts" and
 * "Automation linked" counts merely reference Automation & AI Center, which is
 * the single source of truth.
 */
import type {
  RequestDashboardCard,
  RequestDashboardCardTone,
} from "@/lib/requestCrm/types";
import { REQUEST_CRM_TEST_BATCH_ID } from "@/lib/requestCrm/mockData/settingsShell";

function card(
  key: string,
  label: string,
  value: number,
  tone: RequestDashboardCardTone,
  hint: string,
): RequestDashboardCard {
  return {
    key,
    label,
    value,
    tone,
    hint,
    isTestData: true,
    testBatchId: REQUEST_CRM_TEST_BATCH_ID,
  };
}

/** Read-only KPI cards for the REQUEST CRM dashboard shell. */
export const REQUEST_CRM_DASHBOARD_CARDS: RequestDashboardCard[] = [
  card("open_requests", "Open requests", 18, "info", "Requests not yet resolved or closed."),
  card("unassigned", "Unassigned", 3, "attention", "Open requests with no owner admin."),
  card("sla_due_soon", "SLA due soon", 5, "attention", "Approaching their mock SLA window."),
  card("emergency", "Emergency", 1, "critical", "Severity flagged as emergency."),
  card("ai_drafts", "AI drafts", 4, "ai", "Draft replies suggested — managed centrally."),
  card("automation_linked", "Automation linked", 12, "automation", "Linked to a central automation candidate."),
];
