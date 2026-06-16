/**
 * REQUEST CRM Settings Shell — single section renderer (Slice 0).
 *
 * Renders one settings tab as a read-only card of setting rows sourced from the
 * typed mock fixtures. The AI & Automation and Runtime Safety Links sections
 * additionally show display-only quick-review / runtime-safety cards, gated by
 * `ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW`. Nothing here mutates anything —
 * the only "write" affordance is a disabled placeholder with an explanatory
 * tooltip.
 */
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AutomationCenterReference } from "@/components/crm/AutomationCenterReference";
import {
  OwnershipBadge,
  RiskLevelBadge,
  SettingStatusBadge,
  RuntimeSafetyStatusBadge,
} from "@/components/crm/badges/RequestCrmBadges";
import type { RequestCrmSettingsTab } from "@/lib/requestCrm/settingsTabs";
import type { RequestSettingsShellItem } from "@/lib/requestCrm/types";
import { getRequestCrmSettingsItems } from "@/lib/requestCrm/mockData/settingsShell";
import {
  REQUEST_CRM_AUTOMATION_CANDIDATES,
  REQUEST_CRM_RUNTIME_SAFETY,
} from "@/lib/requestCrm/mockData";

interface CrmSettingsSectionProps {
  tab: RequestCrmSettingsTab;
  /** Whether the automation/runtime quick-review flag is ON. */
  quickReviewEnabled: boolean;
}

/** A single read-only setting row panel. */
function SettingRow({ item }: { item: RequestSettingsShellItem }) {
  return (
    <li className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{item.label}</p>
          <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {item.key}
          </code>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <SettingStatusBadge status={item.status} />
          {item.riskLevelCandidate !== "none" ? (
            <RiskLevelBadge risk={item.riskLevelCandidate} />
          ) : null}
        </div>
      </div>

      {item.localDomainEffect ? (
        <p className="mt-2.5 text-sm text-muted-foreground">{item.localDomainEffect}</p>
      ) : null}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-muted-foreground">Central link</dt>
          <dd className="font-mono text-[11px] text-foreground">
            {item.centralAutomationLink ?? "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-muted-foreground">AI extension candidate</dt>
          <dd className="text-foreground">{item.aiExtensionCandidate ? "Yes" : "No"}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-muted-foreground">Feature flag</dt>
          <dd className="font-mono text-[11px] text-foreground">{item.featureFlag ?? "—"}</dd>
        </div>
      </dl>
    </li>
  );
}

/** Display-only automation quick-review block (AI & Automation tab). */
function AutomationQuickReviewBlock({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <div
        data-testid="crm-quick-review-disabled"
        className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground"
      >
        Automation quick-review is turned off. Enable{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          enable_request_crm_automation_quick_review
        </code>{" "}
        to preview the display-only automation candidates.
      </div>
    );
  }

  return (
    <div data-testid="crm-quick-review" className="space-y-2.5">
      {REQUEST_CRM_AUTOMATION_CANDIDATES.map((candidate) => (
        <div key={candidate.centralActionKey} className="rounded-xl border border-border bg-background/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {candidate.centralActionKey}
            </code>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <RiskLevelBadge risk={candidate.riskLevel} />
            </div>
          </div>
          <p className="mt-2 text-sm text-foreground">
            <span className="text-muted-foreground">Trigger:</span> {candidate.trigger}
          </p>
          <p className="mt-1 text-sm text-foreground">
            <span className="text-muted-foreground">Guard action:</span> {candidate.guardAction}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            AI extension candidate: {candidate.aiExtensionCandidate ? "Yes" : "No"} · Slice 0:{" "}
            {candidate.slice0Behavior}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Display-only runtime-safety mock badges (Runtime Safety Links tab). */
function RuntimeSafetyBlock({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <div
        data-testid="crm-runtime-safety-disabled"
        className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground"
      >
        Runtime safety preview is turned off. Enable{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          enable_request_crm_automation_quick_review
        </code>{" "}
        to preview the mock runtime-safety badges.
      </div>
    );
  }

  return (
    <div data-testid="crm-runtime-safety" className="space-y-2.5">
      {REQUEST_CRM_RUNTIME_SAFETY.map((runtime) => (
        <div
          key={runtime.runtimeFlagRef}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/60 p-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{runtime.surface}</p>
            <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {runtime.runtimeFlagRef}
            </code>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <RuntimeSafetyStatusBadge status={runtime.status} />
            <span className="text-xs text-muted-foreground">≤ {runtime.latencyBudgetMs} ms</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CrmSettingsSection({ tab, quickReviewEnabled }: CrmSettingsSectionProps) {
  const items = getRequestCrmSettingsItems(tab.id);
  const Icon = tab.icon;
  const isCentral = tab.ownership === "central" || tab.ownership === "central-linked";
  const manageHint =
    tab.ownership === "local"
      ? "Read-only in Slice 0 — no changes are saved."
      : "Managed centrally later in Automation & AI Center.";

  return (
    <section
      data-testid={`crm-settings-section-${tab.id}`}
      className="rounded-2xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{tab.title}</h2>
              <OwnershipBadge ownership={tab.ownership} />
            </div>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{tab.description}</p>
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                className="pointer-events-none gap-1.5"
              >
                <Lock className="h-3.5 w-3.5" /> Read-only
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{manageHint}</TooltipContent>
        </Tooltip>
      </header>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        {isCentral ? <AutomationCenterReference compact /> : null}

        {items.length > 0 ? (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <SettingRow key={item.key} item={item} />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            No mock settings rows for this section yet.
          </div>
        )}

        {tab.id === "ai-automation" ? (
          <>
            <Separator />
            <div>
              <h3 className="mb-2.5 text-sm font-semibold text-foreground">
                Automation candidates (display only)
              </h3>
              <AutomationQuickReviewBlock enabled={quickReviewEnabled} />
            </div>
          </>
        ) : null}

        {tab.id === "runtime-safety-links" ? (
          <>
            <Separator />
            <div>
              <h3 className="mb-2.5 text-sm font-semibold text-foreground">
                Runtime safety (mock badges)
              </h3>
              <RuntimeSafetyBlock enabled={quickReviewEnabled} />
            </div>
          </>
        ) : null}
      </div>

      <footer
        className={cn(
          "flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6",
        )}
      >
        <Lock className="h-3.5 w-3.5" />
        {manageHint}
      </footer>
    </section>
  );
}
