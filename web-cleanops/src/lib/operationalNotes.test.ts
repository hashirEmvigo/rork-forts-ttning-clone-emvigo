import { describe, expect, it } from "vitest";
import {
  collectOperationalNotes,
  hasOperationalNotes,
} from "./operationalNotes";

describe("collectOperationalNotes", () => {
  it("returns [] when there are no notes", () => {
    expect(collectOperationalNotes({})).toEqual([]);
    expect(hasOperationalNotes({})).toBe(false);
  });

  it("treats blank/whitespace notes as empty", () => {
    expect(
      collectOperationalNotes({
        scheduleNote: "   ",
        workOrderNotes: [{ title: "  ", content: "" }],
        customerNotes: [{ title: "", content: "   " }],
      }),
    ).toEqual([]);
  });

  it("builds a single schedule group from the schedule note", () => {
    const groups = collectOperationalNotes({ scheduleNote: "Bring ladder" });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "schedule",
      label: "Schedule note",
      priority: 3,
      notes: [{ title: "Schedule note", content: "Bring ladder" }],
    });
    expect(hasOperationalNotes({ scheduleNote: "Bring ladder" })).toBe(true);
  });

  it("orders groups schedule > work order > customer", () => {
    const groups = collectOperationalNotes({
      customerNotes: [{ title: "Alarm", content: "1234" }],
      workOrderNotes: [{ title: "Project", content: "Phase 1" }],
      scheduleNote: "Two cleaners",
    });
    expect(groups.map((g) => g.key)).toEqual(["schedule", "workOrder", "customer"]);
  });

  it("keeps multiple notes within a group and trims them", () => {
    const groups = collectOperationalNotes({
      workOrderNotes: [
        { title: " A ", content: " one " },
        { title: "B", content: "two" },
        { title: "", content: "" },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].notes).toEqual([
      { title: "A", content: "one" },
      { title: "B", content: "two" },
    ]);
  });

  it("omits groups that have no usable notes", () => {
    const groups = collectOperationalNotes({
      scheduleNote: "",
      workOrderNotes: [{ title: "Keep", content: "me" }],
      customerNotes: [],
    });
    expect(groups.map((g) => g.key)).toEqual(["workOrder"]);
  });
});
