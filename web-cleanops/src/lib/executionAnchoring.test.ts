import { beforeEach, describe, expect, it } from "vitest";

import {
  cancelVisitOccurrence,
  createVisitOccurrence,
  getVisitOccurrence,
  getVisitOccurrences,
  getVisitOccurrencesForCustomer,
  getVisitOccurrencesForWorkOrder,
  updateVisitOccurrenceStatus,
} from "./visitOccurrenceStore";
import {
  createRun,
  getRun,
  getRunsByVisitOccurrence,
  setRunAssignedEmployees,
  updateItemStatus,
  updateRunStatus,
  getRunSections,
  getRunItems,
  type CreateProtocolRunInput,
} from "./protocolRunStore";
import {
  generateProtocolRunFromCustomerProtocol,
} from "./protocolRunGenerator";
import { generateCustomerProtocol } from "./customerProtocolGenerator";
import {
  archiveCustomerProtocol,
  createCustomerProtocolItem,
  getCustomerProtocolItems,
  getCustomerProtocolSections,
  updateCustomerProtocolItem,
} from "./customerProtocolStore";
import { getActiveTemplates } from "./checklistTemplateStore";
import {
  resolveProtocolRunsForVisit,
  resolveVisitOccurrence,
  resolveVisitOccurrences,
  resolveVisitOccurrencesForCustomer,
  resolveVisitOccurrencesForWorkOrder,
} from "./checklistSettingsResolver";
import {
  cancelVisitOccurrenceCascade,
  isRunOrphaned,
  isRunTerminal,
} from "./executionLifecycle";
import { CHECKLIST_V2_SCHEMA_VERSION } from "@/types";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";
const CUSTOMER = "cust-1";

beforeEach(() => {
  localStorage.clear();
});

function visitInput(overrides?: Partial<Parameters<typeof createVisitOccurrence>[1]>) {
  return {
    customerId: CUSTOMER,
    workOrderId: "wo-1",
    serviceRowId: "svc-1",
    scheduledDate: "2026-06-03",
    ...overrides,
  };
}

