import { describe, expect, it } from "vitest";

import {
  buildOccurrenceChangeMessage,
  buildRescheduleMessage,
  rescheduleLogSummary,
  RESCHEDULE_ARROW,
} from "./rescheduleMessaging";

describe("buildRescheduleMessage", () => {
  it("formats a one-time occurrence move with the standard wording and weekday", () => {
    const msg = buildRescheduleMessage({
      scope: "occurrence",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
    });
    expect(msg.scope).toBe("occurrence");
    expect(msg.originalDate).toBe("Saturday 30 May 2026");
    expect(msg.newDate).toBe("Tuesday 02 Jun 2026");
    expect(msg.changed).toBe(true);
    expect(msg.summary).toBe(
      `Rescheduled from Saturday 30 May 2026 ${RESCHEDULE_ARROW} Tuesday 02 Jun 2026`,
    );
    expect(msg.detailLines).toEqual(["One-Time Change"]);
  });

  it("no longer includes the removed 'Future occurrences unchanged' wording", () => {
    const msg = buildRescheduleMessage({
      scope: "occurrence",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
    });
    expect(msg.detailLines.join(" ")).not.toContain("Future occurrences unchanged");
  });

  it("never uses the legacy 'Moved from' wording for occurrences", () => {
    const msg = buildRescheduleMessage({
      scope: "occurrence",
      originalDate: "2026-07-02",
      newDate: "2026-07-03",
    });
    expect(msg.summary).not.toContain("Moved from");
    expect(msg.summary.startsWith("Rescheduled from")).toBe(true);
  });

  it("marks identical original/new dates as not changed (prevents 'X → X')", () => {
    const msg = buildRescheduleMessage({
      scope: "occurrence",
      originalDate: "2026-06-02",
      newDate: "2026-06-02T00:00:00.000Z",
    });
    expect(msg.changed).toBe(false);
  });

  it("formats a series-level move distinctly from an occurrence move", () => {
    const msg = buildRescheduleMessage({
      scope: "series",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
    });
    expect(msg.scope).toBe("series");
    expect(msg.summary).toBe("Series moved");
    expect(msg.detailLines).toEqual(["Future occurrences updated"]);
    expect(msg.originalDate).toBe("Saturday 30 May 2026");
    expect(msg.newDate).toBe("Tuesday 02 Jun 2026");
    expect(msg.changed).toBe(true);
  });

  it("normalizes full ISO timestamps as well as YYYY-MM-DD", () => {
    const msg = buildRescheduleMessage({
      scope: "occurrence",
      originalDate: "2026-05-30T00:00:00.000Z",
      newDate: "2026-06-02",
    });
    expect(msg.originalDate).toMatch(/2026/);
    expect(msg.newDate).toBe("Tuesday 02 Jun 2026");
  });
});

describe("buildOccurrenceChangeMessage", () => {
  it("formats a date-only occurrence reschedule with weekdays", () => {
    const msg = buildOccurrenceChangeMessage({
      scope: "occurrence",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
    });
    expect(msg.changed).toBe(true);
    expect(msg.dateChanged).toBe(true);
    expect(msg.timeChanged).toBe(false);
    expect(msg.lines).toEqual([
      `Rescheduled from Saturday 30 May 2026 ${RESCHEDULE_ARROW} Tuesday 02 Jun 2026`,
    ]);
    expect(msg.detail).toBe("One-Time Change");
  });

  it("formats a time-only change on the same date", () => {
    const msg = buildOccurrenceChangeMessage({
      scope: "occurrence",
      originalDate: "2026-06-02",
      newDate: "2026-06-02",
      originalStartTime: "08:00",
      originalEndTime: "10:00",
      newStartTime: "12:00",
      newEndTime: "14:00",
    });
    expect(msg.changed).toBe(true);
    expect(msg.dateChanged).toBe(false);
    expect(msg.timeChanged).toBe(true);
    expect(msg.lines).toEqual([
      `Time changed from 08:00\u201310:00 ${RESCHEDULE_ARROW} 12:00\u201314:00`,
    ]);
  });

  it("formats a combined date + time change on two lines", () => {
    const msg = buildOccurrenceChangeMessage({
      scope: "occurrence",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
      originalStartTime: "08:00",
      originalEndTime: "10:00",
      newStartTime: "12:00",
      newEndTime: "14:00",
    });
    expect(msg.changed).toBe(true);
    expect(msg.lines).toEqual([
      "Rescheduled from Saturday 30 May 2026, 08:00\u201310:00",
      `${RESCHEDULE_ARROW} Tuesday 02 Jun 2026, 12:00\u201314:00`,
    ]);
  });

  it("reports no change when neither date nor time moved (prevents X → X)", () => {
    const msg = buildOccurrenceChangeMessage({
      scope: "occurrence",
      originalDate: "2026-06-02",
      newDate: "2026-06-02",
      originalStartTime: "08:00",
      originalEndTime: "10:00",
      newStartTime: "08:00",
      newEndTime: "10:00",
    });
    expect(msg.changed).toBe(false);
    expect(msg.dateChanged).toBe(false);
    expect(msg.timeChanged).toBe(false);
    expect(msg.lines).toEqual([]);
  });
});

describe("rescheduleLogSummary", () => {
  it("uses the occurrence summary and appends the reason", () => {
    const summary = rescheduleLogSummary(
      { scope: "occurrence", originalDate: "2026-05-30", newDate: "2026-06-02" },
      "Customer request",
    );
    expect(summary).toBe(
      `Rescheduled from Saturday 30 May 2026 ${RESCHEDULE_ARROW} Tuesday 02 Jun 2026 (Customer request)`,
    );
  });

  it("uses a series-specific summary line", () => {
    const summary = rescheduleLogSummary({
      scope: "series",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
    });
    expect(summary).toBe(
      `Series moved · Saturday 30 May 2026 ${RESCHEDULE_ARROW} Tuesday 02 Jun 2026`,
    );
  });

  it("omits the parenthetical when no reason is given", () => {
    const summary = rescheduleLogSummary({
      scope: "occurrence",
      originalDate: "2026-05-30",
      newDate: "2026-06-02",
    });
    expect(summary.endsWith(")")).toBe(false);
  });
});
