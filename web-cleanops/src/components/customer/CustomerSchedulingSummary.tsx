import { CalendarClock, CalendarRange, Shuffle, StickyNote } from "lucide-react";
import type { ReactNode } from "react";

import {
  ABSENCE_HANDLING_LABELS,
  WEEK_DAY_LABELS,
  normalizeAbsencePriority,
  normalizeSchedulingPreferencesV2,
} from "@/types";
import type {
  CustomerSchedulingPreferences,
  SchedulingPreferenceWindow,
} from "@/types";

/** Formats a "HH:mm" window as "08:00 – 15:00", or an em dash when empty. */
function fmtWindow(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ") || "—";
}

/** Formats a single V2 scheduling window, e.g. "Monday · 09:00 – 12:00". */
function windowLine(window: SchedulingPreferenceWindow): string {
  const formatted = fmtWindow(window.startTime, window.endTime);
  return formatted !== "—" ? `${WEEK_DAY_LABELS[window.day]} · ${formatted}` : WEEK_DAY_LABELS[window.day];
}

function WindowList({ windows }: { windows: SchedulingPreferenceWindow[] }) {
  if (windows.length === 0) {
    return <p className="text-sm text-muted-foreground/60">None set.</p>;
  }
  return (
    <ul className="space-y-2">
      {windows.map((window) => (
        <li
          key={window.id}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <div className="font-medium">{WEEK_DAY_LABELS[window.day]}</div>
          <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>
              <span className="uppercase tracking-wide text-muted-foreground/70">Window</span>{" "}
              <span className="tabular-nums text-foreground">
                {fmtWindow(window.startTime, window.endTime)}
              </span>
            </span>
            {window.label ? <span>{window.label}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PreferenceCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </div>
        <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Block({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Read-only summary of a customer's V2 scheduling preferences. Shared by the
 * Customer Card, Customer Portal read-only page, and Work Order planning context.
 */
export function CustomerSchedulingSummary({
  preferences,
  layout = "grouped",
}: {
  preferences?: CustomerSchedulingPreferences | null;
  /** Customer Card can request the separated four-card UX without changing portal/work-order consumers. */
  layout?: "grouped" | "cards";
}) {
  const prefs = normalizeSchedulingPreferencesV2(preferences);
  const preferredRecurring = prefs.preferredRecurringWindows ?? [];
  const acceptableRecurring = prefs.acceptableRecurringWindows ?? [];
  const acceptableTemporary = prefs.acceptableTemporaryWindows ?? [];
  const ranking = normalizeAbsencePriority(
    prefs.temporaryReschedulingPriority ?? prefs.absencePriority,
    prefs.absenceHandling,
  );
  const hasPriority = Boolean(
    preferences &&
      ((preferences.temporaryReschedulingPriority?.length ?? 0) > 0 ||
        (preferences.absencePriority?.length ?? 0) > 0 ||
        preferences.absenceHandling != null),
  );
  const hasAny =
    preferredRecurring.length > 0 ||
    acceptableRecurring.length > 0 ||
    acceptableTemporary.length > 0 ||
    hasPriority ||
    Boolean(prefs.schedulingNotes?.trim());

  if (!hasAny) {
    return layout === "cards" ? (
      <div className="grid gap-4" data-testid="customer-scheduling-card-layout">
        <div className="grid gap-4 lg:grid-cols-2">
          <PreferenceCard icon={<CalendarClock className="h-4 w-4" />} title="Preferred recurring cleaning times">
            <p className="text-sm text-muted-foreground/60">No cleaning days or time preferences set yet.</p>
          </PreferenceCard>
          <PreferenceCard icon={<CalendarRange className="h-4 w-4" />} title="Acceptable recurring cleaning times">
            <WindowList windows={[]} />
          </PreferenceCard>
        </div>
        <PreferenceCard icon={<Shuffle className="h-4 w-4" />} title="Acceptable temporary cleaning times + Temporary rescheduling priority">
          <WindowList windows={[]} />
          <div className="mt-4 border-t border-border pt-4">
            <Block icon={<Shuffle className="h-4 w-4" />} label="Temporary rescheduling priority">
              <span className="text-sm text-muted-foreground/60">No priority set.</span>
            </Block>
          </div>
        </PreferenceCard>
        <PreferenceCard icon={<CalendarRange className="h-4 w-4" />} title="Temporary adjustments">
          <p className="text-sm text-muted-foreground/60">Temporary adjustment tools will be added here.</p>
        </PreferenceCard>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground/60">
        No cleaning days or time preferences set yet.
      </p>
    );
  }

  if (layout === "cards") {
    return (
      <div className="grid gap-4" data-testid="customer-scheduling-card-layout">
        <div className="grid gap-4 lg:grid-cols-2">
          <PreferenceCard icon={<CalendarClock className="h-4 w-4" />} title="Preferred recurring cleaning times">
            <WindowList windows={preferredRecurring} />
          </PreferenceCard>
          <PreferenceCard icon={<CalendarRange className="h-4 w-4" />} title="Acceptable recurring cleaning times">
            <WindowList windows={acceptableRecurring} />
          </PreferenceCard>
        </div>

        <PreferenceCard icon={<Shuffle className="h-4 w-4" />} title="Acceptable temporary cleaning times + Temporary rescheduling priority">
          <div className="grid gap-5 lg:grid-cols-2">
            <Block icon={<Shuffle className="h-4 w-4" />} label="Acceptable temporary cleaning times">
              <WindowList windows={acceptableTemporary} />
            </Block>
            <Block icon={<Shuffle className="h-4 w-4" />} label="Temporary rescheduling priority">
              {hasPriority ? (
                <ol className="space-y-1.5">
                  {ranking.map((priority, index) => (
                    <li key={priority} className="flex items-center gap-2 text-sm">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      {ABSENCE_HANDLING_LABELS[priority]}
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="text-sm text-muted-foreground/60">No priority set.</span>
              )}
            </Block>
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <Block icon={<StickyNote className="h-4 w-4" />} label="Scheduling notes">
              <p className="whitespace-pre-wrap text-sm">
                {prefs.schedulingNotes?.trim() ? (
                  prefs.schedulingNotes
                ) : (
                  <span className="text-muted-foreground/60">No notes.</span>
                )}
              </p>
            </Block>
          </div>
        </PreferenceCard>

        <PreferenceCard icon={<CalendarRange className="h-4 w-4" />} title="Temporary adjustments">
          <p className="text-sm text-muted-foreground/60">Temporary adjustment tools will be added here.</p>
        </PreferenceCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Recurring schedule preferences</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Used for the normal ongoing schedule. Temporary flexibility is not used here.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Block icon={<CalendarClock className="h-4 w-4" />} label="Preferred recurring cleaning times">
            <WindowList windows={preferredRecurring} />
          </Block>
          <Block icon={<CalendarRange className="h-4 w-4" />} label="Acceptable recurring cleaning times">
            <WindowList windows={acceptableRecurring} />
          </Block>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Temporary rescheduling flexibility</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Used only for one-off changes such as customer requested rescheduling, absence,
          holidays, vacation, sickness, capacity issues, or admin manual changes.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Block icon={<Shuffle className="h-4 w-4" />} label="Acceptable temporary cleaning times">
            <WindowList windows={acceptableTemporary} />
          </Block>
          <Block icon={<Shuffle className="h-4 w-4" />} label="Temporary rescheduling priority">
            {hasPriority ? (
              <ol className="space-y-1.5">
                {ranking.map((priority, index) => (
                  <li key={priority} className="flex items-center gap-2 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    {ABSENCE_HANDLING_LABELS[priority]}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="text-sm text-muted-foreground/60">No priority set.</span>
            )}
          </Block>
        </div>
      </div>

      <Block icon={<StickyNote className="h-4 w-4" />} label="Scheduling notes">
        <p className="whitespace-pre-wrap text-sm">
          {prefs.schedulingNotes?.trim() ? (
            prefs.schedulingNotes
          ) : (
            <span className="text-muted-foreground/60">No notes.</span>
          )}
        </p>
      </Block>
    </div>
  );
}

export { windowLine as dayLine };
