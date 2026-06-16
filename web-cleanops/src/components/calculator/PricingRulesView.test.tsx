import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PricingRulesView } from "./PricingRulesView";
import type {
  CalculatorServiceConfig,
  CleaningPlanConfig,
  PricingRuleConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

// ── Fixtures (seeded MVP numbers) ───────────────────────────────────────────

function rule(
  over: Partial<PricingRuleConfig> & Pick<PricingRuleConfig, "ruleKey" | "ruleType" | "valueNumeric">,
): PricingRuleConfig {
  return { legacyId: `rule_${over.ruleKey}`, serviceId: "svc-home", active: true, sortOrder: 1, ...over };
}

const HOME_SERVICE: CalculatorServiceConfig = {
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
};

const MOVE_SERVICE: CalculatorServiceConfig = {
  id: "svc-move",
  legacyId: "svc_move_legacy",
  serviceKey: "move_out_cleaning",
  displayName: "Flyttstädning",
  description: null,
  enabled: true,
  comingSoon: false,
  pricingModel: "move_out_fixed_plus_addons",
  sortOrder: 2,
  requiresCleaningPlan: false,
  plansEnabled: false,
  planPricingModel: "hourly_rate_by_plan",
  defaultPlanKey: null,
  baseHourlyRateExclVat: null,
  defaultVatRatePercent: 25,
  questions: [],
};

const HOME_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, sortOrder: 1 }),
  rule({ ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02, sortOrder: 2 }),
  rule({ ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2, sortOrder: 3 }),
  rule({ ruleKey: "bathroom_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.25, sortOrder: 4 }),
  rule({ ruleKey: "addon_hours_oven", ruleType: "addon_hours", valueNumeric: 0.5, sortOrder: 5 }),
  rule({ ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10, sortOrder: 6 }),
  rule({ ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10, sortOrder: 7 }),
  rule({ ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50, sortOrder: 8 }),
];

const MOVE_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_price", ruleType: "threshold", valueNumeric: 1500, sortOrder: 1, serviceId: "svc-move" }),
  rule({ ruleKey: "price_per_sqm", ruleType: "numeric_factor", valueNumeric: 25, sortOrder: 2, serviceId: "svc-move" }),
];

const PLANS: CleaningPlanConfig[] = [
  {
    legacyId: "plan_flexible",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    planKey: "flexible",
    name: "Flexibel",
    description: null,
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
  },
];

function renderView(
  over: Partial<React.ComponentProps<typeof PricingRulesView>> = {},
): { onSave: ReturnType<typeof vi.fn> } {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PricingRulesView
      services={[HOME_SERVICE]}
      pricingRules={HOME_RULES}
      plans={PLANS}
      currency="SEK"
      enabled={false}
      onSaveRuleValue={onSave}
      {...over}
    />,
  );
  return { onSave };
}

/** Expand a collapsed service card by clicking its trigger (matched by service name). */
function expandService(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
}

/** Reveal the (collapsed-by-default) square-meter adjustment table (GPM-UX-ADMIN-6). */
function expandSqmTable(): void {
  fireEvent.click(screen.getByRole("button", { name: /Expand table/i }));
}

