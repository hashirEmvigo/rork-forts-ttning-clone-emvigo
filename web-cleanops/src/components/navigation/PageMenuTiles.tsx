import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Page-level tile menu (Slice 11D — Page-Level Menu Tile Design Standard).
 *
 * The shared, reusable implementation of the platform menu standard documented
 * in docs/design/navigation-and-menu-design-standard.md §1–2. The Customer Card
 * menu is the visual reference: each item is an equal-size tile with an icon
 * above a short, two-line-clamped label, a clear selected/hover state, and
 * optional status dots / count badges in stable positions.
 *
 * It is built on Radix Tabs (`TabsList` + `TabsTrigger`) so it drives the
 * existing `<TabsContent>` blocks unchanged — the tile `value` is the tab id,
 * the accessible name stays the label (the icon is `aria-hidden`), so selecting
 * and deep-linking behave exactly as before. Tiles are fixed-width and wrap
 * (flex-wrap), so a long custom label can never stretch a tile or force
 * horizontal scroll.
 */

/** One tile in a {@link PageMenuTiles} menu. */
export interface PageMenuTileItem {
  /** Stable tab value — must match the corresponding `<TabsContent value>`. */
  value: string;
  /** Short visible label (clamped to two lines; full text via the tile tooltip). */
  label: string;
  /** Icon rendered in the square above the label (consistent size/stroke). */
  icon: LucideIcon;
  /** Optional count badge (top-right). Rendered when `> 0` or `showZeroCount`. */
  count?: number;
  /** Render a neutral zero badge for placeholder modules (e.g. "My Request"). */
  showZeroCount?: boolean;
  /** Red "missing setup" indicator (top-left). */
  isMissing?: boolean;
  /** Amber "needs attention" indicator (top-left). */
  needsAttention?: boolean;
  /** Disable the tile (not selectable / not focusable). */
  disabled?: boolean;
  /** Explicit test-id suffix; defaults to `value`. */
  testId?: string;
}

/**
 * Equal-size tile dimensions + base styling. The fixed width (with flex-wrap on
 * the list) is what keeps every tile identical and stops a long label from
 * distorting the layout; the label area has a fixed min-height so the icon row
 * never shifts between one- and two-line labels.
 */
const TILE_CLASS =
  "group relative flex h-20 w-[88px] shrink-0 flex-col items-center justify-start gap-2 whitespace-normal rounded-xl px-1.5 py-2.5 text-center text-[11px] font-semibold leading-tight transition-all hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:pointer-events-none disabled:opacity-50";

/** A single icon-above-label page-menu tile (built on Radix `TabsTrigger`). */
export function PageMenuTile({ item }: { item: PageMenuTileItem }) {
  const { value, label, icon: Icon, count, showZeroCount, isMissing, needsAttention, disabled, testId } = item;
  const id = testId ?? value;
  const shouldShowCount = count != null && (count > 0 || Boolean(showZeroCount));
  return (
    <TabsTrigger
      value={value}
      title={label}
      disabled={disabled}
      data-testid={`page-menu-tile-${id}`}
      className={cn(TILE_CLASS, isMissing ? "ring-1 ring-destructive/25" : "")}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/70 text-muted-foreground transition-colors group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
        <Icon data-testid={`page-menu-tile-icon-${id}`} className="h-5 w-5 shrink-0" aria-hidden="true" />
      </span>
      {/* Long custom labels clamp to two lines (tile height is fixed by the
          grid); the full label is available via the tile's `title` tooltip. */}
      <span className="flex min-h-[28px] items-center justify-center">
        <span className="line-clamp-2 text-balance">{label}</span>
      </span>
      {isMissing ? (
        <span
          aria-hidden="true"
          data-testid={`page-menu-tile-missing-${id}`}
          className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-destructive shadow-sm ring-2 ring-background"
        />
      ) : null}
      {needsAttention && !isMissing ? (
        <span
          aria-hidden="true"
          data-testid={`page-menu-tile-attention-${id}`}
          className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm ring-2 ring-background"
        />
      ) : null}
      {shouldShowCount ? (
        <span
          aria-hidden="true"
          data-testid={`page-menu-tile-count-${id}`}
          className={cn(
            "absolute right-2 top-2 rounded-full px-1.5 text-[10px] font-bold tabular-nums",
            showZeroCount ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {count}
        </span>
      ) : null}
    </TabsTrigger>
  );
}

/**
 * A responsive, wrapping menu of equal-size icon-above-label tiles. Renders as a
 * Radix `TabsList`, so it must live inside a `<Tabs>` and pairs with matching
 * `<TabsContent value=…>` blocks. Tiles wrap cleanly on small screens (no
 * horizontal scroll) and never stretch across an ultrawide row.
 */
export function PageMenuTiles({
  items,
  ariaLabel,
  className,
  testId = "page-menu-tiles",
}: {
  items: PageMenuTileItem[];
  ariaLabel?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <TabsList
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        "flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl border border-border bg-muted/35 p-2 text-muted-foreground shadow-sm",
        className,
      )}
    >
      {items.map((item) => (
        <PageMenuTile key={item.value} item={item} />
      ))}
    </TabsList>
  );
}
