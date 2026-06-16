/**
 * GPM-CALC-LIBRARY-4 — Add-on Library Admin UX tests.
 *
 * Proves the new, purely-additive "Add-on library" panel inside the embedded
 * Add-ons subsection:
 *   • The panel only renders when `addonLibraryItems` is provided (existing usages
 *     that omit it are unaffected — the panel is invisible).
 *   • It lists activatable library add-ons (active + key not already on the service)
 *     and filters out keys already present + inactive library items.
 *   • Activating a library add-on reuses the existing onAddAddon write path, copying
 *     the library defaults (including effect channels) and stamping libraryItemId.
 *   • Saving a service add-on to the library calls onSaveAddonToLibrary.
 * Activation never changes pricing, never touches public runtime, and never mutates
 * the existing add-ons.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalculatorAddonsEditor } from "./CalculatorAddonsEditor";
import type {
  CalculatorAddonConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";
import type { AddonLibraryItem } from "@/lib/calculator/libraryItems";

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

function makeAddonLibraryItem(over: Partial<AddonLibraryItem> = {}): AddonLibraryItem {
  return {
    id: "alib-oven",
    legacyId: "calc_alib_oven_x",
    companyId: "company-uuid",
    companyLegacyId: "company_legacy",
    addonKey: "oven_cleaning",
    name: "Ugnsrengöring",
    publicLabel: "Rengöring av ugn",
    description: null,
    inputType: "boolean",
    booleanDefault: false,
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    effectTimeMinutes: 30,
    effectFixedExclVat: 0,
    effectPercent: 0,
    defaultSortOrder: 5,
    active: true,
    ...over,
  };
}

const onAddAddon = vi.fn().mockResolvedValue(undefined);
const onSaveAddon = vi.fn().mockResolvedValue(undefined);
const onArchiveAddon = vi.fn().mockResolvedValue(undefined);
const onSaveAddonToLibrary = vi.fn().mockResolvedValue(undefined);

function renderWithLibrary(
  services: CalculatorServiceConfig[],
  addons: CalculatorAddonConfig[],
  libraryItems: AddonLibraryItem[] | undefined,
  opts: { withSave?: boolean } = {},
) {
  return render(
    <CalculatorAddonsEditor
      embedded
      services={services}
      addons={addons}
      companyId="company-uuid"
      companyLegacyId="company_legacy"
      onAddAddon={onAddAddon}
      onSaveAddon={onSaveAddon}
      onArchiveAddon={onArchiveAddon}
      addonLibraryItems={libraryItems}
      onSaveAddonToLibrary={opts.withSave ? onSaveAddonToLibrary : undefined}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CalculatorAddonsEditor — GPM-CALC-LIBRARY-4 add-on library panel", () => {
  it("does not render the library panel when addonLibraryItems is undefined", () => {
    renderWithLibrary([makeService()], [makeAddon()], undefined);
    expect(screen.queryByTestId("addon-library-panel")).not.toBeInTheDocument();
  });

  it("renders the library panel (collapsed) when library items are provided", () => {
    renderWithLibrary([makeService()], [makeAddon()], [makeAddonLibraryItem()]);
    expect(screen.getByTestId("addon-library-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("addon-library-item-oven_cleaning")).not.toBeInTheDocument();
  });

  it("lists activatable library add-ons and filters out keys already on the service + inactive items", () => {
    renderWithLibrary([makeService()], [makeAddon()], [
      makeAddonLibraryItem(),
      makeAddonLibraryItem({ id: "alib-dog", addonKey: "dog", name: "Dog dup", publicLabel: "Hund dup" }),
      makeAddonLibraryItem({ id: "alib-win", addonKey: "windows", name: "Windows", publicLabel: "Fönster", active: false }),
    ]);
    fireEvent.click(screen.getByTestId("addon-library-toggle"));
    expect(screen.getByTestId("addon-library-item-oven_cleaning")).toBeInTheDocument();
    expect(screen.queryByTestId("addon-library-item-dog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("addon-library-item-windows")).not.toBeInTheDocument();
  });

  it("activates a library add-on via onAddAddon with copied defaults + libraryItemId", async () => {
    renderWithLibrary([makeService()], [makeAddon()], [makeAddonLibraryItem()]);
    fireEvent.click(screen.getByTestId("addon-library-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Activate Rengöring av ugn" }));

    await waitFor(() => expect(onAddAddon).toHaveBeenCalledTimes(1));
    expect(onAddAddon).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-uuid",
        companyLegacyId: "company_legacy",
        serviceId: "svc-home",
        serviceLegacyId: "svc_home_legacy",
        serviceKey: "home_cleaning",
        addonKey: "oven_cleaning",
        name: "Ugnsrengöring",
        publicLabel: "Rengöring av ugn",
        inputType: "boolean",
        effectTimeMinutes: 30,
        libraryItemId: "alib-oven",
      }),
    );
  });

  it("saves a service add-on to the library via onSaveAddonToLibrary", async () => {
    renderWithLibrary([makeService()], [makeAddon()], [makeAddonLibraryItem()], { withSave: true });
    fireEvent.click(screen.getByTestId("addon-library-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Save Dog in home to library" }));

    await waitFor(() => expect(onSaveAddonToLibrary).toHaveBeenCalledTimes(1));
    expect(onSaveAddonToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-uuid",
        companyLegacyId: "company_legacy",
        addonKey: "dog",
        name: "Dog in home",
        publicLabel: "Finns hund i hemmet?",
        effectTimeMinutes: 20,
        defaultSortOrder: 1,
      }),
    );
  });

  it("hides the save-to-library list when onSaveAddonToLibrary is not provided", () => {
    renderWithLibrary([makeService()], [makeAddon()], [makeAddonLibraryItem()]);
    fireEvent.click(screen.getByTestId("addon-library-toggle"));
    expect(screen.queryByText("Save this service’s add-ons to the library")).not.toBeInTheDocument();
  });
});
