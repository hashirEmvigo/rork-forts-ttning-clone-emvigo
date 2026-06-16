import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { CustomerProtocolsPanel } from "./CustomerProtocolsPanel";
import { useCustomerProtocolReadModel } from "@/hooks/use-customer-protocol-read-model";
import * as legacyCustomerProtocolStore from "@/lib/customerProtocolStore";
import type { CustomerProtocolReadModelResult } from "@/hooks/use-customer-protocol-read-model";
import type { CustomerProtocolV2 } from "@/types";

vi.mock("@/hooks/use-customer-protocol-read-model", () => ({
  useCustomerProtocolReadModel: vi.fn(),
}));

vi.mock("@/lib/customerProtocolStore", () => ({
  getCustomerProtocols: vi.fn(),
  updateCustomerProtocol: vi.fn(),
  archiveCustomerProtocol: vi.fn(),
  restoreCustomerProtocol: vi.fn(),
}));

const COMPANY = "company-a";
const CUSTOMER = "customer-1";

const readModelMock = vi.mocked(useCustomerProtocolReadModel);
const legacyStore = vi.mocked(legacyCustomerProtocolStore);

function protocol(overrides: Partial<CustomerProtocolV2> = {}): CustomerProtocolV2 {
  return {
    id: "cprot_supabase_1",
    companyId: COMPANY,
    customerId: CUSTOMER,
    sourceTemplateId: "ctpl_supabase_1",
    sourceTemplateName: "Supabase Source Template",
    sourceTemplateVersion: 1,
    name: "Bergen – Supabase Recurring",
    description: "Read from the protocol aggregate.",
    categoryIds: ["cat_room", "cat_task"],
    floorPresetIds: ["floor_office"],
    isArchived: false,
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockReadModel(
  partial: Partial<CustomerProtocolReadModelResult> = {},
): CustomerProtocolReadModelResult {
  const active = partial.active ?? [];
  const archived = partial.archived ?? [];
  const result: CustomerProtocolReadModelResult = {
    aggregates: [],
    protocols: [...active, ...archived],
    active,
    archived,
    counts: {},
    isLoading: false,
    error: null,
    ...partial,
  };
  readModelMock.mockReturnValue(result);
  return result;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  readModelMock.mockReset();
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
  mockReadModel();
});

describe("CustomerProtocolsPanel — Supabase read-model cutover", () => {
  it("renders an empty state from an empty Supabase customer protocol list", () => {
    localStorage.setItem(
      "cleanops.customerProtocolsV2",
      JSON.stringify([protocol({ name: "Ignored browser residue" })]),
    );
    mockReadModel({ active: [], archived: [], protocols: [] });

    render(
      <CustomerProtocolsPanel companyId={COMPANY} customerId={CUSTOMER} canManage />,
    );

    expect(readModelMock).toHaveBeenCalledWith(COMPANY, CUSTOMER);
    expect(screen.getByText(/No protocols yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Ignored browser residue")).not.toBeInTheDocument();
    expect(legacyStore.getCustomerProtocols).not.toHaveBeenCalled();
  });

  it("renders protocol list/count data from the Supabase aggregate read model", () => {
    const supabaseProtocol = protocol();
    mockReadModel({
      active: [supabaseProtocol],
      protocols: [supabaseProtocol],
      counts: {
        [supabaseProtocol.id]: {
          categories: 2,
          floorPresets: 1,
          sections: 3,
          items: 9,
        },
      },
    });

    render(
      <CustomerProtocolsPanel companyId={COMPANY} customerId={CUSTOMER} canManage />,
    );

    const row = screen.getByText(supabaseProtocol.name).closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(/From template: Supabase Source Template/i)).toBeInTheDocument();
    expect(within(row!).getByText("3 sections")).toBeInTheDocument();
    expect(within(row!).getByText("9 items")).toBeInTheDocument();
    expect(within(row!).getByText("2 categories")).toBeInTheDocument();
    expect(within(row!).getByText("1 floor presets")).toBeInTheDocument();
  });

  it("disables deferred write actions so Supabase reads cannot mix with legacy writes", () => {
    const supabaseProtocol = protocol();
    mockReadModel({
      active: [supabaseProtocol],
      protocols: [supabaseProtocol],
      counts: { [supabaseProtocol.id]: { categories: 0, floorPresets: 0, sections: 0, items: 0 } },
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(
      <CustomerProtocolsPanel companyId={COMPANY} customerId={CUSTOMER} canManage />,
    );

    const newButton = screen.getByRole("button", { name: /New protocol/i });
    const editContentButton = screen.getByRole("button", { name: /Edit content/i });
    const editButton = screen.getByRole("button", { name: new RegExp(`Edit ${supabaseProtocol.name}`) });
    const archiveButton = screen.getByRole("button", { name: new RegExp(`Archive ${supabaseProtocol.name}`) });

    expect(newButton).toBeDisabled();
    expect(editContentButton).toBeDisabled();
    expect(editButton).toBeDisabled();
    expect(archiveButton).toBeDisabled();
    fireEvent.click(newButton);
    fireEvent.click(editContentButton);
    fireEvent.click(editButton);
    fireEvent.click(archiveButton);

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.updateCustomerProtocol).not.toHaveBeenCalled();
    expect(legacyStore.archiveCustomerProtocol).not.toHaveBeenCalled();
    expect(legacyStore.restoreCustomerProtocol).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("hides management controls for read-only users", () => {
    mockReadModel({ active: [protocol()], protocols: [protocol()] });

    render(
      <CustomerProtocolsPanel
        companyId={COMPANY}
        customerId={CUSTOMER}
        canManage={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /New protocol/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit content/i })).not.toBeInTheDocument();
  });
});
