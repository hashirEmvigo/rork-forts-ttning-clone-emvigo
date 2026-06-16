import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesFieldsEditor } from "./ServicesFieldsEditor";
import type {
  CalculatorQuestionConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

/**
 * Slice GPM-2a — admin Services list grouping. The default view shows only the V2
 * pilot (Home Cleaning); the seeded legacy services collapse behind a toggle. This
 * is presentation-only: no DB write, no public-visibility change.
 */

function makeQuestion(over: Partial<CalculatorQuestionConfig> = {}): CalculatorQuestionConfig {
  return {
    legacyId: "q_sqm",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    questionKey: "sqm",
    label: "Boyta (m²)",
    helpText: null,
    inputType: "integer",
    required: true,
    affectsPricing: true,
    sortOrder: 1,
    active: true,
    options: [],
    ...over,
  };
}

function makeService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  return {
    id: "svc-home",
    legacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    description: "Återkommande hemstädning",
    enabled: true,
    comingSoon: false,
    pricingModel: "home_cleaning_recommended_hours",
    sortOrder: 1,
    requiresCleaningPlan: false,
    plansEnabled: false,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: null,
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [makeQuestion()],
    ...over,
  };
}

const HOME = makeService();

const MOVE_OUT = makeService({
  id: "svc-move",
  legacyId: "svc_move_legacy",
  serviceKey: "move_out_cleaning",
  displayName: "Flyttstädning",
  pricingModel: "move_out_fixed_plus_addons",
  enabled: true,
  sortOrder: 2,
  questions: [
    makeQuestion({
      legacyId: "q_move_sqm",
      serviceId: "svc-move",
      serviceLegacyId: "svc_move_legacy",
      questionKey: "sqm",
      label: "Bostadsyta vid flytt (m²)",
    }),
  ],
});

const OFFICE = makeService({
  id: "svc-office",
  legacyId: "svc_office_legacy",
  serviceKey: "office_cleaning",
  displayName: "Kontorsstädning",
  pricingModel: "office_cleaning_recurring_area_frequency",
  enabled: true,
  sortOrder: 3,
  questions: [],
});

const WINDOW_DRAFT = makeService({
  id: "svc-window",
  legacyId: "svc_window_legacy",
  serviceKey: "window_cleaning",
  displayName: "Fönsterputs",
  pricingModel: "window_cleaning_count_based",
  enabled: false,
  comingSoon: false,
  sortOrder: 4,
  questions: [],
});

const handlers = {
  onSaveService: vi.fn().mockResolvedValue(undefined),
  onSaveQuestion: vi.fn().mockResolvedValue(undefined),
  onAddQuestion: vi.fn().mockResolvedValue(undefined),
  onAddService: vi.fn().mockResolvedValue(undefined),
  onArchiveService: vi.fn().mockResolvedValue(undefined),
};

function renderEditor(services: CalculatorServiceConfig[]) {
  return render(
    <ServicesFieldsEditor
      services={services}
      companyId="co-uuid"
      companyLegacyId="cmp_x"
      onSaveService={handlers.onSaveService}
      onSaveQuestion={handlers.onSaveQuestion}
      onAddQuestion={handlers.onAddQuestion}
      onAddService={handlers.onAddService}
      onArchiveService={handlers.onArchiveService}
    />,
  );
}

const LEGACY_TOGGLE = /legacy \/ default services/i;

function expandLegacy() {
  fireEvent.click(screen.getByRole("button", { name: LEGACY_TOGGLE }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesFieldsEditor — GPM-2a default view", () => {
  it("shows only Home Cleaning (the pilot) and hides the seeded legacy services by default", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);

    // Home (pilot) is visible + tagged as the V2 pilot.
    expect(screen.getByRole("button", { name: /Hemstädning/i })).toBeInTheDocument();
    expect(screen.getByText("V2 Pilot")).toBeInTheDocument();

    // The seeded legacy services are NOT rendered until the toggle is opened.
    expect(screen.queryByText("Flyttstädning")).not.toBeInTheDocument();
    expect(screen.queryByText("Kontorsstädning")).not.toBeInTheDocument();
    expect(screen.queryByText("Fönsterputs")).not.toBeInTheDocument();
  });

  it("offers a legacy/default toggle that reports how many services are hidden", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);

    const toggle = screen.getByRole("button", { name: LEGACY_TOGGLE });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle).getByText("3")).toBeInTheDocument();
  });

  it("keeps Home visible and selected by default (its questions render)", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);

    // Appears in the list row AND the selected-service detail header.
    expect(screen.getAllByText("Hemstädning").length).toBeGreaterThan(1);
    expect(screen.getByText("Boyta (m²)")).toBeInTheDocument();
  });

  it("does not render a legacy toggle when there are no legacy services", () => {
    renderEditor([HOME]);
    expect(screen.queryByRole("button", { name: LEGACY_TOGGLE })).not.toBeInTheDocument();
  });

  it("shows legacy services by default when no pilot service exists (list is never empty)", () => {
    renderEditor([OFFICE, WINDOW_DRAFT]);

    // No toggle (nothing to collapse against) and the legacy rows render directly.
    expect(screen.queryByRole("button", { name: LEGACY_TOGGLE })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kontorsstädning/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fönsterputs/i })).toBeInTheDocument();
  });
});

