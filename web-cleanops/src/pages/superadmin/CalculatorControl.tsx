import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Layers,
  ListChecks,
  Loader2,
  Power,
  Receipt,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useCalculatorAdmin } from "@/hooks/use-calculator-admin";
import { useCalculatorConfig } from "@/hooks/use-calculator-config-admin";
import { QuoteRequestsInbox } from "@/components/calculator/QuoteRequestsInbox";
import { ConfigHealthPanel } from "@/components/calculator/ConfigHealthPanel";
import { ServicesFieldsEditor, AddServiceDialog } from "@/components/calculator/ServicesFieldsEditor";
import { CleaningPlansEditor } from "@/components/calculator/CleaningPlansEditor";
import { CalculatorAddonsEditor } from "@/components/calculator/CalculatorAddonsEditor";
import { PricingRulesView } from "@/components/calculator/PricingRulesView";
import { QuoteSettingsEditor } from "@/components/calculator/QuoteSettingsEditor";
import { Pill } from "@/components/calculator/configBadges";
import {
  AddServiceNavCard,
  CalculatorSection,
  InactiveItemsToggle,
  ServiceNavCard,
  ServiceNavGrid,
  serviceIconForModel,
  type ServiceNavBadge,
} from "@/components/calculator/serviceWorkbench";
import {
  classifyServiceGroup,
  serviceStatusBadges,
} from "@/components/calculator/serviceListPresentation";
import { MVP_CALCULATOR_COMPANY_LEGACY_ID } from "@/lib/calculator/calculatorAdmin";
import {
  computeCalculatorConfigHealth,
  computeServiceReadiness,
  summarizeConfigHealth,
  type CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

/**
 * Super Admin — Price Calculator control + configuration editor.
 *
 * GPM-UX-ADMIN-3 redesign: the page is now service-first. A persistent status
 * header keeps the single master enable/disable switch + config health, then a
 * dense service nav (one tile per service + "Add service") selects a service. The
 * selected service's configuration lives in independent, multi-open accordion
 * sections (Questions / Plans / Pricing / Add-ons / Settings / Requests) that are
 * collapsed by default. Presentation only — every save path, readiness rule,
 * enable guard and pricing behaviour is unchanged; the editors are simply scoped
 * to the selected service.
 */

const bySortOrder = (a: CalculatorServiceConfig, b: CalculatorServiceConfig): number =>
  a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName);

/** The compact state badge (Live / Coming soon / Hidden) shown on a service nav tile. */
function navBadgesForService(service: CalculatorServiceConfig): ServiceNavBadge[] {
  return serviceStatusBadges(service)
    .filter((b) => b.key === "public" || b.key === "coming-soon" || b.key === "hidden")
    .map((b) => ({ key: b.key, label: b.label, tone: b.tone }));
}

