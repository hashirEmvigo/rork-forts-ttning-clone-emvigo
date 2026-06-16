/**
 * AgreementTemplates — the FIRST Super Admin Agreement Templates management
 * surface (Phase 15 · admin foundation UI only).
 *
 * A two-pane management console for the reusable Agreement Template BLUEPRINTS
 * companies create Customer Agreements from. The left pane lists the GLOBAL
 * library (and, when a company is selected, that company's templates); the
 * right pane shows the selected template's detail: header defaults, service
 * lines, the immutable version chain, the read-only Time Bank defaults and the
 * cancellation-credit defaults. Super Admins can create / edit / publish /
 * archive global templates, add or deactivate lines, and copy a global template
 * into a company.
 *
 * SAFETY (foundation UI only — admin-only, NOT verified, NOT customer-facing):
 *   * Manages BLUEPRINTS only — never creates a Customer Agreement and never
 *     provisions a Time Bank wallet (the entitlement gate governs that elsewhere).
 *   * Versioning stays immutable (edits re-persist the same version row); archive
 *     is a status flip, never a destructive delete.
 *   * Time Bank / cancellation-credit settings are DISPLAYED here; activation
 *     happens through the orchestration + entitlement pipeline, not this screen.
 */
import { useMemo, useState } from "react";
import {
  Archive,
  Copy,
  FileText,
  Globe,
  History,
  ListChecks,
  Pencil,
  Plus,
  ScrollText,
  Send,
  Timer,
  Trash2,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useApp } from "@/context/AppContext";
import { useAgreementTemplatesAdmin } from "@/hooks/use-agreement-templates-admin";
import {
  toCancellationDefaultsView,
  toLatestVersionRows,
  toTemplateLineRows,
  toTimeBankDefaultsView,
  toVersionChain,
} from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  BILLING_MODELS,
  BILLING_MODEL_LABELS,
  INVOICE_INTERVALS,
  INVOICE_INTERVAL_LABELS,
  type AgreementTemplate,
  type AgreementTemplateStatus,
  type BillingModel,
  type InvoiceInterval,
} from "@/types";

const STATUS_VARIANT: Record<AgreementTemplateStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  draft: "secondary",
  inactive: "outline",
  superseded: "outline",
};

/** A label + value stack used across the detail cards. */
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

