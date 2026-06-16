import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CustomerProtocolBuilder } from "./CustomerProtocolBuilder";
import { useCustomerProtocolDetailReadModel } from "@/hooks/use-customer-protocol-read-model";
import * as legacyCustomerProtocolStore from "@/lib/customerProtocolStore";
import type { CustomerProtocolAggregate } from "@/lib/data/supabaseCustomerProtocolRepository";
import type { CustomerProtocolDetailReadModelResult } from "@/hooks/use-customer-protocol-read-model";
import type { CustomerProtocolV2 } from "@/types";

vi.mock("@/hooks/use-customer-protocol-read-model", () => ({
  useCustomerProtocolDetailReadModel: vi.fn(),
}));

vi.mock("@/lib/customerProtocolStore", () => ({
  createCustomerProtocolItem: vi.fn(),
  createCustomerProtocolSection: vi.fn(),
  deleteCustomerProtocolItem: vi.fn(),
  deleteCustomerProtocolSection: vi.fn(),
  getCustomerProtocolItems: vi.fn(),
  getCustomerProtocolSections: vi.fn(),
  reorderCustomerProtocolItems: vi.fn(),
  reorderCustomerProtocolSections: vi.fn(),
  updateCustomerProtocolItem: vi.fn(),
  updateCustomerProtocolSection: vi.fn(),
}));

const COMPANY = "company-a";
const CUSTOMER = "customer-1";
const PROTOCOL_ID = "cprot_remote_1";

const detailReadModelMock = vi.mocked(useCustomerProtocolDetailReadModel);
const legacyStore = vi.mocked(legacyCustomerProtocolStore);

