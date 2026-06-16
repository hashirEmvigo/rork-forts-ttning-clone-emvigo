import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Info,
  Library,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LockedChip, Pill } from "@/components/calculator/configBadges";
import {
  classifyServiceGroup,
  serviceStatusBadges,
} from "@/components/calculator/serviceListPresentation";
import { InactiveItemsToggle } from "@/components/calculator/serviceWorkbench";
import {
  buildQuestionLibraryActivationInput,
  computeServiceReadiness,
  defaultSettingsForGenericModel,
  DEFAULT_NEW_SERVICE_PRICING_MODEL,
  GENERIC_PRICING_MODEL_OPTIONS,
  GENERIC_PRICING_MODEL_SUMMARIES,
  isEngineBackedPricingModel,
  OPTION_INPUT_TYPES,
  PRICING_SUPPORTED_QUESTION_KEYS,
  SUPPORTED_INPUT_TYPES,
  validateNewQuestion,
  validateNewService,
  type CalculatorInputType,
  type CalculatorQuestionConfig,
  type CalculatorServiceConfig,
  type CleaningPlanConfig,
  type NewQuestionInput,
  type NewQuestionLibraryItemInput,
  type NewServiceInput,
  type PricingRuleConfig,
  type QuestionOption,
  type QuestionPatch,
  type ServicePatch,
} from "@/lib/calculator/calculatorConfigAdmin";
import type { QuestionLibraryItem } from "@/lib/calculator/libraryItems";
import type { GenericPricingModel } from "@/lib/calculator/v2/pricingModel";
import {
  hasSqmPrimaryInput,
  isEngineBackedGenericPricingModel,
  SQM_FIXED_PRIMARY_INPUT_DEFAULT,
} from "@/lib/calculator/genericAdminReadiness";

/** True when the pure engine actually consumes this (service, question key). */
function isPricingKeySupported(pricingModel: string, questionKey: string): boolean {
  const keys = PRICING_SUPPORTED_QUESTION_KEYS[pricingModel];
  return Boolean(keys && keys.includes(questionKey));
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. No change was saved.";
}

/** A small readiness badge derived from the pure readiness model. */
function ServiceReadinessBadge({
  service,
  pricingRules,
  plans,
}: {
  service: CalculatorServiceConfig;
  pricingRules: readonly PricingRuleConfig[];
  plans: readonly CleaningPlanConfig[];
}) {
  const readiness = computeServiceReadiness(service, pricingRules, plans);
  return <Pill tone={readiness.tone}>{readiness.label}</Pill>;
}

// ── Shared option-list editor ───────────────────────────────────────────────