export default function CalculatorControl() {
  const { currentUser } = useApp();
  const { toast } = useToast();
  const { overview, isLoading, isFetching, error, refetch, setEnabled, isUpdating } = useCalculatorAdmin();
  const cfg = useCalculatorConfig();

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set<string>());
  const [showLegacyNav, setShowLegacyNav] = useState<boolean>(false);
  const [addServiceOpen, setAddServiceOpen] = useState<boolean>(false);

  const enabled = overview?.settings.enabled ?? false;

  const handleConfirmToggle = useCallback(async () => {
    setConfirmOpen(false);
    try {
      const next = await setEnabled(!enabled);
      toast({
        title: next ? "Calculator enabled" : "Calculator disabled",
        description: next
          ? "The public price calculator is now switched on."
          : "The public price calculator is switched off (dark).",
      });
    } catch (err) {
      toast({
        title: "Could not update the calculator",
        description: err instanceof Error ? err.message : "Unknown error.",
        variant: "destructive",
      });
    }
  }, [enabled, setEnabled, toast]);

  const refetchAll = useCallback(() => {
    refetch();
    cfg.refetch();
  }, [refetch, cfg]);

  const health = useMemo(
    () => (cfg.config ? computeCalculatorConfigHealth(cfg.config) : null),
    [cfg.config],
  );
  const healthSummary = health ? summarizeConfigHealth(health) : null;
  const hasHealthIssues = healthSummary ? healthSummary.blocking + healthSummary.warning > 0 : false;

  // Service nav — the generic builder grouping (pilot/Home + admin-built generic
  // services shown by default; seeded legacy-model services behind a toggle).
  const services = useMemo(() => cfg.config?.services ?? [], [cfg.config]);
  const pilotServices = useMemo(
    () => services.filter((s) => classifyServiceGroup(s) === "pilot").slice().sort(bySortOrder),
    [services],
  );
  const legacyServices = useMemo(
    () => services.filter((s) => classifyServiceGroup(s) === "legacy").slice().sort(bySortOrder),
    [services],
  );
  const navServices = showLegacyNav ? [...pilotServices, ...legacyServices] : pilotServices;

  const selected = useMemo(
    () => services.find((s) => s.id === selectedServiceId) ?? pilotServices[0] ?? services[0] ?? null,
    [services, selectedServiceId, pilotServices],
  );

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Hard role gate (defense in depth on top of the route guard).
  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const config = cfg.config;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Calculator"
        description="Price calculator configuration / MVP control"
        action={
          <Button variant="outline" onClick={refetchAll} disabled={isFetching || cfg.isFetching}>
            {isFetching || cfg.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calculator configuration…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" /> Could not load the calculator configuration
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <Button variant="outline" className="mt-4" onClick={refetch}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      ) : !overview ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Calculator className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold">No calculator configuration found</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            No live calculator settings exist for slug <span className="font-mono">rakna-ut-ditt-pris</span>.
            Apply the calculator seed (migration 0060) for the MVP company, then refresh.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Enabled-state safety banner — only while the calculator is live. */}
          {enabled ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  The public calculator is currently enabled
                </p>
                <p className="text-sm text-amber-700/90 dark:text-amber-300/80">
                  Configuration changes may affect live customer quotes. Use the single calculator switch below to
                  disable it before major edits.
                </p>
              </div>
            </div>
          ) : null}

          {/* Status + master switch (the single public-behaviour toggle). */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold">{overview.companyName ?? "Unknown company"}</h2>
                  <Pill tone={enabled ? "green" : "muted"}>{enabled ? "Public" : "Dark"}</Pill>
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {overview.settings.companyLegacyId} · /{overview.settings.publicSlug ?? "—"}
                </p>
                {!overview.matchesMvpTarget ? (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Owner differs from the expected MVP target ({MVP_CALCULATOR_COMPANY_LEGACY_ID}).
                  </div>
                ) : null}
              </div>
              <Button
                variant={enabled ? "outline" : "default"}
                onClick={() => setConfirmOpen(true)}
                disabled={isUpdating}
                className="shrink-0"
              >
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                {enabled ? "Disable calculator" : "Enable calculator"}
              </Button>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Enabling/disabling is the only switch that changes public behaviour. While disabled, the public submit
                path creates nothing. Configure each service below.
              </p>
            </div>

            {/* Config health — compact summary, with the full panel only when something needs attention. */}
            <div className="mt-3 flex items-center gap-2 text-xs">
              <ShieldAlert className={`h-3.5 w-3.5 ${hasHealthIssues ? "text-amber-500" : "text-emerald-500"}`} />
              <span className="font-medium">Configuration health</span>
              <span className="text-muted-foreground">
                {healthSummary
                  ? hasHealthIssues
                    ? `${healthSummary.blocking} blocking · ${healthSummary.warning} warnings`
                    : "Configuration looks healthy"
                  : "Checking…"}
              </span>
            </div>
            {health && hasHealthIssues ? (
              <div className="mt-2">
                <ConfigHealthPanel items={health} />
              </div>
            ) : null}
          </section>

          {/* Service-first navigation. */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Services</h2>
              <InactiveItemsToggle
                hiddenCount={legacyServices.length}
                open={showLegacyNav}
                onToggle={() => setShowLegacyNav((v) => !v)}
                showLabel="Show legacy / default services"
                hideLabel="Hide legacy / default services"
                testId="calculator-legacy-nav-toggle"
              />
            </div>
            <ServiceNavGrid ariaLabel="Calculator services">
              {navServices.map((service) => (
                <ServiceNavCard
                  key={service.id}
                  name={service.displayName}
                  icon={serviceIconForModel(service.pricingModel)}
                  selected={service.id === (selected?.id ?? "")}
                  badges={navBadgesForService(service)}
                  onSelect={() => setSelectedServiceId(service.id)}
                  testId={`calculator-service-card-${service.serviceKey}`}
                />
              ))}
              <AddServiceNavCard onClick={() => setAddServiceOpen(true)} />
            </ServiceNavGrid>
          </section>

          {/* Selected-service configuration sections. */}
          {cfg.isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading configuration…
            </div>
          ) : cfg.error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" /> Could not load the configuration
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{cfg.error.message}</p>
              <Button variant="outline" className="mt-4" onClick={cfg.refetch}>
                <RefreshCw className="h-4 w-4" /> Try again
              </Button>
            </div>
          ) : !config ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No calculator configuration found to edit.
            </div>
          ) : selected ? (
            (() => {
              const servicePlans = config.cleaningPlans.filter((p) => p.serviceKey === selected.serviceKey);
              const serviceRules = config.pricingRules.filter((r) => r.serviceId === selected.id);
              const activeQuestions = selected.questions.filter((q) => q.active).length;
              const readiness = computeServiceReadiness(selected, config.pricingRules, config.cleaningPlans);
              return (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 px-0.5">
                    <span className="text-sm font-semibold">{selected.displayName}</span>
                    <Pill tone={readiness.tone}>{readiness.label}</Pill>
                    <span className="text-xs text-muted-foreground">Configure this service below.</span>
                  </div>

                  <CalculatorSection
                    id="questions"
                    title="Questions"
                    icon={ListChecks}
                    count={activeQuestions}
                    open={openSections.has("questions")}
                    onToggle={() => toggleSection("questions")}
                  >
                    <ServicesFieldsEditor
                      key={selected.id}
                      embedded
                      services={[selected]}
                      companyId={config.settings.companyId}
                      companyLegacyId={config.settings.companyLegacyId}
                      pricingRules={config.pricingRules}
                      plans={config.cleaningPlans}
                      onSaveService={cfg.saveService}
                      onSaveQuestion={cfg.saveQuestion}
                      onAddQuestion={cfg.addQuestion}
                      onArchiveService={cfg.archiveService}
                      questionLibraryItems={cfg.questionLibraryItems}
                      onSaveQuestionToLibrary={cfg.saveQuestionToLibrary}
                    />
                  </CalculatorSection>

                  <CalculatorSection
                    id="plans"
                    title="Plans"
                    icon={Layers}
                    count={servicePlans.length}
                    open={openSections.has("plans")}
                    onToggle={() => toggleSection("plans")}
                  >
                    <CleaningPlansEditor
                      services={[selected]}
                      plans={config.cleaningPlans}
                      currency={config.settings.currency}
                      companyId={config.settings.companyId}
                      companyLegacyId={config.settings.companyLegacyId}
                      onSaveService={cfg.saveService}
                      onSavePlan={cfg.savePlan}
                      onSetDefault={cfg.setDefaultPlan}
                      onAddPlan={cfg.addPlan}
                    />
                  </CalculatorSection>

                  <CalculatorSection
                    id="pricing"
                    title="Pricing"
                    icon={SlidersHorizontal}
                    count={serviceRules.length}
                    open={openSections.has("pricing")}
                    onToggle={() => toggleSection("pricing")}
                  >
                    <PricingRulesView
                      embedded
                      services={[selected]}
                      pricingRules={config.pricingRules}
                      plans={config.cleaningPlans}
                      currency={config.settings.currency}
                      enabled={enabled}
                      onSaveSqmAdjustments={(service, ranges) =>
                        cfg.saveService(service.legacyId, { homeSqmAdjustments: ranges })
                      }
                      onSaveRuleValue={(rule, newValue, note) =>
                        cfg.savePricingRuleValue({
                          legacyId: rule.legacyId,
                          ruleKey: rule.ruleKey,
                          ruleType: rule.ruleType,
                          oldValue: rule.valueNumeric,
                          newValue,
                          companyId: config.settings.companyId,
                          companyLegacyId: config.settings.companyLegacyId,
                          currency: config.settings.currency,
                          actor: {
                            id: currentUser?.id ?? null,
                            name: currentUser?.name ?? "Okänd",
                            role: currentUser?.role ?? "super_admin",
                          },
                          note,
                        })
                      }
                      // GPM-UX-ADMIN-7 — customer-facing add-ons are consolidated into the
                      // unified "Add-ons" subsection (last in Pricing); no separate block.
                      addonsSlot={
                        <CalculatorAddonsEditor
                          embedded
                          services={[selected]}
                          addons={config.addons ?? []}
                          companyId={config.settings.companyId}
                          companyLegacyId={config.settings.companyLegacyId}
                          onAddAddon={cfg.addAddon}
                          onSaveAddon={cfg.saveAddon}
                          onArchiveAddon={cfg.archiveAddon}
                          addonLibraryItems={cfg.addonLibraryItems}
                          onSaveAddonToLibrary={cfg.saveAddonToLibrary}
                        />
                      }
                    />
                  </CalculatorSection>

                  <CalculatorSection
                    id="settings"
                    title="Settings"
                    icon={Settings2}
                    open={openSections.has("settings")}
                    onToggle={() => toggleSection("settings")}
                  >
                    <QuoteSettingsEditor
                      settings={config.settings}
                      enabled={enabled}
                      isUpdatingEnabled={isUpdating}
                      audit={cfg.pricingRuleAudit}
                      onRequestToggleEnabled={() => setConfirmOpen(true)}
                      onSaveSettings={cfg.saveSettings}
                    />
                  </CalculatorSection>

                  <CalculatorSection
                    id="requests"
                    title="Requests"
                    icon={Receipt}
                    open={openSections.has("requests")}
                    onToggle={() => toggleSection("requests")}
                  >
                    <QuoteRequestsInbox />
                  </CalculatorSection>
                </div>
              );
            })()
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No services configured yet. Use “Add service” above to create your first calculator service.
            </div>
          )}

          {config ? (
            <AddServiceDialog
              companyId={config.settings.companyId}
              companyLegacyId={config.settings.companyLegacyId}
              existingKeys={services.map((s) => s.serviceKey)}
              nextSort={services.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1}
              open={addServiceOpen}
              onOpenChange={setAddServiceOpen}
              onAdd={cfg.addService}
            />
          ) : null}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{enabled ? "Disable the calculator?" : "Enable the calculator?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {enabled
                ? "Switching off sets the calculator dark. The public submit path will create no prospects or quote requests until it is re-enabled."
                : "Switching on activates the server-side submit path for the public calculator. Make sure the seeded pricing numbers have been reviewed first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmToggle}>
              {enabled ? "Disable" : "Enable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
