import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { PayrollExportProfileDialog } from "@/components/settings/PayrollExportProfileDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { isPayrollExportTargetImplemented } from "@/lib/payroll/registry";
import { PAYROLL_EXPORT_TARGETS, PAYROLL_EXPORT_TARGET_LABELS } from "@/types";
import type { PayrollExportProfile } from "@/types";

/**
 * Settings → Payroll → Export Profiles.
 *
 * Branches by role:
 *  - Super Admin sees the capability matrix and activates export targets per
 *    company (the platform owns which export types each company may use).
 *  - Company Admin configures profiles for the targets enabled for their company
 *    and reviews recent export runs.
 *
 * This is the architecture foundation — real integrations are not wired yet, so
 * unbuilt targets are clearly marked "coming soon".
 */
export function PayrollExportPanel() {
  const {
    currentUser,
    companies,
    canManagePayrollExportEntitlements,
    canManagePayrollExportProfiles,
    isPayrollExportTargetEnabled,
    setPayrollExportCapability,
  } = useApp();
  const isSuperAdmin = currentUser?.role === "super_admin";

  if (isSuperAdmin && canManagePayrollExportEntitlements()) {
    return (
      <CapabilityMatrix
        companies={companies}
        isEnabled={isPayrollExportTargetEnabled}
        setCapability={setPayrollExportCapability}
      />
    );
  }

  return <CompanyExportProfiles canManage={canManagePayrollExportProfiles()} />;
}

// ── Super Admin: capability matrix ───────────────────────────────────────────

interface CapabilityMatrixProps {
  companies: ReturnType<typeof useApp>["companies"];
  isEnabled: ReturnType<typeof useApp>["isPayrollExportTargetEnabled"];
  setCapability: ReturnType<typeof useApp>["setPayrollExportCapability"];
}

function CapabilityMatrix({ companies, isEnabled, setCapability }: CapabilityMatrixProps) {
  const { toast } = useToast();
  const activeCompanies = useMemo(
    () => companies.filter((c) => c.status === "active"),
    [companies],
  );
  const [companyId, setCompanyId] = useState<string>(activeCompanies[0]?.id ?? "");

  const handleToggle = (target: (typeof PAYROLL_EXPORT_TARGETS)[number]["value"], on: boolean) => {
    if (!companyId) return;
    const result = setCapability(companyId, target, on);
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
    }
  };

  if (activeCompanies.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        No companies are available to configure yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:max-w-xs">
        <label className="text-sm font-medium" htmlFor="payroll-company">
          Company
        </label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger id="payroll-company">
            <SelectValue placeholder="Select a company" />
          </SelectTrigger>
          <SelectContent>
            {activeCompanies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Export type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PAYROLL_EXPORT_TARGETS.map((t) => {
              const enabled = companyId ? isEnabled(companyId, t.value) : false;
              const implemented = isPayrollExportTargetImplemented(t.value);
              return (
                <TableRow key={t.value}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.description}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {implemented ? (
                      <Badge variant="outline">Adapter ready</Badge>
                    ) : (
                      <Badge variant="secondary">Coming soon</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => handleToggle(t.value, v)}
                      aria-label={`${enabled ? "Disable" : "Enable"} ${t.label}`}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Enabling a type lets the company create and configure export profiles for it. Real
        integrations are added per type without changing payroll calculation.
      </p>
    </div>
  );
}

// ── Company Admin: export profiles ───────────────────────────────────────────

function CompanyExportProfiles({ canManage }: { canManage: boolean }) {
  const {
    currentUser,
    getPayrollExportProfilesForCompany,
    getAvailablePayrollExportTargets,
    getPayrollExportRunsForCompany,
    setPayrollExportProfileActive,
    deletePayrollExportProfile,
  } = useApp();
  const { toast } = useToast();
  const companyId = currentUser?.companyId ?? null;

  const profiles = getPayrollExportProfilesForCompany();
  const availableTargets = getAvailablePayrollExportTargets();
  const runs = getPayrollExportRunsForCompany();

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<PayrollExportProfile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PayrollExportProfile | null>(null);

  if (!companyId) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Payroll export profiles are managed per company.
      </p>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (profile: PayrollExportProfile) => {
    setEditing(profile);
    setDialogOpen(true);
  };

  const handleToggle = (profile: PayrollExportProfile, active: boolean) => {
    const result = setPayrollExportProfileActive(profile.id, active);
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const result = deletePayrollExportProfile(pendingDelete.id);
    if (!result.ok) {
      toast({ title: "Couldn't delete", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Profile deleted", description: `${pendingDelete.name} removed.` });
    }
    setPendingDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {availableTargets.length > 0
            ? `${availableTargets.length} export type${availableTargets.length === 1 ? "" : "s"} enabled for your company.`
            : "No export types are enabled for your company yet. Contact your platform admin."}
        </p>
        {canManage ? (
          <Button onClick={openCreate} disabled={availableTargets.length === 0} className="shrink-0">
            <Plus className="h-4 w-4" /> New profile
          </Button>
        ) : null}
      </div>

      {profiles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 py-16 text-center text-muted-foreground">
          <Wallet className="h-8 w-8 opacity-40" />
          <p className="text-sm">No export profiles yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-36">Export type</TableHead>
                <TableHead className="w-28">Status</TableHead>
                {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{PAYROLL_EXPORT_TARGET_LABELS[p.target]}</Badge>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.active}
                          onCheckedChange={(v) => handleToggle(p, v)}
                          aria-label={p.active ? "Deactivate" : "Activate"}
                        />
                        <span className="text-xs text-muted-foreground">
                          {p.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    ) : (
                      <Badge variant={p.active ? "outline" : "secondary"}>
                        {p.active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(p)}
                          aria-label="Edit profile"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete(p)}
                          aria-label="Delete profile"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {runs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent export runs</h3>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-20 text-center">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.slice(0, 10).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {new Date(r.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "success"
                            ? "outline"
                            : r.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm">{r.rowsIncluded}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <PayrollExportProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        profile={editing}
        companyId={companyId}
        availableTargets={availableTargets}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this export profile?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be permanently removed. This can't be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
