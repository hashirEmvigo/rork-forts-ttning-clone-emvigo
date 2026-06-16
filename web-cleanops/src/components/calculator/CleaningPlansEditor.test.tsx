import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CleaningPlansEditor } from "./CleaningPlansEditor";
import type {
  CalculatorServiceConfig,
  CleaningPlanConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

// ── Type-complete fixtures (mirror the Phase 1 plan/VAT/RUT config shape) ─────

function makeService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  return {
    id: "svc-home",
    legacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    description: null,
    enabled: true,
    comingSoon: false,
    pricingModel: "home_cleaning_recommended_hours",
    sortOrder: 1,
    requiresCleaningPlan: true,
    plansEnabled: true,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: "flexible",
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [],
    ...over,
  };
}

function makeOfficeService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  return makeService({
    id: "svc-office",
    legacyId: "svc_office_legacy",
    serviceKey: "office_cleaning",
    displayName: "Kontorsstädning",
    pricingModel: "office_cleaning_recurring_area_frequency",
    plansEnabled: false,
    defaultPlanKey: "standard",
    ...over,
  });
}

function makePlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
  return {
    legacyId: "plan_home_flexible",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    planKey: "flexible",
    name: "Flexibel",
    description: "Lägre timpris",
    hourlyRate: 349,
    vatRatePercent: 25,
    priceAdjustmentType: "fixed_amount",
    priceAdjustmentValue: 0,
    rutEligible: true,
    rutEnabled: true,
    rutPercent: 50,
    rutApplyTo: "total_customer_price",
    showRutBreakdown: true,
    flexibilityLevel: null,
    customerDayTimeControl: null,
    sameStaffPreferenceLevel: null,
    bookingPriority: null,
    cancellationTermsSummary: null,
    isDefault: true,
    active: true,
    sortOrder: 1,
    startAdjustmentHours: 0,
    ...over,
  };
}

/** A second, non-default active Home plan (for default-selection + guard tests). */
function makeHomePlanFast(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
  return makePlan({
    legacyId: "plan_home_fast",
    planKey: "fast",
    name: "Fast",
    hourlyRate: 399,
    isDefault: false,
    sortOrder: 2,
    ...over,
  });
}

function makeOfficePlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
  return makePlan({
    legacyId: "plan_office_standard",
    serviceId: "svc-office",
    serviceLegacyId: "svc_office_legacy",
    serviceKey: "office_cleaning",
    planKey: "standard",
    name: "Standard",
    hourlyRate: 459,
    rutEligible: false,
    rutEnabled: false,
    showRutBreakdown: false,
    ...over,
  });
}

/** An admin-created GENERIC-model service (GPM-3) — draft + non-public by default. */
function makeGenericService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  return makeService({
    id: "svc-generic",
    legacyId: "svc_generic_legacy",
    serviceKey: "deep_cleaning_builder",
    displayName: "Deep Cleaning Builder",
    enabled: false,
    comingSoon: false,
    pricingModel: "hourly_by_area",
    sortOrder: 5,
    ...over,
  });
}

/** A seeded legacy/default service (kept on a legacy, service-named pricing model). */
function makeLegacyService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  return makeService({
    id: "svc-moveout",
    legacyId: "svc_moveout_legacy",
    serviceKey: "move_out_cleaning",
    displayName: "Move-out Cleaning",
    enabled: true,
    comingSoon: false,
    pricingModel: "move_out_fixed_plus_addons",
    sortOrder: 6,
    ...over,
  });
}

const onSavePlan = vi.fn().mockResolvedValue(undefined);
const onSaveService = vi.fn().mockResolvedValue(undefined);
const onSetDefault = vi.fn().mockResolvedValue(undefined);

function renderEditor(services: CalculatorServiceConfig[], plans: CleaningPlanConfig[]) {
  return render(
    <CleaningPlansEditor
      services={services}
      plans={plans}
      currency="SEK"
      onSaveService={onSaveService}
      onSavePlan={onSavePlan}
      onSetDefault={onSetDefault}
    />,
  );
}

