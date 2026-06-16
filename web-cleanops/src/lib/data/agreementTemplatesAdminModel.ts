/**
 * Agreement Templates — Super Admin management view-model (Phase 15 · first
 * management UI surface).
 *
 * The PURE presentation layer between the Agreement Templates data foundation
 * (`agreementTemplates.ts` / `agreementTemplatesRepository.ts`) and the Super
 * Admin management page. It turns immutable template / line / version-chain
 * records into ready-to-render display rows: ownership + status badges, billing
 * defaults, the read-only Time Bank defaults, the cancellation-credit defaults,
 * and a compact version-chain summary.
 *
 * It is PURE and DISPLAY ONLY:
 *   * No Supabase, no React, no network, no activation.
 *   * It never mutates inputs and never creates agreements or wallets.
 *   * Every helper formats a copy and returns a NEW object.
 */
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  TimeBankCancellationPolicy,
  TimeBankCarryoverPolicy,
  TimeBankRefillFrequency,
  TimeBankTemplateRules,
} from "@/types";
import {
  AGREEMENT_TEMPLATE_OWNER_TYPE_LABELS,
  AGREEMENT_TEMPLATE_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  INVOICE_INTERVAL_LABELS,
  TIME_BANK_CANCELLATION_DEDUCTION_METHOD_LABELS,
} from "@/types";
import { formatMinutes } from "./timeBankPanelModel";

// ── Label maps the type layer does not provide ───────────────

/** Display labels for {@link TimeBankRefillFrequency}. */
export const TIME_BANK_REFILL_FREQUENCY_LABELS: Record<TimeBankRefillFrequency, string> = {
  none: "No refill",
  manual: "Manual only",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/** Display labels for {@link TimeBankCarryoverPolicy}. */
export const TIME_BANK_CARRYOVER_POLICY_LABELS: Record<TimeBankCarryoverPolicy, string> = {
  unlimited: "Unlimited carryover",
  capped: "Capped balance",
  expiry: "Expires unused",
  no_carryover: "Resets each period",
};

// ── Template list rows ───────────────────────────────────────

/** A compact, ready-to-render summary of one template version. */
export interface TemplateListRow {
  id: string;
  templateGroupId: string;
  name: string;
  description: string | null;
  ownerLabel: string;
  ownerType: AgreementTemplate["ownerType"];
  statusLabel: string;
  status: AgreementTemplate["status"];
  version: number;
  billingLabel: string;
  invoiceIntervalLabel: string;
  /** True when this version is `active` (the only state usable for creation). */
  isActive: boolean;
  /** True when Time Bank defaults are present AND enabled on the template. */
  timeBankEnabled: boolean;
  /** True when copied from a global template (traceability badge). */
  isCopy: boolean;
  updatedAt: string;
}

/** Builds a {@link TemplateListRow} from a template record. */
export function toTemplateListRow(template: AgreementTemplate): TemplateListRow {
  return {
    id: template.id,
    templateGroupId: template.templateGroupId,
    name: template.name,
    description: template.description ?? null,
    ownerLabel: AGREEMENT_TEMPLATE_OWNER_TYPE_LABELS[template.ownerType],
    ownerType: template.ownerType,
    statusLabel: AGREEMENT_TEMPLATE_STATUS_LABELS[template.status],
    status: template.status,
    version: template.version,
    billingLabel: BILLING_MODEL_LABELS[template.billingModel],
    invoiceIntervalLabel: INVOICE_INTERVAL_LABELS[template.invoiceInterval],
    isActive: template.status === "active",
    timeBankEnabled: Boolean(
      template.timeBankEligible && template.timeBankTemplateRules?.timeBankEnabled,
    ),
    isCopy: Boolean(template.copiedFromTemplateId),
    updatedAt: template.updatedAt,
  };
}

/**
 * Groups a flat template list by `templateGroupId` and keeps only the NEWEST
 * version of each group for the list view (the version chain is shown in
 * detail). Returns rows sorted by name (case-insensitive), then version.
 */
export function toLatestVersionRows(templates: AgreementTemplate[]): TemplateListRow[] {
  const latest = new Map<string, AgreementTemplate>();
  for (const t of templates) {
    const current = latest.get(t.templateGroupId);
    if (!current || t.version > current.version) latest.set(t.templateGroupId, t);
  }
  return [...latest.values()]
    .map(toTemplateListRow)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version);
}

// ── Template line rows ───────────────────────────────────────

/** A ready-to-render template line row. */
export interface TemplateLineRow {
  id: string;
  sortOrder: number;
  serviceName: string;
  categoryName: string | null;
  pricingModel: string;
  priceLabel: string;
  quantityLabel: string;
  durationLabel: string;
  active: boolean;
}

/** Builds a sorted list of {@link TemplateLineRow}s. */
export function toTemplateLineRows(lines: AgreementTemplateLine[]): TemplateLineRow[] {
  return [...lines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({
      id: l.id,
      sortOrder: l.sortOrder,
      serviceName: l.serviceNameSnapshot,
      categoryName: l.categoryNameSnapshot ?? null,
      pricingModel: l.pricingModel,
      priceLabel: l.defaultPrice != null ? String(l.defaultPrice) : "—",
      quantityLabel:
        l.defaultQuantity != null ? `${l.defaultQuantity}${l.unit ? ` ${l.unit}` : ""}` : "—",
      durationLabel:
        l.defaultDurationMinutes != null ? formatMinutes(l.defaultDurationMinutes) : "—",
      active: l.active,
    }));
}

