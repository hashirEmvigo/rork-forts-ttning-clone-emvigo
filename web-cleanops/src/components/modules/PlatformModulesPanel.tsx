import { useMemo, useState } from "react";

import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import {
  resolveCompanyModuleState,
  type CompanyModuleState,
} from "@/lib/moduleAccess";
import { getServiceForBridgedModule } from "@/lib/serviceModuleBridge";
import { getServiceDefinition } from "@/lib/serviceRegistry";
import { ROLE_LABELS, type UserRole } from "@/types";

/** Per-company availability status copy, derived from the shared access model. */
const AVAILABILITY_LABEL: Record<CompanyModuleState, string> = {
  globally_inactive: "Inactive platform-wide",
  not_offered: "Not offered",
  available_off: "Available, not enabled",
  enabled: "Enabled by company",
};

/** Super Admin view: control global module status and per-company availability. */
export function PlatformModulesPanel() {
  const {
    companies,
    modules,
    getCompanyModuleSetting,
    getModuleEntitlementAvailability,
    setModuleStatus,
    setModuleAvailable,
  } = useApp();
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<string>(companies[0]?.id ?? "");

  const moduleRows = useMemo(
    () =>
      MODULE_DEFINITIONS.map((def) => ({
        def,
        status: modules.find((m) => m.id === def.id)?.status ?? "inactive",
      })),
    [modules],
  );

  const handleStatus = async (moduleId: string, name: string, next: boolean) => {
    // Authoritative: the Switch only reflects the new status once the directory
    // refetch confirms the Supabase write — a failed write leaves it unchanged.
    const result = await setModuleStatus(moduleId, next ? "active" : "inactive");
    if (!result.ok) {
      toast({
        title: "Couldn't update module",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: next ? "Module activated" : "Module deactivated",
      description: `${name} is now ${next ? "available platform-wide" : "off for everyone"}.`,
    });
  };

  const handleAvailable = async (moduleId: string, name: string, next: boolean) => {
    if (!selectedCompany) return;
    // Authoritative: the Switch only reflects the new availability once the
    // directory refetch confirms the Supabase write — a failed write leaves it
    // unchanged and surfaces the error.
    const result = await setModuleAvailable(selectedCompany, moduleId, next);
    if (!result.ok) {
      toast({
        title: "Couldn't update availability",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: next ? "Module offered" : "Module withdrawn",
      description: `${name} is ${next ? "available to" : "no longer available to"} this company.`,
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-1 text-sm font-semibold">Platform modules</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Switch a module off to remove it from every company at once.
        </p>
        <div className="space-y-2.5">
          {moduleRows.map(({ def, status }) => {
            const Icon = def.icon;
            return (
              <div
                key={def.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{def.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{def.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {def.allowedUserTypes.map((r: UserRole) => (
                      <span
                        key={r}
                        className="rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                      >
                        {ROLE_LABELS[r]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 pt-1">
                  <Switch
                    checked={status === "active"}
                    onCheckedChange={(v) => {
                      void handleStatus(def.id, def.name, v);
                    }}
                    aria-label={`Toggle ${def.name} platform status`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Availability per company</h3>
            <p className="text-xs text-muted-foreground">
              Choose which modules each company is allowed to switch on.
            </p>
          </div>
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Select a company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCompany ? (
          <div className="space-y-2.5">
            {moduleRows.map(({ def }) => {
              const setting = getCompanyModuleSetting(selectedCompany, def.id);
              const module = modules.find((m) => m.id === def.id);
              // Service → Module bridge: for bridged modules availability is
              // governed by the company's service entitlement, not this manual
              // toggle. `undefined` for un-bridged modules keeps the raw
              // company_modules.available flag authoritative (existing behavior).
              const entitlementAvailability = getModuleEntitlementAvailability(
                selectedCompany,
                def.id,
              );
              const state = resolveCompanyModuleState({
                module,
                setting,
                entitlementAvailability,
              });
              const globallyActive = state !== "globally_inactive";
              const bridgeServiceKey = getServiceForBridgedModule(def.id);
              const bridged = bridgeServiceKey !== undefined;
              const bridgeServiceName = bridgeServiceKey
                ? getServiceDefinition(bridgeServiceKey)?.name
                : undefined;
              return (
                <div
                  key={def.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{def.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {AVAILABILITY_LABEL[state]}
                      {bridged && bridgeServiceName
                        ? ` · set by the ${bridgeServiceName} service`
                        : ""}
                    </p>
                  </div>
                  <Switch
                    checked={
                      bridged
                        ? Boolean(entitlementAvailability)
                        : Boolean(setting?.available)
                    }
                    disabled={!globallyActive || bridged}
                    onCheckedChange={(v) => {
                      void handleAvailable(def.id, def.name, v);
                    }}
                    aria-label={`Toggle ${def.name} availability`}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No companies on the platform yet.
          </p>
        )}
      </div>
    </div>
  );
}
