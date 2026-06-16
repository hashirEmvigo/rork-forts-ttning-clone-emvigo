import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";

import type { Customer, WorkOrder } from "@/types";

const mocks = vi.hoisted(() => ({
  updateCustomer: vi.fn(),
  localUpdateCustomer: vi.fn(),
  hydrateCustomerFromRemote: vi.fn(),
  addWorkOrderNote: vi.fn(),
  updateWorkOrderNote: vi.fn(),
  setWorkOrderNoteArchived: vi.fn(),
  saveCustomers: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  mirrorUserWrites: vi.fn(),
  createProfile: vi.fn(),
  toast: vi.fn(),
  makeId: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: {
      id: "usr_admin",
      name: "Admin User",
      role: "company_admin",
      companyId: "cmp_stad",
      email: "admin@example.com",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    hasPermission: mocks.hasPermission,
    updateCustomer: mocks.localUpdateCustomer,
    hydrateCustomerFromRemote: mocks.hydrateCustomerFromRemote,
    addWorkOrderNote: mocks.addWorkOrderNote,
    updateWorkOrderNote: mocks.updateWorkOrderNote,
    setWorkOrderNoteArchived: mocks.setWorkOrderNoteArchived,
  }),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({
    createCustomer: vi.fn(),
    updateCustomer: mocks.updateCustomer,
    archiveCustomer: vi.fn(),
    restoreCustomer: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/store", () => ({
  makeId: mocks.makeId,
  saveCustomers: mocks.saveCustomers,
}));

vi.mock("@/lib/data/customerDualWrite", () => ({
  mirrorCustomerWrites: mocks.mirrorCustomerWrites,
}));

vi.mock("@/lib/data/userDualWrite", () => ({
  mirrorUserWrites: mocks.mirrorUserWrites,
}));

vi.mock("@/lib/profile", () => ({
  createProfile: mocks.createProfile,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) => (
    <input
      aria-label="Show archived notes"
      type="checkbox"
      checked={checked ?? false}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

import { WorkOrderNotesSection } from "./WorkOrderDetails";

const baseCustomer: Customer = {
  id: "cust_1",
  companyId: "cmp_stad",
  name: "Acme Offices",
  customerNumber: "C-1001",
  email: "contact@example.com",
  status: "active",
  userIds: [],
  cardNotes: [
    {
      id: "note_admin",
      type: "admin",
      title: "Customer title",
      content: "Customer content",
      authorId: "usr_old",
      authorName: "Old Admin",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    },
    {
      id: "note_finance",
      type: "finance",
      title: "Finance title",
      content: "Finance content",
      authorId: "usr_old",
      authorName: "Old Admin",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      status: "active",
    },
    {
      id: "note_finance_archived",
      type: "finance",
      title: "Archived finance title",
      content: "Archived finance content",
      authorId: "usr_old",
      authorName: "Old Admin",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      status: "inactive",
    },
  ],
  cardLog: [
    {
      id: "clog_existing",
      at: "2026-01-01T00:00:00.000Z",
      section: "Notes",
      changeType: "admin_change",
      oldValue: "0 note(s)",
      newValue: "1 note(s)",
      changedById: "usr_old",
      changedByName: "Old Admin",
      changedByRole: "company_admin",
      source: "admin_portal",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseOrder: WorkOrder = {
  id: "wo_1",
  companyId: "cmp_stad",
  customerId: "cust_1",
  number: "WO-1001",
  title: "Weekly cleaning",
  status: "planned",
  notes: [
    {
      id: "wonote_1",
      title: "Work order title",
      content: "Work order content",
      authorId: "usr_admin",
      authorName: "Admin User",
      createdAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
      status: "active",
    },
  ],
  serviceRows: [],
  activity: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderNotes(customer: Customer | null | undefined = baseCustomer): void {
  render(<WorkOrderNotesSection order={baseOrder} customer={customer} />);
}

function cardFor(title: string): HTMLElement {
  const card = screen.getByText(title).closest("section");
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

function expectNoLegacyCustomerPersistence(): void {
  expect(mocks.localUpdateCustomer).not.toHaveBeenCalled();
  expect(mocks.saveCustomers).not.toHaveBeenCalled();
  expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
  expect(mocks.mirrorUserWrites).not.toHaveBeenCalled();
  expect(mocks.createProfile).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.makeId.mockImplementation((prefix: string) => `${prefix}_generated`);
  mocks.updateCustomer.mockResolvedValue({ ...baseCustomer, updatedAt: "2026-06-05T00:00:00.000Z" });
  mocks.addWorkOrderNote.mockReturnValue({ ok: true });
  mocks.updateWorkOrderNote.mockReturnValue({ ok: true });
  mocks.setWorkOrderNoteArchived.mockReturnValue({ ok: true });
});

describe("CORE-WRITES-CUSTOMERS-A1.5.1 WorkOrderDetails customer/economic notes", () => {
  it("adds a customer note through the Supabase customer mutation only", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    renderNotes();

    const customerCard = cardFor("Customer Notes");
    fireEvent.click(within(customerCard).getByRole("button", { name: /add/i }));
    fireEvent.change(within(customerCard).getByPlaceholderText("Short title"), {
      target: { value: "  New customer note  " },
    });
    fireEvent.change(within(customerCard).getByPlaceholderText("Write the note…"), {
      target: { value: "  Customer body  " },
    });
    fireEvent.click(within(customerCard).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: "cmp_stad",
      patch: expect.objectContaining({
        cardNotes: expect.arrayContaining([
          expect.objectContaining({
            id: "cnote_generated",
            type: "admin",
            title: "New customer note",
            content: "Customer body",
            authorId: "usr_admin",
            authorName: "Admin User",
            status: "active",
          }),
        ]),
        cardLog: expect.arrayContaining([
          expect.objectContaining({
            id: "clog_generated",
            section: "Notes",
            changedById: "usr_admin",
            source: "admin_portal",
          }),
        ]),
      }),
    });
    expect(mocks.hydrateCustomerFromRemote).toHaveBeenCalledTimes(1);
    expect(mocks.addWorkOrderNote).not.toHaveBeenCalled();
    expect(mocks.updateWorkOrderNote).not.toHaveBeenCalled();
    expect(mocks.setWorkOrderNoteArchived).not.toHaveBeenCalled();
    expect(within(customerCard).queryByPlaceholderText("Short title")).not.toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("adds an economic note through the Supabase customer mutation only", async () => {
    renderNotes();

    const economicCard = cardFor("Economic Notes");
    fireEvent.click(within(economicCard).getByRole("button", { name: /add/i }));
    fireEvent.change(within(economicCard).getByPlaceholderText("Short title"), {
      target: { value: "  Billing note  " },
    });
    fireEvent.click(within(economicCard).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer.mock.calls[0][0].patch.cardNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cnote_generated", type: "finance", title: "Billing note" }),
      ]),
    );
    expect(mocks.updateCustomer.mock.calls[0][0].patch.cardLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ section: "Notes" })]),
    );
    expect(mocks.hydrateCustomerFromRemote).toHaveBeenCalledTimes(1);
    expectNoLegacyCustomerPersistence();
  });

  it("edits customer and economic notes through the Supabase customer mutation only", async () => {
    renderNotes();

    const customerCard = cardFor("Customer Notes");
    fireEvent.click(within(customerCard).getByRole("button", { name: /edit note/i }));
    fireEvent.change(within(customerCard).getByDisplayValue("Customer title"), {
      target: { value: "  Edited customer title  " },
    });
    fireEvent.click(within(customerCard).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer.mock.calls[0][0].patch.cardNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "note_admin", title: "Edited customer title", type: "admin" }),
      ]),
    );

    const economicCard = cardFor("Economic Notes");
    fireEvent.click(within(economicCard).getByRole("button", { name: /edit note/i }));
    fireEvent.change(within(economicCard).getByDisplayValue("Finance title"), {
      target: { value: "  Edited finance title  " },
    });
    fireEvent.click(within(economicCard).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(2));
    expect(mocks.updateCustomer.mock.calls[1][0].patch.cardNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "note_finance", title: "Edited finance title", type: "finance" }),
      ]),
    );
    expectNoLegacyCustomerPersistence();
  });

  it("archives and restores customer/economic notes through the Supabase customer mutation only", async () => {
    renderNotes();

    const customerCard = cardFor("Customer Notes");
    fireEvent.click(within(customerCard).getByRole("button", { name: /archive note/i }));
    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer.mock.calls[0][0].patch.cardNotes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "note_admin", status: "inactive" })]),
    );

    const economicCard = cardFor("Economic Notes");
    fireEvent.click(within(economicCard).getByLabelText("Show archived notes"));
    expect(within(economicCard).getByText("Archived finance title")).toBeInTheDocument();
    fireEvent.click(within(economicCard).getByRole("button", { name: /restore note/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(2));
    expect(mocks.updateCustomer.mock.calls[1][0].patch.cardNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "note_finance_archived", status: "active" }),
      ]),
    );
    expect(mocks.setWorkOrderNoteArchived).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
  });

  it("keeps the customer note composer open and shows an inline error when Supabase save fails", async () => {
    mocks.updateCustomer.mockRejectedValueOnce(new Error("Supabase customer note failed"));
    renderNotes({ ...baseCustomer, cardNotes: [] });

    const customerCard = cardFor("Customer Notes");
    fireEvent.click(within(customerCard).getByRole("button", { name: /add/i }));
    fireEvent.change(within(customerCard).getByPlaceholderText("Short title"), {
      target: { value: "Retry note" },
    });
    fireEvent.click(within(customerCard).getByRole("button", { name: /^save$/i }));

    expect(await within(customerCard).findByRole("alert")).toHaveTextContent("Supabase customer note failed");
    expect(within(customerCard).getByDisplayValue("Retry note")).toBeInTheDocument();
    expect(mocks.hydrateCustomerFromRemote).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
  });

  it("fails closed when customer or company scope is missing", async () => {
    renderNotes({ ...baseCustomer, companyId: "" });

    const customerCard = cardFor("Customer Notes");
    fireEvent.click(within(customerCard).getByRole("button", { name: /add/i }));
    fireEvent.change(within(customerCard).getByPlaceholderText("Short title"), {
      target: { value: "Blocked note" },
    });
    fireEvent.click(within(customerCard).getByRole("button", { name: /^save$/i }));

    expect(await within(customerCard).findByRole("alert")).toHaveTextContent(
      "Customer note save requires customer and company context.",
    );
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
  });

  it("keeps work-order-local notes on the existing work-order handlers only", async () => {
    renderNotes();

    const workOrderCard = cardFor("Work Order Notes");
    fireEvent.click(within(workOrderCard).getByRole("button", { name: /add/i }));
    fireEvent.change(within(workOrderCard).getByPlaceholderText("Short title"), {
      target: { value: "New work order note" },
    });
    fireEvent.click(within(workOrderCard).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(mocks.addWorkOrderNote).toHaveBeenCalledWith("wo_1", {
        title: "New work order note",
        content: "",
      }),
    );
    await waitFor(() => expect(within(workOrderCard).queryByPlaceholderText("Short title")).not.toBeInTheDocument());
    expect(mocks.updateCustomer).not.toHaveBeenCalled();

    fireEvent.click(within(workOrderCard).getByRole("button", { name: /edit note/i }));
    fireEvent.change(within(workOrderCard).getByDisplayValue("Work order title"), {
      target: { value: "Edited work order note" },
    });
    fireEvent.click(within(workOrderCard).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(mocks.updateWorkOrderNote).toHaveBeenCalledWith("wo_1", "wonote_1", {
        title: "Edited work order note",
        content: "Work order content",
      }),
    );
    await waitFor(() => expect(within(workOrderCard).queryByDisplayValue("Edited work order note")).not.toBeInTheDocument());

    fireEvent.click(within(workOrderCard).getByRole("button", { name: /archive note/i }));
    await waitFor(() => expect(mocks.setWorkOrderNoteArchived).toHaveBeenCalledWith("wo_1", "wonote_1", true));
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
  });
});
