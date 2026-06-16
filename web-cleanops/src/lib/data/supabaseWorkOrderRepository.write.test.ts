const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  customerSelect: vi.fn(),
  customerEq: vi.fn(),
  customerMaybeSingle: vi.fn(),
  workOrderSelect: vi.fn(),
  workOrderNumberEq: vi.fn(),
  loadCompanyUuidMap: vi.fn(),
  makeId: vi.fn(),
  saveWorkOrders: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mocks.from,
  },
}));

vi.mock("@/lib/store", () => ({
  makeId: mocks.makeId,
  saveWorkOrders: mocks.saveWorkOrders,
}));

vi.mock("./customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

vi.mock("@/lib/data/workOrderDualWrite", () => ({
  mirrorWorkOrderWrites: mocks.mirrorWorkOrderWrites,
}));

import { saveWorkOrders } from "@/lib/store";
import { mirrorWorkOrderWrites } from "@/lib/data/workOrderDualWrite";
import { createWorkOrderInSupabase } from "./supabaseWorkOrderRepository";

const COMPANY = "cmp_stad";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000101";
const CUSTOMER_ID = "cust_1";

function setupSupabaseTables(): void {
  mocks.from.mockImplementation((table: string) => {
    if (table === "customers") {
      return { select: mocks.customerSelect };
    }
    if (table === "work_orders") {
      return { select: mocks.workOrderSelect, insert: mocks.insert };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.customerSelect.mockReturnValue({ eq: mocks.customerEq });
  mocks.customerEq.mockReturnValue({ maybeSingle: mocks.customerMaybeSingle });
  mocks.workOrderSelect.mockReturnValue({ eq: mocks.workOrderNumberEq });
}

function setupCustomerScope(companyId = COMPANY): void {
  mocks.customerMaybeSingle.mockResolvedValue({
    data: {
      company_legacy_id: companyId,
      deleted_at: null,
      data: {
        id: CUSTOMER_ID,
        companyId,
        name: "Bergen Offices",
        customerNumber: "C-1001",
        email: "office@example.com",
        status: "active",
        customerType: "commercial",
        customerSegment: "b2b",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupSupabaseTables();
  setupCustomerScope();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([[COMPANY, COMPANY_UUID]]));
  mocks.workOrderNumberEq.mockResolvedValue({
    data: [{ number: "WO-1001" }, { number: "WO-1004" }],
    error: null,
  });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.makeId.mockImplementation((prefix: string) => `${prefix}_generated`);
} );

describe("CORE-WRITES-WORKORDERS-A1.1 Supabase work-order create", () => {
  it("inserts a company/customer-scoped parent work order row only", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const created = await createWorkOrderInSupabase({
      companyId: COMPANY,
      customerId: CUSTOMER_ID,
      title: "  First AO  ",
      status: "planned",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-30T00:00:00.000Z",
      createdBy: "usr_admin",
      createdByName: "Admin User",
    });

    expect(created).toMatchObject({
      id: "wo_generated",
      companyId: COMPANY,
      customerId: CUSTOMER_ID,
      number: "WO-1005",
      title: "First AO",
      status: "planned",
      createdBy: "usr_admin",
      createdByName: "Admin User",
      serviceRows: [],
      notes: [],
      mediaPlacements: [],
    });
    expect(mocks.from).toHaveBeenCalledWith("customers");
    expect(mocks.from).toHaveBeenCalledWith("work_orders");
    expect(mocks.from).not.toHaveBeenCalledWith("work_order_service_rows");
    expect(mocks.from).not.toHaveBeenCalledWith("work_order_occurrence_exceptions");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const rows = mocks.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legacy_id: "wo_generated",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_legacy_id: CUSTOMER_ID,
      customer_display_name: "Bergen Offices",
      number: "WO-1005",
      title: "First AO",
      status: "planned",
      start_date: "2026-06-01T00:00:00.000Z",
      end_date: "2026-06-30T00:00:00.000Z",
      service_row_count: 0,
      created_by: "usr_admin",
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      id: "wo_generated",
      companyId: COMPANY,
      customerId: CUSTOMER_ID,
      serviceRows: [],
      activity: [
        expect.objectContaining({
          id: "woact_generated",
          action: "created",
          actorId: "usr_admin",
          actorName: "Admin User",
        }),
      ],
    });
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed when customer id is missing", async () => {
    await expect(
      createWorkOrderInSupabase({ companyId: COMPANY, customerId: "" }),
    ).rejects.toThrow(/customer id/i);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("fails closed when company scope is missing", async () => {
    await expect(
      createWorkOrderInSupabase({ companyId: " ", customerId: CUSTOMER_ID }),
    ).rejects.toThrow(/company context/i);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("fails closed when the customer does not belong to the target company", async () => {
    setupCustomerScope("cmp_other");

    await expect(
      createWorkOrderInSupabase({ companyId: COMPANY, customerId: CUSTOMER_ID }),
    ).rejects.toThrow(/Customer not found/);

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("fails closed when the target company has no Supabase UUID", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());

    await expect(
      createWorkOrderInSupabase({ companyId: COMPANY, customerId: CUSTOMER_ID }),
    ).rejects.toThrow(/No Supabase company found/);

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keeps Supabase authoritative when insert fails", async () => {
    mocks.insert.mockResolvedValueOnce({ error: { message: "RLS blocked insert" } });

    await expect(
      createWorkOrderInSupabase({ companyId: COMPANY, customerId: CUSTOMER_ID }),
    ).rejects.toThrow(/RLS blocked insert/);

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });
});
