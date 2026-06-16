import type { ReactNode } from "react";
import {
  ChevronDown,
  Clock,
  FileQuestion,
  Hash,
  Package,
  Plus,
  Ruler,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Pill, type Tone } from "@/components/calculator/configBadges";
import { resolveGenericPricingModel } from "@/lib/calculator/v2/pricingModel";

/**
 * GPM-UX-ADMIN-3 — shared presentation primitives for the service-first Admin
 * Calculator. Pure layout/presentation only: these components never touch pricing,
 * readiness, public visibility, or any save path. They reorganise the existing
 * editors into a "select a service, then expand its sections" workbench.
 */

/**
 * A clean default icon per generic pricing model. No serviceKey is hardcoded —
 * the icon is derived from the (normalised) pricing model so any future service
 * on the same model gets a consistent glyph. Falls back to a neutral sparkle.
 *
 * NOTE (Media Center): there is no service↔asset/icon relation in the calculator
 * config today, so a chosen image cannot be stored per service yet. These
 * model-based defaults are the safe interim; wiring a real Media Center icon is a
 * separate follow-up (no schema change is attempted here).
 */
export function serviceIconForModel(pricingModel: string): LucideIcon {
  switch (resolveGenericPricingModel(pricingModel)) {
    case "hourly_by_area":
      return Clock;
    case "sqm_fixed":
      return Ruler;
    case "unit_based":
      return Hash;
    case "fixed_package":
      return Package;
    case "manual_quote":
      return FileQuestion;
    default:
      return Sparkles;
  }
}

/** A status badge rendered on a service nav card. */
export interface ServiceNavBadge {
  key: string;
  label: string;
  tone: Tone;
}

/**
 * One service tile in the service-first navigation row: an icon above the service
 * name, optional compact status badges, and a clear selected/hover state. Equal
 * height across the row via the grid's `auto-rows-fr`.
 */
export function ServiceNavCard({
  name,
  icon: Icon,
  selected,
  badges,
  onSelect,
  testId,
}: {
  name: string;
  icon: LucideIcon;
  selected: boolean;
  badges?: ServiceNavBadge[];
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "group flex h-full min-h-[104px] flex-col items-center justify-start gap-2 rounded-2xl border p-3 text-center transition-all",
        selected
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
          selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-balance">{name}</span>
      {badges && badges.length > 0 ? (
        <span className="mt-auto flex flex-wrap items-center justify-center gap-1">
          {badges.map((badge) => (
            <Pill key={badge.key} tone={badge.tone}>
              {badge.label}
            </Pill>
          ))}
        </span>
      ) : null}
    </button>
  );
}

/** The dashed "+ Add service" tile that opens the existing add-service flow. */
export function AddServiceNavCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="calculator-add-service-card"
      className="group flex h-full min-h-[104px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-center text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Plus className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-[13px] font-semibold leading-tight">Add service</span>
    </button>
  );
}

/**
 * The dense, responsive grid that holds the service nav cards (+ Add service).
 * Targets four tiles per row on wide screens, wrapping naturally on smaller ones
 * with no horizontal scroll.
 */
export function ServiceNavGrid({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid auto-rows-fr grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {children}
    </div>
  );
}

/**
 * A multi-open accordion section: collapsed by default, opens/closes independently
 * of its siblings (the parent owns an open-id Set, so several can be open at once).
 * Compact header keeps vertical rhythm tight.
 */
export function CalculatorSection({
  id,
  title,
  icon: Icon,
  subtitle,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  subtitle?: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `calc-section-panel-${id}`;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={`calc-section-${id}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`calc-section-toggle-${id}`}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            open ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {typeof count === "number" ? (
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </span>
          {subtitle ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-border p-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A dense, responsive card grid used inside the service sections. `min` controls
 * how many cards fit per row on wide screens (the higher the column count, the
 * denser the layout). All variants collapse to a single column on small screens.
 */
export function ResponsiveCardGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  /** Max columns on the widest breakpoint (2–5). */
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  const colClass: Record<number, string> = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  };
  return (
    <div className={cn("grid auto-rows-fr grid-cols-1 gap-2.5", colClass[columns], className)}>{children}</div>
  );
}

/**
 * GPM-UX-ADMIN-6 — one shared visual treatment for every Pricing subsection
 * (Base calculation, square-meter adjustment, time rules, margins, customer
 * add-ons). Previously these blocks used a near-invisible `bg-muted/20` panel so
 * they were hard to scan; this gives each a consistent, lightly tinted card with
 * a clear boundary, matching the separation the square-meter adjustment block
 * already had. Pure styling — no behaviour attached.
 */
export const pricingSubsectionClass = "rounded-xl border border-primary/20 bg-primary/5 p-3";

/**
 * A small "Show inactive / archived items" toggle used by the section editors to
 * keep inactive items hidden by default while still letting an admin reveal them.
 * Renders nothing when there is nothing hidden to reveal.
 */
export function InactiveItemsToggle({
  hiddenCount,
  open,
  onToggle,
  showLabel,
  hideLabel,
  testId,
}: {
  hiddenCount: number;
  open: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  testId?: string;
}) {
  if (hiddenCount === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
    >
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      {open ? hideLabel : showLabel}
      <Pill tone="muted">{hiddenCount}</Pill>
    </button>
  );
}
