import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createServiceCategory: vi.fn(),
  updateServiceCategory: vi.fn(),
  toast: vi.fn(),
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
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-service-catalog-mutations", () => ({
  useServiceCatalogMutations: () => ({
    createServiceCategory: mocks.createServiceCategory,
    updateServiceCategory: mocks.updateServiceCategory,
    isPending: false,
    error: null,
  }),
}));

import { ServiceCategoryDialog } from "./ServiceCategoryDialog";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.createServiceCategory.mockResolvedValue({ id: "svc_cat_1", name: "Smoke Category" });
  mocks.updateServiceCategory.mockResolvedValue({ id: "svc_cat_1", name: "Updated Category" });
});

describe("CORE-WRITES-A1 ServiceCategoryDialog", () => {
  it("awaits Supabase category create before closing", async () => {
    const onOpenChange = vi.fn();
    render(<ServiceCategoryDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText(/Category name/i), {
      target: { value: "Smoke Category" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create category/i }));

    await waitFor(() =>
      expect(mocks.createServiceCategory).toHaveBeenCalledWith({
        name: "Smoke Category",
        description: undefined,
        categoryType: undefined,
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.updateServiceCategory).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Category created" }));
  });

  it("keeps the dialog open and shows an error when Supabase category create fails", async () => {
    mocks.createServiceCategory.mockRejectedValueOnce(new Error("Supabase write failed"));
    const onOpenChange = vi.fn();
    render(<ServiceCategoryDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText(/Category name/i), {
      target: { value: "Broken Category" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create category/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Supabase write failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save", variant: "destructive" }),
    );
  });

  it("awaits Supabase category update before closing", async () => {
    const onOpenChange = vi.fn();
    render(
      <ServiceCategoryDialog
        open
        onOpenChange={onOpenChange}
        category={{
          id: "svc_cat_1",
          companyId: "cmp_stad",
          name: "Old Category",
          sortOrder: 0,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Category name/i), {
      target: { value: "Updated Category" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(mocks.updateServiceCategory).toHaveBeenCalledWith({
        categoryId: "svc_cat_1",
        patch: { name: "Updated Category", description: undefined, categoryType: undefined },
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.createServiceCategory).not.toHaveBeenCalled();
  });
});