function OptionsEditor({
  options,
  onChange,
}: {
  options: QuestionOption[];
  onChange: (next: QuestionOption[]) => void;
}) {
  const update = (index: number, patch: Partial<QuestionOption>) =>
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const remove = (index: number) => onChange(options.filter((_, i) => i !== index));
  const add = () => onChange([...options, { value: "", label: "" }]);

  return (
    <div className="space-y-2">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`Option ${i + 1} value`}
            placeholder="value"
            value={opt.value}
            onChange={(e) => update(i, { value: e.target.value })}
            className="font-mono"
          />
          <Input
            aria-label={`Option ${i + 1} label`}
            placeholder="Label shown to customer"
            value={opt.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`Remove option ${i + 1}`}
            onClick={() => remove(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add option
      </Button>
    </div>
  );
}

/** Amber notice shown whenever a question is flagged as affecting pricing. */
function PricingAffectingNotice({ supported }: { supported: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        This field is marked as affecting pricing.{" "}
        {supported
          ? "The pricing engine understands this key and will use it."
          : "The pricing engine has no support for this key, so it will NOT change the calculated price until a developer adds pricing support. Confirm below to continue."}
      </p>
    </div>
  );
}

// ── Service edit dialog ──────────────────────────────────────────────────────

function ServiceEditDialog({
  service,
  pricingRules,
  plans,
  open,
  onOpenChange,
  onSave,
}: {
  service: CalculatorServiceConfig;
  pricingRules: readonly PricingRuleConfig[];
  plans: readonly CleaningPlanConfig[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (legacyId: string, patch: ServicePatch) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState<string>(service.displayName);
  const [description, setDescription] = useState<string>(service.description ?? "");
  const [sortOrder, setSortOrder] = useState<string>(String(service.sortOrder));
  const [enabled, setEnabled] = useState<boolean>(service.enabled);
  const [comingSoon, setComingSoon] = useState<boolean>(service.comingSoon);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // GPM-8: the "Enabled (selectable publicly)" guard is aligned with the GPM-6/GPM-7
  // engine-backed + readiness logic — NOT the legacy SUPPORTED_PRICING_MODELS list.
  //   • Reserved generic models (unit_based / fixed_package / manual_quote) and the
  //     unimplemented legacy templates are NOT engine-backed: enabling stays hard-locked
  //     until a developer adds + parity-tests pricing support ("engine does not implement").
  //   • A literal `sqm_fixed` service IS engine-backed (GPM-6-R), so it CAN be enabled —
  //     but only once it is structurally READY (active sqm input + an active plan with a
  //     positive price per m²). Until then the switch is locked with the ACTIONABLE
  //     readiness reason, never the stale "engine does not implement" message.
  //   • Legacy engine models (home / move-out / office) keep their unchanged behaviour.
  const engineBacked = isEngineBackedPricingModel(service.pricingModel);
  const isGenericModel = isEngineBackedGenericPricingModel(service.pricingModel);
  const readiness = useMemo(
    () => computeServiceReadiness(service, pricingRules, plans),
    [service, pricingRules, plans],
  );
  // sqm_fixed must be structurally ready before going public; legacy engine models keep
  // their unchanged "always enableable" behaviour.
  const canBeEnabled = engineBacked && (!isGenericModel || readiness.publicReady);
  // The lock only blocks turning the switch ON — an already-enabled service can be turned off.
  const enableLocked = !canBeEnabled && !enabled;
  // Which of the two lock reasons applies: an unimplemented model vs an engine-backed
  // `sqm_fixed` service that is simply not set up yet.
  const lockedForUnsupportedModel = enableLocked && !engineBacked;
  const lockedForIncompleteSetup = enableLocked && isGenericModel;

  useEffect(() => {
    if (open) {
      setDisplayName(service.displayName);
      setDescription(service.description ?? "");
      setSortOrder(String(service.sortOrder));
      setEnabled(service.enabled);
      setComingSoon(service.comingSoon);
      setError(null);
    }
  }, [open, service]);

  const handleSave = useCallback(async () => {
    setError(null);
    const trimmedName = displayName.trim();
    if (trimmedName === "") {
      setError("Display name is required.");
      return;
    }
    const sortValue = Number(sortOrder);
    if (!Number.isFinite(sortValue)) {
      setError("Sort order must be a number.");
      return;
    }
    setSubmitting(true);
    try {
      await onSave(service.legacyId, {
        displayName: trimmedName,
        description: description.trim() === "" ? null : description.trim(),
        sortOrder: sortValue,
        enabled: canBeEnabled ? enabled : false,
        comingSoon,
      });
      onOpenChange(false);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [displayName, sortOrder, description, canBeEnabled, enabled, comingSoon, onSave, service.legacyId, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit service</DialogTitle>
          <DialogDescription>
            Safe display fields only. The service key and pricing model are locked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LockedChip>{service.serviceKey}</LockedChip>
            <LockedChip>{service.pricingModel}</LockedChip>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="service-name">Display name</Label>
            <Input id="service-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="service-desc">Description</Label>
            <Textarea
              id="service-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="service-sort">Sort order</Label>
            <Input
              id="service-sort"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Enabled (selectable publicly)</p>
              <p className="text-xs text-muted-foreground">Off hides the service from the public calculator.</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={enableLocked}
              aria-label="Service enabled"
            />
          </div>

          {lockedForUnsupportedModel ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                This service uses a pricing model the engine does not implement yet, so it cannot be made public until
                a developer adds + parity-tests pricing support for it.
              </p>
            </div>
          ) : null}

          {lockedForIncompleteSetup ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="space-y-1">
                <p>Finish setting this service up before it can be made public:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {readiness.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Coming soon</p>
              <p className="text-xs text-muted-foreground">Marks the service as not yet selectable.</p>
            </div>
            <Switch checked={comingSoon} onCheckedChange={setComingSoon} aria-label="Service coming soon" />
          </div>

          {enabled && comingSoon ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>A service that is both enabled and &ldquo;coming soon&rdquo; sends a mixed signal — pick one.</p>
            </div>
          ) : null}

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

// ── Add-service dialog (new service template — key + model editable once) ─────

export function AddServiceDialog({
  companyId,
  companyLegacyId,
  existingKeys,
  nextSort,
  open,
  onOpenChange,
  onAdd,
}: {
  companyId: string;
  companyLegacyId: string;
  existingKeys: string[];
  nextSort: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: NewServiceInput) => Promise<void>;
}) {
  const [serviceKey, setServiceKey] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  // GPM-3b: brand-new services are GENERIC-ONLY. The dropdown offers just the five
  // generic pricing models and defaults to the first one; legacy, service-named
  // models stay valid on existing rows but can never be chosen for a new service.
  const [pricingModel, setPricingModel] = useState<GenericPricingModel>(DEFAULT_NEW_SERVICE_PRICING_MODEL);
  const [requiresCleaningPlan, setRequiresCleaningPlan] = useState<boolean>(
    defaultSettingsForGenericModel(DEFAULT_NEW_SERVICE_PRICING_MODEL).requiresCleaningPlan,
  );
  const [sortOrder, setSortOrder] = useState<string>(String(nextSort));
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const summary = GENERIC_PRICING_MODEL_SUMMARIES[pricingModel];

  // Switching pricing model re-seeds the cleaning-plan default from that model's
  // settings (GPM-3b). The admin can still flip the toggle afterwards — the chosen
  // value is what createCalculatorService persists.
  const handleModelChange = useCallback((value: string) => {
    const model = value as GenericPricingModel;
    setPricingModel(model);
    setRequiresCleaningPlan(defaultSettingsForGenericModel(model).requiresCleaningPlan);
  }, []);

  useEffect(() => {
    if (open) {
      setServiceKey("");
      setDisplayName("");
      setDescription("");
      setPricingModel(DEFAULT_NEW_SERVICE_PRICING_MODEL);
      setRequiresCleaningPlan(defaultSettingsForGenericModel(DEFAULT_NEW_SERVICE_PRICING_MODEL).requiresCleaningPlan);
      setSortOrder(String(nextSort));
      setErrors([]);
    }
  }, [open, nextSort]);

  const handleAdd = useCallback(async () => {
    const validationErrors = validateNewService(
      { serviceKey: serviceKey.trim(), displayName, pricingModel },
      existingKeys,
    );
    const sortValue = Number(sortOrder);
    if (!Number.isFinite(sortValue)) validationErrors.push("Sort order must be a number.");
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      await onAdd({
        companyId,
        companyLegacyId,
        serviceKey: serviceKey.trim(),
        displayName: displayName.trim(),
        description: description.trim() === "" ? null : description.trim(),
        pricingModel,
        requiresCleaningPlan,
        sortOrder: sortValue,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors([toErrorMessage(err)]);
    } finally {
      setSubmitting(false);
    }
  }, [
    serviceKey,
    displayName,
    pricingModel,
    existingKeys,
    sortOrder,
    onAdd,
    companyId,
    companyLegacyId,
    description,
    requiresCleaningPlan,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add service</DialogTitle>
          <DialogDescription>
            Build a new calculator service on a generic pricing model. The service key + pricing model are permanent
            once saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              <p>
                This creates a hidden <span className="font-medium text-foreground">draft</span> — it is{" "}
                <span className="font-medium text-foreground">not public</span> by default. Configure its plans, fields
                and add-ons before publishing.
              </p>
              <p>Some pricing models are not fully routable to the public calculator yet.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-svc-key">Service key</Label>
            <Input
              id="add-svc-key"
              value={serviceKey}
              onChange={(e) => setServiceKey(e.target.value)}
              placeholder="e.g. office_cleaning"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits and underscores. Must be unique within this company.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-svc-name">Display name</Label>
            <Input
              id="add-svc-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Kontorsstädning"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-svc-desc">Description</Label>
            <Textarea id="add-svc-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-svc-model">Pricing model</Label>
            <Select value={pricingModel} onValueChange={handleModelChange}>
              <SelectTrigger id="add-svc-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERIC_PRICING_MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
              <p className="mb-1.5 font-medium text-foreground">{summary.label}</p>
              <dl className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Primary input</dt>
                  <dd className="text-right font-medium">{summary.primaryInput}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Pricing</dt>
                  <dd className="text-right font-medium">{summary.pricing}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Typical use</dt>
                  <dd className="text-right font-medium">{summary.typicalUse}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Requires a cleaning plan</p>
              <p className="text-xs text-muted-foreground">Shows the plan selector + needs an active plan to price.</p>
            </div>
            <Switch
              checked={requiresCleaningPlan}
              onCheckedChange={setRequiresCleaningPlan}
              aria-label="Requires cleaning plan"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-svc-sort">Sort order</Label>
            <Input id="add-svc-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>

          {errors.length > 0 ? (
            <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={submitting}>
            Add service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Question edit dialog (existing question — key + input type locked) ───────

function QuestionEditDialog({
  service,
  question,
  open,
  onOpenChange,
  onSave,
}: {
  service: CalculatorServiceConfig;
  question: CalculatorQuestionConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (legacyId: string, patch: QuestionPatch) => Promise<void>;
}) {
  const [label, setLabel] = useState<string>(question.label);
  const [helpText, setHelpText] = useState<string>(question.helpText ?? "");
  const [required, setRequired] = useState<boolean>(question.required);
  const [affectsPricing, setAffectsPricing] = useState<boolean>(question.affectsPricing);
  const [sortOrder, setSortOrder] = useState<string>(String(question.sortOrder));
  const [active, setActive] = useState<boolean>(question.active);
  const [options, setOptions] = useState<QuestionOption[]>(question.options);
  const [ackPricing, setAckPricing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const needsOptions = OPTION_INPUT_TYPES.includes(question.inputType as CalculatorInputType);
  const pricingSupported = isPricingKeySupported(service.pricingModel, question.questionKey);
  const mustAck = affectsPricing && !pricingSupported && !question.affectsPricing;

  useEffect(() => {
    if (open) {
      setLabel(question.label);
      setHelpText(question.helpText ?? "");
      setRequired(question.required);
      setAffectsPricing(question.affectsPricing);
      setSortOrder(String(question.sortOrder));
      setActive(question.active);
      setOptions(question.options);
      setAckPricing(false);
      setError(null);
    }
  }, [open, question]);

  const handleSave = useCallback(async () => {
    setError(null);
    if (label.trim() === "") {
      setError("Label is required.");
      return;
    }
    const sortValue = Number(sortOrder);
    if (!Number.isFinite(sortValue)) {
      setError("Sort order must be a number.");
      return;
    }
    const cleanedOptions = options.filter((o) => o.value.trim() !== "");
    if (needsOptions && cleanedOptions.length === 0) {
      setError("Select / multiselect questions need at least one option.");
      return;
    }
    if (mustAck && !ackPricing) {
      setError("Confirm the pricing-support warning before saving.");
      return;
    }
    setSubmitting(true);
    try {
      await onSave(question.legacyId, {
        label: label.trim(),
        helpText: helpText.trim() === "" ? null : helpText.trim(),
        required,
        affectsPricing,
        sortOrder: sortValue,
        active,
        options: needsOptions
          ? cleanedOptions.map((o) => ({ value: o.value.trim(), label: o.label.trim() || o.value.trim() }))
          : options,
      });
      onOpenChange(false);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    label,
    sortOrder,
    options,
    needsOptions,
    mustAck,
    ackPricing,
    helpText,
    required,
    affectsPricing,
    active,
    onSave,
    question.legacyId,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit question</DialogTitle>
          <DialogDescription>
            The question key and input type are locked — they are referenced by submitted quotes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LockedChip>{question.questionKey}</LockedChip>
            <LockedChip>{question.inputType}</LockedChip>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-label">Label</Label>
            <Input id="q-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-help">Help text</Label>
            <Textarea id="q-help" rows={2} value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-sort">Sort order</Label>
            <Input id="q-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>

          {needsOptions ? (
            <div className="space-y-1.5">
              <Label>Options</Label>
              <OptionsEditor options={options} onChange={setOptions} />
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Required</p>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="Question required" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Affects pricing</p>
              <p className="text-xs text-muted-foreground">Whether the answer feeds the price engine.</p>
            </div>
            <Switch checked={affectsPricing} onCheckedChange={setAffectsPricing} aria-label="Affects pricing" />
          </div>

          {affectsPricing ? <PricingAffectingNotice supported={pricingSupported} /> : null}
          {mustAck ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ackPricing}
                onChange={(e) => setAckPricing(e.target.checked)}
                aria-label="Acknowledge unsupported pricing field"
              />
              <span>I understand this field needs developer/pricing support and will not change prices yet.</span>
            </label>
          ) : null}

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Turning this off archives the question (no hard delete).</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Question active" />
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

// ── Add-question dialog (new question — key + input type editable) ───────────

function AddQuestionDialog({
  service,
  companyId,
  companyLegacyId,
  open,
  onOpenChange,
  onAdd,
}: {
  service: CalculatorServiceConfig;
  companyId: string;
  companyLegacyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: NewQuestionInput) => Promise<void>;
}) {
  const nextSort = useMemo(
    () => service.questions.reduce((max, q) => Math.max(max, q.sortOrder), 0) + 1,
    [service.questions],
  );

  const [questionKey, setQuestionKey] = useState<string>("");
  const [label, setLabel] = useState<string>("");
  const [inputType, setInputType] = useState<CalculatorInputType>("number");
  const [required, setRequired] = useState<boolean>(false);
  const [affectsPricing, setAffectsPricing] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<string>(String(nextSort));
  const [options, setOptions] = useState<QuestionOption[]>([]);
  const [ackPricing, setAckPricing] = useState<boolean>(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const existingKeys = useMemo(() => service.questions.map((q) => q.questionKey), [service.questions]);
  const needsOptions = OPTION_INPUT_TYPES.includes(inputType);
  const pricingSupported = isPricingKeySupported(service.pricingModel, questionKey.trim());
  const mustAck = affectsPricing && !pricingSupported;

  useEffect(() => {
    if (open) {
      setQuestionKey("");
      setLabel("");
      setInputType("number");
      setRequired(false);
      setAffectsPricing(false);
      setSortOrder(String(nextSort));
      setOptions([]);
      setAckPricing(false);
      setErrors([]);
    }
  }, [open, nextSort]);

  const handleAdd = useCallback(async () => {
    const cleanedOptions = options
      .filter((o) => o.value.trim() !== "")
      .map((o) => ({ value: o.value.trim(), label: o.label.trim() || o.value.trim() }));
    const validationErrors = validateNewQuestion(
      { questionKey: questionKey.trim(), label, inputType, options: cleanedOptions },
      existingKeys,
    );
    const sortValue = Number(sortOrder);
    if (!Number.isFinite(sortValue)) validationErrors.push("Sort order must be a number.");
    if (mustAck && !ackPricing) validationErrors.push("Confirm the pricing-support warning before adding.");
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      await onAdd({
        companyId,
        companyLegacyId,
        serviceId: service.id,
        serviceLegacyId: service.legacyId,
        questionKey: questionKey.trim(),
        label: label.trim(),
        helpText: null,
        inputType,
        required,
        affectsPricing,
        sortOrder: sortValue,
        options: needsOptions ? cleanedOptions : [],
      });
      onOpenChange(false);
    } catch (err) {
      setErrors([toErrorMessage(err)]);
    } finally {
      setSubmitting(false);
    }
  }, [
    options,
    questionKey,
    label,
    inputType,
    existingKeys,
    sortOrder,
    mustAck,
    ackPricing,
    onAdd,
    companyId,
    companyLegacyId,
    service.id,
    service.legacyId,
    required,
    affectsPricing,
    needsOptions,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add question</DialogTitle>
          <DialogDescription>
            New questions for <span className="font-medium">{service.displayName}</span>. The key is permanent once saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="aq-key">Question key</Label>
            <Input
              id="aq-key"
              value={questionKey}
              onChange={(e) => setQuestionKey(e.target.value)}
              placeholder="e.g. has_pets"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits and underscores. Must be unique within this service.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aq-label">Label</Label>
            <Input id="aq-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aq-type">Input type</Label>
            <Select value={inputType} onValueChange={(v) => setInputType(v as CalculatorInputType)}>
              <SelectTrigger id="aq-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_INPUT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsOptions ? (
            <div className="space-y-1.5">
              <Label>Options</Label>
              <OptionsEditor options={options} onChange={setOptions} />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="aq-sort">Sort order</Label>
            <Input id="aq-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Required</p>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="New question required" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <p className="text-sm font-medium">Affects pricing</p>
            <Switch checked={affectsPricing} onCheckedChange={setAffectsPricing} aria-label="New question affects pricing" />
          </div>

          {affectsPricing ? <PricingAffectingNotice supported={pricingSupported} /> : null}
          {mustAck ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ackPricing}
                onChange={(e) => setAckPricing(e.target.checked)}
                aria-label="Acknowledge unsupported pricing field"
              />
              <span>I understand this field needs developer/pricing support and will not change prices yet.</span>
            </label>
          ) : null}

          {errors.length > 0 ? (
            <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={submitting}>
            Add question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Question row ─────────────────────────────────────────────────────────────

function QuestionRow({
  service,
  question,
  onEdit,
}: {
  service: CalculatorServiceConfig;
  question: CalculatorQuestionConfig;
  onEdit: () => void;
}) {
  const pricingSupported = isPricingKeySupported(service.pricingModel, question.questionKey);
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3",
        !question.active && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight">{question.label}</span>
        {question.required ? <Pill tone="blue">Required</Pill> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LockedChip>{question.questionKey}</LockedChip>
        <LockedChip>{question.inputType}</LockedChip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {question.active ? <Pill tone="green">Active</Pill> : <Pill tone="muted">Archived</Pill>}
        {question.affectsPricing ? (
          pricingSupported ? (
            <Pill tone="blue">Affects price</Pill>
          ) : (
            <Pill tone="amber">Requires pricing support</Pill>
          )
        ) : (
          <Pill tone="muted">Non-pricing</Pill>
        )}
      </div>
      <div className="mt-auto flex justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>
    </div>
  );
}

// ── sqm_fixed primary-input setup (GPM-7) ────────────────────────────────────

/**
 * Guided one-click setup for the area (m²) primary input a literal `sqm_fixed`
 * service prices from (GPM-7). Rendered only when the service is missing its required
 * active `sqm` input. It reuses the normal add-question write path with the canonical
 * default ({@link SQM_FIXED_PRIMARY_INPUT_DEFAULT}) — so it never enables or publishes
 * the service. If a `sqm` input exists but is ARCHIVED, it points the admin at
 * reactivation instead of creating a duplicate key (which the DB would reject).
 */
function SqmPrimaryInputSetup({
  service,
  companyId,
  companyLegacyId,
  onAdd,
}: {
  service: CalculatorServiceConfig;
  companyId: string;
  companyLegacyId: string;
  onAdd: (input: NewQuestionInput) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const archivedPrimaryInput = useMemo(
    () =>
      service.questions.some(
        (q) => q.questionKey === SQM_FIXED_PRIMARY_INPUT_DEFAULT.questionKey && !q.active,
      ),
    [service.questions],
  );
  const nextSort = useMemo(
    () => service.questions.reduce((max, q) => Math.max(max, q.sortOrder), 0) + 1,
    [service.questions],
  );

  const handleAdd = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onAdd({
        companyId,
        companyLegacyId,
        serviceId: service.id,
        serviceLegacyId: service.legacyId,
        questionKey: SQM_FIXED_PRIMARY_INPUT_DEFAULT.questionKey,
        label: SQM_FIXED_PRIMARY_INPUT_DEFAULT.label,
        helpText: null,
        inputType: SQM_FIXED_PRIMARY_INPUT_DEFAULT.inputType,
        required: SQM_FIXED_PRIMARY_INPUT_DEFAULT.required,
        affectsPricing: SQM_FIXED_PRIMARY_INPUT_DEFAULT.affectsPricing,
        sortOrder: nextSort,
        options: [],
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [onAdd, companyId, companyLegacyId, service.id, service.legacyId, nextSort]);

  return (
    <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4">
      <div className="flex items-start gap-2">
        <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Set up the area (m²) input</p>
          <p className="text-xs text-muted-foreground">
            This service prices by m², so customers must enter their area.{" "}
            {archivedPrimaryInput
              ? "An archived area input already exists — reactivate it from the question below instead of adding a duplicate."
              : "Add the required area input — the price is calculated from it."}
          </p>
        </div>
      </div>
      {archivedPrimaryInput ? null : (
        <div className="mt-3">
          <Button size="sm" onClick={handleAdd} disabled={submitting} aria-label="Add area (m²) input">
            <Plus className="h-3.5 w-3.5" /> Add area (m²) input
          </Button>
        </div>
      )}
      {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

// ── Questions panel (active-first list + archived reveal) ────────────────────

/**
 * The selected service's questions, scoped to a single service. Active questions
 * show by default; archived (inactive) ones stay hidden behind a compact toggle
 * so the default view is uncluttered (GPM-UX-ADMIN-3). Cards sit in a dense
 * responsive grid (up to four per row on wide screens).
 */
function QuestionsPanel({
  service,
  onRequestAdd,
  onEditQuestion,
}: {
  service: CalculatorServiceConfig;
  onRequestAdd: () => void;
  onEditQuestion: (question: CalculatorQuestionConfig) => void;
}) {
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const activeQuestions = useMemo(() => service.questions.filter((q) => q.active), [service.questions]);
  const archivedQuestions = useMemo(() => service.questions.filter((q) => !q.active), [service.questions]);
  const visibleQuestions = showArchived ? service.questions : activeQuestions;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" /> Questions ({activeQuestions.length})
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InactiveItemsToggle
            hiddenCount={archivedQuestions.length}
            open={showArchived}
            onToggle={() => setShowArchived((v) => !v)}
            showLabel="Show archived"
            hideLabel="Hide archived"
            testId="questions-archived-toggle"
          />
          <Button size="sm" onClick={onRequestAdd}>
            <Plus className="h-3.5 w-3.5" /> Add question
          </Button>
        </div>
      </div>
      {visibleQuestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {service.questions.length === 0
            ? "This service has no questions yet."
            : "No active questions. Use “Show archived” to reveal archived ones."}
        </div>
      ) : (
        <div className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleQuestions.map((q) => (
            <QuestionRow key={q.legacyId} service={service} question={q} onEdit={() => onEditQuestion(q)} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Questions are never hard-deleted — turning a question inactive archives it while keeping submitted
          quote history intact. Reactivate any time with <RotateCcw className="inline h-3 w-3" />.
        </p>
      </div>
    </div>
  );
}

// ── Question library panel (GPM-CALC-LIBRARY-3) ─────────────────────────

/**
 * Reusable question library for the selected service. Collapsed by default. When
 * expanded it offers two actions, both reusing existing scoped write paths:
 *   • Activate a library question onto this service — creates a calculator_questions
 *     row that COPIES the library defaults and links back via library_item_id (the
 *     admin can override every field afterwards via the normal edit dialog).
 *   • Save one of this service's questions INTO the library so it can be reused on
 *     other services.
 * Library items whose question_key already exists on the service are filtered out
 * of the activate list (the DB rejects a duplicate (service, key)); questions whose
 * key already exists in the library are filtered out of the save list. Purely
 * additive UI — it never changes public runtime, readiness, or existing questions.
 */
function QuestionLibraryPanel({
  service,
  companyId,
  companyLegacyId,
  libraryItems,
  onActivate,
  onSaveToLibrary,
}: {
  service: CalculatorServiceConfig;
  companyId: string;
  companyLegacyId: string;
  libraryItems: QuestionLibraryItem[];
  onActivate: (input: NewQuestionInput) => Promise<void>;
  onSaveToLibrary?: (input: NewQuestionLibraryItemInput) => Promise<void>;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serviceQuestionKeys = useMemo(
    () => new Set(service.questions.map((q) => q.questionKey)),
    [service.questions],
  );
  const libraryKeys = useMemo(() => new Set(libraryItems.map((i) => i.questionKey)), [libraryItems]);

  // Library questions activatable onto this service (active + key not already present).
  const available = useMemo(
    () => libraryItems.filter((i) => i.active && !serviceQuestionKeys.has(i.questionKey)),
    [libraryItems, serviceQuestionKeys],
  );
  // This service's active questions not yet in the library (promotable).
  const promotable = useMemo(
    () => service.questions.filter((q) => q.active && !libraryKeys.has(q.questionKey)),
    [service.questions, libraryKeys],
  );
  const nextSort = useMemo(
    () => service.questions.reduce((max, q) => Math.max(max, q.sortOrder), 0) + 1,
    [service.questions],
  );

  const handleActivate = useCallback(
    async (item: QuestionLibraryItem) => {
      setError(null);
      setBusyKey(`activate:${item.id}`);
      try {
        await onActivate(
          buildQuestionLibraryActivationInput(
            item,
            { companyId, companyLegacyId, serviceId: service.id, serviceLegacyId: service.legacyId },
            nextSort,
          ),
        );
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setBusyKey(null);
      }
    },
    [onActivate, companyId, companyLegacyId, service.id, service.legacyId, nextSort],
  );

  const handleSaveToLibrary = useCallback(
    async (question: CalculatorQuestionConfig) => {
      if (!onSaveToLibrary) return;
      setError(null);
      setBusyKey(`save:${question.legacyId}`);
      try {
        await onSaveToLibrary({
          companyId,
          companyLegacyId,
          questionKey: question.questionKey,
          label: question.label,
          helpText: question.helpText,
          inputType: question.inputType as CalculatorInputType,
          defaultRequired: question.required,
          defaultAffectsPricing: question.affectsPricing,
          defaultOptions: question.options,
          defaultSortOrder: question.sortOrder,
        });
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setBusyKey(null);
      }
    },
    [onSaveToLibrary, companyId, companyLegacyId],
  );

  return (
    <div className="mt-3 rounded-2xl border border-border bg-muted/20 p-3" data-testid="question-library-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
        data-testid="question-library-toggle"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Library className="h-3.5 w-3.5" /> Question library
        </span>
        <span className="flex items-center gap-1.5">
          <Pill tone={available.length > 0 ? "blue" : "muted"}>{available.length} available</Pill>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted-foreground">
            Reusable questions are shared across this company. Activating one copies its defaults onto this service
            — you can override the label, help text, required and pricing flags afterwards.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Add a library question to this service</p>
            {available.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {libraryItems.length === 0
                  ? "No reusable questions yet. Save one of this service’s questions below to start a library."
                  : "Every library question is already active on this service."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((item) => (
                  <div
                    key={item.id}
                    className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3"
                    data-testid={`question-library-item-${item.questionKey}`}
                  >
                    <span className="text-sm font-medium leading-tight">{item.label}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LockedChip>{item.questionKey}</LockedChip>
                      <LockedChip>{item.inputType}</LockedChip>
                    </div>
                    <div className="mt-auto flex justify-end pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleActivate(item)}
                        disabled={busyKey !== null}
                        aria-label={`Activate ${item.label}`}
                      >
                        <Plus className="h-3.5 w-3.5" /> Activate
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {onSaveToLibrary ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Save this service’s questions to the library</p>
              {promotable.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Every active question here is already in the library.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {promotable.map((q) => (
                    <Button
                      key={q.legacyId}
                      variant="ghost"
                      size="sm"
                      className="border border-border"
                      onClick={() => void handleSaveToLibrary(q)}
                      disabled={busyKey !== null}
                      aria-label={`Save ${q.label} to library`}
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" /> {q.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Service list row ─────────────────────────────────────────────────────────

/** A single selectable service row, shared by the pilot + legacy list groups. */
function ServiceRowButton({
  service,
  isActive,
  onSelect,
  showReadiness,
  readinessRules,
  readinessPlans,
}: {
  service: CalculatorServiceConfig;
  isActive: boolean;
  onSelect: () => void;
  showReadiness: boolean;
  readinessRules: readonly PricingRuleConfig[];
  readinessPlans: readonly CleaningPlanConfig[];
}) {
  const badges = serviceStatusBadges(service);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition-colors",
        isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <span className="block truncate text-sm font-medium">{service.displayName}</span>
      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{service.serviceKey}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {badges.map((badge) => (
          <Pill key={badge.key} tone={badge.tone}>
            {badge.label}
          </Pill>
        ))}
        {showReadiness ? (
          <ServiceReadinessBadge service={service} pricingRules={readinessRules} plans={readinessPlans} />
        ) : null}
      </div>
    </button>
  );
}

// ── Main editor ──────────────────────────────────────────────────────────────

export interface ServicesFieldsEditorProps {
  services: CalculatorServiceConfig[];
  companyId: string;
  companyLegacyId: string;
  onSaveService: (legacyId: string, patch: ServicePatch) => Promise<void>;
  onSaveQuestion: (legacyId: string, patch: QuestionPatch) => Promise<void>;
  onAddQuestion: (input: NewQuestionInput) => Promise<void>;
  /** Optional — when provided, each service shows a public-readiness badge. */
  pricingRules?: PricingRuleConfig[];
  plans?: CleaningPlanConfig[];
  /** Optional — when provided, the "Add service" flow is enabled. */
  onAddService?: (input: NewServiceInput) => Promise<void>;
  /** Optional — when provided, the selected service exposes an Archive action. */
  onArchiveService?: (legacyId: string) => Promise<void>;
  /**
   * GPM-UX-ADMIN-3 — embedded (service-first) mode. When true the internal service
   * list + add-service flow are hidden (the page-level service nav owns selection
   * and the "+ Add service" card), and only the single passed service's detail is
   * rendered. Default (false) keeps the original two-pane editor unchanged.
   */
  embedded?: boolean;
  /**
   * GPM-CALC-LIBRARY-3 — reusable question library items for the company. When
   * provided, the selected service shows a collapsible “Question library” panel to
   * activate library questions onto the service and save its questions to the
   * library. Optional — omitting it (the default) hides the panel entirely, so
   * existing usages/tests are unaffected.
   */
  questionLibraryItems?: QuestionLibraryItem[];
  /** Save a service question into the reusable library (createQuestionLibraryItem). */
  onSaveQuestionToLibrary?: (input: NewQuestionLibraryItemInput) => Promise<void>;
}

/**
 * Services & Fields editor — the primary Slice 10A surface, extended in Slice 12C
 * with service create/archive + a public-readiness badge. Left: the service list;
 * right: the selected service's questions. All writes are safe + scoped: service/
 * question keys, input types and pricing models are locked; "removing" a question
 * is `active = false`; archiving a service is a soft-delete; pricing-affecting
 * changes require an explicit acknowledgement when the engine has no support for
 * the key. A service whose pricing model the engine cannot run can never be made
 * public (the Enabled switch is locked + readiness shows "Unsupported pricing").
 */
export function ServicesFieldsEditor({
  services,
  companyId,
  companyLegacyId,
  onSaveService,
  onSaveQuestion,
  onAddQuestion,
  pricingRules,
  plans,
  onAddService,
  onArchiveService,
  embedded = false,
  questionLibraryItems,
  onSaveQuestionToLibrary,
}: ServicesFieldsEditorProps) {
  const [serviceDialogOpen, setServiceDialogOpen] = useState<boolean>(false);
  const [editingQuestion, setEditingQuestion] = useState<CalculatorQuestionConfig | null>(null);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [addServiceOpen, setAddServiceOpen] = useState<boolean>(false);
  const [archiving, setArchiving] = useState<CalculatorServiceConfig | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState<boolean>(false);
  const [showLegacy, setShowLegacy] = useState<boolean>(false);

  // GPM-2a — the Services list is the generic service builder. The default view
  // shows the V2 pilot (Home) + any admin-built generic services; the seeded
  // legacy services collapse behind a toggle. Presentation only: this never writes
  // to the DB or changes any service's public visibility.
  const pilotServices = useMemo(
    () => services.filter((s) => classifyServiceGroup(s) === "pilot"),
    [services],
  );
  const legacyServices = useMemo(
    () => services.filter((s) => classifyServiceGroup(s) === "legacy"),
    [services],
  );
  const hasPilot = pilotServices.length > 0;
  // With no pilot service at all, legacy services show by default so the list is
  // never empty; otherwise they stay hidden until the toggle is opened.
  const legacyVisible = showLegacy || !hasPilot;

  const [selectedId, setSelectedId] = useState<string>(
    () => (pilotServices[0] ?? services[0])?.id ?? "",
  );

  const selected = useMemo(
    () => services.find((s) => s.id === selectedId) ?? pilotServices[0] ?? services[0] ?? null,
    [services, selectedId, pilotServices],
  );

  const toggleLegacy = useCallback(() => {
    const next = !showLegacy;
    // Collapsing while a legacy service is selected would hide the active row, so
    // fall the selection back to the pilot group.
    if (!next && selected !== null && classifyServiceGroup(selected) === "legacy") {
      setSelectedId(pilotServices[0]?.id ?? "");
    }
    setShowLegacy(next);
  }, [showLegacy, selected, pilotServices]);

  const showReadiness = pricingRules !== undefined;
  const readinessRules = pricingRules ?? [];
  const readinessPlans = plans ?? [];
  const existingServiceKeys = useMemo(() => services.map((s) => s.serviceKey), [services]);
  const nextServiceSort = useMemo(
    () => services.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1,
    [services],
  );

  const handleArchiveService = useCallback(async () => {
    if (!archiving || !onArchiveService) return;
    setArchiveError(null);
    setArchiveSubmitting(true);
    try {
      await onArchiveService(archiving.legacyId);
      if (archiving.id === selectedId) setSelectedId("");
      setArchiving(null);
    } catch (err) {
      setArchiveError(toErrorMessage(err));
    } finally {
      setArchiveSubmitting(false);
    }
  }, [archiving, onArchiveService, selectedId]);

  if (services.length === 0) {
    return (
      <div className="space-y-4">
        {onAddService ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddServiceOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add service
            </Button>
          </div>
        ) : null}
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No services configured for this calculator yet.
        </div>
        {onAddService ? (
          <AddServiceDialog
            companyId={companyId}
            companyLegacyId={companyLegacyId}
            existingKeys={existingServiceKeys}
            nextSort={nextServiceSort}
            open={addServiceOpen}
            onOpenChange={setAddServiceOpen}
            onAdd={onAddService}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-4" : "grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]"}>
      {/* Service list */}
      {!embedded ? (
      <div className="space-y-2" aria-label="Services">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Services
          </div>
          {onAddService ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddServiceOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          ) : null}
        </div>
        {/* Generic service builder — the V2 pilot + any admin-built generic services. */}
        {pilotServices.map((service) => (
          <ServiceRowButton
            key={service.id}
            service={service}
            isActive={service.id === (selected?.id ?? "")}
            onSelect={() => setSelectedId(service.id)}
            showReadiness={showReadiness}
            readinessRules={readinessRules}
            readinessPlans={readinessPlans}
          />
        ))}

        {/* Legacy / default seeded services — collapsed behind a toggle while a pilot exists. */}
        {hasPilot && legacyServices.length > 0 ? (
          <button
            type="button"
            onClick={toggleLegacy}
            aria-expanded={legacyVisible}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-1.5">
              {legacyVisible ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {legacyVisible ? "Hide" : "Show"} legacy / default services
            </span>
            <Pill tone="muted">{legacyServices.length}</Pill>
          </button>
        ) : null}

        {legacyVisible
          ? legacyServices.map((service) => (
              <ServiceRowButton
                key={service.id}
                service={service}
                isActive={service.id === (selected?.id ?? "")}
                onSelect={() => setSelectedId(service.id)}
                showReadiness={showReadiness}
                readinessRules={readinessRules}
                readinessPlans={readinessPlans}
              />
            ))
          : null}
      </div>
      ) : null}

      {/* Selected service detail */}
      {selected ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">{selected.displayName}</h3>
                  {showReadiness ? (
                    <ServiceReadinessBadge service={selected} pricingRules={readinessRules} plans={readinessPlans} />
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {selected.description ?? "No description set."}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <LockedChip>{selected.serviceKey}</LockedChip>
                  <LockedChip>{selected.pricingModel}</LockedChip>
                  {selected.requiresCleaningPlan ? <Pill tone="blue">Requires plan</Pill> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setServiceDialogOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit service
                </Button>
                {onArchiveService ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => {
                      setArchiveError(null);
                      setArchiving(selected);
                    }}
                  >
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </Button>
                ) : null}
              </div>
            </div>
            {showReadiness
              ? (() => {
                  const readiness = computeServiceReadiness(selected, readinessRules, readinessPlans);
                  if (readiness.reasons.length === 0) return null;
                  return (
                    <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                      {readiness.reasons.map((reason) => (
                        <li key={reason} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              : null}
          </div>

          {isEngineBackedGenericPricingModel(selected.pricingModel) && !hasSqmPrimaryInput(selected.questions) ? (
            <SqmPrimaryInputSetup
              service={selected}
              companyId={companyId}
              companyLegacyId={companyLegacyId}
              onAdd={onAddQuestion}
            />
          ) : null}

          <QuestionsPanel
            service={selected}
            onRequestAdd={() => setAddOpen(true)}
            onEditQuestion={setEditingQuestion}
          />

          {questionLibraryItems !== undefined ? (
            <QuestionLibraryPanel
              service={selected}
              companyId={companyId}
              companyLegacyId={companyLegacyId}
              libraryItems={questionLibraryItems}
              onActivate={onAddQuestion}
              onSaveToLibrary={onSaveQuestionToLibrary}
            />
          ) : null}

          <ServiceEditDialog
            service={selected}
            pricingRules={readinessRules}
            plans={readinessPlans}
            open={serviceDialogOpen}
            onOpenChange={setServiceDialogOpen}
            onSave={onSaveService}
          />
          {editingQuestion ? (
            <QuestionEditDialog
              service={selected}
              question={editingQuestion}
              open={editingQuestion !== null}
              onOpenChange={(open) => {
                if (!open) setEditingQuestion(null);
              }}
              onSave={onSaveQuestion}
            />
          ) : null}
          <AddQuestionDialog
            service={selected}
            companyId={companyId}
            companyLegacyId={companyLegacyId}
            open={addOpen}
            onOpenChange={setAddOpen}
            onAdd={onAddQuestion}
          />
        </div>
      ) : null}

      {!embedded && onAddService ? (
        <AddServiceDialog
          companyId={companyId}
          companyLegacyId={companyLegacyId}
          existingKeys={existingServiceKeys}
          nextSort={nextServiceSort}
          open={addServiceOpen}
          onOpenChange={setAddServiceOpen}
          onAdd={onAddService}
        />
      ) : null}

      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{archiving?.displayName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The service is removed from the editor and the public calculator. Submitted quotes keep their frozen
              service snapshot. This is a soft archive — no data is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiving?.enabled ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This service is currently enabled — archiving it will remove it from the public calculator immediately.
            </p>
          ) : null}
          {archiveError ? <p className="text-sm text-red-600 dark:text-red-400">{archiveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleArchiveService();
              }}
              disabled={archiveSubmitting}
            >
              Archive service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ServicesFieldsEditor;
