import { Activity, CalendarRange, Info, Sparkles, ShieldCheck } from "lucide-react";

import { Link } from "react-router-dom";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntitlementResolverCutoverPanel } from "@/components/settings/EntitlementResolverCutoverPanel";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { BOOKING_HORIZON_OPTIONS } from "@/types";
import type { BookingGenerationHorizonMonths } from "@/types";

/**
 * Master Admin / System Settings. Platform-level configuration that is not
 * scoped to a single company. Currently holds the booking-generation horizon
 * that will later bound how far ahead recurring Booking Queue items are created.
 */
export default function SystemSettings() {
  const { currentUser, systemSettings, updateSystemSettings } = useApp();
  const { toast } = useToast();

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  const onHorizonChange = (value: string) => {
    const months = Number(value) as BookingGenerationHorizonMonths;
    const res = updateSystemSettings({ bookingGenerationHorizonMonths: months });
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "System settings saved" });
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="System Settings"
        description="Platform-wide configuration that applies across every company."
      />

      <div className="max-w-2xl space-y-5">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarRange className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Booking Generation Horizon</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                How far into the future recurring Work Order service rows may generate
                Booking Lists items. Bookings are never created beyond this horizon, which
                keeps the lists from loading and storing unnecessary future data.
              </p>
            </div>
          </div>
          <div className="mt-4 max-w-[220px]">
            <Select
              value={String(systemSettings.bookingGenerationHorizonMonths)}
              onValueChange={onHorizonChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_HORIZON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Last updated {formatDate(systemSettings.updatedAt)}.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Add-on Services & Entitlements</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Managing optional features, global availability and per-company entitlements has
              moved to its own workspace.
            </p>
            <Link
              to="/services"
              className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
            >
              Go to Services →
            </Link>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Entitlement Shadow Validation</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Run a real-data parity check between the legacy entitlement path and the new
              bundle pipeline. Read-only — nothing is written and no flag is changed.
            </p>
            <Link
              to="/entitlement-validation"
              className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
            >
              Open validation →
            </Link>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">System Performance</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Internal diagnostics over the in-app performance instrumentation — render counts,
              cache hit rates, computation timings, and budget validation. Read-only.
            </p>
            <Link
              to="/system-performance"
              className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
            >
              Open monitoring →
            </Link>
          </div>
        </div>

        <EntitlementResolverCutoverPanel />

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The recurrence rule always stays on the Work Order service row — only the
            generated Booking Lists items are bounded by this horizon. A future background
            or manual refresh can extend the lists as time passes.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