// ── Time Bank defaults (read-only) ───────────────────────────

/** A ready-to-render summary of a template's Time Bank defaults. */
export interface TimeBankDefaultsView {
  /** True when the template both is eligible AND enables Time Bank. */
  enabled: boolean;
  allocationLabel: string;
  refillLabel: string;
  carryoverLabel: string;
  maxBalanceLabel: string;
  expiryLabel: string;
  negativeFloorLabel: string;
  warningLabel: string;
  criticalLabel: string;
}

/**
 * Formats a template's Time Bank defaults for display. When the template is not
 * eligible or has no rules, returns a disabled view with safe placeholders.
 */
export function toTimeBankDefaultsView(
  template: Pick<AgreementTemplate, "timeBankEligible" | "timeBankTemplateRules">,
): TimeBankDefaultsView {
  const rules: TimeBankTemplateRules | null = template.timeBankTemplateRules ?? null;
  const enabled = Boolean(template.timeBankEligible && rules?.timeBankEnabled);

  const threshold = (percent?: number | null, absolute?: number | null): string => {
    if (percent != null) return `${percent}%`;
    if (absolute != null) return formatMinutes(absolute);
    return "—";
  };

  return {
    enabled,
    allocationLabel:
      rules?.allocationMinutes != null ? formatMinutes(rules.allocationMinutes) : "—",
    refillLabel: rules?.refillFrequency
      ? TIME_BANK_REFILL_FREQUENCY_LABELS[rules.refillFrequency]
      : "—",
    carryoverLabel: rules?.carryoverPolicy
      ? TIME_BANK_CARRYOVER_POLICY_LABELS[rules.carryoverPolicy]
      : "—",
    maxBalanceLabel:
      rules?.maxBalanceMinutes != null ? formatMinutes(rules.maxBalanceMinutes) : "Uncapped",
    expiryLabel: rules?.expiryAfterDays != null ? `${rules.expiryAfterDays} days` : "No expiry",
    negativeFloorLabel:
      rules?.negativeFloorMinutes != null
        ? formatMinutes(-Math.abs(rules.negativeFloorMinutes))
        : "0m",
    warningLabel: threshold(rules?.warningThresholdPercent, rules?.warningThresholdMinutes),
    criticalLabel: threshold(rules?.criticalThresholdPercent, rules?.criticalThresholdMinutes),
  };
}

// ── Cancellation-credit defaults (read-only) ─────────────────

/** A ready-to-render summary of a template's cancellation-credit defaults. */
export interface CancellationDefaultsView {
  enabled: boolean;
  methodLabel: string;
  /** A human sentence describing the deduction, e.g. "30m per cancelled visit". */
  deductionDetail: string;
  minCreditLabel: string;
}

/**
 * Formats a template's cancellation-credit defaults for display. When unset or
 * disabled, returns a disabled view.
 */
export function toCancellationDefaultsView(
  policy: TimeBankCancellationPolicy | null | undefined,
): CancellationDefaultsView {
  if (!policy || !policy.enabled) {
    return {
      enabled: false,
      methodLabel: "Disabled",
      deductionDetail: "Cancelled visits do not credit the Time Bank.",
      minCreditLabel: "—",
    };
  }

  let deductionDetail = "Full remaining visit time is credited.";
  if (policy.deductionMethod === "fixed" && policy.deductionMinutes != null) {
    deductionDetail = `${formatMinutes(policy.deductionMinutes)} deducted per cancelled visit.`;
  } else if (policy.deductionMethod === "percentage" && policy.deductionPercent != null) {
    deductionDetail = `${policy.deductionPercent}% of the visit deducted per cancellation.`;
  }

  return {
    enabled: true,
    methodLabel: TIME_BANK_CANCELLATION_DEDUCTION_METHOD_LABELS[policy.deductionMethod],
    deductionDetail,
    minCreditLabel:
      policy.minCreditMinutes != null ? formatMinutes(policy.minCreditMinutes) : "—",
  };
}

// ── Version chain ────────────────────────────────────────────

/** A single entry in the version-chain display. */
export interface VersionChainEntry {
  id: string;
  version: number;
  statusLabel: string;
  status: AgreementTemplate["status"];
  /** True when this entry is the one currently being viewed. */
  isCurrent: boolean;
  updatedAt: string;
}

/**
 * Builds an ordered (oldest → newest) version-chain display for a template
 * group, marking the currently-viewed version.
 */
export function toVersionChain(
  chain: AgreementTemplate[],
  currentId: string,
): VersionChainEntry[] {
  return [...chain]
    .sort((a, b) => a.version - b.version)
    .map((t) => ({
      id: t.id,
      version: t.version,
      statusLabel: AGREEMENT_TEMPLATE_STATUS_LABELS[t.status],
      status: t.status,
      isCurrent: t.id === currentId,
      updatedAt: t.updatedAt,
    }));
}