function protocolFixture(): CustomerProtocolV2 {
  return {
    id: PROTOCOL_ID,
    companyId: COMPANY,
    customerId: CUSTOMER,
    sourceTemplateId: "ctpl_prop",
    sourceTemplateName: "Prop template ignored",
    sourceTemplateVersion: 1,
    name: "Prop protocol ignored for display",
    description: "This prop should not drive detail display.",
    categoryIds: [],
    floorPresetIds: [],
    isArchived: false,
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function aggregateFixture(): CustomerProtocolAggregate {
  return {
    protocol: {
      id: PROTOCOL_ID,
      companyId: COMPANY,
      customerId: CUSTOMER,
      sourceTemplateId: "ctpl_remote_1",
      sourceTemplateName: "Supabase Template",
      sourceTemplateVersion: 1,
      name: "Supabase Detail Protocol",
      description: "Remote protocol aggregate only.",
      categoryIds: ["cat_1", "cat_2"],
      floorPresetIds: ["floor_1"],
      isArchived: false,
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    sections: [
      {
        id: "cpsec_remote_1",
        companyId: COMPANY,
        customerId: CUSTOMER,
        customerProtocolId: PROTOCOL_ID,
        title: "Conference Rooms",
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    items: [
      {
        id: "cpitm_remote_1",
        companyId: COMPANY,
        customerId: CUSTOMER,
        customerProtocolId: PROTOCOL_ID,
        sectionId: "cpsec_remote_1",
        title: "Sanitize table",
        description: "Use conference-room checklist spray.",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "cpitm_remote_2",
        companyId: COMPANY,
        customerId: CUSTOMER,
        customerProtocolId: PROTOCOL_ID,
        sectionId: "cpsec_remote_1",
        title: "Align chairs",
        required: false,
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function mockDetailReadModel(
  partial: Partial<CustomerProtocolDetailReadModelResult> = {},
): CustomerProtocolDetailReadModelResult {
  const aggregate = partial.aggregate ?? null;
  const result: CustomerProtocolDetailReadModelResult = {
    aggregate,
    protocol: aggregate?.protocol ?? null,
    counts: aggregate
      ? {
          categories: aggregate.protocol.categoryIds.length,
          floorPresets: aggregate.protocol.floorPresetIds.length,
          sections: aggregate.sections.length,
          items: aggregate.items.length,
        }
      : null,
    isLoading: false,
    error: null,
    ...partial,
  };
  detailReadModelMock.mockReturnValue(result);
  return result;
}

beforeEach(() => {
  cleanup();
  detailReadModelMock.mockReset();
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
  mockDetailReadModel();
});

describe("CustomerProtocolBuilder — Supabase read-only detail cutover", () => {
  it("renders detail content from the Supabase aggregate", () => {
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });

    render(
      <CustomerProtocolBuilder
        companyId={COMPANY}
        customerId={CUSTOMER}
        protocol={protocolFixture()}
        canManage
        onBack={() => {}}
      />,
    );

    expect(detailReadModelMock).toHaveBeenCalledWith(COMPANY, CUSTOMER, PROTOCOL_ID);
    expect(screen.getByRole("heading", { name: remote.protocol.name })).toBeInTheDocument();
    expect(screen.getByText("Remote protocol aggregate only.")).toBeInTheDocument();
    expect(screen.getByText("From template: Supabase Template")).toBeInTheDocument();
    expect(screen.getByText("Conference Rooms")).toBeInTheDocument();
    expect(screen.getByText("Sanitize table")).toBeInTheDocument();
    expect(screen.getByText("Align chairs")).toBeInTheDocument();
    expect(screen.queryByText("Prop protocol ignored for display")).not.toBeInTheDocument();
  });

  it("shows unavailable state when Supabase detail is missing", () => {
    mockDetailReadModel({ aggregate: null, protocol: null, counts: null });

    render(
      <CustomerProtocolBuilder
        companyId={COMPANY}
        customerId={CUSTOMER}
        protocol={protocolFixture()}
        canManage
        onBack={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Protocol unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/No legacy protocol fallback is available/i)).toBeInTheDocument();
  });

  it("does not read browser storage or call the legacy customer protocol store", () => {
    localStorage.setItem(
      "cleanops.customerProtocols",
      JSON.stringify([{ id: PROTOCOL_ID, name: "Ignored local protocol" }]),
    );
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });

    render(
      <CustomerProtocolBuilder
        companyId={COMPANY}
        customerId={CUSTOMER}
        protocol={protocolFixture()}
        canManage
        onBack={() => {}}
      />,
    );

    expect(screen.queryByText("Ignored local protocol")).not.toBeInTheDocument();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.getCustomerProtocolSections).not.toHaveBeenCalled();
    expect(legacyStore.getCustomerProtocolItems).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("disables deferred mutation actions so they cannot write to legacy storage", () => {
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(
      <CustomerProtocolBuilder
        companyId={COMPANY}
        customerId={CUSTOMER}
        protocol={protocolFixture()}
        canManage
        onBack={() => {}}
      />,
    );

    const editContentButton = screen.getByRole("button", { name: /edit content/i });
    expect(editContentButton).toBeDisabled();
    fireEvent.click(editContentButton);

    expect(screen.getByText(/Editing is temporarily disabled during Supabase cutover/i)).toBeInTheDocument();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.createCustomerProtocolSection).not.toHaveBeenCalled();
    expect(legacyStore.updateCustomerProtocolSection).not.toHaveBeenCalled();
    expect(legacyStore.deleteCustomerProtocolSection).not.toHaveBeenCalled();
    expect(legacyStore.createCustomerProtocolItem).not.toHaveBeenCalled();
    expect(legacyStore.updateCustomerProtocolItem).not.toHaveBeenCalled();
    expect(legacyStore.deleteCustomerProtocolItem).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("keeps the back control working", () => {
    const remote = aggregateFixture();
    const onBack = vi.fn();
    mockDetailReadModel({ aggregate: remote });

    render(
      <CustomerProtocolBuilder
        companyId={COMPANY}
        customerId={CUSTOMER}
        protocol={protocolFixture()}
        canManage={false}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /all protocols/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
