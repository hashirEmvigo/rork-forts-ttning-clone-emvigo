import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesFieldsEditor } from "./ServicesFieldsEditor";
import type {
  CalculatorQuestionConfig,
  CalculatorServiceConfig,
  CleaningPlanConfig,
  PricingRuleConfig,
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
  const requiresCleaningPlan = over.requiresCleaningPlan ?? false;
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
    requiresCleaningPlan,
    plansEnabled: requiresCleaningPlan,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: null,
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [makeQuestion()],
    ...over,
  };
}

// Office cleaning is now ENGINE-BACKED (Slice 12E), so a complete office service is
// fully public-ready. A genuinely UNSUPPORTED template (window_cleaning_count_based)
// is used for the "Unsupported pricing" / enable-locked assertions instead.
const OFFICE_READY = makeService({
  id: "svc-office",
  legacyId: "svc_office_legacy",
  serviceKey: "office_cleaning",
  displayName: "Kontorsstädning",
  description: "Återkommande kontorsstädning",
  enabled: true,
  comingSoon: false,
  pricingModel: "office_cleaning_recurring_area_frequency",
  sortOrder: 3,
  requiresCleaningPlan: false,
  questions: [
    makeQuestion({
      legacyId: "q_office_sqm",
      serviceId: "svc-office",
      serviceLegacyId: "svc_office_legacy",
      questionKey: "sqm",
      label: "Kontorsyta (m²)",
    }),
  ],
});

const WINDOW_DRAFT = makeService({
  id: "svc-window",
  legacyId: "svc_window_legacy",
  serviceKey: "window_cleaning",
  displayName: "Fönsterputs",
  description: "Fönsterputs template",
  enabled: false,
  comingSoon: false,
  pricingModel: "window_cleaning_count_based",
  sortOrder: 4,
  questions: [],
});

// GPM-7: a brand-new LITERAL sqm_fixed service starts as a hidden draft with NO
// questions — it must configure its area (m²) primary input before it can be Ready.
const SQM_FIXED_DRAFT = makeService({
  id: "svc-moveout",
  legacyId: "svc_moveout_legacy",
  serviceKey: "moveout_generic",
  displayName: "Flyttstädning",
  description: "Generic move-out draft",
  enabled: false,
  comingSoon: false,
  pricingModel: "sqm_fixed",
  sortOrder: 5,
  requiresCleaningPlan: true,
  questions: [],
});

function moveoutSqmQuestion(over: Partial<CalculatorQuestionConfig> = {}): CalculatorQuestionConfig {
  return makeQuestion({ legacyId: "q_moveout_sqm", serviceId: "svc-moveout", serviceLegacyId: "svc_moveout_legacy", ...over });
}

// GPM-8: a fully set-up generic sqm_fixed service — active sqm primary input present —
// but still a hidden draft (enabled:false) until an admin explicitly enables it.
const SQM_FIXED_READY = makeService({
  id: "svc-moveout",
  legacyId: "svc_moveout_legacy",
  serviceKey: "moveout_generic",
  displayName: "Flyttstädning",
  description: "Generic move-out, fully configured",
  enabled: false,
  comingSoon: false,
  pricingModel: "sqm_fixed",
  sortOrder: 5,
  requiresCleaningPlan: true,
  questions: [moveoutSqmQuestion()],
});

// A reserved GENERIC model the runtime does not price yet — enabling must stay locked
// with the developer-support message (NOT the sqm_fixed readiness guidance).
const UNIT_BASED_DRAFT = makeService({
  id: "svc-unit",
  legacyId: "svc_unit_legacy",
  serviceKey: "window_generic",
  displayName: "Fönsterputs (generic)",
  description: "Reserved generic model",
  enabled: false,
  comingSoon: false,
  pricingModel: "unit_based",
  sortOrder: 6,
  questions: [],
});

// An engine-backed LEGACY model (move-out) — its enable switch must stay unlocked even
// when incomplete, proving GPM-8 leaves legacy behaviour untouched.
const MOVEOUT_LEGACY_DRAFT = makeService({
  id: "svc-moveout-legacy",
  legacyId: "svc_moveout_legacy_v1",
  serviceKey: "move_out_cleaning",
  displayName: "Flyttstädning (legacy)",
  description: "Legacy move-out",
  enabled: false,
  comingSoon: false,
  pricingModel: "move_out_fixed_plus_addons",
  sortOrder: 7,
  questions: [],
});

/** A generic move-out (sqm_fixed) plan carrying a positive price per m² (engine-priceable). */
function moveoutPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
  return {
    legacyId: "plan_moveout_default",
    serviceId: "svc-moveout",
    serviceLegacyId: "svc_moveout_legacy",
    serviceKey: "moveout_generic",
    planKey: "normal",
    name: "Normalt skick",
    description: null,
    hourlyRate: 0,
    vatRatePercent: 25,
    priceAdjustmentType: "fixed_amount",
    priceAdjustmentValue: 0,
    rutEligible: false,
    rutEnabled: false,
    rutPercent: 0,
    rutApplyTo: "total_customer_price",
    showRutBreakdown: false,
    flexibilityLevel: null,
    customerDayTimeControl: null,
    sameStaffPreferenceLevel: null,
    bookingPriority: null,
    cancellationTermsSummary: null,
    isDefault: true,
    active: true,
    sortOrder: 1,
    pricePerSqmExclVat: 48,
    ...over,
  };
}

