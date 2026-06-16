import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  supabaseChecklistTemplateRepository,
  type ChecklistTemplateAggregate,
} from "@/lib/data/supabaseChecklistTemplateRepository";
import type { ChecklistTemplateV2 } from "@/types";

export const CHECKLIST_TEMPLATE_READ_MODEL_QUERY_KEY = "checklist-template-read-model";
export const GLOBAL_CHECKLIST_TEMPLATE_READ_MODEL_QUERY_KEY = "global-checklist-template-read-model";
export const CHECKLIST_TEMPLATE_DETAIL_READ_MODEL_QUERY_KEY = "checklist-template-detail-read-model";

export interface ChecklistTemplateReadModelCounts {
  categories: number;
  floorPresets: number;
  sections: number;
  items: number;
}

export interface ChecklistTemplateReadModelResult {
  aggregates: ChecklistTemplateAggregate[];
  templates: ChecklistTemplateV2[];
  active: ChecklistTemplateV2[];
  archived: ChecklistTemplateV2[];
  counts: Record<string, ChecklistTemplateReadModelCounts>;
  isLoading: boolean;
  error: Error | null;
}

export interface ChecklistTemplateDetailReadModelResult {
  aggregate: ChecklistTemplateAggregate | null;
  template: ChecklistTemplateV2 | null;
  counts: ChecklistTemplateReadModelCounts | null;
  isLoading: boolean;
  error: Error | null;
}

function countChecklistTemplateAggregate(
  aggregate: ChecklistTemplateAggregate,
): ChecklistTemplateReadModelCounts {
  return {
    categories: aggregate.template.categoryIds.length,
    floorPresets: aggregate.template.floorPresetIds.length,
    sections: aggregate.sections.length,
    items: aggregate.items.length,
  };
}

function buildTemplateReadModel(
  aggregates: ChecklistTemplateAggregate[],
  isLoading: boolean,
  error: Error | null,
): ChecklistTemplateReadModelResult {
  const templates = aggregates.map((aggregate) => aggregate.template);
  const counts: Record<string, ChecklistTemplateReadModelCounts> = {};
  for (const aggregate of aggregates) {
    counts[aggregate.template.id] = countChecklistTemplateAggregate(aggregate);
  }
  return {
    aggregates,
    templates,
    active: templates.filter((template) => !template.isArchived),
    archived: templates.filter((template) => template.isArchived),
    counts,
    isLoading,
    error,
  };
}

/**
 * Supabase-only company+global checklist template read model. Empty Supabase
 * reads remain empty; this hook never reads browser storage or lazy seeds data.
 */
export function useChecklistTemplateReadModel(
  companyId: string | null | undefined,
): ChecklistTemplateReadModelResult {
  const enabled = Boolean(companyId);
  const query = useQuery<ChecklistTemplateAggregate[], Error>({
    queryKey: [CHECKLIST_TEMPLATE_READ_MODEL_QUERY_KEY, companyId ?? null],
    queryFn: () =>
      supabaseChecklistTemplateRepository.listCompanyAndGlobal(companyId!, {
        includeArchived: true,
      }),
    enabled,
  });

  const aggregates = query.data ?? [];
  return useMemo(
    () => buildTemplateReadModel(aggregates, query.isLoading, query.error ?? null),
    [aggregates, query.error, query.isLoading],
  );
}

/** Supabase-only global checklist template list read model. */
export function useGlobalChecklistTemplateReadModel(): ChecklistTemplateReadModelResult {
  const query = useQuery<ChecklistTemplateAggregate[], Error>({
    queryKey: [GLOBAL_CHECKLIST_TEMPLATE_READ_MODEL_QUERY_KEY],
    queryFn: () =>
      supabaseChecklistTemplateRepository.listGlobal({ includeArchived: true }),
  });

  const aggregates = query.data ?? [];
  return useMemo(
    () => buildTemplateReadModel(aggregates, query.isLoading, query.error ?? null),
    [aggregates, query.error, query.isLoading],
  );
}

/** Supabase-only checklist template detail read model. Missing rows return null. */
export function useChecklistTemplateDetailReadModel(
  companyId: string | null | undefined,
  legacyId: string | null | undefined,
): ChecklistTemplateDetailReadModelResult {
  const enabled = Boolean(companyId && legacyId);
  const query = useQuery<ChecklistTemplateAggregate | null, Error>({
    queryKey: [
      CHECKLIST_TEMPLATE_DETAIL_READ_MODEL_QUERY_KEY,
      companyId ?? null,
      legacyId ?? null,
    ],
    queryFn: () =>
      supabaseChecklistTemplateRepository.getByLegacyId(legacyId!, {
        companyId: companyId!,
        includeArchived: true,
      }),
    enabled,
  });

  const aggregate = query.data ?? null;
  return useMemo<ChecklistTemplateDetailReadModelResult>(() => {
    return {
      aggregate,
      template: aggregate?.template ?? null,
      counts: aggregate ? countChecklistTemplateAggregate(aggregate) : null,
      isLoading: query.isLoading,
      error: query.error ?? null,
    };
  }, [aggregate, query.error, query.isLoading]);
}