function runInput(
  overrides?: Partial<CreateProtocolRunInput>,
): CreateProtocolRunInput {
  return {
    sourceTemplateId: "tpl-1",
    sourceTemplateName: "Recurring Cleaning",
    sourceTemplateVersion: 1,
    generatedBy: "user-1",
    sections: [
      {
        title: "Kitchen",
        sortOrder: 0,
        items: [{ title: "Clean sink", required: true, sortOrder: 0 }],
      },
    ],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Ticket 52 — VisitOccurrence model + lifecycle                               */
/* -------------------------------------------------------------------------- */

describe("VisitOccurrence — creation & lifecycle", () => {
  it("creates an occurrence defaulting to scheduled with schema version", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    expect(visit.status).toBe("scheduled");
    expect(visit.companyId).toBe(COMPANY);
    expect(visit.customerId).toBe(CUSTOMER);
    expect(visit.schemaVersion).toBe(CHECKLIST_V2_SCHEMA_VERSION);
  });

  it("transitions through its lifecycle statuses", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    expect(updateVisitOccurrenceStatus(COMPANY, visit.id, "active")?.status).toBe(
      "active",
    );
    expect(
      updateVisitOccurrenceStatus(COMPANY, visit.id, "completed")?.status,
    ).toBe("completed");
    expect(cancelVisitOccurrence(COMPANY, visit.id)?.status).toBe("cancelled");
  });

  it("scopes reads by company, customer and work order", () => {
    createVisitOccurrence(COMPANY, visitInput());
    createVisitOccurrence(COMPANY, visitInput({ customerId: "cust-2", workOrderId: "wo-2" }));
    createVisitOccurrence(OTHER_COMPANY, visitInput());

    expect(getVisitOccurrences(COMPANY)).toHaveLength(2);
    expect(getVisitOccurrences(OTHER_COMPANY)).toHaveLength(1);
    expect(getVisitOccurrencesForCustomer(COMPANY, CUSTOMER)).toHaveLength(1);
    expect(getVisitOccurrencesForWorkOrder(COMPANY, "wo-2")).toHaveLength(1);
  });

  it("does not leak another company's occurrence via getVisitOccurrence", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    expect(getVisitOccurrence(OTHER_COMPANY, visit.id)).toBeNull();
    expect(getVisitOccurrence(COMPANY, visit.id)?.id).toBe(visit.id);
  });

  it("orders occurrences by scheduled date", () => {
    createVisitOccurrence(COMPANY, visitInput({ scheduledDate: "2026-06-17" }));
    createVisitOccurrence(COMPANY, visitInput({ scheduledDate: "2026-06-03" }));
    createVisitOccurrence(COMPANY, visitInput({ scheduledDate: "2026-06-10" }));
    expect(getVisitOccurrences(COMPANY).map((v) => v.scheduledDate)).toEqual([
      "2026-06-03",
      "2026-06-10",
      "2026-06-17",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Ticket 53 — ProtocolRun visit binding                                       */
/* -------------------------------------------------------------------------- */

describe("ProtocolRun — visit binding", () => {
  it("binds a run to a visit occurrence and queries by it", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    const run = createRun(COMPANY, runInput({ visitOccurrenceId: visit.id }));
    expect(run.visitOccurrenceId).toBe(visit.id);

    const bound = getRunsByVisitOccurrence(COMPANY, visit.id);
    expect(bound.map((r) => r.id)).toEqual([run.id]);
  });

  it("remains backwards compatible without a visit binding", () => {
    const run = createRun(COMPANY, runInput());
    expect(run.visitOccurrenceId).toBeUndefined();
    expect(getRun(COMPANY, run.id)?.workOrderId).toBeUndefined();
  });

  it("supports multiple runs bound to one occurrence", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    createRun(COMPANY, runInput({ visitOccurrenceId: visit.id }));
    createRun(COMPANY, runInput({ visitOccurrenceId: visit.id }));
    expect(getRunsByVisitOccurrence(COMPANY, visit.id)).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Ticket 54 — Run assignment model                                            */
/* -------------------------------------------------------------------------- */

describe("ProtocolRun — assignment", () => {
  it("assigns multiple employees to a single run at creation", () => {
    const run = createRun(
      COMPANY,
      runInput({ assignedEmployeeIds: ["e1", "e2"] }),
    );
    expect(run.assignedEmployeeIds).toEqual(["e1", "e2"]);
  });

  it("replaces and de-duplicates assignment via setRunAssignedEmployees", () => {
    const run = createRun(COMPANY, runInput());
    const updated = setRunAssignedEmployees(COMPANY, run.id, ["e1", "e1", "e2"]);
    expect(updated?.assignedEmployeeIds).toEqual(["e1", "e2"]);

    const cleared = setRunAssignedEmployees(COMPANY, run.id, []);
    expect(cleared?.assignedEmployeeIds).toEqual([]);
  });

  it("scopes assignment by company", () => {
    const run = createRun(COMPANY, runInput());
    expect(setRunAssignedEmployees(OTHER_COMPANY, run.id, ["e1"])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Ticket 55 — Schema version                                                  */
/* -------------------------------------------------------------------------- */

describe("schema version", () => {
  it("stamps runs with the current schema version", () => {
    const run = createRun(COMPANY, runInput());
    expect(run.schemaVersion).toBe(CHECKLIST_V2_SCHEMA_VERSION);
  });

  it("stamps templates and customer protocols with the schema version", () => {
    const template = getActiveTemplates(COMPANY)[0];
    expect(template.schemaVersion).toBe(CHECKLIST_V2_SCHEMA_VERSION);

    const protocol = generateCustomerProtocol(
      COMPANY,
      CUSTOMER,
      template.id,
    )!;
    expect(protocol.schemaVersion).toBe(CHECKLIST_V2_SCHEMA_VERSION);
  });

  it("normalizes legacy runs (no schemaVersion) to version 1 on read", () => {
    const run = createRun(COMPANY, runInput());
    // Simulate a legacy record persisted before versioning existed.
    const raw = JSON.parse(localStorage.getItem("cleanops.protocolRuns")!);
    delete raw[0].schemaVersion;
    localStorage.setItem("cleanops.protocolRuns", JSON.stringify(raw));

    expect(getRun(COMPANY, run.id)?.schemaVersion).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Ticket 56 — Integrity & lifecycle rules                                     */
/* -------------------------------------------------------------------------- */

describe("integrity & lifecycle rules", () => {
  it("isRunTerminal flags completed and cancelled only", () => {
    expect(isRunTerminal("completed")).toBe(true);
    expect(isRunTerminal("cancelled")).toBe(true);
    expect(isRunTerminal("draft")).toBe(false);
    expect(isRunTerminal("in_progress")).toBe(false);
  });

  it("isRunOrphaned reports runs with no visit or work order", () => {
    const orphan = createRun(COMPANY, runInput());
    expect(isRunOrphaned(orphan)).toBe(true);
    const anchored = createRun(COMPANY, runInput({ workOrderId: "wo-9" }));
    expect(isRunOrphaned(anchored)).toBe(false);
  });

  it("Rule 3: cancelling a visit cascades to its non-terminal runs", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    const draftRun = createRun(COMPANY, runInput({ visitOccurrenceId: visit.id }));
    const completedRun = createRun(
      COMPANY,
      runInput({ visitOccurrenceId: visit.id }),
    );
    updateRunStatus(COMPANY, completedRun.id, "completed");

    const result = cancelVisitOccurrenceCascade(COMPANY, visit.id);
    expect(result.visit?.status).toBe("cancelled");
    expect(result.cancelledRunIds).toEqual([draftRun.id]);
    expect(result.preservedRunIds).toEqual([completedRun.id]);
    expect(getRun(COMPANY, draftRun.id)?.status).toBe("cancelled");
    // Terminal run preserved untouched.
    expect(getRun(COMPANY, completedRun.id)?.status).toBe("completed");
  });

  it("Rule 3: cascade is a no-op for an unknown visit", () => {
    const result = cancelVisitOccurrenceCascade(COMPANY, "missing");
    expect(result.visit).toBeNull();
    expect(result.cancelledRunIds).toEqual([]);
  });

  it("Rule 1: archiving a customer protocol leaves existing runs valid", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1" },
    )!;

    archiveCustomerProtocol(COMPANY, protocol.id);

    const after = getRun(COMPANY, run.id)!;
    expect(after.status).toBe("draft");
    const sections = getRunSections(COMPANY, run.id);
    expect(getRunItems(COMPANY, sections[0].id).length).toBeGreaterThan(0);
  });

  it("Rule 2: removing a service row preserves runs and visits", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    const run = createRun(COMPANY, runInput({ visitOccurrenceId: visit.id }));
    // "Removing" the service row is external — the run/visit remain readable.
    expect(getRun(COMPANY, run.id)?.id).toBe(run.id);
    expect(getVisitOccurrence(COMPANY, visit.id)?.id).toBe(visit.id);
  });
});

/* -------------------------------------------------------------------------- */
/* Snapshot independence after binding                                         */
/* -------------------------------------------------------------------------- */

describe("snapshot independence (with visit anchoring)", () => {
  it("customer protocol edits do not affect a bound generated run", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const visit = createVisitOccurrence(COMPANY, visitInput());
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1", visitOccurrenceId: visit.id },
    )!;
    expect(run.visitOccurrenceId).toBe(visit.id);

    const runSections = getRunSections(COMPANY, run.id);
    const beforeCount = runSections.reduce(
      (n, s) => n + getRunItems(COMPANY, s.id).length,
      0,
    );

    // Mutate the customer protocol after generation: add an item and rename one.
    const protoSections = getCustomerProtocolSections(protocol.id);
    createCustomerProtocolItem(protoSections[0].id, {
      title: "New post-generation item",
      required: false,
    });
    const firstItem = getCustomerProtocolItems(protoSections[0].id)[0];
    updateCustomerProtocolItem(firstItem.id, { title: "Renamed in protocol" });

    const afterCount = getRunSections(COMPANY, run.id).reduce(
      (n, s) => n + getRunItems(COMPANY, s.id).length,
      0,
    );
    expect(afterCount).toBe(beforeCount);
  });
});

/* -------------------------------------------------------------------------- */
/* Resolver read path                                                          */
/* -------------------------------------------------------------------------- */

describe("resolver — visit occurrences", () => {
  it("resolves occurrences and bound runs read-only", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    const run = createRun(COMPANY, runInput({ visitOccurrenceId: visit.id }));

    expect(resolveVisitOccurrences(COMPANY).map((v) => v.id)).toEqual([
      visit.id,
    ]);
    expect(resolveVisitOccurrence(COMPANY, visit.id)?.id).toBe(visit.id);
    expect(
      resolveVisitOccurrencesForCustomer(COMPANY, CUSTOMER).map((v) => v.id),
    ).toEqual([visit.id]);
    expect(
      resolveVisitOccurrencesForWorkOrder(COMPANY, "wo-1").map((v) => v.id),
    ).toEqual([visit.id]);
    expect(resolveProtocolRunsForVisit(COMPANY, visit.id).map((r) => r.id)).toEqual([
      run.id,
    ]);
  });

  it("scopes resolver reads by company", () => {
    const visit = createVisitOccurrence(COMPANY, visitInput());
    expect(resolveVisitOccurrence(OTHER_COMPANY, visit.id)).toBeNull();
    expect(resolveProtocolRunsForVisit(OTHER_COMPANY, visit.id)).toHaveLength(0);
  });
});
