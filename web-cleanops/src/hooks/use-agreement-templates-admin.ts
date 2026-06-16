/**
 * useAgreementTemplatesAdmin — the container hook for the Super Admin Agreement
 * Templates management page (Phase 15 · first management UI surface).
 *
 * Owns ALL repository I/O so the page stays presentation-only:
 *   * loads the GLOBAL template library (all statuses);
 *   * optionally loads one company's templates when a company is selected;
 *   * loads the selected template's detail (header + ordered lines) and its
 *     full version chain (oldest → newest);
 *   * exposes the small, safe write actions the foundation UI offers:
 *     create / edit a GLOBAL template, add or deactivate a line, publish a
 *     draft, archive a template, and copy a global template into a company.
 *
 * SAFETY (foundation UI only — admin-only, not verified, not customer-facing):
 *   * It NEVER creates a Customer Agreement and NEVER provisions a Time Bank
 *     wallet — it only manages the BLUEPRINTS.
 *   * Versioning stays immutable: editing re-persists the SAME template row
 *     (idempotent on legacy_id) and never mutates a different version.
 *   * Archive is a status flip (never a destructive delete).
 *   * When Supabase is unconfigured it resolves to an empty, non-error state so
 *     the page renders a clean disabled surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  archiveTemplate,
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  copyGlobalTemplateToCompany,
  persistTemplate,
  supabaseAgreementTemplatesRepository,
  type BuildAgreementTemplateInput,
} from "@/lib/data";
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  BillingModel,
  InvoiceInterval,
  TimeBankTemplateRules,
} from "@/types";

/** A fully-loaded template detail bundle. */
export interface TemplateDetail {
  template: AgreementTemplate;
  lines: AgreementTemplateLine[];
  versionChain: AgreementTemplate[];
}

/** Inputs for creating a new GLOBAL template (header only). */
export interface CreateGlobalTemplateInput {
  name: string;
  description?: string;
  billingModel?: BillingModel;
  invoiceInterval?: InvoiceInterval;
  timeBankEligible?: boolean;
  timeBankTemplateRules?: TimeBankTemplateRules | null;
}

/** Editable header fields for an existing template. */
export interface EditTemplateInput {
  name?: string;
  description?: string | null;
  billingModel?: BillingModel;
  invoiceInterval?: InvoiceInterval;
  timeBankEligible?: boolean;
  timeBankTemplateRules?: TimeBankTemplateRules | null;
}

/** Inputs for adding a service line to a template. */
export interface AddTemplateLineInput {
  serviceNameSnapshot: string;
  categoryNameSnapshot?: string | null;
  defaultPrice?: number | null;
  defaultQuantity?: number | null;
  unit?: string;
  defaultDurationMinutes?: number | null;
}

/** The result returned to the page. */
export interface AgreementTemplatesAdminResult {
  /** All global templates (every status), or empty when none / disabled. */
  globalTemplates: AgreementTemplate[];
  /** Templates for {@link selectedCompanyId}, or empty when none selected. */
  companyTemplates: AgreementTemplate[];
  /** Currently-selected company scope (null = none). */
  selectedCompanyId: string | null;
  /** The selected template detail, or null when none selected. */
  detail: TemplateDetail | null;
  /** True while a list / detail read is in flight. */
  loading: boolean;
  /** True while a write action is in flight. */
  pending: boolean;
  /** A load error message, or null. */
  loadError: string | null;
  /** A write-action error message, or null. */
  actionError: string | null;
  /** True when Supabase is configured (the surface is usable). */
  enabled: boolean;

  /** Select a company to load its templates (null clears). */
  selectCompany: (companyId: string | null) => void;
  /** Open one template version's detail (null clears). */
  selectTemplate: (templateId: string | null) => void;
  /** Re-read the lists + detail. */
  reload: () => void;

  /** Create a new GLOBAL template (draft). */
  createGlobalTemplate: (input: CreateGlobalTemplateInput) => Promise<boolean>;
  /** Edit the selected template's header (re-persists the same version). */
  editTemplate: (templateId: string, patch: EditTemplateInput) => Promise<boolean>;
  /** Append an active service line to a template. */
  addLine: (templateId: string, input: AddTemplateLineInput) => Promise<boolean>;
  /** Deactivate a line (kept for history; not destroyed). */
  deactivateLine: (templateId: string, lineId: string) => Promise<boolean>;
  /** Publish a draft template (status → active). */
  publishTemplate: (templateId: string) => Promise<boolean>;
  /** Archive a template (status → inactive; never deleted). */
  archive: (templateId: string) => Promise<boolean>;
  /** Copy a global template into a company (independent draft copy). */
  copyToCompany: (sourceTemplateId: string, targetCompanyId: string, name?: string) => Promise<boolean>;
}

