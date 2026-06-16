import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarRange,
  Plus,
  Shuffle,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { makeId } from "@/lib/store";
import {
  ABSENCE_HANDLING_LABELS,
  WEEK_DAYS,
  normalizeAbsencePriority,
  normalizeSchedulingPreferencesV2,
} from "@/types";
import type {
  AbsenceHandlingPreference,
  CustomerSchedulingPreferences,
  SchedulingPreferenceWindow,
  WeekDay,
} from "@/types";

type WindowKey =
  | "preferredRecurringWindows"
  | "acceptableRecurringWindows"
  | "acceptableTemporaryWindows";

const WINDOW_DEFAULTS: Record<WindowKey, { label: string; start: string; end: string }> = {
  preferredRecurringWindows: { label: "Preferred recurring", start: "09:00", end: "12:00" },
  acceptableRecurringWindows: { label: "Acceptable recurring", start: "08:00", end: "15:00" },
  acceptableTemporaryWindows: { label: "Temporary flexibility", start: "08:00", end: "16:00" },
};

/** Creates a V2 working draft from stored preferences, normalizing legacy fields. */
function toDraft(prefs?: CustomerSchedulingPreferences | null): CustomerSchedulingPreferences {
  return normalizeSchedulingPreferencesV2(prefs);
}

/** Whether a V2 scheduling window has a valid chronological range. */
function isWindowValid(window: SchedulingPreferenceWindow): boolean {
  return Boolean(window.startTime && window.endTime && window.endTime > window.startTime);
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <Label className="mb-1.5 block text-xs">{label}</Label>
      <TimePicker value={value} onChange={onChange} aria-label={label} />
    </div>
  );
}

