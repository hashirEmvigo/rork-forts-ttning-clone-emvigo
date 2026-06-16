import { useCallback, useMemo, useState } from "react";
import {
  Archive,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Eye,
  EyeOff,
  Hash,
  Info,
  Library,
  Percent,
  Plus,
  Puzzle,
  Save,
  Sparkles,
  ToggleLeft,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { LockedChip, Pill } from "@/components/calculator/configBadges";
import { InactiveItemsToggle } from "@/components/calculator/serviceWorkbench";
import { formatMinutesWithHours } from "@/lib/calculator/timeUnits";
import { resolveAddonEffects, type CalculatorAddonConfigV2 } from "@/lib/calculator/v2";
import {
  addonHasNoEffect,
  buildAddonLibraryActivationInput,
  validateNewAddon,
  type CalculatorAddonConfig,
  type CalculatorAddonInputType,
  type CalculatorAddonPatch,
  type CalculatorServiceConfig,
  type NewAddonDraft,
  type NewAddonInput,
  type NewAddonLibraryItemInput,
} from "@/lib/calculator/calculatorConfigAdmin";
import type { AddonLibraryItem } from "@/lib/calculator/libraryItems";

/**
 * Super Admin — generic calculator Add-ons editor (Slice V2-E0E-2).
 *
 * The service-wide UI for the generic add-on engine (`calculator_addons`,
 * migration 0074). Admins manually author add-ons here — dog, bathrooms, oven,
 * spröjs, delbara rutor, … — across EVERY service; nothing is seeded or migrated
 * from the legacy hardcoded special rules. Effects are three explicit, typed
 * channels (time / fixed / percent), never a vague "affects pricing" flag.
 *
 * IMPORTANT: this surface is NOT wired into the public calculator yet (no public
 * rendering, no Edge Function, no Home V2 runtime). A persistent banner makes that
 * clear. The live preview uses the pure V2 resolver ({@link resolveAddonEffects})
 * only — it never touches the DB or the public runtime.
 */

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. No change was saved.";
}

/** Parses a loosely-typed numeric input (tolerates spaces + a comma decimal). NaN when invalid/blank. */
function parseNum(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return NaN;
  return Number(cleaned);
}

