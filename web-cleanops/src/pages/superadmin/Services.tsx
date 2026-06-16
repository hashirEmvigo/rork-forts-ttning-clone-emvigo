import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock4,
  Globe,
  HardDrive,
  History,
  ImagePlus,
  Images,
  LayoutGrid,
  Lock,
  type LucideIcon,
  Receipt,
  Search,
  Sparkles,
  TimerReset,
  XCircle,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "@/components/navigation/PageMenuTiles";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/mediaProcessing";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  SERVICE_FEATURE_REGISTRY,
  describeFeatureSurface,
} from "@/lib/serviceRegistry";
import type {
  ServiceFeatureDefinition,
  UsageGateResult,
} from "@/lib/serviceRegistry";
import type { MediaUsageSummary } from "@/lib/mediaStore";
import type {
  Company,
  ServiceEntitlementAction,
  ServiceEntitlementStatus,
  ServiceFeatureKey,
} from "@/types";

/** Maps a registry icon identifier to a lucide icon component. */
const ICONS: Record<string, LucideIcon> = {
  Clock4,
  ImagePlus,
  Sparkles,
};

/**
 * Page-level section menu (Slice 11E). Uses the shared icon-above-label tile
 * standard so it matches the Customer Card reference; tab values/order/content
 * are unchanged.
 */
const SERVICE_TAB_ITEMS: PageMenuTileItem[] = [
  { value: "catalogue", label: "Catalogue", icon: LayoutGrid },
  { value: "companies", label: "Companies", icon: Building2 },
  { value: "history", label: "History", icon: History },
  { value: "billing", label: "Billing", icon: Receipt },
];

/** Visual styling for each tri-state entitlement status. */
const STATUS_META: Record<
  ServiceEntitlementStatus,
  { label: string; pill: string }