function WindowRow({
  window,
  onChange,
  onRemove,
}: {
  window: SchedulingPreferenceWindow;
  onChange: (patch: Partial<SchedulingPreferenceWindow>) => void;
  onRemove: () => void;
}) {
  const valid = isWindowValid(window);
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
        <div>
          <Label className="mb-1.5 block text-xs">Day of week</Label>
          <Select value={window.day} onValueChange={(v) => onChange({ day: v as WeekDay })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_DAYS.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Label / note</Label>
          <Input
            value={window.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Optional label"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="lg:mt-5 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove window"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 rounded-lg border border-border/70 bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Time window
        </p>
        <div className="flex gap-2">
          <TimeField
            label="Start"
            value={window.startTime}
            onChange={(v) => onChange({ startTime: v })}
          />
          <TimeField
            label="End"
            value={window.endTime}
            onChange={(v) => onChange({ endTime: v })}
          />
        </div>
      </div>

      {!valid ? (
        <p className="mt-2 text-xs text-destructive">End time must be after start time.</p>
      ) : null}
    </div>
  );
}

function WindowList({
  icon,
  title,
  subtitle,
  windows,
  onAdd,
  onChange,
  onRemove,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  windows: SchedulingPreferenceWindow[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<SchedulingPreferenceWindow>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {icon}
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground/70">{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Add window
        </Button>
      </div>
      {windows.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">No windows added yet. Use "Add window" above.</p>
      ) : (
        <div className="space-y-3">
          {windows.map((window) => (
            <WindowRow
              key={window.id}
              window={window}
              onChange={(patch) => onChange(window.id, patch)}
              onRemove={() => onRemove(window.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityRanking({
  title,
  order,
  onChange,
}: {
  title: string;
  order: AbsenceHandlingPreference[];
  onChange: (next: AbsenceHandlingPreference[]) => void;
}) {
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground/70">{title}</p>
      {order.map((value, index) => (
        <div
          key={value}
          className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {index + 1}
          </span>
          <span className="flex-1 text-sm">{ABSENCE_HANDLING_LABELS[value]}</span>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => move(index, 1)}
              disabled={index === order.length - 1}
              aria-label="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Full admin editor for a customer's V2 scheduling preferences. The Customer
 * Card is the authoritative editing surface; the customer portal remains outside
 * this first V2 slice.
 */
export function SchedulingPreferencesEditor({
  initial,
  onCancel,
  onSave,
  isSaving = false,
}: {
  initial?: CustomerSchedulingPreferences | null;
  onCancel: () => void;
  onSave: (prefs: CustomerSchedulingPreferences) => void | Promise<void>;
  isSaving?: boolean;
}) {
  const [draft, setDraft] = useState<CustomerSchedulingPreferences>(() => toDraft(initial));

  const windowsFor = (key: WindowKey): SchedulingPreferenceWindow[] => draft[key] ?? [];

  const addWindow = (key: WindowKey) => {
    const defaults = WINDOW_DEFAULTS[key];
    const windows = windowsFor(key);
    const used = new Set(windows.map((w) => w.day));
    const nextDay = (WEEK_DAYS.find((d) => !used.has(d.value)) ?? WEEK_DAYS[0]).value;
    const entry: SchedulingPreferenceWindow = {
      id: makeId("cwin"),
      day: nextDay,
      startTime: defaults.start,
      endTime: defaults.end,
      label: defaults.label,
      priority: windows.length + 1,
    };
    setDraft({ ...draft, [key]: [...windows, entry] });
  };

  const updateWindow = (key: WindowKey, id: string, patch: Partial<SchedulingPreferenceWindow>) => {
    setDraft({
      ...draft,
      [key]: windowsFor(key).map((window) =>
        window.id === id ? { ...window, ...patch } : window,
      ),
    });
  };

  const removeWindow = (key: WindowKey, id: string) => {
    setDraft({ ...draft, [key]: windowsFor(key).filter((window) => window.id !== id) });
  };

  const save = () => {
    const temporaryReschedulingPriority = normalizeAbsencePriority(draft.temporaryReschedulingPriority);
    const next = normalizeSchedulingPreferencesV2({
      ...draft,
      version: 2,
      // New Customer Card saves persist clean V2 windows. Legacy fields remain
      // readable for old records but are not used to recreate removed windows.
      preferredDays: [],
      secondaryDays: [],
      absencePriority: temporaryReschedulingPriority,
      absenceHandling: null,
      temporaryReschedulingPriority,
      schedulingNotes: draft.schedulingNotes?.trim() || "",
      updatedAt: new Date().toISOString(),
    });
    onSave(next);
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button onClick={save} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5">
        <h2 className="text-base font-semibold">Recurring schedule preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preferred and acceptable recurring times are used for the customer's normal ongoing schedule.
        </p>
      </div>

      <WindowList
        icon={<CalendarClock className="h-4 w-4" />}
        title="Preferred recurring cleaning times"
        subtitle="Customer's first choice for the normal recurring schedule. Highest priority."
        windows={windowsFor("preferredRecurringWindows")}
        onAdd={() => addWindow("preferredRecurringWindows")}
        onChange={(id, patch) => updateWindow("preferredRecurringWindows", id, patch)}
        onRemove={(id) => removeWindow("preferredRecurringWindows", id)}
      />

      <WindowList
        icon={<CalendarRange className="h-4 w-4" />}
        title="Acceptable recurring cleaning times"
        subtitle="Valid alternatives for permanent recurring bookings, but lower priority than preferred times."
        windows={windowsFor("acceptableRecurringWindows")}
        onAdd={() => addWindow("acceptableRecurringWindows")}
        onChange={(id, patch) => updateWindow("acceptableRecurringWindows", id, patch)}
        onRemove={(id) => removeWindow("acceptableRecurringWindows", id)}
      />

      <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
        <h2 className="text-base font-semibold">Temporary rescheduling flexibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Temporary cleaning times are used only for one-off changes, such as customer requested rescheduling,
          employee absence, holidays, sickness, vacation, capacity issues, or admin manual changes.
        </p>
      </div>

      <WindowList
        icon={<Shuffle className="h-4 w-4" />}
        title="Acceptable temporary cleaning times"
        subtitle="Broader customer-approved windows for explicit temporary events only. Leave empty unless consent is known."
        windows={windowsFor("acceptableTemporaryWindows")}
        onAdd={() => addWindow("acceptableTemporaryWindows")}
        onChange={(id, patch) => updateWindow("acceptableTemporaryWindows", id, patch)}
        onRemove={(id) => removeWindow("acceptableTemporaryWindows", id)}
      />

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Shuffle className="h-4 w-4" /> Temporary rescheduling priority
          </h3>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Rank how the system should approach temporary one-off alternatives. This is broader than employee absence.
          </p>
        </div>
        <PriorityRanking
          title="Rank these from 1 (most preferred) using the arrows."
          order={normalizeAbsencePriority(draft.temporaryReschedulingPriority)}
          onChange={(next) => setDraft({ ...draft, temporaryReschedulingPriority: next, absencePriority: next })}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <StickyNote className="h-4 w-4" /> Scheduling notes
          </h3>
          <p className="mt-1 text-xs text-muted-foreground/70">Optional planning guidance.</p>
        </div>
        <Textarea
          placeholder="e.g. Customer prefers morning cleaning if possible."
          value={draft.schedulingNotes ?? ""}
          onChange={(e) => setDraft({ ...draft, schedulingNotes: e.target.value })}
        />
      </div>
    </div>
  );
}
