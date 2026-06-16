import { describe, expect, it } from "vitest";

import {
  createAgreementTimeBankSnapshot,
  defaultTemplateTimeBankRules,
  inheritCancellationPolicyFromTemplate,
  inheritTimeBankRulesFromTemplate,
  templateTimeBankEnabled,
} from "./timeBankTemplateBinding";
import { defaultCancellationPolicy, defaultTimeBankRules } from "./timeBank";
import type {
  TimeBankCancellationPolicy,
  TimeBankRules,
  TimeBankTemplateRules,
} from "@/types";

// ── Safe defaults ─────────────────────────────────────────────

describe("defaultTemplateTimeBankRules", () => {
  it("returns Time Bank OFF as the safe default", () => {
    const d = defaultTemplateTimeBankRules();
    expect(d.timeBankEnabled).toBe(false);
    expect(d.allocationMinutes).toBe(0);
  });

  it("defaults to unlimited carryover", () => {
    expect(defaultTemplateTimeBankRules().carryoverPolicy).toBe("unlimited");
  });

  it("defaults to monthly refill", () => {
    expect(defaultTemplateTimeBankRules().refillFrequency).toBe("monthly");
  });

  it("cancellation credit is disabled by default", () => {
    expect(defaultTemplateTimeBankRules().cancellationCreditPolicy.enabled).toBe(false);
  });

  it("no expiry by default", () => {
    const d = defaultTemplateTimeBankRules();
    expect(d.expiryAfterDays).toBeNull();
  });
});

// ── Enabled check ─────────────────────────────────────────────

describe("templateTimeBankEnabled", () => {
  it("false when null/undefined", () => {
    expect(templateTimeBankEnabled(null)).toBe(false);
    expect(templateTimeBankEnabled(undefined)).toBe(false);
  });

  it("false when timeBankEnabled is not true", () => {
    expect(
      templateTimeBankEnabled({ timeBankEnabled: false, allocationMinutes: 600 }),
    ).toBe(false);
    expect(
      templateTimeBankEnabled({ allocationMinutes: 600 }),
    ).toBe(false);
  });

  it("false when allocation is zero or missing", () => {
    expect(
      templateTimeBankEnabled({ timeBankEnabled: true, allocationMinutes: 0 }),
    ).toBe(false);
    expect(
      templateTimeBankEnabled({ timeBankEnabled: true }),
    ).toBe(false);
  });

  it("true when enabled with positive allocation", () => {
    expect(
      templateTimeBankEnabled({ timeBankEnabled: true, allocationMinutes: 600 }),
    ).toBe(true);
  });
});

// ── Template → rules inheritance ──────────────────────────────

