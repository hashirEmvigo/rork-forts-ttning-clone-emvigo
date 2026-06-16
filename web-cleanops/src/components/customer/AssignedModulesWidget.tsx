import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

import type { ModuleDefinition } from "@/lib/modules";

interface AssignedModulesWidgetProps {
  modules: ModuleDefinition[];
  /** Section heading. Defaults to the customer-portal wording. */
  title?: string;
  /** Section sub-heading. */
  description?: string;
  /** Message shown when no modules are available. */
  emptyText?: string;
}

/**
 * Lists the modules currently available to the signed-in user. Reused across the
 * customer and employee portals. Fully data-driven by Module Management + Roles,
 * so enabling/disabling a module updates this area automatically.
 */
export function AssignedModulesWidget({
  modules,
  title = "Your services",
  description = "Tools and services made available to you.",
  emptyText = "No services are available to you yet.",
}: AssignedModulesWidgetProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {modules.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-muted-foreground">
          <Sparkles className="h-7 w-7 opacity-40" />
          <p className="text-sm">{emptyText}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          {modules.map((def) => {
            const Icon = def.icon;
            return (
              <Link
                key={def.id}
                to={`/modules/${def.id}`}
                className="group flex items-start gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{def.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {def.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
