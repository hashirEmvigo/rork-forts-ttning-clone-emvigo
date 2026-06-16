import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { makeId } from "@/lib/store";
import { SETTINGS_CATEGORIES } from "@/types";
import type { SettingsData, SettingsItem } from "@/types";

interface SettingsDataEditorProps {
  data: SettingsData;
  onChange: (data: SettingsData) => void;
}

/**
 * Editable list of the nine settings categories (Services, Customer Types, …).
 * Each category supports adding, renaming and removing items, plus an optional
 * detail field where the category defines one (e.g. a tag's group or a code).
 */
export function SettingsDataEditor({ data, onChange }: SettingsDataEditorProps) {
  return (
    <Accordion type="multiple" className="w-full">
      {SETTINGS_CATEGORIES.map((cat) => {
        const items = data[cat.key];
        return (
          <AccordionItem key={cat.key} value={cat.key}>
            <AccordionTrigger className="text-sm font-medium">
              <span className="flex items-center gap-2">
                {cat.label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <CategoryEditor
                items={items}
                detailLabel={cat.detailLabel}
                detailPlaceholder={cat.detailPlaceholder}
                label={cat.label}
                onChange={(next) => onChange({ ...data, [cat.key]: next })}
              />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

interface CategoryEditorProps {
  items: SettingsItem[];
  label: string;
  detailLabel?: string;
  detailPlaceholder?: string;
  onChange: (items: SettingsItem[]) => void;
}

function CategoryEditor({ items, label, detailLabel, detailPlaceholder, onChange }: CategoryEditorProps) {
  const [name, setName] = useState<string>("");
  const [detail, setDetail] = useState<string>("");

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onChange([
      ...items,
      { id: makeId("set"), name: trimmed, detail: detail.trim() || undefined },
    ]);
    setName("");
    setDetail("");
  };

  const update = (id: string, patch: Partial<SettingsItem>) => {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const remove = (id: string) => {
    onChange(items.filter((it) => it.id !== id));
  };

  return (
    <div className="space-y-2.5">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No {label.toLowerCase()} yet.</p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="flex items-center gap-2">
            <Input
              value={it.name}
              onChange={(e) => update(it.id, { name: e.target.value })}
              className="flex-1"
              aria-label={`${label} name`}
            />
            {detailLabel ? (
              <Input
                value={it.detail ?? ""}
                onChange={(e) => update(it.id, { detail: e.target.value || undefined })}
                placeholder={detailPlaceholder}
                className="w-40 shrink-0"
                aria-label={detailLabel}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => remove(it.id)}
              aria-label={`Remove ${it.name}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))
      )}

      <div className="flex items-center gap-2 pt-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Add ${label.toLowerCase().replace(/s$/, "")}…`}
          className="flex-1"
        />
        {detailLabel ? (
          <Input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={detailPlaceholder}
            className="w-40 shrink-0"
          />
        ) : null}
        <Button type="button" variant="secondary" size="icon" className="h-9 w-9 shrink-0" onClick={add}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
