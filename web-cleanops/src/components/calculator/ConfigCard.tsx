import { ChevronDown } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface CollapsibleServiceCardProps {
  /** Controlled open state — multiple cards may be open at once. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Service display name (drives the trigger's accessible name). */
  title: string;
  /** Machine key, shown muted/mono under the title. */
  subtitle?: string;
  /** Short summary such as "8 pricing rules". */
  countLabel?: string;
  /** Status pills rendered next to the title. */
  badges?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A collapsed-by-default service card used by the grouped configuration editors
 * (Pricing Rules, Services & Fields). Cards sit in a responsive grid and stay
 * compact while collapsed; an open card spans the full row so its content has
 * room to breathe, which keeps labels/values/actions visually close instead of
 * stretching across an ultrawide screen.
 */
export function CollapsibleServiceCard({
  open,
  onOpenChange,
  title,
  subtitle,
  countLabel,
  badges,
  children,
  className,
}: CollapsibleServiceCardProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={cn(
        "border border-border bg-card transition-colors",
        open ? "rounded-t-2xl lg:col-span-2 2xl:col-span-3" : "rounded-2xl",
        className,
      )}
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40",
          open ? "rounded-t-2xl" : "rounded-2xl",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            {badges}
          </div>
          {subtitle || countLabel ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {subtitle ? (
                <span className="font-mono text-[11px] text-muted-foreground">{subtitle}</span>
              ) : null}
              {countLabel ? <span className="text-xs text-muted-foreground">{countLabel}</span> : null}
            </div>
          ) : null}
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {open ? "Collapse" : "Expand"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default CollapsibleServiceCard;
