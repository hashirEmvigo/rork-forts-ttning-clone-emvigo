import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Circle,
  Info,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useChecklistTemplateDetailReadModel } from "@/hooks/use-checklist-template-read-model";
import { useChecklistTemplateMutations } from "@/hooks/use-checklist-template-mutations";
import {
  TEMPLATE_AUDIENCE_LABELS,
  sortChecklistItems,
  sortChecklistSections,
  type ChecklistItem,
  type ChecklistSection,
  type ChecklistTemplateV2,
} from "@/types";

interface TemplateBuilderProps {
  /** Company that owns the template being viewed. */
  companyId: string;
  /** Template identity to load from Supabase. Display data is not read from this prop. */
  template: ChecklistTemplateV2;
  /** Enables company-template content editing through Supabase. */
  canManage: boolean;
  /** Returns to the template list. */
  onBack: () => void;
}

interface SectionWithItems {
  section: ChecklistSection;
  items: ChecklistItem[];
}

interface DraftFingerprint {
  sections: Array<Pick<ChecklistSection, "id" | "title" | "sortOrder">>;
  items: Array<Pick<ChecklistItem, "id" | "sectionId" | "title" | "required" | "sortOrder"> & { description: string }>;
}

function createLocalId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}_${randomUuid.replace(/-/g, "").slice(0, 18)}`;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function orderedSectionItems(items: ChecklistItem[], sectionId: string): ChecklistItem[] {
  return sortChecklistItems(items.filter((item) => item.sectionId === sectionId));
}

function groupSectionsWithItems(
  sections: ChecklistSection[],
  items: ChecklistItem[],
): SectionWithItems[] {
  return sortChecklistSections(sections).map((section) => ({
    section,
    items: orderedSectionItems(items, section.id),
  }));
}

function reindexSections(sections: ChecklistSection[]): ChecklistSection[] {
  return sections.map((section, index) => ({
    ...section,
    sortOrder: (index + 1) * 10,
  }));
}

function reindexItemsForSection(items: ChecklistItem[], sectionId: string): ChecklistItem[] {
  const orderedIds = orderedSectionItems(items, sectionId).map((item) => item.id);
  const sortOrderById = new Map<string, number>();
  orderedIds.forEach((id, index) => sortOrderById.set(id, (index + 1) * 10));
  return items.map((item) =>
    item.sectionId === sectionId
      ? { ...item, sortOrder: sortOrderById.get(item.id) ?? item.sortOrder }
      : item,
  );
}

function moveInArray<T>(values: T[], fromIndex: number, toIndex: number): T[] {
  if (toIndex < 0 || toIndex >= values.length) return values;
  const next = [...values];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function fingerprintSectionsAndItems(
  sections: ChecklistSection[],
  items: ChecklistItem[],
): DraftFingerprint {
  const orderedSections = sortChecklistSections(sections);
  return {
    sections: orderedSections.map((section, index) => ({
      id: section.id,
      title: section.title.trim(),
      sortOrder: (index + 1) * 10,
    })),
    items: orderedSections.flatMap((section) =>
      orderedSectionItems(items, section.id).map((item, index) => ({
        id: item.id,
        sectionId: item.sectionId,
        title: item.title.trim(),
        description: item.description?.trim() ?? "",
        required: item.required,
        sortOrder: (index + 1) * 10,
      })),
    ),
  };
}

function prepareSectionsForSave(sections: ChecklistSection[]): ChecklistSection[] {
  const timestamp = nowIso();
  return reindexSections(sortChecklistSections(sections)).map((section) => ({
    ...section,
    title: section.title.trim(),
    updatedAt: timestamp,
  }));
}

function prepareItemsForSave(sections: ChecklistSection[], items: ChecklistItem[]): ChecklistItem[] {
  const timestamp = nowIso();
  const orderedSections = sortChecklistSections(sections);
  const sectionIds = new Set(orderedSections.map((section) => section.id));
  return orderedSections.flatMap((section) =>
    orderedSectionItems(items, section.id)
      .filter((item) => sectionIds.has(item.sectionId))
      .map((item, index) => ({
        ...item,
        title: item.title.trim(),
        description: item.description?.trim() || undefined,
        sortOrder: (index + 1) * 10,
        updatedAt: timestamp,
      })),
  );
}

/**
 * Supabase-backed company checklist-template content editor. Sections/items live
 * inside the template JSON aggregate; removing content here means removing it
 * from the draft aggregate and persisting the next aggregate to Supabase.
 */
export function TemplateBuilder({
  companyId,
  template,
  canManage,
  onBack,
}: TemplateBuilderProps) {
  const { aggregate, isLoading, error } = useChecklistTemplateDetailReadModel(
    companyId,
    template.id,
  );
  const mutations = useChecklistTemplateMutations(companyId);
  const remoteTemplate = aggregate?.template ?? null;
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draftSections, setDraftSections] = useState<ChecklistSection[]>([]);
  const [draftItems, setDraftItems] = useState<ChecklistItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing) return;
    setDraftSections(aggregate?.sections ?? []);
    setDraftItems(aggregate?.items ?? []);
    setSaveError(null);
  }, [aggregate, isEditing]);

  const isCompanyTemplate = Boolean(
    remoteTemplate?.scope === "company" && remoteTemplate.companyId === companyId,
  );
  const canEditContent = Boolean(canManage && companyId && remoteTemplate && isCompanyTemplate);
  const displayedSections = useMemo<SectionWithItems[]>(
    () =>
      groupSectionsWithItems(
        isEditing ? draftSections : aggregate?.sections ?? [],
        isEditing ? draftItems : aggregate?.items ?? [],
      ),
    [aggregate?.items, aggregate?.sections, draftItems, draftSections, isEditing],
  );
  const itemCount = useMemo<number>(
    () => displayedSections.reduce((sum, entry) => sum + entry.items.length, 0),
    [displayedSections],
  );
  const isDirty = useMemo<boolean>(() => {
    if (!aggregate || !isEditing) return false;
    const current = fingerprintSectionsAndItems(aggregate.sections, aggregate.items);
    const draft = fingerprintSectionsAndItems(draftSections, draftItems);
    return JSON.stringify(current) !== JSON.stringify(draft);
  }, [aggregate, draftItems, draftSections, isEditing]);
  const validationMessage = useMemo<string | null>(() => {
    if (!isEditing) return null;
    if (!companyId) return "Company scope is required before this template can be saved.";
    if (!remoteTemplate) return "Template detail is unavailable in Supabase.";
    if (!isCompanyTemplate) return "Only company checklist templates can be edited in this slice.";
    if (draftSections.some((section) => section.title.trim().length === 0)) {
      return "Every section needs a title before saving.";
    }
    if (draftItems.some((item) => item.title.trim().length === 0)) {
      return "Every checklist item needs a title before saving.";
    }
    return null;
  }, [companyId, draftItems, draftSections, isCompanyTemplate, isEditing, remoteTemplate]);
  const isSaving = mutations.isPending;
  const canSave = Boolean(isDirty && !validationMessage && !isSaving);

  const startEditing = useCallback((): void => {
    if (!aggregate || !canEditContent) return;
    setDraftSections(aggregate.sections);
    setDraftItems(aggregate.items);
    setSaveError(null);
    setIsEditing(true);
  }, [aggregate, canEditContent]);

  const cancelEditing = useCallback((): void => {
    setDraftSections(aggregate?.sections ?? []);
    setDraftItems(aggregate?.items ?? []);
    setSaveError(null);
    setIsEditing(false);
  }, [aggregate]);

  const addSection = useCallback((): void => {
    if (!remoteTemplate || isSaving) return;
    const timestamp = nowIso();
    setDraftSections((current) =>
      reindexSections([
        ...sortChecklistSections(current),
        {
          id: createLocalId("csec"),
          templateId: remoteTemplate.id,
          companyId: remoteTemplate.companyId,
          title: "New section",
          sortOrder: (current.length + 1) * 10,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ]),
    );
    setSaveError(null);
  }, [isSaving, remoteTemplate]);

  const updateSectionTitle = useCallback((sectionId: string, title: string): void => {
    setDraftSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, title, updatedAt: nowIso() } : section,
      ),
    );
    setSaveError(null);
  }, []);

  const removeSection = useCallback((sectionId: string): void => {
    setDraftSections((current) =>
      reindexSections(sortChecklistSections(current).filter((section) => section.id !== sectionId)),
    );
    setDraftItems((current) => current.filter((item) => item.sectionId !== sectionId));
    setSaveError(null);
  }, []);

  const moveSection = useCallback((sectionId: string, direction: -1 | 1): void => {
    setDraftSections((current) => {
      const ordered = sortChecklistSections(current);
      const fromIndex = ordered.findIndex((section) => section.id === sectionId);
      if (fromIndex < 0) return current;
      return reindexSections(moveInArray(ordered, fromIndex, fromIndex + direction));
    });
    setSaveError(null);
  }, []);

  const addItem = useCallback((sectionId: string): void => {
    if (!remoteTemplate || isSaving) return;
    const timestamp = nowIso();
    setDraftItems((current) => {
      const sectionItems = orderedSectionItems(current, sectionId);
      const next = [
        ...current,
        {
          id: createLocalId("citm"),
          sectionId,
          templateId: remoteTemplate.id,
          companyId: remoteTemplate.companyId,
          title: "New checklist item",
          description: undefined,
          required: true,
          sortOrder: (sectionItems.length + 1) * 10,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ];
      return reindexItemsForSection(next, sectionId);
    });
    setSaveError(null);
  }, [isSaving, remoteTemplate]);

  const updateItem = useCallback((itemId: string, patch: Partial<Pick<ChecklistItem, "title" | "description" | "required">>): void => {
    setDraftItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, ...patch, updatedAt: nowIso() } : item,
      ),
    );
    setSaveError(null);
  }, []);

  const removeItem = useCallback((itemId: string): void => {
    setDraftItems((current) => {
      const item = current.find((entry) => entry.id === itemId);
      const next = current.filter((entry) => entry.id !== itemId);
      return item ? reindexItemsForSection(next, item.sectionId) : next;
    });
    setSaveError(null);
  }, []);

  const moveItem = useCallback((itemId: string, direction: -1 | 1): void => {
    setDraftItems((current) => {
      const movingItem = current.find((item) => item.id === itemId);
      if (!movingItem) return current;
      const sectionItems = orderedSectionItems(current, movingItem.sectionId);
      const fromIndex = sectionItems.findIndex((item) => item.id === itemId);
      if (fromIndex < 0) return current;
      const movedSectionItems = moveInArray(sectionItems, fromIndex, fromIndex + direction);
      const sortOrderById = new Map<string, number>();
      movedSectionItems.forEach((item, index) => sortOrderById.set(item.id, (index + 1) * 10));
      return current.map((item) =>
        item.sectionId === movingItem.sectionId
          ? { ...item, sortOrder: sortOrderById.get(item.id) ?? item.sortOrder }
          : item,
      );
    });
    setSaveError(null);
  }, []);

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!remoteTemplate || validationMessage || !isDirty || isSaving) return;
    try {
      setSaveError(null);
      const sectionsToSave = prepareSectionsForSave(draftSections);
      const itemsToSave = prepareItemsForSave(sectionsToSave, draftItems);
      const updated = await mutations.updateSectionsAndItems(
        remoteTemplate,
        sectionsToSave,
        itemsToSave,
      );
      if (!updated) {
        throw new Error("Template content could not be saved in Supabase.");
      }
      setDraftSections(updated.sections);
      setDraftItems(updated.items);
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Template content could not be saved.");
    }
  }, [draftItems, draftSections, isDirty, isSaving, mutations, remoteTemplate, validationMessage]);

  const editDisabledMessage = !remoteTemplate
    ? "Template detail is unavailable in Supabase."
    : !isCompanyTemplate
      ? "Only company checklist templates can be edited in this slice."
      : "Content editing requires company management access.";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            disabled={isSaving}
          >
            <ArrowLeft className="h-4 w-4" /> All templates
          </button>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">
              {remoteTemplate?.name ?? "Template unavailable"}
            </h2>
            {remoteTemplate?.audience ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {TEMPLATE_AUDIENCE_LABELS[remoteTemplate.audience]}
              </span>
            ) : null}
            {isEditing ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                Editing
              </span>
            ) : null}
          </div>
          {remoteTemplate?.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {remoteTemplate.description}
            </p>
          ) : null}
          {remoteTemplate ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {displayedSections.length} sections · {itemCount} items · {remoteTemplate.categoryIds.length} categories · {remoteTemplate.floorPresetIds.length} floor presets
            </p>
          ) : null}
        </div>
        {canManage ? (
          isEditing ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={cancelEditing}
                disabled={isSaving}
                className="gap-1.5"
              >
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void saveDraft()}
                disabled={!canSave}
                className="gap-1.5"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save changes
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={startEditing}
              disabled={!canEditContent || isSaving}
              className="shrink-0 gap-1.5"
              title={canEditContent ? undefined : editDisabledMessage}
            >
              <ListChecks className="h-4 w-4" /> Edit content
            </Button>
          )
        ) : null}
      </div>

      {canManage && !canEditContent && remoteTemplate ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{editDisabledMessage}</p>
        </div>
      ) : null}

      {isEditing ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Editing Supabase template content</p>
            <p className="text-primary/80">
              {isDirty ? "You have unsaved changes." : "No unsaved changes yet."} Cancel reverts to the last loaded Supabase aggregate.
            </p>
          </div>
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      ) : null}

      {validationMessage ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {validationMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading template detail from Supabase…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-sm text-destructive">
          Could not load this checklist template from Supabase.
        </div>
      ) : !remoteTemplate ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">Template unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Missing Supabase detail. No legacy template fallback is available.
          </p>
        </div>
      ) : displayedSections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">
            {isEditing ? "No sections yet" : "No sections in Supabase"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isEditing
              ? "Add a section to start building this company template."
              : "This checklist template aggregate has no sections yet."}
          </p>
          {isEditing ? (
            <Button
              type="button"
              onClick={addSection}
              disabled={isSaving}
              className="mt-4 gap-1.5"
            >
              <Plus className="h-4 w-4" /> Add section
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {isEditing ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={addSection}
                disabled={isSaving}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" /> Add section
              </Button>
            </div>
          ) : null}
          {displayedSections.map(({ section, items }, sectionIndex) => (
            <div
              key={section.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
                  {sectionIndex + 1}
                </span>
                {isEditing ? (
                  <Input
                    aria-label={`Section ${sectionIndex + 1} title`}
                    value={section.title}
                    onChange={(event) => updateSectionTitle(section.id, event.target.value)}
                    disabled={isSaving}
                    className="min-w-0 flex-1 font-semibold"
                  />
                ) : (
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {section.title}
                  </h3>
                )}
                {isEditing ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveSection(section.id, -1)}
                      disabled={isSaving || sectionIndex === 0}
                      aria-label={`Move section ${section.title} up`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveSection(section.id, 1)}
                      disabled={isSaving || sectionIndex === displayedSections.length - 1}
                      aria-label={`Move section ${section.title} down`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSection(section.id)}
                      disabled={isSaving}
                      aria-label={`Remove section ${section.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              {items.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
                  <p>No items in this section.</p>
                  {isEditing ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addItem(section.id)}
                      disabled={isSaving}
                      className="mt-3 gap-1.5"
                    >
                      <Plus className="h-4 w-4" /> Add item
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {items.map((item, itemIndex) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2"
                    >
                      {isEditing ? (
                        <input
                          type="checkbox"
                          aria-label={`Required item ${item.title}`}
                          checked={item.required}
                          onChange={(event) => updateItem(item.id, { required: event.target.checked })}
                          disabled={isSaving}
                          className="mt-3 h-4 w-4 rounded border-input accent-primary"
                        />
                      ) : item.required ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              aria-label={`Item ${itemIndex + 1} title in ${section.title}`}
                              value={item.title}
                              onChange={(event) => updateItem(item.id, { title: event.target.value })}
                              disabled={isSaving}
                              className="font-medium"
                            />
                            <Textarea
                              aria-label={`Item ${itemIndex + 1} description in ${section.title}`}
                              value={item.description ?? ""}
                              onChange={(event) => updateItem(item.id, { description: event.target.value })}
                              disabled={isSaving}
                              placeholder="Optional instruction"
                              className="min-h-[64px]"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">{item.title}</p>
                              {item.required ? (
                                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  Required
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Optional
                                </span>
                              )}
                            </div>
                            {item.description ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="flex shrink-0 items-center gap-1 pt-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => moveItem(item.id, -1)}
                            disabled={isSaving || itemIndex === 0}
                            aria-label={`Move item ${item.title} up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => moveItem(item.id, 1)}
                            disabled={isSaving || itemIndex === items.length - 1}
                            aria-label={`Move item ${item.title} down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.id)}
                            disabled={isSaving}
                            aria-label={`Remove item ${item.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {isEditing && items.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addItem(section.id)}
                  disabled={isSaving}
                  className="mt-3 gap-1.5"
                >
                  <Plus className="h-4 w-4" /> Add item
                </Button>
              ) : null}
            </div>
          ))}
          {isEditing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {isDirty ? "Unsaved changes are ready to save." : "Make a change to enable saving."}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelEditing}
                  disabled={isSaving}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-4 w-4" /> Revert
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={!canSave}
                  className="gap-1.5"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save changes
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
