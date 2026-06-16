import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ServiceProtocolLink } from "./ServiceProtocolLink";
import { generateCustomerProtocol } from "@/lib/customerProtocolGenerator";
import { generateProtocolRunFromCustomerProtocol } from "@/lib/protocolRunGenerator";
import { archiveCustomerProtocol } from "@/lib/customerProtocolStore";
import { getActiveTemplates } from "@/lib/checklistTemplateStore";
import type {
  CustomerProtocolV2,
  ProtocolRunV2,
  WorkOrderServiceRow,
} from "@/types";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// The create-from-template dialog now pulls in a React Query read model. It is
// never the subject of these tests, so stub it out to keep the harness free of a
// QueryClientProvider.
vi.mock("@/components/customer/CustomerProtocolDialog", () => ({
  CustomerProtocolDialog: () => null,
}));

let mockPermissions: string[] = [];
const updateRowMock = vi.fn<
  (id: string, rowId: string, patch: Record<string, unknown>) => { ok: boolean; error?: string }
>(() => ({ ok: true }));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "u1", role: "company_admin" },
    getUserPermissions: () => mockPermissions,
    updateWorkOrderServiceRow: updateRowMock,
  }),
}));

const COMPANY = "company-a";
const CUSTOMER = "customer-1";
const WORK_ORDER = "wo-1";

function makeRow(overrides?: Partial<WorkOrderServiceRow>): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Recurring Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-01-01",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function seedProtocol(name = "Bergen – Recurring"): CustomerProtocolV2 {
  const template = getActiveTemplates(COMPANY)[0];
  return generateCustomerProtocol(COMPANY, CUSTOMER, template.id, { name })!;
}

beforeEach(() => {
  localStorage.clear();
  cleanup();
  navigateMock.mockClear();
  toastMock.mockClear();
  updateRowMock.mockClear();
  mockPermissions = [
    "customer_protocols.view",
    "customer_protocols.edit",
    "customer_protocols.create",
  ];
});

describe("ServiceProtocolLink — unlinked", () => {
  it("shows a Link button for users who can link", () => {
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Link Cleaning Protocol/i }),
    ).toBeInTheDocument();
  });

  it("links the chosen protocol via the selector", () => {
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Link Cleaning Protocol/i }),
    );
    fireEvent.click(screen.getByText(protocol.name));
    fireEvent.click(screen.getByRole("button", { name: /^Link protocol$/i }));
    expect(updateRowMock).toHaveBeenCalledWith(WORK_ORDER, "row-1", {
      customerProtocolId: protocol.id,
    });
  });

  it("shows the empty-state with create shortcuts when no protocols exist", () => {
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Link Cleaning Protocol/i }),
    );
    expect(
      screen.getByText(/No cleaning protocol exists for this customer/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /From template/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Empty protocol/i }),
    ).toBeInTheDocument();
  });
});

describe("ServiceProtocolLink — linked", () => {
  it("shows the linked protocol with Open/Change/Remove", () => {
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    expect(screen.getByText(protocol.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Change/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove/i })).toBeInTheDocument();
  });

  it("removes the link", () => {
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove/i }));
    expect(updateRowMock).toHaveBeenCalledWith(WORK_ORDER, "row-1", {
      customerProtocolId: null,
    });
  });

  it("navigates to the customer protocols workspace on Open", () => {
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      `/customers/${CUSTOMER}?tab=protocols`,
    );
  });
});

describe("ServiceProtocolLink — run generation", () => {
  const EXEC_PERMISSIONS = [
    "customer_protocols.view",
    "customer_protocols.edit",
    "customer_protocols.create",
    "checklists.execution.view",
  ];

  it("shows Generate run when a protocol is linked but no run exists", () => {
    mockPermissions = EXEC_PERMISSIONS;
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Generate run/i }),
    ).toBeInTheDocument();
  });

  it("generates a run and stores protocolRunId on the service row", () => {
    mockPermissions = EXEC_PERMISSIONS;
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate run/i }));
    expect(updateRowMock).toHaveBeenCalledTimes(1);
    const [, , patch] = updateRowMock.mock.calls[0];
    expect(typeof (patch as { protocolRunId?: string }).protocolRunId).toBe(
      "string",
    );
  });

  it("opens the existing run instead of generating a second one", () => {
    mockPermissions = EXEC_PERMISSIONS;
    const protocol = seedProtocol();
    const run: ProtocolRunV2 = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "u1" },
    )!;
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({
          customerProtocolId: protocol.id,
          protocolRunId: run.id,
        })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Generate run/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open run/i }));
    expect(navigateMock).toHaveBeenCalledWith(`/protocol-runs?run=${run.id}`);
    expect(updateRowMock).not.toHaveBeenCalled();
  });

  it("warns before generating from an archived protocol", () => {
    mockPermissions = EXEC_PERMISSIONS;
    const protocol = seedProtocol();
    archiveCustomerProtocol(COMPANY, protocol.id);
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(false);
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate run/i }));
    expect(confirmSpy).toHaveBeenCalled();
    // Declined → no run linked.
    expect(updateRowMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("hides run actions for users without execution.view", () => {
    mockPermissions = ["customer_protocols.view", "customer_protocols.edit"];
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Generate run/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ServiceProtocolLink — permissions", () => {
  it("read-only users see the linked protocol but no edit controls", () => {
    mockPermissions = ["customer_protocols.view"];
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
      />,
    );
    expect(screen.getByText(protocol.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove/i }),
    ).not.toBeInTheDocument();
  });

  it("read-only users cannot link when unlinked", () => {
    mockPermissions = ["customer_protocols.view"];
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Link Cleaning Protocol/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No protocol linked/i)).toBeInTheDocument();
  });

  it("renders nothing without view permission", () => {
    mockPermissions = [];
    const { container } = render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ServiceProtocolLink — mutationsDisabled safety gate", () => {
  it("hides Link control when unlinked and never calls the service-row mutator", () => {
    const protocol = seedProtocol();
    void protocol;
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow()}
        mutationsDisabled
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Link Cleaning Protocol/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No protocol linked/i)).toBeInTheDocument();
    expect(updateRowMock).not.toHaveBeenCalled();
  });

  it("shows a linked protocol read-only without Change/Remove and never mutates", () => {
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
        mutationsDisabled
      />,
    );
    expect(screen.getByText(protocol.name)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open protocol/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Change/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove/i }),
    ).not.toBeInTheDocument();
    expect(updateRowMock).not.toHaveBeenCalled();
  });

  it("hides Generate run while mutations are disabled even with execution rights", () => {
    mockPermissions = [
      "customer_protocols.view",
      "customer_protocols.edit",
      "customer_protocols.create",
      "checklists.execution.view",
    ];
    const protocol = seedProtocol();
    render(
      <ServiceProtocolLink
        companyId={COMPANY}
        customerId={CUSTOMER}
        workOrderId={WORK_ORDER}
        serviceRow={makeRow({ customerProtocolId: protocol.id })}
        mutationsDisabled
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Generate run/i }),
    ).not.toBeInTheDocument();
    expect(updateRowMock).not.toHaveBeenCalled();
  });
});
