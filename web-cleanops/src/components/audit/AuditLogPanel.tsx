import { useMemo, useState } from "react";
import { History, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { PaginationControl } from "@/components/PaginationControl";
import { useApp } from "@/context/AppContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePagination } from "@/hooks/use-pagination";
import { perf } from "@/lib/perf";
import { ROLE_LABELS, type AuditAction } from "@/types";

/**
 * Friendly labels for the known action prefixes (the segment before the first
 * dot, e.g. `workorder.create` → `workorder`). Resolved through
 * {@link actionGroup}, which falls back to a capitalised prefix for any action
 * not listed here — so new {@link AuditAction} values can never produce an
 * `undefined` label or crash the log. Hardened in OP2: the previous exhaustive
 * `Record<AuditAction, string>` silently drifted out of sync as new actions
 * were added.
 */
const PREFIX_LABELS: Readonly<Record<string, string>> = {
  auth: "Auth",
  company: "Company",
  user: "User",
  role: "Role",
  module: "Module",
  category: "Category",
  checklist: "Checklist",
  library: "Library",
  protocol: "Protocol",
  settings_template: "Template",
  service: "Service",
  service_category: "Service",
  service_package: "Package",
  timecode: "Time Code",
  service_entitlement: "Entitlement",
  entitlements: "Entitlement",
  workorder: "Work order",
  bookingqueue: "Booking",
  company_settings: "Settings",
  system_settings: "Settings",
  calculator: "Calculator",
  impersonation: "Impersonation",
};

/** Safe, total grouping for any audit action — never returns `undefined`. */
function actionGroup(action: AuditAction): string {
  const prefix = action.split(".")[0];
  return PREFIX_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** Formats an ISO timestamp as a compact date + time. */
function formatStamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Read-only audit trail. Super Admins see every event; company admins see only
 * events scoped to their own company (enforced in the context, not here).
 */
export function AuditLogPanel() {
  const { auditEvents } = useApp();
  const [query, setQuery] = useState<string>("");

  perf.count("AuditLogPanel.render");

  // Debounce so filtering does not run on every keystroke against a log that is
  // expected to grow large.
  const debouncedQuery = useDebouncedValue(query, 350);

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return auditEvents;
    const stop = perf.start("activityLog.filter");
    const result = auditEvents.filter(
      (e) =>
        e.summary.toLowerCase().includes(q) ||
        e.actorName.toLowerCase().includes(q) ||
        actionGroup(e.action).toLowerCase().includes(q),
    );
    stop();
    return result;
  }, [auditEvents, debouncedQuery]);

  // Never render the entire log at once (Performance Policy §7).
  const {
    page,
    pageSize,
    totalPages,
    totalItems,
    pageItems,
    startIndex,
    endIndex,
    setPage,
    setPageSize,
  } = usePagination(filtered, { pageSize: 50, resetKey: debouncedQuery });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search activity…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} events</span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 py-16 text-center text-muted-foreground">
          <History className="h-8 w-8 opacity-40" />
          <p className="text-sm">No activity recorded yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {pageItems.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 inline-flex shrink-0 items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                {actionGroup(event.action)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{event.summary}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {event.actorName} · {ROLE_LABELS[event.actorRole]}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {formatStamp(event.at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {filtered.length > 0 ? (
        <PaginationControl
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="events"
        />
      ) : null}
    </div>
  );
}