export default function AgreementTemplates() {
  const { currentUser, companies } = useApp();
  const admin = useAgreementTemplatesAdmin();

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [copyOpen, setCopyOpen] = useState<boolean>(false);
  const [lineOpen, setLineOpen] = useState<boolean>(false);

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.status === "active"),
    [companies],
  );

  const globalRows = useMemo(
    () => toLatestVersionRows(admin.globalTemplates),
    [admin.globalTemplates],
  );
  const companyRows = useMemo(
    () => toLatestVersionRows(admin.companyTemplates),
    [admin.companyTemplates],
  );

  if (currentUser?.role !== "super_admin") {
    return (
      <DashboardLayout wide>
        <AccessDenied />
      </DashboardLayout>
    );
  }

  const detail = admin.detail;
  const selectedCompanyName =
    companies.find((c) => c.id === admin.selectedCompanyId)?.name ?? null;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Agreement Templates"
        description="Reusable blueprints for Customer Agreements. Edits create no agreements and provision no wallets — they only shape future agreements."
        action={
          <Button onClick={() => setCreateOpen(true)} disabled={!admin.enabled} className="gap-1.5">
            <Plus className="h-4 w-4" /> New global template
          </Button>
        }
      />

      {!admin.enabled ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Template storage unavailable</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Agreement Templates are stored in the platform database, which isn’t configured in
              this environment. Connect Supabase to manage templates.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {admin.loadError && (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {admin.loadError}
            </p>
          )}
          {admin.actionError && (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {admin.actionError}
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* ── Left: template lists ── */}
            <div className="space-y-6">
              {/* Global templates */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Globe className="h-4 w-4" /> Global library
                  </CardTitle>
                  <CardDescription>
                    Platform-owned templates every company can copy.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {admin.loading && globalRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
                  ) : globalRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No global templates yet. Create the first one.
                    </p>
                  ) : (
                    globalRows.map((row) => (
                      <button
                        key={row.templateGroupId}
                        type="button"
                        data-testid={`template-row-${row.id}`}
                        onClick={() => admin.selectTemplate(row.id)}
                        className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                          detail?.template.id === row.id ? "border-primary bg-muted/40" : "border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{row.name}</span>
                          <Badge variant={STATUS_VARIANT[row.status]} className="text-[10px]">
                            {row.statusLabel}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>v{row.version}</span>
                          <span>·</span>
                          <span>{row.billingLabel}</span>
                          {row.timeBankEnabled && (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <Timer className="h-3 w-3" /> Time Bank
                            </Badge>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Company templates */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ScrollText className="h-4 w-4" /> Company templates
                  </CardTitle>
                  <CardDescription>
                    Inspect a single company’s own templates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select
                    value={admin.selectedCompanyId ?? "none"}
                    onValueChange={(v) => admin.selectCompany(v === "none" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No company selected</SelectItem>
                      {activeCompanies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {admin.selectedCompanyId &&
                    (companyRows.length === 0 ? (
                      <p className="py-2 text-center text-sm text-muted-foreground">
                        {selectedCompanyName} has no templates yet.
                      </p>
                    ) : (
                      companyRows.map((row) => (
                        <button
                          key={row.templateGroupId}
                          type="button"
                          data-testid={`template-row-${row.id}`}
                          onClick={() => admin.selectTemplate(row.id)}
                          className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                            detail?.template.id === row.id ? "border-primary bg-muted/40" : "border-border"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{row.name}</span>
                            <Badge variant={STATUS_VARIANT[row.status]} className="text-[10px]">
                              {row.statusLabel}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>v{row.version}</span>
                            {row.isCopy && <span>· copied from global</span>}
                          </div>
                        </button>
                      ))
                    ))}
                </CardContent>
              </Card>
            </div>

            {/* ── Right: detail ── */}
            <div>
              {!detail ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-2 py-20 text-center">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Select a template</p>
                    <p className="text-sm text-muted-foreground">
                      Choose a template on the left to view its details and versions.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <TemplateDetailView
                  detail={detail}
                  pending={admin.pending}
                  onEdit={() => setEditOpen(true)}
                  onCopy={() => setCopyOpen(true)}
                  onAddLine={() => setLineOpen(true)}
                  onPublish={() => admin.publishTemplate(detail.template.id)}
                  onArchive={() => admin.archive(detail.template.id)}
                  onDeactivateLine={(lineId) => admin.deactivateLine(detail.template.id, lineId)}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Create dialog ── */}
      <TemplateFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        pending={admin.pending}
        onSubmit={async (values) => {
          const ok = await admin.createGlobalTemplate(values);
          if (ok) setCreateOpen(false);
        }}
      />

      {/* ── Edit dialog ── */}
      {detail && (
        <TemplateFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          pending={admin.pending}
          initial={detail.template}
          onSubmit={async (values) => {
            const ok = await admin.editTemplate(detail.template.id, values);
            if (ok) setEditOpen(false);
          }}
        />
      )}

      {/* ── Copy-to-company dialog ── */}
      {detail && (
        <CopyToCompanyDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          pending={admin.pending}
          templateName={detail.template.name}
          companies={activeCompanies.map((c) => ({ id: c.id, name: c.name }))}
          onSubmit={async (companyId, name) => {
            const ok = await admin.copyToCompany(detail.template.id, companyId, name);
            if (ok) setCopyOpen(false);
          }}
        />
      )}

      {/* ── Add-line dialog ── */}
      {detail && (
        <AddLineDialog
          open={lineOpen}
          onOpenChange={setLineOpen}
          pending={admin.pending}
          onSubmit={async (values) => {
            const ok = await admin.addLine(detail.template.id, values);
            if (ok) setLineOpen(false);
          }}
        />
      )}
    </DashboardLayout>
  );
}

// ── Detail view ────────────────────────────────────────────

function TemplateDetailView({
  detail,
  pending,
  onEdit,
  onCopy,
  onAddLine,
  onPublish,
  onArchive,
  onDeactivateLine,
}: {
  detail: { template: AgreementTemplate; lines: import("@/types").AgreementTemplateLine[]; versionChain: AgreementTemplate[] };
  pending: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onAddLine: () => void;
  onPublish: () => void;
  onArchive: () => void;
  onDeactivateLine: (lineId: string) => void;
}) {
  const { template } = detail;
  const lineRows = useMemo(() => toTemplateLineRows(detail.lines), [detail.lines]);
  const tb = useMemo(() => toTimeBankDefaultsView(template), [template]);
  const cancel = useMemo(
    () => toCancellationDefaultsView(template.timeBankTemplateRules?.cancellationCreditPolicy),
    [template],
  );
  const chain = useMemo(
    () => toVersionChain(detail.versionChain, template.id),
    [detail.versionChain, template.id],
  );

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-lg">{template.name}</CardTitle>
            <CardDescription>
              {template.description || "No description."}
            </CardDescription>
          </div>
          <Badge variant={STATUS_VARIANT[template.status]}>
            {template.status === "active" ? "Active" : template.status === "draft" ? "Draft" : template.status === "inactive" ? "Inactive" : "Superseded"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Ownership" value={template.ownerType === "global" ? "Global" : "Company"} />
            <Field label="Billing model" value={BILLING_MODEL_LABELS[template.billingModel]} />
            <Field label="Invoice interval" value={INVOICE_INTERVAL_LABELS[template.invoiceInterval]} />
            <Field label="Time Bank eligible" value={template.timeBankEligible ? "Yes" : "No"} />
            <Field label="Updated" value={formatDate(template.updatedAt)} />
            {template.copiedFromTemplateId && (
              <Field label="Copied from" value={template.copiedFromTemplateId} />
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onEdit} disabled={pending} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            {template.status === "draft" && (
              <Button size="sm" onClick={onPublish} disabled={pending} className="gap-1.5">
                <Send className="h-3.5 w-3.5" /> Publish
              </Button>
            )}
            {template.ownerType === "global" && (
              <Button variant="outline" size="sm" onClick={onCopy} disabled={pending} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" /> Copy to company
              </Button>
            )}
            {template.status !== "inactive" && (
              <Button
                variant="outline"
                size="sm"
                onClick={onArchive}
                disabled={pending}
                className="gap-1.5 text-muted-foreground"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> Service lines
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onAddLine} disabled={pending} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        </CardHeader>
        <CardContent>
          {lineRows.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No service lines yet. Add at least one before publishing.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Pricing</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineRows.map((line) => (
                    <TableRow
                      key={line.id}
                      data-testid={`template-line-${line.id}`}
                      className={line.active ? "" : "opacity-50"}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">{line.serviceName}</span>
                          {line.categoryName && (
                            <span className="text-xs text-muted-foreground">{line.categoryName}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{line.pricingModel}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.quantityLabel}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.priceLabel}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.durationLabel}</TableCell>
                      <TableCell className="text-right">
                        {line.active && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            disabled={pending}
                            aria-label={`Deactivate ${line.serviceName}`}
                            onClick={() => onDeactivateLine(line.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time Bank defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="h-4 w-4" /> Time Bank defaults
          </CardTitle>
          <CardDescription>
            Suggested only — the entitlement gate decides whether a wallet is ever created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!tb.enabled ? (
            <p className="text-sm text-muted-foreground" data-testid="time-bank-disabled">
              Time Bank is off for this template.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Allocation" value={tb.allocationLabel} />
              <Field label="Refill" value={tb.refillLabel} />
              <Field label="Carryover" value={tb.carryoverLabel} />
              <Field label="Max balance" value={tb.maxBalanceLabel} />
              <Field label="Expiry" value={tb.expiryLabel} />
              <Field label="Negative floor" value={tb.negativeFloorLabel} />
              <Field label="Warning at" value={tb.warningLabel} />
              <Field label="Critical at" value={tb.criticalLabel} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancellation credit defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cancellation credit defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={cancel.enabled ? "default" : "outline"}>{cancel.methodLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{cancel.deductionDetail}</p>
          {cancel.enabled && cancel.minCreditLabel !== "—" && (
            <p className="text-sm text-muted-foreground">Minimum credit: {cancel.minCreditLabel}</p>
          )}
        </CardContent>
      </Card>

      {/* Version chain */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Version history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {chain.map((v) => (
              <Badge
                key={v.id}
                variant={v.isCurrent ? "default" : "outline"}
                className="text-xs"
                data-testid={`version-${v.version}`}
              >
                v{v.version} · {v.statusLabel}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Create / Edit dialog ───────────────────────────────────

interface TemplateFormValues {
  name: string;
  description?: string;
  billingModel?: BillingModel;
  invoiceInterval?: InvoiceInterval;
  timeBankEligible?: boolean;
}

function TemplateFormDialog({
  open,
  onOpenChange,
  mode,
  pending,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  pending: boolean;
  initial?: AgreementTemplate;
  onSubmit: (values: TemplateFormValues) => void;
}) {
  const [name, setName] = useState<string>(initial?.name ?? "");
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [billingModel, setBillingModel] = useState<BillingModel>(initial?.billingModel ?? "per_visit");
  const [invoiceInterval, setInvoiceInterval] = useState<InvoiceInterval>(
    initial?.invoiceInterval ?? "monthly",
  );
  const [timeBankEligible, setTimeBankEligible] = useState<boolean>(initial?.timeBankEligible ?? false);

  // Re-seed the form whenever it opens (initial may have changed).
  const seedKey = `${open}-${initial?.id ?? "new"}`;
  const [lastSeed, setLastSeed] = useState<string>(seedKey);
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setBillingModel(initial?.billingModel ?? "per_visit");
    setInvoiceInterval(initial?.invoiceInterval ?? "monthly");
    setTimeBankEligible(initial?.timeBankEligible ?? false);
  }

  const canSubmit = name.trim().length > 0 && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New global template" : "Edit template"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a draft blueprint. Publish it when it’s ready for companies to use."
              : "Update this template’s defaults. Existing agreements are unaffected."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Private Standard"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional clarifying note"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Billing model</Label>
              <Select value={billingModel} onValueChange={(v) => setBillingModel(v as BillingModel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {BILLING_MODEL_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Invoice interval</Label>
              <Select
                value={invoiceInterval}
                onValueChange={(v) => setInvoiceInterval(v as InvoiceInterval)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_INTERVALS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {INVOICE_INTERVAL_LABELS[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Time Bank eligible</span>
              <span className="text-xs text-muted-foreground">
                Suggestion only — entitlement still gates wallet creation.
              </span>
            </div>
            <Switch checked={timeBankEligible} onCheckedChange={setTimeBankEligible} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                description: description.trim() || undefined,
                billingModel,
                invoiceInterval,
                timeBankEligible,
              })
            }
          >
            {mode === "create" ? "Create draft" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Copy-to-company dialog ─────────────────────────────────

function CopyToCompanyDialog({
  open,
  onOpenChange,
  pending,
  templateName,
  companies,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  templateName: string;
  companies: { id: string; name: string }[];
  onSubmit: (companyId: string, name?: string) => void;
}) {
  const [companyId, setCompanyId] = useState<string>("");
  const [name, setName] = useState<string>("");

  const seedKey = String(open);
  const [lastSeed, setLastSeed] = useState<string>(seedKey);
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setCompanyId("");
    setName("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy to company</DialogTitle>
          <DialogDescription>
            Create an independent draft copy of “{templateName}” owned by a company. Future edits to
            the global template won’t affect the copy.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
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
          <div className="space-y-1.5">
            <Label htmlFor="copy-name">New name (optional)</Label>
            <Input
              id="copy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={templateName}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!companyId || pending}
            onClick={() => onSubmit(companyId, name.trim() || undefined)}
          >
            Copy template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add-line dialog ────────────────────────────────────────

function AddLineDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (values: {
    serviceNameSnapshot: string;
    categoryNameSnapshot?: string | null;
    defaultPrice?: number | null;
    defaultQuantity?: number | null;
    unit?: string;
    defaultDurationMinutes?: number | null;
  }) => void;
}) {
  const [service, setService] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [duration, setDuration] = useState<string>("");

  const seedKey = String(open);
  const [lastSeed, setLastSeed] = useState<string>(seedKey);
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setService("");
    setCategory("");
    setPrice("");
    setQuantity("");
    setDuration("");
  }

  const num = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add service line</DialogTitle>
          <DialogDescription>
            Suggested defaults snapshotted into agreements created from this template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="line-service">Service name</Label>
            <Input
              id="line-service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. Standard cleaning"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="line-category">Category (optional)</Label>
            <Input
              id="line-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Recurring"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="line-price">Price</Label>
              <Input id="line-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-qty">Quantity</Label>
              <Input id="line-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-duration">Minutes</Label>
              <Input id="line-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={service.trim().length === 0 || pending}
            onClick={() =>
              onSubmit({
                serviceNameSnapshot: service.trim(),
                categoryNameSnapshot: category.trim() || null,
                defaultPrice: num(price),
                defaultQuantity: num(quantity),
                defaultDurationMinutes: num(duration),
              })
            }
          >
            Add line
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
