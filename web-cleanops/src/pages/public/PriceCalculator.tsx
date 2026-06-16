import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  AppWindow,
  ArrowLeft,
  BadgeCheck,
  Building2,
  Calculator,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Footprints,
  Gauge,
  HelpCircle,
  House,
  Info,
  Loader2,
  Lock,
  Mail,
  Pencil,
  Phone,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Seo, PUBLIC_SITE_NAME } from "@/components/seo/Seo";
import { Button } from "@/components/ui/button";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getWebsiteImagesForPage, type WebsiteImage } from "@/lib/assets";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  usePublicCalculatorConfig,
  usePublicPriceCalculation,
  useSubmitPublicQuote,
} from "@/hooks/use-public-calculator";
import {
  isLikelyEmail,
  parseCalculatorContent,
  parseCalculatorFaq,
  resolveResultView,
  type AddonSelections,
  type AddonSelectionValue,
  type AnswerValue,
  type CalculatorAnswers,
  type CalculatorFaqItem,
  type CalculatorResultView,
  type PublicAddon,
  type PublicCalculateRequest,
  type PublicCleaningPlan,
  type PublicConfigResponse,
  type PublicQuestion,
  type PublicService,
  type PublicSettings,
  type PublicSubmitRequest,
  type PublicSubmitResponse,
} from "@/lib/calculator/publicCalculatorClient";
import { partitionFeaturedServices } from "@/lib/calculator/publicServiceDisplay";
import { assessGenericServiceClientReadiness } from "@/lib/calculator/genericServiceReadiness";
import {
  resolveDisplayRoundingIncrement,
  roundPublicDisplayPrice,
} from "@/lib/calculator/publicPriceDisplayRounding";

/**
 * Public Price Calculator page (Slice 7A — UX/design polish) — `/rakna-ut-ditt-pris`.
 *
 * An UNAUTHENTICATED landing page (no ProtectedRoute / PublicOnly / SmartRoute):
 * accessible logged-in or logged-out, it never redirects. All data comes from the
 * deployed `public-calculator` Edge Function via React Query:
 *   • config    — drives the dynamic form (services, questions, plans, copy).
 *   • calculate — server-authoritative price (debounced; never trusts a local price).
 *   • submit    — the WRITE path (server recomputes; only writes when enabled + valid).
 *
 * The page reads as a polished public SaaS landing page: a calm hero with trust
 * cues, a guided 5-step form down the left (service → details → plan → contact →
 * send), and a sticky live price panel + FAQ/trust column on the right. When the
 * calculator is dark (`enabled=false`, the live MVP default) it renders a calm
 * "coming soon" state, makes no calculate calls, and exposes no submit UI.
 *
 * HARDENING (unchanged from Slice 6): every config field is read defensively, stale
 * calculations can never be presented as final (see resolveResultView), and only
 * public-safe fields are ever read — no rule values, margins, ids or trace.
 */

/** The stable, environment-independent public slug for the MVP calculator. */
const PUBLIC_CALCULATOR_SLUG = "rakna-ut-ditt-pris";

/** Swedish fallback copy used when a content slot is missing. */
const FALLBACK = {
  pageTitle: "Räkna ut ditt pris",
  pageSubtitle: "Få en uppskattad kostnad för din städning på under en minut — utan bindning.",
  intro: "Svara på några snabba frågor så ger vi dig ett prisintervall direkt.",
  backLabel: "Tillbaka till webbplatsen",
  serviceHeading: "Välj tjänst",
  serviceHint: "Vilken typ av städning behöver du hjälp med?",
  previewHeading: "Förhandsvisning av nya tjänster",
  previewHint: "Dessa tjänster är på väg – du kan ännu inte räkna ut pris på dem här.",
  previewBadge: "Förhandsvisning",
  previewPricePerUnitPrefix: "Pris per",
  detailsHeading: "Fyll i information om uppdraget",
  detailsHint: "Ju mer du fyller i, desto mer träffsäker blir din uppskattning.",
  planHeading: "Välj städupplägg",
  planHint:
    "Alla upplägg innehåller samma städning. Det som skiljer är timpris, flexibilitet, dina önskemål om dagar och tider samt hur ofta du får samma medarbetare.",
  addonsHeading: "Tillval",
  addonsHint: "Lägg till det du behöver – priset uppdateras direkt.",
  resultEyebrow: "Uppskattat pris",
  resultEyebrowRecurring: "Uppskattat månadspris",
  pricePeriodMonthlySuffix: "/mån",
  preliminaryBadge: "Preliminär uppskattning",
  preliminaryNote: "Det här är en preliminär uppskattning – inte en bindande offert.",
  resultPlaceholder: "Fyll i uppgifterna till vänster så visar vi ditt pris direkt här.",
  resultFinePrint: "Uppskattningen är preliminär. Slutpriset bekräftas efter en kort kontakt.",
  calculating: "Beräknar pris…",
  updating: "Uppdaterar…",
  calcError: "Vi kunde inte beräkna priset just nu. Försök igen om en liten stund.",
  hoursLabel: "Beräknad tid per tillfälle",
  disabledBadge: "Snart tillgänglig",
  disabledTitle: "Priskalkylatorn är inte aktiv ännu",
  disabledBody:
    "Vi finjusterar våra priser just nu. Kom tillbaka snart för att räkna ut ditt pris på under en minut.",
  noServicesTitle: "Inga tjänster är tillgängliga just nu",
  noServicesBody:
    "Vi kunde inte hitta några tjänster att räkna på just nu. Kontakta oss så hjälper vi dig med en offert.",
  noFieldsBody: "Inga fält att fylla i för den här tjänsten.",
  plansUnavailable:
    "Planalternativ kunde inte laddas just nu, så vi kan inte räkna ut ett pris för den här tjänsten. Försök igen senare eller kontakta oss.",
  contactHeading: "Kontaktuppgifter",
  contactBody:
    "Fyll i dina uppgifter så återkommer vi med en bekräftad offert. Vi sparar bara det vi behöver för att kontakta dig.",
  nameLabel: "Namn",
  emailLabel: "E-post",
  phoneLabel: "Telefon",
  postalLabel: "Postnummer",
  emailInvalid: "Ange en giltig e-postadress så vi kan återkomma till dig.",
  submitHeading: "Skicka offertförfrågan",
  submitCta: "Skicka offertförfrågan",
  submitReassurance: "Du binder dig inte genom att skicka en förfrågan.",
  submitting: "Skickar…",
  submitDisclaimer: "Genom att skicka godkänner du att vi får kontakta dig om din förfrågan.",
  submitError: "Vi kunde inte skicka din förfrågan just nu. Försök igen om en liten stund.",
  submitUnavailable:
    "Priskalkylatorn är inte aktiv just nu, så vi kunde inte ta emot din förfrågan.",
  submitInvalid: "Kontrollera uppgifterna ovan och försök igen.",
  confirmTitle: "Offertförfrågan skickad",
  confirmBody: "Vi har tagit emot dina uppgifter och skapat en preliminär offertförfrågan.",
  confirmNextStep:
    "Nästa steg är att vi granskar uppgifterna och återkommer med mer information.",
  confirmPriceLabel: "Uppskattat pris",
  confirmPriceLabelRecurring: "Uppskattat månadspris",
  confirmPlanLabel: "Valt upplägg",
  confirmValidUntil: "Giltig till",
  confirmReference: "Referens",
  faqHeading: "Vanliga frågor",
  trustHeading: "Bra att veta",
  serviceChangeLabel: "Ändra tjänst",
  serviceSelectedBadge: "Vald",
  serviceSelectedNote: "Du kan byta tjänst när som helst.",
  serviceShowMore: "Visa fler",
  serviceShowLess: "Visa färre",
  helpButton: "Frågor & svar",
  helpDialogIntro: "Svar på de vanligaste frågorna innan du skickar din förfrågan.",
  helpContactHeading: "Behöver du hjälp?",
  postalInvalid: "Ange ditt postnummer så vi kan kontrollera att vi täcker ditt område.",
  customIntervalTitle: "Anpassat intervall",
  customIntervalBody:
    "Du har valt ett anpassat städintervall. För specialupplägg behöver vi mer information om dagar, tider och omfattning innan vi kan ge ett rättvist pris. Fyll i dina kontaktuppgifter så återkommer vi med nästa steg.",
  customIntervalResultNote:
    "För anpassade intervall tar vi fram priset manuellt. Fyll i dina kontaktuppgifter så återkommer vi med nästa steg.",
  // Home cleaning four-week period (Slice 12I/12J). Part E: the MAIN figure is the
  // price PER VISIT; the four-week period total is shown as a secondary line.
  resultEyebrowPerVisit: "Pris per tillfälle",
  fourWeekLabel: "Pris per fyra veckors period",
  // Slice 12Q Phase B — result-card "Summering" section + display controls.
  summaryHeading: "Summering",
  perVisitSummaryLabel: "Pris per tillfälle",
  cleaningSetupLabel: "Städupplägg",
  cleaningSetupValue: "Flexibelt",
  showInclVatToggle: "Visa priser inklusive moms",
  showAfterRutToggle: "Visa pris efter RUT-avdrag",
} as const;

/**
 * The home-cleaning recurring intervals (Slice 12I). When one is selected the
 * result reads as a FOUR-WEEK period total (price-per-visit × visits); before
 * that the per-visit estimate is shown. Values MUST match the engine's
 * HOME_VISITS_PER_FOUR_WEEKS keys and the seeded `frequency` options.
 */
const HOME_FOUR_WEEK_INTERVALS: readonly string[] = ["weekly", "biweekly", "every_four_weeks"];

/**
 * The office "custom interval" frequency value (mirrors the seeded option + the
 * engine's OFFICE_CUSTOM_INTERVAL). Selecting it suppresses the automatic price
 * and routes the request to manual review — the visitor can still submit.
 */
const OFFICE_CUSTOM_INTERVAL_VALUE = "custom_interval";

/** The office supervision (tillsynsstädning) toggle + its conditional detail fields. */
const SUPERVISION_TOGGLE_KEY = "supervision_cleaning";
const SUPERVISION_DETAIL_KEYS: readonly string[] = [
  "supervision_visits_per_week",
  "supervision_minutes_per_visit",
];

/**
 * Client-side display-label overrides (Slice 12H). The DB keeps the longer,
 * descriptive labels; the public form shows shortened, calmer ones. Keyed by
 * questionKey — anything not listed falls back to the server label.
 */
const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  supervision_visits_per_week: "Tillfällen per vecka",
  supervision_minutes_per_visit: "Minuter per tillfälle",
};

/**
 * Curated FAQ shown when the server config supplies none — it covers the questions
 * customers actually ask before requesting a quote. Real server FAQ (editable by
 * the company) always wins when present.
 */
const DEFAULT_FAQ: CalculatorFaqItem[] = [
  {
    question: "Hur räknas priset ut?",
    answer:
      "Priset baseras på tjänsten du väljer, boytan och dina svar. För hemstädning utgår vi från en rekommenderad tid och valt upplägg – allt räknas ut automatiskt medan du fyller i.",
  },
  {
    question: "Är priset bindande?",
    answer:
      "Nej. Priset du ser är en uppskattning. Vi bekräftar slutpriset efter en kort kontakt och genomgång av dina uppgifter.",
  },
  {
    question: "Kan jag använda RUT-avdrag?",
    answer:
      "För hemstädning kan RUT-avdraget oftast användas, vilket halverar arbetskostnaden. Vi hjälper dig med detaljerna när vi återkommer.",
  },
  {
    question: "Vad händer efter att jag skickat offertförfrågan?",
    answer:
      "Vi granskar dina uppgifter och återkommer med en bekräftad offert och nästa steg. Du binder dig inte genom att skicka en förfrågan.",
  },
  {
    question: "Får jag samma medarbetare varje gång?",
    answer:
      "Det beror på vilket upplägg du väljer. Med ett mer prioriterat upplägg ökar chansen att du får samma medarbetare vid varje tillfälle.",
  },
];

