import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesFieldsEditor } from "./ServicesFieldsEditor";
import type {
  CalculatorQuestionConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

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

const handlers = {
  onSaveService: vi.fn().mockResolvedValue(undefined),
  onSaveQuestion: vi.fn().mockResolvedValue(undefined),
  onAddQuestion: vi.fn().mockResolvedValue(undefined),
};

function renderEmbedded(service: CalculatorServiceConfig) {
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
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesFieldsEditor — GPM-UX-ADMIN-3 embedded mode", () => {
  it("hides the internal service list sidebar and renders only the selected service detail", () => {
    renderEmbedded(makeService());
    // The detail (questions + edit-service action) renders…
    expect(screen.getByText("Boyta (m²)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit service/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add question" })).toBeInTheDocument();
    // …but the internal service-list sidebar header is gone (the page nav owns selection).
    expect(screen.queryByText("Services")).not.toBeInTheDocument();
  });

  it("shows active questions by default and reveals archived ones via the toggle", () => {
    const service = makeService({
      questions: [
        makeQuestion(),
        makeQuestion({ legacyId: "q_old", questionKey: "old_field", label: "Gammalt fält", active: false }),
      ],
    });
    renderEmbedded(service);
    // Active shown, archived hidden by default.
    expect(screen.getByText("Boyta (m²)")).toBeInTheDocument();
    expect(screen.queryByText("Gammalt fält")).not.toBeInTheDocument();
    // Reveal archived questions.
    fireEvent.click(screen.getByTestId("questions-archived-toggle"));
    expect(screen.getByText("Gammalt fält")).toBeInTheDocument();
  });

  it("does not render an archived toggle when every question is active", () => {
    renderEmbedded(makeService());
    expect(screen.queryByTestId("questions-archived-toggle")).not.toBeInTheDocument();
  });
});