describe("inheritTimeBankRulesFromTemplate", () => {
  it("returns safe defaults when no template rules provided", () => {
    const rules = inheritTimeBankRulesFromTemplate({});
    expect(rules.allocationMinutes).toBe(0);
    expect(rules.carryoverPolicy).toBe("unlimited");
    expect(rules.refillFrequency).toBe("monthly");
  });

  it("inherits allocationMinutes from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { timeBankEnabled: true, allocationMinutes: 480 },
    });
    expect(rules.allocationMinutes).toBe(480);
    // Other fields remain at safe defaults
    expect(rules.carryoverPolicy).toBe("unlimited");
  });

  it("inherits refillFrequency from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { refillFrequency: "quarterly" },
    });
    expect(rules.refillFrequency).toBe("quarterly");
  });

  it("inherits carryoverPolicy from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { carryoverPolicy: "capped", maxBalanceMinutes: 1200 },
    });
    expect(rules.carryoverPolicy).toBe("capped");
    expect(rules.maxBalanceMinutes).toBe(1200);
  });

  it("inherits no_carryover from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { carryoverPolicy: "no_carryover" },
    });
    expect(rules.carryoverPolicy).toBe("no_carryover");
  });

  it("inherits expiry settings from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: {
        carryoverPolicy: "expiry",
        expiryAfterDays: 90,
      },
    });
    expect(rules.carryoverPolicy).toBe("expiry");
    expect(rules.expiryAfterDays).toBe(90);
  });

  it("inherits warning thresholds from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: {
        warningThresholdPercent: 30,
        criticalThresholdPercent: 10,
      },
    });
    expect(rules.warningThresholdPercent).toBe(30);
    expect(rules.criticalThresholdPercent).toBe(10);
  });

  it("inherits absolute thresholds from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: {
        warningThresholdMinutes: 120,
        criticalThresholdMinutes: 60,
      },
    });
    expect(rules.warningThresholdMinutes).toBe(120);
    expect(rules.criticalThresholdMinutes).toBe(60);
  });

  it("inherits negativeFloorMinutes from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { negativeFloorMinutes: 120 },
    });
    expect(rules.negativeFloorMinutes).toBe(120);
  });

  it("inherits refillAnchor from template", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { refillAnchor: "15" },
    });
    expect(rules.refillAnchor).toBe("15");
  });

  // ── Override wins over template ────────────────────────────

  it("override wins over template suggestion", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { allocationMinutes: 480, carryoverPolicy: "unlimited" },
      override: { allocationMinutes: 600, carryoverPolicy: "capped", maxBalanceMinutes: 2000 },
    });
    expect(rules.allocationMinutes).toBe(600);
    expect(rules.carryoverPolicy).toBe("capped");
    expect(rules.maxBalanceMinutes).toBe(2000);
  });

  it("override can set fields the template did not touch", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: { allocationMinutes: 300 },
      override: { negativeFloorMinutes: 60, warningThresholdPercent: 40 },
    });
    expect(rules.allocationMinutes).toBe(300);
    expect(rules.negativeFloorMinutes).toBe(60);
    expect(rules.warningThresholdPercent).toBe(40);
  });

  it("override on a null template produces fully custom rules", () => {
    const rules = inheritTimeBankRulesFromTemplate({
      templateRules: null,
      override: { allocationMinutes: 900, carryoverPolicy: "no_carryover" },
    });
    expect(rules.allocationMinutes).toBe(900);
    expect(rules.carryoverPolicy).toBe("no_carryover");
    expect(rules.refillFrequency).toBe("monthly"); // default persists
  });

  // ── Immutability ──────────────────────────────────────────

  it("does not mutate the template rules object", () => {
    const template: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 400,
    };
    const snapshot = { ...template };
    inheritTimeBankRulesFromTemplate({ templateRules: template });
    expect(template).toEqual(snapshot);
  });
});

// ── Cancellation policy inheritance ───────────────────────────

describe("inheritCancellationPolicyFromTemplate", () => {
  it("disabled when no template policy provided", () => {
    const result = inheritCancellationPolicyFromTemplate({});
    expect(result.valid).toBe(true);
    expect(result.policy.enabled).toBe(false);
  });

  it("inherits template policy", () => {
    const tp: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "fixed",
      deductionMinutes: 60,
    };
    const result = inheritCancellationPolicyFromTemplate({ templatePolicy: tp });
    expect(result.valid).toBe(true);
    expect(result.policy.enabled).toBe(true);
    expect(result.policy.deductionMethod).toBe("fixed");
    expect(result.policy.deductionMinutes).toBe(60);
  });

  it("inherits percentage deduction", () => {
    const tp: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "percentage",
      deductionPercent: 25,
    };
    const result = inheritCancellationPolicyFromTemplate({ templatePolicy: tp });
    expect(result.policy.deductionMethod).toBe("percentage");
    expect(result.policy.deductionPercent).toBe(25);
  });

  it("inherits full credit (no deduction)", () => {
    const tp: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "none",
    };
    const result = inheritCancellationPolicyFromTemplate({ templatePolicy: tp });
    expect(result.policy.deductionMethod).toBe("none");
    expect(result.policy.enabled).toBe(true);
  });

  it("override wins over template policy", () => {
    const tp: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "fixed",
      deductionMinutes: 60,
    };
    const result = inheritCancellationPolicyFromTemplate({
      templatePolicy: tp,
      override: { deductionMethod: "percentage", deductionPercent: 50 },
    });
    expect(result.valid).toBe(true);
    expect(result.policy.deductionMethod).toBe("percentage");
    expect(result.policy.deductionPercent).toBe(50);
  });

  it("validates the final policy", () => {
    const tp: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "percentage",
      deductionPercent: 150, // invalid
    };
    const result = inheritCancellationPolicyFromTemplate({ templatePolicy: tp });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not mutate the template policy object", () => {
    const tp: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "fixed",
      deductionMinutes: 30,
    };
    const snapshot = JSON.parse(JSON.stringify(tp));
    inheritCancellationPolicyFromTemplate({ templatePolicy: tp });
    expect(tp).toEqual(snapshot);
  });
});

