import { useState } from "react";
import { CheckCircle2, FileStack, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { SETTINGS_CATEGORIES } from "@/types";
import type { SettingsData, SettingsTemplate } from "@/types";

interface CompanySetupPanelProps {
  companyId: string;
}

function countItems(data: SettingsData): number {
  return SETTINGS_CATEGORIES.reduce((sum, cat) => sum + data[cat.key].length, 0);
}

/**
 * Company onboarding for settings: the admin chooses to start from a global
 * settings template (copied into the company) or start completely blank. Once
 * set up, the copied values are shown and the admin can reset to choose again.
 */
export function CompanySetupPanel({ companyId }: CompanySetupPanelProps) {
  const { getSelectableSettingsTemplates, getCompanySettingsFor, initializeCompanySettings } = useApp();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const templates = getSelectableSettingsTemplates();
  const settings = getCompanySettingsFor(companyId);

  const applyTemplate = (template: SettingsTemplate) => {
    const result = initializeCompanySettings(companyId, { templateId: template.id });
    if (!result.ok) {
      toast({ title: "Couldn't apply", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Settings copied",
      description: `Your settings now start from “${template.name}”. You can edit them anytime.`,
    });
    setSelectedId(null);
  };

  const startBlank = () => {
    const result = initializeCompanySettings(companyId, { blank: true });
    if (!result.ok) {
      toast({ title: "Couldn't start", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Blank setup ready", description: "Add your own settings as you go." });
  };

  // ── Already initialized: show the company's own copied settings ──
  if (settings?.initialized) {
    const total = countItems(settings.data);
    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {settings.sourceTemplateName
                  ? `Started from “${settings.sourceTemplateName}”`
                  : "Started from a blank setup"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                These settings belong to your company. {total} value{total === 1 ? "" : "s"}{" "}
                configured. Future template changes won't affect them.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw className="h-4 w-4" /> Reset setup
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS_CATEGORIES.map((cat) => {
            const items = settings.data[cat.key];
            return (
              <div key={cat.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{cat.label}</p>
                  <Badge variant="secondary" className="font-normal tabular-nums">
                    {items.length}
                  </Badge>
                </div>
                {items.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {items.slice(0, 6).map((it) => (
                      <span
                        key={it.id}
                        className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {it.name}
                      </span>
                    ))}
                    {items.length > 6 ? (
                      <span className="px-1 text-xs text-muted-foreground">
                        +{items.length - 6} more
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset company settings?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears your current settings setup so you can choose a template or start
                blank again. Your copied values will be replaced.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  startBlank();
                  setConfirmReset(false);
                  toast({ title: "Setup reset", description: "Choose how to start again." });
                }}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── Not initialized: choose template or blank ──
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Start from a settings template</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Copy ready-made defaults into your company. You can edit everything afterwards.
        </p>
        {templates.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No settings templates are available yet.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {templates.map((template) => {
              const selected = selectedId === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedId(selected ? null : template.id)}
                  className={`flex flex-col rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileStack className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">{template.name}</p>
                      {template.description ? (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {template.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {SETTINGS_CATEGORIES.filter((cat) => template.data[cat.key].length > 0)
                      .slice(0, 4)
                      .map((cat) => (
                        <Badge key={cat.key} variant="secondary" className="font-normal">
                          {cat.label} · {template.data[cat.key].length}
                        </Badge>
                      ))}
                  </div>
                  {selected ? (
                    <div className="mt-4">
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          applyTemplate(template);
                        }}
                      >
                        <Sparkles className="h-4 w-4" /> Use this template
                      </Button>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Start completely blank</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No default settings are added. Create everything yourself.
          </p>
        </div>
        <Button type="button" variant="outline" className="shrink-0" onClick={startBlank}>
          Start blank
        </Button>
      </div>
    </div>
  );
}
