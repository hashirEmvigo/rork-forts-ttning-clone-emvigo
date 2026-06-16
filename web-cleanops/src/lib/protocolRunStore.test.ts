import { beforeEach, describe, expect, it } from "vitest";

import {
  cancelRun,
  createRun,
  getRun,
  getRunItems,
  getRunSections,
  getRuns,
  updateItemStatus,
  updateRunStatus,
  type CreateProtocolRunInput,
} from "./protocolRunStore";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";

beforeEach(() => {
  localStorage.clear();
});

function sampleInput(
  overrides?: Partial<CreateProtocolRunInput>,
): CreateProtocolRunInput {
  return {
    sourceTemplateId: "tpl-1",
    sourceTemplateName: "Regular Office Cleaning",
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
    ...overrides,
  };
}

describe("protocolRunStore — creation", () => {
  it("creates a run with snapshotted sections and items", () => {
    const run = createRun(COMPANY, sampleInput());
    expect(run.companyId).toBe(COMPANY);
    expect(run.status).toBe("draft");
    expect(run.sourceTemplateName).toBe("Regular Office Cleaning");
    expect(run.sourceTemplateVersion).toBe(1);

    const sections = getRunSections(COMPANY, run.id);
    expect(sections.map((s) => s.title)).toEqual(["Kitchen", "Bathroom"]);

    const items = getRunItems(COMPANY, sections[0].id);
    expect(items.map((i) => i.title)).toEqual(["Clean sink", "Empty trash"]);
  });

  it("initializes every item as pending", () => {
    const run = createRun(COMPANY, sampleInput());
    const sections = getRunSections(COMPANY, run.id);
    const allItems = sections.flatMap((s) => getRunItems(COMPANY, s.id));
    expect(allItems.every((i) => i.status === "pending")).toBe(true);
    expect(allItems.every((i) => i.completedAt === undefined)).toBe(true);
  });

  it("carries optional booking and work-order context when provided", () => {
    const run = createRun(
      COMPANY,
      sampleInput({ bookingId: "bk-1", workOrderId: "wo-1" }),
    );
    expect(run.bookingId).toBe("bk-1");
    expect(run.workOrderId).toBe("wo-1");
  });
});

describe("protocolRunStore — reads & company scoping", () => {
  it("returns runs newest first and scopes per company", () => {
    const first = createRun(COMPANY, sampleInput());
    const second = createRun(COMPANY, sampleInput());
    createRun(OTHER_COMPANY, sampleInput());

    const runs = getRuns(COMPANY);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe(second.id);
    expect(runs[1].id).toBe(first.id);
  });

  it("does not leak another company's run via getRun", () => {
    const run = createRun(COMPANY, sampleInput());
    expect(getRun(OTHER_COMPANY, run.id)).toBeNull();
    expect(getRun(COMPANY, run.id)?.id).toBe(run.id);
  });

  it("scopes section and item reads by company", () => {
    const run = createRun(COMPANY, sampleInput());
    expect(getRunSections(OTHER_COMPANY, run.id)).toHaveLength(0);
    const section = getRunSections(COMPANY, run.id)[0];
    expect(getRunItems(OTHER_COMPANY, section.id)).toHaveLength(0);
  });
});

describe("protocolRunStore — run status", () => {
  it("stamps completedAt when completed and clears it otherwise", () => {
    const run = createRun(COMPANY, sampleInput());
    const completed = updateRunStatus(COMPANY, run.id, "completed");
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toBeDefined();

    const reopened = updateRunStatus(COMPANY, run.id, "in_progress");
    expect(reopened?.status).toBe("in_progress");
    expect(reopened?.completedAt).toBeUndefined();
  });

  it("cancels a run", () => {
    const run = createRun(COMPANY, sampleInput());
    const cancelled = cancelRun(COMPANY, run.id);
    expect(cancelled?.status).toBe("cancelled");
  });

  it("returns null for an unknown / wrong-company run", () => {
    const run = createRun(COMPANY, sampleInput());
    expect(updateRunStatus(OTHER_COMPANY, run.id, "completed")).toBeNull();
    expect(updateRunStatus(COMPANY, "missing", "completed")).toBeNull();
  });
});

describe("protocolRunStore — item status", () => {
  it("marks an item done with completedBy and completedAt", () => {
    const run = createRun(COMPANY, sampleInput());
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];

    const done = updateItemStatus(COMPANY, run.id, item.id, "done", {
      completedBy: "emp-1",
    });
    expect(done?.status).toBe("done");
    expect(done?.completedBy).toBe("emp-1");
    expect(done?.completedAt).toBeDefined();
  });

  it("records skipReason when skipped and clears completion fields", () => {
    const run = createRun(COMPANY, sampleInput());
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];

    updateItemStatus(COMPANY, run.id, item.id, "done", { completedBy: "x" });
    const skipped = updateItemStatus(COMPANY, run.id, item.id, "skipped", {
      skipReason: "Inaccessible",
    });
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.skipReason).toBe("Inaccessible");
    expect(skipped?.completedAt).toBeUndefined();
    expect(skipped?.completedBy).toBeUndefined();
  });

  it("returns null for unknown item or wrong company", () => {
    const run = createRun(COMPANY, sampleInput());
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];
    expect(
      updateItemStatus(OTHER_COMPANY, run.id, item.id, "done"),
    ).toBeNull();
    expect(updateItemStatus(COMPANY, run.id, "missing", "done")).toBeNull();
  });
});
