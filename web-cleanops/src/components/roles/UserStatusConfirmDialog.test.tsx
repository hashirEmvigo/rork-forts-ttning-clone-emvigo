import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  UserStatusConfirmDialog,
  type PendingStatusChange,
} from "@/components/roles/UserStatusConfirmDialog";

const disablePending: PendingStatusChange = {
  userId: "u-1",
  name: "Alex Admin",
  email: "alex@acme.example",
  role: "company_admin",
  companyName: "Acme AB",
  next: "inactive",
};

const enablePending: PendingStatusChange = {
  userId: "u-2",
  name: "Robin Reader",
  email: "robin@acme.example",
  role: "employee",
  companyName: "Acme AB",
  next: "active",
};

afterEach(cleanup);

describe("UserStatusConfirmDialog", () => {
  it("renders nothing while there is no pending action", () => {
    render(
      <UserStatusConfirmDialog pending={null} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("Disable user?")).not.toBeInTheDocument();
    expect(screen.queryByText("Enable user?")).not.toBeInTheDocument();
  });

  it("shows the disable copy with the affected user's identity", () => {
    render(
      <UserStatusConfirmDialog
        pending={disablePending}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Disable user?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This user will no longer be able to sign in after being disabled.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Admin")).toBeInTheDocument();
    expect(screen.getByText("alex@acme.example")).toBeInTheDocument();
    expect(screen.getByText("Acme AB")).toBeInTheDocument();
    // Role is surfaced via the shared RoleBadge label.
    expect(screen.getByText("Company Admin")).toBeInTheDocument();
  });

  it("confirms a disable with the exact pending payload", () => {
    const onConfirm = vi.fn();
    render(
      <UserStatusConfirmDialog
        pending={disablePending}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disable User" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(disablePending);
  });

  it("cancels without confirming", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <UserStatusConfirmDialog
        pending={disablePending}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the enable copy and confirms an enable", () => {
    const onConfirm = vi.fn();
    render(
      <UserStatusConfirmDialog
        pending={enablePending}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Enable user?")).toBeInTheDocument();
    expect(
      screen.getByText("This user will regain access after being enabled."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable User" }));
    expect(onConfirm).toHaveBeenCalledWith(enablePending);
  });
});
