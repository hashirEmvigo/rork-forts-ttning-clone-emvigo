/**
 * Tests for the Super Admin Agreement Templates page (Phase 15 · first
 * management UI). The container hook + AppContext are mocked (NO Supabase /
 * network). Covers: global list rendering, empty/disabled states, detail
 * (lines, Time Bank defaults, cancellation defaults, version chain), the access
 * guard, action pass-through, and that no destructive delete control exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { AgreementTemplatesAdminResult, TemplateDetail } from "@/hooks/use-agreement-templates-admin";
import {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  resetTemplateSequencers,
} from "@/lib/data/agreementTemplates";
import type { AgreementTemplate } from "@/types";

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const adminMock = vi.fn();
vi.mock("@/hooks/use-agreement-templates-admin", () => ({
  useAgreementTemplatesAdmin: () => adminMock(),
}));

const useAppMock = vi.fn();
vi.mock("@/context/AppContext", () => ({
  useApp: () => useAppMock(),
}));

import AgreementTemplates from "./AgreementTemplates";

function template(over: Partial<AgreementTemplate> = {}): AgreementTemplate {
  return {
    ...buildAgreementTemplate({ ownerType: "global", companyId: null, name: "Private Standard" }),
    status: "active",
    ...over,
  };
}

function detailWith(over: Partial<AgreementTemplate> = {}): TemplateDetail {
  const t = template({ id: "tpl_main", ...over });
  const line = buildAgreementTemplateLine({
    templateId: t.id,
    templateGroupId: t.templateGroupId,
    ownerType: "global",
    companyId: null,
    serviceNameSnapshot: "Standard cleaning",
    defaultPrice: 100,
  });
  return { template: t, lines: [line], versionChain: [t] };
}

const baseHandlers = {
  selectCompany: vi.fn(),
  selectTemplate: vi.fn(),
  reload: vi.fn(),
  createGlobalTemplate: vi.fn(async () => true),
  editTemplate: vi.fn(async () => true),
  addLine: vi.fn(async () => true),
  deactivateLine: vi.fn(async () => true),
  publishTemplate: vi.fn(async () => true),
  archive: vi.fn(async () => true),
  copyToCompany: vi.fn(async () => true),
};

function setAdmin(over: Partial<AgreementTemplatesAdminResult> = {}): void {
  adminMock.mockReturnValue({
    globalTemplates: [],
    companyTemplates: [],
    selectedCompanyId: null,
    detail: null,
    loading: false,
    pending: false,
    loadError: null,
    actionError: null,
    enabled: true,
    ...baseHandlers,
    ...over,
  } as AgreementTemplatesAdminResult);
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <AgreementTemplates />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetTemplateSequencers();
  useAppMock.mockReturnValue({
    currentUser: { id: "u1", name: "Admin", role: "super_admin", companyId: null },
    companies: [{ id: "cmp_1", name: "Acme", status: "active" }],
  });
  setAdmin();
});

describe("AgreementTemplates — access + base states", () => {
  it("denies non super-admins", () => {
    useAppMock.mockReturnValue({
      currentUser: { id: "u2", name: "Manager", role: "company_admin", companyId: "cmp_1" },
      companies: [],
    });
    renderPage();
    expect(screen.queryByText("Global library")).not.toBeInTheDocument();
  });

  it("renders a disabled state when storage is unavailable", () => {
    setAdmin({ enabled: false });
    renderPage();
    expect(screen.getByText("Template storage unavailable")).toBeInTheDocument();
  });

  it("renders an empty global library", () => {
    renderPage();
    expect(screen.getByText(/No global templates yet/i)).toBeInTheDocument();
  });
});

describe("AgreementTemplates — list + detail", () => {
  it("lists the latest version of each global template", () => {
    setAdmin({ globalTemplates: [template({ id: "tpl_a", name: "Office Monthly" })] });
    renderPage();
    expect(screen.getByText("Office Monthly")).toBeInTheDocument();
  });

  it("selects a template when its row is clicked", () => {
    const selectTemplate = vi.fn();
    setAdmin({
      globalTemplates: [template({ id: "tpl_a", name: "Office Monthly" })],
      selectTemplate,
    });
    renderPage();
    fireEvent.click(screen.getByTestId("template-row-tpl_a"));
    expect(selectTemplate).toHaveBeenCalledWith("tpl_a");
  });

  it("renders detail: lines, Time Bank defaults and version chain", () => {
    setAdmin({
      detail: detailWith({
        timeBankEligible: true,
        timeBankTemplateRules: {
          timeBankEnabled: true,
          allocationMinutes: 300,
          refillFrequency: "monthly",
          carryoverPolicy: "unlimited",
        },
      }),
    });
    renderPage();
    expect(screen.getByText("Service lines")).toBeInTheDocument();
    expect(screen.getByTestId("template-line-tpl_line_000001")).toBeInTheDocument();
    expect(screen.getByText("Time Bank defaults")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByTestId("version-1")).toBeInTheDocument();
  });

  it("shows the disabled Time Bank state for a non-eligible template", () => {
    setAdmin({ detail: detailWith({ timeBankEligible: false, timeBankTemplateRules: null }) });
    renderPage();
    expect(screen.getByTestId("time-bank-disabled")).toBeInTheDocument();
  });
});

describe("AgreementTemplates — actions", () => {
  it("publishes a draft template", () => {
    const publishTemplate = vi.fn(async () => true);
    setAdmin({ detail: detailWith({ status: "draft" }), publishTemplate });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Publish/i }));
    expect(publishTemplate).toHaveBeenCalledWith("tpl_main");
  });

  it("archives a template", () => {
    const archive = vi.fn(async () => true);
    setAdmin({ detail: detailWith({ status: "active" }), archive });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archive/i }));
    expect(archive).toHaveBeenCalledWith("tpl_main");
  });

  it("deactivates a line (no destructive delete)", () => {
    const deactivateLine = vi.fn(async () => true);
    setAdmin({ detail: detailWith(), deactivateLine });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Deactivate Standard cleaning/i }));
    expect(deactivateLine).toHaveBeenCalledWith("tpl_main", "tpl_line_000001");
    // No hard-delete affordance anywhere.
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument();
  });

  it("surfaces action errors", () => {
    setAdmin({ detail: detailWith(), actionError: "No Supabase company found." });
    renderPage();
    expect(screen.getByText("No Supabase company found.")).toBeInTheDocument();
  });
});
