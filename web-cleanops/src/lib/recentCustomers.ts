/**
 * Lightweight "recently worked-with customers" tracking.
 *
 * This is intentionally a thin, localStorage-backed activity log — NOT a schema
 * or data-model change. It records when an admin meaningfully interacts with a
 * customer (opens the card, locks them as the active workspace context, starts
 * onboarding, …) so the Customers page can surface the customers an admin has
 * actually been working with rather than the most recently created ones.
 *
 * Entries are scoped per company and capped, and every access is defensive so a
 * corrupt/absent store never breaks the page.
 */

const STORAGE_PREFIX = "cleanops.recentCustomers.";
/** How many activity entries we retain per company. */
const MAX_STORED = 20;

interface RecentEntry {
  id: string;
  /** Epoch millis of the most recent interaction. */
  at: number;
}

function storageKey(companyId: string): string {
  return `${STORAGE_PREFIX}${companyId}`;
}

function readEntries(companyId: string): RecentEntry[] {
  if (typeof window === "undefined" || !companyId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentEntry).id === "string" &&
        typeof (e as RecentEntry).at === "number",
    );
  } catch {
    return [];
  }
}

/**
 * Records that the admin just worked with this customer. Moves the customer to
 * the front of the recency list (de-duplicated) and trims to {@link MAX_STORED}.
 */
export function recordRecentCustomer(companyId: string, customerId: string): void {
  if (typeof window === "undefined" || !companyId || !customerId) return;
  try {
    const now = Date.now();
    const existing = readEntries(companyId).filter((e) => e.id !== customerId);
    const next: RecentEntry[] = [{ id: customerId, at: now }, ...existing].slice(
      0,
      MAX_STORED,
    );
    window.localStorage.setItem(storageKey(companyId), JSON.stringify(next));
  } catch {
    // Never let activity tracking break the workspace.
  }
}

/**
 * Returns the customer ids the admin has worked with, most recent first. Callers
 * are responsible for mapping these to in-scope customers and applying their own
 * limit (e.g. the 5 most recent).
 */
export function getRecentCustomerIds(companyId: string): string[] {
  return readEntries(companyId)
    .sort((a, b) => b.at - a.at)
    .map((e) => e.id);
}
