import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  CHECKLIST_TEMPLATE_DETAIL_READ_MODEL_QUERY_KEY,
  CHECKLIST_TEMPLATE_READ_MODEL_QUERY_KEY,
} from "@/hooks/use-checklist-template-read-model";
import {
  supabaseChecklistTemplateRepository,
  type ChecklistTemplateAggregate,
} from "@/lib/data/supabaseChecklistTemplateRepository";
import {
  CHECKLIST_V2_SCHEMA_VERSION,
  type ChecklistItem,
  type ChecklistSection,
  type ChecklistTemplateV2,
  type TemplateAudience,
} from "@/types";

export interface ChecklistTemplateMetadataInput {
  name: string;
  description?: string;
  audience?: TemplateAudience;
}

type ChecklistTemplateMutationOperation =
  | { type: "create"; input: ChecklistTemplateMetadataInput }
  | { type: "updateMetadata"; template: ChecklistTemplateV2; input: ChecklistTemplateMetadataInput }
  | {
      type: "updateSectionsAndItems";
      template: ChecklistTemplateV2;
      sections: ChecklistSection[];
      items: ChecklistItem[];
    }
  | { type: "archive"; legacyId: string }
  | { type: "restore"; legacyId: string };

export interface UseChecklistTemplateMutationsResult {
  createEmptyCompanyTemplate: (input: ChecklistTemplateMetadataInput) => Promise<ChecklistTemplateAggregate | null>;
  updateMetadata: (
    template: ChecklistTemplateV2,
    input: ChecklistTemplateMetadataInput,
  ) => Promise<ChecklistTemplateAggregate | null>;
  updateSectionsAndItems: (
    template: ChecklistTemplateV2,
    sections: ChecklistSection[],
    items: ChecklistItem[],
  ) => Promise<ChecklistTemplateAggregate | null>;
  archive: (legacyId: string) => Promise<ChecklistTemplateAggregate | null>;
  restore: (legacyId: string) => Promise<ChecklistTemplateAggregate | null>;
  isPending: boolean;
  error: Error | null;
}

function createLegacyId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}_${randomUuid.replace(/-/g, "").slice(0, 18)}`;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function normalizeMetadataInput(input: ChecklistTemplateMetadataInput): ChecklistTemplateMetadataInput {
  return {
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    audience: input.audience,
  };
}

/**
 * Supabase-only company checklist-template mutations for the A3.3.1 write slice.
 * This hook never reads browser storage, never calls the legacy template store,
 * and fails closed when the app-facing company id cannot be resolved to a real
 * Supabase companies.id UUID.
 */
export function useChecklistTemplateMutations(
  companyId: string | null | undefined,
): UseChecklistTemplateMutationsResult {
  const queryClient = useQueryClient();

  const invalidateTemplateReads = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [CHECKLIST_TEMPLATE_READ_MODEL_QUERY_KEY, companyId ?? null],
      }),
      queryClient.invalidateQueries({
        queryKey: [CHECKLIST_TEMPLATE_DETAIL_READ_MODEL_QUERY_KEY],
      }),
    ]);
  }, [companyId, queryClient]);

  const mutation = useMutation<ChecklistTemplateAggregate | null, Error, ChecklistTemplateMutationOperation>({
    mutationFn: async (operation) => {
      if (!companyId) {
        throw new Error("Company scope is required before checklist templates can be saved.");
      }

      if (operation.type === "create") {
        const companyUuid = await supabaseChecklistTemplateRepository.resolveCompanyUuidByLegacyId(companyId);
        if (!companyUuid) {
          throw new Error("Could not resolve this company in Supabase. Template was not saved.");
        }
        const now = new Date().toISOString();
        const input = normalizeMetadataInput(operation.input);
        const templateId = createLegacyId("ctpl");
        const aggregate: ChecklistTemplateAggregate = {
          template: {
            id: templateId,
            companyId,
            scope: "company",
            name: input.name,
            description: input.description,
            audience: input.audience,
            categoryIds: [],
            floorPresetIds: [],
            sortOrder: 0,
            isArchived: false,
            createdAt: now,
            updatedAt: now,
            originType: "company",
            version: 1,
            schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
          },
          sections: [],
          items: [],
        };
        return supabaseChecklistTemplateRepository.createAggregate(aggregate, { companyUuid });
      }

      if (operation.type === "updateMetadata") {
        const input = normalizeMetadataInput(operation.input);
        return supabaseChecklistTemplateRepository.updateMetadata(
          operation.template.id,
          {
            name: input.name,
            description: input.description,
            audience: input.audience,
            categoryIds: operation.template.categoryIds,
            floorPresetIds: operation.template.floorPresetIds,
          },
          { companyId, scope: "company", includeArchived: true },
        );
      }

      if (operation.type === "updateSectionsAndItems") {
        return supabaseChecklistTemplateRepository.updateSectionsAndItems(
          operation.template.id,
          operation.sections,
          operation.items,
          { companyId, scope: "company", includeArchived: true },
        );
      }

      if (operation.type === "archive") {
        return supabaseChecklistTemplateRepository.archive(operation.legacyId, {
          companyId,
          scope: "company",
          includeArchived: true,
        });
      }

      return supabaseChecklistTemplateRepository.restore(operation.legacyId, {
        companyId,
        scope: "company",
        includeArchived: true,
      });
    },
    onSuccess: invalidateTemplateReads,
  });

  return {
    createEmptyCompanyTemplate: (input) => mutation.mutateAsync({ type: "create", input }),
    updateMetadata: (template, input) =>
      mutation.mutateAsync({ type: "updateMetadata", template, input }),
    updateSectionsAndItems: (template, sections, items) =>
      mutation.mutateAsync({ type: "updateSectionsAndItems", template, sections, items }),
    archive: (legacyId) => mutation.mutateAsync({ type: "archive", legacyId }),
    restore: (legacyId) => mutation.mutateAsync({ type: "restore", legacyId }),
    isPending: mutation.isPending,
    error: mutation.error ?? null,
  };
}
