/**
 * Agreement Templates repository + row mappers (Phase 9 · persistence foundation).
 *
 * The server-side surface for reusable Agreement Templates — the BLUEPRINTS that
 * suggest default values for Customer Agreements. It mirrors the proven customers
 * (0007) / work_orders (0008) / customer_agreements (0013) / time_bank (0014)
 * conventions:
 *
 *   * flat, indexed columns for list / scope / version, plus a lossless
 *     `data jsonb` carrying the COMPLETE domain record for detail rebuild;
 *   * `legacy_id` (app-facing template/line id, also the idempotency key)
 *     + `company_legacy_id` query scope (NULL for global templates);
 *   * idempotent upsert-on-`legacy_id`, chunked for large template sets.
 *
 * Two ownership tiers share one entity (migration 0015):
 *   * GLOBAL templates have `company_id = null` (Super Admin owned, read by all).
 *   * COMPANY templates have a non-null `company_id` (Company Admin owned).
 *
 * Versioning is immutable: a new template version is a NEW row (new legacy_id);
 * old versions are never mutated, so an agreement created from an old version
 * stays reproducible. Archive is a status flip (no destructive delete).
 *
 * FOUNDATION ONLY — not wired to any UI; no activation, no production flip.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { AgreementTemplate, AgreementTemplateLine } from "@/types";
import type { DetailParams } from "./types";

// ── Upsert row shapes (write path + future migration share these) ──

/** A single upsert row written to the `agreement_templates` table. */
export interface AgreementTemplateUpsertRow {
  legacy_id: string;
  template_group_id: string;
  owner_type: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  description: string | null;
  version: number;
  status: string;
  billing_model: string;
  invoice_interval: string;
  time_bank_eligible: boolean;
  copied_from_template_id: string | null;
  supersedes_version_id: string | null;
  superseded_by_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  data: AgreementTemplate;
}

/** A single upsert row written to the `agreement_template_lines` table. */
export interface AgreementTemplateLineUpsertRow {
  legacy_id: string;
  template_legacy_id: string;
  template_group_id: string;
  owner_type: string;
  company_id: string | null;
  company_legacy_id: string | null;
  sort_order: number;
  source_service_id: string | null;
  service_name_snapshot: string;
  category_name_snapshot: string | null;
  pricing_model: string;
  billing_model_override: string | null;
  default_price: number | null;
  default_vat: number | null;
  default_quantity: number | null;
  default_duration_minutes: number | null;
  active: boolean;
  data: AgreementTemplateLine;
}

/**
 * Maps a domain {@link AgreementTemplate} to an `agreement_templates` upsert row.
 * Flat columns mirror the indexed/queryable fields; the full record is kept
 * losslessly in `data`. `companyUuid` is the resolved tenant UUID (null for
 * global templates).
 */
export function toAgreementTemplateUpsertRow(
  template: AgreementTemplate,
  companyUuid: string | null,
): AgreementTemplateUpsertRow {
  return {
    legacy_id: template.id,
    template_group_id: template.templateGroupId,
    owner_type: template.ownerType,
    company_id: companyUuid,
    company_legacy_id: template.companyId,
    name: template.name,
    description: template.description ?? null,
    version: template.version,
    status: template.status,
    billing_model: template.billingModel,
    invoice_interval: template.invoiceInterval,
    time_bank_eligible: template.timeBankEligible,
    copied_from_template_id: template.copiedFromTemplateId ?? null,
    supersedes_version_id: template.supersedesVersionId ?? null,
    superseded_by_id: template.supersededById ?? null,
    valid_from: template.validFrom ?? null,
    valid_to: template.validTo ?? null,
    data: template,
  };
}

/**
 * Maps a domain {@link AgreementTemplateLine} to an `agreement_template_lines`
 * upsert row. The full record is kept losslessly in `data`.
 */
export function toAgreementTemplateLineUpsertRow(
  line: AgreementTemplateLine,
  companyUuid: string | null,
): AgreementTemplateLineUpsertRow {
  return {
    legacy_id: line.id,
    template_legacy_id: line.templateId,
    template_group_id: line.templateGroupId,
    owner_type: line.ownerType,
    company_id: companyUuid,
    company_legacy_id: line.companyId,
    sort_order: line.sortOrder,
    source_service_id: line.sourceServiceId ?? null,
    service_name_snapshot: line.serviceNameSnapshot,
    category_name_snapshot: line.categoryNameSnapshot ?? null,
    pricing_model: line.pricingModel,
    billing_model_override: line.billingModelOverride ?? null,
    default_price: line.defaultPrice ?? null,
    default_vat: line.defaultVat ?? null,
    default_quantity: line.defaultQuantity ?? null,
    default_duration_minutes: line.defaultDurationMinutes ?? null,
    active: line.active,
    data: line,
  };
}

// ── Read DTOs + repository ────────────────────────────────

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "agreementTemplatesRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

interface TemplateDataRow {
  data: AgreementTemplate;
  company_legacy_id: string | null;
}

interface TemplateLineDataRow {
  data: AgreementTemplateLine;
}

/** Params for listing templates. */
export interface AgreementTemplateListParams {
  /** Restrict to a set of statuses (e.g. only `active`). */
  statuses?: AgreementTemplate["status"][];
}

/** Bounds payload size for large template sets — matches the agreements path. */
const WRITE_CHUNK = 200;

/** Scopes a maybe-null company legacy id against an optional company guard. */
function passesCompanyScope(
  rowCompanyLegacyId: string | null,
  guard: string | null | undefined,
): boolean {
  if (guard === undefined) return true;
  return rowCompanyLegacyId === guard;
}