/** Compact trust cues shown beneath the hero heading. */
const HERO_BADGES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Ingen bindning" },
  { icon: Clock, label: "Svar inom kort" },
  { icon: Wallet, label: "Kostnadsfritt att räkna ut" },
];

/** Reassurance points shown in the right-column trust card. */
const TRUST_POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: BadgeCheck,
    title: "Ingen bindning",
    body: "Du väljer själv om du vill gå vidare efter att vi återkommit.",
  },
  {
    icon: ShieldCheck,
    title: "Personlig återkoppling",
    body: "Vi granskar din förfrågan och återkommer med en bekräftad offert.",
  },
  {
    icon: Receipt,
    title: "RUT-avdrag",
    body: "För hemstädning kan RUT-avdraget oftast användas på arbetskostnaden.",
  },
];

// ── small helpers ─────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface FieldOption {
  value: string;
  label: string;
}

/**
 * Human-readable per-visit time (Slice 12Q Phase B): "2 tim, 29 min (2.48h)".
 * Minutes are rounded to the nearest whole minute; the decimal-hours suffix is
 * shown with up to two decimals (trailing zeros trimmed). Never shows only the
 * decimal form as the primary value.
 */
function formatVisitTime(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const decimal = String(Number(hours.toFixed(2)));
  const head = h > 0 ? `${h} tim, ${m} min` : `${m} min`;
  return `${head} (${decimal}h)`;
}

/** Defensively reads a question's select/multiselect options. */
function parseOptions(options: unknown): FieldOption[] {
  if (!Array.isArray(options)) return [];
  const out: FieldOption[] = [];
  for (const raw of options) {
    const o = asRecord(raw);
    const value = typeof o.value === "string" ? o.value : null;
    if (value === null) continue;
    out.push({ value, label: typeof o.label === "string" ? o.label : value });
  }
  return out;
}

/** Coerces an answer to a finite number (or null). */
function toNumber(value: AnswerValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Picks an icon for a service by its stable key. */
function serviceIcon(serviceKey: string): LucideIcon {
  if (serviceKey === "home_cleaning") return House;
  if (serviceKey === "move_out_cleaning") return Truck;
  if (serviceKey === "office_cleaning") return Building2;
  if (serviceKey === "window_cleaning") return AppWindow;
  if (serviceKey === "deep_cleaning") return Sparkles;
  if (serviceKey === "stairwell_cleaning") return Footprints;
  if (serviceKey === "procurement") return ClipboardList;
  return Sparkles;
}

/** A short, customer-friendly hint about how a service is priced. */
function pricingModelHint(pricingModel: string): string | null {
  if (pricingModel === "home_cleaning_recommended_hours") return "Beräknas på rekommenderad tid";
  if (pricingModel === "move_out_fixed_plus_addons") return "Beräknas på boyta och tillval";
  if (pricingModel === "office_cleaning_recurring_area_frequency") return "Beräknas på yta och städfrekvens";
  // GPM-9 — a literal generic `sqm_fixed` service prices from the customer's area (m²).
  if (pricingModel === "sqm_fixed") return "Beräknas per m²";
  return null;
}

/**
 * True for pricing models that yield a RECURRING (monthly) estimate. Office
 * cleaning prices a per-visit cost × visits-per-month, so the figure is a monthly
 * estimate and the UI must label it "per month" — never a one-off price. Keyed by
 * pricing model so future recurring services opt in here without touching the UI.
 */
function isRecurringPricingModel(pricingModel: string | null | undefined): boolean {
  return pricingModel === "office_cleaning_recurring_area_frequency";
}

/**
 * GPM-9 — classifies how a public service is presented in the calculator:
 *   • "selectable" — a real, clickable + calculable service. Covers BOTH legacy/Home
 *     services (no generic model → `not_generic`) AND a fully client-renderable generic
 *     `sqm_fixed` service (enabled, engine-supported, with its canonical `sqm` input +
 *     unit label). The latter now flows through the SAME server-authoritative calculate
 *     path as every other service — no serviceKey-specific logic.
 *   • "preview" — a generic service the client cannot fully render YET (an incomplete or
 *     not-yet-supported generic model, e.g. `hourly_by_area`, a reserved model, or a
 *     `sqm_fixed` missing its input/unit label). Shown READ-ONLY in the "on the way"
 *     section so it can never read as a broken, clickable-but-failing service.
 * Pure + deterministic; reads only already-normalized public metadata, never prices,
 * routes, or hardcodes a serviceKey.
 */
function classifyPublicService(service: PublicService): "selectable" | "preview" {
  const readiness = assessGenericServiceClientReadiness(service);
  if (readiness.canRender || readiness.reason === "not_generic") return "selectable";
  return "preview";
}

/** Formats an hourly rate for display (SEK → "349 kr/h"). */
function formatRate(rate: number, currency: string): string {
  const suffix = currency === "SEK" ? "kr" : currency;
  return `${Math.round(rate)} ${suffix}/h`;
}

/** Groups thousands with a space, matching the engine's server-side displayText. */
function groupPrice(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Formats a price RANGE (or single "Cirka X" when min===max), mirroring the engine. */
function formatPriceRange(min: number, max: number, currency: string): string {
  const suffix = currency === "SEK" ? "kr" : currency;
  const lo = Math.round(min);
  const hi = Math.round(max);
  if (lo === hi) return `Cirka ${groupPrice(lo)} ${suffix}`;
  return `${groupPrice(lo)}–${groupPrice(hi)} ${suffix}`;
}

/**
 * Rounds a customer-facing amount to the NEAREST configured price rounding
 * interval (Slice 12Q follow-up). A few kronor up or down does not matter — the
 * goal is clean, consistent public prices. With no increment (or ≤ 0) it falls
 * back to whole-krona rounding so the displayed value is always tidy.
 */
function roundToIncrement(value: number, increment: number | null): number {
  return roundPublicDisplayPrice(value, increment);
}

/**
 * Formats a price range with each endpoint rounded to the configured interval via
 * the shared {@link roundPublicDisplayPrice} display layer. This is the FINAL
 * display step: callers pass amounts already resolved for the active VAT/RUT mode,
 * so every customer-facing figure (top price, per-visit, four-week) rounds the
 * same way to the same configured interval (or the whole-krona fallback).
 */
function formatRoundedRange(
  min: number,
  max: number,
  currency: string,
  increment: number | null,
): string {
  return formatPriceRange(roundToIncrement(min, increment), roundToIncrement(max, increment), currency);
}

/**
 * Derives the customer-facing price range for the CURRENT display mode (Slice 12Q
 * follow-up). The server returns `minPrice`/`maxPrice` as the default customer
 * range (incl. VAT, after RUT when the plan enables it) plus the single-point
 * `priceExclVat`/`priceInclVat`/`priceAfterRut`. Because VAT and RUT are linear
 * multipliers on the excl-VAT subtotal and the margin range is applied to that
 * same subtotal, the margin ratio (min/max ÷ default customer base) is identical
 * in every mode — so we can rebuild the range for any VAT/RUT toggle combination.
 *
 * Returns null when the response lacks the single-point fields (older/partial
 * payloads), so the caller can fall back to the server-formatted text.
 */
function computeDisplayRange(
  view: CalculatorResultView,
  showInclVat: boolean,
  showAfterRut: boolean,
): { min: number; max: number } | null {
  const { minPrice, maxPrice, priceInclVat, priceExclVat, priceAfterRut, rutEnabled } = view;
  if (minPrice === null || maxPrice === null) return null;
  if (priceInclVat === null || priceExclVat === null) return null;
  // The base that minPrice/maxPrice were computed from on the server.
  const customerBase = rutEnabled && priceAfterRut !== null ? priceAfterRut : priceInclVat;
  if (customerBase <= 0) return null;
  const ratioMin = minPrice / customerBase;
  const ratioMax = maxPrice / customerBase;
  // Single-point value for the selected VAT/RUT mode.
  let modeBase = showInclVat ? priceInclVat : priceExclVat;
  if (showAfterRut && rutEnabled && priceInclVat > 0 && priceAfterRut !== null) {
    modeBase = modeBase * (priceAfterRut / priceInclVat);
  }
  return { min: modeBase * ratioMin, max: modeBase * ratioMax };
}

/**
 * Visits per FOUR-WEEK period for the home intervals (Slice 12J) — mirrors the
 * engine's HOME_VISITS_PER_FOUR_WEEKS so the UI can derive the per-visit price
 * from the server-authoritative four-week range (per-visit = four-week ÷ visits).
 */
const HOME_VISITS_PER_FOUR_WEEKS_UI: Record<string, number> = {
  weekly: 4,
  biweekly: 2,
  every_four_weeks: 1,
};

interface PlanChip {
  icon: LucideIcon;
  label: string;
}

/**
 * Derives a small set of differentiator chips from a plan's structured fields so
 * the cards make the business rule obvious: plans differ in flexibility, day/time
 * control and staff continuity — never in what gets cleaned.
 */
function planFeatureChips(plan: PublicCleaningPlan): PlanChip[] {
  const chips: PlanChip[] = [];

  // NB: labels intentionally avoid the substrings "Flexibel"/"Fast"/"Prioritet" so a
  // chip can never collide with a by-name plan-card query (the plan names use them).
  const flex = { high: "Hög flexibilitet", medium: "Viss flexibilitet", low: "Bestämda tider" }[
    plan.flexibilityLevel ?? ""
  ];
  if (flex) chips.push({ icon: Gauge, label: flex });

  const staff = { high: "Samma medarbetare", medium: "Oftast samma", low: "Varierande team" }[
    plan.sameStaffPreferenceLevel ?? ""
  ];
  if (staff) chips.push({ icon: UserCheck, label: staff });

  const dayTime = { full: "Du väljer dag & tid", partial: "Önska dag & tid" }[
    plan.customerDayTimeControl ?? ""
  ];
  if (dayTime) chips.push({ icon: CalendarClock, label: dayTime });

  return chips.slice(0, 3);
}

/** A stable signature for a calculate request (used to detect "inputs moved ahead"). */
function requestSignature(request: PublicCalculateRequest | null): string | null {
  return request ? JSON.stringify(request) : null;
}

/**
 * Roving keyboard navigation for a group of card buttons. Arrow keys move focus
 * between the enabled cards; Home/End jump to the ends. Activation stays native
 * (Enter/Space on the focused <button>), so the cards remain fully keyboard-usable.
 */
function handleCardArrowKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
  const NAV_KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
  if (!NAV_KEYS.includes(event.key)) return;

  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-card]"),
  ).filter((b) => !b.disabled);
  if (buttons.length === 0) return;

  event.preventDefault();
  const currentIndex = buttons.findIndex((b) => b === document.activeElement);
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = buttons.length - 1;
  else if (event.key === "ArrowRight" || event.key === "ArrowDown")
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
    nextIndex = currentIndex < 0 ? 0 : (currentIndex - 1 + buttons.length) % buttons.length;

  buttons[nextIndex]?.focus();
}

