import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export interface QuickAction {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
}

interface QuickActionsWidgetProps {
  actions: QuickAction[];
}

/**
 * Compact shortcut grid. Actions are passed in so the dashboard decides what's
 * relevant for the signed-in customer; the widget renders nothing when empty.
 */
export function QuickActionsWidget({ actions }: QuickActionsWidgetProps) {
  if (actions.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Quick actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.to}
              to={action.to}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{action.label}</p>
                <p className="truncate text-xs text-muted-foreground">{action.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