/**
 * Server (Supabase) read + persistence surface for Agreement Templates.
 * Foundation only: NOT wired to any UI and performs no activation.
 */
export const supabaseAgreementTemplatesRepository = {
  /**
   * Upserts template rows on `legacy_id`, chunked. Idempotent: re-running
   * overwrites the same `legacy_id` (heals drift / flips status) rather than
   * duplicating. A new template VERSION is a different `legacy_id`, so this
   * never mutates a prior version's historical row.
   *
   * @returns the number of template rows written.
   */
  async upsertTemplates(
    templates: AgreementTemplate[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (templates.length === 0) return 0;
    const stop = perf.start("agreementTemplates.write.supabase.templates");
    try {
      const rows = templates.map((t) => toAgreementTemplateUpsertRow(t, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("agreement_templates")
          .upsert(chunk, { onConflict: "legacy_id" });
        if (error) {
          throw new Error(
            `[agreement_templates] Supabase template upsert failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /**
   * Upserts template LINE rows on `legacy_id`, chunked. Lines are immutable
   * snapshots — a new template version creates NEW line ids, so this never
   * mutates a prior version's historical lines.
   *
   * @returns the number of line rows written.
   */
  async upsertTemplateLines(
    lines: AgreementTemplateLine[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (lines.length === 0) return 0;
    const stop = perf.start("agreementTemplates.write.supabase.lines");
    try {
      const rows = lines.map((l) => toAgreementTemplateLineUpsertRow(l, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("agreement_template_lines")
          .upsert(chunk, { onConflict: "legacy_id" });
        if (error) {
          throw new Error(
            `[agreement_template_lines] Supabase line upsert failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /** A single template version by id, or null when missing / out of scope. */
  async getTemplateById(
    id: string,
    params: DetailParams = {},
  ): Promise<AgreementTemplate | null> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("agreement_templates")
      .select("data, company_legacy_id")
      .eq("legacy_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`[agreement_templates] Supabase detail failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as TemplateDataRow;
    // Global templates (company_legacy_id null) are visible to any scope.
    if (row.company_legacy_id !== null && !passesCompanyScope(row.company_legacy_id, params.companyId)) {
      return null;
    }
    return row.data;
  },

  /** All GLOBAL templates (company_id null), optionally filtered by status. */
  async listGlobalTemplates(
    params: AgreementTemplateListParams = {},
  ): Promise<AgreementTemplate[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("agreement_templates")
      .select("data, company_legacy_id")
      .eq("owner_type", "global");
    if (params.statuses && params.statuses.length > 0) {
      query = query.in("status", params.statuses);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[agreement_templates] Supabase global list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TemplateDataRow[];
    return rows.map((r) => r.data).filter((t): t is AgreementTemplate => Boolean(t));
  },

  /** All COMPANY templates for a company, optionally filtered by status. */
  async listCompanyTemplates(
    companyLegacyId: string,
    params: AgreementTemplateListParams = {},
  ): Promise<AgreementTemplate[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("agreement_templates")
      .select("data, company_legacy_id")
      .eq("company_legacy_id", companyLegacyId);
    if (params.statuses && params.statuses.length > 0) {
      query = query.in("status", params.statuses);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[agreement_templates] Supabase company list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TemplateDataRow[];
    return rows.map((r) => r.data).filter((t): t is AgreementTemplate => Boolean(t));
  },

  /**
   * All `active` templates a company may use to create an agreement: its own
   * active company templates PLUS all active global templates.
   */
  async listActiveTemplates(companyLegacyId: string): Promise<AgreementTemplate[]> {
    const [globals, company] = await Promise.all([
      this.listGlobalTemplates({ statuses: ["active"] }),
      this.listCompanyTemplates(companyLegacyId, { statuses: ["active"] }),
    ]);
    return [...globals, ...company];
  },

  /** Full ordered version chain (oldest → newest) for one template group. */
  async listVersionChain(
    templateGroupId: string,
    params: DetailParams = {},
  ): Promise<AgreementTemplate[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("agreement_templates")
      .select("data, company_legacy_id")
      .eq("template_group_id", templateGroupId)
      .order("version", { ascending: true });
    if (error) {
      throw new Error(`[agreement_templates] Supabase chain read failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TemplateDataRow[];
    return rows
      .filter((r) => r.company_legacy_id === null || passesCompanyScope(r.company_legacy_id, params.companyId))
      .map((r) => r.data)
      .filter((t): t is AgreementTemplate => Boolean(t));
  },

  /** Ordered lines (by sortOrder) for one template version. */
  async listLines(templateId: string): Promise<AgreementTemplateLine[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("agreement_template_lines")
      .select("data")
      .eq("template_legacy_id", templateId)
      .order("sort_order", { ascending: true });
    if (error) {
      throw new Error(`[agreement_template_lines] Supabase read failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TemplateLineDataRow[];
    return rows.map((r) => r.data).filter((l): l is AgreementTemplateLine => Boolean(l));
  },

  /**
   * A template plus its ordered lines, or null when the template is missing /
   * out of scope. Convenience for the Template → Agreement creation flow.
   */
  async getTemplateWithLines(
    id: string,
    params: DetailParams = {},
  ): Promise<{ template: AgreementTemplate; lines: AgreementTemplateLine[] } | null> {
    const template = await this.getTemplateById(id, params);
    if (!template) return null;
    const lines = await this.listLines(id);
    return { template, lines };
  },
};
