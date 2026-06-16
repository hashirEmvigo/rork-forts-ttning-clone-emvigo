import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Service, ServiceCategory, ServicePackage } from "@/types";

/**
 * SVCCAT Phase 2 — Service Package item persistence (dialog state).
 *
 * Guards the package-item reset bug: while the dialog was open, a catalog/source
 * refresh re-created the scoped-catalog accessor identities, which re-ran the
 * hydrate effect and wiped in-progress item edits before they could be saved.
 *
 * The fix splits that effect so `items` only resets on [open, servicePackage].
 * We reproduce a "catalog refresh" by handing the dialog NEW accessor function
 * identities between renders (a prop/identity change), exactly what AppContext
 * does when its `getScopedServices*` useCallbacks are re-created after a
 * directory refetch. Divergence is created with the plain Remove button so the
 * test never has to drive a Radix Select (unsupported in jsdom).
 */

const mocks = vi.hoisted(() => {
  const categories: ServiceCategory[] = [
    {
      id: "cat_cleaning",
      companyId: null,
      name: "Cleaning",
      sortOrder: 0,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const services: Service[] = [
    {
      id: "svc_window",
      companyId: null,
      categoryId: "cat_cleaning",
      name: "Window cleaning",
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "svc_floor",
      companyId: null,
      categoryId: "cat_cleaning",
      name: "Floor care",
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  return {
    categories,
    services,
    // Mutable accessor holders so a test can hand the dialog NEW function
    // identities — exactly what a catalog/source refresh does at runtime.
    scopedCategories: { current: (): ServiceCategory[] => categories },
    scopedServices: { current: (): Service[] => services },
    createServicePackage: vi.fn(),
    updateServicePackage: vi.fn(),
    toast: vi.fn(),
  };
});

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    createServicePackage: mocks.createServicePackage,
    updateServicePackage: mocks.updateServicePackage,
    getScopedServiceCategories: mocks.scopedCategories.current,
    getScopedServices: mocks.scopedServices.current,
    payrollGroups: [],
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { ServicePackageDialog } from "./ServicePackageDialog";

/** A saved package carrying two catalog-snapshot items. */
function pkgWithTwoItems(): ServicePackage {
  return {
    id: "svc_pkg_1",
    name: "Starter",
    description: "two services",
    archived: false,
    items: [
      {
        id: "svc_pkg_item_1",
        name: "Window cleaning",
        categoryName: "Cleaning",
        billingType: "fixed",
        serviceBasisType: "billable",
        deductionEligible: false,
        deductionType: "none",
        smsEnabled: false,
        sourceServiceId: "svc_window",
        sourceCategoryId: "cat_cleaning",
      },
      {
        id: "svc_pkg_item_2",
        name: "Floor care",
        categoryName: "Cleaning",
        billingType: "fixed",
        serviceBasisType: "billable",
        deductionEligible: false,
        deductionType: "none",
        smsEnabled: false,
        sourceServiceId: "svc_floor",
        sourceCategoryId: "cat_cleaning",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.createServicePackage.mockResolvedValue({ ok: true });
  mocks.updateServicePackage.mockResolvedValue({ ok: true });
  mocks.scopedCategories.current = () => mocks.categories;
  mocks.scopedServices.current = () => mocks.services;
});

describe("ServicePackageDialog · item persistence", () => {
  it("does not reset items when the catalog source identity changes (simulated refresh) mid-edit", () => {
    const servicePackage = pkgWithTwoItems();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ServicePackageDialog open onOpenChange={onOpenChange} servicePackage={servicePackage} />,
    );

    // Both snapshot items hydrate from the package.
    expect(screen.getByText("Window cleaning")).toBeInTheDocument();
    expect(screen.getByText("Floor care")).toBeInTheDocument();

    // Edit the in-memory list so it diverges from servicePackage.items. Assert on
    // the package-item Remove button (not loose text): once removed, svc_floor
    // becomes selectable again in the catalog picker, so its name reappears as a
    // dropdown option — that must not be mistaken for the package still holding it.
    fireEvent.click(screen.getByRole("button", { name: "Remove Floor care" }));
    expect(screen.queryByRole("button", { name: "Remove Floor care" })).not.toBeInTheDocument();

    // Simulate a catalog/source refresh: NEW accessor identities (same content),
    // same package + open state. Before the fix this re-ran the hydrate effect
    // and resurrected the removed item.
    mocks.scopedCategories.current = () => [...mocks.categories];
    mocks.scopedServices.current = () => [...mocks.services];
    rerender(
      <ServicePackageDialog open onOpenChange={onOpenChange} servicePackage={servicePackage} />,
    );

    // The kept item remains; the removed item is NOT resurrected as a package item.
    expect(screen.getByText("Window cleaning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Floor care" })).not.toBeInTheDocument();
  });

  it("submits the current in-memory items to updateServicePackage on save", async () => {
    const servicePackage = pkgWithTwoItems();
    render(<ServicePackageDialog open onOpenChange={vi.fn()} servicePackage={servicePackage} />);

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(mocks.updateServicePackage).toHaveBeenCalledWith(
        "svc_pkg_1",
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ sourceServiceId: "svc_window", name: "Window cleaning" }),
            expect.objectContaining({ sourceServiceId: "svc_floor", name: "Floor care" }),
          ]),
        }),
      ),
    );
  });
});

