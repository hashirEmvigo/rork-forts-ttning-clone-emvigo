import { beforeEach, describe, expect, it } from "vitest";

import { computeRunStatus, recomputeRunStatus } from "./runStatusRollup";
import {
  createRun,
  getRunItems,
  getRunSections,
  updateItemStatus,
  updateRunStatus,
  type CreateProtocolRunInput,
} from "./protocolRunStore";
import type { ProtocolRunItem, ProtocolRunItemStatus } from "@/types";

const COMPANY = "company-a";

beforeEach(() => {
  localStorage.clear();
});

/** Builds a minimal run item for pure-logic tests. */
function item(
  status: ProtocolRunItemStatus,
  required: boolean,
): ProtocolRunItem {
  return {
    id: `i-${Math.random()}`,
    companyId: COMPANY,
    runId: "run",
    sectionId: "sec",
    title: "Item",
    required,
    sortOrder: 0,
    status,
  };
}

function sampleInput(): CreateProtocolRunInput {
  return {
    sourceTemplateId: "tpl-1",
    sourceTemplateName: "Office Cleaning",
    sourceTemplateVersion: 1,
    generatedBy: "user-1",
    sections: [
      {
        title: "Kitchen",
        sortOrder: 0,
        items: [
          { title: "Clean sink", required: true, sortOrder: 0 },
          { title: "Empty trash", required: false, sortOrder: 10 },
        ],
      },
      {
        title: "Bathroom",
        sortOrder: 10,
        items: [{ title: "Clean toilet", required: true, sortOrder: 0 }],
      },
    ],
  };
}

describe("computeRunStatus — pure logic", () => {
  it("is draft when every item is pending", () => {
    const items = [item("pending", true), item("pending", false)];
    expect(computeRunStatus("draft", items)).toBe("draft");
  });

  it("is draft for a run with no items", () => {
    expect(computeRunStatus("draft", [])).toBe("draft");
  });

  it("is in_progress when some items are resolved but required ones remain", () => {
    const items = [item("done", false), item("pending", true)];
    expect(computeRunStatus("draft", items)).toBe("in_progress");
  });

  it("is completed once every required item is resolved", () => {
    const items = [
      item("done", true),
      item("skipped", true),
      item("pending", false),
    ];
    expect(computeRunStatus("in_progress", items)).toBe("completed");
  });

  it("treats done, skipped and na all as resolved for required items", () => {
    const items = [item("na", true), item("skipped", true), item("done", true)];
    expect(computeRunStatus("draft", items)).toBe("completed");
  });

  it("requires all items resolved to complete when there are no required items", () => {
    const partial = [item("done", false), item("pending", false)];
    expect(computeRunStatus("draft", partial)).toBe("in_progress");
    const allDone = [item("done", false), item("na", false)];
    expect(computeRunStatus("draft", allDone)).toBe("completed");
  });

  it("never overrides a cancelled run", () => {
    const items = [item("done", true)];
    expect(computeRunStatus("cancelled", items)).toBe("cancelled");
  });
});

describe("recomputeRunStatus — persistence", () => {
  it("rolls a run to in_progress after the first item action", () => {
    const run = createRun(COMPANY, sampleInput());
    const section = getRunSections(COMPANY, run.id)[0];
    const firstItem = getRunItems(COMPANY, section.id)[0];

    updateItemStatus(COMPANY, run.id, firstItem.id, "done", {
      completedBy: "emp-1",
    });
    const updated = recomputeRunStatus(COMPANY, run.id);
    expect(updated?.status).toBe("in_progress");
  });

  it("rolls a run to completed once all required items are resolved", () => {
    const run = createRun(COMPANY, sampleInput());
    const allItems = getRunSections(COMPANY, run.id).flatMap((s) =>
      getRunItems(COMPANY, s.id),
    );
    for (const it of allItems.filter((i) => i.required)) {
      updateItemStatus(COMPANY, run.id, it.id, "done", { completedBy: "emp-1" });
    }
    const updated = recomputeRunStatus(COMPANY, run.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeDefined();
  });

  it("does not auto-transition a cancelled run", () => {
    const run = createRun(COMPANY, sampleInput());
    updateRunStatus(COMPANY, run.id, "cancelled");
    const section = getRunSections(COMPANY, run.id)[0];
    const firstItem = getRunItems(COMPANY, section.id)[0];
    updateItemStatus(COMPANY, run.id, firstItem.id, "done");
    expect(recomputeRunStatus(COMPANY, run.id)?.status).toBe("cancelled");
  });

  it("returns null for an unknown / wrong-company run", () => {
    expect(recomputeRunStatus(COMPANY, "missing")).toBeNull();
  });
});
