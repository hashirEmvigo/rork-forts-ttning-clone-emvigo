import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  archiveCalculatorAddon,
  archiveCalculatorService,
  archiveCalculatorSizeBand,
  archiveCleaningPlan,
  createCalculatorAddon,
  createCalculatorQuestion,
  createAddonLibraryItem,
  createCalculatorService,
  createCalculatorSizeBand,
  createCleaningPlan,
  createQuestionLibraryItem,
  getCalculatorConfig,
  listAddonLibraryItems,
  listPricingRuleAuditEvents,
  listQuestionLibraryItems,
  setDefaultCleaningPlan,
  updateCalculatorAddon,
  updateCalculatorQuestion,
  updateCalculatorService,
  updateCalculatorSettingsConfig,
  updateCalculatorSizeBand,
  updateCleaningPlan,
  updatePricingRuleValue,
  type CalculatorAddonPatch,
  type CalculatorConfig,
  type NewAddonInput,
  type NewAddonLibraryItemInput,
  type NewPlanInput,
  type NewQuestionInput,
  type NewQuestionLibraryItemInput,
  type NewServiceInput,
  type NewSizeBandInput,
  type PlanPatch,
  type PricingRuleAuditEntry,
  type PricingRuleValueChange,
  type QuestionPatch,
  type ServicePatch,
  type SetDefaultPlanInput,
  type SettingsPatch,
  type SizeBandPatch,
} from "@/lib/calculator/calculatorConfigAdmin";
import type { AddonLibraryItem, QuestionLibraryItem } from "@/lib/calculator/libraryItems";
import { CALCULATOR_ADMIN_QUERY_KEY } from "@/hooks/use-calculator-admin";

/** Shared React Query key for the Super Admin calculator configuration editor. */
export const CALCULATOR_CONFIG_QUERY_KEY = ["calculator-config-admin"] as const;

/** Shared React Query key for the pricing-rule audit history (per company). */
export const CALCULATOR_PRICING_RULE_AUDIT_QUERY_KEY = ["calculator-pricing-rule-audit"] as const;

/** Shared React Query key for the reusable question library items (per company). */
export const CALCULATOR_QUESTION_LIBRARY_QUERY_KEY = ["calculator-question-library"] as const;

/** Shared React Query key for the reusable add-on library items (per company). */
export const CALCULATOR_ADDON_LIBRARY_QUERY_KEY = ["calculator-addon-library"] as const;

/** Recent pricing-rule changes for the Pricing Rules tab history. */
export interface PricingRuleAuditView {
  entries: PricingRuleAuditEntry[];
  isLoading: boolean;
  error: Error | null;
}

export interface UseCalculatorConfigResult {
  config: CalculatorConfig | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  /** True while any config write is in flight. */
  isSaving: boolean;
  saveService: (legacyId: string, patch: ServicePatch) => Promise<void>;
  addService: (input: NewServiceInput) => Promise<void>;
  archiveService: (legacyId: string) => Promise<void>;
  saveQuestion: (legacyId: string, patch: QuestionPatch) => Promise<void>;
  addQuestion: (input: NewQuestionInput) => Promise<void>;
  savePlan: (legacyId: string, patch: PlanPatch) => Promise<void>;
  /** Promote one plan to default (clears sibling defaults + mirrors the legacy default key). */
  setDefaultPlan: (input: SetDefaultPlanInput) => Promise<void>;
  addPlan: (input: NewPlanInput) => Promise<void>;
  archivePlan: (legacyId: string) => Promise<void>;
  saveSettings: (legacyId: string, patch: SettingsPatch) => Promise<void>;
  saveSizeBand: (legacyId: string, patch: SizeBandPatch) => Promise<void>;
  addSizeBand: (input: NewSizeBandInput) => Promise<void>;
  archiveSizeBand: (legacyId: string) => Promise<void>;
  /** Create a generic add-on (Slice V2-E0E-1; no UI consumes it yet). */
  addAddon: (input: NewAddonInput) => Promise<void>;
  /** Update one add-on's safe fields (effects + lifecycle). */
  saveAddon: (legacyId: string, patch: CalculatorAddonPatch) => Promise<void>;
  /** Archive (soft-delete) one add-on. */
  archiveAddon: (legacyId: string) => Promise<void>;
  /** Edit one pricing-rule value (+ append-only audit). */
  savePricingRuleValue: (change: PricingRuleValueChange) => Promise<void>;
  /** Recent pricing-rule changes (newest first). */
  pricingRuleAudit: PricingRuleAuditView;
  /**
   * GPM-CALC-LIBRARY-3 — reusable question library items for the loaded company
   * (empty until any are authored/backfilled). Used by the Questions section to
   * offer library questions for per-service activation.
   */
  questionLibraryItems: QuestionLibraryItem[];
  /** Save a question to the reusable library (createQuestionLibraryItem). */
  saveQuestionToLibrary: (input: NewQuestionLibraryItemInput) => Promise<void>;
  /**
   * GPM-CALC-LIBRARY-4 — reusable add-on library items for the loaded company
   * (empty until any are authored/backfilled). Used by the Add-ons subsection to
   * offer library add-ons for per-service activation.
   */
  addonLibraryItems: AddonLibraryItem[];
  /** Save an add-on to the reusable library (createAddonLibraryItem). */
  saveAddonToLibrary: (input: NewAddonLibraryItemInput) => Promise<void>;
}

