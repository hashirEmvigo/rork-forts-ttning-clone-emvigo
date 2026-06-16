import { Bell } from "lucide-react";

/**
 * Placeholder notifications area for the employee portal. Future modules (tasks,
 * requests, news) will feed real items here without redesigning the dashboard.
 */
export function NotificationsWidget() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <p className="text-xs text-muted-foreground">Updates from your company and tools.</p>
      </div>
      <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground">
        <Bell className="h-7 w-7 opacity-40" />
        <p className="text-sm">You're all caught up.</p>
        <p className="text-xs">Notifications will appear here as modules are enabled.</p>
      </div>
    </section>
  );
}
