import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { ProtocolRunViewer } from "./ProtocolRunViewer";
import { generateProtocolRun } from "@/lib/protocolRunGenerator";
import { getActiveTemplates } from "@/lib/checklistTemplateStore";
import {
  getRun,
  getRunItems,
  getRunSections,
} from "@/lib/protocolRunStore";
import type { ProtocolRunV2 } from "@/types";

const COMPANY = "company-a";

/** Seeds the company, generates a run from its first template, returns the run. */
function seedRun(): ProtocolRunV2 {
  const template = getActiveTemplates(COMPANY)[0];
  return generateProtocolRun(COMPANY, template.id, { generatedBy: "user-1" })!;
}

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

describe("ProtocolRunViewer — rendering", () => {
  it("renders the run name, status and every section and item", () => {
    const run = seedRun();
    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete
        actorId="emp-1"
        onBack={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: run.sourceTemplateName }),
    ).toBeInTheDocument();
    expect(screen.getByText(/draft/i)).toBeInTheDocument();

    const sections = getRunSections(COMPANY, run.id);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(screen.getByText(section.title)).toBeInTheDocument();
      for (const item of getRunItems(COMPANY, section.id)) {
        expect(screen.getByText(item.title)).toBeInTheDocument();
      }
    }
  });

  it("calls onBack from the back control", () => {
    const run = seedRun();
    const onBack = vi.fn();
    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete
        actorId="emp-1"
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /all runs/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ProtocolRunViewer — completion workflow", () => {
  it("marks an item done and persists status + completedBy", () => {
    const run = seedRun();
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];

    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete
        actorId="emp-1"
        onBack={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`mark ${item.title} done`, "i") }),
    );

    const stored = getRunItems(COMPANY, section.id).find((i) => i.id === item.id);
    expect(stored?.status).toBe("done");
    expect(stored?.completedBy).toBe("emp-1");
  });

  it("marks an item N/A", () => {
    const run = seedRun();
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];

    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete
        actorId="emp-1"
        onBack={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`mark ${item.title} not applicable`, "i"),
      }),
    );
    const stored = getRunItems(COMPANY, section.id).find((i) => i.id === item.id);
    expect(stored?.status).toBe("na");
  });

  it("requires a reason to skip an item", () => {
    const run = seedRun();
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];

    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete
        actorId="emp-1"
        onBack={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`skip ${item.title}`, "i") }),
    );

    const dialog = screen.getByRole("dialog");
    // Confirming without a reason keeps the item pending and surfaces an error.
    fireEvent.click(within(dialog).getByRole("button", { name: /skip item/i }));
    expect(within(dialog).getByText(/reason is required/i)).toBeInTheDocument();
    expect(
      getRunItems(COMPANY, section.id).find((i) => i.id === item.id)?.status,
    ).toBe("pending");

    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "Area inaccessible" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /skip item/i }));

    const stored = getRunItems(COMPANY, section.id).find((i) => i.id === item.id);
    expect(stored?.status).toBe("skipped");
    expect(stored?.skipReason).toBe("Area inaccessible");
  });

  it("rolls the run status up to in_progress after an action", () => {
    const run = seedRun();
    const section = getRunSections(COMPANY, run.id)[0];
    const item = getRunItems(COMPANY, section.id)[0];

    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete
        actorId="emp-1"
        onBack={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`mark ${item.title} done`, "i") }),
    );
    expect(getRun(COMPANY, run.id)?.status).toBe("in_progress");
  });
});

describe("ProtocolRunViewer — permissions", () => {
  it("hides completion controls in read-only mode", () => {
    const run = seedRun();
    render(
      <ProtocolRunViewer
        companyId={COMPANY}
        run={run}
        canComplete={false}
        actorId="emp-1"
        onBack={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /mark .* done/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^skip /i })).toBeNull();
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
  });
});