/** The plan-card section that holds a given plan's "Price and tax settings". */
function planCard(planName: string): HTMLElement {
  // Scope to the card heading (the plan name also appears as a <select> option).
  const heading = screen.getByRole("heading", { name: planName });
  const card = heading.closest("div.rounded-2xl");
  if (!card) throw new Error(`Plan card for "${planName}" not found`);
  return card as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CleaningPlansEditor", () => {
  it("separates Home Cleaning and Office Cleaning plans into their own sections", () => {
    renderEditor(
      [makeService(), makeOfficeService()],
      [makePlan(), makeOfficePlan()],
    );

    // Both service groups render with explicit, business-readable titles.
    expect(screen.getByText("Plan — Home Cleaning")).toBeInTheDocument();
    expect(screen.getByText("Plan — Office Cleaning")).toBeInTheDocument();

    // The same machine plan_key can live under both services without clashing.
    // (Plan names also appear as default-plan <select> options, so match headings.)
    expect(screen.getByRole("heading", { name: "Flexibel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Standard" })).toBeInTheDocument();

    // Office cards keep RUT off + hidden from the standard flow.
    expect(
      screen.getByText(/RUT is off by default for Office Cleaning/i),
    ).toBeInTheDocument();
  });

  it("shows the Price and tax settings block + live preview for a Home plan", () => {
    renderEditor([makeService()], [makePlan()]);

    const card = planCard("Flexibel");
    expect(within(card).getByText("Price and tax settings")).toBeInTheDocument();

    // Prices are entered excl. VAT; VAT + RUT live in the same card.
    expect(within(card).getByLabelText("Hour price")).toHaveValue(349);
    expect(within(card).getByLabelText("VAT")).toHaveValue(25);
    expect(within(card).getByLabelText("RUT percent")).toHaveValue(50);
    expect(within(card).getByText("RUT")).toBeInTheDocument();
    expect(within(card).getByText("Show")).toBeInTheDocument();

    // Live preview rows are present.
    expect(within(card).getByText("Price excl. VAT")).toBeInTheDocument();
    expect(within(card).getByText("VAT amount")).toBeInTheDocument();
    expect(within(card).getByText("Price incl. VAT")).toBeInTheDocument();
    expect(within(card).getByText("RUT deduction")).toBeInTheDocument();
    expect(within(card).getByText("Customer price after RUT")).toBeInTheDocument();
  });

  it("hides RUT controls for Office plans and shows the off-by-default note", () => {
    renderEditor([makeOfficeService()], [makeOfficePlan()]);

    const card = planCard("Standard");
    expect(within(card).getByLabelText("Price per hour excl. VAT")).toHaveValue(459);
    expect(within(card).getByLabelText("VAT rate")).toHaveValue(25);
    // No RUT calculation/display controls in the standard Office flow.
    expect(within(card).queryByText("RUT")).not.toBeInTheDocument();
    expect(within(card).queryByLabelText("RUT percent")).not.toBeInTheDocument();
    expect(
      within(card).getByText(/RUT is off by default for Office Cleaning/i),
    ).toBeInTheDocument();
  });

  it("disables Show when RUT is off (display cannot create a deduction)", () => {
    renderEditor([makeService()], [makePlan({ rutEnabled: false, showRutBreakdown: false })]);

    const card = planCard("Flexibel");
    expect(within(card).getByText("RUT is not active.")).toBeInTheDocument();
    expect(within(card).getByLabelText("Show")).toBeDisabled();
  });

  it("blocks a negative hourly price and does not save", () => {
    renderEditor([makeService()], [makePlan()]);

    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Hour price"), {
      target: { value: "-5" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));

    expect(within(card).getByText(/must be zero or greater/i)).toBeInTheDocument();
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it("saves a valid hourly-price change with the plan VAT/RUT patch", async () => {
    renderEditor([makeService()], [makePlan()]);

    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Hour price"), {
      target: { value: "399" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_home_flexible",
      expect.objectContaining({
        hourlyRate: 399,
        vatRatePercent: 25,
        rutEligible: true,
        rutEnabled: true,
        rutPercent: 50,
        rutApplyTo: "total_customer_price",
        showRutBreakdown: true,
        active: true,
      }),
    );
  });

  // ── Slice 12L: Office Cleaning plan simplification pilot ────────────────────
  it("hides the visible Plan model selector for Office Cleaning", () => {
    renderEditor([makeOfficeService()], [makeOfficePlan()]);
    expect(screen.queryByLabelText("Plan model")).not.toBeInTheDocument();
    // Top settings remain: Activate plans + Recommended/default plan.
    expect(screen.getByText("Activate plans")).toBeInTheDocument();
    expect(screen.getByLabelText("Recommended/default plan")).toBeInTheDocument();
  });

  // ── Slice V2-D: Home plan-card cleanup (global controls removed) ─────────────
  it("removes all legacy global plan controls for Home Cleaning", () => {
    renderEditor([makeService()], [makePlan()]);
    // The four confusing global controls no longer render for Home.
    expect(screen.queryByText("Activate plans")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Plan model")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Recommended/default plan")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Base hourly price excl. VAT")).not.toBeInTheDocument();
    // The plan card itself is still here.
    expect(screen.getByRole("heading", { name: "Flexibel" })).toBeInTheDocument();
  });

  // ── Slice 12M: Office plan card UX (Pricing / Start adjustment / VAT) ────────
  it("splits the Office plan card into Pricing, Start adjustment and VAT sections", () => {
    renderEditor([makeOfficeService()], [makeOfficePlan({ priceAdjustmentValue: 0.25 })]);
    const card = planCard("Standard");
    expect(within(card).getByText("Pricing")).toBeInTheDocument();
    expect(within(card).getByText("Start adjustment")).toBeInTheDocument();
    expect(within(card).getByText("VAT")).toBeInTheDocument();
    // Renamed pricing field; start adjustment lives in its own section.
    expect(within(card).getByLabelText("Price per hour excl. VAT")).toHaveValue(459);
    expect(within(card).getByLabelText("VAT rate")).toHaveValue(25);
    // The combined "Tax" / "Price and tax settings" blocks are gone.
    expect(within(card).queryByText("Tax")).not.toBeInTheDocument();
    expect(within(card).queryByText("Price and tax settings")).not.toBeInTheDocument();
    // RUT stays hidden for office.
    expect(within(card).queryByText("RUT")).not.toBeInTheDocument();
  });

  it.each([
    [0.25, 15, "15 min (0.25 h)"],
    [-0.25, -15, "-15 min (-0.25 h)"],
    [0.5, 30, "30 min (0.5 h)"],
    [0, 0, "0 min (0 h)"],
  ])("renders stored %s h as minutes (%s) with a formatted hours preview", (hours, minutes, label) => {
    renderEditor([makeOfficeService()], [makeOfficePlan({ priceAdjustmentValue: hours })]);
    const card = planCard("Standard");
    expect(within(card).getByLabelText("Fixed total time adjustment per visit")).toHaveValue(minutes);
    expect(within(card).getByText(label)).toBeInTheDocument();
  });

  it.each([
    ["-15", -0.25],
    ["30", 0.5],
    ["15", 0.25],
  ])("saves Start adjustment %s min as %s h to the correct plan key", async (minutes, hours) => {
    renderEditor([makeOfficeService()], [makeOfficePlan()]);
    const card = planCard("Standard");
    fireEvent.change(within(card).getByLabelText("Price per hour excl. VAT"), { target: { value: "429" } });
    fireEvent.change(within(card).getByLabelText("Fixed total time adjustment per visit"), { target: { value: minutes } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_office_standard",
      expect.objectContaining({
        hourlyRate: 429,
        vatRatePercent: 25,
        priceAdjustmentType: "fixed_amount",
        priceAdjustmentValue: hours,
        rutEligible: false,
        rutEnabled: false,
        showRutBreakdown: false,
      }),
    );
  });

  it("forces the per-plan + time-adjustment model when saving the Office service", async () => {
    renderEditor([makeOfficeService()], [makeOfficePlan()]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveService).toHaveBeenCalledTimes(1));
    expect(onSaveService).toHaveBeenCalledWith(
      "svc_office_legacy",
      expect.objectContaining({ planPricingModel: "hourly_rate_plus_time_adjustment" }),
    );
  });

  it("keeps Office global controls untouched (Office service-level Save still works)", async () => {
    // Office still owns its service-level controls + Save (unchanged by V2-D).
    renderEditor([makeOfficeService()], [makeOfficePlan()]);
    expect(screen.getByText("Activate plans")).toBeInTheDocument();
    expect(screen.getByLabelText("Recommended/default plan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveService).toHaveBeenCalledTimes(1));
  });

  it("renders the Home hourly rate and a price-only Start adjustment (minutes + hours preview)", () => {
    renderEditor([makeService()], [makePlan({ hourlyRate: 410, startAdjustmentHours: 0.5 })]);
    const card = planCard("Flexibel");
    expect(within(card).getByLabelText("Hour price")).toHaveValue(410);
    expect(within(card).getByText("Start adjustment")).toBeInTheDocument();
    expect(within(card).getByLabelText("Adjustment per cleaning")).toHaveValue(30);
    expect(within(card).getByText("30 min (0.5 h)")).toBeInTheDocument();
    // Copy must frame it as price-only, never a change to the customer's time.
    expect(within(card).getByText(/Adjusts the price only/i)).toBeInTheDocument();
  });

  it.each([
    ["15", 0.25],
    ["-30", -0.5],
    ["0", 0],
  ])("saves Home Start adjustment %s min as %s h to start_adjustment_hours (never price_adjustment_value)", async (minutes, hours) => {
    renderEditor([makeService()], [makePlan()]);
    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Adjustment per cleaning"), { target: { value: minutes } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    const [legacyId, patch] = onSavePlan.mock.calls[0];
    expect(legacyId).toBe("plan_home_flexible");
    expect(patch).toMatchObject({ startAdjustmentHours: hours });
    // The overloaded legacy fields must NOT be written from the Home card.
    expect(patch).not.toHaveProperty("priceAdjustmentValue");
    expect(patch).not.toHaveProperty("priceAdjustmentType");
  });

  it("persists an active toggle on a non-last Home plan", async () => {
    renderEditor([makeService()], [makePlan(), makeHomePlanFast()]);
    const card = planCard("Fast");
    fireEvent.click(within(card).getByLabelText("Fast active")); // turn off (another plan stays active)
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith("plan_home_fast", expect.objectContaining({ active: false }));
  });

  it("shows the current default plan as default with no Set-as-default button", () => {
    renderEditor([makeService()], [makePlan(), makeHomePlanFast()]);
    const defaultCard = planCard("Flexibel");
    expect(within(defaultCard).getByText("Default plan for this service")).toBeInTheDocument();
    expect(within(defaultCard).queryByRole("button", { name: "Set as default" })).not.toBeInTheDocument();
  });

  it("Set as default sends the plan/service keys and the sibling default to clear", async () => {
    // Two active Home plans: "Flexibel" is the current default; "Fast" is not.
    renderEditor([makeService()], [makePlan(), makeHomePlanFast()]);
    const card = planCard("Fast");
    fireEvent.click(within(card).getByRole("button", { name: "Set as default" }));

    await waitFor(() => expect(onSetDefault).toHaveBeenCalledTimes(1));
    // Proves exactly one default remains: the current default is cleared first.
    expect(onSetDefault).toHaveBeenCalledWith({
      planLegacyId: "plan_home_fast",
      planKey: "fast",
      serviceLegacyId: "svc_home_legacy",
      clearSiblingLegacyIds: ["plan_home_flexible"],
    });
  });

  it("blocks deactivating the last active Home plan while the service is enabled", () => {
    renderEditor([makeService({ enabled: true })], [makePlan()]);
    const card = planCard("Flexibel");
    const toggle = within(card).getByLabelText("Flexibel active");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    // Guard fires: a clear warning is shown and the plan stays active.
    expect(within(card).getByText(/At least one plan must stay active/i)).toBeInTheDocument();
    expect(toggle).toBeChecked();
  });
});

// ── Slice GPM-4b-1: generic builder + legacy lanes ──────────────────────────
describe("CleaningPlansEditor — GPM-4b-1 generic + legacy lanes", () => {
  it("leaves Home/Office untouched and shows no new grouping chrome when alone", () => {
    renderEditor([makeService(), makeOfficeService()], [makePlan(), makeOfficePlan()]);
    expect(screen.getByText("Plan — Home Cleaning")).toBeInTheDocument();
    expect(screen.getByText("Plan — Office Cleaning")).toBeInTheDocument();
    // The builder/legacy chrome only appears when such services exist.
    expect(screen.queryByText("Generic builder services")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy / default services")).not.toBeInTheDocument();
  });

  it("shows an admin-created hourly_by_area generic service in the builder lane", () => {
    renderEditor(
      [makeService(), makeGenericService({ displayName: "Deep Cleaning Builder", pricingModel: "hourly_by_area" })],
      [makePlan()],
    );
    expect(screen.getByText("Generic builder services")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Deep Cleaning Builder/ })).toBeInTheDocument();
    expect(screen.getByText("Hourly by area")).toBeInTheDocument();
    expect(screen.getByText(/Primary input:/)).toBeInTheDocument();
  });

  it("shows an admin-created sqm_fixed generic service in the builder lane", () => {
    renderEditor(
      [makeService(), makeGenericService({ displayName: "Move-out Builder", pricingModel: "sqm_fixed" })],
      [makePlan()],
    );
    expect(screen.getByRole("heading", { name: /Move-out Builder/ })).toBeInTheDocument();
    expect(screen.getByText("Fixed price per m²")).toBeInTheDocument();
  });

  it("shows a safe empty state for a generic service with no plans (no create-plan action)", () => {
    renderEditor([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    expect(screen.getByText("No plans configured yet")).toBeInTheDocument();
    expect(screen.getByText("Plan creation will be handled in a later slice.")).toBeInTheDocument();
    // GPM-4b-1 must not expose any create/add/save-plan affordance.
    expect(screen.queryByRole("button", { name: /create plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save plan/i })).not.toBeInTheDocument();
  });

  it.each([
    ["unit_based", "Unit based"],
    ["fixed_package", "Fixed package"],
    ["manual_quote", "Manual quote"],
  ])("renders %s as a non-editable pending state with no writable pricing inputs", (model, label) => {
    renderEditor([makeGenericService({ pricingModel: model, displayName: `Generic ${label}` })], []);
    expect(screen.getByRole("heading", { name: new RegExp(`Generic ${label}`) })).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Pricing model configuration pending")).toBeInTheDocument();
    // No editable pricing fields and no save affordance for an unsupported model.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("separates seeded legacy services behind a collapsed, read-only toggle", () => {
    renderEditor([makeService(), makeLegacyService({ displayName: "Move-out Cleaning" })], [makePlan()]);
    // Home stays in the always-visible builder area.
    expect(screen.getByText("Plan — Home Cleaning")).toBeInTheDocument();
    // The legacy section header is present, but the legacy service is collapsed away.
    expect(screen.getByText("Legacy / default services")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Move-out Cleaning" })).not.toBeInTheDocument();
    // Expanding reveals it, read-only (managed from the Services tab).
    fireEvent.click(screen.getByRole("button", { name: /Show legacy services/ }));
    expect(screen.getByRole("heading", { name: "Move-out Cleaning" })).toBeInTheDocument();
    expect(screen.getByText(/Manage this legacy service from the Services tab/)).toBeInTheDocument();
  });

  it("never routes Office into the legacy toggle (Office keeps its bespoke editor)", () => {
    renderEditor([makeService(), makeOfficeService()], [makePlan(), makeOfficePlan()]);
    expect(screen.getByText("Plan — Office Cleaning")).toBeInTheDocument();
    expect(screen.queryByText("Legacy / default services")).not.toBeInTheDocument();
  });

  it("keeps Home save behavior unchanged when a generic service is also present", async () => {
    renderEditor([makeService(), makeGenericService({ pricingModel: "unit_based" })], [makePlan()]);
    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Hour price"), { target: { value: "415" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith("plan_home_flexible", expect.objectContaining({ hourlyRate: 415 }));
  });
});

// ── Slice GPM-4b-2: model-driven editable generic plan cards ────────────────
describe("CleaningPlansEditor — GPM-4b-2 model-driven generic plan fields", () => {
  /** A plan that BELONGS to the admin-created generic service (matching serviceKey). */
  function makeGenericPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
    return makePlan({
      legacyId: "plan_generic_1",
      serviceId: "svc-generic",
      serviceLegacyId: "svc_generic_legacy",
      serviceKey: "deep_cleaning_builder",
      planKey: "builder_standard",
      name: "Builder Plan",
      isDefault: false,
      ...over,
    });
  }

  it("renders editable hourly fields for an hourly_by_area generic plan (no pending/empty state)", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ hourlyRate: 410, startAdjustmentHours: 0.25 })],
    );
    const card = planCard("Builder Plan");
    expect(within(card).getByLabelText("Hour price")).toHaveValue(410);
    expect(within(card).getByLabelText("Start adjustment (hours)")).toHaveValue(0.25);
    // A supported model WITH plans must leave the GPM-4b-1 non-editing states behind.
    expect(screen.queryByText("No plans configured yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Pricing model configuration pending")).not.toBeInTheDocument();
  });

  it("saves hourlyRate (+ start adjustment, active) for an hourly_by_area generic plan", async () => {
    renderEditor(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ hourlyRate: 410 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Hour price"), { target: { value: "455" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_generic_1",
      expect.objectContaining({ hourlyRate: 455, startAdjustmentHours: 0, active: true }),
    );
    // An hourly plan must never write the sqm_fixed-only columns.
    const [, patch] = onSavePlan.mock.calls[0];
    expect(patch).not.toHaveProperty("pricePerSqmExclVat");
    expect(patch).not.toHaveProperty("pricePerUnitExclVat");
  });

  it("blocks a missing hourly rate for an hourly_by_area generic plan", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ hourlyRate: 410 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Hour price"), { target: { value: "" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    expect(within(card).getByText(/Hourly rate must be a positive number/i)).toBeInTheDocument();
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it("renders editable price-per-m² fields for a sqm_fixed generic plan", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48, fixedAdjustmentExclVat: 250, minimumPriceExclVat: 1500 })],
    );
    const card = planCard("Builder Plan");
    expect(within(card).getByLabelText("Price per m²")).toHaveValue(48);
    expect(within(card).getByLabelText("Fixed adjustment excl. VAT")).toHaveValue(250);
    expect(within(card).getByLabelText("Minimum price excl. VAT")).toHaveValue(1500);
    // The hourly-only field must not appear for a sqm_fixed plan.
    expect(within(card).queryByLabelText("Hour price")).not.toBeInTheDocument();
  });

  it("saves pricePerSqmExclVat (+ adjustments, active) for a sqm_fixed generic plan", async () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Price per m²"), { target: { value: "52" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_generic_1",
      expect.objectContaining({
        pricePerSqmExclVat: 52,
        fixedAdjustmentExclVat: 0,
        minimumPriceExclVat: null,
        active: true,
      }),
    );
    const [, patch] = onSavePlan.mock.calls[0];
    // The reserved per-unit column has no migration yet — never written.
    expect(patch).not.toHaveProperty("pricePerUnitExclVat");
    // hourly column not written for a sqm_fixed plan.
    expect(patch).not.toHaveProperty("hourlyRate");
  });

  it.each([
    ["", /Price per m² must be a positive number/i],
    ["-5", /Price per m² must be a positive number/i],
  ])("blocks a missing/negative price per m² (%s) for a sqm_fixed generic plan", (value, message) => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Price per m²"), { target: { value } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    expect(within(card).getByText(message)).toBeInTheDocument();
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it.each([
    ["unit_based", "Unit based"],
    ["fixed_package", "Fixed package"],
  ])("keeps %s pending/read-only even when it has plans (no writable pricing inputs)", (model, label) => {
    renderEditor(
      [makeGenericService({ pricingModel: model, displayName: `Generic ${label}` })],
      [makeGenericPlan()],
    );
    expect(screen.getByText("Pricing model configuration pending")).toBeInTheDocument();
    // A reserved model exposes no editable pricing fields and no save affordance.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save plan/i })).not.toBeInTheDocument();
  });

  it("shows no automatic pricing fields for a manual_quote generic plan", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "manual_quote", displayName: "Generic Manual quote" })],
      [makeGenericPlan()],
    );
    expect(screen.getByText("Pricing model configuration pending")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hour price")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Price per m²")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("exposes no create-plan affordance on the editable generic card", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ hourlyRate: 410 })],
    );
    // The card can SAVE an existing plan, but never CREATE one (that is a later slice).
    expect(screen.getByRole("button", { name: "Save plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new plan/i })).not.toBeInTheDocument();
  });

  it("leaves Home's bespoke card + save unchanged when an editable generic service is present", async () => {
    renderEditor(
      [makeService(), makeGenericService({ pricingModel: "hourly_by_area" })],
      [makePlan(), makeGenericPlan({ hourlyRate: 410 })],
    );
    // Home keeps its bespoke RUT-aware card and save path.
    const homeCard = planCard("Flexibel");
    expect(within(homeCard).getByText("Price and tax settings")).toBeInTheDocument();
    expect(within(homeCard).getByLabelText("RUT percent")).toHaveValue(50);
    fireEvent.change(within(homeCard).getByLabelText("Hour price"), { target: { value: "420" } });
    fireEvent.click(within(homeCard).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_home_flexible",
      expect.objectContaining({ hourlyRate: 420, rutEligible: true }),
    );
  });

  it("leaves Office's bespoke editor unchanged when an editable generic service is present", () => {
    renderEditor(
      [makeOfficeService(), makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeOfficePlan(), makeGenericPlan({ hourlyRate: 410 })],
    );
    // Office keeps its bespoke section, fields and RUT-off note.
    expect(screen.getByText("Plan — Office Cleaning")).toBeInTheDocument();
    const officeCard = planCard("Standard");
    expect(within(officeCard).getByLabelText("Price per hour excl. VAT")).toHaveValue(459);
    expect(within(officeCard).getByText(/RUT is off by default for Office Cleaning/i)).toBeInTheDocument();
    // The generic editable card lives in its own builder lane.
    expect(screen.getByText("Generic builder services")).toBeInTheDocument();
    expect(within(planCard("Builder Plan")).getByLabelText("Hour price")).toHaveValue(410);
  });
});

