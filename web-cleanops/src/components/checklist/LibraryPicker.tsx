import { useEffect, useMemo, useState } from "react";
import { Check, Globe, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A selectable library item rendered in the picker. */
export interface LibraryPickerItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  categoryLabel: string;
  /** True for global items (shown with a small badge). */
  isGlobal: boolean;
}

interface LibraryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  items: LibraryPickerItem[];
  /** Ordered category options for the filter chips. */
  categories: { value: string; label: string }[];
  searchPlaceholder: string;
  confirmLabel: (count: number) => string;
  /** Called with the selected item ids. */
  onConfirm: (ids: string[]) => void;
}

/** Searchable, category-filtered, multi-select picker for library items. */
export function LibraryPicker({
  open,
  onOpenChange,
  title,
  description,
  items,
  categories,
  searchPlaceholder,
  confirmLabel,
  onConfirm,
}: LibraryPickerProps) {
  const [query, setQuery] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveCategory("all");
      setSelected(new Set());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== "all" && item.category !== activeCategory) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, activeCategory]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    if (selected.size === 0) return;
    onConfirm(Array.from(selected));
    onOpenChange(false);
  };

  // Only show category chips that actually have items.
  const usedCategories = useMemo(() => {
    const present = new Set(items.map((i) => i.category));
    return categories.filter((c) => present.has(c.value));
  }, [items, categories]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b border-border px-6 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label="All"
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {usedCategories.map((c) => (
              <CategoryChip
                key={c.value}
                label={c.label}
                active={activeCategory === c.value}
                onClick={() => setActiveCategory(c.value)}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No items match your search.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((item) => {
                const checked = selected.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        checked
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <Checkbox checked={checked} className="mt-0.5" tabIndex={-1} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {item.name}
                          {item.isGlobal ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              <Globe className="h-2.5 w-2.5" /> Global
                            </span>
                          ) : null}
                        </p>
                        {item.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                          {item.categoryLabel}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={selected.size === 0}>
            <Check className="h-4 w-4" /> {confirmLabel(selected.size)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