/**
 * Loads the full editable calculator configuration (Supabase-authoritative,
 * gated by super_admin RLS) and exposes the safe, scoped write operations the
 * Super Admin editor uses. Every successful write invalidates BOTH this config
 * query and the overview query so the page re-reads the authoritative state
 * (never trusting local UI) and the summary counts stay in sync.
 */
export function useCalculatorConfig(): UseCalculatorConfigResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CALCULATOR_CONFIG_QUERY_KEY,
    queryFn: () => getCalculatorConfig(),
  });

  // Audit history is scoped to the loaded config's company; it only runs once the
  // config has resolved a company so the read is always correctly scoped.
  const companyLegacyId = query.data?.settings.companyLegacyId ?? null;
  const auditQuery = useQuery({
    queryKey: [...CALCULATOR_PRICING_RULE_AUDIT_QUERY_KEY, companyLegacyId],
    queryFn: () => listPricingRuleAuditEvents(companyLegacyId as string),
    enabled: companyLegacyId !== null,
  });

  // Reusable question library items, scoped to the loaded company. Runs only once
  // the config has resolved a companyId so the read is always correctly scoped.
  const companyId = query.data?.settings.companyId ?? null;
  const questionLibraryQuery = useQuery({
    queryKey: [...CALCULATOR_QUESTION_LIBRARY_QUERY_KEY, companyId],
    queryFn: () => listQuestionLibraryItems(companyId as string),
    enabled: companyId !== null,
  });

  const addonLibraryQuery = useQuery({
    queryKey: [...CALCULATOR_ADDON_LIBRARY_QUERY_KEY, companyId],
    queryFn: () => listAddonLibraryItems(companyId as string),
    enabled: companyId !== null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CALCULATOR_CONFIG_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: CALCULATOR_ADMIN_QUERY_KEY });
  };

  const invalidateWithQuestionLibrary = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: CALCULATOR_QUESTION_LIBRARY_QUERY_KEY });
  };

  const invalidateWithAddonLibrary = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: CALCULATOR_ADDON_LIBRARY_QUERY_KEY });
  };

  const invalidateWithAudit = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: CALCULATOR_PRICING_RULE_AUDIT_QUERY_KEY });
  };

  const serviceMutation = useMutation({
    mutationFn: ({ legacyId, patch }: { legacyId: string; patch: ServicePatch }) =>
      updateCalculatorService(legacyId, patch),
    onSuccess: invalidate,
  });

  const addServiceMutation = useMutation({
    mutationFn: (input: NewServiceInput) => createCalculatorService(input),
    onSuccess: invalidate,
  });

  const archiveServiceMutation = useMutation({
    mutationFn: (legacyId: string) => archiveCalculatorService(legacyId),
    onSuccess: invalidate,
  });

  const questionMutation = useMutation({
    mutationFn: ({ legacyId, patch }: { legacyId: string; patch: QuestionPatch }) =>
      updateCalculatorQuestion(legacyId, patch),
    onSuccess: invalidate,
  });

  const addQuestionMutation = useMutation({
    mutationFn: (input: NewQuestionInput) => createCalculatorQuestion(input),
    onSuccess: invalidate,
  });

  const planMutation = useMutation({
    mutationFn: ({ legacyId, patch }: { legacyId: string; patch: PlanPatch }) =>
      updateCleaningPlan(legacyId, patch),
    onSuccess: invalidate,
  });

  const setDefaultPlanMutation = useMutation({
    mutationFn: (input: SetDefaultPlanInput) => setDefaultCleaningPlan(input),
    onSuccess: invalidate,
  });

  const addPlanMutation = useMutation({
    mutationFn: (input: NewPlanInput) => createCleaningPlan(input),
    onSuccess: invalidate,
  });

  const archivePlanMutation = useMutation({
    mutationFn: (legacyId: string) => archiveCleaningPlan(legacyId),
    onSuccess: invalidate,
  });

  const settingsMutation = useMutation({
    mutationFn: ({ legacyId, patch }: { legacyId: string; patch: SettingsPatch }) =>
      updateCalculatorSettingsConfig(legacyId, patch),
    onSuccess: invalidate,
  });

  const sizeBandMutation = useMutation({
    mutationFn: ({ legacyId, patch }: { legacyId: string; patch: SizeBandPatch }) =>
      updateCalculatorSizeBand(legacyId, patch),
    onSuccess: invalidate,
  });

  const addSizeBandMutation = useMutation({
    mutationFn: (input: NewSizeBandInput) => createCalculatorSizeBand(input),
    onSuccess: invalidate,
  });

  const archiveSizeBandMutation = useMutation({
    mutationFn: (legacyId: string) => archiveCalculatorSizeBand(legacyId),
    onSuccess: invalidate,
  });

  const addAddonMutation = useMutation({
    mutationFn: (input: NewAddonInput) => createCalculatorAddon(input),
    onSuccess: invalidate,
  });

  const addonMutation = useMutation({
    mutationFn: ({ legacyId, patch }: { legacyId: string; patch: CalculatorAddonPatch }) =>
      updateCalculatorAddon(legacyId, patch),
    onSuccess: invalidate,
  });

  const archiveAddonMutation = useMutation({
    mutationFn: (legacyId: string) => archiveCalculatorAddon(legacyId),
    onSuccess: invalidate,
  });

  const pricingRuleMutation = useMutation({
    mutationFn: (change: PricingRuleValueChange) => updatePricingRuleValue(change),
    onSuccess: invalidateWithAudit,
  });

  const saveQuestionToLibraryMutation = useMutation({
    mutationFn: (input: NewQuestionLibraryItemInput) => createQuestionLibraryItem(input),
    onSuccess: invalidateWithQuestionLibrary,
  });

  const saveAddonToLibraryMutation = useMutation({
    mutationFn: (input: NewAddonLibraryItemInput) => createAddonLibraryItem(input),
    onSuccess: invalidateWithAddonLibrary,
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: () => {
      void query.refetch();
    },
    isSaving:
      serviceMutation.isPending ||
      addServiceMutation.isPending ||
      archiveServiceMutation.isPending ||
      questionMutation.isPending ||
      addQuestionMutation.isPending ||
      planMutation.isPending ||
      setDefaultPlanMutation.isPending ||
      addPlanMutation.isPending ||
      archivePlanMutation.isPending ||
      settingsMutation.isPending ||
      sizeBandMutation.isPending ||
      addSizeBandMutation.isPending ||
      archiveSizeBandMutation.isPending ||
      addAddonMutation.isPending ||
      addonMutation.isPending ||
      archiveAddonMutation.isPending ||
      pricingRuleMutation.isPending,
    saveService: (legacyId, patch) => serviceMutation.mutateAsync({ legacyId, patch }),
    addService: (input) => addServiceMutation.mutateAsync(input),
    archiveService: (legacyId) => archiveServiceMutation.mutateAsync(legacyId),
    saveQuestion: (legacyId, patch) => questionMutation.mutateAsync({ legacyId, patch }),
    addQuestion: (input) => addQuestionMutation.mutateAsync(input),
    savePlan: (legacyId, patch) => planMutation.mutateAsync({ legacyId, patch }),
    setDefaultPlan: (input) => setDefaultPlanMutation.mutateAsync(input),
    addPlan: (input) => addPlanMutation.mutateAsync(input),
    archivePlan: (legacyId) => archivePlanMutation.mutateAsync(legacyId),
    saveSettings: (legacyId, patch) => settingsMutation.mutateAsync({ legacyId, patch }),
    saveSizeBand: (legacyId, patch) => sizeBandMutation.mutateAsync({ legacyId, patch }),
    addSizeBand: (input) => addSizeBandMutation.mutateAsync(input),
    archiveSizeBand: (legacyId) => archiveSizeBandMutation.mutateAsync(legacyId),
    addAddon: (input) => addAddonMutation.mutateAsync(input),
    saveAddon: (legacyId, patch) => addonMutation.mutateAsync({ legacyId, patch }),
    archiveAddon: (legacyId) => archiveAddonMutation.mutateAsync(legacyId),
    savePricingRuleValue: (change) => pricingRuleMutation.mutateAsync(change),
    pricingRuleAudit: {
      entries: auditQuery.data ?? [],
      isLoading: auditQuery.isLoading,
      error: auditQuery.error as Error | null,
    },
    questionLibraryItems: questionLibraryQuery.data ?? [],
    saveQuestionToLibrary: (input) => saveQuestionToLibraryMutation.mutateAsync(input),
    addonLibraryItems: addonLibraryQuery.data ?? [],
    saveAddonToLibrary: (input) => saveAddonToLibraryMutation.mutateAsync(input),
  };
}
