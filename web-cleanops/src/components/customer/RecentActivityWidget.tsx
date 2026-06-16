import { Activity } from "lucide-react";

import { formatDate } from "@/lib/format";
import type { AuditEvent } from "@/types";

interface RecentActivityWidgetProps {
  /** The customer's own recent events (already scoped to the signed-in user). */
  events: AuditEvent[];
}

/**
 * Shows the customer's own recent activity. Only the signed-in user's events are
 * passed in, so no other customer's actions are ever exposed here.
 */
export function RecentActivityWidget({ events }: RecentActivityWidgetProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <p className="text-xs text-muted-foreground">Your latest actions in the portal.</p>
      </div>
      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground">
          <Activity className="h-7 w-7 opacity-40" />
          <p className="text-sm">No recent activity yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-5 py-3.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{event.summary}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(event.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
