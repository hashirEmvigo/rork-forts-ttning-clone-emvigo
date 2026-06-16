import { useState } from "react";
import { ArrowDown, ArrowUp, Clock, Info, Plus, RotateCcw, Timer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuickDurationHelper } from "@/components/ui/quick-duration-helper";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_DURATION_PRESETS_MINUTES } from "@/types";
import { formatDurationHoursLabel } from "@/lib/time";

interface TimeSettingsPanelProps {
  companyId: string;
}

/**
 * Company Admin controls for the Quick Duration presets used across the app to
 * fill a planned end time from a start time. Presets are stored in MINUTES; the
 * UI shows a decimal-hours label. Admins can add, remove and reorder presets.
 */
export function TimeSettingsPanel({ companyId }: TimeSettingsPanelProps) {
  const { getDurationSettingsFor, updateDurationSettings } = useApp();
  const { toast } = useToast();

  const settings = getDurationSettingsFor(companyId);
  const presets = settings.presetMinutes;
  const [newValue, setNewValue] = useState<string>("");

  const save = (next: number[]) => {
    const res = updateDurationSettings(companyId, next);
    if (!res.ok) {
      toast({ title: "Couldn't save", description: res.error, variant: "destructive" });
      return false;
    }
    return true;
  };

  const addPreset = () => {
    const minutes = Number.parseInt(newValue, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast({
        title: "Enter a duration",
        description: "Add a positive number of minutes, e.g. 90.",
        variant: "destructive",
      });
      return;
    }
    if (presets.includes(minutes)) {
      toast({ title: "Already added", description: `${minutes} minutes is already a preset.` });
      setNewValue("");
      return;
    }
    if (save([...presets, minutes])) {
      setNewValue("");
      toast({ title: "Preset added" });
    }
  };

  const removePreset = (minutes: number) => {
    if (presets.length <= 1) {
      toast({
        title: "Keep at least one",
        description: "There must be at least one duration preset.",
        variant: "destructive",
      });
      return;
    }
    save(presets.filter((m) => m !== minutes));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= presets.length) return;
    const next = [...presets];
    [next[index], next[target]] = [next[target], next[index]];
    save(next);
  };

  const resetDefaults = () => {
    if (save([...DEFAULT_DURATION_PRESETS_MINUTES])) {
      toast({ title: "Presets reset to defaults" });
    }
  };

  return (
    <div className="space-y-5">
      {/* Presets manager */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Timer className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Quick duration presets</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  These buttons appear next to the planned start and end time across the app.
                  Tapping one fills the end time as start plus the duration. Values are stored
                  in minutes; the label shows hours.
                </p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={resetDefaults}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>

            <ul className="mt-4 space-y-2">
              {presets.map((minutes, index) => (
                <li
                  key={minutes}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-7 min-w-[2.5rem] items-center justify-center rounded-full bg-primary/10 px-2 text-sm font-semibold tabular-nums text-primary">
                    {formatDurationHoursLabel(minutes)}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">{minutes} min</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${minutes} minutes up`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === presets.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${minutes} minutes down`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removePreset(minutes)}
                      aria-label={`Remove ${minutes} minutes`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-end gap-2">
              <div className="w-40">
                <Label htmlFor="time-new-preset" className="text-xs font-medium">
                  Add preset (minutes)
                </Label>
                <Input
                  id="time-new-preset"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="e.g. 90"
                  className="mt-1 tabular-nums"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPreset();
                    }
                  }}
                />
              </div>
              <Button className="gap-1.5" onClick={addPreset}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Preview</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              This is how the helper looks. From a start of 08:00, each button sets the end time.
            </p>
            <div className="mt-3">
              <QuickDurationHelper
                startTime="08:00"
                onApply={(end) =>
                  toast({ title: "Preview", description: `08:00 + duration → ${end}` })
                }
                presetMinutes={presets}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Saved for your company. The helper still lets people type or pick any end time manually —
          presets are just a fast shortcut. A label of{" "}
          <span className="font-medium text-foreground">{formatDurationHoursLabel(105)}</span> means
          105 minutes.
        </p>
      </div>
    </div>
  );
}