const RULES: PricingRuleConfig[] = [
  { legacyId: "r1", serviceId: "svc-home", ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, active: true, sortOrder: 1 },
  // Active office rules so a complete office service computes as public-ready.
  // Slice 12F requires BOTH hourly_rate AND supervision_start_minutes for office.
  { legacyId: "r_office_rate", serviceId: "svc-office", ruleKey: "hourly_rate", ruleType: "numeric_factor", valueNumeric: 459, active: true, sortOrder: 1 },
  { legacyId: "r_office_sup", serviceId: "svc-office", ruleKey: "supervision_start_minutes", ruleType: "threshold", valueNumeric: 15, active: true, sortOrder: 2 },
];
const PLANS: CleaningPlanConfig[] = [];

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
      pricingRules={RULES}
      plans={PLANS}
      onSaveService={handlers.onSaveService}
      onSaveQuestion={handlers.onSaveQuestion}
      onAddQuestion={handlers.onAddQuestion}
      onAddService={handlers.onAddService}
      onArchiveService={handlers.onArchiveService}
    />,
  );
}

/** Same as {@link renderEditor} but with a caller-supplied plans array (GPM-8 enable guard). */
function renderEditorWithPlans(services: CalculatorServiceConfig[], plans: CleaningPlanConfig[]) {
  return render(
    <ServicesFieldsEditor
      services={services}
      companyId="co-uuid"
      companyLegacyId="cmp_x"
      pricingRules={RULES}
      plans={plans}
      onSaveService={handlers.onSaveService}
      onSaveQuestion={handlers.onSaveQuestion}
      onAddQuestion={handlers.onAddQuestion}
      onAddService={handlers.onAddService}
      onArchiveService={handlers.onArchiveService}
    />,
  );
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesFieldsEditor — readiness (Slice 12C/12E)", () => {
  it("shows readiness badges (Ready for complete, Unsupported pricing for template)", () => {
    renderEditor([makeService(), WINDOW_DRAFT]);
    // Home (pilot) is shown by default and is Ready.
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    // The window template is a legacy service — reveal it via the GPM-2a toggle.
    fireEvent.click(screen.getByRole("button", { name: /legacy \/ default services/i }));
    expect(screen.getByText("Unsupported pricing")).toBeInTheDocument();
  });

  it("marks an engine-backed office service with fields + rules as Ready (Slice 12E)", () => {
    renderEditor([OFFICE_READY]);
    // Office is selected by default (only service) → its Ready badge shows in the
    // list + the detail header, and it is never flagged as unsupported.
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unsupported pricing")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing pricing")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing fields")).not.toBeInTheDocument();
  });
});

describe("ServicesFieldsEditor — add service (Slice 12C)", () => {
  it("adds a valid service draft", () => {
    renderEditor([makeService()]);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Service key"), { target: { value: "window_cleaning" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Fönsterputs" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add service" }));

    expect(handlers.onAddService).toHaveBeenCalledWith(
      expect.objectContaining({ serviceKey: "window_cleaning", displayName: "Fönsterputs" }),
    );
  });

  it("blocks a duplicate service key", () => {
    renderEditor([makeService()]);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Service key"), { target: { value: "home_cleaning" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Dup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add service" }));

    expect(screen.getByText(/already used by this company/i)).toBeInTheDocument();
    expect(handlers.onAddService).not.toHaveBeenCalled();
  });
});

