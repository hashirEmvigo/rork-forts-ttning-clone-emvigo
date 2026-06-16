import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Pencil, Power, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LockedChip, Pill } from "@/components/calculator/configBadges";
import { PricingChangeHistory } from "@/components/calculator/PricingRulesView";
import {
  DEFAULT_QUOTE_STATUSES,
  PRICE_DISPLAY_MODES,
  RUT_DISPLAY_MODES,
  type CalculatorSettingsConfig,
  type DefaultQuoteStatusValue,
  type PriceDisplayModeValue,
  type PricingRuleAuditEntry,
  type RutDisplayModeValue,
  type SettingsPatch,
} from "@/lib/calculator/calculatorConfigAdmin";

function humanize(value: string): string {
  return value
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. No change was saved.";
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}

function SettingsEditDialog({
  settings,
  open,
  onOpenChange,
  onSave,
}: {
  settings: CalculatorSettingsConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (legacyId: string, patch: SettingsPatch) => Promise<void>;
}) {
  const [priceDisplayMode, setPriceDisplayMode] = useState<PriceDisplayModeValue>(
    settings.priceDisplayMode as PriceDisplayModeValue,
  );
  const [defaultQuoteStatus, setDefaultQuoteStatus] = useState<DefaultQuoteStatusValue>(
    settings.defaultQuoteStatus as DefaultQuoteStatusValue,
  );
  const [rutDisplayMode, setRutDisplayMode] = useState<RutDisplayModeValue>(
    settings.rutDisplayMode as RutDisplayModeValue,
  );
  const [validityDays, setValidityDays] = useState<string>(String(settings.quoteValidityDays));
  const [reviewThreshold, setReviewThreshold] = useState<string>(
    settings.manualReviewThresholdAmount === null ? "" : String(settings.manualReviewThresholdAmount),
  );
  const [showPriceBeforeContact, setShowPriceBeforeContact] = useState<boolean>(settings.showPriceBeforeContact);
  const [requireContactBeforeResult, setRequireContactBeforeResult] = useState<boolean>(
    settings.requireContactBeforeResult,
  );
  const [showLoginPromptAfterSubmit, setShowLoginPromptAfterSubmit] = useState<boolean>(
    settings.showLoginPromptAfterSubmit,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setPriceDisplayMode(settings.priceDisplayMode as PriceDisplayModeValue);
      setDefaultQuoteStatus(settings.defaultQuoteStatus as DefaultQuoteStatusValue);
      setRutDisplayMode(settings.rutDisplayMode as RutDisplayModeValue);
      setValidityDays(String(settings.quoteValidityDays));
      setReviewThreshold(
        settings.manualReviewThresholdAmount === null ? "" : String(settings.manualReviewThresholdAmount),
      );
      setShowPriceBeforeContact(settings.showPriceBeforeContact);
      setRequireContactBeforeResult(settings.requireContactBeforeResult);
      setShowLoginPromptAfterSubmit(settings.showLoginPromptAfterSubmit);
      setError(null);
    }
  }, [open, settings]);

  const handleSave = useCallback(async () => {
    setError(null);
    const days = Number(validityDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError("Quote validity must be a whole number of days between 1 and 365.");
      return;
    }
    let threshold: number | null = null;
    if (reviewThreshold.trim() !== "") {
      const t = Number(reviewThreshold);
      if (!Number.isFinite(t) || t < 0) {
        setError("Manual-review threshold must be empty or a number of 0 or more.");
        return;
      }
      threshold = t;
    }
    setSubmitting(true);
    try {
      await onSave(settings.legacyId, {
        priceDisplayMode,
        defaultQuoteStatus,
        rutDisplayMode,
        quoteValidityDays: days,
        manualReviewThresholdAmount: threshold,
        showPriceBeforeContact,
        requireContactBeforeResult,
        showLoginPromptAfterSubmit,
      });
      onOpenChange(false);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    validityDays,
    reviewThreshold,
    priceDisplayMode,
    defaultQuoteStatus,
    rutDisplayMode,
    showPriceBeforeContact,
    requireContactBeforeResult,
    showLoginPromptAfterSubmit,
    onSave,
    settings.legacyId,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit quote behaviour</DialogTitle>
          <DialogDescription>
            Display and behaviour settings. The public status switch and slug are managed separately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="qs-price-mode">Price display mode</Label>
            <Select value={priceDisplayMode} onValueChange={(v) => setPriceDisplayMode(v as PriceDisplayModeValue)}>
              <SelectTrigger id="qs-price-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_DISPLAY_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {humanize(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qs-status">Default quote status</Label>
            <Select value={defaultQuoteStatus} onValueChange={(v) => setDefaultQuoteStatus(v as DefaultQuoteStatusValue)}>
              <SelectTrigger id="qs-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_QUOTE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qs-rut">RUT display</Label>
            <Select value={rutDisplayMode} onValueChange={(v) => setRutDisplayMode(v as RutDisplayModeValue)}>
              <SelectTrigger id="qs-rut">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUT_DISPLAY_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {humanize(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qs-validity">Quote validity (days)</Label>
              <Input
                id="qs-validity"
                type="number"
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qs-threshold">Manual-review threshold ({settings.currency})</Label>
              <Input
                id="qs-threshold"
                type="number"
                placeholder="None"
                value={reviewThreshold}
                onChange={(e) => setReviewThreshold(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Show price before contact details</p>
            <Switch
              checked={showPriceBeforeContact}
              onCheckedChange={setShowPriceBeforeContact}
              aria-label="Show price before contact"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Require contact before result</p>
            <Switch
              checked={requireContactBeforeResult}
              onCheckedChange={setRequireContactBeforeResult}
              aria-label="Require contact before result"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Show login prompt after submit</p>
            <Switch
              checked={showLoginPromptAfterSubmit}
              onCheckedChange={setShowLoginPromptAfterSubmit}
              aria-label="Show login prompt after submit"
            />
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface QuoteSettingsEditorProps {
  settings: CalculatorSettingsConfig;
  enabled: boolean;
  isUpdatingEnabled: boolean;
  /**
   * GPM-UX-ADMIN-4 — the pricing-change history, relocated here from the Pricing
   * workspace. Optional so existing render sites stay valid; when present it is
   * shown as a third settings panel.
   */
  audit?: { entries: PricingRuleAuditEntry[]; isLoading: boolean };
  onRequestToggleEnabled: () => void;
  onSaveSettings: (legacyId: string, patch: SettingsPatch) => Promise<void>;
}

/**
 * Quote Settings editor — safe display/behaviour fields via an explicit dialog.
 * The public enable switch keeps its existing confirm flow (delegated to the
 * page) and the public slug is intentionally read-only (changing it would affect
 * the route, SEO, Edge Function config and media placement).
 */
export function QuoteSettingsEditor({
  settings,
  enabled,
  isUpdatingEnabled,
  audit,
  onRequestToggleEnabled,
  onSaveSettings,
}: QuoteSettingsEditorProps) {
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  return (
    <div className="space-y-4">
      {/* GPM-UX-ADMIN-4 — three dense settings panels side by side on wide screens. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        {/* Public status */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Public status</h3>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <DetailRow label="Status">
              <Pill tone={enabled ? "green" : "muted"}>{enabled ? "Public" : "Dark"}</Pill>
            </DetailRow>
            <DetailRow label="Public URL">
              <span className="font-mono text-xs">/{settings.publicSlug ?? "—"}</span>
            </DetailRow>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Public slug is locked here</span>
              <LockedChip>{settings.publicSlug ?? "—"}</LockedChip>
            </div>
            <Button
              variant={enabled ? "outline" : "default"}
              onClick={onRequestToggleEnabled}
              disabled={isUpdatingEnabled}
            >
              {isUpdatingEnabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {enabled ? "Disable calculator" : "Enable calculator"}
            </Button>
          </div>
        </section>

        {/* Quote behaviour */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Quote behaviour</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <DetailRow label="Price display">{humanize(settings.priceDisplayMode)}</DetailRow>
            <DetailRow label="Default quote status">{humanize(settings.defaultQuoteStatus)}</DetailRow>
            <DetailRow label="RUT display">{humanize(settings.rutDisplayMode)}</DetailRow>
            <DetailRow label="Quote validity">{settings.quoteValidityDays} days</DetailRow>
            <DetailRow label="Manual-review threshold">
              {settings.manualReviewThresholdAmount === null
                ? "None"
                : `${settings.manualReviewThresholdAmount.toLocaleString("sv-SE")} ${settings.currency}`}
            </DetailRow>
            <DetailRow label="Currency">
              <span className="font-mono text-xs">{settings.currency}</span>
            </DetailRow>
          </div>
        </section>

        {/* Recent pricing changes — relocated from the Pricing workspace (GPM-UX-ADMIN-4). */}
        {audit ? <PricingChangeHistory entries={audit.entries} isLoading={audit.isLoading} /> : null}
      </div>

      <SettingsEditDialog
        settings={settings}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={onSaveSettings}
      />
    </div>
  );
}

export default QuoteSettingsEditor;