// ── Slice GPM-4c-1: create-plan data path wired (form surfaced in GPM-4c-2) ──
describe("CleaningPlansEditor — GPM-4c-1 create-plan wiring", () => {
  const onAddPlan = vi.fn().mockResolvedValue(undefined);

  function renderWithAddPlan(services: CalculatorServiceConfig[], plans: CleaningPlanConfig[]) {
    return render(
      <CleaningPlansEditor
        services={services}
        plans={plans}
        currency="SEK"
        companyId="co-1"
        companyLegacyId="co_legacy_1"
        onSaveService={onSaveService}
        onSavePlan={onSavePlan}
        onSetDefault={onSetDefault}
        onAddPlan={onAddPlan}
      />,
    );
  }

  it("accepts the wired onAddPlan + company identifiers and still renders the generic builder lane", () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    expect(screen.getByText("Generic builder services")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Deep Cleaning Builder/ })).toBeInTheDocument();
  });

  it("never invokes onAddPlan during render — the Add-plan form only submits on demand", () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "sqm_fixed" })], []);
    expect(onAddPlan).not.toHaveBeenCalled();
  });

  it("keeps Home's bespoke card + save path unchanged while the create-plan path is wired", async () => {
    renderWithAddPlan(
      [makeService(), makeGenericService({ pricingModel: "hourly_by_area" })],
      [makePlan()],
    );
    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Hour price"), { target: { value: "415" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith("plan_home_flexible", expect.objectContaining({ hourlyRate: 415 }));
    expect(onAddPlan).not.toHaveBeenCalled();
  });
});