describe("ServicePackageDialog · orphaned items (source service deleted)", () => {
  it("shows an item whose source service was deleted as no longer valid and drops it on save", async () => {
    // Catalog now only has svc_window — svc_floor was permanently deleted.
    mocks.scopedServices.current = () => mocks.services.filter((s) => s.id === "svc_window");
    const servicePackage = pkgWithTwoItems();
    render(<ServicePackageDialog open onOpenChange={vi.fn()} servicePackage={servicePackage} />);

    // The orphan is surfaced in the "No longer in catalog" group, not as valid.
    expect(screen.getByText("No longer in catalog (1)")).toBeInTheDocument();
    expect(screen.getByText("Floor care")).toBeInTheDocument();
    expect(screen.getByText("Window cleaning")).toBeInTheDocument();

    // Saving prunes the orphan: only the still-valid item is persisted.
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(mocks.updateServicePackage).toHaveBeenCalledTimes(1));
    const savedItems = mocks.updateServicePackage.mock.calls[0][1].items as { sourceServiceId?: string }[];
    expect(savedItems.map((it) => it.sourceServiceId)).toEqual(["svc_window"]);
  });

  it("keeps legacy free-text items (no source link) as valid", () => {
    mocks.scopedServices.current = () => [];
    const servicePackage: ServicePackage = {
      ...pkgWithTwoItems(),
      items: [
        {
          id: "it_legacy",
          name: "Hand-typed line",
          categoryName: "Cleaning",
          billingType: "fixed",
          serviceBasisType: "billable",
          deductionEligible: false,
          deductionType: "none",
          smsEnabled: false,
        },
      ],
    };
    render(<ServicePackageDialog open onOpenChange={vi.fn()} servicePackage={servicePackage} />);

    // Legacy item has no sourceServiceId, so it is never treated as orphaned.
    expect(screen.queryByText(/No longer in catalog/)).not.toBeInTheDocument();
    expect(screen.getByText("Hand-typed line")).toBeInTheDocument();
  });
});

describe("ServicePackageDialog · focus category", () => {
  it("renders the package contents when opened with a focus category", () => {
    const servicePackage = pkgWithTwoItems();
    render(
      <ServicePackageDialog
        open
        onOpenChange={vi.fn()}
        servicePackage={servicePackage}
        focusCategoryId="cat_cleaning"
      />,
    );

    expect(screen.getByText("Window cleaning")).toBeInTheDocument();
    expect(screen.getByText("Floor care")).toBeInTheDocument();
  });

  it("does not reset items when the focus category changes while open (tag re-click)", () => {
    const servicePackage = pkgWithTwoItems();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ServicePackageDialog
        open
        onOpenChange={onOpenChange}
        servicePackage={servicePackage}
        focusCategoryId="cat_cleaning"
      />,
    );

    // Diverge the in-memory list from servicePackage.items. Assert on the Remove
    // button so the catalog picker's re-listed "Floor care" option is not mistaken
    // for the package still holding the removed item.
    fireEvent.click(screen.getByRole("button", { name: "Remove Floor care" }));
    expect(screen.queryByRole("button", { name: "Remove Floor care" })).not.toBeInTheDocument();

    // Re-clicking a different category's tag changes only the focus prop. This
    // must NOT re-run the hydrate effect (which would resurrect the removed
    // item) — the focus effect is intentionally isolated from `items`.
    rerender(
      <ServicePackageDialog
        open
        onOpenChange={onOpenChange}
        servicePackage={servicePackage}
        focusCategoryId="cat_windows"
      />,
    );

    expect(screen.getByText("Window cleaning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Floor care" })).not.toBeInTheDocument();
  });
});
