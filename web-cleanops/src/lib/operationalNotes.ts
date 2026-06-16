/**
 * Operational note collection for schedulers.
 *
 * The app keeps notes in their existing single source of truth — customer card
 * notes (general + economic), work-order notes, and the per-service-row
 * schedule note. This pure helper gathers the notes a scheduler needs for a
 * specific service occurrence into an ordered set of groups, with the Schedule
 * note ranked highest because it is the instruction most directly tied to
 * staffing and execution. It never mutates or syncs copies — callers pass the
 * live data and render the result. Safe to call during render.
 */

/** A single note reduced to display fields. */
export interface OperationalNote {
  title: string;
  content: string;
}

/** The note buckets surfaced to schedulers, ordered by operational priority. */
export type OperationalNoteGroupKey = "schedule" | "workOrder" | "customer";

export interface OperationalNoteGroup {
  key: OperationalNoteGroupKey;
  label: string;
  /** Higher = more important for schedulers. Groups are sorted by this desc. */
  priority: number;
  notes: OperationalNote[];
}

/** Live note inputs for one service occurrence. */
export interface OperationalNoteSource {
  /** Service-row schedule note (free text). Highest scheduler priority. */
  scheduleNote?: string | null;
  /** Active work-order notes. */
  workOrderNotes?: OperationalNote[] | null;
  /** Active general customer notes. */
  customerNotes?: OperationalNote[] | null;
}

const GROUP_LABELS: Record<OperationalNoteGroupKey, string> = {
  schedule: "Schedule note",
  workOrder: "Work order notes",
  customer: "Customer notes",
};

const GROUP_PRIORITY: Record<OperationalNoteGroupKey, number> = {
  schedule: 3,
  workOrder: 2,
  customer: 1,
};

/** Keeps notes with non-blank title or content, trimming both. */
function sanitize(notes: OperationalNote[] | null | undefined): OperationalNote[] {
  if (!Array.isArray(notes)) return [];
  const result: OperationalNote[] = [];
  for (const n of notes) {
    if (!n) continue;
    const title = (n.title ?? "").trim();
    const content = (n.content ?? "").trim();
    if (!title && !content) continue;
    result.push({ title, content });
  }
  return result;
}

/**
 * Collects the operational notes for a service occurrence into ordered groups
 * (Schedule note first, then Work order, then Customer). Empty groups are
 * omitted; blank notes are dropped. Pure.
 */
export function collectOperationalNotes(
  source: OperationalNoteSource,
): OperationalNoteGroup[] {
  const groups: OperationalNoteGroup[] = [];

  const schedule = (source.scheduleNote ?? "").trim();
  if (schedule) {
    groups.push({
      key: "schedule",
      label: GROUP_LABELS.schedule,
      priority: GROUP_PRIORITY.schedule,
      notes: [{ title: GROUP_LABELS.schedule, content: schedule }],
    });
  }

  const workOrder = sanitize(source.workOrderNotes);
  if (workOrder.length > 0) {
    groups.push({
      key: "workOrder",
      label: GROUP_LABELS.workOrder,
      priority: GROUP_PRIORITY.workOrder,
      notes: workOrder,
    });
  }

  const customer = sanitize(source.customerNotes);
  if (customer.length > 0) {
    groups.push({
      key: "customer",
      label: GROUP_LABELS.customer,
      priority: GROUP_PRIORITY.customer,
      notes: customer,
    });
  }

  return groups.sort((a, b) => b.priority - a.priority);
}

/** True when any operational note exists for the occurrence. */
export function hasOperationalNotes(source: OperationalNoteSource): boolean {
  return collectOperationalNotes(source).length > 0;
}
