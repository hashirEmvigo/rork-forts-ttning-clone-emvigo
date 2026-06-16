import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RequestDetailSheet } from "./RequestDetailSheet";
import { REQUEST_CRM_REQUESTS } from "@/lib/requestCrm/mockData";
import type { RequestListRow } from "@/lib/requestCrm/types";

/**
 * RequestDetailSheet (WAVE-003K-R) tests. The detail/preview drawer is a
 * READ-ONLY foundation: it renders the selected mock request, never fetches or
 * mutates anything, and exposes only inert "later slice" action placeholders.
 */
const row: RequestListRow = REQUEST_CRM_REQUESTS.find((item) => item.id === "req-5551")!;

function renderSheet(open: boolean) {
  return render(
    <TooltipProvider>
      <RequestDetailSheet
        row={open ? row : null}
        open={open}
        onOpenChange={() => {}}
      />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RequestDetailSheet — read-only detail foundation", () => {
  it("renders the selected request detail when open", () => {
    renderSheet(true);
    expect(screen.getByTestId("crm-request-detail")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-detail-title")).toHaveTextContent(row.title);
    expect(screen.getByText(row.requestNumber)).toBeInTheDocument();
    // Resolved display fields appear (owner + source).
    expect(screen.getByText("Sebastian Rios")).toBeInTheDocument();
    expect(screen.getByText("Customer portal")).toBeInTheDocument();
  });

  it("communicates read-only and exposes only disabled placeholder actions (no CRUD)", () => {
    renderSheet(true);
    expect(screen.getByTestId("crm-request-detail-readonly-note")).toBeInTheDocument();

    const actions = screen.getByTestId("crm-request-detail-actions");
    const buttons = within(actions).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });

  it("does not fetch anything (read-only mock data)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderSheet(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders no detail content when closed", () => {
    renderSheet(false);
    expect(screen.queryByTestId("crm-request-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("crm-request-detail-readonly-note")).not.toBeInTheDocument();
  });
});