/** Shared focus-visible ring for the custom card buttons. */
const CARD_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Builds FAQPage JSON-LD structured data (only when there are FAQ entries). */
function buildFaqJsonLd(items: CalculatorFaqItem[]): Record<string, unknown> | undefined {
  if (items.length === 0) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** Numbered step header used down the left calculator column. */
function StepHeader({ step, title, hint }: { step: number; title: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-display text-sm font-semibold text-primary-foreground">
          {step}
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {hint ? <p className="mt-1.5 pl-11 text-sm leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ── top bar (page chrome) ───────────────────────────────────────────────────

function CalculatorTopBar({
  backHref,
  backLabel,
  phone,
  email,
}: {
  backHref: string;
  backLabel: string;
  phone: string | null;
  email: string | null;
}) {
  const isInternal = backHref.startsWith("/");
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-lg">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label={`${PUBLIC_SITE_NAME} hem`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">{PUBLIC_SITE_NAME}</span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
            {phone ? (
              <a href={`tel:${phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 hover:text-foreground">
                <Phone className="h-4 w-4" /> {phone}
              </a>
            ) : null}
            {email ? (
              <a href={`mailto:${email}`} className="flex items-center gap-1.5 hover:text-foreground">
                <Mail className="h-4 w-4" /> {email}
              </a>
            ) : null}
          </div>
          {isInternal ? (
            <Button asChild variant="ghost" size="sm">
              <Link to={backHref}>
                <ArrowLeft className="h-4 w-4" /> {backLabel}
              </Link>
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm">
              <a href={backHref}>
                <ArrowLeft className="h-4 w-4" /> {backLabel}
              </a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

// ── service selector ──────────────────────────────────────────────────────────

function ServiceCard({
  service,
  selectedKey,
  onSelect,
}: {
  service: PublicService;
  selectedKey: string;
  onSelect: (serviceKey: string) => void;
}) {
  const Icon = serviceIcon(service.serviceKey);
  const isSelected = service.serviceKey === selectedKey && service.enabled;
  const disabled = !service.enabled;
  const hint = pricingModelHint(service.pricingModel);
  return (
    <button
      type="button"
      data-card
      disabled={disabled}
      aria-pressed={isSelected}
      onClick={() => !disabled && onSelect(service.serviceKey)}
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition-all active:scale-[0.99]",
        CARD_FOCUS,
        isSelected
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/40 hover:shadow-md",
        disabled && "cursor-not-allowed opacity-60 hover:border-border hover:shadow-none",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
            isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        {service.comingSoon ? (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
            Snart
          </span>
        ) : isSelected ? (
          <CheckCircle2 className="h-5 w-5 text-primary" />
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{service.displayName}</p>
        {service.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {service.description}
          </p>
        ) : null}
      </div>
      {hint ? (
        <p className="mt-auto flex items-center gap-1.5 border-t border-border/60 pt-2.5 text-[11px] font-medium text-muted-foreground">
          <Calculator className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
          {hint}
        </p>
      ) : null}
    </button>
  );
}

/**
 * The public service selector. Shows the first 3 public-ready services (ordered
 * by the admin-configured sort order) and reveals any remaining services behind
 * a "Visa fler" toggle. With 3 or fewer services no toggle is shown. If the
 * already-selected service lives in the hidden group, the group starts expanded
 * so the selection stays visible.
 */
function ServiceSelector({
  services,
  selectedKey,
  onSelect,
}: {
  services: PublicService[];
  selectedKey: string;
  onSelect: (serviceKey: string) => void;
}) {
  const { featured, more, hasMore } = useMemo(() => partitionFeaturedServices(services), [services]);
  const selectedInMore = useMemo(
    () => more.some((s) => s.serviceKey === selectedKey),
    [more, selectedKey],
  );
  const [expanded, setExpanded] = useState<boolean>(selectedInMore);
  useEffect(() => {
    if (selectedInMore) setExpanded(true);
  }, [selectedInMore]);

  return (
    <div role="group" aria-label={FALLBACK.serviceHeading} onKeyDown={handleCardArrowKeys} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((service) => (
          <ServiceCard key={service.serviceKey} service={service} selectedKey={selectedKey} onSelect={onSelect} />
        ))}
      </div>

      {hasMore ? (
        <>
          {expanded ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((service) => (
                <ServiceCard key={service.serviceKey} service={service} selectedKey={selectedKey} onSelect={onSelect} />
              ))}
            </div>
          ) : null}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary",
                CARD_FOCUS,
              )}
            >
              {expanded ? FALLBACK.serviceShowLess : `${FALLBACK.serviceShowMore} (${more.length})`}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── selected-service summary (collapsed state) ───────────────────────────────

/**
 * The compact row shown AFTER a service is chosen: the service grid collapses to
 * this summary, freeing vertical space for the assignment form. "Ändra tjänst"
 * re-expands the grid so the visitor can switch at any time.
 */
function SelectedServiceSummary({
  service,
  onChange,
}: {
  service: PublicService;
  onChange: () => void;
}) {
  const Icon = serviceIcon(service.serviceKey);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{service.displayName}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {FALLBACK.serviceSelectedBadge}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{FALLBACK.serviceSelectedNote}</p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onChange} className="shrink-0">
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {FALLBACK.serviceChangeLabel}
      </Button>
    </div>
  );
}

// ── generic service preview (GPM-5d-1) ───────────────────────────────────────

/**
 * A READ-ONLY preview card for a generic service the client cannot fully render YET
 * (an incomplete or not-yet-supported generic model — GPM-9). It is deliberately a
 * plain <div> — NOT a button — and exposes no selection affordance whatsoever: no
 * onClick/onSelect, no tabIndex, no aria-pressed/aria-selected. So it can never
 * trigger selection, calculate, submit or plan choice. It shows ONLY public-safe
 * presentation fields (displayName, description, and a neutral unit hint derived from
 * `unitLabel`) — never price internals, margins, plans, or readiness details. It
 * lives exclusively in the separate preview section below, never the clickable
 * selector grid, so a non-selectable card cannot read as a broken/disabled service.
 */
function GenericServicePreviewCard({ service }: { service: PublicService }) {
  const Icon = serviceIcon(service.serviceKey);
  const unitHint = service.unitLabel
    ? `${FALLBACK.previewPricePerUnitPrefix} ${service.unitLabel}`
    : null;
  return (
    <div
      data-preview-card
      aria-label={service.displayName}
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-left"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground/70">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
          {FALLBACK.previewBadge}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{service.displayName}</p>
        {service.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {service.description}
          </p>
        ) : null}
      </div>
      {unitHint ? (
        <p className="mt-auto flex items-center gap-1.5 border-t border-border/60 pt-2.5 text-[11px] font-medium text-muted-foreground">
          <Calculator className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
          {unitHint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The read-only "Förhandsvisning av nya tjänster" section. Renders the given
 * already-filtered NOT-yet-renderable generic services (incomplete/not-yet-supported
 * models — GPM-9) as preview cards in a grid that mirrors the selector layout, but is
 * visually separated (dashed cards) and fully non-interactive. Renders nothing when
 * there are no preview services, so it has zero footprint for legacy-only configs and
 * for configs whose only generic services are already selectable.
 */
function GenericServicePreviewSection({ services }: { services: PublicService[] }) {
  if (services.length === 0) return null;
  return (
    <section className="space-y-4" aria-label={FALLBACK.previewHeading}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{FALLBACK.previewHeading}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{FALLBACK.previewHint}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <GenericServicePreviewCard key={service.serviceKey} service={service} />
        ))}
      </div>
    </section>
  );
}

/**
 * Span class for a field inside a grouped 2-column details card (Slice 12G). Most
 * inputs are compact (one column) so e.g. Boyta / Antal badrum sit side by side;
 * wide inputs (multiselect chips, boolean toggle rows, free-text such as Adress)
 * span the full width for comfortable tap targets and clear helper text.
 */
function fieldSpanClass(inputType: string): string {
  const fullWidth = inputType === "multiselect" || inputType === "boolean" || inputType === "text";
  // `col-span-full` works in BOTH the 2-column and 3-column group grids (Slice 12H).
  return fullWidth ? "col-span-full" : "";
}

/** True for the postal-code question — Postnummer is collected once, in the contact step. */
function isPostalCodeQuestion(question: PublicQuestion): boolean {
  return question.inputType === "postal_code" || question.questionKey === "postal_code";
}

/**
 * Per-service field groups for the Step-2 details (Slice 12G). Grouping the
 * questions into a few titled cards keeps the form calm and scannable instead of
 * one cramped grid. Keys are matched to the service's live questions; anything a
 * group doesn't claim falls into a trailing untitled group, so a service WITHOUT
 * a config (e.g. move-out) simply renders every field in one card — unchanged
 * behaviour. Postnummer is filtered out earlier (collected once in the contact
 * step) so it never appears here.
 */
interface FieldGroupDef {
  id: string;
  title: string;
  keys: readonly string[];
  /** Max columns on large screens (default 2). The office data row uses 3. */
  columns?: 2 | 3;
}
const SERVICE_FIELD_GROUPS: Record<string, readonly FieldGroupDef[]> = {
  home_cleaning: [
    // Box 1 (Slice 12I): Boyta + Intervall as one clean group; bathrooms retired.
    { id: "home_basics", title: "Bostad", keys: ["sqm", "frequency"] },
    { id: "home_extras", title: "Tillägg och önskemål", keys: ["property_type", "addons", "has_pets", "address"] },
  ],
  office_cleaning: [
    // One clean, symmetrical data row (Slice 12H): 3 cols on wide desktop, so the
    // five numeric/select fields align as 3 + 2 instead of a cramped uneven grid.
    {
      id: "office_data",
      title: "Lokal och städning",
      keys: ["sqm", "frequency", "toilets", "workstations", "meeting_rooms"],
      columns: 3,
    },
    {
      id: "office_extras",
      title: "Tillägg och önskemål",
      keys: [
        "has_kitchen",
        "supervision_cleaning",
        "supervision_visits_per_week",
        "supervision_minutes_per_visit",
        "consumables_quote",
        "other_addons_quote",
        "after_hours_cleaning",
      ],
    },
  ],
};

/** A resolved group ready to render: a title (or null) + its visible questions. */
interface RenderedFieldGroup {
  id: string;
  title: string | null;
  questions: PublicQuestion[];
  /** Max columns on large screens (default 2). */
  columns: 2 | 3;
}

/** Tailwind grid classes for a group's column count (Slice 12H). */
function groupGridClass(columns: 2 | 3): string {
  return columns === 3
    ? "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    : "grid grid-cols-1 gap-4 sm:grid-cols-2";
}

/**
 * Partitions a service's visible questions into ordered, titled groups. Questions
 * are placed in their group (group order, then the config's key order); anything
 * not claimed by a group is appended to a trailing untitled group so a field is
 * NEVER dropped. A service with no group config gets a single untitled group with
 * all its questions (move-out keeps its current single-card layout).
 */
function groupServiceQuestions(
  serviceKey: string,
  questions: readonly PublicQuestion[],
): RenderedFieldGroup[] {
  const defs = SERVICE_FIELD_GROUPS[serviceKey];
  if (!defs) {
    return questions.length > 0 ? [{ id: "all", title: null, questions: [...questions], columns: 2 }] : [];
  }
  const byKey = new Map(questions.map((q) => [q.questionKey, q]));
  const used = new Set<string>();
  const groups: RenderedFieldGroup[] = [];
  for (const def of defs) {
    const groupQuestions: PublicQuestion[] = [];
    for (const key of def.keys) {
      const q = byKey.get(key);
      if (q) {
        groupQuestions.push(q);
        used.add(key);
      }
    }
    if (groupQuestions.length > 0) {
      groups.push({ id: def.id, title: def.title, questions: groupQuestions, columns: def.columns ?? 2 });
    }
  }
  const leftovers = questions.filter((q) => !used.has(q.questionKey));
  if (leftovers.length > 0) {
    groups.push({ id: "other", title: null, questions: leftovers, columns: 2 });
  }
  return groups;
}

// ── dynamic question field ──────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  errorMessage,
  onChange,
}: {
  question: PublicQuestion;
  value: AnswerValue;
  errorMessage: string | null;
  onChange: (key: string, value: AnswerValue) => void;
}) {
  const id = `calc-field-${question.questionKey}`;
  const errorId = `${id}-error`;
  const validation = asRecord(question.validation);
  const min = typeof validation.min === "number" ? validation.min : undefined;
  const max = typeof validation.max === "number" ? validation.max : undefined;
  const step = typeof validation.step === "number" ? validation.step : undefined;
  const options = parseOptions(question.options);

  // Slice 12H: helper/subtitle text under inputs is suppressed for a calm, premium
  // form — clean labels only (info icons/tooltips are a documented future slice).
  const describedBy = errorMessage ? errorId : undefined;
  const invalid = errorMessage ? true : undefined;
  const displayLabel = FIELD_LABEL_OVERRIDES[question.questionKey] ?? question.label;

  const labelNode = (
    <Label htmlFor={id} className="text-sm font-medium text-foreground">
      {displayLabel}
      {question.required ? (
        <span className="ml-0.5 text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </Label>
  );
  const help = null;
  const error = errorMessage ? (
    <p id={errorId} className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{errorMessage}</span>
    </p>
  ) : null;

  // Boolean → a self-contained toggle row.
  if (question.inputType === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
        <div className="min-w-0">
          {labelNode}
          {help}
          {error}
        </div>
        <Switch
          id={id}
          checked={value === true}
          aria-describedby={describedBy}
          onCheckedChange={(checked) => onChange(question.questionKey, checked)}
        />
      </div>
    );
  }

  // Multiselect → wrapping toggle chips.
  if (question.inputType === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {labelNode}
        {help}
        <div className="flex flex-wrap gap-2" role="group" aria-label={question.label} aria-describedby={describedBy}>
          {options.map((option) => {
            const isOn = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isOn}
                onClick={() => {
                  const next = isOn
                    ? selected.filter((v) => v !== option.value)
                    : [...selected, option.value];
                  onChange(question.questionKey, next);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  CARD_FOCUS,
                  isOn
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
              >
                {isOn ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
        {error}
      </div>
    );
  }

  // Select → shadcn Select.
  if (question.inputType === "select") {
    return (
      <div className="space-y-2">
        {labelNode}
        {help}
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(question.questionKey, v)}
        >
          <SelectTrigger id={id} aria-describedby={describedBy} aria-invalid={invalid} aria-required={question.required || undefined}>
            <SelectValue placeholder="Välj…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error}
      </div>
    );
  }

  // Number / integer.
  if (question.inputType === "number" || question.inputType === "integer") {
    return (
      <div className="space-y-2">
        {labelNode}
        {help}
        <Input
          id={id}
          type="number"
          inputMode={question.inputType === "integer" ? "numeric" : "decimal"}
          min={min}
          max={max}
          step={step ?? (question.inputType === "integer" ? 1 : undefined)}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-required={question.required || undefined}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(question.questionKey, undefined);
              return;
            }
            const n = Number(raw);
            onChange(question.questionKey, Number.isFinite(n) ? n : undefined);
          }}
        />
        {error}
      </div>
    );
  }

  // Date.
  if (question.inputType === "date") {
    return (
      <div className="space-y-2">
        {labelNode}
        {help}
        <Input
          id={id}
          type="date"
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-required={question.required || undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(question.questionKey, e.target.value || undefined)}
        />
        {error}
      </div>
    );
  }

  // postal_code + any text-like fallback.
  const pattern = typeof validation.pattern === "string" ? validation.pattern : undefined;
  return (
    <div className="space-y-2">
      {labelNode}
      {help}
      <Input
        id={id}
        type="text"
        inputMode={question.inputType === "postal_code" ? "numeric" : "text"}
        pattern={pattern}
        placeholder={question.inputType === "postal_code" ? "123 45" : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-required={question.required || undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(question.questionKey, e.target.value || undefined)}
      />
      {error}
    </div>
  );
}

// ── add-on field (generic add-on engine — GPM-10-C) ─────────────────────────

/**
 * Renders ONE public, selectable generic add-on (`calculator_addons`) and reports
 * the customer's choice back under `answers.addonSelections` (handled by the page).
 * Supports the two runtime-priced input kinds only — `boolean` (a toggle) and
 * `quantity` (a clamped number). The displayed value falls back to the add-on's
 * configured default when the customer has not chosen one, so the on-screen state
 * always matches what the SERVER prices for an untouched add-on (the resolver
 * applies the same default). The server stays authoritative for pricing/clamping;
 * this is presentation + selection only, with NO serviceKey-specific logic.
 */
function AddonField({
  addon,
  value,
  onChange,
}: {
  addon: PublicAddon;
  value: AddonSelectionValue | undefined;
  onChange: (addonKey: string, value: AddonSelectionValue | undefined) => void;
}) {
  const id = `calc-addon-${addon.addonKey}`;
  const label = addon.publicLabel.trim() !== "" ? addon.publicLabel : addon.addonKey;
  const requiredMark = addon.required ? (
    <span className="ml-0.5 text-destructive" aria-hidden="true">
      *
    </span>
  ) : null;

  // Boolean → a self-contained toggle row (mirrors the boolean QuestionField).
  if (addon.inputType === "boolean") {
    const checked = typeof value === "boolean" ? value : addon.booleanDefault;
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
        <div className="min-w-0">
          <Label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
            {requiredMark}
          </Label>
          {addon.description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{addon.description}</p>
          ) : null}
        </div>
        <Switch
          id={id}
          checked={checked}
          aria-label={label}
          onCheckedChange={(next) => onChange(addon.addonKey, next)}
        />
      </div>
    );
  }

  // Quantity → a labelled number input clamped to the configured bounds. Clearing
  // the field reverts to the configured default (the server applies it anyway).
  const quantity = typeof value === "number" ? value : addon.quantityDefault;
  const min = addon.quantityMin;
  const max = addon.quantityMax ?? undefined;
  const step = addon.quantityStep > 0 ? addon.quantityStep : 1;
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/60 px-4 py-3">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {requiredMark}
      </Label>
      {addon.description ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{addon.description}</p>
      ) : null}
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={String(quantity)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(addon.addonKey, undefined);
            return;
          }
          const n = Number(raw);
          onChange(addon.addonKey, Number.isFinite(n) ? n : undefined);
        }}
      />
    </div>
  );
}

// ── plan selector ──────────────────────────────────────────────────────────

function PlanSelector({
  plans,
  selectedKey,
  currency,
  onSelect,
  hideRates = false,
}: {
  plans: PublicCleaningPlan[];
  selectedKey: string | null;
  currency: string;
  onSelect: (planKey: string) => void;
  /** Hide per-plan hourly prices (Slice 12J time-adjustment mode: plans share one rate). */
  hideRates?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={FALLBACK.planHeading}
      onKeyDown={handleCardArrowKeys}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {plans.map((plan) => {
        const isSelected = plan.planKey === selectedKey;
        const chips = planFeatureChips(plan);
        return (
          <button
            key={plan.planKey}
            type="button"
            data-card
            aria-pressed={isSelected}
            onClick={() => onSelect(plan.planKey)}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-2xl border p-4 text-left transition-all active:scale-[0.99]",
              CARD_FOCUS,
              isSelected
                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                : "border-border bg-card hover:border-primary/40 hover:shadow-md",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {isSelected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">{plan.name}</span>
              </div>
              {plan.isDefault ? (
                <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">
                  Populär
                </span>
              ) : null}
            </div>
            {hideRates ? null : (
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-xl text-foreground">{formatRate(plan.hourlyRate, currency)}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">timpris</span>
              </div>
            )}
            {plan.description ? (
              <span className="text-xs leading-relaxed text-muted-foreground">{plan.description}</span>
            ) : null}
            {chips.length > 0 ? (
              <ul className="mt-auto flex flex-col gap-1.5 pt-1">
                {chips.map((chip) => (
                  <li key={chip.label} className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
                    <chip.icon className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                    {chip.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Informational notice shown when a plan is required but none could be loaded. */
function PlansUnavailableNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-2xl border border-dashed border-warning/50 bg-warning/5 p-4 text-sm text-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="leading-relaxed text-muted-foreground">{FALLBACK.plansUnavailable}</p>
    </div>
  );
}

// ── contact form (submit / write path) ─────────────────────────────────

/** The four public contact fields. Only email is required. */
interface ContactDetails {
  name: string;
  email: string;
  phone: string;
  postalCode: string;
}

/**
 * The contact + submit form (the WRITE path), rendered as guided steps 4 and 5 of
 * the left column. Only email is required; the page validates it before any network
 * call and blocks duplicate submits while a request is in flight. The client price
 * is never collected — the server recomputes authoritatively from the inputs.
 */
function ContactForm({
  stepContact,
  stepSubmit,
  submitLabel,
  contact,
  emailError,
  postalError,
  errorMessage,
  isSubmitting,
  honeypot,
  onHoneypotChange,
  onChange,
  onSubmit,
}: {
  stepContact: number;
  stepSubmit: number;
  submitLabel: string;
  contact: ContactDetails;
  emailError: string | null;
  postalError: string | null;
  errorMessage: string | null;
  isSubmitting: boolean;
  honeypot: string;
  onHoneypotChange: (value: string) => void;
  onChange: (field: keyof ContactDetails, value: string) => void;
  onSubmit: () => void;
}) {
  const emailErrorId = "calc-contact-email-error";
  const postalErrorId = "calc-contact-postal-error";
  return (
    <form
      className="space-y-8"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/*
        Honeypot: a hidden, non-tabbable, autocomplete-off field a real visitor
        never sees or fills. A bot that fills every input populates it, and the
        server then writes nothing. Hidden from layout AND assistive tech.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" style={{ left: "-9999px" }}>
        <label htmlFor="calc-contact-company-website">Lämna detta fält tomt</label>
        <input
          id="calc-contact-company-website"
          type="text"
          name="company_website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => onHoneypotChange(e.target.value)}
        />
      </div>

      {/* Step — contact details */}
      <section className="space-y-4">
        <StepHeader step={stepContact} title={FALLBACK.contactHeading} hint={FALLBACK.contactBody} />
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="calc-contact-name" className="text-sm font-medium text-foreground">
              {FALLBACK.nameLabel}
            </Label>
            <Input
              id="calc-contact-name"
              autoComplete="name"
              value={contact.name}
              onChange={(e) => onChange("name", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="calc-contact-email" className="text-sm font-medium text-foreground">
              {FALLBACK.emailLabel}
              <span className="ml-0.5 text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="calc-contact-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-required="true"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? emailErrorId : undefined}
              value={contact.email}
              onChange={(e) => onChange("email", e.target.value)}
            />
            {emailError ? (
              <p
                id={emailErrorId}
                role="alert"
                className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{emailError}</span>
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="calc-contact-phone" className="text-sm font-medium text-foreground">
              {FALLBACK.phoneLabel}
            </Label>
            <Input
              id="calc-contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={contact.phone}
              onChange={(e) => onChange("phone", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="calc-contact-postal" className="text-sm font-medium text-foreground">
              {FALLBACK.postalLabel}
              <span className="ml-0.5 text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="calc-contact-postal"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="123 45"
              required
              aria-required="true"
              aria-invalid={postalError ? true : undefined}
              aria-describedby={postalError ? postalErrorId : undefined}
              value={contact.postalCode}
              onChange={(e) => onChange("postalCode", e.target.value)}
            />
            {postalError ? (
              <p
                id={postalErrorId}
                role="alert"
                className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{postalError}</span>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Step — send */}
      <section className="space-y-4">
        <StepHeader step={stepSubmit} title={FALLBACK.submitHeading} />
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span>{FALLBACK.submitReassurance}</span>
          </p>

          {errorMessage ? (
            <div
              role="alert"
              aria-live="polite"
              className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="mt-4 w-full"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting ? FALLBACK.submitting : submitLabel}
          </Button>
          <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
            {FALLBACK.submitDisclaimer}
          </p>
        </div>
      </section>
    </form>
  );
}

/** Formats an ISO date (yyyy-mm-dd) as a Swedish long date; falls back to raw. */
function formatValidUntil(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The quote-created confirmation shown after a successful submit. Renders ONLY
 * public-safe fields from the server response (price/range, estimated hours,
 * plan, validity, next-step copy, and the stable legacy reference) — never a
 * uuid, raw status token, pricing rule, or calculation trace.
 */
function QuoteConfirmation({
  data,
  currency,
  priceLabel,
}: {
  data: PublicSubmitResponse;
  currency: string;
  priceLabel: string;
}) {
  const nextStep = data.nextStep?.confirmationText?.trim();
  const priceText = data.displayText.trim();
  const hasDetails =
    priceText !== "" ||
    data.estimatedHours !== null ||
    data.selectedPlan !== null ||
    data.validUntil !== null ||
    data.quoteRequestLegacyId !== null;
  return (
    <section role="status" aria-live="polite" className="rounded-2xl border border-success/40 bg-success/5 p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl text-foreground">{FALLBACK.confirmTitle}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{FALLBACK.confirmBody}</p>
        </div>
      </div>

      {hasDetails ? (
        <dl className="mt-5 space-y-2 border-t border-success/30 pt-4 text-sm">
          {priceText ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{priceLabel}</dt>
              <dd className="font-semibold text-foreground [overflow-wrap:anywhere]">{priceText}</dd>
            </div>
          ) : null}
          {data.estimatedHours !== null ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{FALLBACK.hoursLabel}</dt>
              <dd className="font-semibold text-foreground">{data.estimatedHours} h</dd>
            </div>
          ) : null}
          {data.selectedPlan ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{FALLBACK.confirmPlanLabel}</dt>
              <dd className="font-semibold text-foreground">
                {data.selectedPlan.name} · {formatRate(data.selectedPlan.hourlyRate, currency)}
              </dd>
            </div>
          ) : null}
          {data.validUntil ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{FALLBACK.confirmValidUntil}</dt>
              <dd className="font-semibold text-foreground">{formatValidUntil(data.validUntil)}</dd>
            </div>
          ) : null}
          {data.quoteRequestLegacyId ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{FALLBACK.confirmReference}</dt>
              <dd className="font-mono text-xs text-foreground/80">{data.quoteRequestLegacyId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>{nextStep && nextStep !== "" ? nextStep : FALLBACK.confirmNextStep}</p>
      </div>
    </section>
  );
}

// ── result panel ──────────────────────────────────────────────────────────────

interface ResultCopy {
  eyebrow: string;
  preliminaryBadge: string;
  preliminaryNote: string;
  placeholder: string;
  finePrint: string;
  calculatingText: string;
  updatingText: string;
  errorText: string;
  hoursLabel: string;
  /** Suffix shown after the price for a recurring estimate (e.g. "/mån"); null otherwise. */
  periodSuffix: string | null;
}

function ResultPanel({
  view,
  currency,
  copy,
  footer,
  manualReviewMessage,
  fourWeekVisits = null,
  secondaryLabel,
  showPlanRate = true,
}: {
  view: CalculatorResultView;
  currency: string;
  copy: ResultCopy;
  footer?: React.ReactNode;
  /** When set, overrides the body with a manual-review notice (no price shown). */
  manualReviewMessage?: string | null;
  /** Visits per four-week period (home recurring) — splits the total into a per-visit main figure; null = single figure. */
  fourWeekVisits?: number | null;
  /** Label for the four-week secondary "Summering" row (shown only when fourWeekVisits is set). */
  secondaryLabel?: string;
  /** Whether to show the plan's hourly rate (hidden in time-adjustment plan mode). */
  showPlanRate?: boolean;
}) {
  const { status } = view;
  // Slice 12Q follow-up — customer display controls now drive the ACTUAL displayed
  // price mode (not just detail visibility). VAT toggle defaults on; the RUT toggle
  // only renders for RUT-qualified plans (view.rutEnabled). Toggling either mode
  // re-derives the top price + summary rows from the engine's price components.
  const [showInclVat, setShowInclVat] = useState<boolean>(true);
  const [showAfterRut, setShowAfterRut] = useState<boolean>(true);
  const hasNumber = view.displayText.trim() !== "";
  const showNumber =
    !manualReviewMessage && (status === "valid" || (status === "updating" && hasNumber));

  // Toggle-aware, rounded display prices used EVERYWHERE in the card (top figure,
  // "Pris per tillfälle", "Pris per fyra veckors period") so no two rows disagree.
  const increment = view.roundingIncrement;
  const visits = fourWeekVisits && fourWeekVisits > 0 ? fourWeekVisits : null;
  const modeRange = computeDisplayRange(view, showInclVat, showAfterRut);
  let mainText: string = view.displayText;
  let secondaryRow: { label: string; text: string } | null = null;
  if (modeRange) {
    if (visits) {
      mainText = formatRoundedRange(modeRange.min / visits, modeRange.max / visits, currency, increment);
      secondaryRow = {
        label: secondaryLabel ?? FALLBACK.fourWeekLabel,
        text: formatRoundedRange(modeRange.min, modeRange.max, currency, increment),
      };
    } else {
      mainText = formatRoundedRange(modeRange.min, modeRange.max, currency, increment);
    }
  } else if (visits && view.minPrice !== null && view.maxPrice !== null) {
    // Fallback (older payload without VAT/RUT point fields): keep the four-week
    // split from the server's customer-facing range, still rounded consistently.
    mainText = formatRoundedRange(view.minPrice / visits, view.maxPrice / visits, currency, increment);
    secondaryRow = {
      label: secondaryLabel ?? FALLBACK.fourWeekLabel,
      text: formatRoundedRange(view.minPrice, view.maxPrice, currency, increment),
    };
  }

  // Dynamic status line replacing the old preliminary note. Reflects the active
  // VAT/RUT display mode; RUT text only appears for RUT-qualified plans.
  const vatStatus = showInclVat ? "Inkl. moms" : "Exkl. moms";
  const rutStatus = view.rutEnabled ? (showAfterRut ? "Efter RUT-avdrag" : "Före RUT-avdrag") : null;
  const statusLine = rutStatus ? `${rutStatus} · ${vatStatus}` : vatStatus;

  let body: React.ReactNode;
  if (manualReviewMessage) {
    // Custom interval (or any manual-review case): never show a misleading price.
    body = (
      <div className="flex items-start gap-2.5 text-sidebar-foreground/80">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" aria-hidden="true" />
        <p className="text-sm leading-relaxed">{manualReviewMessage}</p>
      </div>
    );
  } else if (status === "idle") {
    body = (
      <div className="flex items-start gap-2.5 text-sidebar-foreground/80">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" aria-hidden="true" />
        <p className="text-sm leading-relaxed">{copy.placeholder}</p>
      </div>
    );
  } else if (status === "error") {
    body = <p className="text-sm leading-relaxed text-sidebar-foreground/80">{copy.errorText}</p>;
  } else if (status === "updating" && !hasNumber) {
    body = (
      <div className="flex items-center gap-2 text-sidebar-foreground/80">
        <Loader2 className="h-4 w-4 animate-spin text-sidebar-primary" aria-hidden="true" />
        <span className="text-sm">{copy.calculatingText}</span>
      </div>
    );
  } else if (showNumber) {
    body = (
      <div className="space-y-4">
        <div>
          <p
            className={cn(
              "font-display text-4xl leading-tight tracking-tight text-sidebar-accent-foreground transition-opacity [overflow-wrap:anywhere] sm:text-5xl",
              status === "updating" && "opacity-60",
            )}
          >
            {mainText}
            {copy.periodSuffix ? (
              <span className="ml-1 align-baseline text-2xl font-medium text-sidebar-foreground/70 sm:text-3xl">
                {copy.periodSuffix}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 text-xs font-medium leading-relaxed text-sidebar-foreground/70" data-testid="result-status-line">{statusLine}</p>
        </div>

        {/* Slice 12Q Phase B — "Summering" section (no four-week explanatory note). */}
        <div className="space-y-3 border-t border-sidebar-border/60 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-sidebar-primary">{FALLBACK.summaryHeading}</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-sidebar-foreground/80">{FALLBACK.perVisitSummaryLabel}</dt>
              <dd className="font-semibold text-sidebar-accent-foreground">{mainText}</dd>
            </div>
            {secondaryRow ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-sidebar-foreground/80">{secondaryRow.label}</dt>
                <dd className="font-semibold text-sidebar-accent-foreground">{secondaryRow.text}</dd>
              </div>
            ) : null}
            {view.estimatedHours !== null ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-sidebar-foreground/80">
                  <Clock className="h-4 w-4 text-sidebar-primary" aria-hidden="true" />
                  {copy.hoursLabel}
                </dt>
                <dd className="font-semibold text-sidebar-accent-foreground">{formatVisitTime(view.estimatedHours)}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-sidebar-foreground/80">
                <Sparkles className="h-4 w-4 text-sidebar-primary" aria-hidden="true" />
                {FALLBACK.cleaningSetupLabel}
              </dt>
              <dd className="font-semibold text-sidebar-accent-foreground">
                {view.planName ?? FALLBACK.cleaningSetupValue}
                {view.planName && showPlanRate && view.planRate !== null ? ` · ${formatRate(view.planRate, currency)}` : ""}
              </dd>
            </div>
          </dl>

          {/* Display controls (customer toggles). RUT only for RUT-qualified plans. */}
          <div className="space-y-2 border-t border-sidebar-border/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="calc-toggle-vat" className="text-sm font-normal text-sidebar-foreground/90">
                {FALLBACK.showInclVatToggle}
              </Label>
              <Switch id="calc-toggle-vat" checked={showInclVat} onCheckedChange={setShowInclVat} aria-label={FALLBACK.showInclVatToggle} />
            </div>
            {view.rutEnabled ? (
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="calc-toggle-rut" className="text-sm font-normal text-sidebar-foreground/90">
                  {FALLBACK.showAfterRutToggle}
                </Label>
                <Switch id="calc-toggle-rut" checked={showAfterRut} onCheckedChange={setShowAfterRut} aria-label={FALLBACK.showAfterRutToggle} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  } else if (status === "invalid") {
    body = (
      <ul className="space-y-2">
        {(view.issues.length > 0 ? view.issues : [copy.placeholder]).map((issue, index) => (
          <li key={`${issue}-${index}`} className="flex items-start gap-2.5 text-sm text-sidebar-foreground/80">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" aria-hidden="true" />
            <span className="leading-relaxed">{issue}</span>
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <div className="flex items-center gap-2 text-sidebar-foreground/80">
        <Loader2 className="h-4 w-4 animate-spin text-sidebar-primary" aria-hidden="true" />
        <span className="text-sm">{copy.calculatingText}</span>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-sidebar-border bg-sidebar p-6 text-sidebar-foreground shadow-xl sm:p-8">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-sidebar-primary/15 blur-3xl" aria-hidden="true" />
      <div className="grain absolute inset-0 opacity-30" aria-hidden="true" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-sidebar-primary">{copy.eyebrow}</p>
          <span className="inline-flex items-center gap-1 rounded-full border border-sidebar-border/70 bg-sidebar-accent/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/80">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {copy.preliminaryBadge}
          </span>
        </div>
        <div
          className="mt-4 min-h-[7rem]"
          aria-live="polite"
          aria-atomic="true"
          aria-busy={!manualReviewMessage && status === "updating"}
        >
          {body}
        </div>
        {!manualReviewMessage && status === "updating" && hasNumber ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-sidebar-foreground/70" aria-hidden="true">
            <RefreshCw className="h-3 w-3 animate-spin" /> {copy.updatingText}
          </div>
        ) : null}
        <div className="mt-6 flex items-start gap-2 border-t border-sidebar-border/70 pt-4 text-xs leading-relaxed text-sidebar-foreground/70">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>{copy.finePrint}</p>
        </div>
        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>
    </div>
  );
}

// ── help (FAQ + trust + contact) — launched from inside the result card ───────────────────────────────────────────────

function HelpDialog({
  faqItems,
  contactHeading,
  contactText,
  phone,
  email,
}: {
  faqItems: CalculatorFaqItem[];
  contactHeading: string | null;
  contactText: string | null;
  phone: string | null;
  email: string | null;
}) {
  const hasContact = Boolean(contactHeading || contactText || phone || email);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/40 px-3 py-2 text-xs font-semibold text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" /> {FALLBACK.helpButton}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{FALLBACK.faqHeading}</DialogTitle>
          <DialogDescription>{FALLBACK.helpDialogIntro}</DialogDescription>
        </DialogHeader>

        {faqItems.length > 0 ? (
          <Accordion type="single" collapsible className="-mt-1">
            {faqItems.map((item, index) => (
              <AccordionItem
                key={item.question}
                value={`faq-${index}`}
                className={index === faqItems.length - 1 ? "border-b-0" : undefined}
              >
                <AccordionTrigger className="rounded-md text-left text-sm font-medium text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : null}

        <section aria-label={FALLBACK.trustHeading} className="rounded-2xl border border-border bg-muted/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">{FALLBACK.trustHeading}</h3>
          <ul className="mt-3 space-y-3">
            {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {hasContact ? (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">{contactHeading ?? FALLBACK.helpContactHeading}</h3>
            {contactText ? (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{contactText}</p>
            ) : null}
            {phone || email ? (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {phone ? (
                  <a href={`tel:${phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <Phone className="h-4 w-4" /> {phone}
                  </a>
                ) : null}
                {email ? (
                  <a href={`mailto:${email}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <Mail className="h-4 w-4" /> {email}
                  </a>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── right-column visual (media-managed, public read; clean fallback) ──────────

/**
 * Media Center slot key for the calculator's right-side visual. A service shows its
 * OWN slot (`public_calculator_<serviceKey>_visual`) only. When that slot is not
 * linked the media card is hidden completely (Slice 12H) — there is no shared
 * legacy fallback, so the dark price box always stands alone with no empty/pale
 * visual container behind or below it.
 */
function serviceVisualSlot(serviceKey: string): string {
  return `public_calculator_${serviceKey}_visual`;
}

/**
 * True on desktop (lg ≥ 1024px) viewports. The right-column atmosphere video only
 * mounts + autoplays on desktop; mobile keeps the layout clean (no autoplay, no
 * heavy payload). jsdom/SSR-safe: defaults to false when matchMedia is missing.
 */
function useIsDesktopViewport(): boolean {
  const query = "(min-width: 1024px)";
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const sync = () => setIsDesktop(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => mql.removeEventListener?.("change", sync);
  }, []);
  return isDesktop;
}

/**
 * True when the visitor asked the OS to reduce motion. The atmosphere video then
 * never autoplays/animates (a calm static card is shown instead). jsdom/SSR-safe.
 */
function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const sync = () => setReduced(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => mql.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

/**
 * The atmosphere visual shown BELOW the price/info box (Slice 12F). On desktop
 * with a linked Media-Center asset it renders a self-contained card: an `<img>`
 * for image slots, or a play-ONCE `<video>` for video slots that FADES IN on load,
 * plays once (no loop), then FADES OUT on `ended` (the same node stays mounted, so
 * the layout never shifts). With no linked media — or on mobile, or when the
 * visitor prefers reduced motion (video only) — it renders nothing, so the price
 * box stands alone cleanly. The slot is resolved from the SERVICE-SPECIFIC key
 * `public_calculator_<serviceKey>_visual` (public, anon-readable via the
 * website-imagery layer) — never hardcoded, and with no legacy fallback (12H).
 */
function CalculatorVisual({ serviceKey }: { serviceKey: string }) {
  const isDesktop = useIsDesktopViewport();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState<boolean>(false);
  const [ended, setEnded] = useState<boolean>(false);
  const { data } = useQuery({
    queryKey: ["public-calculator", "right-visual", PUBLIC_CALCULATOR_SLUG],
    queryFn: () => getWebsiteImagesForPage(PUBLIC_CALCULATOR_SLUG),
    staleTime: 5 * 60 * 1000,
  });
  // Service-specific slot only — no legacy fallback. With nothing linked the card
  // is hidden so the dark price box stands alone (Slice 12H).
  const media: WebsiteImage | null = data?.get(serviceVisualSlot(serviceKey)) ?? null;
  const isVideo = media?.mediaType === "video";
  const showVideo = Boolean(media && isVideo && isDesktop && !prefersReducedMotion);

  // Reset the fade whenever the resolved media changes (e.g. switching service):
  // a freshly shown video fades IN (opacity-0 → opacity-100) and plays once again
  // instead of staying faded out from a previous clip. Initial paint is opacity-0.
  const mediaUrl = media?.url ?? null;
  useEffect(() => {
    setEnded(false);
    setVisible(showVideo);
  }, [mediaUrl, showVideo]);

  // Desktop-only atmosphere; no media → the price box stands alone (clean).
  if (!isDesktop || !media) return null;

  return (
    <div
      data-testid="calculator-right-visual"
      className="relative hidden aspect-[16/10] overflow-hidden rounded-[1.75rem] border border-sidebar-border/30 shadow-lg lg:block"
      aria-hidden="true"
    >
      {/* calm gradient base (also the resting state after a video fades out) */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent/55 via-background to-secondary/70" />
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-sidebar-primary/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-12 h-60 w-60 rounded-full bg-primary/10 blur-3xl" />

      {media && !isVideo ? (
        <img src={media.url} alt={media.alt} className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {showVideo && media ? (
        <video
          data-testid="calculator-right-video"
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-out",
            visible && !ended ? "opacity-100" : "opacity-0",
          )}
          src={media.url}
          autoPlay
          muted
          playsInline
          preload="metadata"
          onEnded={() => setEnded(true)}
        />
      ) : null}

      {/* soft wash + grain for depth (never a heavy dark overlay) */}
      <div className="absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-background/10" />
      <div className="grain absolute inset-0 opacity-30" />
    </div>
  );
}

// ── full-screen status states (loading / error / not found) ──────────────────

function CenteredState({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-5 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-7 w-7" />
      </span>
      <h1 className="mt-5 font-display text-2xl text-foreground">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** Hints previewed on the calm coming-soon (dark) state. */
const COMING_SOON_HINTS: { icon: LucideIcon; label: string }[] = [
  { icon: Calculator, label: "Räkna ut ett pris på under en minut" },
  { icon: ShieldCheck, label: "Helt utan bindning" },
  { icon: Send, label: "Skicka din förfrågan direkt" },
];

/** A polished "coming soon" landing state used while the calculator is dark. */
function ComingSoonState({
  title,
  backHref,
  backLabel,
}: {
  title: string;
  backHref: string;
  backLabel: string;
}) {
  const isInternal = backHref.startsWith("/");
  return (
    <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col items-center justify-center px-5 py-16 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-foreground shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {FALLBACK.disabledBadge}
      </span>
      <span className="mt-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Lock className="h-8 w-8" />
      </span>
      <h1 className="mt-6 font-display text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{FALLBACK.disabledBody}</p>

      <ul className="mt-8 flex w-full max-w-md flex-col gap-2.5">
        {COMING_SOON_HINTS.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground shadow-sm"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {label}
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <Button asChild size="lg">
          {isInternal ? (
            <Link to={backHref}>
              <ArrowLeft className="h-4 w-4" /> {backLabel}
            </Link>
          ) : (
            <a href={backHref}>
              <ArrowLeft className="h-4 w-4" /> {backLabel}
            </a>
          )}
        </Button>
      </div>
    </main>
  );
}

// ── main page ──────────────────────────────────────────────────────────────

const EMPTY_ANSWERS: CalculatorAnswers = {};
const EMPTY_ADDON_SELECTIONS: AddonSelections = {};
const EMPTY_CONTACT: ContactDetails = { name: "", email: "", phone: "", postalCode: "" };

const RESULT_COPY: ResultCopy = {
  eyebrow: FALLBACK.resultEyebrow,
  preliminaryBadge: FALLBACK.preliminaryBadge,
  preliminaryNote: FALLBACK.preliminaryNote,
  placeholder: FALLBACK.resultPlaceholder,
  finePrint: FALLBACK.resultFinePrint,
  calculatingText: FALLBACK.calculating,
  updatingText: FALLBACK.updating,
  errorText: FALLBACK.calcError,
  hoursLabel: FALLBACK.hoursLabel,
  periodSuffix: null,
};

/**
 * Recurring (monthly) variant of the result copy — used for office cleaning so the
 * estimate reads as a MONTHLY price ("Uppskattat månadspris" + a "/mån" suffix on
 * the figure), never a one-off total.
 */
const RESULT_COPY_RECURRING: ResultCopy = {
  ...RESULT_COPY,
  eyebrow: FALLBACK.resultEyebrowRecurring,
  periodSuffix: FALLBACK.pricePeriodMonthlySuffix,
};

/**
 * Home cleaning FOUR-WEEK period variant (Slice 12I) — used once an interval is
 * chosen so the figure reads as a four-week period total (with the
 * "Priset avser en fyraveckorsperiod." note), never a single visit. No "/mån"
 * suffix: the period is communicated by the eyebrow + note, not a month suffix.
 */
const RESULT_COPY_HOME_PERIOD: ResultCopy = {
  ...RESULT_COPY,
  eyebrow: FALLBACK.resultEyebrowPerVisit,
};

/**
 * Temporary QA build marker — Slice 12H visual verification (REMOVE after sign-off).
 *
 * Renders a small, fixed, non-interactive badge in the bottom-right corner of the
 * public calculator so we can confirm — directly from the live origin — that the
 * browser is loading THIS freshly built bundle and not a stale/cached one. The
 * build timestamp is baked at build time (see vite.config.ts → __BUILD_TIMESTAMP__),
 * so every fresh deploy shows a new value.
 *
 * Visibility: shown on dev, the canonical preview, and any other rork.live /
 * localhost origin; hidden on the production custom domain (stadportalen.se).
 * Purely diagnostic — `pointer-events-none` means it never intercepts taps, and it
 * changes no layout, pricing, submit, or rate-limit/honeypot behaviour.
 */
const QA_BUILD_MARKER = "calculator-ux-12H";

function QaBuildBadge() {
  const host =
    typeof window !== "undefined" ? window.location.host.toLowerCase() : "";
  // Never surface the marker on the production custom domain.
  if (host.endsWith("stadportalen.se")) return null;

  const rawStamp =
    typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "";
  const buildStamp = rawStamp
    ? `${rawStamp.replace("T", " ").replace(/\..*$/, "")} UTC`
    : "okänd tid";
  const buildMode = typeof __BUILD_MODE__ === "string" ? __BUILD_MODE__ : "";

  return (
    <div
      data-testid="qa-build-badge"
      aria-hidden="true"
      className="pointer-events-none fixed bottom-3 right-3 z-[9999] max-w-[80vw] select-none rounded-lg border border-amber-400/70 bg-amber-50/95 px-3 py-1.5 text-left font-mono text-[11px] leading-tight text-amber-900 shadow-lg ring-1 ring-amber-500/20 backdrop-blur-sm"
    >
      <span className="block font-semibold tracking-tight">
        QA BUILD: {QA_BUILD_MARKER}
      </span>
      <span className="mt-0.5 block font-normal text-amber-800/80">
        {buildStamp}
        {buildMode ? ` · ${buildMode}` : ""}
      </span>
    </div>
  );
}

export default function PriceCalculator() {
  const configQuery = usePublicCalculatorConfig(PUBLIC_CALCULATOR_SLUG);
  const result = configQuery.data;
  const configData: PublicConfigResponse | null =
    result?.status === "ok" ? result.config : null;

  const [serviceKey, setServiceKey] = useState<string>("");
  const [serviceListExpanded, setServiceListExpanded] = useState<boolean>(true);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [answersByService, setAnswersByService] = useState<Record<string, CalculatorAnswers>>({});
  // Generic add-on selections, kept per service (GPM-10-C) so switching services
  // never leaks one service's tillval into another. Merged into the wire `answers`
  // under `answers.addonSelections` only at the request boundary (see calcRequest).
  const [addonSelectionsByService, setAddonSelectionsByService] = useState<
    Record<string, AddonSelections>
  >({});
  const [contact, setContact] = useState<ContactDetails>(EMPTY_CONTACT);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [postalError, setPostalError] = useState<string | null>(null);
  // Hidden honeypot: a real person never fills it (it is visually hidden,
  // non-tabbable, autocomplete-off). A bot that fills every field populates it,
  // and the server then writes nothing. It is only sent when non-empty.
  const [honeypot, setHoneypot] = useState<string>("");
  const submitMutation = useSubmitPublicQuote(PUBLIC_CALCULATOR_SLUG);

  /** Choosing a service collapses the grid into a compact summary (Ändra tjänst re-opens it). */
  const handleSelectService = useCallback((nextKey: string) => {
    setServiceKey(nextKey);
    setServiceListExpanded(false);
  }, []);

  const answers = useMemo(
    () => answersByService[serviceKey] ?? EMPTY_ANSWERS,
    [answersByService, serviceKey],
  );

  const setAnswer = useCallback(
    (key: string, value: AnswerValue) => {
      setAnswersByService((prev) => {
        const current = prev[serviceKey] ?? {};
        const next: CalculatorAnswers = { ...current };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return { ...prev, [serviceKey]: next };
      });
    },
    [serviceKey],
  );

  const addonSelections = useMemo(
    () => addonSelectionsByService[serviceKey] ?? EMPTY_ADDON_SELECTIONS,
    [addonSelectionsByService, serviceKey],
  );

  const setAddonSelection = useCallback(
    (addonKey: string, value: AddonSelectionValue | undefined) => {
      setAddonSelectionsByService((prev) => {
        const current = prev[serviceKey] ?? {};
        const next: AddonSelections = { ...current };
        if (value === undefined) delete next[addonKey];
        else next[addonKey] = value;
        return { ...prev, [serviceKey]: next };
      });
    },
    [serviceKey],
  );

  const content = useMemo(() => parseCalculatorContent(configData?.content), [configData]);
  const faq = useMemo(() => parseCalculatorFaq(configData?.faq), [configData]);
  // The company's own FAQ wins; otherwise a curated set keeps the page helpful.
  const faqToShow = faq.length > 0 ? faq : DEFAULT_FAQ;

  const selectedService = useMemo(
    () => (configData?.services ?? []).find((s) => s.serviceKey === serviceKey && s.enabled) ?? null,
    [configData, serviceKey],
  );
  const questions = useMemo(
    () =>
      selectedService
        ? [...selectedService.questions]
            // Postnummer is collected once, canonically, in the contact step —
            // never render a duplicate postal-code question in the details grid.
            .filter((q) => !isPostalCodeQuestion(q))
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [selectedService],
  );
  // Slice 12M: a service shows the plan step when plans are ENABLED (office now
  // enables plans) OR the legacy requiresCleaningPlan flag is set. Home keeps both
  // true and move-out keeps both false, so only office changes behaviour here.
  const requiresPlan = Boolean(
    selectedService && (selectedService.plansEnabled || selectedService.requiresCleaningPlan),
  );
  // The selected service's active, public-visible generic add-ons (already filtered
  // + parsed server-side; the client only sorts them). Empty for services without
  // add-ons, so the tillval step + payload are a no-op there (Home unchanged).
  const activeAddons = useMemo(
    () => (selectedService ? [...selectedService.addons].sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [selectedService],
  );
  const settings: PublicSettings | undefined = configData?.settings;
  const currency = settings?.currency ?? "SEK";

  // Office cleaning is RECURRING: the engine returns a monthly estimate, so the
  // result panel + confirmation label the figure "per month" (never a one-off price).
  const isRecurring = isRecurringPricingModel(selectedService?.pricingModel);

  // Home cleaning becomes a FOUR-WEEK period estimate once an interval is chosen
  // (Slice 12I). Before that, the per-visit estimate is shown (no period total).
  const homeFrequency =
    typeof answers.frequency === "string" ? answers.frequency.trim().toLowerCase() : "";
  const isHomeFourWeek =
    selectedService?.pricingModel === "home_cleaning_recommended_hours" &&
    HOME_FOUR_WEEK_INTERVALS.includes(homeFrequency);
  const resultCopy = isRecurring
    ? RESULT_COPY_RECURRING
    : isHomeFourWeek
      ? RESULT_COPY_HOME_PERIOD
      : RESULT_COPY;

  // Office "custom interval": a valid choice with NO automatic price. We suppress
  // the price, show a manual-review message, and still let the visitor submit
  // (the server persists a priceless, manual-review quote).
  const officeCustomInterval =
    isRecurring && answers.frequency === OFFICE_CUSTOM_INTERVAL_VALUE;

  // Supervision (tillsynsstädning) detail fields are shown only when the toggle is
  // on. The generic field system has no conditional-render support yet, so this is
  // handled here in the public office flow (documented limitation).
  const supervisionOn = answers[SUPERVISION_TOGGLE_KEY] === true;
  const visibleQuestions = useMemo(
    () =>
      questions.filter(
        (q) => !SUPERVISION_DETAIL_KEYS.includes(q.questionKey) || supervisionOn,
      ),
    [questions, supervisionOn],
  );

  // Group the visible details fields into calm, scannable cards (Slice 12G). A
  // service with no group config (e.g. move-out) renders a single untitled card.
  const fieldGroups = useMemo(
    () =>
      selectedService ? groupServiceQuestions(selectedService.serviceKey, visibleQuestions) : [],
    [selectedService, visibleQuestions],
  );

  const sortedPlans = useMemo(
    () =>
      [...(configData?.cleaningPlans ?? [])]
        .filter((plan) => !selectedService || plan.serviceKey === selectedService.serviceKey)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [configData, selectedService],
  );
  const planAvailable = !requiresPlan || sortedPlans.length > 0;

  useEffect(() => {
    if (!selectedService || !requiresPlan) {
      setPlanKey(null);
      return;
    }
    const defaultPlan =
      sortedPlans.find((p) => p.planKey === selectedService.defaultPlanKey) ??
      sortedPlans.find((p) => p.isDefault) ??
      sortedPlans[0] ??
      null;
    setPlanKey((prev) => (prev && sortedPlans.some((p) => p.planKey === prev) ? prev : defaultPlan?.planKey ?? null));
  }, [selectedService, sortedPlans, requiresPlan]);

  // Ready to price once the universal driver (sqm > 0) and a plan (when required +
  // available) exist. A custom interval is never auto-priced (manual review).
  const sqm = toNumber(answers.sqm);
  const isReady =
    Boolean(configData?.enabled) &&
    selectedService !== null &&
    !officeCustomInterval &&
    sqm !== null &&
    sqm > 0 &&
    planAvailable &&
    (!requiresPlan || Boolean(planKey));

  const calcRequest = useMemo<PublicCalculateRequest | null>(() => {
    if (!selectedService) return null;
    return {
      serviceKey: selectedService.serviceKey,
      answers,
      cleaningPlanKey: requiresPlan ? planKey : null,
      // Included only when the customer has chosen at least one add-on, so a service
      // without add-ons sends the exact established payload (and the signature/
      // debounce below still re-runs calculate whenever a selection changes).
      ...(Object.keys(addonSelections).length > 0 ? { addonSelections } : {}),
    };
  }, [selectedService, answers, planKey, requiresPlan, addonSelections]);

  // Debounce the request so rapid typing makes one trailing calculate call.
  const pendingRequest = isReady ? calcRequest : null;
  const debouncedRequest = useDebouncedValue(pendingRequest, 350);

  const calcQuery = usePublicPriceCalculation({
    slug: PUBLIC_CALCULATOR_SLUG,
    request: debouncedRequest,
    enabled: debouncedRequest !== null,
  });

  const calc = calcQuery.data;

  // STALE GUARD: when the live inputs have moved ahead of the request that produced
  // `calc`, the figure is stale and must not be shown as final (see resolveResultView).
  const inputsSettled = requestSignature(pendingRequest) === requestSignature(debouncedRequest);

  const resultView = useMemo(
    () =>
      resolveResultView({
        isReady,
        isFetching: calcQuery.isFetching,
        isError: calcQuery.isError,
        inputsSettled,
        calc,
      }),
    [isReady, calcQuery.isFetching, calcQuery.isError, inputsSettled, calc],
  );

  // Home four-week period (Slice 12J, Part E): the MAIN figure is the price PER
  // VISIT; the four-week period total is the secondary "Summering" row. The split
  // (and toggle-aware mode + rounding) is computed inside ResultPanel from the
  // server-authoritative range, so the visits multiplier is all it needs here.
  const homeVisitsPerFourWeeks = HOME_VISITS_PER_FOUR_WEEKS_UI[homeFrequency] ?? 1;
  const fourWeekVisits = isHomeFourWeek ? homeVisitsPerFourWeeks : null;

  // When plans share ONE base hourly rate, public plan cards must NOT compare
  // hourly rates: in price_adjustment_per_plan the selected plan changes a
  // configured price adjustment, and in time_adjustment_per_visit it changes the
  // per-visit TIME (never the rate). Only hourly_rate_by_plan shows per-plan rates.
  // GPM-9 — a generic `sqm_fixed` service prices per m² (its plan carries a
  // price-per-m², not an hourly rate), so its plan cards + result panel must never
  // surface a misleading "kr/h" figure.
  const planRatesUniform =
    selectedService?.pricingModel === "sqm_fixed" ||
    selectedService?.planPricingModel === "price_adjustment_per_plan" ||
    selectedService?.planPricingModel === "time_adjustment_per_visit";

  // Field-level issues (only when the server has settled on an invalid result).
  const fieldIssues = useMemo(() => {
    const map: Record<string, string> = {};
    if (resultView.status === "invalid" && calc && !calc.valid) {
      for (const issue of calc.issues) {
        if (issue.field && !map[issue.field]) map[issue.field] = issue.message;
      }
    }
    return map;
  }, [resultView.status, calc]);

  // ── submit (write) wiring ──────────────────────────────────────────────────
  // A resolved submit is a "success" only when the server both accepted it
  // (available) and validated it (valid). available:false (dark) / valid:false
  // (rejected) resolve too — they write NOTHING and surface a friendly message.
  const submitData = submitMutation.data;
  const submitSucceeded = Boolean(submitData && submitData.available && submitData.valid);

  const updateContact = useCallback((field: keyof ContactDetails, value: string) => {
    setContact((prev) => ({ ...prev, [field]: value }));
    if (field === "email") setEmailError(null);
    if (field === "postalCode") setPostalError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (submitMutation.isPending) return; // duplicate-submit guard (CTA also disabled)
    if (!selectedService) return;

    const trimmedEmail = contact.email.trim();
    const trimmedPostal = contact.postalCode.trim();
    let hasError = false;
    if (!isLikelyEmail(trimmedEmail)) {
      setEmailError(FALLBACK.emailInvalid);
      hasError = true;
    } else {
      setEmailError(null);
    }
    // Postnummer is the single mandatory location field (canonical postalCode).
    if (trimmedPostal === "") {
      setPostalError(FALLBACK.postalInvalid);
      hasError = true;
    } else {
      setPostalError(null);
    }
    if (hasError) return; // never call the server before the required fields are valid

    // The client price is NEVER sent — the server recomputes authoritatively.
    const request: PublicSubmitRequest = {
      serviceKey: selectedService.serviceKey,
      answers,
      cleaningPlanKey: requiresPlan ? planKey : null,
      // Same add-on selections the live price used — the server recomputes the
      // identical add-on effects from them (omitted when none were chosen).
      ...(Object.keys(addonSelections).length > 0 ? { addonSelections } : {}),
      contact: {
        name: contact.name.trim() || null,
        email: trimmedEmail,
        phone: contact.phone.trim() || null,
        postalCode: contact.postalCode.trim() || null,
      },
      sourceUrl: typeof window !== "undefined" ? window.location.href : null,
      // Empty for a human → omitted from the wire payload by the client.
      honeypot,
    };
    submitMutation.mutate(request);
  }, [submitMutation, selectedService, contact, answers, planKey, honeypot, requiresPlan, addonSelections]);

  const submitErrorMessage = useMemo<string | null>(() => {
    if (submitMutation.isError) {
      const msg = submitMutation.error instanceof Error ? submitMutation.error.message.trim() : "";
      return msg !== "" ? msg : FALLBACK.submitError;
    }
    if (submitData && !submitSucceeded) {
      if (!submitData.available) return FALLBACK.submitUnavailable;
      const issueMsg = submitData.issues
        .map((i) => i.message)
        .filter((m) => m.trim() !== "")
        .join(" ");
      return issueMsg !== "" ? issueMsg : FALLBACK.submitInvalid;
    }
    return null;
  }, [submitMutation.isError, submitMutation.error, submitData, submitSucceeded]);

  const pageTitle = content.pageTitle ?? FALLBACK.pageTitle;
  const backHref = content.backToWebsite?.href ?? "/";
  const backLabel = content.backToWebsite?.label ?? FALLBACK.backLabel;
  const phone = content.contactHelp?.phone ?? null;
  const email = content.contactHelp?.email ?? null;

  /** Builds the SEO head for a given indexability + structured-data decision. */
  const renderSeo = (options: { noindex: boolean; withFaq: boolean }) => (
    <Seo
      title={`${FALLBACK.pageTitle} | ${PUBLIC_SITE_NAME}`}
      description="Räkna ut ett uppskattat pris för hemstädning och flyttstädning på under en minut. Få ditt prisintervall direkt — utan bindning."
      canonicalPath={`/${PUBLIC_CALCULATOR_SLUG}`}
      noindex={options.noindex}
      jsonLd={options.withFaq ? buildFaqJsonLd(faqToShow) : undefined}
    />
  );

  // ── loading / error / not-found gates (all noindex — transient states) ────
  if (configQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <QaBuildBadge />
        {renderSeo({ noindex: true, withFaq: false })}
        <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="sr-only">Laddar…</span>
        </div>
      </div>
    );
  }

  if (!result || result.status === "error" || result.status === "not_found") {
    const notFound = result?.status === "not_found";
    return (
      <div className="min-h-screen bg-background">
        <QaBuildBadge />
        {renderSeo({ noindex: true, withFaq: false })}
        <CalculatorTopBar backHref="/" backLabel={FALLBACK.backLabel} phone={null} email={null} />
        <CenteredState
          icon={notFound ? Info : AlertTriangle}
          title={notFound ? "Priskalkylatorn hittades inte" : "Något gick fel"}
          body={
            notFound
              ? "Vi kunde inte hitta priskalkylatorn. Kontrollera länken eller gå tillbaka till webbplatsen."
              : "Vi kunde inte ladda priskalkylatorn just nu. Försök igen om en liten stund."
          }
        >
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" /> {FALLBACK.backLabel}
            </Link>
          </Button>
        </CenteredState>
      </div>
    );
  }

  const config = result.config;

  // ── disabled / dark state (live MVP default) — noindex while dark ────────
  if (!config.enabled) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <QaBuildBadge />
        {renderSeo({ noindex: true, withFaq: false })}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-accent/30 via-background to-background" />
        <div className="grain pointer-events-none absolute inset-0 -z-10 opacity-40" />
        <CalculatorTopBar backHref={backHref} backLabel={backLabel} phone={phone} email={email} />
        <ComingSoonState title={content.pageTitle ?? FALLBACK.disabledTitle} backHref={backHref} backLabel={backLabel} />
      </div>
    );
  }

  const sortedServices = [...(config.services ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  // GPM-9 — split services into the clickable selector grid vs the read-only
  // "on the way" preview. A fully client-renderable generic `sqm_fixed` service is now
  // SELECTABLE (it calculates through the same server-authoritative path as every other
  // service); only a generic service the client cannot render yet (incomplete or
  // not-yet-supported model) stays in the read-only preview, so it can never read as a
  // broken card. Legacy/Home (no generic model) keep the normal selectable flow,
  // unchanged. See classifyPublicService.
  const selectableServices = sortedServices.filter(
    (service) => classifyPublicService(service) === "selectable",
  );
  const previewServices = sortedServices.filter(
    (service) => classifyPublicService(service) === "preview",
  );

  // ── enabled but no services (degenerate/partial config) — graceful + noindex ─
  if (sortedServices.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <QaBuildBadge />
        {renderSeo({ noindex: true, withFaq: false })}
        <CalculatorTopBar backHref={backHref} backLabel={backLabel} phone={phone} email={email} />
        <CenteredState icon={Info} title={FALLBACK.noServicesTitle} body={FALLBACK.noServicesBody}>
          <Button asChild variant="outline">
            {backHref.startsWith("/") ? (
              <Link to={backHref}>
                <ArrowLeft className="h-4 w-4" /> {backLabel}
              </Link>
            ) : (
              <a href={backHref}>
                <ArrowLeft className="h-4 w-4" /> {backLabel}
              </a>
            )}
          </Button>
        </CenteredState>
      </div>
    );
  }

  // Dynamic step numbers: the plan step (3) and the tillval step each exist only
  // when the selected service needs them, shifting the contact/send numbers. A
  // service without a plan AND without add-ons keeps the exact current numbering.
  const planStepShown = Boolean(selectedService && requiresPlan);
  const addonsStepShown = Boolean(selectedService && activeAddons.length > 0);
  const addonsStepNumber = planStepShown ? 4 : 3;
  const stepContact = 3 + (planStepShown ? 1 : 0) + (addonsStepShown ? 1 : 0);
  const stepSubmit = stepContact + 1;

  // ── active calculator (indexable; FAQ structured data when present) ──────
  return (
    <div className="relative min-h-screen bg-background">
      <QaBuildBadge />
      {renderSeo({ noindex: false, withFaq: faqToShow.length > 0 })}

      {/* Atmospheric background */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-accent/30 via-background to-background" />
      <div className="grain pointer-events-none absolute inset-0 -z-10 opacity-40" />
      <div className="pointer-events-none absolute -left-40 top-24 -z-10 h-96 w-96 rounded-full bg-success/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-64 -z-10 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />

      <CalculatorTopBar backHref={backHref} backLabel={backLabel} phone={phone} email={email} />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Hero / intro */}
        <div className="max-w-2xl animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> {config.company?.name ?? PUBLIC_SITE_NAME}
          </span>
          <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            {pageTitle}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
            {content.pageSubtitle ?? FALLBACK.pageSubtitle}
          </p>
          {content.introText ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{content.introText}</p>
          ) : null}

          <ul className="mt-6 flex flex-wrap gap-2.5">
            {HERO_BADGES.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm"
              >
                <Icon className="h-3.5 w-3.5 text-success" aria-hidden="true" /> {label}
              </li>
            ))}
          </ul>
        </div>

        {/* Split layout — the right column (price + media) only appears AFTER a
            service is chosen (Slice 12G). Until then the left column spans the
            full width so the service picker never sits beside an empty track. */}
        <div
          className={cn(
            "mt-10 grid grid-cols-1 gap-8 lg:mt-14 lg:gap-12",
            selectedService ? "lg:grid-cols-[1.05fr_0.95fr]" : "lg:grid-cols-1",
          )}
        >
          {/* Left — guided steps */}
          <div className="space-y-8 animate-fade-up [animation-delay:80ms]">
            <section className="space-y-4">
              <StepHeader step={1} title={FALLBACK.serviceHeading} hint={FALLBACK.serviceHint} />
              {serviceListExpanded || !selectedService ? (
                <ServiceSelector
                  services={selectableServices}
                  selectedKey={serviceKey}
                  onSelect={handleSelectService}
                />
              ) : (
                <SelectedServiceSummary
                  service={selectedService}
                  onChange={() => setServiceListExpanded(true)}
                />
              )}
            </section>

            {selectedService ? (
              <section className="space-y-4">
                <StepHeader step={2} title={FALLBACK.detailsHeading} hint={FALLBACK.detailsHint} />
                {fieldGroups.length > 0 ? (
                  <div className="space-y-5">
                    {fieldGroups.map((group) => (
                      <div
                        key={group.id}
                        className="rounded-2xl border border-border bg-card p-5 shadow-sm"
                      >
                        {group.title ? (
                          <h3 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
                            {group.title}
                          </h3>
                        ) : null}
                        <div className={groupGridClass(group.columns)}>
                          {group.questions.map((question) => (
                            <div key={question.questionKey} className={fieldSpanClass(question.inputType)}>
                              <QuestionField
                                question={question}
                                value={answers[question.questionKey]}
                                errorMessage={fieldIssues[question.questionKey] ?? null}
                                onChange={setAnswer}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {officeCustomInterval ? (
                      <div
                        role="status"
                        className="flex items-start gap-2.5 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed text-foreground"
                      >
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <div>
                          <p className="font-semibold text-foreground">{FALLBACK.customIntervalTitle}</p>
                          <p className="mt-1 text-muted-foreground">{FALLBACK.customIntervalBody}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <p className="text-sm text-muted-foreground">{FALLBACK.noFieldsBody}</p>
                  </div>
                )}
              </section>
            ) : null}

            {selectedService && requiresPlan ? (
              <section className="space-y-4">
                <StepHeader step={3} title={FALLBACK.planHeading} hint={FALLBACK.planHint} />
                {sortedPlans.length > 0 ? (
                  <PlanSelector
                    plans={sortedPlans}
                    selectedKey={planKey}
                    currency={currency}
                    onSelect={setPlanKey}
                    hideRates={planRatesUniform}
                  />
                ) : (
                  <PlansUnavailableNotice />
                )}
              </section>
            ) : null}

            {/* Tillval (generic add-ons) — GPM-10-C. Shown only when the selected
                service has active, public-visible add-ons; selections feed the live
                price + submit through the existing server-authoritative path. Hidden
                entirely (zero footprint) for services without add-ons. */}
            {selectedService && addonsStepShown ? (
              <section className="space-y-4" aria-label={FALLBACK.addonsHeading}>
                <StepHeader step={addonsStepNumber} title={FALLBACK.addonsHeading} hint={FALLBACK.addonsHint} />
                <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
                  {activeAddons.map((addon) => (
                    <AddonField
                      key={addon.addonKey}
                      addon={addon}
                      value={addonSelections[addon.addonKey]}
                      onChange={setAddonSelection}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {/* Steps 4 & 5 (contact + send) — replaced by the confirmation on success. */}
            {selectedService ? (
              submitSucceeded && submitData ? (
                <QuoteConfirmation
                  data={submitData}
                  currency={currency}
                  priceLabel={isRecurring ? FALLBACK.confirmPriceLabelRecurring : FALLBACK.confirmPriceLabel}
                />
              ) : (
                <ContactForm
                  stepContact={stepContact}
                  stepSubmit={stepSubmit}
                  submitLabel={content.ctaLabels.submitQuote ?? FALLBACK.submitCta}
                  contact={contact}
                  emailError={emailError}
                  postalError={postalError}
                  errorMessage={submitErrorMessage}
                  isSubmitting={submitMutation.isPending}
                  honeypot={honeypot}
                  onHoneypotChange={setHoneypot}
                  onChange={updateContact}
                  onSubmit={handleSubmit}
                />
              )
            ) : null}

            {/* GPM-9 — read-only preview of generic services the client cannot render
                yet (incomplete/not-yet-supported models), kept in a clearly separated
                section so non-selectable cards never sit in the clickable selector
                grid. Ready generic sqm_fixed services are selectable above instead. */}
            <GenericServicePreviewSection services={previewServices} />
          </div>

          {/* Right — appears ONLY after a service is selected (Slice 12G): the
              single sticky price/info box, with the SERVICE-SPECIFIC atmosphere
              visual (play-once video / image) placed BELOW it — never behind it. */}
          {selectedService ? (
            <div className="animate-fade-up [animation-delay:160ms]">
              <div className="space-y-5 lg:sticky lg:top-24">
                <ResultPanel
                  view={resultView}
                  currency={currency}
                  copy={resultCopy}
                  fourWeekVisits={fourWeekVisits}
                  secondaryLabel={FALLBACK.fourWeekLabel}
                  showPlanRate={!planRatesUniform}
                  manualReviewMessage={officeCustomInterval ? FALLBACK.customIntervalResultNote : null}
                  footer={
                    <HelpDialog
                      faqItems={faqToShow}
                      contactHeading={content.contactHelp?.heading ?? null}
                      contactText={content.contactHelp?.text ?? null}
                      phone={phone}
                      email={email}
                    />
                  }
                />
                <CalculatorVisual serviceKey={selectedService.serviceKey} />
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
