import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  loadCompanyUuidMap: vi.fn(),
  makeId: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "customers") throw new Error(`Unexpected table ${table}`);
      return {
        upsert: mocks.upsert,
        update: mocks.update,
        select: mocks.select,
      };
    }),
    rpc: mocks.rpc,
  },
}));

vi.mock("@/lib/store", () => ({
  makeId: mocks.makeId,
  saveCustomers: vi.fn(),
}));

vi.mock("./customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

vi.mock("@/lib/data/customerDualWrite", () => ({
  mirrorCustomerWrites: vi.fn(),
}));

import { saveCustomers } from "@/lib/store";
import { mirrorCustomerWrites } from "@/lib/data/customerDualWrite";
import {
  archiveCustomerInSupabase,
  createCustomerInSupabase,
  restoreCustomerInSupabase,
  updateCustomerInSupabase,
} from "./supabaseCustomerRepository";

const COMPANY = "cmp_stad";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";

/** Queues the next allocate_number RPC result (the issued visible number). */
function setupAllocateNumber(issued: number): void {
  mocks.rpc.mockResolvedValueOnce({ data: issued, error: null });
}

function setupDetailRead(data: Record<string, unknown> | null): void {
  mocks.select.mockReturnValueOnce({ eq: mocks.eq });
  mocks.eq.mockReturnValueOnce({ maybeSingle: mocks.maybeSingle });
  mocks.maybeSingle.mockResolvedValueOnce({ data, error: null });
}

function setupLifecycleUpdate(error: { message: string } | null = null): void {
  mocks.update.mockReturnValueOnce({ eq: mocks.eq });
  mocks.eq.mockReturnValueOnce({ eq: mocks.eq });
  mocks.eq.mockReturnValueOnce({ is: mocks.is });
  mocks.is.mockResolvedValueOnce({ error });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([[COMPANY, COMPANY_UUID]]));
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.update.mockResolvedValue({ error: null });
  mocks.makeId
    .mockReturnValueOnce("cust_new")
    .mockReturnValueOnce("con_new")
    .mockReturnValue("id_extra");
});

