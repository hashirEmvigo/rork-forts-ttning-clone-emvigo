import {
  ABSENCE_HANDLING_LABELS,
  CUSTOMER_TYPE_LABELS,
  dayAcceptableWindow,
  dayOptimalWindow,
  normalizeAbsencePriority,
  WEEK_DAY_LABELS,
} from "@/types";
import { isCustomerType } from "@/lib/customerType";
import type { Customer, CustomerSchedulingPreferences } from "@/types";

/** A single, human-readable change derived from a customer-card patch. */
export interface CustomerChange {
  section: string;
  field?: string;
  oldValue: string;
  newValue: string;
}

const EMPTY = "—";

/** Renders a customer type as its human label, falling back to the raw value. */
function customerTypeDisplay(value: unknown): string {
  if (isCustomerType(value)) return CUSTOMER_TYPE_LABELS[value];
  return str(value);
}

/** Renders any scalar value as a trimmed display string, or an em dash when empty. */
function str(value: unknown): string {
  if (value == null) return EMPTY;
  const s = String(value).trim();
  return s === "" ? EMPTY : s;
}

/** Builds a short, readable summary of a customer's scheduling preferences. */
function describeScheduling(prefs?: CustomerSchedulingPreferences | null): string {
  if (!prefs) return EMPTY;
  const parts: string[] = [];
  const fmtDays = (days: CustomerSchedulingPreferences["preferredDays"]) =>
    (days ?? [])
      .map((d) => {
        const o = dayOptimalWindow(d);
        const a = dayAcceptableWindow(d);
        const opt = [o.start, o.end].filter(Boolean).join("–");
        const acc = [a.start, a.end].filter(Boolean).join("–");
        return `${WEEK_DAY_LABELS[d.day]} (opt ${opt || "—"}, acc ${acc || "—"})`;
      })
      .join(", ");
  const preferred = fmtDays(prefs.preferredDays);
  const secondary = fmtDays(prefs.secondaryDays);
  parts.push(`Preferred: ${preferred || "none"}`);
  parts.push(`Secondary: ${secondary || "none"}`);
  const ranking = normalizeAbsencePriority(prefs.absencePriority, prefs.absenceHandling);
  parts.push(
    `Absence priority: ${ranking.map((p, i) => `${i + 1}. ${ABSENCE_HANDLING_LABELS[p]}`).join(" | ")}`,
  );
  if (prefs.schedulingNotes?.trim()) parts.push(`Notes: ${prefs.schedulingNotes.trim()}`);
  return parts.join(" · ");
}

/**
 * Derives the meaningful changes between a stored customer and an update patch.
 * Only keys present in the patch are considered, and only changed values are
 * returned. Complex sections (addresses, contacts, scheduling, notes) are
 * summarized rather than diffed field-by-field to keep the log readable.
 */
export function describeCustomerCardChanges(
  target: Customer,
  patch: Partial<Customer>,
): CustomerChange[] {
  const changes: CustomerChange[] = [];

  const scalarFields: { key: keyof Customer; section: string; field: string }[] = [
    { key: "name", section: "Contact information", field: "Name" },
    { key: "email", section: "Contact information", field: "Email" },
    { key: "phone", section: "Contact information", field: "Phone" },
    { key: "mainContact", section: "Contact information", field: "Main contact" },
    { key: "customerType", section: "Contact information", field: "Customer type" },
    { key: "area", section: "Contact information", field: "Area" },
    { key: "status", section: "Customer settings", field: "Status" },
  ];
  for (const { key, section, field } of scalarFields) {
    if (key in patch) {
      const render = key === "customerType" ? customerTypeDisplay : str;
      const oldV = render(target[key]);
      const newV = render(patch[key]);
      if (oldV !== newV) changes.push({ section, field, oldValue: oldV, newValue: newV });
    }
  }

  if ("tags" in patch) {
    const oldV = str((target.tags ?? []).join(", "));
    const newV = str((patch.tags ?? []).join(", "));
    if (oldV !== newV) {
      changes.push({ section: "Contact information", field: "Tags", oldValue: oldV, newValue: newV });
    }
  }

  if ("addresses" in patch) {
    if (JSON.stringify(target.addresses ?? []) !== JSON.stringify(patch.addresses ?? [])) {
      changes.push({
        section: "Addresses",
        oldValue: `${(target.addresses ?? []).length} address(es)`,
        newValue: `${(patch.addresses ?? []).length} address(es)`,
      });
    }
  }

  if ("contacts" in patch) {
    if (JSON.stringify(target.contacts ?? []) !== JSON.stringify(patch.contacts ?? [])) {
      changes.push({
        section: "Contact persons",
        oldValue: `${(target.contacts ?? []).length} contact(s)`,
        newValue: `${(patch.contacts ?? []).length} contact(s)`,
      });
    }
  }

  if ("schedulingPreferences" in patch) {
    if (
      JSON.stringify(target.schedulingPreferences ?? null) !==
      JSON.stringify(patch.schedulingPreferences ?? null)
    ) {
      changes.push({
        section: "Cleaning Days & Times",
        oldValue: describeScheduling(target.schedulingPreferences),
        newValue: describeScheduling(patch.schedulingPreferences),
      });
    }
  }

  if ("cardNotes" in patch) {
    if (JSON.stringify(target.cardNotes ?? []) !== JSON.stringify(patch.cardNotes ?? [])) {
      changes.push({
        section: "Notes",
        oldValue: `${(target.cardNotes ?? []).length} note(s)`,
        newValue: `${(patch.cardNotes ?? []).length} note(s)`,
      });
    }
  }

  if ("internalNotes" in patch) {
    if (JSON.stringify(target.internalNotes ?? []) !== JSON.stringify(patch.internalNotes ?? [])) {
      changes.push({
        section: "Notes",
        field: "Internal notes",
        oldValue: `${(target.internalNotes ?? []).length} note(s)`,
        newValue: `${(patch.internalNotes ?? []).length} note(s)`,
      });
    }
  }

  if ("userIds" in patch) {
    if (JSON.stringify(target.userIds ?? []) !== JSON.stringify(patch.userIds ?? [])) {
      changes.push({
        section: "Portal access",
        oldValue: `${(target.userIds ?? []).length} login(s)`,
        newValue: `${(patch.userIds ?? []).length} login(s)`,
      });
    }
  }

  return changes;
}