function openEditDialog(ruleLabel: string): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${ruleLabel}` }));
  return screen.getByRole("dialog");
}

describe("PricingRulesView", () => {
  it("renders each service as a collapsed card by default (no stretched rows)", () => {
    renderView();
    // The service card header is always visible with a rule count…
    expect(screen.getByText("Hemstädning")).toBeInTheDocument();
    expect(screen.getByText("8 pricing rules")).toBeInTheDocument();
    // …but the rules themselves stay hidden until the card is expanded.
    expect(screen.queryByText("Minutes per m²")).not.toBeInTheDocument();
    expect(screen.queryByText("Base calculation")).not.toBeInTheDocument();
  });

  it("expands a service to reveal its grouped, read-only rules", () => {
    renderView();
    expandService("Hemstädning");
    // "Minutes per m²" is unique to the rule list (the audit entry below is base_hours).
    expect(screen.getByText("Minutes per m²")).toBeInTheDocument();
    expect(screen.getByText("Base calculation")).toBeInTheDocument();
    // Slice 12Q follow-up — rounding now lives inside Price-range margins.
    expect(screen.getByText("Price-range margins")).toBeInTheDocument();
    expect(screen.queryByText("Rounding")).not.toBeInTheDocument();
  });

  it("expands each service independently (Hemstädning + Flyttstädning)", () => {
    renderView({ services: [HOME_SERVICE, MOVE_SERVICE], pricingRules: [...HOME_RULES, ...MOVE_RULES] });
    // Both collapsed initially.
    expect(screen.queryByText("Minutes per m²")).not.toBeInTheDocument();
    expect(screen.queryByText("Price Per Sqm")).not.toBeInTheDocument();

    expandService("Hemstädning");
    expect(screen.getByText("Minutes per m²")).toBeInTheDocument();

    // Opening a second card does not collapse the first (multiple may be open).
    expandService("Flyttstädning");
    expect(screen.getByText("Price Per Sqm")).toBeInTheDocument();
    expect(screen.getByText("Minutes per m²")).toBeInTheDocument();
  });

  it("opens an edit dialog showing locked fields and the current value", () => {
    renderView();
    expandService("Hemstädning");
    const dialog = openEditDialog("Start time for a mission");
    expect(within(dialog).getByText("Edit pricing value")).toBeInTheDocument();
    // Locked machine identifiers are shown but there is no input for them.
    expect(within(dialog).getByText("base_hours")).toBeInTheDocument();
    expect(within(dialog).getByText("home_cleaning_recommended_hours")).toBeInTheDocument();
    // base_hours is stored in hours → the mirrored Hours field shows the stored value,
    // and the Minutes field mirrors it (1.5 h → 90 min).
    expect(within(dialog).getByLabelText("Hours")).toHaveValue("1.5");
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue("90");
  });

  it("blocks an invalid (negative) value and does not save", () => {
    const { onSave } = renderView();
    expandService("Hemstädning");
    const dialog = openEditDialog("Start time for a mission");
    fireEvent.change(within(dialog).getByLabelText("Hours"), { target: { value: "-5" } });
    expect(within(dialog).getByText(/zero or greater/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows a time-only preview (no price / before / after / difference)", () => {
    renderView();
    expandService("Hemstädning");
    const dialog = openEditDialog("Start time for a mission");
    // Slice 12O — the misleading price preview is gone entirely.
    expect(within(dialog).queryByText("Price preview")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("preview-before")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("preview-after")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("preview-diff")).not.toBeInTheDocument();
    // …replaced by an estimated-time preview that explains the time impact only.
    expect(within(dialog).getByText("Estimated time preview")).toBeInTheDocument();
    expect(within(dialog).getByTestId("time-preview")).toHaveTextContent("Prices, VAT and RUT are not shown");
  });

  it("requires explicit confirmation before saving the change", async () => {
    const { onSave } = renderView();
    expandService("Hemstädning");
    const dialog = openEditDialog("Start time for a mission");
    fireEvent.change(within(dialog).getByLabelText("Hours"), { target: { value: "2.5" } });

    // Save without confirming → blocked.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    expect(within(dialog).getByText(/Confirm the price-impact warning/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    // Confirm + save → the intended rule + value is passed through.
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedRule, savedValue, savedNote] = onSave.mock.calls[0];
    expect(savedRule.legacyId).toBe("rule_base_hours");
    expect(savedValue).toBe(2.5);
    expect(savedNote).toBeNull();
  });

  it("shows a stronger warning when the calculator is live", () => {
    renderView({ enabled: true });
    expandService("Hemstädning");
    const dialog = openEditDialog("Start time for a mission");
    expect(within(dialog).getByText(/currently enabled/)).toBeInTheDocument();
  });

  // GPM-UX-ADMIN-4 — "Recent pricing changes" was moved out of the Pricing
  // workspace into the Settings section; it is now covered by the QuoteSettingsEditor
  // and CalculatorControl tests, and must no longer render here.
  it("no longer renders the pricing-change history inside the Pricing workspace", () => {
    renderView();
    expect(screen.queryByText("Recent pricing changes")).not.toBeInTheDocument();
  });
});

// ── Slice 12K — Pricing Settings UX clarity ─────────────────────────────────

const MINUTE_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, sortOrder: 1 }),
  rule({
    ruleKey: "every_four_weeks_start_minutes",
    ruleType: "threshold",
    valueNumeric: 30,
    sortOrder: 2,
  }),
  rule({
    ruleKey: "under_minimum_visit_threshold_minutes",
    ruleType: "threshold",
    valueNumeric: 180,
    sortOrder: 3,
  }),
  rule({
    ruleKey: "under_minimum_visit_start_minutes",
    ruleType: "threshold",
    valueNumeric: 15,
    sortOrder: 4,
  }),
  rule({ ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50, sortOrder: 5 }),
];

describe("PricingRulesView — Slice 12K UX", () => {
  it("renders the inner rule grid with a dense wide-desktop layout (4 on xl, up to 5 on 2xl)", () => {
    renderView();
    expandService("Hemstädning");
    const grid = screen.getByTestId("rule-grid-base");
    expect(grid.className).toContain("xl:grid-cols-4");
    expect(grid.className).toContain("2xl:grid-cols-5");
  });

  it("renders business section headings with icons", () => {
    renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    // Heading text plus an icon badge for the section.
    expect(screen.getByText("Base calculation")).toBeInTheDocument();
    expect(screen.getByTestId("rule-section-icon-base").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("rule-section-icon-time_adjustments").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("rule-section-icon-margins").querySelector("svg")).toBeTruthy();
  });

  it("splits add-ons into extra-services and time-adjustment sections", () => {
    // Combine an extra-service rule (oven) with a time-adjustment rule so both
    // add-on sections are present (HOME_RULES alone has no time-adjustment rule).
    renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    expect(screen.getByText("Time adjustment rules")).toBeInTheDocument();
    expect(screen.queryByText("Thresholds & minimums")).not.toBeInTheDocument();
  });

  it("visually groups home_cleaning sections into distinct blocks", () => {
    renderView();
    expandService("Hemstädning");
    // HOME_RULES has base + extra-service + margin + rounding rules (no minute/pet
    // time-adjustment rules), so those four blocks are present.
    expect(screen.getByTestId("rule-section-base")).toBeInTheDocument();
    expect(screen.getByTestId("rule-section-extra_services")).toBeInTheDocument();
    expect(screen.getByTestId("rule-section-margins")).toBeInTheDocument();
    // Slice 12Q follow-up — the standalone Rounding section was merged into margins.
    expect(screen.queryByTestId("rule-section-rounding")).not.toBeInTheDocument();
    const margins = screen.getByTestId("rule-section-margins");
    expect(within(margins).getByText("Price rounding interval")).toBeInTheDocument();
  });

  it("visually groups move_out_cleaning sections into distinct blocks", () => {
    renderView({ services: [MOVE_SERVICE], pricingRules: MOVE_RULES });
    expandService("Flyttstädning");
    // base_price + price_per_sqm are core formula inputs → Base calculation.
    expect(screen.getByTestId("rule-section-base")).toBeInTheDocument();
  });

  it("visually groups office_cleaning sections into distinct blocks", () => {
    const officeService: CalculatorServiceConfig = {
      ...MOVE_SERVICE,
      id: "svc-office",
      legacyId: "svc_office_legacy",
      serviceKey: "office_cleaning",
      displayName: "Kontorsstädning",
      pricingModel: "office_hourly",
      sortOrder: 3,
    };
    const officeRules: PricingRuleConfig[] = [
      rule({ ruleKey: "hourly_rate", ruleType: "numeric_factor", valueNumeric: 450, sortOrder: 1, serviceId: "svc-office" }),
      rule({
        ruleKey: "supervision_start_minutes",
        ruleType: "threshold",
        valueNumeric: 60,
        sortOrder: 2,
        serviceId: "svc-office",
      }),
    ];
    renderView({ services: [officeService], pricingRules: officeRules });
    expandService("Kontorsstädning");
    // hourly_rate → Base calculation; supervision_start_minutes → time adjustments.
    expect(screen.getByTestId("rule-section-base")).toBeInTheDocument();
    expect(screen.getByTestId("rule-section-time_adjustments")).toBeInTheDocument();
  });

  it("shows the new human label for every_four_weeks_start_minutes", () => {
    renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    expect(
      screen.getByText("Add-on for customers with cleaning every fourth week"),
    ).toBeInTheDocument();
    // The raw technical key is still preserved as muted metadata.
    expect(screen.getByText("every_four_weeks_start_minutes")).toBeInTheDocument();
  });

  it("formats minute-based rule values as 'X min (Y h)'", () => {
    renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    expect(screen.getByText("30 min (0.5 h)")).toBeInTheDocument();
    expect(screen.getByText("180 min (3 h)")).toBeInTheDocument();
    expect(screen.getByText("15 min (0.25 h)")).toBeInTheDocument();
  });

  it("shows the under-minimum threshold + add minutes in one linked card", () => {
    renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    const linked = screen.getByTestId("linked-rule-small-visit");
    expect(within(linked).getByText("Small-visit add-on")).toBeInTheDocument();
    expect(within(linked).getByText("If estimated visit time is under")).toBeInTheDocument();
    expect(within(linked).getByText("Then add")).toBeInTheDocument();
    expect(within(linked).getByText("180 min (3 h)")).toBeInTheDocument();
    expect(within(linked).getByText("15 min (0.25 h)")).toBeInTheDocument();
    // Technical keys stay visible as muted metadata inside the linked card.
    expect(within(linked).getByText("under_minimum_visit_threshold_minutes")).toBeInTheDocument();
    expect(within(linked).getByText("under_minimum_visit_start_minutes")).toBeInTheDocument();
  });

  it("keeps both linked values editable, writing back to the correct rule keys", async () => {
    const { onSave } = renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    // Edit the "add" side of the linked card.
    fireEvent.click(screen.getByRole("button", { name: "Edit Small-visit added time" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("under_minimum_visit_start_minutes")).toBeInTheDocument();
    // Minute-backed rule → the Minutes field carries the stored value.
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue("15");
    fireEvent.change(within(dialog).getByLabelText("Minutes"), { target: { value: "20" } });
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedRule, savedValue] = onSave.mock.calls[0];
    expect(savedRule.ruleKey).toBe("under_minimum_visit_start_minutes");
    expect(savedValue).toBe(20);
  });
});

// ── Slice 12N — time-unit UX standardization ────────────────────────────────

const SQM_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, sortOrder: 1 }),
  rule({ ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02, sortOrder: 2 }),
  rule({ ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2, sortOrder: 3 }),
  rule({ ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50, sortOrder: 4 }),
];

describe("PricingRulesView — Slice 12N time-unit UX", () => {
  it("relabels base_hours / minimum_hours / hours_per_sqm with business labels", () => {
    renderView({ pricingRules: SQM_RULES });
    expandService("Hemstädning");
    expect(screen.getByText("Start time for a mission")).toBeInTheDocument();
    expect(screen.getByText("Minimum visit time")).toBeInTheDocument();
    expect(screen.getByText("Minutes per m²")).toBeInTheDocument();
    // Raw technical keys stay visible as muted metadata.
    expect(screen.getByText("base_hours")).toBeInTheDocument();
    expect(screen.getByText("minimum_hours")).toBeInTheDocument();
    expect(screen.getByText("hours_per_sqm")).toBeInTheDocument();
  });

  it("formats hour-backed and per-m² values with the global standard", () => {
    renderView({ pricingRules: SQM_RULES });
    expandService("Hemstädning");
    // base_hours 1.5 h → 90 min (1.5 h); minimum_hours 2 h → 120 min (2 h).
    expect(screen.getByText("90 min (1.5 h)")).toBeInTheDocument();
    expect(screen.getByText("120 min (2 h)")).toBeInTheDocument();
    // hours_per_sqm 0.02 → 1.2 min/m² (0.02 h/m²).
    expect(screen.getByText("1.2 min/m² (0.02 h/m²)")).toBeInTheDocument();
  });

  it("places minimum_hours, Minutes per m² and the start time all under Base calculation", () => {
    renderView({ pricingRules: SQM_RULES });
    expandService("Hemstädning");
    // Slice 12P — the single start-time setting now lives in Base calculation.
    const base = screen.getByTestId("rule-section-base");
    expect(within(base).getByText("Minimum visit time")).toBeInTheDocument();
    expect(within(base).getByText("Minutes per m²")).toBeInTheDocument();
    expect(within(base).getByText("Start time for a mission")).toBeInTheDocument();
  });

  it("mirrors Minutes ↔ Hours for an hour-backed rule and saves hours", async () => {
    const { onSave } = renderView({ pricingRules: SQM_RULES });
    expandService("Hemstädning");
    fireEvent.click(screen.getByRole("button", { name: "Edit Start time for a mission" }));
    const dialog = screen.getByRole("dialog");
    // Editing minutes mirrors hours immediately (45 min → 0.75 h).
    fireEvent.change(within(dialog).getByLabelText("Minutes"), { target: { value: "45" } });
    expect(within(dialog).getByLabelText("Hours")).toHaveValue("0.75");
    // Editing hours mirrors minutes immediately (1 h → 60 min).
    fireEvent.change(within(dialog).getByLabelText("Hours"), { target: { value: "1" } });
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue("60");
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedRule, savedValue] = onSave.mock.calls[0];
    expect(savedRule.ruleKey).toBe("base_hours");
    // Hour-backed rule saves HOURS (1 h), not minutes.
    expect(savedValue).toBe(1);
  });

  it("mirrors a minute-backed rule and saves minutes", async () => {
    const { onSave } = renderView({ pricingRules: MINUTE_RULES });
    expandService("Hemstädning");
    fireEvent.click(screen.getByRole("button", { name: "Edit Add-on for customers with cleaning every fourth week" }));
    const dialog = screen.getByRole("dialog");
    // Stored 30 min → Minutes 30, Hours mirror 0.5.
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue("30");
    expect(within(dialog).getByLabelText("Hours")).toHaveValue("0.5");
    // Edit via Hours → minutes mirror; minute-backed rule saves MINUTES.
    fireEvent.change(within(dialog).getByLabelText("Hours"), { target: { value: "1" } });
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue("60");
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedRule, savedValue] = onSave.mock.calls[0];
    expect(savedRule.ruleKey).toBe("every_four_weeks_start_minutes");
    expect(savedValue).toBe(60);
  });

  it("edits hours_per_sqm via mirrored Minutes per m² / Hours per m² and saves hours per m²", async () => {
    const { onSave } = renderView({ pricingRules: SQM_RULES });
    expandService("Hemstädning");
    fireEvent.click(screen.getByRole("button", { name: "Edit Minutes per m²" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Hours per m²")).toHaveValue("0.02");
    expect(within(dialog).getByLabelText("Minutes per m²")).toHaveValue("1.2");
    // Editing minutes-per-m² mirrors hours-per-m² (1.8 min/m² → 0.03 h/m²).
    fireEvent.change(within(dialog).getByLabelText("Minutes per m²"), { target: { value: "1.8" } });
    expect(within(dialog).getByLabelText("Hours per m²")).toHaveValue("0.03");
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedRule, savedValue] = onSave.mock.calls[0];
    expect(savedRule.ruleKey).toBe("hours_per_sqm");
    expect(savedValue).toBe(0.03);
  });
});

// ── Slice 12P — label cleanup, start-time dedup, rounding explanation ────────

const BATHROOM_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, sortOrder: 1 }),
  rule({ ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02, sortOrder: 2 }),
  rule({ ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2, sortOrder: 3 }),
  // Inactive extra service — must show under extra-services and stay disabled.
  rule({
    ruleKey: "bathroom_extra_hours",
    ruleType: "numeric_factor",
    valueNumeric: 0.25,
    sortOrder: 4,
    active: false,
  }),
  rule({ ruleKey: "addon_hours_oven", ruleType: "addon_hours", valueNumeric: 0.5, sortOrder: 5 }),
  rule({ ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50, sortOrder: 6 }),
];

const DEDUP_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, sortOrder: 1 }),
  rule({ ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02, sortOrder: 2 }),
  rule({ ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2, sortOrder: 3 }),
  // Legacy/internal admin-only start-time override — hidden from the normal UX.
  rule({ ruleKey: "strict_setup_start_minutes", ruleType: "threshold", valueNumeric: 0, sortOrder: 4 }),
  rule({ ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50, sortOrder: 5 }),
];

describe("PricingRulesView — Slice 12P UX cleanup", () => {
  it("places bathroom_extra_hours under Add-ons — extra services, not Base calculation", () => {
    renderView({ pricingRules: BATHROOM_RULES });
    expandService("Hemstädning");
    // GPM-UX-ADMIN-3 — inactive rules are hidden by default; reveal them.
    fireEvent.click(screen.getByRole("button", { name: /Show inactive pricing items/i }));
    const extra = screen.getByTestId("rule-section-extra_services");
    expect(within(extra).getByText("Bathroom Extra Hours")).toBeInTheDocument();
    const base = screen.getByTestId("rule-section-base");
    expect(within(base).queryByText("Bathroom Extra Hours")).not.toBeInTheDocument();
  });

  it("keeps an inactive bathroom_extra_hours visible with its inactive state", () => {
    renderView({ pricingRules: BATHROOM_RULES });
    expandService("Hemstädning");
    // GPM-UX-ADMIN-3 — reveal the hidden inactive rule before asserting it shows.
    fireEvent.click(screen.getByRole("button", { name: /Show inactive pricing items/i }));
    const extra = screen.getByTestId("rule-section-extra_services");
    expect(within(extra).getByText("Bathroom Extra Hours")).toBeInTheDocument();
    // The inactive pill marks it clearly without reactivating it.
    expect(within(extra).getAllByText("Inactive").length).toBeGreaterThan(0);
  });

  it("shows a single 'Start time for a mission' setting under Base calculation", () => {
    renderView({ pricingRules: DEDUP_RULES });
    expandService("Hemstädning");
    const base = screen.getByTestId("rule-section-base");
    // Exactly one visible start-time card.
    expect(within(base).getAllByText("Start time for a mission")).toHaveLength(1);
    expect(within(base).getByText("base_hours")).toBeInTheDocument();
  });

  it("hides the legacy strict_setup_start_minutes duplicate from the normal UX", () => {
    renderView({ pricingRules: DEDUP_RULES });
    expandService("Hemstädning");
    expect(screen.queryByText("strict_setup_start_minutes")).not.toBeInTheDocument();
    expect(screen.queryByText("Strict Setup Start Minutes")).not.toBeInTheDocument();
  });

  it("relabels rounding_increment as 'Price rounding interval' inside Price-range margins", () => {
    renderView({ pricingRules: DEDUP_RULES });
    expandService("Hemstädning");
    // Slice 12Q follow-up — rounding moved into the Price-range margins section
    // (no standalone Rounding section remains).
    expect(screen.queryByTestId("rule-section-rounding")).not.toBeInTheDocument();
    const margins = screen.getByTestId("rule-section-margins");
    expect(within(margins).getByText("Price rounding interval")).toBeInTheDocument();
    expect(within(margins).getByText(/nearest 50 kr/)).toBeInTheDocument();
    // Technical key still preserved as muted metadata.
    expect(within(margins).getByText("rounding_increment")).toBeInTheDocument();
  });

  it("keeps the mirrored Minutes/Hours edit behavior for the start-time setting", async () => {
    const { onSave } = renderView({ pricingRules: DEDUP_RULES });
    expandService("Hemstädning");
    fireEvent.click(screen.getByRole("button", { name: "Edit Start time for a mission" }));
    const dialog = screen.getByRole("dialog");
    // base_hours stored in hours → Hours field carries the value, Minutes mirrors.
    expect(within(dialog).getByLabelText("Hours")).toHaveValue("1.5");
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue("90");
    fireEvent.change(within(dialog).getByLabelText("Minutes"), { target: { value: "30" } });
    expect(within(dialog).getByLabelText("Hours")).toHaveValue("0.5");
    fireEvent.click(within(dialog).getByLabelText("Confirm price-impact"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save value" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedRule, savedValue] = onSave.mock.calls[0];
    expect(savedRule.ruleKey).toBe("base_hours");
    expect(savedValue).toBe(0.5);
  });
});

describe("PricingRulesView — Slice 12Q square-meter adjustment", () => {
  const HOME_WITH_RANGES: CalculatorServiceConfig = {
    ...HOME_SERVICE,
    homeSqmAdjustments: [
      { fromSqm: 0, toSqm: 60, adjustmentPercent: 0 },
      { fromSqm: 61, toSqm: 70, adjustmentPercent: -5 },
      { fromSqm: 71, toSqm: 80, adjustmentPercent: -7.5 },
    ],
  };

  function renderWithSqm(
    over: Partial<React.ComponentProps<typeof PricingRulesView>> = {},
  ): { onSaveSqm: ReturnType<typeof vi.fn> } {
    const onSaveSqm = vi.fn().mockResolvedValue(undefined);
    render(
      <PricingRulesView
        services={[over.services?.[0] ?? HOME_WITH_RANGES]}
        pricingRules={HOME_RULES}
        plans={PLANS}
        currency="SEK"
        enabled={false}
        onSaveRuleValue={vi.fn().mockResolvedValue(undefined)}
        onSaveSqmAdjustments={onSaveSqm}
        {...over}
      />,
    );
    return { onSaveSqm };
  }

  it("renders the Adjustment for square meters editor under Base calculation for home cleaning", () => {
    renderWithSqm();
    expandService("Hemstädning");
    const base = screen.getByTestId("rule-section-base");
    const editor = within(base).getByTestId("sqm-adjustment-editor");
    expect(within(editor).getByText("Adjustment for square meters")).toBeInTheDocument();
    // Visually linked to Minutes per m²: the Minutes-per-m² card is in the same section.
    expect(within(base).getByText("Minutes per m²")).toBeInTheDocument();
  });

  it("shows each range with its effective minutes per m² (base 0.02 h/m² = 1.2 min/m²)", () => {
    renderWithSqm();
    expandService("Hemstädning");
    expandSqmTable();
    // -5% of 1.2 min/m² = 1.14 min/m².
    expect(screen.getByTestId("sqm-adjustment-effective-1")).toHaveTextContent("1.14 min/m²");
    // 0% leaves 1.2 min/m².
    expect(screen.getByTestId("sqm-adjustment-effective-0")).toHaveTextContent("1.2 min/m²");
  });

  it("shows a clean empty state when no ranges are configured", () => {
    renderWithSqm({ services: [{ ...HOME_SERVICE, homeSqmAdjustments: [] }] });
    expandService("Hemstädning");
    expandSqmTable();
    expect(screen.getByTestId("sqm-adjustment-empty")).toBeInTheDocument();
  });

  it("adds a range and saves the full list to the underlying handler", async () => {
    const { onSaveSqm } = renderWithSqm({ services: [{ ...HOME_SERVICE, homeSqmAdjustments: [] }] });
    expandService("Hemstädning");
    expandSqmTable();
    fireEvent.click(screen.getByRole("button", { name: "Add range" }));
    fireEvent.change(screen.getByLabelText("Adjustment percent for range 1"), { target: { value: "-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ranges" }));
    await waitFor(() => expect(onSaveSqm).toHaveBeenCalledTimes(1));
    const [service, ranges] = onSaveSqm.mock.calls[0];
    expect(service.serviceKey).toBe("home_cleaning");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].adjustmentPercent).toBe(-10);
  });

  it("edits from/to/percent and persists them", async () => {
    const { onSaveSqm } = renderWithSqm();
    expandService("Hemstädning");
    expandSqmTable();
    fireEvent.change(screen.getByLabelText("From m² for range 2"), { target: { value: "62" } });
    fireEvent.change(screen.getByLabelText("To m² for range 2"), { target: { value: "68" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ranges" }));
    await waitFor(() => expect(onSaveSqm).toHaveBeenCalledTimes(1));
    const ranges = onSaveSqm.mock.calls[0][1];
    const edited = ranges.find((r: { fromSqm: number }) => r.fromSqm === 62);
    expect(edited).toBeTruthy();
    expect(edited.toSqm).toBe(68);
  });

  it("deletes a range", async () => {
    const { onSaveSqm } = renderWithSqm();
    expandService("Hemstädning");
    expandSqmTable();
    fireEvent.click(screen.getByRole("button", { name: "Remove range 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Save ranges" }));
    await waitFor(() => expect(onSaveSqm).toHaveBeenCalledTimes(1));
    expect(onSaveSqm.mock.calls[0][1]).toHaveLength(2);
  });

  it("blocks saving overlapping ranges with a clear error", async () => {
    const { onSaveSqm } = renderWithSqm();
    expandService("Hemstädning");
    expandSqmTable();
    // Make range 2 (61–70) overlap range 3 (71–80) by extending its top to 75.
    fireEvent.change(screen.getByLabelText("To m² for range 2"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ranges" }));
    expect(await screen.findByText("Ranges must not overlap.")).toBeInTheDocument();
    expect(onSaveSqm).not.toHaveBeenCalled();
  });

  it("does not render the editor for non-home services", () => {
    renderWithSqm({ services: [MOVE_SERVICE], pricingRules: MOVE_RULES });
    expandService("Flyttstädning");
    expect(screen.queryByTestId("sqm-adjustment-editor")).not.toBeInTheDocument();
  });

  it("lets the admin type a lone minus sign without snapping back to 0", () => {
    renderWithSqm({ services: [{ ...HOME_SERVICE, homeSqmAdjustments: [] }] });
    expandService("Hemstädning");
    expandSqmTable();
    fireEvent.click(screen.getByRole("button", { name: "Add range" }));
    const pct = screen.getByLabelText("Adjustment percent for range 1") as HTMLInputElement;
    fireEvent.change(pct, { target: { value: "-" } });
    expect(pct.value).toBe("-");
  });

  it("accepts and persists a negative decimal adjustmentPercent", async () => {
    const { onSaveSqm } = renderWithSqm({ services: [{ ...HOME_SERVICE, homeSqmAdjustments: [] }] });
    expandService("Hemstädning");
    expandSqmTable();
    fireEvent.click(screen.getByRole("button", { name: "Add range" }));
    const pct = screen.getByLabelText("Adjustment percent for range 1") as HTMLInputElement;
    fireEvent.change(pct, { target: { value: "-7.5" } });
    expect(pct.value).toBe("-7.5");
    fireEvent.click(screen.getByRole("button", { name: "Save ranges" }));
    await waitFor(() => expect(onSaveSqm).toHaveBeenCalledTimes(1));
    expect(onSaveSqm.mock.calls[0][1][0].adjustmentPercent).toBe(-7.5);
  });

  it("shows the negative effective minutes per m² live while editing", () => {
    // Fixture base is 0.02 h/m² = 1.2 min/m². -10% → 1.08 min/m².
    renderWithSqm({
      services: [{ ...HOME_SERVICE, homeSqmAdjustments: [{ fromSqm: 100, toSqm: 120, adjustmentPercent: -10 }] }],
    });
    expandService("Hemstädning");
    expandSqmTable();
    expect(screen.getByTestId("sqm-adjustment-effective-0")).toHaveTextContent("1.08 min/m²");
  });

  it("reloads negative adjustmentPercent from persisted ranges", () => {
    renderWithSqm({
      services: [{ ...HOME_SERVICE, homeSqmAdjustments: [{ fromSqm: 100, toSqm: 120, adjustmentPercent: -10 }] }],
    });
    expandService("Hemstädning");
    expandSqmTable();
    expect((screen.getByLabelText("Adjustment percent for range 1") as HTMLInputElement).value).toBe("-10");
  });

  it("collapses the adjustment table by default, showing a summary and an Expand button (GPM-UX-ADMIN-6)", () => {
    renderWithSqm(); // HOME_WITH_RANGES has 3 ranges
    expandService("Hemstädning");
    // The table rows stay hidden until the admin expands them…
    expect(screen.queryByTestId("sqm-adjustment-row-0")).not.toBeInTheDocument();
    // …and a one-line summary + an Expand control take their place.
    expect(screen.getByTestId("sqm-adjustment-summary")).toHaveTextContent("3 ranges configured");
    expect(screen.getByRole("button", { name: /Expand table/i })).toBeInTheDocument();
  });

  it("expands on Expand table and collapses again on Collapse table (GPM-UX-ADMIN-6)", () => {
    renderWithSqm();
    expandService("Hemstädning");
    // Expand → the rows appear and the summary is replaced.
    fireEvent.click(screen.getByRole("button", { name: /Expand table/i }));
    expect(screen.getByTestId("sqm-adjustment-row-0")).toBeInTheDocument();
    expect(screen.queryByTestId("sqm-adjustment-summary")).not.toBeInTheDocument();
    // Collapse → the rows hide again and the summary returns.
    fireEvent.click(screen.getByRole("button", { name: /Collapse table/i }));
    expect(screen.queryByTestId("sqm-adjustment-row-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("sqm-adjustment-summary")).toBeInTheDocument();
  });
});

// ── GPM-UX-ADMIN-7 — unified "Add-ons" subsection + section order ────────────

const ALL_SECTION_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5, sortOrder: 1 }),
  rule({ ruleKey: "every_four_weeks_start_minutes", ruleType: "threshold", valueNumeric: 30, sortOrder: 2 }),
  rule({ ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10, sortOrder: 3 }),
  rule({ ruleKey: "addon_hours_oven", ruleType: "addon_hours", valueNumeric: 0.5, sortOrder: 4 }),
];

describe("PricingRulesView — GPM-UX-ADMIN-7 unified Add-ons", () => {
  it("orders the Pricing subsections base → time adjustments → margins → Add-ons", () => {
    render(
      <PricingRulesView
        embedded
        services={[HOME_SERVICE]}
        pricingRules={ALL_SECTION_RULES}
        plans={PLANS}
        currency="SEK"
        enabled={false}
        onSaveRuleValue={vi.fn().mockResolvedValue(undefined)}
        addonsSlot={<div data-testid="slot-addons">addons</div>}
      />,
    );
    const ids = screen.getAllByTestId(/^rule-section-(?!icon-)/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "rule-section-base",
      "rule-section-time_adjustments",
      "rule-section-margins",
      "rule-section-extra_services",
    ]);
  });

  it("renames the section to 'Add-ons' and drops the old 'Extra service time rules' label", () => {
    render(
      <PricingRulesView
        embedded
        services={[HOME_SERVICE]}
        pricingRules={ALL_SECTION_RULES}
        plans={PLANS}
        currency="SEK"
        enabled={false}
        onSaveRuleValue={vi.fn().mockResolvedValue(undefined)}
        addonsSlot={<div data-testid="slot-addons">addons</div>}
      />,
    );
    const addons = screen.getByTestId("rule-section-extra_services");
    expect(within(addons).getByText("Add-ons")).toBeInTheDocument();
    expect(screen.queryByText("Extra service time rules")).not.toBeInTheDocument();
  });

  it("hosts the injected add-ons slot and the legacy time-based rules under one Add-ons section", () => {
    render(
      <PricingRulesView
        embedded
        services={[HOME_SERVICE]}
        pricingRules={ALL_SECTION_RULES}
        plans={PLANS}
        currency="SEK"
        enabled={false}
        onSaveRuleValue={vi.fn().mockResolvedValue(undefined)}
        addonsSlot={<div data-testid="slot-addons">addons</div>}
      />,
    );
    const addons = screen.getByTestId("rule-section-extra_services");
    // Sub-group A — the customer add-ons editor slot.
    expect(within(addons).getByTestId("slot-addons")).toBeInTheDocument();
    // Sub-group B — the legacy time-based add-on rules, clearly labelled.
    expect(within(addons).getByText("Existing time-based add-on rules")).toBeInTheDocument();
    expect(within(addons).getByText("Addon Hours Oven")).toBeInTheDocument();
  });

  it("renders the Add-ons section from the slot alone when there are no time-based add-on rules", () => {
    render(
      <PricingRulesView
        embedded
        services={[MOVE_SERVICE]}
        pricingRules={MOVE_RULES}
        plans={PLANS}
        currency="SEK"
        enabled={false}
        onSaveRuleValue={vi.fn().mockResolvedValue(undefined)}
        addonsSlot={<div data-testid="slot-addons">addons</div>}
      />,
    );
    const addons = screen.getByTestId("rule-section-extra_services");
    expect(within(addons).getByText("Add-ons")).toBeInTheDocument();
    expect(within(addons).getByTestId("slot-addons")).toBeInTheDocument();
    // With no legacy rules, the secondary sub-group heading is not shown.
    expect(within(addons).queryByText("Existing time-based add-on rules")).not.toBeInTheDocument();
  });

  it("renders the Add-ons section even when the service has no pricing rules at all (generic sqm_fixed)", () => {
    render(
      <PricingRulesView
        embedded
        services={[MOVE_SERVICE]}
        pricingRules={[]}
        plans={PLANS}
        currency="SEK"
        enabled={false}
        onSaveRuleValue={vi.fn().mockResolvedValue(undefined)}
        addonsSlot={<div data-testid="slot-addons">addons</div>}
      />,
    );
    expect(screen.getByTestId("rule-section-extra_services")).toBeInTheDocument();
    expect(screen.getByTestId("slot-addons")).toBeInTheDocument();
    expect(screen.queryByText("No pricing rules configured for this service.")).not.toBeInTheDocument();
  });

  it("keeps the standalone (non-embedded) view working without a slot — Add-ons shows only legacy rules", () => {
    renderView({ pricingRules: HOME_RULES });
    expandService("Hemstädning");
    const addons = screen.getByTestId("rule-section-extra_services");
    // No slot → no customer add-ons sub-group, just the legacy rule cards under "Add-ons".
    expect(within(addons).getByText("Add-ons")).toBeInTheDocument();
    expect(within(addons).queryByText("Existing time-based add-on rules")).not.toBeInTheDocument();
    expect(within(addons).getByText("Addon Hours Oven")).toBeInTheDocument();
  });
});
