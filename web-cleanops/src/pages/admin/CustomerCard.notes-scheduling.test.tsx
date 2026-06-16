import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";

import type { Customer } from "@/types";

const mocks = vi.hoisted(() => ({
  updateCustomer: vi.fn(),
  localUpdateCustomer: vi.fn(),
  saveCustomers: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  mirrorUserWrites: vi.fn(),
  createProfile: vi.fn(),
  toast: vi.fn(),
  makeId: vi.fn(),
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
    hasPermission: vi.fn(() => true),
    updateCustomer: mocks.localUpdateCustomer,
    getCustomerWorkOrders: vi.fn(() => []),
    getCustomerInvoices: vi.fn(() => []),
    getUserPermissions: vi.fn(() => []),
    hydrateCustomerFromRemote: vi.fn(),
    areas: [],
    postalCities: [],
    employees: [],
    companies: [],
    areaScopedAccessEnabled: false,
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

vi.mock("@/components/ui/select", () => {
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  );
  const SelectContent = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  );
  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    SelectValue: () => null,
  };
});

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

import { NotesTab, SchedulingTab } from "./CustomerCard";

const baseCustomer: Customer = {
  id: "cust_1",
  companyId: "cmp_stad",
  name: "Bergen Offices",
  customerNumber: "C-1001",
  email: "office@example.com",
  status: "active",
  customerType: "commercial",
  customerSegment: "b2b",
  userIds: ["usr_portal"],
  cardNotes: [
    {
      id: "note_1",
      type: "admin",
      title: "Existing title",
      content: "Existing content",
      authorId: "usr_admin",
      authorName: "Admin User",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    },
    {
      id: "note_archived",
      type: "admin",
      title: "Archived title",
      content: "Archived content",
      authorId: "usr_admin",
      authorName: "Admin User",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      status: "inactive",
    },
  ],
  schedulingPreferences: {
    preferredDays: [],
    secondaryDays: [],
    absencePriority: [
      "regular_employee_within_interval",
      "regular_employee_outside_interval",
      "regular_day_substitute_employee",
      "skip_visit_wait_regular_employee",
    ],
    schedulingNotes: "Old scheduling note",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  cardLog: [
    {
      id: "clog_existing",
      at: "2026-01-01T00:00:00.000Z",
      section: "Contact information",
      field: "Name",
      changeType: "admin_change",
      oldValue: "Old",
      newValue: "New",
      changedById: "usr_admin",
      changedByName: "Admin User",
      changedByRole: "company_admin",
      source: "admin_portal",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function expectNoLegacyPersistence(): void {
  expect(mocks.localUpdateCustomer).not.toHaveBeenCalled();
  expect(mocks.saveCustomers).not.toHaveBeenCalled();
  expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
  expect(mocks.mirrorUserWrites).not.toHaveBeenCalled();
  expect(mocks.createProfile).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.makeId.mockImplementation((prefix: string) => `${prefix}_generated`);
  mocks.updateCustomer.mockResolvedValue(baseCustomer);
});

describe("CORE-WRITES-CUSTOMERS-A1.4.1 Customer Card notes", () => {
  it("adds a card note through the Supabase customer mutation only", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    render(<NotesTab customer={{ ...baseCustomer, cardNotes: [] }} />);

    fireEvent.click(screen.getAllByRole("button", { name: /add note/i })[0]);
    fireEvent.change(screen.getByPlaceholderText("Short title"), {
      target: { value: "  New customer note  " },
    });
    fireEvent.change(screen.getByPlaceholderText("Write the note…"), {
      target: { value: "  New customer content  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: "cmp_stad",
      patch: expect.objectContaining({
        cardNotes: [
          expect.objectContaining({
            id: "cnote_generated",
            type: "admin",
            title: "New customer note",
            content: "New customer content",
            authorId: "usr_admin",
            authorName: "Admin User",
            status: "active",
          }),
        ],
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
    expect(screen.queryByPlaceholderText("Short title")).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Note added" }));
    expectNoLegacyPersistence();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("edits a card note through the Supabase customer mutation only", async () => {
    render(<NotesTab customer={baseCustomer} />);

    const existingItem = screen.getByText("Existing title").closest("li");
    expect(existingItem).not.toBeNull();
    fireEvent.click(within(existingItem as HTMLElement).getByRole("button", { name: /edit note/i }));
    fireEvent.change(screen.getByDisplayValue("Existing title"), {
      target: { value: "  Edited title  " },
    });
    fireEvent.change(screen.getByDisplayValue("Existing content"), {
      target: { value: "  Edited content  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    const patch = mocks.updateCustomer.mock.calls[0][0].patch;
    expect(patch.cardNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "note_1",
          title: "Edited title",
          content: "Edited content",
          status: "active",
        }),
      ]),
    );
    expect(patch.cardLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ section: "Notes" })]),
    );
    expect(screen.queryByDisplayValue("Edited title")).not.toBeInTheDocument();
    expectNoLegacyPersistence();
  });

  it("archives and restores card notes through the Supabase customer mutation only", async () => {
    render(<NotesTab customer={baseCustomer} />);

    const existingItem = screen.getByText("Existing title").closest("li");
    expect(existingItem).not.toBeNull();
    fireEvent.click(within(existingItem as HTMLElement).getByRole("button", { name: /archive note/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer.mock.calls[0][0].patch.cardNotes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "note_1", status: "inactive" })]),
    );

    fireEvent.click(screen.getByLabelText("Show archived notes"));
    const archivedItem = screen.getByText("Archived title").closest("li");
    expect(archivedItem).not.toBeNull();
    fireEvent.click(within(archivedItem as HTMLElement).getByRole("button", { name: /restore note/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(2));
    expect(mocks.updateCustomer.mock.calls[1][0].patch.cardNotes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "note_archived", status: "active" })]),
    );
    expectNoLegacyPersistence();
  });

  it("keeps the note composer open and shows an inline error when Supabase save fails", async () => {
    mocks.updateCustomer.mockRejectedValueOnce(new Error("Supabase note save failed"));
    render(<NotesTab customer={{ ...baseCustomer, cardNotes: [] }} />);

    fireEvent.click(screen.getAllByRole("button", { name: /add note/i })[0]);
    fireEvent.change(screen.getByPlaceholderText("Short title"), {
      target: { value: "Retry title" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByText("Supabase note save failed")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Retry title")).toBeInTheDocument();
    expectNoLegacyPersistence();
  });
});

describe("CORE-WRITES-CUSTOMERS-A1.4.1 Customer Card scheduling", () => {
  it("renders the Days & Times summary as four separate UX cards", () => {
    render(<SchedulingTab customer={baseCustomer} />);

    const layout = screen.getByTestId("customer-scheduling-card-layout");
    expect(layout).toBeInTheDocument();
    expect(within(layout).getByText("Preferred recurring cleaning times")).toBeInTheDocument();
    expect(within(layout).getByText("Acceptable recurring cleaning times")).toBeInTheDocument();
    expect(within(layout).getByText("Acceptable temporary cleaning times + Temporary rescheduling priority")).toBeInTheDocument();
    expect(within(layout).getByText("Temporary adjustments")).toBeInTheDocument();
    expect(within(layout).getByText("Temporary adjustment tools will be added here.")).toBeInTheDocument();
  });

  it("saves V2 scheduling preferences through the Supabase customer mutation only", async () => {
    render(<SchedulingTab customer={baseCustomer} />);

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByText("Preferred recurring cleaning times")).toBeInTheDocument();
    expect(screen.getByText("Acceptable temporary cleaning times")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /add window/i })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /add window/i })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: /add window/i })[2]);
    fireEvent.change(screen.getByPlaceholderText(/customer prefers morning cleaning/i), {
      target: { value: "  Prefer Monday morning  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: "cmp_stad",
      patch: expect.objectContaining({
        schedulingPreferences: expect.objectContaining({
          version: 2,
          preferredRecurringWindows: [
            expect.objectContaining({
              id: "cwin_generated",
              day: "monday",
              startTime: "09:00",
              endTime: "12:00",
            }),
          ],
          acceptableRecurringWindows: [
            expect.objectContaining({
              id: "cwin_generated",
              day: "monday",
              startTime: "08:00",
              endTime: "15:00",
            }),
          ],
          acceptableTemporaryWindows: [
            expect.objectContaining({
              id: "cwin_generated",
              day: "monday",
              startTime: "08:00",
              endTime: "16:00",
            }),
          ],
          temporaryReschedulingPriority: [
            "regular_employee_within_interval",
            "regular_employee_outside_interval",
            "regular_day_substitute_employee",
            "skip_visit_wait_regular_employee",
          ],
          schedulingNotes: "Prefer Monday morning",
          updatedAt: expect.any(String),
        }),
        cardLog: expect.arrayContaining([
          expect.objectContaining({
            id: "clog_generated",
            section: "Cleaning Days & Times",
            changedById: "usr_admin",
            source: "admin_portal",
          }),
        ]),
      }),
    });
    expect(screen.queryByPlaceholderText(/customer prefers morning cleaning/i)).not.toBeInTheDocument();
    expectNoLegacyPersistence();
  });

  it("renders V2 values after readback without reviving removed legacy windows", () => {
    render(
      <SchedulingTab
        customer={{
          ...baseCustomer,
          schedulingPreferences: {
            version: 2,
            preferredRecurringWindows: [],
            acceptableRecurringWindows: [],
            acceptableTemporaryWindows: [
              {
                id: "temp_friday",
                day: "friday",
                startTime: "08:00",
                endTime: "16:00",
                label: "Temporary only",
              },
            ],
            temporaryReschedulingPriority: [
              "skip_visit_wait_regular_employee",
              "regular_employee_within_interval",
              "regular_employee_outside_interval",
              "regular_day_substitute_employee",
            ],
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
            absencePriority: [],
            schedulingNotes: "Persisted V2 note",
            updatedAt: "2026-06-06T10:00:00.000Z",
          },
        }}
      />,
    );

    expect(screen.getByText("Persisted V2 note")).toBeInTheDocument();
    expect(screen.getByText("Temporary only")).toBeInTheDocument();
    expect(screen.getAllByText("None set.")).toHaveLength(2);
    expect(screen.queryByText(/09:00.*12:00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/09:00.*14:00/)).not.toBeInTheDocument();
  });

  it("keeps scheduling editor open and shows an inline error when Supabase save fails", async () => {
    mocks.updateCustomer.mockRejectedValueOnce(new Error("Supabase scheduling save failed"));
    render(<SchedulingTab customer={baseCustomer} />);

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByPlaceholderText(/customer prefers morning cleaning/i), {
      target: { value: "Retry scheduling note" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Supabase scheduling save failed")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Retry scheduling note")).toBeInTheDocument();
    expectNoLegacyPersistence();
  });
});