/** A finite number or 0 — used so a mid-edit field never renders NaN in the preview. */
function safeNum(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function serviceAddonTitle(service: CalculatorServiceConfig): string {
  return `Add-ons — ${service.displayName}`;
}

const INPUT_TYPE_LABEL: Record<CalculatorAddonInputType, string> = {
  boolean: "Yes / No",
  quantity: "Quantity",
};

// ── Live preview (pure V2 resolver; never touches the DB or public runtime) ──

function AddonPreviewPanel({
  inputType,
  draftConfig,
}: {
  inputType: CalculatorAddonInputType;
  /** The add-on definition built from the CURRENT (unsaved) form values. */
  draftConfig: CalculatorAddonConfigV2;
}) {
  const [exampleQuantity, setExampleQuantity] = useState<string>(() => {
    const base =
      draftConfig.quantityDefault > 0
        ? draftConfig.quantityDefault
        : draftConfig.quantityStep > 0
          ? draftConfig.quantityStep
          : 1;
    return String(base);
  });

  const answer = inputType === "boolean" ? true : safeNum(parseNum(exampleQuantity));
  const resolved = useMemo(
    () => resolveAddonEffects([draftConfig], { [draftConfig.addonKey || "preview"]: answer }),
    [draftConfig, answer],
  );

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <p className="text-sm font-semibold">Customer preview</p>
      </div>

      <div className="mt-3 space-y-2 text-xs">
        {inputType === "boolean" ? (
          <p className="text-muted-foreground">
            Customer answer: <span className="font-semibold text-foreground">Yes</span>
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Label htmlFor={`${draftConfig.addonKey}-preview-qty`} className="text-muted-foreground">
              Example quantity
            </Label>
            <Input
              id={`${draftConfig.addonKey}-preview-qty`}
              type="number"
              inputMode="numeric"
              className="h-8 w-24"
              value={exampleQuantity}
              onChange={(e) => setExampleQuantity(e.target.value)}
            />
          </div>
        )}

        <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <div className="flex justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <dt className="text-muted-foreground">Time</dt>
            <dd className="font-semibold tabular-nums">
              {resolved.addonMinutes !== 0 ? formatMinutesWithHours(resolved.addonMinutes) : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <dt className="text-muted-foreground">Fixed</dt>
            <dd className="font-semibold tabular-nums">
              {resolved.addonFixedExclVat !== 0 ? `${resolved.addonFixedExclVat} SEK` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <dt className="text-muted-foreground">Percent</dt>
            <dd className="font-semibold tabular-nums">
              {resolved.addonPercent !== 0 ? `${resolved.addonPercent > 0 ? "+" : ""}${resolved.addonPercent}%` : "—"}
            </dd>
          </div>
        </dl>
        <p className="text-[11px] text-muted-foreground">Excl. VAT. Fixed amounts can be negative (a discount).</p>
      </div>
    </div>
  );
}

// ── One explicit effect channel (toggle + value; never a vague "affects price") ──

function EffectChannel({
  icon: Icon,
  title,
  toggleLabel,
  enabled,
  onToggle,
  inputId,
  value,
  onChange,
  unit,
  step,
  helpText,
}: {
  icon: typeof Clock;
  title: string;
  toggleLabel: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  inputId: string;
  value: string;
  onChange: (next: string) => void;
  unit: string;
  step: string;
  helpText: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Toggle ${title}`} />
      </div>
      {enabled ? (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor={inputId}>{toggleLabel}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              type="number"
              inputMode="decimal"
              step={step}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">{unit}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{helpText}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shared header for the three effect channels — clarifies that this block is
 * where an add-on's price/time impact is configured (GPM-UX-ADMIN-5). Pure copy.
 */
function PriceEffectHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Price effect</p>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Choose how this add-on changes the calculated price or time.
      </p>
    </div>
  );
}

/**
 * The three explicit effect channels (time / fixed / percent). GPM-UX-ADMIN-6 —
 * rendered side by side on wide screens (responsive 3-up grid, wrapping on
 * narrow screens) instead of a tall vertical stack. Shared by the edit card and
 * the create form so both stay identical; behaviour of each channel is unchanged.
 */
function PriceEffectChannels({
  idPrefix,
  affectsTime,
  setAffectsTime,
  effectTimeMinutes,
  setEffectTimeMinutes,
  affectsFixed,
  setAffectsFixed,
  effectFixedExclVat,
  setEffectFixedExclVat,
  affectsPercent,
  setAffectsPercent,
  effectPercent,
  setEffectPercent,
}: {
  /** Namespaces the channel input ids (e.g. the add-on legacy id or the new-form key). */
  idPrefix: string;
  affectsTime: boolean;
  setAffectsTime: (next: boolean) => void;
  effectTimeMinutes: string;
  setEffectTimeMinutes: (next: string) => void;
  affectsFixed: boolean;
  setAffectsFixed: (next: boolean) => void;
  effectFixedExclVat: string;
  setEffectFixedExclVat: (next: string) => void;
  affectsPercent: boolean;
  setAffectsPercent: (next: boolean) => void;
  effectPercent: string;
  setEffectPercent: (next: string) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start"
      data-testid="price-effect-channels"
    >
      <EffectChannel
        icon={Clock}
        title="Affects time"
        toggleLabel="Minutes per unit"
        enabled={affectsTime}
        onToggle={setAffectsTime}
        inputId={`${idPrefix}-eff-time`}
        value={effectTimeMinutes}
        onChange={setEffectTimeMinutes}
        unit="min/unit"
        step="1"
        helpText="For hourly services, this affects estimated service time and price."
      />
      <EffectChannel
        icon={Coins}
        title="Affects fixed price"
        toggleLabel="SEK per unit excl. VAT"
        enabled={affectsFixed}
        onToggle={setAffectsFixed}
        inputId={`${idPrefix}-eff-fixed`}
        value={effectFixedExclVat}
        onChange={setEffectFixedExclVat}
        unit="SEK/unit"
        step="1"
        helpText="SEK per unit excl. VAT. Can be positive or negative."
      />
      <EffectChannel
        icon={Percent}
        title="Affects price by percent"
        toggleLabel="Percent modifier"
        enabled={affectsPercent}
        onToggle={setAffectsPercent}
        inputId={`${idPrefix}-eff-percent`}
        value={effectPercent}
        onChange={setEffectPercent}
        unit="%"
        step="1"
        helpText="Percent modifiers are added together and applied once. Use carefully."
      />
    </div>
  );
}

// ── Add-on card (edit existing) ──────────────────────────────────────────────

function AddonCard({
  addon,
  siblingKeys,
  onSaveAddon,
  onArchiveAddon,
}: {
  addon: CalculatorAddonConfig;
  /** Live add-on keys of OTHER add-ons in the same service (for the duplicate guard). */
  siblingKeys: readonly string[];
  onSaveAddon: (legacyId: string, patch: CalculatorAddonPatch) => Promise<void>;
  onArchiveAddon: (legacyId: string) => Promise<void>;
}) {
  const [name, setName] = useState<string>(addon.name);
  const [publicLabel, setPublicLabel] = useState<string>(addon.publicLabel);
  const [description, setDescription] = useState<string>(addon.description ?? "");
  const [inputType, setInputType] = useState<CalculatorAddonInputType>(addon.inputType);
  const [booleanDefault, setBooleanDefault] = useState<boolean>(addon.booleanDefault);
  const [quantityMin, setQuantityMin] = useState<string>(String(addon.quantityMin));
  const [quantityMax, setQuantityMax] = useState<string>(addon.quantityMax === null ? "" : String(addon.quantityMax));
  const [quantityStep, setQuantityStep] = useState<string>(String(addon.quantityStep));
  const [quantityDefault, setQuantityDefault] = useState<string>(String(addon.quantityDefault));
  const [affectsTime, setAffectsTime] = useState<boolean>(addon.effectTimeMinutes !== 0);
  const [effectTimeMinutes, setEffectTimeMinutes] = useState<string>(String(addon.effectTimeMinutes));
  const [affectsFixed, setAffectsFixed] = useState<boolean>(addon.effectFixedExclVat !== 0);
  const [effectFixedExclVat, setEffectFixedExclVat] = useState<string>(String(addon.effectFixedExclVat));
  const [affectsPercent, setAffectsPercent] = useState<boolean>(addon.effectPercent !== 0);
  const [effectPercent, setEffectPercent] = useState<string>(String(addon.effectPercent));
  const [active, setActive] = useState<boolean>(addon.active);
  const [publicVisible, setPublicVisible] = useState<boolean>(addon.publicVisible);
  const [required, setRequired] = useState<boolean>(addon.required);
  const [sortOrder, setSortOrder] = useState<string>(String(addon.sortOrder));
  const [saving, setSaving] = useState<boolean>(false);
  const [archiving, setArchiving] = useState<boolean>(false);
  const [confirmArchive, setConfirmArchive] = useState<boolean>(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Effective effect values — a disabled channel always contributes 0.
  const effTime = affectsTime ? parseNum(effectTimeMinutes) : 0;
  const effFixed = affectsFixed ? parseNum(effectFixedExclVat) : 0;
  const effPercent = affectsPercent ? parseNum(effectPercent) : 0;

  const draftConfig = useMemo<CalculatorAddonConfigV2>(
    () => ({
      addonKey: addon.addonKey,
      name,
      publicLabel,
      description: description.trim() === "" ? null : description,
      inputType,
      booleanDefault,
      quantityMin: safeNum(parseNum(quantityMin)),
      quantityMax: quantityMax.trim() === "" ? null : safeNum(parseNum(quantityMax)),
      quantityStep: safeNum(parseNum(quantityStep)) || 1,
      quantityDefault: safeNum(parseNum(quantityDefault)),
      effectTimeMinutes: safeNum(effTime),
      effectFixedExclVat: safeNum(effFixed),
      effectPercent: safeNum(effPercent),
      // The preview always treats the add-on as active so its effect is visible
      // regardless of the (separate) active toggle the admin is editing.
      active: true,
      publicVisible,
      required,
      sortOrder: safeNum(parseNum(sortOrder)),
    }),
    [
      addon.addonKey, name, publicLabel, description, inputType, booleanDefault, quantityMin, quantityMax,
      quantityStep, quantityDefault, effTime, effFixed, effPercent, publicVisible, required, sortOrder,
    ],
  );

  const noEffect = addonHasNoEffect({
    effectTimeMinutes: safeNum(effTime),
    effectFixedExclVat: safeNum(effFixed),
    effectPercent: safeNum(effPercent),
  });

  const save = useCallback(async () => {
    const draft: NewAddonDraft = {
      addonKey: addon.addonKey,
      name,
      publicLabel,
      inputType,
      quantityMin: parseNum(quantityMin),
      quantityMax: quantityMax.trim() === "" ? null : parseNum(quantityMax),
      quantityStep: parseNum(quantityStep),
      quantityDefault: parseNum(quantityDefault),
      effectTimeMinutes: effTime,
      effectFixedExclVat: effFixed,
      effectPercent: effPercent,
    };
    const problems = validateNewAddon(draft, siblingKeys);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await onSaveAddon(addon.legacyId, {
        name,
        publicLabel,
        description: description.trim() === "" ? null : description,
        inputType,
        booleanDefault,
        quantityMin: parseNum(quantityMin),
        quantityMax: quantityMax.trim() === "" ? null : parseNum(quantityMax),
        quantityStep: parseNum(quantityStep),
        quantityDefault: parseNum(quantityDefault),
        effectTimeMinutes: effTime,
        effectFixedExclVat: effFixed,
        effectPercent: effPercent,
        active,
        publicVisible,
        required,
        sortOrder: parseNum(sortOrder),
      });
    } catch (err) {
      setErrors([toErrorMessage(err)]);
    } finally {
      setSaving(false);
    }
  }, [
    active, addon.addonKey, addon.legacyId, booleanDefault, description, effFixed, effPercent, effTime,
    inputType, name, onSaveAddon, publicLabel, publicVisible, quantityDefault, quantityMax, quantityMin,
    quantityStep, required, siblingKeys, sortOrder,
  ]);

  const handleArchive = useCallback(async () => {
    setConfirmArchive(false);
    setErrors([]);
    setArchiving(true);
    try {
      await onArchiveAddon(addon.legacyId);
    } catch (err) {
      setErrors([toErrorMessage(err)]);
      setArchiving(false);
    }
  }, [addon.legacyId, onArchiveAddon]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{name || addon.name}</h3>
            <Pill tone={active ? "green" : "muted"}>{active ? "Active" : "Inactive"}</Pill>
            <Pill tone={publicVisible ? "blue" : "muted"}>{publicVisible ? "Public" : "Hidden"}</Pill>
            {required ? <Pill tone="amber">Required</Pill> : null}
          </div>
          <div className="mt-2"><LockedChip>{addon.addonKey}</LockedChip></div>
        </div>
        <Switch checked={active} onCheckedChange={setActive} aria-label={`${addon.name} active`} />
      </div>

      {/* Identity / copy */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${addon.legacyId}-name`}>Admin name</Label>
          <Input id={`${addon.legacyId}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Only shown internally in Admin. The customer does not see this.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${addon.legacyId}-label`}>Text shown to customer</Label>
          <Input id={`${addon.legacyId}-label`} value={publicLabel} onChange={(e) => setPublicLabel(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            This is the text the customer will see in the public calculator. Example: “Vi har en hund”.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor={`${addon.legacyId}-desc`}>Customer help text</Label>
        <Textarea
          id={`${addon.legacyId}-desc`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional explanation shown to the customer."
        />
        <p className="text-[11px] text-muted-foreground">Optional explanation shown below the customer question.</p>
      </div>

      {/* Customer input */}
      <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <ToggleLeft className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Customer input</p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${addon.legacyId}-input-type`}>Answer type</Label>
            <select
              id={`${addon.legacyId}-input-type`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={inputType}
              onChange={(e) => setInputType(e.target.value as CalculatorAddonInputType)}
            >
              <option value="boolean">Yes / No</option>
              <option value="quantity">Quantity</option>
            </select>
            <p className="text-[11px] text-muted-foreground">Choose how the customer answers this add-on.</p>
          </div>
          {inputType === "boolean" ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
              <Label htmlFor={`${addon.legacyId}-bool-default`}>Default to Yes</Label>
              <Switch
                id={`${addon.legacyId}-bool-default`}
                checked={booleanDefault}
                onCheckedChange={setBooleanDefault}
                aria-label={`${addon.name} default to yes`}
              />
            </div>
          ) : null}
        </div>

        {inputType === "quantity" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${addon.legacyId}-qmin`}>Min</Label>
              <Input id={`${addon.legacyId}-qmin`} type="number" inputMode="decimal" value={quantityMin} onChange={(e) => setQuantityMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${addon.legacyId}-qmax`}>Max</Label>
              <Input id={`${addon.legacyId}-qmax`} type="number" inputMode="decimal" placeholder="None" value={quantityMax} onChange={(e) => setQuantityMax(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${addon.legacyId}-qstep`}>Step</Label>
              <Input id={`${addon.legacyId}-qstep`} type="number" inputMode="decimal" value={quantityStep} onChange={(e) => setQuantityStep(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${addon.legacyId}-qdefault`}>Default</Label>
              <Input id={`${addon.legacyId}-qdefault`} type="number" inputMode="decimal" value={quantityDefault} onChange={(e) => setQuantityDefault(e.target.value)} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Price effect */}
      <div className="mt-3 space-y-3">
        <PriceEffectHeader />
        <PriceEffectChannels
          idPrefix={addon.legacyId}
          affectsTime={affectsTime}
          setAffectsTime={setAffectsTime}
          effectTimeMinutes={effectTimeMinutes}
          setEffectTimeMinutes={setEffectTimeMinutes}
          affectsFixed={affectsFixed}
          setAffectsFixed={setAffectsFixed}
          effectFixedExclVat={effectFixedExclVat}
          setEffectFixedExclVat={setEffectFixedExclVat}
          affectsPercent={affectsPercent}
          setAffectsPercent={setAffectsPercent}
          effectPercent={effectPercent}
          setEffectPercent={setEffectPercent}
        />
        {noEffect ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This add-on currently has no calculation effect.
          </p>
        ) : null}
      </div>

      {/* Lifecycle */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
          <Label htmlFor={`${addon.legacyId}-public`} className="flex items-center gap-1.5">
            {publicVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} Visible in calculator
          </Label>
          <Switch id={`${addon.legacyId}-public`} checked={publicVisible} onCheckedChange={setPublicVisible} aria-label={`${addon.name} visible in calculator`} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
          <Label htmlFor={`${addon.legacyId}-required`}>Required</Label>
          <Switch id={`${addon.legacyId}-required`} checked={required} onCheckedChange={setRequired} aria-label={`${addon.name} required`} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${addon.legacyId}-sort`} className="flex items-center gap-1.5"><Hash className="h-3.5 w-3.5" /> Sort order</Label>
          <Input id={`${addon.legacyId}-sort`} type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
      </div>

      <div className="mt-4">
        <AddonPreviewPanel inputType={inputType} draftConfig={draftConfig} />
      </div>

      {errors.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {errors.map((problem) => (
            <li key={problem} className="text-sm text-red-600 dark:text-red-400">{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="sm:flex-1" onClick={save} disabled={saving || archiving}>
          <Save className="h-4 w-4" /> Save add-on
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-red-500/40 text-red-600 hover:text-red-600 dark:text-red-400"
          onClick={() => setConfirmArchive(true)}
          disabled={saving || archiving}
        >
          <Archive className="h-4 w-4" /> Archive
        </Button>
      </div>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this add-on?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{addon.name}&rdquo; will be hidden from this list. It is soft-deleted (never hard-deleted), so the
              same key can be recreated later. No public behaviour changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive add-on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Create form (key/copy + price effect, configured up-front) ───────────────

function CreateAddonForm({
  service,
  companyId,
  companyLegacyId,
  existingKeys,
  nextSortOrder,
  onCreate,
  onClose,
}: {
  service: CalculatorServiceConfig;
  companyId: string;
  companyLegacyId: string;
  existingKeys: readonly string[];
  nextSortOrder: number;
  onCreate: (input: NewAddonInput) => Promise<void>;
  onClose: () => void;
}) {
  const [addonKey, setAddonKey] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [publicLabel, setPublicLabel] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [inputType, setInputType] = useState<CalculatorAddonInputType>("boolean");
  // GPM-UX-ADMIN-5 — price effect is now configured up-front (was edit-only).
  const [affectsTime, setAffectsTime] = useState<boolean>(false);
  const [effectTimeMinutes, setEffectTimeMinutes] = useState<string>("0");
  const [affectsFixed, setAffectsFixed] = useState<boolean>(false);
  const [effectFixedExclVat, setEffectFixedExclVat] = useState<string>("0");
  const [affectsPercent, setAffectsPercent] = useState<boolean>(false);
  const [effectPercent, setEffectPercent] = useState<string>("0");
  const [creating, setCreating] = useState<boolean>(false);
  const [errors, setErrors] = useState<string[]>([]);

  // A disabled channel always contributes 0 (mirrors the edit card).
  const effTime = affectsTime ? parseNum(effectTimeMinutes) : 0;
  const effFixed = affectsFixed ? parseNum(effectFixedExclVat) : 0;
  const effPercent = affectsPercent ? parseNum(effectPercent) : 0;
  const noEffect = addonHasNoEffect({
    effectTimeMinutes: safeNum(effTime),
    effectFixedExclVat: safeNum(effFixed),
    effectPercent: safeNum(effPercent),
  });

  const create = useCallback(async () => {
    const draft: NewAddonDraft = {
      addonKey,
      name,
      publicLabel,
      inputType,
      // Quantity bounds keep safe defaults at creation; effects come from the form.
      quantityMin: 0,
      quantityMax: null,
      quantityStep: 1,
      quantityDefault: 0,
      effectTimeMinutes: effTime,
      effectFixedExclVat: effFixed,
      effectPercent: effPercent,
    };
    const problems = validateNewAddon(draft, existingKeys);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    setCreating(true);
    try {
      await onCreate({
        companyId,
        companyLegacyId,
        serviceId: service.id,
        serviceLegacyId: service.legacyId,
        serviceKey: service.serviceKey,
        addonKey,
        name,
        publicLabel,
        description: description.trim() === "" ? null : description,
        inputType,
        effectTimeMinutes: effTime,
        effectFixedExclVat: effFixed,
        effectPercent: effPercent,
        sortOrder: nextSortOrder,
      });
      onClose();
    } catch (err) {
      setErrors([toErrorMessage(err)]);
      setCreating(false);
    }
  }, [
    addonKey, companyId, companyLegacyId, description, effFixed, effPercent, effTime, existingKeys,
    inputType, name, nextSortOrder, onClose, onCreate, publicLabel, service.id, service.legacyId,
    service.serviceKey,
  ]);

  return (
    <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">New add-on</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Cancel new add-on">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-new-key`}>Internal key</Label>
          <Input
            id={`${service.serviceKey}-new-key`}
            placeholder="e.g. dog, bathrooms, oven"
            value={addonKey}
            onChange={(e) => setAddonKey(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Permanent technical ID. Cannot be changed after saving. Example: has_pets or oven_cleaning.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-new-type`}>Answer type</Label>
          <select
            id={`${service.serviceKey}-new-type`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={inputType}
            onChange={(e) => setInputType(e.target.value as CalculatorAddonInputType)}
          >
            <option value="boolean">Yes / No</option>
            <option value="quantity">Quantity</option>
          </select>
          <p className="text-[11px] text-muted-foreground">Choose how the customer answers this add-on.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-new-name`}>Admin name</Label>
          <Input id={`${service.serviceKey}-new-name`} value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Only shown internally in Admin. The customer does not see this.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${service.serviceKey}-new-label`}>Text shown to customer</Label>
          <Input id={`${service.serviceKey}-new-label`} value={publicLabel} onChange={(e) => setPublicLabel(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            This is the text the customer will see in the public calculator. Example: “Vi har en hund”.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor={`${service.serviceKey}-new-desc`}>Customer help text</Label>
        <Textarea
          id={`${service.serviceKey}-new-desc`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional explanation shown to the customer."
        />
        <p className="text-[11px] text-muted-foreground">Optional explanation shown below the customer question.</p>
      </div>

      {/* Price effect — configured up-front so the admin sees how it changes the price. */}
      <div className="mt-4 space-y-3">
        <PriceEffectHeader />
        <PriceEffectChannels
          idPrefix={`${service.serviceKey}-new`}
          affectsTime={affectsTime}
          setAffectsTime={setAffectsTime}
          effectTimeMinutes={effectTimeMinutes}
          setEffectTimeMinutes={setEffectTimeMinutes}
          affectsFixed={affectsFixed}
          setAffectsFixed={setAffectsFixed}
          effectFixedExclVat={effectFixedExclVat}
          setEffectFixedExclVat={setEffectFixedExclVat}
          affectsPercent={affectsPercent}
          setAffectsPercent={setAffectsPercent}
          effectPercent={effectPercent}
          setEffectPercent={setEffectPercent}
        />
        {noEffect ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No price effect yet — the customer will see this add-on but it will not change the price. Turn on a price
            effect above if it should.
          </p>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {errors.map((problem) => (
            <li key={problem} className="text-sm text-red-600 dark:text-red-400">{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="sm:flex-1" onClick={create} disabled={creating}>
          <Plus className="h-4 w-4" /> Create add-on
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={creating}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Add-on library panel (GPM-CALC-LIBRARY-4) ────────────────────────

/**
 * Reusable add-on library for the selected service. Collapsed by default. When
 * expanded it offers two actions, both reusing existing scoped write paths:
 *   • Activate a library add-on onto this service — creates a calculator_addons row
 *     that COPIES the library defaults (copy + input model + the three effect
 *     channels) and links back via library_item_id (the admin can override every
 *     field afterwards via the normal add-on card).
 *   • Save one of this service's add-ons INTO the library so it can be reused.
 * Library items whose addon_key already exists on the service are filtered out of
 * the activate list (the DB rejects a duplicate (service, key)); add-ons whose key
 * already exists in the library are filtered out of the save list. Purely additive
 * UI — it never changes pricing, public runtime, or existing add-ons.
 */
function AddonLibraryPanel({
  service,
  companyId,
  companyLegacyId,
  libraryItems,
  serviceAddons,
  nextSortOrder,
  onActivate,
  onSaveToLibrary,
}: {
  service: CalculatorServiceConfig;
  companyId: string;
  companyLegacyId: string;
  libraryItems: AddonLibraryItem[];
  serviceAddons: CalculatorAddonConfig[];
  nextSortOrder: number;
  onActivate: (input: NewAddonInput) => Promise<void>;
  onSaveToLibrary?: (input: NewAddonLibraryItemInput) => Promise<void>;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serviceAddonKeys = useMemo(
    () => new Set(serviceAddons.map((a) => a.addonKey)),
    [serviceAddons],
  );
  const libraryKeys = useMemo(() => new Set(libraryItems.map((i) => i.addonKey)), [libraryItems]);

  const available = useMemo(
    () => libraryItems.filter((i) => i.active && !serviceAddonKeys.has(i.addonKey)),
    [libraryItems, serviceAddonKeys],
  );
  const promotable = useMemo(
    () => serviceAddons.filter((a) => a.active && !libraryKeys.has(a.addonKey)),
    [serviceAddons, libraryKeys],
  );

  const handleActivate = useCallback(
    async (item: AddonLibraryItem) => {
      setError(null);
      setBusyKey(`activate:${item.id}`);
      try {
        await onActivate(
          buildAddonLibraryActivationInput(
            item,
            {
              companyId,
              companyLegacyId,
              serviceId: service.id,
              serviceLegacyId: service.legacyId,
              serviceKey: service.serviceKey,
            },
            nextSortOrder,
          ),
        );
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setBusyKey(null);
      }
    },
    [onActivate, companyId, companyLegacyId, service.id, service.legacyId, service.serviceKey, nextSortOrder],
  );

  const handleSaveToLibrary = useCallback(
    async (addon: CalculatorAddonConfig) => {
      if (!onSaveToLibrary) return;
      setError(null);
      setBusyKey(`save:${addon.legacyId}`);
      try {
        await onSaveToLibrary({
          companyId,
          companyLegacyId,
          addonKey: addon.addonKey,
          name: addon.name,
          publicLabel: addon.publicLabel,
          description: addon.description,
          inputType: addon.inputType,
          booleanDefault: addon.booleanDefault,
          quantityMin: addon.quantityMin,
          quantityMax: addon.quantityMax,
          quantityStep: addon.quantityStep,
          quantityDefault: addon.quantityDefault,
          effectTimeMinutes: addon.effectTimeMinutes,
          effectFixedExclVat: addon.effectFixedExclVat,
          effectPercent: addon.effectPercent,
          defaultSortOrder: addon.sortOrder,
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
    <div className="rounded-2xl border border-border bg-muted/20 p-3" data-testid="addon-library-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
        data-testid="addon-library-toggle"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Library className="h-3.5 w-3.5" /> Add-on library
        </span>
        <span className="flex items-center gap-1.5">
          <Pill tone={available.length > 0 ? "blue" : "muted"}>{available.length} available</Pill>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted-foreground">
            Reusable add-ons are shared across this company. Activating one copies its defaults (including price
            effect) onto this service — you can override every field afterwards.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Add a library add-on to this service</p>
            {available.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {libraryItems.length === 0
                  ? "No reusable add-ons yet. Save one of this service’s add-ons below to start a library."
                  : "Every library add-on is already active on this service."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((item) => (
                  <div
                    key={item.id}
                    className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3"
                    data-testid={`addon-library-item-${item.addonKey}`}
                  >
                    <span className="text-sm font-medium leading-tight">{item.publicLabel || item.name}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LockedChip>{item.addonKey}</LockedChip>
                      <LockedChip>{INPUT_TYPE_LABEL[item.inputType]}</LockedChip>
                    </div>
                    <div className="mt-auto flex justify-end pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleActivate(item)}
                        disabled={busyKey !== null}
                        aria-label={`Activate ${item.publicLabel || item.name}`}
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
              <p className="text-xs font-medium text-foreground">Save this service’s add-ons to the library</p>
              {promotable.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Every active add-on here is already in the library.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {promotable.map((a) => (
                    <Button
                      key={a.legacyId}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="border border-border"
                      onClick={() => void handleSaveToLibrary(a)}
                      disabled={busyKey !== null}
                      aria-label={`Save ${a.name} to library`}
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" /> {a.name}
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

// ── Per-service section ──────────────────────────────────────────────────────

function ServiceAddonsSection({
  service,
  addons,
  companyId,
  companyLegacyId,
  embedded = false,
  onAddAddon,
  onSaveAddon,
  onArchiveAddon,
  addonLibraryItems,
  onSaveAddonToLibrary,
}: {
  service: CalculatorServiceConfig;
  addons: CalculatorAddonConfig[];
  companyId: string;
  companyLegacyId: string;
  /** When embedded inside Pricing, drop the outer card chrome + the duplicate service title. */
  embedded?: boolean;
  onAddAddon: (input: NewAddonInput) => Promise<void>;
  onSaveAddon: (legacyId: string, patch: CalculatorAddonPatch) => Promise<void>;
  onArchiveAddon: (legacyId: string) => Promise<void>;
  /** GPM-CALC-LIBRARY-4 — reusable add-on library items; undefined hides the panel. */
  addonLibraryItems?: AddonLibraryItem[];
  onSaveAddonToLibrary?: (input: NewAddonLibraryItemInput) => Promise<void>;
}) {
  const [creating, setCreating] = useState<boolean>(false);
  const [showInactive, setShowInactive] = useState<boolean>(false);

  const serviceAddons = useMemo(
    () =>
      addons
        .filter((addon) => addon.serviceKey === service.serviceKey)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.addonKey.localeCompare(b.addonKey)),
    [addons, service.serviceKey],
  );
  // GPM-UX-ADMIN-3 — default view shows active add-ons only; inactive ones stay
  // behind a toggle so the section is not cluttered.
  const activeAddons = useMemo(() => serviceAddons.filter((addon) => addon.active), [serviceAddons]);
  const inactiveAddons = useMemo(() => serviceAddons.filter((addon) => !addon.active), [serviceAddons]);
  const visibleAddons = showInactive ? serviceAddons : activeAddons;
  const liveKeys = useMemo(() => serviceAddons.map((addon) => addon.addonKey), [serviceAddons]);
  const nextSortOrder = useMemo(
    () => serviceAddons.reduce((max, addon) => Math.max(max, addon.sortOrder), 0) + 10,
    [serviceAddons],
  );

  return (
    <section className={embedded ? "space-y-4" : "space-y-4 rounded-3xl border border-border bg-muted/20 p-4"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedded ? null : <h2 className="text-base font-semibold">{serviceAddonTitle(service)}</h2>}
          <p className={embedded ? "text-sm text-muted-foreground" : "mt-1 text-sm text-muted-foreground"}>
            {serviceAddons.length === 0
              ? "No add-ons yet."
              : `${activeAddons.length} active${inactiveAddons.length > 0 ? ` · ${inactiveAddons.length} inactive` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InactiveItemsToggle
            hiddenCount={inactiveAddons.length}
            open={showInactive}
            onToggle={() => setShowInactive((v) => !v)}
            showLabel="Show inactive add-ons"
            hideLabel="Hide inactive add-ons"
            testId={`addons-inactive-toggle-${service.serviceKey}`}
          />
          {!creating ? (
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Create new add-on
            </Button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <CreateAddonForm
          service={service}
          companyId={companyId}
          companyLegacyId={companyLegacyId}
          existingKeys={liveKeys}
          nextSortOrder={nextSortOrder}
          onCreate={onAddAddon}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {visibleAddons.length > 0 ? (
        <div className="grid auto-rows-fr grid-cols-1 gap-4 xl:grid-cols-2">
          {visibleAddons.map((addon) => (
            <AddonCard
              key={addon.legacyId}
              addon={addon}
              siblingKeys={liveKeys.filter((key) => key !== addon.addonKey)}
              onSaveAddon={onSaveAddon}
              onArchiveAddon={onArchiveAddon}
            />
          ))}
        </div>
      ) : !creating ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {serviceAddons.length === 0
            ? `No add-ons for ${service.displayName} yet. Create the first one to get started.`
            : `No active add-ons. Use “Show inactive add-ons” to reveal ${inactiveAddons.length} inactive.`}
        </div>
      ) : null}

      {addonLibraryItems !== undefined ? (
        <AddonLibraryPanel
          service={service}
          companyId={companyId}
          companyLegacyId={companyLegacyId}
          libraryItems={addonLibraryItems}
          serviceAddons={serviceAddons}
          nextSortOrder={nextSortOrder}
          onActivate={onAddAddon}
          onSaveToLibrary={onSaveAddonToLibrary}
        />
      ) : null}
    </section>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

export interface CalculatorAddonsEditorProps {
  services: CalculatorServiceConfig[];
  addons: CalculatorAddonConfig[];
  companyId: string;
  companyLegacyId: string;
  /**
   * GPM-UX-ADMIN-7 — render as the content of the unified "Add-ons" subsection
   * inside Pricing (no standalone banner, no own section header — the parent
   * "Add-ons" section owns the header). The non-embedded standalone editor is
   * unchanged.
   */
  embedded?: boolean;
  onAddAddon: (input: NewAddonInput) => Promise<void>;
  onSaveAddon: (legacyId: string, patch: CalculatorAddonPatch) => Promise<void>;
  onArchiveAddon: (legacyId: string) => Promise<void>;
  /**
   * GPM-CALC-LIBRARY-4 — reusable add-on library items for the company. When
   * provided, each service's add-ons section shows a collapsible “Add-on library”
   * panel to activate library add-ons and save its add-ons to the library.
   * Optional — omitting it (the default) hides the panel, so existing usages/tests
   * are unaffected.
   */
  addonLibraryItems?: AddonLibraryItem[];
  /** Save a service add-on into the reusable library (createAddonLibraryItem). */
  onSaveAddonToLibrary?: (input: NewAddonLibraryItemInput) => Promise<void>;
}

export function CalculatorAddonsEditor({
  services,
  addons,
  companyId,
  companyLegacyId,
  embedded = false,
  onAddAddon,
  onSaveAddon,
  onArchiveAddon,
  addonLibraryItems,
  onSaveAddonToLibrary,
}: CalculatorAddonsEditorProps) {
  const sortedServices = useMemo(
    () => [...services].sort((a, b) => a.sortOrder - b.sortOrder),
    [services],
  );

  // GPM-UX-ADMIN-7 — embedded inside the unified "Add-ons" subsection of Pricing.
  // The parent section already owns the "Add-ons" header + helper copy, so this
  // renders headerless: just the customer add-ons under one clear sub-group label.
  if (embedded) {
    return (
      <div className="space-y-3" data-testid="pricing-customer-addons">
        <p className="text-xs font-semibold text-foreground/80">Active add-ons for this service</p>
        {sortedServices.length > 0 ? (
          sortedServices.map((service) => (
            <ServiceAddonsSection
              key={service.serviceKey}
              embedded
              service={service}
              addons={addons}
              companyId={companyId}
              companyLegacyId={companyLegacyId}
              onAddAddon={onAddAddon}
              onSaveAddon={onSaveAddon}
              onArchiveAddon={onArchiveAddon}
              addonLibraryItems={addonLibraryItems}
              onSaveAddonToLibrary={onSaveAddonToLibrary}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No service selected.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status banner — add-ons are now consumed by the public calculator for services
          on the V2 engine (the per-m² services + the Home pilot); legacy services that
          still price on the old engine do not read them yet. */}
      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4">
        <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-sky-800 dark:text-sky-300">Add-ons are live for supported services</p>
            <Pill tone="blue">Live for supported services</Pill>
          </div>
          <p className="mt-0.5 text-sm text-sky-700/90 dark:text-sky-300/80">
            Add-ons you configure here now appear in the public calculator and are included in the price for
            enabled services on the new pricing engine. Services still on the legacy engine will start using
            them once they move over.
          </p>
        </div>
      </div>

      {sortedServices.length > 0 ? (
        sortedServices.map((service) => (
          <ServiceAddonsSection
            key={service.serviceKey}
            service={service}
            addons={addons}
            companyId={companyId}
            companyLegacyId={companyLegacyId}
            onAddAddon={onAddAddon}
            onSaveAddon={onSaveAddon}
            onArchiveAddon={onArchiveAddon}
            addonLibraryItems={addonLibraryItems}
            onSaveAddonToLibrary={onSaveAddonToLibrary}
          />
        ))
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No calculator services to attach add-ons to.
        </div>
      )}
    </div>
  );
}

export default CalculatorAddonsEditor;
