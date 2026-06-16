import { useMemo } from "react";
import { Lock } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import {
  resolveCompanyModuleState,
  isCompanyModuleOffered,
  isCompanyModuleUsable,
} from "@/lib/moduleAccess";
import { ROLE_LABELS, type UserRole } from "@/types";

/** Company Admin view: enable or disable the modules made available to the company. */
export function ModulesPanel({ companyId }: { companyId: string }) {
  const {
    modules,
    getCompanyModuleSetting,
    getModuleEntitlementAvailability,
    setModuleEnabled,
  } = useApp();
  const { toast } = useToast();

  const rows = useMemo(
    () =>
      MODULE_DEFINITIONS.map((def) => {
        // Resolve through the shared 3-layer model so the company view can never
        // diverge from the access gate: a globally-inactive module is locked even
        // if a stale company_modules row still says available/enabled.
        const module = modules.find((m) => m.id === def.id);
        const setting = getCompanyModuleSetting(companyId, def.id);
        // Service → Module bridge: for bridged modules (e.g. `admin-requests`)
        // availability follows the company's effective service entitlement;
        // `undefined` for un-bridged modules keeps `company_modules.available`
        // authoritative (existing behavior unchanged).
        const entitlementAvailability = getModuleEntitlementAvailability(
          companyId,
          def.id,
        );
        const state = resolveCompanyModuleState({
          module,
          setting,
          entitlementAvailability,
        });
        return {
          def,
          offered: isCompanyModuleOffered(state),
          enabled: isCompanyModuleUsable(state),
        };
      }),
    [modules, getCompanyModuleSetting, getModuleEntitlementAvailability, companyId],
  );

  const handleToggle = async (moduleId: string, name: string, next: boolean) => {
    // Authoritative: the Switch only reflects the new state once the directory
    // refetch confirms the Supabase write — a failed write leaves it unchanged
    // and surfaces the error.
    const result = await setModuleEnabled(companyId, moduleId, next);
    if (!result.ok) {
      toast({
        title: "Couldn't update module",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: next ? "Module enabled" : "Module disabled",
      description: `${name} is now ${next ? "available to your team" : "hidden"}.`,
    });
  };

  return (
    <div className="space-y-2.5">
      {rows.map(({ def, offered, enabled }) => {
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
              {offered ? (
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => {
                    void handleToggle(def.id, def.name, v);
                  }}
                  aria-label={`Toggle ${def.name}`}
                />
              ) : (
                <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  <Lock className="h-3 w-3" /> Not available
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