> = {
  disabled: { label: "Disabled", pill: "bg-muted text-muted-foreground" },
  trial: { label: "Trial", pill: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  enabled: { label: "Enabled", pill: "bg-success/10 text-success" },
};

/**
 * Super Admin → Services. The central operational workspace for optional,
 * entitlement-gated platform features (paid add-ons). It is fully
 * registry-driven: every service in {@link SERVICE_FEATURE_REGISTRY} appears
 * automatically with no per-service UI. The page covers four concerns —
 * the service catalogue + global controls, per-company entitlements, the
 * entitlement change history, and a read-only billing-preparation view.
 */
export default function Services() {
  const {
    currentUser,
    companies,
    users,
    isServiceGloballyAvailable,
    isCompanyEntitledToService,
    getCompanyServiceEntitlement,
    getCompanyServiceStatus,
    getEffectiveCompanyServiceStatus,
    setServiceGlobalAvailability,
    setCompanyServiceStatus,
    evaluateMediaUploadGate,
    getCompanyMediaUsage,
    serviceEntitlementLog,
  } = useApp();
  const { toast } = useToast();

  const [companyQuery, setCompanyQuery] = useState<string>("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const activeCompanies = companies.filter((c) => c.status === "active");

  const companyName = (id: string | null): string =>
    id ? companies.find((c) => c.id === id)?.name ?? "Unknown company" : "Platform-wide";

  const userName = (id: string | null): string =>
    id ? users.find((u) => u.id === id)?.name ?? "Unknown" : "System";

  const enabledCompanyCount = (serviceKey: ServiceFeatureKey): number =>
    activeCompanies.filter((c) => isCompanyEntitledToService(c.id, serviceKey)).length;

  const filteredCompanies = useMemo<Company[]>(() => {
    const q = companyQuery.trim().toLowerCase();
    if (!q) return activeCompanies;
    return activeCompanies.filter((c) => c.name.toLowerCase().includes(q));
  }, [activeCompanies, companyQuery]);

  const selectedCompany = selectedCompanyId
    ? companies.find((c) => c.id === selectedCompanyId) ?? null
    : null;

  const onToggleGlobal = async (service: ServiceFeatureDefinition, enabled: boolean) => {
    const res = await setServiceGlobalAvailability(service.serviceKey, enabled);
    toast(
      res.ok
        ? { title: `${service.name} ${enabled ? "available" : "unavailable"} globally` }
        : { title: "Couldn't save", description: res.error, variant: "destructive" },
    );
  };

  const onSetStatus = async (
    companyId: string,
    service: ServiceFeatureDefinition,
    status: ServiceEntitlementStatus,
  ) => {
    const res = await setCompanyServiceStatus(companyId, service.serviceKey, status);
    toast(
      res.ok
        ? { title: `${service.name} set to ${STATUS_META[status].label.toLowerCase()}` }
        : { title: "Couldn't save", description: res.error, variant: "destructive" },
    );
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Services"
        description="Manage optional features and paid add-ons, control global availability, grant per-company access, and review the entitlement history."
      />

      <Tabs defaultValue="catalogue" className="space-y-6">
        <PageMenuTiles items={SERVICE_TAB_ITEMS} ariaLabel="Services sections" testId="services-menu-tiles" />

        {/* ── Catalogue: registry-driven service cards + global controls ── */}
        <TabsContent value="catalogue" className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {SERVICE_FEATURE_REGISTRY.map((service) => {
              const Icon = ICONS[service.icon] ?? Sparkles;
              const globallyAvailable = isServiceGloballyAvailable(service.serviceKey);
              const enabledCount = enabledCompanyCount(service.serviceKey);
              return (
                <div
                  key={service.serviceKey}
                  className="flex flex-col rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">{service.name}</h3>
                      {service.billingEligible ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                            Billable
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        <Switch
                          checked={globallyAvailable}
                          onCheckedChange={(v) => void onToggleGlobal(service, v)}
                          aria-label={`Global availability for ${service.name}`}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">Global</span>
                    </div>
                  </div>

                  <p className="mt-3 text-sm text-muted-foreground">{service.description}</p>

                  {service.affects && service.affects.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Affects
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {service.affects.map((surface, i) => (
                          <span
                            key={`${service.serviceKey}-affect-${i}`}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {describeFeatureSurface(surface)}
                            {surface.note ? (
                              <span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                                {surface.note}
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Global status
                      </p>
                      {globallyAvailable ? (
                        <p className="mt-0.5 flex items-center gap-1 font-medium text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Enabled
                        </p>
                      ) : (
                        <p className="mt-0.5 flex items-center gap-1 font-medium text-muted-foreground">
                          <Lock className="h-3.5 w-3.5" /> Locked
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Companies
                      </p>
                      <p className="mt-0.5 font-medium tabular-nums">
                        {globallyAvailable
                          ? `${enabledCount} of ${activeCompanies.length} enabled`
                          : "—"}
                      </p>
                    </div>
                    {service.settingsPath ? (
                      <div className="col-span-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Company setting
                        </p>
                        <p className="mt-0.5 text-muted-foreground">{service.settingsPath}</p>
                      </div>
                    ) : null}
                  </div>

                  {!globallyAvailable ? (
                    <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> Locked by global setting
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Companies: search + per-company entitlement management ── */}
        <TabsContent value="companies" className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search company…"
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ul className="mt-3 max-h-[480px] space-y-1 overflow-y-auto">
                {filteredCompanies.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No companies match your search.
                  </li>
                ) : (
                  filteredCompanies.map((company) => (
                    <li key={company.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCompanyId(company.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          selectedCompanyId === company.id
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        <Building2 className="h-4 w-4 shrink-0 opacity-60" />
                        <span className="truncate">{company.name}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div>
              {selectedCompany ? (
                <CompanyEntitlements
                  company={selectedCompany}
                  isServiceGloballyAvailable={isServiceGloballyAvailable}
                  isCompanyEntitledToService={isCompanyEntitledToService}
                  getEntitlement={getCompanyServiceEntitlement}
                  getStatus={getCompanyServiceStatus}
                  getEffectiveStatus={getEffectiveCompanyServiceStatus}
                  mediaGate={evaluateMediaUploadGate(selectedCompany.id)}
                  mediaUsage={getCompanyMediaUsage(selectedCompany.id)}
                  onSetStatus={onSetStatus}
                />
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 text-center text-muted-foreground">
                  <Building2 className="h-8 w-8 opacity-40" />
                  <p className="mt-2 text-sm">Select a company to manage its services.</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── History: entitlement change log ── */}
        <TabsContent value="history">
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Changed by</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceEntitlementLog.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <History className="h-8 w-8 opacity-40" />
                        <p className="text-sm">No entitlement changes recorded yet.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  serviceEntitlementLog.map((entry) => {
                    const def = SERVICE_FEATURE_REGISTRY.find(
                      (s) => s.serviceKey === entry.serviceKey,
                    );
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(entry.changedAt)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {def?.name ?? entry.serviceKey}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {companyName(entry.companyId)}
                        </TableCell>
                        <TableCell>
                          <ActionBadge action={entry.action} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {userName(entry.changedBy)}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {entry.previousValue ? "On" : "Off"} → {entry.newValue ? "On" : "Off"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Billing: read-only preparation view (no prices) ── */}
        <TabsContent value="billing" className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Receipt className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Read-only preparation for future invoice specifications. Shows each billable
              service per entitled company with its active period. No prices are calculated and
              no invoices are generated yet.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Company</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Billing label</TableHead>
                  <TableHead>Enabled since</TableHead>
                  <TableHead>Disabled since</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const billable = SERVICE_FEATURE_REGISTRY.filter((s) => s.billingEligible);
                  const rows = activeCompanies.flatMap((company) =>
                    billable
                      .filter((service) =>
                        isCompanyEntitledToService(company.id, service.serviceKey),
                      )
                      .map((service) => {
                        const ent = getCompanyServiceEntitlement(
                          company.id,
                          service.serviceKey,
                        );
                        return (
                          <TableRow key={`${company.id}-${service.serviceKey}`}>
                            <TableCell className="font-medium">{company.name}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {service.name}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {service.billingLabel}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {ent?.enabledAt ? formatDate(ent.enabledAt) : "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {ent?.disabledAt ? formatDate(ent.disabledAt) : "—"}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                                <CheckCircle2 className="h-3 w-3" /> Active
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      }),
                  );
                  if (rows.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={6} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Receipt className="h-8 w-8 opacity-40" />
                            <p className="text-sm">No billable entitlements active.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return rows;
                })()}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}

interface CompanyEntitlementsProps {
  company: Company;
  isServiceGloballyAvailable: (serviceKey: ServiceFeatureKey) => boolean;
  isCompanyEntitledToService: (companyId: string, serviceKey: ServiceFeatureKey) => boolean;
  getEntitlement: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => { enabledAt: string | null; updatedAt: string } | null;
  getStatus: (companyId: string, serviceKey: ServiceFeatureKey) => ServiceEntitlementStatus;
  getEffectiveStatus: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => ServiceEntitlementStatus;
  mediaGate: UsageGateResult;
  mediaUsage: MediaUsageSummary;
  onSetStatus: (
    companyId: string,
    service: ServiceFeatureDefinition,
    status: ServiceEntitlementStatus,
  ) => void;
}

/** Overview card + per-service tri-state status controls for one company. */
function CompanyEntitlements({
  company,
  isServiceGloballyAvailable,
  isCompanyEntitledToService,
  getEntitlement,
  getStatus,
  getEffectiveStatus,
  mediaGate,
  mediaUsage,
  onSetStatus,
}: CompanyEntitlementsProps) {
  const billableServices = SERVICE_FEATURE_REGISTRY.filter((s) => s.billingEligible);
  const enabledServices = SERVICE_FEATURE_REGISTRY.filter((s) =>
    isCompanyEntitledToService(company.id, s.serviceKey),
  );
  const disabledCount = SERVICE_FEATURE_REGISTRY.length - enabledServices.length;
  const billableActive = billableServices.filter((s) =>
    isCompanyEntitledToService(company.id, s.serviceKey),
  ).length;
  const lastChange = SERVICE_FEATURE_REGISTRY.map(
    (s) => getEntitlement(company.id, s.serviceKey)?.updatedAt,
  )
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold">{company.name}</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Active services" value={String(enabledServices.length)} />
          <Stat label="Disabled" value={String(disabledCount)} />
          <Stat label="Billable active" value={String(billableActive)} />
          <Stat
            label="Last change"
            value={lastChange ? formatDate(lastChange) : "—"}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="mb-1 text-sm font-semibold">Service access</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Set each service to Disabled, Trial, or Enabled for this company. Trial allows
          limited usage; Enabled removes limits. The company admin still controls whether a
          feature is switched on in their own settings.
        </p>
        <ul className="divide-y divide-border">
          {SERVICE_FEATURE_REGISTRY.map((service) => {
            const globallyAvailable = isServiceGloballyAvailable(service.serviceKey);
            const status = getStatus(company.id, service.serviceKey);
            const effective = getEffectiveStatus(company.id, service.serviceKey);
            const since = getEntitlement(company.id, service.serviceKey)?.enabledAt ?? null;
            const isMedia = service.serviceKey === "media_uploads";
            return (
              <li key={service.serviceKey} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{service.name}</p>
                    {!globallyAvailable ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Lock className="h-3 w-3" /> Locked by global setting
                      </p>
                    ) : effective !== "disabled" && since ? (
                      <p className="text-[11px] text-muted-foreground">
                        Active since {formatDate(since)}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {globallyAvailable ? "Not enabled" : "Not available for this company"}
                      </p>
                    )}
                  </div>
                  <StatusToggle
                    value={effective}
                    disabled={!globallyAvailable}
                    supportsTrial={service.supportsTrial}
                    onChange={(next) => void onSetStatus(company.id, service, next)}
                    ariaLabelPrefix={`${service.name} for ${company.name}`}
                  />
                </div>
                {isMedia && globallyAvailable && effective === "trial" ? (
                  <TrialUsageBar gate={mediaGate} />
                ) : null}
                {isMedia && globallyAvailable ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Images className="h-3 w-3" /> {mediaUsage.count} images
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HardDrive className="h-3 w-3" /> {formatBytes(mediaUsage.storedBytes)}
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Segmented Disabled / Trial / Enabled control for a company × service. */
function StatusToggle({
  value,
  disabled,
  supportsTrial,
  onChange,
  ariaLabelPrefix,
}: {
  value: ServiceEntitlementStatus;
  disabled: boolean;
  supportsTrial: boolean;
  onChange: (next: ServiceEntitlementStatus) => void;
  ariaLabelPrefix: string;
}) {
  const options: ServiceEntitlementStatus[] = supportsTrial
    ? ["disabled", "trial", "enabled"]
    : ["disabled", "enabled"];
  return (
    <div
      role="group"
      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border"
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            aria-label={`${ariaLabelPrefix}: ${STATUS_META[opt].label}`}
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? opt === "enabled"
                  ? "bg-success text-success-foreground"
                  : opt === "trial"
                    ? "bg-amber-500 text-white"
                    : "bg-muted-foreground/20 text-foreground"
                : "bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {STATUS_META[opt].label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact trial-usage meter, e.g. "23 / 30 images used · 7 remaining". */
function TrialUsageBar({ gate }: { gate: UsageGateResult }) {
  if (gate.limit === null) return null;
  const pct = Math.min(100, Math.round((gate.used / gate.limit) * 100));
  const full = gate.remaining === 0;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <TimerReset className="h-3 w-3" /> {gate.used} / {gate.limit} images used
        </span>
        <span className={full ? "text-destructive" : "text-muted-foreground"}>
          {full ? "Trial limit reached" : `${gate.remaining} remaining`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${full ? "bg-destructive" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const ACTION_META: Record<
  ServiceEntitlementAction,
  { label: string; className: string; icon: LucideIcon }
> = {
  global_enabled: {
    label: "Global enabled",
    className: "bg-success/10 text-success",
    icon: CheckCircle2,
  },
  global_disabled: {
    label: "Global disabled",
    className: "bg-muted text-muted-foreground",
    icon: XCircle,
  },
  company_enabled: {
    label: "Company enabled",
    className: "bg-success/10 text-success",
    icon: CheckCircle2,
  },
  company_disabled: {
    label: "Company disabled",
    className: "bg-muted text-muted-foreground",
    icon: XCircle,
  },
  company_trial_started: {
    label: "Trial started",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    icon: TimerReset,
  },
  company_trial_ended: {
    label: "Trial ended",
    className: "bg-muted text-muted-foreground",
    icon: TimerReset,
  },
};

function ActionBadge({ action }: { action: ServiceEntitlementAction }) {
  const meta = ACTION_META[action];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}
