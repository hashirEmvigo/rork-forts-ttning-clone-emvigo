import { describe, expect, it } from "vitest";

import {
  CHECKLIST_SETTINGS_MODULES,
  getChecklistSettingsModule,
} from "./checklistSettingsModules";

describe("checklistSettingsModules", () => {
  it("registers the Checklist Templates module with a dedicated route", () => {
    const module = getChecklistSettingsModule("checklist-templates");
    expect(module).toBeDefined();
    expect(module?.title).toBe("Checklist Templates");
    expect(module?.path).toBe("/settings/checklists/checklist-templates");
  });

  it("keeps unique ids and paths across all modules", () => {
    const ids = CHECKLIST_SETTINGS_MODULES.map((m) => m.id);
    const paths = CHECKLIST_SETTINGS_MODULES.map((m) => m.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
