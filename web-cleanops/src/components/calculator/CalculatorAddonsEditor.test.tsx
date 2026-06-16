import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalculatorAddonsEditor } from "./CalculatorAddonsEditor";
import type {
  CalculatorAddonConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

// ── Type-complete fixtures (mirror the E0E-1 add-on + service config shapes) ──

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
    sortOrder: 2,
    ...over,
  });
}

function makeAddon(over: Partial<CalculatorAddonConfig> = {}): CalculatorAddonConfig {
  return {
    legacyId: "addon_dog",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    addonKey: "dog",
    name: "Dog in home",
    publicLabel: "Finns hund i hemmet?",
    description: null,
    inputType: "boolean",
    booleanDefault: false,
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    effectTimeMinutes: 20,
    effectFixedExclVat: 0,
    effectPercent: 0,
    active: true,
    publicVisible: true,
    required: false,
    sortOrder: 1,
    ...over,
  };
}

/** A quantity add-on (bathrooms) — exercises min/max/step/default + quantity preview. */
function makeQuantityAddon(over: Partial<CalculatorAddonConfig> = {}): CalculatorAddonConfig {
  return makeAddon({
    legacyId: "addon_bathrooms",
    addonKey: "bathrooms",
    name: "Bathrooms",
    publicLabel: "Antal badrum",
    inputType: "quantity",
    quantityMin: 0,
    quantityMax: 10,
    quantityStep: 1,
    quantityDefault: 1,
    effectTimeMinutes: 15,
    sortOrder: 2,
    ...over,
  });
}

const onAddAddon = vi.fn().mockResolvedValue(undefined);
const onSaveAddon = vi.fn().mockResolvedValue(undefined);
const onArchiveAddon = vi.fn().mockResolvedValue(undefined);

function renderEditor(services: CalculatorServiceConfig[], addons: CalculatorAddonConfig[]) {
  return render(
    <CalculatorAddonsEditor
      services={services}
      addons={addons}
      companyId="company-uuid"
      companyLegacyId="company_legacy"
      onAddAddon={onAddAddon}
      onSaveAddon={onSaveAddon}
      onArchiveAddon={onArchiveAddon}
    />,
  );
}

/** Scope to the add-on card identified by its heading (name). */
function addonCard(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const card = heading.closest("div.rounded-2xl");
  if (!card) throw new Error(`Add-on card for "${name}" not found`);
  return card as HTMLElement;
}

