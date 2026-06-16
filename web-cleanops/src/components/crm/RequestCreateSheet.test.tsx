import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestCreateSheet } from "./RequestCreateSheet";
import { REQUEST_CRM_REQUESTS } from "@/lib/requestCrm/mockData";

/**
 * RequestCreateSheet (WAVE-003L-R) tests. The manual-create foundation captures
 * only local UI preview state: no fetch, no Supabase, no mutation of the imported
 * mock request list, and future operational sections remain disabled/read-only.
 */
function renderSheet(open: boolean = true) {
  return render(<RequestCreateSheet open={open} onOpenChange={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RequestCreateSheet — local-only create foundation", () => {
  it("renders the safe foundation-level form fields", () => {
    renderSheet();

    expect(screen.getByTestId("crm-request-create-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-title")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-category")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-type")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-source")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-priority")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-customer")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-description")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-linked-object")).toBeInTheDocument();
  });

  it("submits to local preview only without fetch or mock-list mutation", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const beforeIds = REQUEST_CRM_REQUESTS.map((request) => request.id);
    const beforeLength = REQUEST_CRM_REQUESTS.length;

    renderSheet();
    fireEvent.change(screen.getByTestId("crm-request-create-title"), {
      target: { value: "Manual admin intake preview" },
    });
    fireEvent.change(screen.getByTestId("crm-request-create-customer"), {
      target: { value: "Customer ACME / invoice 123" },
    });
    fireEvent.change(screen.getByTestId("crm-request-create-description"), {
      target: { value: "Internal admin note captured for UI preview only." },
    });
    fireEvent.click(screen.getByTestId("crm-request-create-submit"));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(REQUEST_CRM_REQUESTS).toHaveLength(beforeLength);
    expect(REQUEST_CRM_REQUESTS.map((request) => request.id)).toEqual(beforeIds);
    expect(screen.getByTestId("crm-request-create-success")).toHaveTextContent(
      "Draft request captured locally for UI preview only.",
    );
    expect(screen.getByTestId("crm-request-create-success")).toHaveTextContent(
      "Persistence arrives in a later backend slice.",
    );
  });

  it("marks assignment, status and automation sections as later-slice read-only placeholders", () => {
    renderSheet();

    expect(screen.getByTestId("crm-request-create-future-assignment")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("crm-request-create-future-status")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("crm-request-create-future-automation")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getAllByText("Later slice")).toHaveLength(3);
  });

  it("renders no create content when closed", () => {
    renderSheet(false);
    expect(screen.queryByTestId("crm-request-create-sheet")).not.toBeInTheDocument();
  });
});
