import { useMemo } from "react";
import { ArrowLeft, CheckCircle2, Circle, Info, ListChecks, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCustomerProtocolDetailReadModel } from "@/hooks/use-customer-protocol-read-model";
import type { CustomerProtocolItem, CustomerProtocolSection, CustomerProtocolV2 } from "@/types";

interface CustomerProtocolBuilderProps {
  /** Company that owns the protocol being viewed. */
  companyId: string;
  /** Customer that owns the protocol being viewed. */
  customerId: string;
  /** Protocol identity to load from Supabase. Display data is not read from this prop. */
  protocol: CustomerProtocolV2;
  /** Kept for caller compatibility; mutations are deferred during read-only cutover. */
  canManage: boolean;
  /** Returns to the protocol list. */
  onBack: () => void;
}

interface SectionWithItems {
  section: CustomerProtocolSection;
  items: CustomerProtocolItem[];
}

const DEFERRED_WRITE_MESSAGE =
  "Editing is temporarily disabled during Supabase cutover.";

/**
 * Read-only Supabase detail display for a customer protocol aggregate. Empty or
 * missing Supabase detail remains unavailable; this component never reads
 * browser storage or calls the legacy customer-protocol store.
 */
export function CustomerProtocolBuilder({
  companyId,
  customerId,
  protocol,
  canManage,
  onBack,
}: CustomerProtocolBuilderProps) {
  const { aggregate, isLoading, error } = useCustomerProtocolDetailReadModel(
    companyId,
    customerId,
    protocol.id,
  );
  const remoteProtocol = aggregate?.protocol ?? null;
  const sections = useMemo<SectionWithItems[]>(
    () =>
      aggregate
        ? aggregate.sections.map((section) => ({
            section,
            items: aggregate.items.filter((item) => item.sectionId === section.id),
          }))
        : [],
    [aggregate],
  );
  const itemCount = useMemo<number>(
    () => sections.reduce((sum, entry) => sum + entry.items.length, 0),
    [sections],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All protocols
          </button>
          <h2 className="truncate text-lg font-semibold">
            {remoteProtocol?.name ?? "Protocol unavailable"}
          </h2>
          {remoteProtocol?.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {remoteProtocol.description}
            </p>
          ) : null}
          {remoteProtocol?.sourceTemplateName ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              From template: {remoteProtocol.sourceTemplateName}
            </p>
          ) : null}
          {remoteProtocol ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {sections.length} sections · {itemCount} items · {remoteProtocol.categoryIds.length} categories · {remoteProtocol.floorPresetIds.length} floor presets
            </p>
          ) : null}
        </div>
        {canManage ? (
          <Button disabled className="shrink-0 gap-1.5" title={DEFERRED_WRITE_MESSAGE}>
            <ListChecks className="h-4 w-4" /> Edit content
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{DEFERRED_WRITE_MESSAGE}</p>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading protocol detail from Supabase…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-sm text-destructive">
          Could not load this customer protocol from Supabase.
        </div>
      ) : !remoteProtocol ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">Protocol unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Missing Supabase detail. No legacy protocol fallback is available.
          </p>
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">No sections in Supabase</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This customer protocol aggregate has no sections yet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map(({ section, items }, sectionIndex) => (
            <div
              key={section.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
                  {sectionIndex + 1}
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {section.title}
                </h3>
              </div>

              {items.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
                  No items in this section.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2"
                    >
                      {item.required ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
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
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
