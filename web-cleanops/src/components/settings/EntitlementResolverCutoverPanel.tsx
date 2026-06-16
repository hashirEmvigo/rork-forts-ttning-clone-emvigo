import { GitCompare, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { EntitlementsResolverMode } from "@/types";

/**
 * Phase 6 cutover controls. Surfaces the serving-resolver badge and the
 * shadow-logging switch. Read paths are unaffected: legacy keeps serving until
 * the resolver flag is explicitly flipped. Shared between the Platform Settings
 * page and the Settings → Entitlement Validation tab so there is a single
 * source of truth for these controls.
 */
export function EntitlementResolverCutoverPanel() {
  const { systemSettings, updateSystemSettings } = useApp();
  const { toast } = useToast();

  const servingResolver: EntitlementsResolverMode = systemSettings.entitlementsResolver;

  const onResolverChange = (mode: EntitlementsResolverMode) => {
    if (mode === servingResolver) {
      return;
    }
    const res = updateSystemSettings({ entitlementsResolver: mode });
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: mode === "bundle" ? "Bundle resolver activated" : "Rolled back to Legacy resolver",
      description:
        mode === "bundle"
          ? "The bundle resolver now serves all live entitlement reads. Legacy remains the automatic fallback."
          : "Legacy is serving all live entitlement reads again. This is the safe default.",
    });
  };

  const onShadowLogChange = (enabled: boolean) => {
    const res = updateSystemSettings({ entitlementsShadowLog: enabled });
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: enabled ? "Shadow logging enabled" : "Shadow logging disabled",
      description: enabled
        ? "Legacy still serves; the bundle resolver now runs in parallel and logs any divergence to the console."
        : "The bundle resolver no longer runs in parallel.",
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <GitCompare className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Entitlement Resolver Cutover</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Controls for the bundle-resolver migration. The serving resolver stays
            <span className="font-medium"> Legacy</span> until cutover is explicitly approved.
          </p>
        </div>
      </div>

      {servingResolver === "bundle" ? (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-700">Entitlements Migration Status</p>
          </div>
          <p className="mt-2 text-sm font-medium">
            Bundle Resolver Active · Stabilization Period In Progress
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>• Legacy fallback still available</li>
            <li>• Shadow Logging {systemSettings.entitlementsShadowLog ? "enabled" : "disabled"}</li>
            <li>• Validation required before Legacy retirement</li>
            <li>• Phase 7 (Legacy retirement) has not started</li>
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Serving resolver</p>
          <p className="text-xs text-muted-foreground">
            The resolver that backs all live entitlement reads.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            servingResolver === "bundle"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
              : "border-border bg-background"
          }`}
        >
          {servingResolver}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm font-medium">Switch serving resolver</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Flips the resolver that backs every live entitlement read. The change takes effect
          immediately and is fully reversible — pick <span className="font-medium">Legacy</span> at
          any time to roll back.
        </p>
        <div className="mt-3 inline-flex rounded-lg border border-border bg-background p-1">
          <Button
            type="button"
            size="sm"
            variant={servingResolver === "legacy" ? "default" : "ghost"}
            className="h-8 px-4 text-xs"
            aria-pressed={servingResolver === "legacy"}
            onClick={() => onResolverChange("legacy")}
          >
            Legacy
          </Button>
          <Button
            type="button"
            size="sm"
            variant={servingResolver === "bundle" ? "default" : "ghost"}
            className="h-8 px-4 text-xs"
            aria-pressed={servingResolver === "bundle"}
            onClick={() => onResolverChange("bundle")}
          >
            Bundle
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Shadow logging</p>
          <p className="text-xs text-muted-foreground">
            Run the bundle resolver in parallel and log any divergence. Legacy keeps
            serving — returned values are unchanged.
          </p>
        </div>
        <Switch
          checked={systemSettings.entitlementsShadowLog}
          onCheckedChange={onShadowLogChange}
          aria-label="Toggle entitlement shadow logging"
        />
      </div>

      {systemSettings.entitlementsShadowLog ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          Shadow logging is <span className="font-semibold text-amber-600">ON</span>. Open the
          browser console and watch for{" "}
          <span className="font-mono">[entitlements] shadow divergence</span> warnings while you
          navigate. None should appear.
        </p>
      ) : null}
    </div>
  );
}
