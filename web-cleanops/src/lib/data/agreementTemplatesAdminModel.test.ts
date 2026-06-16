/**
 * Tests for the Agreement Templates Super Admin view-model (Phase 15).
 *
 * Pure formatting only — no Supabase, no React. Covers list-row mapping,
 * latest-version grouping, line rows, the read-only Time Bank defaults, the
 * cancellation-credit defaults, and the version-chain display.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  toCancellationDefaultsView,
  toLatestVersionRows,
  toTemplateLineRows,
  toTemplateListRow,
  toTimeBankDefaultsView,
  toVersionChain,
} from "./agreementTemplatesAdminModel";
import {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  resetTemplateSequencers,
} from "./agreementTemplates";
import type { AgreementTemplate, TimeBankTemplateRules } from "@/types";

beforeEach(() => resetTemplateSequencers());

function tpl(over: Partial<AgreementTemplate> = {}): AgreementTemplate {
  return { ...buildAgreementTemplate({ ownerType: "global", companyId: null, name: "Std" }), ...over };
}

describe("toTemplateListRow", () => {
  it("maps ownership, status, billing and Time Bank flags", () => {
    const row = toTemplateListRow(
      tpl({ status: "active", timeBankEligible: true, timeBankTemplateRules: { timeBankEnabled: true } }),
    );
    expect(row.ownerLabel).toBe("Global");
    expect(row.statusLabel).toBe("Active");
    expect(row.isActive).toBe(true);
    expect(row.timeBankEnabled).toBe(true);
  });

  it("does not flag Time Bank when eligible but rules disabled", () => {
    const row = toTemplateListRow(tpl({ timeBankEligible: true, timeBankTemplateRules: { timeBankEnabled: false } }));
    expect(row.timeBankEnabled).toBe(false);
  });

  it("flags copied-from templates", () => {
    const row = toTemplateListRow(tpl({ copiedFromTemplateId: "tpl_000001" }));
    expect(row.isCopy).toBe(true);
  });
});

describe("toLatestVersionRows", () => {
  it("keeps only the newest version per group and sorts by name", () => {
    const groupA1 = tpl({ id: "a1", templateGroupId: "gA", name: "Beta", version: 1 });
    const groupA2 = tpl({ id: "a2", templateGroupId: "gA", name: "Beta", version: 2 });
    const groupB1 = tpl({ id: "b1", templateGroupId: "gB", name: "Alpha", version: 1 });
    const rows = toLatestVersionRows([groupA1, groupA2, groupB1]);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Alpha");
    expect(rows[1].name).toBe("Beta");
    expect(rows[1].version).toBe(2);
  });
});

describe("toTemplateLineRows", () => {
  it("sorts by sortOrder and formats price/quantity/duration", () => {
    const t = tpl();
    const l1 = buildAgreementTemplateLine({
      templateId: t.id,
      templateGroupId: t.templateGroupId,
      ownerType: "global",
      companyId: null,
      sortOrder: 1,
      serviceNameSnapshot: "Second",
    });
    const l2 = buildAgreementTemplateLine({
      templateId: t.id,
      templateGroupId: t.templateGroupId,
      ownerType: "global",
      companyId: null,
      sortOrder: 0,
      serviceNameSnapshot: "First",
      defaultPrice: 100,
      defaultQuantity: 2,
      unit: "h",
      defaultDurationMinutes: 90,
    });
    const rows = toTemplateLineRows([l1, l2]);
    expect(rows[0].serviceName).toBe("First");
    expect(rows[0].priceLabel).toBe("100");
    expect(rows[0].quantityLabel).toBe("2 h");
    expect(rows[0].durationLabel).toBe("1h 30m");
    expect(rows[1].priceLabel).toBe("—");
  });
});

describe("toTimeBankDefaultsView", () => {
  it("returns disabled when not eligible", () => {
    const view = toTimeBankDefaultsView({ timeBankEligible: false, timeBankTemplateRules: null });
    expect(view.enabled).toBe(false);
  });

  it("formats enabled rules", () => {
    const rules: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 300,
      refillFrequency: "monthly",
      carryoverPolicy: "capped",
      maxBalanceMinutes: 600,
      expiryAfterDays: 30,
      negativeFloorMinutes: 60,
      warningThresholdPercent: 20,
    };
    const view = toTimeBankDefaultsView({ timeBankEligible: true, timeBankTemplateRules: rules });
    expect(view.enabled).toBe(true);
    expect(view.allocationLabel).toBe("5h");
    expect(view.refillLabel).toBe("Monthly");
    expect(view.carryoverLabel).toBe("Capped balance");
    expect(view.maxBalanceLabel).toBe("10h");
    expect(view.expiryLabel).toBe("30 days");
    expect(view.negativeFloorLabel).toBe("-1h");
    expect(view.warningLabel).toBe("20%");
    expect(view.criticalLabel).toBe("—");
  });
});

describe("toCancellationDefaultsView", () => {
  it("returns disabled when policy is missing or off", () => {
    expect(toCancellationDefaultsView(null).enabled).toBe(false);
    expect(toCancellationDefaultsView({ enabled: false, deductionMethod: "none" }).enabled).toBe(false);
  });

  it("describes a percentage deduction", () => {
    const view = toCancellationDefaultsView({
      enabled: true,
      deductionMethod: "percentage",
      deductionPercent: 25,
      minCreditMinutes: 30,
    });
    expect(view.enabled).toBe(true);
    expect(view.methodLabel).toBe("Percentage Deduction");
    expect(view.deductionDetail).toContain("25%");
    expect(view.minCreditLabel).toBe("30m");
  });
});

describe("toVersionChain", () => {
  it("orders oldest → newest and marks the current version", () => {
    const v1 = tpl({ id: "v1", version: 1, status: "superseded" });
    const v2 = tpl({ id: "v2", version: 2, status: "active" });
    const chain = toVersionChain([v2, v1], "v2");
    expect(chain.map((c) => c.version)).toEqual([1, 2]);
    expect(chain[1].isCurrent).toBe(true);
    expect(chain[0].statusLabel).toBe("Superseded");
  });
});