const EMPTY_TEMPLATES: AgreementTemplate[] = [];

export function useAgreementTemplatesAdmin(): AgreementTemplatesAdminResult {
  const enabled = isSupabaseConfigured;

  const [globalTemplates, setGlobalTemplates] = useState<AgreementTemplate[]>(EMPTY_TEMPLATES);
  const [companyTemplates, setCompanyTemplates] = useState<AgreementTemplate[]>(EMPTY_TEMPLATES);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [pending, setPending] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requestSeq = useRef<number>(0);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // ── Load lists ─────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setGlobalTemplates(EMPTY_TEMPLATES);
      setCompanyTemplates(EMPTY_TEMPLATES);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    void (async () => {
      const stop = perf.start("agreementTemplates.admin.list.read");
      try {
        const globals = await supabaseAgreementTemplatesRepository.listGlobalTemplates();
        const company = selectedCompanyId
          ? await supabaseAgreementTemplatesRepository.listCompanyTemplates(selectedCompanyId)
          : EMPTY_TEMPLATES;
        if (seq !== requestSeq.current) return;
        setGlobalTemplates(globals);
        setCompanyTemplates(company);
        setLoadError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setGlobalTemplates(EMPTY_TEMPLATES);
        setCompanyTemplates(EMPTY_TEMPLATES);
        setLoadError(err instanceof Error ? err.message : "Failed to load templates.");
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [enabled, selectedCompanyId, reloadToken]);

  // ── Load detail ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !selectedTemplateId) {
      setDetail(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    void (async () => {
      const stop = perf.start("agreementTemplates.admin.detail.read");
      try {
        const loaded = await supabaseAgreementTemplatesRepository.getTemplateWithLines(
          selectedTemplateId,
        );
        if (seq !== requestSeq.current) return;
        if (!loaded) {
          setDetail(null);
          setLoadError(null);
          return;
        }
        const versionChain = await supabaseAgreementTemplatesRepository.listVersionChain(
          loaded.template.templateGroupId,
        );
        if (seq !== requestSeq.current) return;
        setDetail({ template: loaded.template, lines: loaded.lines, versionChain });
        setLoadError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setDetail(null);
        setLoadError(err instanceof Error ? err.message : "Failed to load the template.");
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [enabled, selectedTemplateId, reloadToken]);

  const selectCompany = useCallback((companyId: string | null) => {
    setSelectedCompanyId(companyId);
  }, []);

  const selectTemplate = useCallback((templateId: string | null) => {
    setActionError(null);
    setSelectedTemplateId(templateId);
  }, []);

  /** Runs a write action with shared pending/error handling + reload. */
  const runAction = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
      if (!enabled) {
        setActionError("Supabase is not configured — actions are unavailable.");
        return false;
      }
      setPending(true);
      setActionError(null);
      try {
        const res = await fn();
        if (!res.ok) {
          setActionError(res.error ?? "The action failed.");
          return false;
        }
        reload();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "The action failed.");
        return false;
      } finally {
        setPending(false);
      }
    },
    [enabled, reload],
  );

  const createGlobalTemplate = useCallback(
    (input: CreateGlobalTemplateInput) =>
      runAction(async () => {
        const buildInput: BuildAgreementTemplateInput = {
          ownerType: "global",
          companyId: null,
          name: input.name,
          description: input.description,
          billingModel: input.billingModel,
          invoiceInterval: input.invoiceInterval,
          timeBankEligible: input.timeBankEligible,
          timeBankTemplateRules: input.timeBankTemplateRules ?? null,
          status: "draft",
        };
        const template = buildAgreementTemplate(buildInput);
        return persistTemplate({ template, lines: [] });
      }),
    [runAction],
  );

  const editTemplate = useCallback(
    (templateId: string, patch: EditTemplateInput) =>
      runAction(async () => {
        const existing = await supabaseAgreementTemplatesRepository.getTemplateById(templateId);
        if (!existing) return { ok: false, error: "Template not found." };
        const next: AgreementTemplate = {
          ...existing,
          name: patch.name ?? existing.name,
          description: patch.description === undefined ? existing.description : patch.description ?? undefined,
          billingModel: patch.billingModel ?? existing.billingModel,
          invoiceInterval: patch.invoiceInterval ?? existing.invoiceInterval,
          timeBankEligible: patch.timeBankEligible ?? existing.timeBankEligible,
          timeBankTemplateRules:
            patch.timeBankTemplateRules === undefined
              ? existing.timeBankTemplateRules
              : patch.timeBankTemplateRules,
          updatedAt: new Date().toISOString(),
        };
        return persistTemplate({ template: next, lines: [] });
      }),
    [runAction],
  );

  const addLine = useCallback(
    (templateId: string, input: AddTemplateLineInput) =>
      runAction(async () => {
        const loaded = await supabaseAgreementTemplatesRepository.getTemplateWithLines(templateId);
        if (!loaded) return { ok: false, error: "Template not found." };
        const { template, lines } = loaded;
        const nextSort = lines.reduce((max, l) => Math.max(max, l.sortOrder), -1) + 1;
        const line = buildAgreementTemplateLine({
          templateId: template.id,
          templateGroupId: template.templateGroupId,
          ownerType: template.ownerType,
          companyId: template.companyId,
          sortOrder: nextSort,
          serviceNameSnapshot: input.serviceNameSnapshot,
          categoryNameSnapshot: input.categoryNameSnapshot ?? null,
          defaultPrice: input.defaultPrice ?? null,
          defaultQuantity: input.defaultQuantity ?? null,
          unit: input.unit,
          defaultDurationMinutes: input.defaultDurationMinutes ?? null,
        });
        return persistTemplate({ template, lines: [line] });
      }),
    [runAction],
  );

  const deactivateLine = useCallback(
    (templateId: string, lineId: string) =>
      runAction(async () => {
        const loaded = await supabaseAgreementTemplatesRepository.getTemplateWithLines(templateId);
        if (!loaded) return { ok: false, error: "Template not found." };
        const target = loaded.lines.find((l) => l.id === lineId);
        if (!target) return { ok: false, error: "Line not found." };
        const next: AgreementTemplateLine = {
          ...target,
          active: false,
          updatedAt: new Date().toISOString(),
        };
        return persistTemplate({ template: loaded.template, lines: [next] });
      }),
    [runAction],
  );

  const publishTemplate = useCallback(
    (templateId: string) =>
      runAction(async () => {
        const existing = await supabaseAgreementTemplatesRepository.getTemplateById(templateId);
        if (!existing) return { ok: false, error: "Template not found." };
        const next: AgreementTemplate = {
          ...existing,
          status: "active",
          updatedAt: new Date().toISOString(),
        };
        return persistTemplate({ template: next, lines: [] });
      }),
    [runAction],
  );

  const archive = useCallback(
    (templateId: string) =>
      runAction(() => archiveTemplate({ templateId, now: new Date().toISOString() })),
    [runAction],
  );

  const copyToCompany = useCallback(
    (sourceTemplateId: string, targetCompanyId: string, name?: string) =>
      runAction(() =>
        copyGlobalTemplateToCompany({ sourceTemplateId, targetCompanyId, name }),
      ),
    [runAction],
  );

  return useMemo<AgreementTemplatesAdminResult>(
    () => ({
      globalTemplates,
      companyTemplates,
      selectedCompanyId,
      detail,
      loading,
      pending,
      loadError,
      actionError,
      enabled,
      selectCompany,
      selectTemplate,
      reload,
      createGlobalTemplate,
      editTemplate,
      addLine,
      deactivateLine,
      publishTemplate,
      archive,
      copyToCompany,
    }),
    [
      globalTemplates,
      companyTemplates,
      selectedCompanyId,
      detail,
      loading,
      pending,
      loadError,
      actionError,
      enabled,
      selectCompany,
      selectTemplate,
      reload,
      createGlobalTemplate,
      editTemplate,
      addLine,
      deactivateLine,
      publishTemplate,
      archive,
      copyToCompany,
    ],
  );
}
