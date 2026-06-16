/**
 * GPM-CALC-LIBRARY-3 — Question Library Admin UX tests.
 *
 * Proves the new, purely-additive "Question library" panel in the embedded
 * Questions section:
 *   • The panel only renders when `questionLibraryItems` is provided (existing
 *     usages that omit it are unaffected — the panel is invisible).
 *   • It lists activatable library questions (active + key not already on the
 *     service) and filters out keys already present + inactive library items.
 *   • Activating a library question reuses the existing onAddQuestion write path,
 *     copying the library defaults and stamping libraryItemId.
 *   • Saving a service question to the library calls onSaveQuestionToLibrary with
 *     the question's fields.
 * Activation never bypasses readiness, never touches public runtime, and never
 * mutates the existing questions.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesFieldsEditor } from "./ServicesFieldsEditor";
import type {
  CalculatorQuestionConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";
import type { QuestionLibraryItem } from "@/lib/calculator/libraryItems";

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
    requiresCleaningPlan: true,
    plansEnabled: true,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: null,
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [makeQuestion()],
    ...over,
  };
}

function makeLibraryItem(over: Partial<QuestionLibraryItem> = {}): QuestionLibraryItem {
  return {
    id: "lib-has-pets",
    legacyId: "calc_qlib_has_pets_x",
    companyId: "co-uuid",
    companyLegacyId: "cmp_x",
    questionKey: "has_pets",
    label: "Vi har husdjur",
    helpText: null,
    inputType: "boolean",
    defaultRequired: false,
    defaultAffectsPricing: true,
    defaultOptions: [],
    defaultValidation: {},
    defaultSortOrder: 5,
    description: null,
    active: true,
    ...over,
  };
}

const handlers = {
  onSaveService: vi.fn().mockResolvedValue(undefined),
  onSaveQuestion: vi.fn().mockResolvedValue(undefined),
  onAddQuestion: vi.fn().mockResolvedValue(undefined),
  onSaveQuestionToLibrary: vi.fn().mockResolvedValue(undefined),
};

function renderWithLibrary(
  service: CalculatorServiceConfig,
  libraryItems: QuestionLibraryItem[] | undefined,
  opts: { withSave?: boolean } = {},
) {
  return render(
    <ServicesFieldsEditor
      embedded
      services={[service]}
      companyId="co-uuid"
      companyLegacyId="cmp_x"
      pricingRules={[]}
      plans={[]}
      onSaveService={handlers.onSaveService}
      onSaveQuestion={handlers.onSaveQuestion}
      onAddQuestion={handlers.onAddQuestion}
      questionLibraryItems={libraryItems}
      onSaveQuestionToLibrary={opts.withSave ? handlers.onSaveQuestionToLibrary : undefined}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesFieldsEditor — GPM-CALC-LIBRARY-3 question library panel", () => {
  it("does not render the library panel when questionLibraryItems is undefined", () => {
    renderWithLibrary(makeService(), undefined);
    expect(screen.queryByTestId("question-library-panel")).not.toBeInTheDocument();
  });

  it("renders the library panel (collapsed) when library items are provided", () => {
    renderWithLibrary(makeService(), [makeLibraryItem()]);
    expect(screen.getByTestId("question-library-panel")).toBeInTheDocument();
    // Collapsed by default: the available item is not yet visible.
    expect(screen.queryByTestId("question-library-item-has_pets")).not.toBeInTheDocument();
  });

  it("lists activatable library questions and filters out keys already on the service + inactive items", () => {
    const service = makeService({ questions: [makeQuestion({ questionKey: "sqm", label: "Boyta (m²)" })] });
    renderWithLibrary(service, [
      makeLibraryItem(),
      makeLibraryItem({ id: "lib-sqm", questionKey: "sqm", label: "Boyta dup" }),
      makeLibraryItem({ id: "lib-oven", questionKey: "oven", label: "Ugn", active: false }),
    ]);
    fireEvent.click(screen.getByTestId("question-library-toggle"));
    // Only the activatable item appears.
    expect(screen.getByTestId("question-library-item-has_pets")).toBeInTheDocument();
    // Already-present key is filtered out.
    expect(screen.queryByTestId("question-library-item-sqm")).not.toBeInTheDocument();
    // Inactive library item is filtered out.
    expect(screen.queryByTestId("question-library-item-oven")).not.toBeInTheDocument();
  });

  it("activates a library question via onAddQuestion with copied defaults + libraryItemId", async () => {
    renderWithLibrary(makeService(), [makeLibraryItem()]);
    fireEvent.click(screen.getByTestId("question-library-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Activate Vi har husdjur" }));

    await waitFor(() => expect(handlers.onAddQuestion).toHaveBeenCalledTimes(1));
    expect(handlers.onAddQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-uuid",
        companyLegacyId: "cmp_x",
        serviceId: "svc-home",
        serviceLegacyId: "svc_home_legacy",
        questionKey: "has_pets",
        label: "Vi har husdjur",
        inputType: "boolean",
        required: false,
        affectsPricing: true,
        libraryItemId: "lib-has-pets",
      }),
    );
  });

  it("saves a service question to the library via onSaveQuestionToLibrary", async () => {
    const service = makeService({ questions: [makeQuestion({ questionKey: "frequency", label: "Frekvens" })] });
    renderWithLibrary(service, [makeLibraryItem()], { withSave: true });
    fireEvent.click(screen.getByTestId("question-library-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Save Frekvens to library" }));

    await waitFor(() => expect(handlers.onSaveQuestionToLibrary).toHaveBeenCalledTimes(1));
    expect(handlers.onSaveQuestionToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-uuid",
        companyLegacyId: "cmp_x",
        questionKey: "frequency",
        label: "Frekvens",
        defaultAffectsPricing: true,
      }),
    );
  });

  it("hides the save-to-library list when onSaveQuestionToLibrary is not provided", () => {
    renderWithLibrary(makeService(), [makeLibraryItem()]);
    fireEvent.click(screen.getByTestId("question-library-toggle"));
    expect(screen.queryByText("Save this service’s questions to the library")).not.toBeInTheDocument();
  });
});