describe("ServicesFieldsEditor — archive + enable guard (Slice 12C)", () => {
  it("archives the selected service via confirm", () => {
    renderEditor([makeService()]);

    fireEvent.click(screen.getByRole("button", { name: /Archive/i }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive service" }));

    expect(handlers.onArchiveService).toHaveBeenCalledWith("svc_home_legacy");
  });

  it("locks the Enabled switch for a service whose pricing model is unsupported", () => {
    renderEditor([makeService(), WINDOW_DRAFT]);

    // The window (still-template) service is legacy — reveal it via the GPM-2a toggle first.
    fireEvent.click(screen.getByRole("button", { name: /legacy \/ default services/i }));
    // Select the window service from the list.
    fireEvent.click(screen.getByRole("button", { name: /Fönsterputs/i }));
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Service enabled")).toBeDisabled();
    expect(within(dialog).getByText(/does not implement yet/i)).toBeInTheDocument();
  });
});

describe("ServicesFieldsEditor — sqm_fixed area (m²) input setup (GPM-7)", () => {
  it("shows the guided area (m²) setup for a sqm_fixed service missing its primary input", () => {
    renderEditor([SQM_FIXED_DRAFT]);
    expect(screen.getByText(/Set up the area \(m²\) input/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add area \(m²\) input/i })).toBeInTheDocument();
    // Readiness guides with "Missing fields" — never "Unsupported pricing" for sqm_fixed.
    expect(screen.getAllByText("Missing fields").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unsupported pricing")).not.toBeInTheDocument();
  });

  it("adds the canonical sqm primary input (key sqm, integer, required, affects price) in one click", () => {
    renderEditor([SQM_FIXED_DRAFT]);
    fireEvent.click(screen.getByRole("button", { name: /Add area \(m²\) input/i }));
    expect(handlers.onAddQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: "svc-moveout",
        serviceLegacyId: "svc_moveout_legacy",
        questionKey: "sqm",
        inputType: "integer",
        required: true,
        affectsPricing: true,
      }),
    );
  });

  it("never enables or publishes the service — the guided setup only adds the input", () => {
    renderEditor([SQM_FIXED_DRAFT]);
    fireEvent.click(screen.getByRole("button", { name: /Add area \(m²\) input/i }));
    expect(handlers.onSaveService).not.toHaveBeenCalled();
    expect(handlers.onArchiveService).not.toHaveBeenCalled();
  });

  it("hides the setup once the sqm primary input is present", () => {
    renderEditor([{ ...SQM_FIXED_DRAFT, questions: [moveoutSqmQuestion()] }]);
    expect(screen.queryByText(/Set up the area \(m²\) input/i)).not.toBeInTheDocument();
  });

  it("never shows the area setup for the Home pilot (not a literal sqm_fixed service)", () => {
    renderEditor([makeService()]);
    expect(screen.queryByText(/Set up the area \(m²\) input/i)).not.toBeInTheDocument();
  });

  it("points at reactivation (no duplicate add) when the sqm input exists but is archived", () => {
    renderEditor([{ ...SQM_FIXED_DRAFT, questions: [moveoutSqmQuestion({ active: false })] }]);
    expect(screen.getByText(/reactivate it from the question below/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add area \(m²\) input/i })).not.toBeInTheDocument();
  });
});

describe("ServicesFieldsEditor — GPM-8 sqm_fixed enable/public guard alignment", () => {
  it("drops the stale 'engine does not implement' enable-block for an incomplete sqm_fixed service and guides setup instead", () => {
    renderEditorWithPlans([SQM_FIXED_DRAFT], []);
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    // The stale legacy-engine message must NOT appear for an engine-backed sqm_fixed service.
    expect(within(dialog).queryByText(/does not implement yet/i)).not.toBeInTheDocument();
    // Instead the actionable readiness guidance + reasons appear.
    expect(within(dialog).getByText(/Finish setting this service up/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Requires an active cleaning plan, but none is active\./i)).toBeInTheDocument();
    // Enabling stays blocked while the service is not ready.
    expect(within(dialog).getByLabelText("Service enabled")).toBeDisabled();
  });

  it("blocks enabling a sqm_fixed service whose plan has no positive price per m², citing the price reason (not 'unsupported')", () => {
    renderEditorWithPlans([SQM_FIXED_READY], [moveoutPlan({ pricePerSqmExclVat: 0 })]);
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Service enabled")).toBeDisabled();
    expect(within(dialog).getByText(/needs a positive price per m²/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/does not implement yet/i)).not.toBeInTheDocument();
  });

  it("lets the admin explicitly enable a fully set-up sqm_fixed service (switch unlocked, no block message)", () => {
    renderEditorWithPlans([SQM_FIXED_READY], [moveoutPlan()]);
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    const toggle = within(dialog).getByLabelText("Service enabled");
    expect(toggle).not.toBeDisabled();
    expect(within(dialog).queryByText(/does not implement yet/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Finish setting this service up/i)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(handlers.onSaveService).toHaveBeenCalledWith(
      "svc_moveout_legacy",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("does not auto-enable a ready sqm_fixed service — it stays hidden until explicitly enabled", () => {
    renderEditorWithPlans([SQM_FIXED_READY], [moveoutPlan()]);
    // Structurally complete but hidden → shows the "Draft" readiness badge, never "Live".
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.queryByText("Live")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Service enabled")).not.toBeChecked();
  });

  it("keeps enabling locked with the developer-support message for a reserved generic model (unit_based)", () => {
    renderEditorWithPlans([UNIT_BASED_DRAFT], []);
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Service enabled")).toBeDisabled();
    expect(within(dialog).getByText(/does not implement yet/i)).toBeInTheDocument();
    // The sqm_fixed readiness guidance must NOT appear for a non-engine-backed model.
    expect(within(dialog).queryByText(/Finish setting this service up/i)).not.toBeInTheDocument();
  });

  it("leaves an engine-backed legacy model's enable switch unlocked even when incomplete (unchanged behaviour)", () => {
    renderEditorWithPlans([MOVEOUT_LEGACY_DRAFT], []);
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Service enabled")).not.toBeDisabled();
    expect(within(dialog).queryByText(/does not implement yet/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Finish setting this service up/i)).not.toBeInTheDocument();
  });

  it("leaves the Home pilot enable switch unlocked and free of block messages (unchanged)", () => {
    renderEditorWithPlans([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Edit service" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Service enabled")).not.toBeDisabled();
    expect(within(dialog).queryByText(/does not implement yet/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Finish setting this service up/i)).not.toBeInTheDocument();
  });
});
