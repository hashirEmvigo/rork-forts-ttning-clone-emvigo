import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/data/supabaseCustomerProtocolRepository", () => ({
  supabaseCustomerProtocolRepository: {
    listByCustomer: vi.fn(),
    getByLegacyId: vi.fn(),
  },
}));

vi.mock("@/lib/customerProtocolStore", () => ({
  getCustomerProtocols: vi.fn(),
  getCustomerProtocol: vi.fn(),
}));

import { supabaseCustomerProtocolRepository } from "@/lib/data/supabaseCustomerProtocolRepository";
import * as legacyCustomerProtocolStore from "@/lib/customerProtocolStore";
import {
  useCustomerProtocolDetailReadModel,
  useCustomerProtocolReadModel,
} from "./use-customer-protocol-read-model";
import type { CustomerProtocolAggregate } from "@/lib/data/supabaseCustomerProtocolRepository";

const COMPANY = "company-a";
const CUSTOMER = "customer-1";

const repositoryMock = vi.mocked(supabaseCustomerProtocolRepository);
const legacyStore = vi.mocked(legacyCustomerProtocolStore);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function aggregate(id = "cprot_1"): CustomerProtocolAggregate {
  return {
    protocol: {
      id,
      companyId: COMPANY,
      customerId: CUSTOMER,
      sourceTemplateId: "ctpl_1",
      sourceTemplateName: "Supabase Template",
      sourceTemplateVersion: 1,
      name: "Supabase Protocol",
      description: "Remote aggregate only.",
      categoryIds: ["cat_1", "cat_2"],
      floorPresetIds: ["floor_1"],
      isArchived: false,
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    sections: [
      {
        id: "cpsec_1",
        companyId: COMPANY,
        customerId: CUSTOMER,
        customerProtocolId: id,
        title: "Entry",
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    items: [
      {
        id: "cpitm_1",
        companyId: COMPANY,
        customerId: CUSTOMER,
        customerProtocolId: id,
        sectionId: "cpsec_1",
        title: "Mop floor",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "cpitm_2",
        companyId: COMPANY,
        customerId: CUSTOMER,
        customerProtocolId: id,
        sectionId: "cpsec_1",
        title: "Wipe surfaces",
        required: false,
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

beforeEach(() => {
  repositoryMock.listByCustomer.mockReset();
  repositoryMock.getByLegacyId.mockReset();
  repositoryMock.listByCustomer.mockResolvedValue([]);
  repositoryMock.getByLegacyId.mockResolvedValue(null);
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
});

describe("useCustomerProtocolReadModel", () => {
  it("returns an empty list when Supabase is empty", async () => {
    const { result } = renderHook(
      () => useCustomerProtocolReadModel(COMPANY, CUSTOMER),
      { wrapper },
    );

    await waitFor(() => expect(repositoryMock.listByCustomer).toHaveBeenCalledWith(
      COMPANY,
      CUSTOMER,
      { includeArchived: true },
    ));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.protocols).toEqual([]);
    expect(result.current.active).toEqual([]);
    expect(result.current.archived).toEqual([]);
  });

  it("maps Supabase aggregate list/count data", async () => {
    const remote = aggregate();
    repositoryMock.listByCustomer.mockResolvedValue([remote]);

    const { result } = renderHook(
      () => useCustomerProtocolReadModel(COMPANY, CUSTOMER),
      { wrapper },
    );

    await waitFor(() => expect(result.current.active).toHaveLength(1));
    expect(result.current.active[0].name).toBe("Supabase Protocol");
    expect(result.current.counts[remote.protocol.id]).toEqual({
      categories: 2,
      floorPresets: 1,
      sections: 1,
      items: 2,
    });
  });

  it("does not read browser storage or call the legacy customer protocol store", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderHook(() => useCustomerProtocolReadModel(COMPANY, CUSTOMER), { wrapper });
    await waitFor(() => expect(repositoryMock.listByCustomer).toHaveBeenCalled());

    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.getCustomerProtocols).not.toHaveBeenCalled();
    expect(legacyStore.getCustomerProtocol).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("scopes list reads by company and customer", async () => {
    renderHook(() => useCustomerProtocolReadModel(COMPANY, CUSTOMER), { wrapper });

    await waitFor(() => expect(repositoryMock.listByCustomer).toHaveBeenCalledWith(
      COMPANY,
      CUSTOMER,
      { includeArchived: true },
    ));
  });
});

describe("useCustomerProtocolDetailReadModel", () => {
  it("returns null when a Supabase detail row is missing", async () => {
    const { result } = renderHook(
      () => useCustomerProtocolDetailReadModel(COMPANY, CUSTOMER, "missing"),
      { wrapper },
    );

    await waitFor(() => expect(repositoryMock.getByLegacyId).toHaveBeenCalledWith("missing", {
      companyId: COMPANY,
      customerId: CUSTOMER,
      includeArchived: true,
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.aggregate).toBeNull();
    expect(result.current.protocol).toBeNull();
    expect(result.current.counts).toBeNull();
  });
});
