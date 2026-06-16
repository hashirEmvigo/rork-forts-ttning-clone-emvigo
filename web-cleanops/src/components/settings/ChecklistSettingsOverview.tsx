import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { CHECKLIST_SETTINGS_MODULES } from "@/lib/checklistSettingsModules";

/**
 * Grid of Checklist Manager configuration modules. Each card links to its own
 * dedicated route under `/settings/checklists/*`. Rendered both inside the
 * Settings → Checklists tab and on the standalone landing page.
 */
export function ChecklistSettingsOverview() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {CHECKLIST_SETTINGS_MODULES.map((module) => (
        <Link
          key={module.id}
          to={module.path}
          className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
        >
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <module.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{module.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{module.description}</p>
          </div>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}
