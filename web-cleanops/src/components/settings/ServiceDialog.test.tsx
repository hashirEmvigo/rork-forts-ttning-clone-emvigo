import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Service, ServiceCategory } from "@/types";

const mocks = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  toast: vi.fn(),
  getAvailableTimeCodes: vi.fn(() => []),
  getTimeCodeById: vi.fn(() => undefined),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: {
      id: "usr_admin",
      name: "Admin",
      email: "admin@example.com",
      role: "company_admin",
      companyId: "cmp_stad",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    getServiceScope: () => "cmp_stad",
    hasPermission: () => true,
    getAvailableTimeCodes: mocks.getAvailableTimeCodes,
    getTimeCodeById: mocks.getTimeCodeById,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-service-catalog-mutations", () => ({
  useServiceCatalogMutations: () => ({
    createService: mocks.createService,
    updateService: mocks.updateService,
    createServiceCategory: vi.fn(),
    updateServiceCategory: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

import { ServiceDialog } from "./ServiceDialog";

const categories: ServiceCategory[] = [
  {
    id: "svc_cat_1",
    companyId: "cmp_stad",
    name: "Smoke Category",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const service: Service = {
  id: "svc_1",
  companyId: "cmp_stad",
  categoryId: "svc_cat_1",
  name: "Old Service",
  billingType: "fixed",
  serviceBasisType: "billable",
  deductionEligible: false,
  deductionType: "none",
  smsEnabled: false,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof ServiceDialog>> = {},
  onOpenChange = vi.fn(),
): ReturnType<typeof vi.fn> {
  render(
    <MemoryRouter>
      <ServiceDialog
        open
        onOpenChange={onOpenChange}
        categories={categories}
        defaultCategoryId="svc_cat_1"
        {...props}
      />
    </MemoryRouter>,
  );
  return onOpenChange;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.createService.mockResolvedValue({ ...service, id: "svc_new", name: "Smoke Service" });
  mocks.updateService.mockResolvedValue({ ...service, name: "Updated Service" });
});

describe("CORE-WRITES-A1 ServiceDialog", () => {
  it("awaits Supabase service create before closing and preserves the category link", async () => {
    const onOpenChange = renderDialog();

    fireEvent.change(screen.getByLabelText(/Service name/i), {
      target: { value: "Smoke Service" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create service$/i }));

    await waitFor(() =>
      expect(mocks.createService).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "svc_cat_1",
          name: "Smoke Service",
          billingType: "fixed",
          serviceBasisType: "billable",
          deductionEligible: false,
          deductionType: "none",
          smsEnabled: false,
        }),
      ),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.updateService).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Service created" }));
  });

  it("keeps the dialog open and shows an error when Supabase service create fails", async () => {
    mocks.createService.mockRejectedValueOnce(new Error("Supabase write failed"));
    const onOpenChange = renderDialog();

    fireEvent.change(screen.getByLabelText(/Service name/i), {
      target: { value: "Broken Service" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create service$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Supabase write failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save", variant: "destructive" }),
    );
  });

  it("awaits Supabase service update before closing", async () => {
    const onOpenChange = renderDialog({ service });

    fireEvent.change(screen.getByLabelText(/Service name/i), {
      target: { value: "Updated Service" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(mocks.updateService).toHaveBeenCalledWith({
        serviceId: "svc_1",
        patch: expect.objectContaining({
          categoryId: "svc_cat_1",
          name: "Updated Service",
        }),
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.createService).not.toHaveBeenCalled();
  });
});