describe("supabaseCustomerRepository CORE-WRITES-CUSTOMERS-A1.1", () => {
  it("creates company-scoped customers with a DB-allocated number and no browser storage", async () => {
    setupAllocateNumber(1);
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const saved = await createCustomerInSupabase({
      companyId: COMPANY,
      name: "  Smoke Customer  ",
      email: " contact@example.com ",
      phone: " +46 70 123 45 67 ",
      customerType: "commercial",
      areaId: "area_1",
      area: "Stockholm",
      postalCityId: "pcity_1",
      ownerId: "emp_1",
      userIds: ["usr_existing"],
      startOnboarding: true,
    });

    expect(saved.id).toBe("cust_new");
    expect(saved.companyId).toBe(COMPANY);
    expect(saved.customerNumber).toBe("C-1");
    expect(saved.customerSegment).toBe("b2b");
    expect(saved.contacts?.[0]).toMatchObject({ id: "con_new", isPrimary: true });
    // The visible number comes from the durable allocator, never MAX(existing)+1:
    // allocate_number is called for this company's 'customer' series, and no
    // summary read (the old MAX+1 path) runs during create.
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("allocate_number", {
      p_company_scope: COMPANY,
      p_entity_kind: "customer",
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "cust_new",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_number: "C-1",
      name: "Smoke Customer",
      email: "contact@example.com",
      status: "active",
      customer_type: "commercial",
      area_id: "area_1",
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      id: "cust_new",
      companyId: COMPANY,
      name: "Smoke Customer",
      customerNumber: "C-1",
      customerType: "commercial",
      userIds: ["usr_existing"],
      onboardingStatus: "in_progress",
    });
    expect(mocks.upsert.mock.calls[0][1]).toEqual({ onConflict: "legacy_id" });
    expect(saveCustomers).not.toHaveBeenCalled();
    expect(mirrorCustomerWrites).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("allocates monotonic, company-scoped numbers and never reuses a freed one", async () => {
    // Company A: first create issues 1, second issues 2. The allocator is the
    // single authority; the repository simply formats the value it returns.
    setupAllocateNumber(1);
    const first = await createCustomerInSupabase({
      companyId: COMPANY,
      name: "First A",
      email: "first-a@example.com",
      customerType: "commercial",
    });
    expect(first.customerNumber).toBe("C-1");

    setupAllocateNumber(2);
    const second = await createCustomerInSupabase({
      companyId: COMPANY,
      name: "Second A",
      email: "second-a@example.com",
      customerType: "commercial",
    });
    expect(second.customerNumber).toBe("C-2");

    // Deleting customer 2 never frees its number: the allocator's high-water mark
    // only moves forward, so the next create issues 3 (the gap is intentional).
    setupAllocateNumber(3);
    const third = await createCustomerInSupabase({
      companyId: COMPANY,
      name: "Third A",
      email: "third-a@example.com",
      customerType: "commercial",
    });
    expect(third.customerNumber).toBe("C-3");

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "allocate_number", {
      p_company_scope: COMPANY,
      p_entity_kind: "customer",
    });
  });

  it("starts each company's customer series independently (Company B begins at 1)", async () => {
    const OTHER_COMPANY = "cmp_other";
    const OTHER_UUID = "00000000-0000-4000-8000-000000000002";
    mocks.loadCompanyUuidMap.mockResolvedValue(
      new Map([
        [COMPANY, COMPANY_UUID],
        [OTHER_COMPANY, OTHER_UUID],
      ]),
    );

    setupAllocateNumber(1);
    const a = await createCustomerInSupabase({
      companyId: COMPANY,
      name: "Company A customer",
      email: "a@example.com",
      customerType: "commercial",
    });
    expect(a.customerNumber).toBe("C-1");

    setupAllocateNumber(1);
    const b = await createCustomerInSupabase({
      companyId: OTHER_COMPANY,
      name: "Company B customer",
      email: "b@example.com",
      customerType: "commercial",
    });
    expect(b.customerNumber).toBe("C-1");

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "allocate_number", {
      p_company_scope: OTHER_COMPANY,
      p_entity_kind: "customer",
    });
  });

  it("surfaces a clear error when number allocation fails and never inserts", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "allocate denied" } });

    await expect(
      createCustomerInSupabase({
        companyId: COMPANY,
        name: "No Number",
        email: "no-number@example.com",
        customerType: "commercial",
      }),
    ).rejects.toThrow(/allocation failed: allocate denied/i);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid allocated value rather than minting a bad number", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 0, error: null });

    await expect(
      createCustomerInSupabase({
        companyId: COMPANY,
        name: "Bad Number",
        email: "bad-number@example.com",
        customerType: "commercial",
      }),
    ).rejects.toThrow(/invalid value/i);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("fails closed when a company-scoped customer has no Supabase company UUID", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());

    await expect(
      createCustomerInSupabase({
        companyId: COMPANY,
        name: "Blocked Customer",
        email: "blocked@example.com",
        customerType: "commercial",
      }),
    ).rejects.toThrow(/No Supabase company found/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("updates customers only after exact company scope and preserves structural fields", async () => {
    setupDetailRead({
      company_legacy_id: COMPANY,
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: COMPANY,
        name: "Old Customer",
        customerNumber: "C-1042",
        email: "old@example.com",
        status: "active",
        customerType: "private",
        customerSegment: "b2c",
        userIds: ["usr_existing"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const updated = await updateCustomerInSupabase(COMPANY, "cust_existing", {
      name: " Updated Customer ",
      email: " updated@example.com ",
      customerType: "one_time",
      areaId: "area_2",
      ownerId: "emp_2",
    });

    expect(updated).toMatchObject({
      id: "cust_existing",
      companyId: COMPANY,
      name: "Updated Customer",
      email: "updated@example.com",
      customerNumber: "C-1042",
      status: "active",
      customerType: "one_time",
      customerSegment: "one_time",
      userIds: ["usr_existing"],
    });
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "cust_existing",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_number: "C-1042",
      name: "Updated Customer",
      email: "updated@example.com",
      customer_type: "one_time",
      area_id: "area_2",
    });
  });

  it("updates profile, address, contact-person and card log fields in the JSON payload", async () => {
    setupDetailRead({
      company_legacy_id: COMPANY,
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: COMPANY,
        name: "Old Customer",
        customerNumber: "C-1042",
        email: "old@example.com",
        status: "active",
        customerType: "commercial",
        customerSegment: "b2b",
        tags: ["Legacy"],
        userIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const updated = await updateCustomerInSupabase(COMPANY, "cust_existing", {
      tags: [" Priority ", "", " Office "],
      mainContact: "  Jane Manager ",
      addresses: [
        {
          id: "addr_1",
          label: " HQ ",
          street: " Main St 1 ",
          postalCode: " 5000 ",
          postalCityId: " pcity_1 ",
          country: " Norway ",
          isInvoice: true,
          isDelivery: false,
        },
      ],
      contacts: [
        {
          id: "con_1",
          name: " Jane Manager ",
          email: " jane@example.com ",
          phone: " +47 1 ",
          isPrimary: true,
          isContactPerson: false,
          isInvoiceResponsible: true,
          isAgreementResponsible: true,
        },
        {
          id: "con_2",
          name: " John Backup ",
          email: " john@example.com ",
          isPrimary: true,
          isInvoiceResponsible: true,
          isAgreementResponsible: true,
        },
      ],
      cardLog: [
        {
          id: "clog_1",
          at: "2026-02-01T00:00:00.000Z",
          section: "Contact information",
          field: "Tags",
          changeType: "admin_change",
          oldValue: "Legacy",
          newValue: "Priority, Office",
          changedById: "usr_admin",
          changedByName: "Admin",
          changedByRole: "company_admin",
          source: "admin_portal",
        },
      ],
    });

    expect(updated.tags).toEqual(["Priority", "Office"]);
    expect(updated.mainContact).toBe("Jane Manager");
    expect(updated.addresses?.[0]).toMatchObject({
      label: "HQ",
      street: "Main St 1",
      postalCode: "5000",
      postalCityId: "pcity_1",
      country: "Norway",
      isInvoice: true,
      isDelivery: false,
    });
    expect(updated.contacts).toHaveLength(2);
    expect(updated.contacts?.filter((contact) => contact.isPrimary)).toHaveLength(1);
    expect(updated.contacts?.filter((contact) => contact.isInvoiceResponsible)).toHaveLength(1);
    expect(updated.contacts?.filter((contact) => contact.isAgreementResponsible)).toHaveLength(1);
    expect(updated.contacts?.[0]).toMatchObject({
      name: "Jane Manager",
      email: "jane@example.com",
      phone: "+47 1",
      isPrimary: true,
      isContactPerson: true,
      isInvoiceResponsible: true,
      isAgreementResponsible: true,
    });
    expect(updated.contacts?.[1]).toMatchObject({
      name: "John Backup",
      email: "john@example.com",
      isPrimary: false,
      isInvoiceResponsible: false,
      isAgreementResponsible: false,
    });
    expect(updated.cardLog?.[0]).toMatchObject({ section: "Contact information", field: "Tags" });

    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "cust_existing",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_number: "C-1042",
      customer_type: "commercial",
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      tags: ["Priority", "Office"],
      mainContact: "Jane Manager",
      cardLog: [expect.objectContaining({ id: "clog_1" })],
    });
    expect(saveCustomers).not.toHaveBeenCalled();
    expect(mirrorCustomerWrites).not.toHaveBeenCalled();
  });

  it("updates card notes, internal notes and scheduling preferences in the JSON payload only", async () => {
    setupDetailRead({
      company_legacy_id: COMPANY,
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: COMPANY,
        name: "Old Customer",
        customerNumber: "C-1042",
        email: "old@example.com",
        status: "active",
        customerType: "commercial",
        customerSegment: "b2b",
        userIds: ["usr_portal"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const updated = await updateCustomerInSupabase(COMPANY, "cust_existing", {
      internalNotes: [
        {
          id: "inote_1",
          text: "  Internal text  ",
          authorId: null,
          authorName: "  Admin  ",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      cardNotes: [
        {
          id: "cnote_1",
          type: "admin",
          title: "  Card title  ",
          content: "  Card content  ",
          authorId: null,
          authorName: "  Admin  ",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
          status: "active",
        },
      ],
      schedulingPreferences: {
        preferredDays: [
          {
            id: "day_1",
            day: "monday",
            optimalStartTime: "09:00",
            optimalEndTime: "11:00",
            acceptableStartTime: "09:00",
            acceptableEndTime: "11:00",
            startTime: "09:00",
            endTime: "11:00",
          },
        ],
        secondaryDays: [],
        absencePriority: [
          "regular_employee_within_interval",
          "regular_employee_outside_interval",
          "regular_day_substitute_employee",
          "skip_visit_wait_regular_employee",
        ],
        schedulingNotes: "  Customer prefers mornings.  ",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
      cardLog: [
        {
          id: "clog_1",
          at: "2026-02-01T00:00:00.000Z",
          section: "Notes",
          changeType: "admin_change",
          oldValue: "0 note(s)",
          newValue: "1 note(s)",
          changedById: "usr_admin",
          changedByName: "Admin",
          changedByRole: "company_admin",
          source: "admin_portal",
        },
      ],
    });

    expect(updated.userIds).toEqual(["usr_portal"]);
    expect(updated.internalNotes?.[0]).toMatchObject({ text: "Internal text", authorName: "Admin" });
    expect(updated.cardNotes?.[0]).toMatchObject({
      title: "Card title",
      content: "Card content",
      authorId: null,
      authorName: "Admin",
      status: "active",
    });
    expect(updated.schedulingPreferences).toMatchObject({
      preferredDays: [
        expect.objectContaining({
          id: "day_1",
          day: "monday",
          optimalStartTime: "09:00",
          optimalEndTime: "11:00",
          acceptableStartTime: "09:00",
          acceptableEndTime: "11:00",
        }),
      ],
      secondaryDays: [],
      absencePriority: [
        "regular_employee_within_interval",
        "regular_employee_outside_interval",
        "regular_day_substitute_employee",
        "skip_visit_wait_regular_employee",
      ],
      schedulingNotes: "Customer prefers mornings.",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "cust_existing",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_number: "C-1042",
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      id: "cust_existing",
      userIds: ["usr_portal"],
      cardNotes: [expect.objectContaining({ title: "Card title" })],
      schedulingPreferences: expect.objectContaining({ schedulingNotes: "Customer prefers mornings." }),
      cardLog: [expect.objectContaining({ id: "clog_1" })],
    });
    expect(saveCustomers).not.toHaveBeenCalled();
    expect(mirrorCustomerWrites).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("persists V2 scheduling preferences losslessly into customers.data", async () => {
    setupDetailRead({
      company_legacy_id: COMPANY,
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: COMPANY,
        name: "Old Customer",
        customerNumber: "C-1042",
        email: "old@example.com",
        status: "active",
        customerType: "commercial",
        customerSegment: "b2b",
        schedulingPreferences: {
          preferredDays: [
            {
              id: "legacy_preferred",
              day: "monday",
              optimalStartTime: "09:00",
              optimalEndTime: "12:00",
              acceptableStartTime: "08:00",
              acceptableEndTime: "15:00",
            },
          ],
          secondaryDays: [
            {
              id: "legacy_secondary",
              day: "tuesday",
              optimalStartTime: "10:00",
              optimalEndTime: "12:00",
              acceptableStartTime: "09:00",
              acceptableEndTime: "14:00",
            },
          ],
          absencePriority: ["regular_day_substitute_employee"],
          schedulingNotes: "Legacy note",
        },
        userIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const updated = await updateCustomerInSupabase(COMPANY, "cust_existing", {
      schedulingPreferences: {
        version: 2,
        preferredRecurringWindows: [
          {
            id: "v2_preferred_monday",
            day: "monday",
            startTime: "08:30",
            endTime: "10:30",
            label: "Preferred recurring cleaning times",
            priority: 1,
          },
        ],
        acceptableRecurringWindows: [
          {
            id: "v2_acceptable_wednesday",
            day: "wednesday",
            startTime: "11:00",
            endTime: "14:00",
            label: "Acceptable recurring cleaning times",
            priority: 1,
          },
        ],
        acceptableTemporaryWindows: [
          {
            id: "v2_temporary_friday",
            day: "friday",
            startTime: "08:00",
            endTime: "16:00",
            label: "Acceptable temporary cleaning times",
            priority: 1,
          },
        ],
        temporaryReschedulingPriority: [
          "regular_day_substitute_employee",
          "regular_employee_within_interval",
          "regular_employee_outside_interval",
          "skip_visit_wait_regular_employee",
        ],
        preferredDays: [],
        secondaryDays: [],
        absencePriority: ["regular_day_substitute_employee"],
        absenceHandling: null,
        schedulingNotes: "  V2 saved note  ",
        updatedAt: "2026-06-06T10:00:00.000Z",
      },
    });

    expect(updated.schedulingPreferences).toMatchObject({
      version: 2,
      preferredRecurringWindows: [expect.objectContaining({ id: "v2_preferred_monday" })],
      acceptableRecurringWindows: [expect.objectContaining({ id: "v2_acceptable_wednesday" })],
      acceptableTemporaryWindows: [expect.objectContaining({ id: "v2_temporary_friday" })],
      temporaryReschedulingPriority: [
        "regular_day_substitute_employee",
        "regular_employee_within_interval",
        "regular_employee_outside_interval",
        "skip_visit_wait_regular_employee",
      ],
      schedulingNotes: "V2 saved note",
      updatedAt: "2026-06-06T10:00:00.000Z",
    });
    expect(updated.schedulingPreferences?.preferredDays).toEqual([]);
    expect(updated.schedulingPreferences?.secondaryDays).toEqual([]);

    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].data).toMatchObject({
      id: "cust_existing",
      schedulingPreferences: expect.objectContaining({
        version: 2,
        preferredRecurringWindows: [expect.objectContaining({ id: "v2_preferred_monday" })],
        acceptableRecurringWindows: [expect.objectContaining({ id: "v2_acceptable_wednesday" })],
        acceptableTemporaryWindows: [expect.objectContaining({ id: "v2_temporary_friday" })],
        temporaryReschedulingPriority: [
          "regular_day_substitute_employee",
          "regular_employee_within_interval",
          "regular_employee_outside_interval",
          "skip_visit_wait_regular_employee",
        ],
        preferredDays: [],
        secondaryDays: [],
      }),
    });
    expect(saveCustomers).not.toHaveBeenCalled();
    expect(mirrorCustomerWrites).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("rejects updates when the stored customer scope does not match the requested scope", async () => {
    setupDetailRead({
      company_legacy_id: "cmp_other",
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: "cmp_other",
        name: "Other Customer",
        customerNumber: "C-1001",
        email: "other@example.com",
        status: "active",
        userIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    await expect(
      updateCustomerInSupabase(COMPANY, "cust_existing", { name: "Blocked" }),
    ).rejects.toThrow(/not found/i);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("archives company-scoped customers in Supabase only without touching deleted_at or related data", async () => {
    setupDetailRead({
      company_legacy_id: COMPANY,
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: COMPANY,
        name: "Old Customer",
        customerNumber: "C-1042",
        email: "old@example.com",
        status: "active",
        customerType: "commercial",
        customerSegment: "b2b",
        userIds: ["usr_portal"],
        contacts: [{ id: "con_1", name: "Contact", isPrimary: true }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    setupLifecycleUpdate();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const archived = await archiveCustomerInSupabase(COMPANY, "cust_existing");

    expect(archived).toMatchObject({
      id: "cust_existing",
      companyId: COMPANY,
      status: "archived",
      userIds: ["usr_portal"],
      contacts: [{ id: "con_1", name: "Contact", isPrimary: true }],
    });
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const row = mocks.update.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      legacy_id: "cust_existing",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_number: "C-1042",
      status: "archived",
      deleted_at: null,
    });
    expect(row.data).toMatchObject({
      id: "cust_existing",
      status: "archived",
      userIds: ["usr_portal"],
      contacts: [{ id: "con_1", name: "Contact", isPrimary: true }],
    });
    expect(saveCustomers).not.toHaveBeenCalled();
    expect(mirrorCustomerWrites).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("restores archived company-scoped customers in Supabase only without touching deleted_at or related data", async () => {
    setupDetailRead({
      company_legacy_id: COMPANY,
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: COMPANY,
        name: "Old Customer",
        customerNumber: "C-1042",
        email: "old@example.com",
        status: "archived",
        archivedAt: "2026-06-01T00:00:00.000Z",
        customerType: "commercial",
        customerSegment: "b2b",
        userIds: ["usr_portal"],
        contacts: [{ id: "con_1", name: "Contact", isPrimary: true }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    });
    setupLifecycleUpdate();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const restored = await restoreCustomerInSupabase(COMPANY, "cust_existing");

    expect(restored).toMatchObject({
      id: "cust_existing",
      companyId: COMPANY,
      status: "active",
      archivedAt: null,
      userIds: ["usr_portal"],
      contacts: [{ id: "con_1", name: "Contact", isPrimary: true }],
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const row = mocks.update.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      legacy_id: "cust_existing",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_number: "C-1042",
      status: "active",
      deleted_at: null,
    });
    expect(row.data).toMatchObject({
      id: "cust_existing",
      status: "active",
      archivedAt: null,
      userIds: ["usr_portal"],
      contacts: [{ id: "con_1", name: "Contact", isPrimary: true }],
    });
    expect(saveCustomers).not.toHaveBeenCalled();
    expect(mirrorCustomerWrites).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed when archive scope does not match the stored customer", async () => {
    setupDetailRead({
      company_legacy_id: "cmp_other",
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: "cmp_other",
        name: "Other Customer",
        customerNumber: "C-1001",
        email: "other@example.com",
        status: "active",
        userIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    await expect(archiveCustomerInSupabase(COMPANY, "cust_existing")).rejects.toThrow(/not found/i);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("fails closed when restore scope does not match the stored customer", async () => {
    setupDetailRead({
      company_legacy_id: "cmp_other",
      deleted_at: null,
      data: {
        id: "cust_existing",
        companyId: "cmp_other",
        name: "Other Customer",
        customerNumber: "C-1001",
        email: "other@example.com",
        status: "archived",
        userIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    await expect(restoreCustomerInSupabase(COMPANY, "cust_existing")).rejects.toThrow(/not found/i);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("surfaces Supabase insert/update errors", async () => {
    setupAllocateNumber(1);
    mocks.upsert.mockResolvedValueOnce({ error: { message: "RLS blocked insert" } });

    await expect(
      createCustomerInSupabase({
        companyId: COMPANY,
        name: "Blocked Customer",
        email: "blocked@example.com",
        customerType: "commercial",
      }),
    ).rejects.toThrow(/RLS blocked insert/);
  });
});
