import { describe, expect, it } from "vitest";

import {
  REQUEST_CRM_SETTINGS_TABS,
  REQUEST_CRM_DEFAULT_SETTINGS_TAB,
  REQUEST_CRM_SETTINGS_BASE_PATH,
  getRequestCrmSettingsTab,
} from "@/lib/requestCrm/settingsTabs";
import {
  REQUEST_CRM_SETTINGS_ITEMS,
  getRequestCrmSettingsItems,
  REQUEST_CRM_TEST_BATCH_ID,
} from "@/lib/requestCrm/mockData/settingsShell";

/** The eleven sections TICKET-003A requires, in reading order. */
const REQUIRED_SECTION_TITLES = [
  "General",
  "Categories",
  "Request Types",
  "Statuses",
  "Priority & Severity",
  "SLA Defaults",
  "Visibility & Access",
  "Notifications",
  "Internal Posts & Tasks",
  "AI & Automation",
  "Runtime Safety Links",
];

describe("REQUEST CRM settings tab registry", () => {
  it("defines all eleven required sections in reading order", () => {
    expect(REQUEST_CRM_SETTINGS_TABS.map((tab) => tab.title)).toEqual(REQUIRED_SECTION_TITLES);
  });

  it("gives every tab a unique id and a /crm/settings/:id deep-link path", () => {
    const ids = REQUEST_CRM_SETTINGS_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tab of REQUEST_CRM_SETTINGS_TABS) {
      expect(tab.path).toBe(`${REQUEST_CRM_SETTINGS_BASE_PATH}/${tab.id}`);
      expect(tab.shortLabel.length).toBeGreaterThan(0);
    }
  });

  it("resolves known tabs and rejects unknown / missing slugs", () => {
    expect(getRequestCrmSettingsTab("general")?.title).toBe("General");
    expect(getRequestCrmSettingsTab("runtime-safety-links")?.ownership).toBe("central");
    expect(getRequestCrmSettingsTab("does-not-exist")).toBeUndefined();
    expect(getRequestCrmSettingsTab(undefined)).toBeUndefined();
  });

  it("defaults to the general tab", () => {
    expect(REQUEST_CRM_DEFAULT_SETTINGS_TAB).toBe("general");
    expect(getRequestCrmSettingsTab(REQUEST_CRM_DEFAULT_SETTINGS_TAB)).toBeDefined();
  });

  it("renders at least one read-only mock row for every section", () => {
    for (const tab of REQUEST_CRM_SETTINGS_TABS) {
      expect(getRequestCrmSettingsItems(tab.id).length).toBeGreaterThan(0);
    }
  });

  it("marks every settings row as test/demo data with the shared batch id", () => {
    for (const item of REQUEST_CRM_SETTINGS_ITEMS) {
      expect(item.isTestData).toBe(true);
      expect(item.testBatchId).toBe(REQUEST_CRM_TEST_BATCH_ID);
    }
  });

  it("preserves the four canonical rows from settings-shell.seed.json", () => {
    const keys = REQUEST_CRM_SETTINGS_ITEMS.map((item) => item.key);
    for (const seededKey of [
      "settings.request_categories",
      "settings.notification_type_labels",
      "settings.ai_policy_placeholders",
      "settings.runtime_safety_links",
    ]) {
      expect(keys).toContain(seededKey);
    }
  });
});
