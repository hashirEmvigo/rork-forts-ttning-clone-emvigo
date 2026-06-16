/**
 * REQUEST CRM — Automation & AI Center source-of-truth reference (Slice 0).
 *
 * Makes the central boundary visible: REQUEST CRM never owns the automation
 * registry, AI extensions, risk/approval policy, runtime guards, kill switches,
 * circuit breakers, or execution/incident logs. Those are owned by Automation &
 * AI Center. This is a display-only callout — it does not link out to a live
 * route in Slice 0 (the central surface is a separate, later build).
 */
import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

interface AutomationCenterReferenceProps {
  className?: string;
  /** Optional central key/registry this surface references. */
  centralKey?: string | null;
  /** Compact single-line variant for inline use inside a section. */
  compact?: boolean;
}

const CANONICAL_PATH =
  "docs/architecture/automation-ai-center/00-automation-ai-center-index.md";

export function AutomationCenterReference({
  className,
  centralKey,
  compact = false,
}: AutomationCenterReferenceProps) {
  if (compact) {
    return (
      <div
        data-testid="automation-center-reference"
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
          className,
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-violet-600" />
        <span className="font-medium text-foreground">Source of truth: Automation &amp; AI Center</span>
        {centralKey ? (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{centralKey}</code>
        ) : null}
        <span>· Display only in REQUEST CRM</span>
      </div>
    );
  }

  return (
    <div
      data-testid="automation-center-reference"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3.5 text-violet-900",
        className,
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
        <ShieldCheck className="h-4 w-4" />
      </div>
      <div className="text-sm leading-relaxed">
        <p className="font-semibold">Source of truth: Automation &amp; AI Center</p>
        <p className="mt-0.5 text-violet-800">
          Automation registry, AI extensions, risk &amp; approval policy, runtime guards, kill
          switches, circuit breakers and execution/incident logs are owned centrally. REQUEST CRM
          only displays references and will be managed centrally later.
        </p>
        <code className="mt-2 inline-block rounded bg-violet-100/80 px-2 py-1 font-mono text-[11px] text-violet-700">
          {CANONICAL_PATH}
        </code>
      </div>
    </div>
  );
}
