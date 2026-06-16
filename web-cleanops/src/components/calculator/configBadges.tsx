import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/** Shared badge tones for the calculator configuration editor. */
export type Tone = "green" | "blue" | "amber" | "red" | "muted";

export const TONE_CLS: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

/** A small, consistent status pill used across the editor sections. */
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium",
        TONE_CLS[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A muted "locked" chip used to mark stable machine keys / non-editable fields. */
export function LockedChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      <Lock className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}
