/**
 * CustomerAgreementsPanel — the Customer workspace "Agreements" tab.
 *
 * A read-only surface that lists the Customer Agreements belonging to ONE
 * customer and links each to the existing agreement detail page
 * (`/agreements/:agreementId`). It reuses the validated read seam
 * ({@link useCustomerAgreementsSource}) so the list always matches what the
 * detail page can open, scoped to the customer's company.
 *
 * SAFETY: read-only. No agreement creation, editing, versioning, wallet
 * provisioning, or billing happens here — it only reads summaries and navigates.
 */
import { useNavigate } from "react-router-dom";
import { ChevronRight, ScrollText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useCustomerAgreementsSource } from "@/hooks/use-customer-agreements-source";
import { formatDate } from "@/lib/format";
import {
  AGREEMENT_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  INVOICE_INTERVAL_LABELS,
  type AgreementStatus,
} from "@/types";

/** Maps an agreement status to a badge variant for the list. */
function statusVariant(
  status: AgreementStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "active":
      return "default";
    case "paused":
      return "secondary";
    case "draft":
      return "outline";
    default:
      return "outline";
  }
}

export function CustomerAgreementsPanel({
  customerId,
  companyScope,
}: {
  /** The customer whose agreements are listed. */
  customerId: string;
  /** Viewer scope — undefined/null for super admins, else the active company id. */
  companyScope: string | null | undefined;
}) {
  const navigate = useNavigate();
  const { agreements, loading, error } = useCustomerAgreementsSource(
    customerId,
    companyScope,
  );

  if (loading && agreements.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        Loading agreements…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-card p-10 text-center">
        <p className="text-sm font-medium text-destructive">
          Couldn’t load this customer’s agreements.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (agreements.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ScrollText className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-medium">No agreements yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Commercial agreements for this customer will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Agreement</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Billing</th>
              <th className="px-4 py-3 font-medium">Interval</th>
              <th className="px-4 py-3 font-medium">Valid from</th>
              <th className="px-4 py-3" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {agreements.map((a) => (
              <tr
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/agreements/${a.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/agreements/${a.id}`);
                  }
                }}
                className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="px-4 py-3 font-medium tabular-nums">
                  Version {a.version}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant(a.status)}>
                    {AGREEMENT_STATUS_LABELS[a.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {BILLING_MODEL_LABELS[a.billingModel]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {INVOICE_INTERVAL_LABELS[a.invoiceInterval]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {a.validFrom ? formatDate(a.validFrom) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  <ChevronRight className="ml-auto h-4 w-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