describe("ServicesFieldsEditor — GPM-2a legacy reveal + badges", () => {
  it("reveals the seeded legacy services when the toggle is expanded", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);
    expandLegacy();

    expect(screen.getByRole("button", { name: /Flyttstädning/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kontorsstädning/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fönsterputs/i })).toBeInTheDocument();

    // Toggle now reads as expanded.
    expect(screen.getByRole("button", { name: LEGACY_TOGGLE })).toHaveAttribute("aria-expanded", "true");
  });

  it("marks enabled legacy services as Live (admins are never blind to public services)", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);
    expandLegacy();

    const officeRow = screen.getByRole("button", { name: /Kontorsstädning/i });
    expect(within(officeRow).getByText("Legacy")).toBeInTheDocument();
    expect(within(officeRow).getByText("Live")).toBeInTheDocument();

    const moveRow = screen.getByRole("button", { name: /Flyttstädning/i });
    expect(within(moveRow).getByText("Legacy")).toBeInTheDocument();
    expect(within(moveRow).getByText("Live")).toBeInTheDocument();
  });

  it("marks a disabled legacy draft as Hidden", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);
    expandLegacy();

    const windowRow = screen.getByRole("button", { name: /Fönsterputs/i });
    expect(within(windowRow).getByText("Legacy")).toBeInTheDocument();
    expect(within(windowRow).getByText("Hidden")).toBeInTheDocument();
  });

  it("marks a coming-soon legacy service", () => {
    const comingSoonWindow = makeService({
      id: "svc-window",
      legacyId: "svc_window_legacy",
      serviceKey: "window_cleaning",
      displayName: "Fönsterputs",
      pricingModel: "window_cleaning_count_based",
      enabled: false,
      comingSoon: true,
      questions: [],
    });
    renderEditor([HOME, comingSoonWindow]);
    expandLegacy();

    const windowRow = screen.getByRole("button", { name: /Fönsterputs/i });
    expect(within(windowRow).getByText("Coming soon")).toBeInTheDocument();
  });

  it("preserves questions for hidden legacy services — visible after reveal + select", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);

    // Hidden by default → its unique question is not in the DOM.
    expect(screen.queryByText("Bostadsyta vid flytt (m²)")).not.toBeInTheDocument();

    expandLegacy();
    fireEvent.click(screen.getByRole("button", { name: /Flyttstädning/i }));

    // Selecting the revealed legacy service surfaces its preserved questions.
    expect(screen.getByText("Bostadsyta vid flytt (m²)")).toBeInTheDocument();
  });
});

describe("ServicesFieldsEditor — GPM-2a is presentation only", () => {
  it("issues no DB write (no save/add/archive) when rendering or toggling the list", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);

    expandLegacy();
    // Collapse again.
    fireEvent.click(screen.getByRole("button", { name: LEGACY_TOGGLE }));

    expect(handlers.onSaveService).not.toHaveBeenCalled();
    expect(handlers.onSaveQuestion).not.toHaveBeenCalled();
    expect(handlers.onAddQuestion).not.toHaveBeenCalled();
    expect(handlers.onAddService).not.toHaveBeenCalled();
    expect(handlers.onArchiveService).not.toHaveBeenCalled();
  });

  it("does not archive (soft-delete) any service as part of grouping", () => {
    renderEditor([HOME, MOVE_OUT, OFFICE, WINDOW_DRAFT]);
    expandLegacy();
    fireEvent.click(screen.getByRole("button", { name: /Kontorsstädning/i }));

    // Selecting a legacy service must not trigger any archive/delete.
    expect(handlers.onArchiveService).not.toHaveBeenCalled();
  });
});
