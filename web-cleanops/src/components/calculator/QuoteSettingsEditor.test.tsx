import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteSettingsEditor } from "./QuoteSettingsEditor";
import type { CalculatorSettingsConfig } from "@/lib/calculator/calculatorConfigAdmin";

const SETTINGS: CalculatorSettingsConfig = {
  legacyId: "calc_settings_x",
  companyId: "co-uuid",
  companyLegacyId: "cmp_x",
  enabled: false,
  publicSlug: "rakna-ut-ditt-pris",
  priceDisplayMode: "range",
  showPriceBeforeContact: true,
  requireContactBeforeResult: false,
  showLoginPromptAfterSubmit: true,
  quoteValidityDays: 30,
  manualReviewThresholdAmount: null,
  currency: "SEK",
  rutDisplayMode: "none",
  defaultVatRatePercent: 25,
  autoCreateProspect: true,
  autoCreateQuoteRequest: true,
  defaultQuoteStatus: "submitted",
};

const handlers = {
  onRequestToggleEnabled: vi.fn(),
  onSaveSettings: vi.fn().mockResolvedValue(undefined),
};

function renderEditor(enabled = false) {
  return render(
    <QuoteSettingsEditor
      settings={{ ...SETTINGS, enabled }}
      enabled={enabled}
      isUpdatingEnabled={false}
      onRequestToggleEnabled={handlers.onRequestToggleEnabled}
      onSaveSettings={handlers.onSaveSettings}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuoteSettingsEditor", () => {
  it("shows status + a read-only public slug", () => {
    renderEditor(false);
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("/rakna-ut-ditt-pris")).toBeInTheDocument();
    // No editable input for the slug.
    expect(screen.queryByLabelText(/slug/i)).not.toBeInTheDocument();
  });

  it("delegates the enable switch to the confirm flow", () => {
    renderEditor(false);
    fireEvent.click(screen.getByRole("button", { name: "Enable calculator" }));
    expect(handlers.onRequestToggleEnabled).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveSettings).not.toHaveBeenCalled();
  });

  it("validates quote validity before saving", () => {
    renderEditor(false);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/Quote validity/), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(screen.getByText(/between 1 and 365/i)).toBeInTheDocument();
    expect(handlers.onSaveSettings).not.toHaveBeenCalled();
  });

  it("saves a valid quote-validity change", () => {
    renderEditor(false);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/Quote validity/), { target: { value: "45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(handlers.onSaveSettings).toHaveBeenCalledWith(
      "calc_settings_x",
      expect.objectContaining({ quoteValidityDays: 45 }),
    );
  });

  // GPM-UX-ADMIN-4 — "Recent pricing changes" relocated here from the Pricing workspace.
  it("renders the relocated pricing-change history when audit data is provided", () => {
    render(
      <QuoteSettingsEditor
        settings={SETTINGS}
        enabled={false}
        isUpdatingEnabled={false}
        audit={{ entries: [], isLoading: false }}
        onRequestToggleEnabled={handlers.onRequestToggleEnabled}
        onSaveSettings={handlers.onSaveSettings}
      />,
    );
    expect(screen.getByText("Recent pricing changes")).toBeInTheDocument();
    expect(screen.getByText("No pricing changes recorded yet.")).toBeInTheDocument();
  });

  it("omits the pricing-change history when no audit data is provided", () => {
    renderEditor(false);
    expect(screen.queryByText("Recent pricing changes")).not.toBeInTheDocument();
  });
});