/** Scope to the open create form (uniquely identified by its "Internal key" field). */
function createForm(): HTMLElement {
  const keyInput = screen.getByLabelText("Internal key");
  const form = keyInput.closest("div.rounded-2xl");
  if (!form) throw new Error("Create add-on form not found");
  return form as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CalculatorAddonsEditor", () => {
  it("renders the section and a live-for-supported-services banner", () => {
    renderEditor([makeService()], [makeAddon()]);
    expect(screen.getByText("Add-ons are live for supported services")).toBeInTheDocument();
    expect(
      screen.getByText(/now appear in the public calculator/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Add-ons — Hemstädning")).toBeInTheDocument();
  });

  it("renders one section per service with that service's add-ons", () => {
    renderEditor(
      [makeService(), makeOfficeService()],
      [makeAddon(), makeAddon({ legacyId: "addon_office_x", addonKey: "extra", name: "Office extra", serviceKey: "office_cleaning", serviceId: "svc-office" })],
    );
    expect(screen.getByText("Add-ons — Hemstädning")).toBeInTheDocument();
    expect(screen.getByText("Add-ons — Kontorsstädning")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dog in home" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Office extra" })).toBeInTheDocument();
  });

  it("opens the new add-on form and shows only boolean + quantity input types (no single_select)", () => {
    renderEditor([makeService()], []);
    // GPM-UX-ADMIN-7 — the create affordance reads "Create new add-on"; the open form
    // panel header stays "New add-on".
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    expect(screen.getByText("New add-on")).toBeInTheDocument();
    expect(screen.getByLabelText("Internal key")).toBeInTheDocument();
    // No single_select option exists anywhere in the editor.
    expect(screen.queryByRole("option", { name: /single/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Quantity" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "Yes / No" }).length).toBeGreaterThan(0);
  });

  it("uses non-technical add-on labels (GPM-UX-ADMIN-4)", () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    // The old technical labels are gone, replaced by admin-friendly copy + helper text.
    expect(within(form).getByLabelText("Internal key")).toBeInTheDocument();
    expect(within(form).getByLabelText("Answer type")).toBeInTheDocument();
    expect(within(form).getByLabelText("Admin name")).toBeInTheDocument();
    expect(within(form).getByLabelText("Text shown to customer")).toBeInTheDocument();
    expect(within(form).getByLabelText("Customer help text")).toBeInTheDocument();
    expect(within(form).queryByLabelText("Machine key")).not.toBeInTheDocument();
    expect(within(form).queryByLabelText("Internal name")).not.toBeInTheDocument();
    expect(within(form).getByText(/Permanent technical ID/i)).toBeInTheDocument();
  });

  it("makes the customer-facing field obvious and separate from the admin name (GPM-UX-ADMIN-6)", () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    // The field the customer sees is explicitly named, with an example in the helper.
    expect(within(form).getByLabelText("Text shown to customer")).toBeInTheDocument();
    expect(within(form).queryByLabelText("Customer question")).not.toBeInTheDocument();
    expect(
      within(form).getByText(/This is the text the customer will see in the public calculator/i),
    ).toBeInTheDocument();
    // Admin name is clearly marked as not customer-visible.
    expect(within(form).getByLabelText("Admin name")).toBeInTheDocument();
    expect(within(form).getByText(/The customer does not see this/i)).toBeInTheDocument();
  });

  it("renders the three price-effect controls in one responsive side-by-side group (GPM-UX-ADMIN-6)", () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    const group = within(form).getByTestId("price-effect-channels");
    // 3-up on wide screens, wrapping to a single column on narrow ones.
    expect(group.className).toContain("sm:grid-cols-3");
    expect(within(group).getByText("Affects time")).toBeInTheDocument();
    expect(within(group).getByText("Affects fixed price")).toBeInTheDocument();
    expect(within(group).getByText("Affects price by percent")).toBeInTheDocument();
  });

  it("labels the customer-facing text field on the edit card too (GPM-UX-ADMIN-6)", () => {
    renderEditor([makeService()], [makeAddon()]);
    const card = addonCard("Dog in home");
    expect(within(card).getByLabelText("Text shown to customer")).toBeInTheDocument();
    expect(
      within(card).getByText(/This is the text the customer will see in the public calculator/i),
    ).toBeInTheDocument();
    // The edit card groups the price-effect channels side by side as well.
    expect(within(card).getByTestId("price-effect-channels").className).toContain("sm:grid-cols-3");
  });

  it("shows the boolean default control for a boolean add-on", () => {
    renderEditor([makeService()], [makeAddon()]);
    const card = addonCard("Dog in home");
    expect(within(card).getByLabelText("Default to Yes")).toBeInTheDocument();
    // No quantity fields for a boolean add-on.
    expect(within(card).queryByLabelText("Step")).not.toBeInTheDocument();
  });

  it("shows min/max/step/default for a quantity add-on", () => {
    renderEditor([makeService()], [makeQuantityAddon()]);
    const card = addonCard("Bathrooms");
    expect(within(card).getByLabelText("Min")).toHaveValue(0);
    expect(within(card).getByLabelText("Max")).toHaveValue(10);
    expect(within(card).getByLabelText("Step")).toHaveValue(1);
    expect(within(card).getByLabelText("Default")).toHaveValue(1);
  });

  it("renders the three effect channels and saves their values", async () => {
    renderEditor(
      [makeService()],
      [makeAddon({ effectTimeMinutes: 20, effectFixedExclVat: 250, effectPercent: 15 })],
    );
    const card = addonCard("Dog in home");
    // All three channels are on (non-zero), so their inputs render.
    expect(within(card).getByLabelText("Minutes per unit")).toHaveValue(20);
    expect(within(card).getByLabelText("SEK per unit excl. VAT")).toHaveValue(250);
    expect(within(card).getByLabelText("Percent modifier")).toHaveValue(15);

    fireEvent.change(within(card).getByLabelText("Minutes per unit"), { target: { value: "30" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save add-on" }));

    await waitFor(() => expect(onSaveAddon).toHaveBeenCalledTimes(1));
    expect(onSaveAddon).toHaveBeenCalledWith(
      "addon_dog",
      expect.objectContaining({ effectTimeMinutes: 30, effectFixedExclVat: 250, effectPercent: 15 }),
    );
  });

  it("allows a negative fixed price (a discount)", async () => {
    renderEditor([makeService()], [makeAddon({ effectFixedExclVat: -100 })]);
    const card = addonCard("Dog in home");
    expect(within(card).getByLabelText("SEK per unit excl. VAT")).toHaveValue(-100);
    fireEvent.click(within(card).getByRole("button", { name: "Save add-on" }));
    await waitFor(() => expect(onSaveAddon).toHaveBeenCalledTimes(1));
    expect(onSaveAddon).toHaveBeenCalledWith(
      "addon_dog",
      expect.objectContaining({ effectFixedExclVat: -100 }),
    );
  });

  it("blocks an out-of-range percent and does not save", async () => {
    renderEditor([makeService()], [makeAddon({ effectPercent: 15 })]);
    const card = addonCard("Dog in home");
    fireEvent.change(within(card).getByLabelText("Percent modifier"), { target: { value: "150" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save add-on" }));
    expect(within(card).getByText(/Percent effect must be between -100 and 100/i)).toBeInTheDocument();
    expect(onSaveAddon).not.toHaveBeenCalled();
  });

  it("blocks an out-of-range time effect and does not save", async () => {
    renderEditor([makeService()], [makeAddon({ effectTimeMinutes: 20 })]);
    const card = addonCard("Dog in home");
    fireEvent.change(within(card).getByLabelText("Minutes per unit"), { target: { value: "2000" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save add-on" }));
    expect(within(card).getByText(/Time effect must be between 0 and 1440 minutes/i)).toBeInTheDocument();
    expect(onSaveAddon).not.toHaveBeenCalled();
  });

  it("blocks an invalid machine key in the create form", async () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    fireEvent.change(within(form).getByLabelText("Internal key"), { target: { value: "Bad Key" } });
    fireEvent.change(within(form).getByLabelText("Admin name"), { target: { value: "X" } });
    fireEvent.change(within(form).getByLabelText("Text shown to customer"), { target: { value: "X?" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create add-on" }));
    expect(
      screen.getByText(/Add-on key must be lowercase letters, digits and underscores/i),
    ).toBeInTheDocument();
    expect(onAddAddon).not.toHaveBeenCalled();
  });

  it("blocks a duplicate machine key for the same service", () => {
    renderEditor([makeService()], [makeAddon()]); // existing key "dog"
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    fireEvent.change(within(form).getByLabelText("Internal key"), { target: { value: "dog" } });
    fireEvent.change(within(form).getByLabelText("Admin name"), { target: { value: "Dog 2" } });
    fireEvent.change(within(form).getByLabelText("Text shown to customer"), { target: { value: "Dog again?" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create add-on" }));
    expect(screen.getByText(/Add-on key "dog" is already used by this service/i)).toBeInTheDocument();
    expect(onAddAddon).not.toHaveBeenCalled();
  });

  it("creates a new boolean add-on with the service scope and sort order", async () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    fireEvent.change(within(form).getByLabelText("Internal key"), { target: { value: "oven" } });
    fireEvent.change(within(form).getByLabelText("Admin name"), { target: { value: "Oven cleaning" } });
    fireEvent.change(within(form).getByLabelText("Text shown to customer"), { target: { value: "Ugnsrengöring?" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create add-on" }));

    await waitFor(() => expect(onAddAddon).toHaveBeenCalledTimes(1));
    expect(onAddAddon).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-uuid",
        companyLegacyId: "company_legacy",
        serviceId: "svc-home",
        serviceLegacyId: "svc_home_legacy",
        serviceKey: "home_cleaning",
        addonKey: "oven",
        name: "Oven cleaning",
        publicLabel: "Ugnsrengöring?",
        inputType: "boolean",
        sortOrder: 10,
      }),
    );
  });

  it("configures a price effect while creating an add-on (GPM-UX-ADMIN-5)", async () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    // The create form now carries the Price effect section up-front.
    expect(within(form).getByText("Price effect")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Internal key"), { target: { value: "oven" } });
    fireEvent.change(within(form).getByLabelText("Admin name"), { target: { value: "Oven cleaning" } });
    fireEvent.change(within(form).getByLabelText("Text shown to customer"), { target: { value: "Ugnsrengöring?" } });
    // Turn on the fixed-price channel and set a per-occurrence price.
    fireEvent.click(within(form).getByLabelText("Toggle Affects fixed price"));
    fireEvent.change(within(form).getByLabelText("SEK per unit excl. VAT"), { target: { value: "300" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create add-on" }));

    await waitFor(() => expect(onAddAddon).toHaveBeenCalledTimes(1));
    expect(onAddAddon).toHaveBeenCalledWith(
      expect.objectContaining({
        addonKey: "oven",
        effectFixedExclVat: 300,
        effectTimeMinutes: 0,
        effectPercent: 0,
      }),
    );
  });

  it("blocks an out-of-range percent effect in the create form", () => {
    renderEditor([makeService()], []);
    fireEvent.click(screen.getByRole("button", { name: "Create new add-on" }));
    const form = createForm();
    fireEvent.change(within(form).getByLabelText("Internal key"), { target: { value: "oven" } });
    fireEvent.change(within(form).getByLabelText("Admin name"), { target: { value: "Oven" } });
    fireEvent.change(within(form).getByLabelText("Text shown to customer"), { target: { value: "Ugn?" } });
    fireEvent.click(within(form).getByLabelText("Toggle Affects price by percent"));
    fireEvent.change(within(form).getByLabelText("Percent modifier"), { target: { value: "150" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create add-on" }));
    expect(within(form).getByText(/Percent effect must be between -100 and 100/i)).toBeInTheDocument();
    expect(onAddAddon).not.toHaveBeenCalled();
  });

  it("saves active / visible / required / sort order changes", async () => {
    renderEditor([makeService()], [makeAddon()]);
    const card = addonCard("Dog in home");
    fireEvent.click(within(card).getByLabelText("Dog in home active")); // active → false
    fireEvent.click(within(card).getByLabelText("Visible in calculator")); // public → false
    fireEvent.click(within(card).getByLabelText("Required")); // required → true
    fireEvent.change(within(card).getByLabelText("Sort order"), { target: { value: "5" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save add-on" }));

    await waitFor(() => expect(onSaveAddon).toHaveBeenCalledTimes(1));
    expect(onSaveAddon).toHaveBeenCalledWith(
      "addon_dog",
      expect.objectContaining({ active: false, publicVisible: false, required: true, sortOrder: 5 }),
    );
  });

  it("archives an add-on after confirmation", async () => {
    renderEditor([makeService()], [makeAddon()]);
    const card = addonCard("Dog in home");
    fireEvent.click(within(card).getByRole("button", { name: "Archive" }));
    // Confirm in the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Archive add-on" }));
    await waitFor(() => expect(onArchiveAddon).toHaveBeenCalledTimes(1));
    expect(onArchiveAddon).toHaveBeenCalledWith("addon_dog");
  });

  it("keeps an inactive add-on visible in admin and marked inactive", () => {
    renderEditor([makeService()], [makeAddon({ active: false })]);
    // GPM-UX-ADMIN-3 — inactive add-ons are hidden by default; reveal them with the toggle.
    fireEvent.click(screen.getByRole("button", { name: /Show inactive add-ons/i }));
    const card = addonCard("Dog in home");
    expect(within(card).getByText("Inactive")).toBeInTheDocument();
  });

  it("previews a boolean add-on at the Yes answer", () => {
    renderEditor([makeService()], [makeAddon({ effectTimeMinutes: 20 })]);
    const card = addonCard("Dog in home");
    expect(within(card).getByText("Customer preview")).toBeInTheDocument();
    expect(within(card).getByText(/Customer answer:/i)).toBeInTheDocument();
    expect(within(card).getByText(/20 min/)).toBeInTheDocument();
  });

  it("previews a quantity add-on using the example quantity (5 × 40 = 200 SEK)", () => {
    renderEditor(
      [makeService()],
      [makeQuantityAddon({ effectTimeMinutes: 0, effectFixedExclVat: 40 })],
    );
    const card = addonCard("Bathrooms");
    fireEvent.change(within(card).getByLabelText("Example quantity"), { target: { value: "5" } });
    expect(within(card).getByText("200 SEK")).toBeInTheDocument();
  });

  it("shows an empty state when a service has no add-ons", () => {
    renderEditor([makeService()], []);
    expect(screen.getByText(/No add-ons for Hemstädning yet/i)).toBeInTheDocument();
  });
});