// ── Full agreement snapshot ───────────────────────────────────

describe("createAgreementTimeBankSnapshot", () => {
  it("returns disabled snapshot when no template provided", () => {
    const snap = createAgreementTimeBankSnapshot({});
    expect(snap.timeBankEnabled).toBe(false);
    expect(snap.rules.allocationMinutes).toBe(0);
    expect(snap.cancellationCreditPolicy.enabled).toBe(false);
    expect(snap.cancellationPolicyValid).toBe(true);
  });

  it("returns disabled snapshot when template has timeBankEnabled: false", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: false,
        allocationMinutes: 600,
      },
    });
    expect(snap.timeBankEnabled).toBe(false);
    // Rules still reflect the template's settings (just no wallet creation)
    expect(snap.rules.allocationMinutes).toBe(600);
  });

  it("returns enabled snapshot for a full template", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 480,
        refillFrequency: "quarterly",
        carryoverPolicy: "capped",
        maxBalanceMinutes: 2000,
        negativeFloorMinutes: 60,
        warningThresholdPercent: 25,
        criticalThresholdPercent: 10,
        cancellationCreditPolicy: {
          enabled: true,
          deductionMethod: "fixed",
          deductionMinutes: 30,
        },
      },
    });

    expect(snap.timeBankEnabled).toBe(true);
    expect(snap.rules.allocationMinutes).toBe(480);
    expect(snap.rules.refillFrequency).toBe("quarterly");
    expect(snap.rules.carryoverPolicy).toBe("capped");
    expect(snap.rules.maxBalanceMinutes).toBe(2000);
    expect(snap.rules.negativeFloorMinutes).toBe(60);
    expect(snap.rules.warningThresholdPercent).toBe(25);
    expect(snap.rules.criticalThresholdPercent).toBe(10);
    expect(snap.cancellationCreditPolicy.enabled).toBe(true);
    expect(snap.cancellationCreditPolicy.deductionMethod).toBe("fixed");
    expect(snap.cancellationCreditPolicy.deductionMinutes).toBe(30);
    expect(snap.cancellationPolicyValid).toBe(true);
  });

  it("inherits cancellation credit disabled from template", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 300,
        cancellationCreditPolicy: {
          enabled: false,
          deductionMethod: "none",
        },
      },
    });
    expect(snap.cancellationCreditPolicy.enabled).toBe(false);
    expect(snap.cancellationPolicyValid).toBe(true);
  });

  it("inherits full credit cancellation from template", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 300,
        cancellationCreditPolicy: {
          enabled: true,
          deductionMethod: "none",
        },
      },
    });
    expect(snap.cancellationCreditPolicy.enabled).toBe(true);
    expect(snap.cancellationCreditPolicy.deductionMethod).toBe("none");
  });

  it("inherits percentage deduction cancellation from template", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 300,
        cancellationCreditPolicy: {
          enabled: true,
          deductionMethod: "percentage",
          deductionPercent: 25,
        },
      },
    });
    expect(snap.cancellationCreditPolicy.deductionMethod).toBe("percentage");
    expect(snap.cancellationCreditPolicy.deductionPercent).toBe(25);
  });

  // ── Override wins at snapshot level ────────────────────────

  it("rulesOverride wins over template", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 400,
        carryoverPolicy: "unlimited",
      },
      rulesOverride: {
        allocationMinutes: 600,
        carryoverPolicy: "no_carryover",
      },
    });
    expect(snap.rules.allocationMinutes).toBe(600);
    expect(snap.rules.carryoverPolicy).toBe("no_carryover");
    // timeBankEnabled is derived from template — overrides do NOT affect it
    expect(snap.timeBankEnabled).toBe(true);
  });

  it("cancellationPolicyOverride wins over template", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 300,
        cancellationCreditPolicy: {
          enabled: true,
          deductionMethod: "fixed",
          deductionMinutes: 60,
        },
      },
      cancellationPolicyOverride: {
        deductionMethod: "percentage",
        deductionPercent: 50,
      },
    });
    expect(snap.cancellationCreditPolicy.deductionMethod).toBe("percentage");
    expect(snap.cancellationCreditPolicy.deductionPercent).toBe(50);
  });

  // ── Immutability ──────────────────────────────────────────

  it("does not mutate the template rules object", () => {
    const template: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 500,
    };
    const before = JSON.parse(JSON.stringify(template));
    createAgreementTimeBankSnapshot({ templateRules: template });
    expect(template).toEqual(before);
  });

  // ── agreementGroupId binding is unchanged ─────────────────

  it("template binding does not affect agreementGroupId logic", () => {
    // The timeBankEnabled flag is a template suggestion only.
    // The actual wallet still binds to agreementGroupId (LOCKED decision 2).
    // This test ensures we never accidentally tie wallet creation to template id.
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 480,
      },
    });
    // Rules contain no template id — only the agreementGroupId matters
    expect((snap.rules as unknown as Record<string, unknown>).templateId).toBeUndefined();
    expect((snap.rules as unknown as Record<string, unknown>).sourceTemplateId).toBeUndefined();
    expect(snap.timeBankEnabled).toBe(true);
  });

  // ── Entitlement gate respect ──────────────────────────────

  it("snapshot creation does not bypass entitlements", () => {
    // The snapshot only produces values — the caller must still gate on
    // entitlements before creating a wallet. This module never activates
    // Time Bank on its own.
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 9999,
      },
    });
    // Snapshot exists, but the caller owns the decision to use it
    expect(snap.timeBankEnabled).toBe(true);
    // No wallet is created here — this is pure planning
  });

  // ── Template changes don't mutate existing snapshots ──────

  it("template changes do not affect an existing snapshot", () => {
    const template: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 480,
      carryoverPolicy: "unlimited",
    };

    const snap = createAgreementTimeBankSnapshot({ templateRules: template });

    // Simulate template being updated later
    template.allocationMinutes = 999;
    template.carryoverPolicy = "no_carryover";

    // Snapshot must be unaffected
    expect(snap.rules.allocationMinutes).toBe(480);
    expect(snap.rules.carryoverPolicy).toBe("unlimited");
  });

  it("template delete/nulling does not affect existing snapshot", () => {
    const snap = createAgreementTimeBankSnapshot({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 600,
        carryoverPolicy: "capped",
        maxBalanceMinutes: 1500,
      },
    });

    // Later: template is archived/deleted
    // The snapshot is completely independent
    expect(snap.rules.allocationMinutes).toBe(600);
    expect(snap.rules.carryoverPolicy).toBe("capped");
    expect(snap.rules.maxBalanceMinutes).toBe(1500);
  });

  // ── Versioning does not break wallet continuity ───────────

  it("template version changes do not affect agreement rules", () => {
    const v1Rules = inheritTimeBankRulesFromTemplate({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 480,
        carryoverPolicy: "unlimited",
      },
    });

    // Template v2 changes allocation — but existing agreements use their own snapshot
    const v2Rules = inheritTimeBankRulesFromTemplate({
      templateRules: {
        timeBankEnabled: true,
        allocationMinutes: 600,
        carryoverPolicy: "capped",
        maxBalanceMinutes: 2000,
      },
    });

    // v1 agreements (created from v1 template) remain unchanged
    expect(v1Rules.allocationMinutes).toBe(480);
    expect(v1Rules.carryoverPolicy).toBe("unlimited");

    // v2 template produces different rules — for NEW agreements only
    expect(v2Rules.allocationMinutes).toBe(600);
    expect(v2Rules.carryoverPolicy).toBe("capped");
  });
});
