import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { ProtocolRunsPanel } from "./ProtocolRunsPanel";
import { generateProtocolRun } from "@/lib/protocolRunGenerator";
import { getActiveTemplates } from "@/lib/checklistTemplateStore";
import type { ProtocolRunV2 } from "@/types";

const COMPANY = "company-a";

function seedRun(): ProtocolRunV2 {
  const template = getActiveTemplates(COMPANY)[0];
  return generateProtocolRun(COMPANY, template.id, { generatedBy: "user-1" })!;
}

/** Renders within a router so the panel's deep-link `useSearchParams` works. */
function renderPanel(ui: ReactElement, initialPath = "/protocol-runs") {
  return render(<MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

describe("ProtocolRunsPanel", () => {
  it("shows an empty state when no runs exist", () => {
    renderPanel(<ProtocolRunsPanel companyId={COMPANY} canComplete actorId="emp-1" />);
    expect(screen.getByText(/no protocol runs yet/i)).toBeInTheDocument();
  });

  it("lists generated runs and opens the viewer on click", () => {
    const run = seedRun();
    renderPanel(<ProtocolRunsPanel companyId={COMPANY} canComplete actorId="emp-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`open ${run.sourceTemplateName}`, "i") }),
    );
    // Viewer shows the back control once a run is open.
    expect(screen.getByRole("button", { name: /all runs/i })).toBeInTheDocument();
  });

  it("does not leak another company's runs", () => {
    seedRun();
    renderPanel(<ProtocolRunsPanel companyId="company-b" canComplete actorId="emp-1" />);
    expect(screen.getByText(/no protocol runs yet/i)).toBeInTheDocument();
  });

  it("deep-links directly into a run via the ?run= query param", () => {
    const run = seedRun();
    renderPanel(
      <ProtocolRunsPanel companyId={COMPANY} canComplete actorId="emp-1" />,
      `/protocol-runs?run=${run.id}`,
    );
    // Opens straight into the viewer (back control present).
    expect(screen.getByRole("button", { name: /all runs/i })).toBeInTheDocument();
  });
});
