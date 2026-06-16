import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { Customer, User } from "@/types";

const customer: Customer = {
  id: "cust_1",
  companyId: "cmp_stad",
  name: "Portal Customer",
  customerNumber: "C-1001",
  email: "portal@example.com",
  status: "active",
  userIds: ["usr_customer"],
  schedulingPreferences: {
    version: 2,
    preferredRecurringWindows: [
      {
        id: "pref_monday",
        day: "monday",
        startTime: "09:00",
        endTime: "12:00",
        label: "Preferred recurring cleaning times",
      },
    ],
    acceptableRecurringWindows: [],
    acceptableTemporaryWindows: [],
    temporaryReschedulingPriority: [],
    preferredDays: [],
    secondaryDays: [],
    absencePriority: [],
    schedulingNotes: "Admin-managed preferences",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const currentUser: User = {
  id: "usr_customer",
  name: "Customer User",
  email: "customer@example.com",
  role: "customer",
  companyId: "cmp_stad",
  status: "active",
  linkedCustomerId: "cust_1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser,
    customers: [customer],
  }),
}));

import CustomerCleaningPreferences from "./CleaningPreferences";

describe("CUSTOMER-SCHEDULING-PREFERENCES-A1.1 Customer Portal read-only scheduling preferences", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows V2 scheduling preferences read-only without admin editing controls", () => {
    render(<CustomerCleaningPreferences />);

    expect(screen.getByText("Cleaning days & times")).toBeInTheDocument();
    expect(screen.getByText("Admin-managed preferences")).toBeInTheDocument();
    expect(screen.getByText(/Preference editing is currently handled by your cleaning provider/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add window/i })).not.toBeInTheDocument();
  });
});
