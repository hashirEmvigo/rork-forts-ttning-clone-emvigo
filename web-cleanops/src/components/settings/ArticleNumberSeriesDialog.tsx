import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type {
  ArticleNumberSeries,
  ArticleNumberSeriesScope,
} from "@/lib/data/supabaseArticleNumberSeriesRepository";
import type { ServiceCategory } from "@/types";

interface ArticleNumberSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category whose article-number range is being configured. */
  category: ServiceCategory | null;
  /** The scope (global vs company) this category's series belongs to. */
  scope: ArticleNumberSeriesScope | null;
  /** Existing configured series for this category, if any. */
  series?: ArticleNumberSeries;
  configure: (input: {
    scope: ArticleNumberSeriesScope;
    rangeStart: number;
    rangeEnd: number;
    isActive?: boolean;
  }) => Promise<ArticleNumberSeries>;
  isConfiguring: boolean;
}

/**
 * Configures the article-number RANGE a category owns (e.g. the "1000-series"
 * owning 1001–1999). Once numbers have been issued the START is locked and the
 * range may only be widened at the end — enforced by the database RPC and
 * reflected here as a read-only start field.
 */
export function ArticleNumberSeriesDialog({
  open,
  onOpenChange,
  category,
  scope,
  series,
  configure,
  isConfiguring,
}: ArticleNumberSeriesDialogProps) {
  const { toast } = useToast();
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [isActive, setIsActive] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const locked = series?.isLocked ?? false;

  useEffect(() => {
    if (!open) return;
    setRangeStart(series ? String(series.rangeStart) : "1001");
    setRangeEnd(series ? String(series.rangeEnd) : "1999");
    setIsActive(series ? series.isActive : true);
    setError(null);
  }, [open, series]);

  const seriesBase = useMemo(() => {
    const start = Number(rangeStart);
    if (!Number.isInteger(start) || start < 1) return null;
    // The "1000-series" label: the thousand boundary just below the start.
    return Math.floor(start / 1000) * 1000;
  }, [rangeStart]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (isConfiguring || !scope) return;
    const start = Number(rangeStart);
    const end = Number(rangeEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      setError("Enter a valid range — start ≥ 1 and end ≥ start.");
      return;
    }
    setError(null);
    try {
      await configure({ scope, rangeStart: start, rangeEnd: end, isActive });
      toast({
        title: "Series saved",
        description: `${category?.name ?? "Category"} owns ${start}–${end}.`,
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save the series.";
      setError(message);
      toast({ title: "Couldn't save", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isConfiguring) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Article-number series</DialogTitle>
          <DialogDescription>
            {category
              ? `Set the article-number range “${category.name}” owns. Ranges can't overlap another category in this catalog.`
              : "Set the article-number range this category owns."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ans-start">Range start</Label>
              <Input
                id="ans-start"
                type="number"
                inputMode="numeric"
                placeholder="1001"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                readOnly={locked}
                disabled={locked}
                aria-label="Range start"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ans-end">Range end</Label>
              <Input
                id="ans-end"
                type="number"
                inputMode="numeric"
                placeholder="1999"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                aria-label="Range end"
              />
            </div>
          </div>

          {seriesBase !== null ? (
            <p className="text-xs text-muted-foreground">
              {seriesBase}-series · numbers {rangeStart || "—"}–{rangeEnd || "—"}
            </p>
          ) : null}

          {locked ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Numbers have already been issued from this series, so the start is locked. You can
              still extend the range end. The next number to issue is{" "}
              <span className="font-medium text-foreground tabular-nums">{series?.nextValue}</span>.
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Series active</p>
              <p className="text-xs text-muted-foreground">
                When off, generation is paused but the range stays reserved.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isConfiguring}>
              Cancel
            </Button>
            <Button type="submit" disabled={isConfiguring || !scope}>
              {isConfiguring ? "Saving…" : "Save series"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
