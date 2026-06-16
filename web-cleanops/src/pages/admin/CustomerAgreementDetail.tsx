/**
 * CustomerAgreementDetail — the FIRST host page for a single Customer Agreement
 * (Phase 14) and the first surface to MOUNT the Time Bank admin panel.
 *
 * A clean, admin-only detail view that loads one agreement version (with its
 * lines and version-chain metadata) through {@link useCustomerAgreementDetailSource}
 * and renders four sections: agreement summary, commercial lines, version
 * information, and the Time Bank panel. The Time Bank panel is wired to the real
 * persistence layer via {@link useTimeBankPanel}, with the company's entitlement
 * resolved through the real entitlement pipeline ({@link resolveTimeBankEntitlement}).
 *
 * SAFETY (foundation only — admin-only, not verified, not customer-facing):
 *   * Read-only host: no agreement editing, no wallet provisioning, no billing,
 *     no scheduler, no customer portal. The panel never creates a wallet.
 *   * Entitlement governs Time Bank access; a denied company sees a disabled,
 *     read-only panel state and no wallet is ever created from here.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText, History, ListChecks, ScrollText } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AccessDenied } from "@/components/AccessDenied";
import { TimeBankAdminPanel } from "@/components/customer/TimeBankAdminPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { useCustomerAgreementDetailSource } from "@/hooks/use-customer-agreement-detail-source";
import { useTimeBankPanel } from "@/hooks/use-time-bank-panel";
import { resolveTimeBankEntitlement, type TimeBankEntitlementDecision } from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  AGREEMENT_SOURCE_TYPE_LABELS,
  AGREEMENT_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  INVOICE_INTERVAL_LABELS,
} from "@/types";

/** A label + value row shared across the summary/version cards. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default function CustomerAgreementDetail() {
  const { agreementId } = useParams<{ agreementId: string }>();
  const navigate = useNavigate();
  const { currentUser, hasPermission } = useApp();

  // Super admins read unscoped; company users are scoped to their tenant (RLS-aligned).
  const companyScope = useMemo(
    () => (currentUser?.role === "super_admin" ? undefined : currentUser?.companyId ?? undefined),
    [currentUser?.role, currentUser?.companyId],
  );

  const { agreement, lines, versionChain, loading, error } =
    useCustomerAgreementDetailSource(agreementId, companyScope);

  // ── Resolve the real Time Bank entitlement for the agreement's company ──
  const [entitlement, setEntitlement] = useState<TimeBankEntitlementDecision | null>(null);
  const agreementCompanyId = agreement?.companyId;
  useEffect(() => {
    if (!agreementCompanyId) {
      setEntitlement(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const decision = await resolveTimeBankEntitlement(agreementCompanyId);
        if (active) setEntitlement(decision);
      } catch {
        // Resolver failure denies safely — the panel renders a disabled state.
        if (active) setEntitlement(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [agreementCompanyId]);

  // The cancellation-credit policy lives on the wallet's rules once a wallet
  // exists; the panel hook owns the wallet, so we pass null here and let the
  // ledger/wallet surface the authoritative policy.
  const panel = useTimeBankPanel({
    agreementGroupId: agreement?.agreementGroupId,
    companyId: agreementCompanyId,
    // This is the dedicated Time Bank admin host: always render the panel so an
    // admin can review entitlement/wallet status (entitled, denied, or no wallet).
    timeBankEnabledOnAgreement: true,
    entitlement,
    cancellationPolicy: null,
    actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
  });

  if (!hasPermission("users.manage")) {
    return (
      <DashboardLayout wide>
        <AccessDenied />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout wide>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Loading agreement…
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-destructive">Couldn’t load this agreement.</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        ) : !agreement ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Agreement not found</p>
              <p className="text-sm text-muted-foreground">
                It may have been removed, or it isn’t available for your company.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Agreement summary ── */}
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ScrollText className="h-5 w-5 text-primary" />
                    {agreement.name ?? "Customer agreement"}
                  </CardTitle>
                  <CardDescription>
                    Admin-only · internal view. Not customer-facing.
                  </CardDescription>
                </div>
                <Badge variant="secondary">{AGREEMENT_STATUS_LABELS[agreement.status]}</Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <Field label="Billing model" value={BILLING_MODEL_LABELS[agreement.billingModel]} />
                <Field
                  label="Invoice interval"
                  value={INVOICE_INTERVAL_LABELS[agreement.invoiceInterval]}
                />
                <Field label="Source" value={AGREEMENT_SOURCE_TYPE_LABELS[agreement.sourceType]} />
                <Field
                  label="Valid from"
                  value={agreement.validFrom ? formatDate(agreement.validFrom) : "—"}
                />
                <Field
                  label="Valid to"
                  value={agreement.validTo ? formatDate(agreement.validTo) : "Open-ended"}
                />
                <Field label="Customer" value={agreement.customerId} />
                <Field label="Agreement group" value={agreement.agreementGroupId} />
              </CardContent>
            </Card>

            {/* ── Agreement lines ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4" /> Service lines
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No service lines on this version.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead>
                          <TableHead>Pricing</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.id} data-testid={`agreement-line-${line.id}`}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm">{line.serviceNameSnapshot}</span>
                                {line.categoryNameSnapshot && (
                                  <span className="text-xs text-muted-foreground">
                                    {line.categoryNameSnapshot}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {line.pricingModel}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {line.quantity ?? "—"}
                              {line.unit ? ` ${line.unit}` : ""}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {line.agreedPrice ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Version information ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4" /> Version information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Field label="This version" value={`v${agreement.version}`} />
                  <Field label="Versions in chain" value={versionChain.length || 1} />
                  <Field label="Created" value={formatDate(agreement.createdAt)} />
                  <Field label="Updated" value={formatDate(agreement.updatedAt)} />
                </div>
                {versionChain.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {versionChain.map((v) => (
                      <Badge
                        key={v.id}
                        variant={v.id === agreement.id ? "default" : "outline"}
                        className="text-xs"
                      >
                        v{v.version} · {AGREEMENT_STATUS_LABELS[v.status]}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Time Bank panel ── */}
            {panel.loadError && (
              <p className="text-sm text-destructive" role="alert">
                {panel.loadError}
              </p>
            )}
            {panel.actionError && (
              <p className="text-sm text-destructive" role="alert">
                {panel.actionError}
              </p>
            )}
            <TimeBankAdminPanel input={panel.input} {...panel.handlers} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