// ── Slice GPM-4c-2: Add-plan form for supported generic services ─────────────
describe("CleaningPlansEditor — GPM-4c-2 Add-plan form", () => {
  const onAddPlan = vi.fn().mockResolvedValue(undefined);

  function renderWithAddPlan(services: CalculatorServiceConfig[], plans: CleaningPlanConfig[]) {
    return render(
      <CleaningPlansEditor
        services={services}
        plans={plans}
        currency="SEK"
        companyId="co-1"
        companyLegacyId="co_legacy_1"
        onSaveService={onSaveService}
        onSavePlan={onSavePlan}
        onSetDefault={onSetDefault}
        onAddPlan={onAddPlan}
      />,
    );
  }

  /** A plan that BELONGS to the admin-created generic service (matching serviceKey). */
  function makeGenericPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
    return makePlan({
      legacyId: "plan_generic_1",
      serviceId: "svc-generic",
      serviceLegacyId: "svc_generic_legacy",
      serviceKey: "deep_cleaning_builder",
      planKey: "builder_standard",
      name: "Builder Plan",
      isDefault: false,
      sortOrder: 1,
      ...over,
    });
  }

  /** Opens the collapsed Add-plan form and returns its scoped <form> element. */
  function openAddPlanForm(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: "Add plan" }));
    return screen.getByRole("form", { name: /Add a new plan/i });
  }

  // 1 + 2: the Add-plan button appears for the engine-supported generic models.
  it.each([["hourly_by_area"], ["sqm_fixed"]])(
    "shows an Add-plan button for a supported %s generic service",
    (model) => {
      renderWithAddPlan([makeGenericService({ pricingModel: model })], []);
      expect(screen.getByRole("button", { name: "Add plan" })).toBeInTheDocument();
    },
  );

  // 3: Home/Office never gain an Add-plan affordance in this slice.
  it("shows no Add-plan button for Home or Office", () => {
    renderWithAddPlan([makeService(), makeOfficeService()], [makePlan(), makeOfficePlan()]);
    expect(screen.queryByRole("button", { name: "Add plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create plan/i })).not.toBeInTheDocument();
  });

  // 4 + 5 + 6: reserved models stay pending/read-only with no Add-plan affordance.
  it.each([["unit_based"], ["fixed_package"], ["manual_quote"]])(
    "shows no Add-plan button for the unsupported %s model (stays pending)",
    (model) => {
      renderWithAddPlan([makeGenericService({ pricingModel: model })], []);
      expect(screen.getByText("Pricing model configuration pending")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add plan" })).not.toBeInTheDocument();
    },
  );

  it("updates the empty-state copy to invite creation when the Add-plan form is available", () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    expect(screen.getByText("No plans configured yet")).toBeInTheDocument();
    expect(screen.getByText("Add the first plan to start pricing this service.")).toBeInTheDocument();
    expect(screen.queryByText("Plan creation will be handled in a later slice.")).not.toBeInTheDocument();
  });

  // 7: hourly_by_area Add-plan validates the required hourly rate before submit.
  it("blocks an hourly_by_area Add-plan with a missing hourly rate (validateNewPlan)", () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "premium" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "Premium" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    expect(within(form).getByText("Hourly rate must be a positive number.")).toBeInTheDocument();
    expect(onAddPlan).not.toHaveBeenCalled();
  });

  // 8: hourly_by_area Add-plan submits the expected NewPlanInput payload.
  it("creates an hourly_by_area plan with the expected NewPlanInput payload", async () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "premium" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "Premium" } });
    fireEvent.change(within(form).getByLabelText("Hour price"), { target: { value: "455" } });
    fireEvent.change(within(form).getByLabelText("Start adjustment (hours)"), { target: { value: "0.25" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onAddPlan).toHaveBeenCalledTimes(1));
    expect(onAddPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        companyLegacyId: "co_legacy_1",
        serviceId: "svc-generic",
        serviceLegacyId: "svc_generic_legacy",
        serviceKey: "deep_cleaning_builder",
        planKey: "premium",
        name: "Premium",
        description: null,
        pricingModel: "hourly_by_area",
        hourlyRate: 455,
        startAdjustmentHours: 0.25,
        sortOrder: 1,
      }),
    );
    // An hourly plan never sends the sqm-only column.
    const [input] = onAddPlan.mock.calls[0];
    expect(input).not.toHaveProperty("pricePerSqmExclVat");
  });

  // 9: sqm_fixed Add-plan validates the required price per m² before submit.
  it.each([
    ["", /Price per m² must be a positive number/],
    ["-5", /Price per m² must be a positive number/],
  ])("blocks a sqm_fixed Add-plan with a missing/negative price per m² (%s)", (value, message) => {
    renderWithAddPlan([makeGenericService({ pricingModel: "sqm_fixed" })], []);
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "normal" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "Normal" } });
    if (value !== "") {
      fireEvent.change(within(form).getByLabelText("Price per m²"), { target: { value } });
    }
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    expect(within(form).getByText(message)).toBeInTheDocument();
    expect(onAddPlan).not.toHaveBeenCalled();
  });

  // 10: sqm_fixed Add-plan submits the expected payload (no hourlyRate — data-access forces 0).
  it("creates a sqm_fixed plan with the expected NewPlanInput payload (no hourlyRate in UI)", async () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "sqm_fixed" })], []);
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "normal" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "Normalt skick" } });
    fireEvent.change(within(form).getByLabelText("Price per m²"), { target: { value: "48" } });
    fireEvent.change(within(form).getByLabelText("Fixed adjustment excl. VAT"), { target: { value: "250" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onAddPlan).toHaveBeenCalledTimes(1));
    expect(onAddPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceKey: "deep_cleaning_builder",
        planKey: "normal",
        name: "Normalt skick",
        pricingModel: "sqm_fixed",
        pricePerSqmExclVat: 48,
        fixedAdjustmentExclVat: 250,
        sortOrder: 1,
      }),
    );
    const [input] = onAddPlan.mock.calls[0];
    // The hourly_rate = 0 sentinel is the data-access layer's job, never the UI's.
    expect(input).not.toHaveProperty("hourlyRate");
    // An omitted optional minimum price is not sent.
    expect(input).not.toHaveProperty("minimumPriceExclVat");
  });

  // 11: an invalid plan key is blocked.
  it("blocks an invalid plan key", () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "Bad Key" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "X" } });
    fireEvent.change(within(form).getByLabelText("Hour price"), { target: { value: "400" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    expect(within(form).getByText(/lowercase letters/i)).toBeInTheDocument();
    expect(onAddPlan).not.toHaveBeenCalled();
  });

  // 12: a duplicate plan key (within this service) is blocked.
  it("blocks a duplicate plan key within the same service", () => {
    renderWithAddPlan(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ planKey: "builder_standard" })],
    );
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "builder_standard" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "Dup" } });
    fireEvent.change(within(form).getByLabelText("Hour price"), { target: { value: "400" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    expect(within(form).getByText(/already used/i)).toBeInTheDocument();
    expect(onAddPlan).not.toHaveBeenCalled();
  });

  // 13: Add-plan coexists with existing plan cards and computes the next sort order.
  it("offers Add-plan alongside existing plans and computes the next sort order", async () => {
    renderWithAddPlan(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ planKey: "builder_standard", sortOrder: 3 })],
    );
    // The editable GPM-4b-2 card and the GPM-4c-2 Add-plan button coexist.
    expect(within(planCard("Builder Plan")).getByLabelText("Hour price")).toBeInTheDocument();
    const form = openAddPlanForm();
    fireEvent.change(within(form).getByLabelText("Plan key"), { target: { value: "premium" } });
    fireEvent.change(within(form).getByLabelText("Plan name"), { target: { value: "Premium" } });
    fireEvent.change(within(form).getByLabelText("Hour price"), { target: { value: "500" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onAddPlan).toHaveBeenCalledTimes(1));
    expect(onAddPlan).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 4 }));
  });

  // 14: Home save behavior is unchanged when a wired generic service is present.
  it("keeps Home save behavior unchanged when a wired generic service is present", async () => {
    renderWithAddPlan(
      [makeService(), makeGenericService({ pricingModel: "hourly_by_area" })],
      [makePlan()],
    );
    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Hour price"), { target: { value: "415" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith("plan_home_flexible", expect.objectContaining({ hourlyRate: 415 }));
    expect(onAddPlan).not.toHaveBeenCalled();
  });

  it("cancels the Add-plan form without creating a plan", () => {
    renderWithAddPlan([makeGenericService({ pricingModel: "hourly_by_area" })], []);
    openAddPlanForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: /Add a new plan/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add plan" })).toBeInTheDocument();
    expect(onAddPlan).not.toHaveBeenCalled();
  });
});

// ── Slice GPM-10-B: generic plan-level RUT / deduction authoring ─────────────
describe("CleaningPlansEditor — GPM-10-B generic plan-level RUT", () => {
  /**
   * A plan belonging to an admin-created generic service. RUT defaults OFF here to
   * mirror a freshly-created generic plan (the data-access layer seeds rut off).
   */
  function makeGenericPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
    return makePlan({
      legacyId: "plan_generic_1",
      serviceId: "svc-generic",
      serviceLegacyId: "svc_generic_legacy",
      serviceKey: "deep_cleaning_builder",
      planKey: "builder_standard",
      name: "Builder Plan",
      isDefault: false,
      sortOrder: 1,
      rutEligible: false,
      rutEnabled: false,
      rutPercent: 50,
      showRutBreakdown: false,
      ...over,
    });
  }

  it("renders RUT controls on a sqm_fixed generic plan card", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    const card = planCard("Builder Plan");
    expect(within(card).getByText("RUT / deduction")).toBeInTheDocument();
    expect(within(card).getByText("RUT")).toBeInTheDocument();
    expect(within(card).getByLabelText("RUT percent")).toBeInTheDocument();
    expect(within(card).getByText("Show")).toBeInTheDocument();
  });

  it("also exposes RUT controls on an hourly_by_area generic plan (shared capability)", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "hourly_by_area" })],
      [makeGenericPlan({ hourlyRate: 410 })],
    );
    expect(within(planCard("Builder Plan")).getByText("RUT")).toBeInTheDocument();
  });

  it("reloads + displays saved RUT settings on a sqm_fixed generic plan", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48, rutEligible: true, rutEnabled: true, rutPercent: 60, showRutBreakdown: true })],
    );
    const card = planCard("Builder Plan");
    expect(within(card).getByLabelText("RUT percent")).toHaveValue(60);
    // Show is enabled (not disabled) once RUT is active.
    expect(within(card).getByLabelText("Show")).not.toBeDisabled();
    expect(within(card).queryByText("RUT is not active.")).not.toBeInTheDocument();
  });

  it("saves already-active RUT fields for a sqm_fixed generic plan through the shared PlanPatch path", async () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48, rutEligible: true, rutEnabled: true, rutPercent: 55, showRutBreakdown: true })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Price per m²"), { target: { value: "52" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_generic_1",
      expect.objectContaining({
        pricePerSqmExclVat: 52,
        rutEligible: true,
        rutEnabled: true,
        rutPercent: 55,
        showRutBreakdown: true,
      }),
    );
    // The engine does not consume rut_apply_to yet, so the generic card never writes it.
    const [, patch] = onSavePlan.mock.calls[0];
    expect(patch).not.toHaveProperty("rutApplyTo");
  });

  it("enables RUT via the toggle and persists it on save", async () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.click(within(card).getByLabelText("RUT"));
    fireEvent.change(within(card).getByLabelText("RUT percent"), { target: { value: "50" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_generic_1",
      expect.objectContaining({ rutEligible: true, rutEnabled: true, rutPercent: 50 }),
    );
  });

  it("defaults RUT off: an unchanged new generic plan saves rutEligible/rutEnabled false", async () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Price per m²"), { target: { value: "52" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_generic_1",
      expect.objectContaining({ rutEligible: false, rutEnabled: false, showRutBreakdown: false }),
    );
  });

  it("disables Show until RUT is active (display cannot create a deduction)", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48, rutEnabled: false, showRutBreakdown: false })],
    );
    const card = planCard("Builder Plan");
    expect(within(card).getByText("RUT is not active.")).toBeInTheDocument();
    expect(within(card).getByLabelText("Show")).toBeDisabled();
  });

  it("blocks an out-of-range RUT percent only when RUT is active", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48, rutEligible: true, rutEnabled: true, rutPercent: 50 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("RUT percent"), { target: { value: "150" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    expect(within(card).getByText("RUT percent must be between 0 and 100.")).toBeInTheDocument();
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it("shows no RUT controls for a reserved (not engine-backed) generic model", () => {
    renderEditor(
      [makeGenericService({ pricingModel: "unit_based", displayName: "Generic Unit based" })],
      [makeGenericPlan()],
    );
    expect(screen.getByText("Pricing model configuration pending")).toBeInTheDocument();
    expect(screen.queryByText("RUT")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("RUT percent")).not.toBeInTheDocument();
  });

  it("leaves Home's bespoke RUT card unchanged when a generic RUT-capable service is present", () => {
    renderEditor(
      [makeService(), makeGenericService({ pricingModel: "sqm_fixed" })],
      [makePlan(), makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    // Home keeps its bespoke Price-and-tax card with the live RUT preview rows.
    const homeCard = planCard("Flexibel");
    expect(within(homeCard).getByText("Price and tax settings")).toBeInTheDocument();
    expect(within(homeCard).getByText("Customer price after RUT")).toBeInTheDocument();
    // The generic card uses the lean RUT/deduction section (no live preview rows).
    const genericCard = planCard("Builder Plan");
    expect(within(genericCard).getByText("RUT / deduction")).toBeInTheDocument();
    expect(within(genericCard).queryByText("Customer price after RUT")).not.toBeInTheDocument();
  });
});

// ── GPM-UX-ADMIN-3: adaptive plan price fields + RUT label cleanup ───────────
describe("CleaningPlansEditor — GPM-UX-ADMIN-3 plan price fields", () => {
  function makeGenericService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
    return makeService({
      id: "svc-generic",
      legacyId: "svc_generic_legacy",
      serviceKey: "deep_cleaning_builder",
      displayName: "Builder",
      enabled: false,
      pricingModel: "sqm_fixed",
      sortOrder: 5,
      ...over,
    });
  }
  function makeGenericPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
    return makePlan({
      legacyId: "plan_generic_1",
      serviceId: "svc-generic",
      serviceLegacyId: "svc_generic_legacy",
      serviceKey: "deep_cleaning_builder",
      planKey: "builder_standard",
      name: "Builder Plan",
      isDefault: false,
      ...over,
    });
  }

  it("uses adaptive hourly labels + units (Hour price / SEK/h) plus a Total on the Home card", () => {
    renderEditor([makeService()], [makePlan({ hourlyRate: 400, vatRatePercent: 25 })]);
    const card = planCard("Flexibel");
    expect(within(card).getByLabelText("Hour price")).toHaveValue(400);
    expect(within(card).getByLabelText("VAT")).toHaveValue(25);
    expect(within(card).getAllByText("SEK/h").length).toBeGreaterThan(0);
    expect(within(card).getByText("Total")).toBeInTheDocument();
  });

  it("uses adaptive m² labels + units (Price per m² / SEK/m²) and never shows SEK/h on a sqm_fixed card", () => {
    renderEditor([makeGenericService()], [makeGenericPlan({ pricePerSqmExclVat: 48 })]);
    const card = planCard("Builder Plan");
    expect(within(card).getByLabelText("Price per m²")).toHaveValue(48);
    expect(within(card).getAllByText("SEK/m²").length).toBeGreaterThan(0);
    expect(within(card).queryByText("SEK/h")).not.toBeInTheDocument();
  });

  it("renames the RUT controls to RUT / Show (labels only)", () => {
    renderEditor([makeService()], [makePlan()]);
    const card = planCard("Flexibel");
    expect(within(card).getByText("RUT")).toBeInTheDocument();
    expect(within(card).getByText("Show")).toBeInTheDocument();
    expect(within(card).queryByText("RUT active")).not.toBeInTheDocument();
    expect(within(card).queryByText("Show RUT")).not.toBeInTheDocument();
  });
});

// ── GPM-UX-ADMIN-4: plan-card polish (editable metadata, save confirmation, RUT %) ──
describe("CleaningPlansEditor — GPM-UX-ADMIN-4 plan card polish", () => {
  function makeGenericPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
    return makePlan({
      legacyId: "plan_generic_1",
      serviceId: "svc-generic",
      serviceLegacyId: "svc_generic_legacy",
      serviceKey: "deep_cleaning_builder",
      planKey: "builder_standard",
      name: "Builder Plan",
      isDefault: false,
      ...over,
    });
  }

  it("edits and saves the plan name + description (Home) through the existing patch path", async () => {
    renderEditor([makeService()], [makePlan()]);
    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Plan name"), { target: { value: "Flexibel Plus" } });
    fireEvent.change(within(card).getByLabelText("Description"), { target: { value: "Updated copy" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_home_flexible",
      expect.objectContaining({ name: "Flexibel Plus", description: "Updated copy" }),
    );
  });

  it("blocks saving a plan with an empty name", () => {
    renderEditor([makeService()], [makePlan()]);
    const card = planCard("Flexibel");
    fireEvent.change(within(card).getByLabelText("Plan name"), { target: { value: "   " } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    expect(within(card).getByText("Plan name is required.")).toBeInTheDocument();
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it("shows a 'Plan saved' confirmation after a successful save", async () => {
    renderEditor([makeService()], [makePlan()]);
    const card = planCard("Flexibel");
    expect(within(card).queryByText("Plan saved")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(within(card).getByText("Plan saved")).toBeInTheDocument());
  });

  it("attaches a % unit inside the RUT percent field (Home)", () => {
    renderEditor([makeService()], [makePlan()]);
    const card = planCard("Flexibel");
    const rutPercent = within(card).getByLabelText("RUT percent");
    expect(rutPercent).toHaveValue(50);
    // The percent sign is attached inside the same field group as the input.
    expect(rutPercent.parentElement).toHaveTextContent("%");
  });

  it("edits and saves the plan name for a generic sqm_fixed plan", async () => {
    renderEditor(
      [makeGenericService({ pricingModel: "sqm_fixed" })],
      [makeGenericPlan({ pricePerSqmExclVat: 48 })],
    );
    const card = planCard("Builder Plan");
    fireEvent.change(within(card).getByLabelText("Plan name"), { target: { value: "Builder Pro" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledTimes(1));
    expect(onSavePlan).toHaveBeenCalledWith(
      "plan_generic_1",
      expect.objectContaining({ name: "Builder Pro", pricePerSqmExclVat: 48 }),
    );
  });
});
