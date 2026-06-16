export type UserRole = "super_admin" | "company_admin" | "employee" | "customer";

export type EntityStatus = "active" | "inactive" | "archived";

export interface Company {
  id: string;
  name: string;
  status: EntityStatus;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  companyId: string | null;
  status: EntityStatus;
  createdAt: string;
  /** The custom role assigned to this user; falls back to {@link role} when unset. */
  roleId?: string | null;
  /** Internal staff profile this login belongs to, when role is employee. */
  linkedEmployeeId?: string | null;
  /** External customer profile this login belongs to, when role is customer. */
  linkedCustomerId?: string | null;
  /**
   * Area Scoped Access — which operational {@link Area}s this login may access.
   * The login is the access-control subject, so both admins and employee logins
   * are scoped here. Absent on legacy records and normalized to all-area access
   * on read. Only enforced when a company has {@link Company}-level Area Scoped
   * Access enabled; otherwise it is inert metadata.
   */
  areaScope?: AreaScope;
}

/** How an {@link AreaScope} grants access: every area, or an explicit set. */
export type AreaScopeMode = "all" | "selected";

/**
 * A login's Area Scoped Access configuration.
 *
 * - `mode: "all"` — access to every area in the company (the safe default).
 * - `mode: "selected"` — access limited to {@link areaIds}. An empty list means
 *   no scoped access (it must never be treated as all-area access).
 */
export interface AreaScope {
  mode: AreaScopeMode;
  areaIds: string[];
}

/**
 * Lifecycle status of a Supabase `profiles` row. Mirrors the
 * `profiles_status_check` constraint from migration 0003
 * (`active | inactive | archived`).
 */
export type ProfileStatus = "active" | "inactive" | "archived";

/**
 * A user's Supabase `profiles` row (migration 0003 / 0004), loaded after a
 * Supabase Auth sign-in. This is the Supabase-side identity record and is
 * distinct from the localStorage {@link User} login used by the current app.
 *
 * `id` equals the `auth.users` id. `companyId` is null only for `super_admin`.
 * Used by the dormant, flag-gated auth layer (Step 2B.3); it does not replace
 * {@link User} yet.
 */
export interface Profile {
  /** Matches the Supabase `auth.users` id. */
  id: string;
  /** Owning company, or null for a platform-wide super admin. */
  companyId: string | null;
  /** The user's base role, mirroring {@link UserRole}. */
  baseRole: UserRole;
  /** Display name, when provided at provisioning time. */
  fullName: string | null;
  /** Email mirrored from the auth user, when present. */
  email: string | null;
  status: ProfileStatus;
  createdAt: string | null;
}

/** Internal staff member. May connect to a {@link User} login and join {@link Team}s. */
export interface Employee {
  id: string;
  companyId: string;
  name: string;
  email: string;
  /** Job title or position, e.g. "Cleaner", "Team Lead". */
  title?: string;
  /** Optional contact phone number (free text). */
  phone?: string;
  /**
   * Optional In Case of Emergency (ICE) contact number (free text). Used for
   * emergency contact only; not validated.
   */
  iceNumber?: string;
  /** Optional street/address line. Postal code is not tracked yet. */
  address?: string;
  /**
   * Structured {@link PostalCity} this employee's address belongs to. Mirrors
   * the customer address model: the city/postort is always a controlled Postal
   * City reference, never free text.
   */
  postalCityId?: string;
  status: EntityStatus;
  /** Internal teams this employee belongs to. */
  teamIds: string[];
  /** Linked login account, if any. */
  userId?: string | null;
  /**
   * Preferred language, referencing a controlled {@link EmployeeLanguage} by id.
   * Never free text. When absent the employee falls back to the company default
   * language ({@link getDefaultEmployeeLanguage}). An assigned language that has
   * since been deactivated is preserved (shown as inactive) rather than erased.
   */
  languageId?: string | null;
  /**
   * Optional secondary/second language, also referencing a controlled
   * {@link EmployeeLanguage} by id. Same rules as {@link languageId}: never free
   * text, preserved (shown as inactive) if the language is later deactivated.
   */
  secondLanguageId?: string | null;
  /**
   * The employee's normal weekly availability and working hours. This is NOT
   * the customer cleaning schedule — it only describes when the employee is
   * available to work and their per-day capacity, so future planner checks
   * (unavailable day, outside working hours, capacity exceeded) have a baseline
   * to compare booked work against. Sparse/optional: when absent the employee
   * falls back to the {@link defaultWorkingSchedule}. Stored ordered Mon→Sun.
   *
   * @deprecated Superseded by {@link acceptableHours} / {@link preferredHours}
   * for availability planning. Retained for the legacy Schedule board capacity
   * view; no longer edited from the employee dialog.
   */
  workingSchedule?: EmployeeWorkingScheduleDay[];
  /**
   * The widest hours the employee is willing to work (the outer bound). Used as
   * the availability baseline for workforce planning and future AI scheduling.
   */
  acceptableHours?: EmployeeTimeWindow;
  /**
   * The employee's preferred working hours (the comfortable window), always
   * within {@link acceptableHours}. Drives scheduling preferences.
   *
   * @deprecated Superseded by per-day {@link availability}. Still written on
   * save as a representative (first available day) window for backward
   * compatibility with consumers that read a single window.
   */
  preferredHours?: EmployeeTimeWindow;
  /**
   * Per-day availability and working windows. Lets an employee work different
   * hours on different days (e.g. Mon 08:00–16:00, Tue 10:00–18:00). Each day
   * carries an availability flag plus a {@link EmployeeAvailabilityDay.preferred}
   * (comfortable) and a wider {@link EmployeeAvailabilityDay.acceptable} window.
   * Sparse: when absent the employee falls back to
   * {@link defaultEmployeeAvailability} (seeded from the legacy single windows
   * when present). Stored ordered Mon→Sun.
   */
  availability?: EmployeeAvailabilityDay[];
  createdAt: string;
  /**
   * ISO timestamp when this employee was archived. Archiving is the
   * history-preserving alternative to a permanent delete: it is used when an
   * employee has operational history (completed or future assigned missions)
   * that must be retained. An archived employee is also set {@link status}
   * inactive. Absent on active/deactivated records.
   */
  archivedAt?: string | null;
}

/**
 * A simple start/end time window in canonical "HH:MM" 24-hour form. Used for an
 * employee's acceptable and preferred working hours.
 */
export interface EmployeeTimeWindow {
  /** Start of the window, "HH:MM". */
  start: string;
  /** End of the window, "HH:MM". */
  end: string;
}

/**
 * One weekday of an employee's per-day availability. Describes whether the
 * employee works that day and, when {@link isAvailable}, their preferred
 * (comfortable) and wider acceptable working windows. The acceptable window
 * should be equal to or wider than the preferred window. Never generates or
 * moves customer bookings — it only describes the employee's availability.
 */
export interface EmployeeAvailabilityDay {
  weekday: Weekday;
  /** False marks the day as unavailable / non-working. */
  isAvailable: boolean;
  /** The employee's preferred (comfortable) window for this day. */
  preferred: EmployeeTimeWindow;
  /** The widest window the employee will work this day (outer bound). */
  acceptable: EmployeeTimeWindow;
}

/** The seven weekdays, used as stable keys for an employee working schedule. */
export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * One weekday of an employee's normal working schedule. Describes availability
 * and working hours only — it never generates or moves customer bookings (those
 * always come from the Schedule Core). When {@link isAvailable} is false the day
 * is a non-working day and its times/capacity are ignored.
 */
export interface EmployeeWorkingScheduleDay {
  weekday: Weekday;
  /** False marks the day as unavailable / non-working. */
  isAvailable: boolean;
  /** Normal start of the working day "HH:MM" (when available). */
  startTime: string;
  /** Normal end of the working day "HH:MM" (when available). */
  endTime: string;
  /** Optional unpaid break within the day, in minutes. */
  breakMinutes?: number;
  /**
   * Optional explicit daily capacity in hours. When set it overrides the
   * window-minus-break derivation, letting an admin cap plan-able hours below
   * the raw working window. When unset, capacity is derived from the window.
   */
  capacityHours?: number;
  /** Optional free-text note for the day (e.g. "Half day", "Remote"). */
  note?: string;
}

/** A full week of working-schedule days, ordered Monday→Sunday (length 7). */
export type EmployeeWorkingSchedule = EmployeeWorkingScheduleDay[];

/** A physical address on a customer card. Can be flagged as the invoice and/or
 * delivery address; at most one of each across a customer's addresses. */
export interface CustomerAddress {
  id: string;
  /** Optional label, e.g. "Head office", "Warehouse". */
  label?: string;
  street?: string;
  postalCode?: string;
  /**
   * Structured {@link PostalCity} this address belongs to. A customer can have
   * multiple addresses (e.g. invoice vs. delivery) in different postal cities,
   * so the link lives per-address. This is the ONLY source of an address's
   * city/postort — there is no free-text city fallback.
   */
  postalCityId?: string;
  country?: string;
  /** Marks this as the customer's invoice address. */
  isInvoice: boolean;
  /** Marks this as the customer's delivery address. */
  isDelivery: boolean;
}

/** A contact person attached to a customer card. */
export interface CustomerContact {
  id: string;
  name: string;
  /** Role or position, e.g. "Facility Manager". */
  title?: string;
  email?: string;
  phone?: string;
  /**
   * Marks the primary contact person. At most one per customer, and the primary
   * must always also be a contact person ({@link isContactPerson}).
   */
  isPrimary: boolean;
  /**
   * Whether this person is a contact person at all. Defaults to true on legacy
   * records (normalized on read). Secondary contact people have this true but
   * {@link isPrimary} false.
   */
  isContactPerson?: boolean;
  /** Marks the single invoice-responsible person; at most one per customer. */
  isInvoiceResponsible?: boolean;
  /** Marks the single agreement-responsible person; at most one per customer. */
  isAgreementResponsible?: boolean;
}

/** An internal, admin-only note on a customer card. Never visible to customers. */
export interface CustomerNote {
  id: string;
  text: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
}

/**
 * The audience a customer-card note is intended for. All types are admin-managed
 * today; assignment and finance notes are reserved for future workflows where
 * they may surface to employees or during invoicing.
 */
export type CustomerCardNoteType = "admin" | "assignment" | "finance";

/** A structured, typed note on a customer card. Archived rather than deleted. */
export interface CustomerCardNote {
  id: string;
  type: CustomerCardNoteType;
  title: string;
  content: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  status: EntityStatus;
}

/** Display metadata for the customer-card note types. */
export const CUSTOMER_CARD_NOTE_TYPES: {
  value: CustomerCardNoteType;
  label: string;
  /** Short note about who may see this type, now and in the future. */
  visibility: string;
}[] = [
  {
    value: "admin",
    label: "Customer Notes",
    visibility:
      "General customer information that applies across all work orders. Internal only — never visible to customers or employees.",
  },
  {
    value: "assignment",
    label: "Assignment Notes",
    visibility: "Visible in future assignment workflows.",
  },
  {
    value: "finance",
    label: "Economic Notes",
    visibility:
      "Financial and commercial information — pricing agreements, discounts and billing arrangements. Internal only.",
  },
];

export const CUSTOMER_CARD_NOTE_TYPE_LABELS: Record<CustomerCardNoteType, string> =
  Object.fromEntries(CUSTOMER_CARD_NOTE_TYPES.map((t) => [t.value, t.label])) as Record<
    CustomerCardNoteType,
    string
  >;

/** Lifecycle status of a work order. Advanced lifecycle logic is built later. */
export type WorkOrderStatus =
  | "draft"
  | "planned"
  | "in_progress"
  | "completed"
  | "inactive";

/** A typed, archivable note attached to a work order. Never deleted. */
export interface WorkOrderNote {
  id: string;
  title: string;
  content: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  status: EntityStatus;
}

/** Status of a single service row within a work order. */
export type WorkOrderServiceStatus = "planned" | "in_progress" | "completed" | "inactive";

/**
 * A per-employee planned-time override on a service row. Sparse by design: an
 * override is stored ONLY for an employee whose hours differ from the row's
 * service-level {@link WorkOrderServiceRow.plannedStartTime}/`plannedEndTime`.
 * Employees without an override follow the service-level window. Overrides are
 * only valid for ids present in {@link WorkOrderServiceRow.assignedEmployeeIds};
 * when an employee is unassigned, their override must be removed. This is the
 * forward-compatible data model only — no UI, editing, variation or schedule
 * logic is built yet.
 */
export interface EmployeeTimeOverride {
  /** The assigned employee this override applies to. */
  employeeId: string;
  /** Overridden start time "HH:MM". */
  startTime: string;
  /** Overridden end time "HH:MM". */
  endTime: string;
}

/**
 * Returns the subset of `overrides` that are valid for the given assigned
 * employees: the employee id must be assigned, both times must be valid 24h
 * "HH:MM" values forming a positive range, and at most one override per
 * employee is kept (first wins). Pure — safe to call during render or load-time
 * normalization. Returns [] when there are no valid overrides.
 */
export function filterValidEmployeeTimeOverrides(
  overrides: EmployeeTimeOverride[] | undefined | null,
  assignedEmployeeIds: string[] | undefined | null,
): EmployeeTimeOverride[] {
  if (!Array.isArray(overrides) || overrides.length === 0) return [];
  const assigned = new Set(Array.isArray(assignedEmployeeIds) ? assignedEmployeeIds : []);
  const seen = new Set<string>();
  const result: EmployeeTimeOverride[] = [];
  for (const o of overrides) {
    if (!o || typeof o.employeeId !== "string") continue;
    if (!assigned.has(o.employeeId) || seen.has(o.employeeId)) continue;
    if (calculatePlannedDurationMinutes(o.startTime, o.endTime) == null) continue;
    seen.add(o.employeeId);
    result.push({ employeeId: o.employeeId, startTime: o.startTime, endTime: o.endTime });
  }
  return result;
}

/**
 * A single service line inside a work order. When a service is added, the
 * relevant fields are copied from the source {@link Service} — the row is an
 * independent snapshot, never live-linked, so later catalog edits don't change
 * existing work orders. Archived rather than deleted.
 */
export interface WorkOrderServiceRow {
  id: string;
  /** Source catalog service id, for reference only (snapshot, not a live link). */
  sourceServiceId?: string | null;
  serviceName: string;
  articleNumber?: string;
  /** Category name snapshot at the time the service was added. */
  categoryName?: string;
  serviceType?: string;
  quantity: number;
  unit?: string;
  price?: number;
  vat?: number;
  status: WorkOrderServiceStatus;
  notes?: string;
  /**
   * The date the work is intended to happen (ISO "YYYY-MM-DD"). Required: the
   * Booking Queue needs a valid date to place the booking into the correct
   * planning period. This is the service's intended date, distinct from the
   * future Schedule module's assigned date.
   */
  serviceDate: string;
  /**
   * Optional inclusive end date ("YYYY-MM-DD") that bounds a recurring service.
   * Only meaningful when {@link recurrenceInterval} is not "one_time": recurring
   * occurrences are never generated after this date. When empty/undefined, the
   * recurrence continues until the Booking Generation Horizon. Must be on or
   * after {@link serviceDate}. One-time services do not use this field.
   */
  serviceEndDate?: string | null;
  /** Planned start of execution ("HH:MM"), independent of employee assignment. */
  plannedStartTime?: string;
  /** Planned end of execution ("HH:MM"). Duration is derived from start/end. */
  plannedEndTime?: string;
  /**
   * How often this service should recur, calculated from {@link serviceDate} as
   * the first occurrence. Defaults to "one_time". The Booking Queue will later
   * use this to generate recurring booking items — generation is NOT built yet;
   * this is the data model only.
   */
  recurrenceInterval?: RecurrenceInterval;
  /**
   * Employees expected to perform the work. Assignment is optional — a service
   * may exist with zero, one, or multiple assigned employees. Defaults to [].
   */
  assignedEmployeeIds: string[];
  /**
   * Number of open employee slots: staffing the service requires more people
   * than are currently assigned, but those employees aren't chosen yet. An open
   * slot is distinct from having no employees at all — e.g. one assigned
   * employee plus one open slot means a second person is still needed. Defaults
   * to 0 (no open slots). Used to derive the assignment status.
   */
  unassignedEmployeeSlots: number;
  /**
   * Sparse per-employee planned-time overrides. Only stored for assigned
   * employees whose hours differ from the service-level planned window;
   * everyone else follows {@link plannedStartTime}/{@link plannedEndTime}.
   * Undefined/empty for legacy data and one-window rows. Forward-compatible
   * data model only — no UI or schedule logic yet.
   */
  employeeTimeOverrides?: EmployeeTimeOverride[];
  /**
   * Pinned total planned labour effort, in minutes, that is preserved
   * independently of the staffing headcount. Set when a dispatcher removes an
   * employee but chooses to REDISTRIBUTE the workload onto the remaining
   * people (rather than leaving an open slot): the visit window may shrink the
   * headcount, but the total job time must not be lost. When null/undefined the
   * total labour scales with headcount as usual (visit duration × planned
   * headcount). Per-employee planned hours are then total labour ÷ assignees.
   */
  totalLabourMinutesOverride?: number | null;
  /**
   * Whether this row follows the customer's default cleaning day/time
   * preferences or overrides them with its own. Override logic is built later;
   * this prepares the data model only. Defaults to following customer defaults.
   */
  scheduleSource?: "customer_default" | "override";
  /** Service-specific cleaning preferences, used only when {@link scheduleSource} is "override". */
  schedulePreferences?: CustomerSchedulingPreferences;
  /**
   * Planned, recurring differences from this row's default schedule (e.g. every
   * 4th week, first Monday of the month). These are deliberate recurring
   * exceptions, not manual one-off changes. Scheduling automation that applies
   * them is built later; this is the data structure only. Archived rather than
   * deleted.
   */
  variations?: RecurringVariation[];
  /**
   * Optional link to a customer-specific {@link CustomerProtocolV2} that is the
   * recommended cleaning protocol for this service (Phase 3D). A service may
   * have no protocol or exactly one. This is a reference only — selecting a
   * protocol does NOT generate a ProtocolRun. Must reference a protocol owned by
   * this work order's customer (validated where the link is set).
   */
  customerProtocolId?: string | null;
  /**
   * Optional link to the executable {@link ProtocolRunV2} snapshot generated from
   * this row's linked customer protocol (Phase 3E). A row has at most one run;
   * generation is explicit (never automatic) and never overwrites an existing
   * run. `customerProtocolId` is the definition link; `protocolRunId` is the
   * executable snapshot link. Reference only — no run data is duplicated here.
   */
  protocolRunId?: string | null;
  /** Lower numbers appear first. */
  sortOrder: number;
  /** Archived rows are hidden by default but recoverable. */
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * How often a work-order service row repeats. The first occurrence is the row's
 * {@link WorkOrderServiceRow.serviceDate}; future occurrences are derived from
 * that date. Stable keys are stored, never the display text. Recurring booking
 * generation is built later — this is the data model only.
 */
export type RecurrenceInterval =
  | "one_time"
  | "daily"
  | "every_2_days"
  | "every_3_days"
  | "weekly"
  | "every_2_weeks"
  | "every_3_weeks"
  | "every_4_weeks"
  | "monthly"
  | "every_2_weeks_monday"
  | "every_3_months"
  | "every_6_months"
  | "yearly";

/** Display labels and order for {@link RecurrenceInterval}. */
export const RECURRENCE_INTERVALS: { value: RecurrenceInterval; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "daily", label: "Every day" },
  { value: "every_2_days", label: "Every other day" },
  { value: "every_3_days", label: "Every third day" },
  { value: "weekly", label: "Every week" },
  { value: "every_2_weeks", label: "Every other week" },
  { value: "every_3_weeks", label: "Every third week" },
  { value: "every_4_weeks", label: "Every fourth week" },
  { value: "monthly", label: "Once per month" },
  { value: "every_2_weeks_monday", label: "Every other Monday" },
  { value: "every_3_months", label: "Every third month" },
  { value: "every_6_months", label: "Every sixth month" },
  { value: "yearly", label: "Every year" },
];

/** Default recurrence for a newly created service row. */
export const DEFAULT_RECURRENCE_INTERVAL: RecurrenceInterval = "one_time";

export const RECURRENCE_INTERVAL_LABELS: Record<RecurrenceInterval, string> =
  Object.fromEntries(RECURRENCE_INTERVALS.map((r) => [r.value, r.label])) as Record<
    RecurrenceInterval,
    string
  >;

/** Display labels and order for work-order service row statuses. */
export const WORK_ORDER_SERVICE_STATUSES: { value: WorkOrderServiceStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "inactive", label: "Inactive" },
];

export const WORK_ORDER_SERVICE_STATUS_LABELS: Record<WorkOrderServiceStatus, string> =
  Object.fromEntries(WORK_ORDER_SERVICE_STATUSES.map((s) => [s.value, s.label])) as Record<
    WorkOrderServiceStatus,
    string
  >;

/**
 * How a recurring service variation repeats relative to the row's default
 * schedule rule. Scheduling automation that interprets these is built later.
 */
export type RecurringVariationFrequency =
  | "every_n_weeks"
  | "nth_weekday_of_month"
  | "every_n_visits";

/** Display labels and order for {@link RecurringVariationFrequency}. */
export const RECURRING_VARIATION_FREQUENCIES: {
  value: RecurringVariationFrequency;
  label: string;
}[] = [
  { value: "every_n_weeks", label: "Every few weeks" },
  { value: "nth_weekday_of_month", label: "A specific weekday each month" },
  { value: "every_n_visits", label: "Every few visits" },
];

export const RECURRING_VARIATION_FREQUENCY_LABELS: Record<
  RecurringVariationFrequency,
  string
> = Object.fromEntries(
  RECURRING_VARIATION_FREQUENCIES.map((f) => [f.value, f.label]),
) as Record<RecurringVariationFrequency, string>;

/**
 * Informational category describing why a recurring variation exists. This is
 * a label only for now — it does not affect scheduling logic.
 */
export type VariationType =
  | "time_change"
  | "extra_staff"
  | "different_employee"
  | "different_duration"
  | "extra_task"
  | "full_replacement";

/** Display labels and order for {@link VariationType}. */
export const VARIATION_TYPES: { value: VariationType; label: string }[] = [
  { value: "time_change", label: "Time Change" },
  { value: "extra_staff", label: "Extra Staff" },
  { value: "different_employee", label: "Different Employee" },
  { value: "different_duration", label: "Different Duration" },
  { value: "extra_task", label: "Extra Task" },
  { value: "full_replacement", label: "Full Replacement" },
];

export const VARIATION_TYPE_LABELS: Record<VariationType, string> =
  Object.fromEntries(
    VARIATION_TYPES.map((t) => [t.value, t.label]),
  ) as Record<VariationType, string>;

/**
 * Lifecycle status of a recurring variation, set explicitly by an admin.
 * - draft: prepared but not used; does not affect future scheduling.
 * - active: enabled; considered by future scheduling logic.
 * - inactive: temporarily disabled; retains all settings, can be reactivated.
 * - archived: hidden from normal views; recoverable, never deleted.
 */
export type VariationStatus = "draft" | "active" | "inactive" | "archived";

/** Display labels and order for {@link VariationStatus}. */
export const VARIATION_STATUSES: { value: VariationStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

export const VARIATION_STATUS_LABELS: Record<VariationStatus, string> =
  Object.fromEntries(
    VARIATION_STATUSES.map((s) => [s.value, s.label]),
  ) as Record<VariationStatus, string>;

/**
 * Calculated state shown to admins, derived from the variation's status and its
 * validity period. "future" and "expired" only apply to active variations whose
 * start date hasn't arrived or whose end date has passed.
 */
export type VariationDisplayState =
  | "draft"
  | "future"
  | "active"
  | "expired"
  | "inactive"
  | "archived";

export const VARIATION_DISPLAY_STATE_LABELS: Record<VariationDisplayState, string> = {
  draft: "Draft",
  future: "Future",
  active: "Active",
  expired: "Expired",
  inactive: "Inactive",
  archived: "Archived",
};

/** Ordinal position within a month for "Nth weekday of month" variations. */
export const WEEK_OF_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: 5, label: "Last" },
];

/**
 * A planned, recurring difference from a service row's default schedule. A row
 * can hold many variations. A variation may change the day, time, duration,
 * employee count and/or assigned employees, and carry its own notes. Variations
 * can be disabled (kept but inactive) and archived (hidden but recoverable);
 * they are never permanently deleted. Scheduling automation that applies these
 * is built later — this is the structure only.
 */
export interface RecurringVariation {
  id: string;
  /** Short label, e.g. "Every 4th week", "First Monday of every month". */
  name: string;
  /** Informational category describing why this variation exists. */
  type?: VariationType;
  /** How the variation recurs. */
  frequency: RecurringVariationFrequency;
  /** Interval N for "every_n_weeks" / "every_n_visits" frequencies. */
  interval?: number;
  /**
   * Optional 0-based occurrence index (anchored to the service series start, as
   * produced by {@link import("@/lib/variationResolver").occurrenceIndexFromStart})
   * that this variation is anchored to. When set, the variation first applies at
   * this occurrence and then every {@link interval} occurrences after it
   * (`occurrenceIndex >= anchor && (occurrenceIndex - anchor) % interval === 0`).
   * When omitted, matching falls back to the legacy series-phased rule
   * (`(occurrenceIndex + 1) % interval === 0`), so existing variations are
   * unchanged. Only affects "every_n_weeks" / "every_n_visits" frequencies.
   */
  anchorOccurrenceIndex?: number;
  /** Ordinal week (1–5) for the "nth_weekday_of_month" frequency. */
  weekOfMonth?: number;
  /** Day of week for the "nth_weekday_of_month" frequency. */
  weekday?: WeekDay;
  /** Overridden cleaning day for this variation, when different from default. */
  day?: WeekDay;
  /** Overridden start time "HH:mm", when different from default. */
  startTime?: string;
  /** Overridden end time "HH:mm", when different from default. */
  endTime?: string;
  /** Overridden duration in minutes, when different from default. */
  durationMinutes?: number;
  /**
   * Legacy/migration-only. Older variations stored a flat required-employee
   * count here. New staffing uses {@link assignedEmployeeIds} (absolute) and
   * {@link unassignedSlotsDelta} (additive); prefer those for any new logic.
   * @deprecated Kept for backward compatibility — do not use for new staffing.
   */
  employeeCount?: number;
  /** Overridden assigned employee ids, when different from default (absolute). */
  assignedEmployeeIds?: string[];
  /**
   * Additive change to the base occurrence's open (unassigned) staffing slots.
   * Positive adds slots, negative removes them. When several variations chain on
   * the same occurrence, these deltas SUM (unlike absolute fields, where the
   * last variation in chain order wins). Undefined means no change.
   */
  unassignedSlotsDelta?: number;
  /**
   * Order in which this variation is applied when multiple variations chain onto
   * the same occurrence (lower runs first). Falls back to {@link createdAt}
   * ascending when unset. Also referred to as priority.
   */
  chainOrder?: number;
  /**
   * Set when this variation was superseded via "Replace existing variation":
   * the id of the variation that replaced it. The replaced variation is also
   * moved to an inactive/archived {@link status} and stops applying.
   */
  replacedByVariationId?: string;
  /**
   * Set on a replacement variation: the id of the variation it replaced. Lets
   * the UI trace the supersession chain. Replacement flow itself is built later.
   */
  replacesVariationId?: string;
  /** ISO timestamp when this variation was replaced/superseded, if ever. */
  replacedAt?: string;
  /** Free-form internal note for this variation (admin-facing). */
  internalNote?: string;
  /** Short reason explaining why this variation exists. */
  reason?: string;
  /** Legacy free-form notes for this variation. */
  notes?: string;
  /**
   * Lifecycle status set by an admin. Authoritative for whether the variation is
   * used by future scheduling. Older records may omit this; use
   * {@link getVariationStatus} to derive it safely.
   */
  status?: VariationStatus;
  /** Inclusive start date "YYYY-MM-DD". Empty means it applies immediately. */
  appliesFrom?: string;
  /** Inclusive end date "YYYY-MM-DD". Empty means it applies indefinitely. */
  appliesUntil?: string;
  /** Legacy: disabled variations are kept but not applied. Superseded by status. */
  enabled: boolean;
  /** Legacy: archived variations are hidden by default. Superseded by status. */
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolves the effective {@link VariationStatus} of a variation, falling back to
 * the legacy `archived`/`enabled` booleans for records created before status
 * existed.
 */
export function getVariationStatus(v: RecurringVariation): VariationStatus {
  if (v.status) return v.status;
  if (v.archived) return "archived";
  if (v.enabled === false) return "inactive";
  return "active";
}

/**
 * Computes the calculated {@link VariationDisplayState} from a variation's status
 * and validity window. `today` is an ISO date string "YYYY-MM-DD"; defaults to
 * the current date. Expired variations are never auto-deleted — they remain
 * visible and recoverable.
 */
export function getVariationDisplayState(
  v: RecurringVariation,
  today: string = new Date().toISOString().slice(0, 10),
): VariationDisplayState {
  const status = getVariationStatus(v);
  if (status === "archived") return "archived";
  if (status === "draft") return "draft";
  if (status === "inactive") return "inactive";
  if (v.appliesFrom && today < v.appliesFrom) return "future";
  if (v.appliesUntil && today > v.appliesUntil) return "expired";
  return "active";
}

/** The kind of action recorded in a work order's activity log. */
export type WorkOrderActivityAction =
  | "created"
  | "updated"
  | "status_changed"
  | "activated"
  | "inactivated"
  | "note_added"
  | "note_edited"
  | "note_archived"
  | "note_restored"
  | "service_added"
  | "service_edited"
  | "service_archived"
  | "service_restored"
  | "service_deleted"
  | "service_force_deleted"
  | "service_reordered"
  | "variation_added"
  | "variation_edited"
  | "variation_disabled"
  | "variation_enabled"
  | "variation_archived"
  | "variation_restored"
  | "variation_stopped"
  | "variation_deleted"
  | "variation_status_changed"
  | "variation_dates_changed"
  | "time_reported"
  | "booking_queued"
  | "booking_cancelled"
  | "booking_restored"
  | "booking_rescheduled"
  | "media_attached"
  | "media_detached"
  | "media_uploaded"
  | "media_placed"
  | "media_placement_removed";

/** An immutable entry in a work order's activity log. Newest displayed first. */
export interface WorkOrderActivity {
  id: string;
  action: WorkOrderActivityAction;
  /** Human-readable description of what happened. */
  summary: string;
  actorId: string | null;
  actorName: string;
  /** ISO timestamp of when the action happened. */
  at: string;
}

/**
 * Where inside a work order an image placement appears. A placement is a
 * lightweight *link* to a customer-owned {@link MediaAsset} — it never copies or
 * owns the image. The same asset may be placed in multiple locations.
 *  - `header`      — the work-order identity header strip.
 *  - `service_row` — a specific service row (see {@link WorkOrderMediaPlacement.serviceRowId}).
 *  - `general`     — reserved for future, unscoped placements.
 */
export type WorkOrderMediaPlacementType = "header" | "service_row" | "general";

/**
 * A link placing a Customer Media Library asset at a location inside a work
 * order. The work order owns the *placement*, never the image: removing a
 * placement only deletes this link, while the {@link MediaAsset} stays in the
 * Customer Media Library. One asset can be referenced by many placements, so no
 * duplicate uploads are ever required.
 */
export interface WorkOrderMediaPlacement {
  id: string;
  /** The customer-owned media asset this placement points at. */
  mediaAssetId: string;
  placementType: WorkOrderMediaPlacementType;
  /**
   * The service row this placement belongs to, when {@link placementType} is
   * "service_row". Null/undefined for header and general placements.
   */
  serviceRowId?: string | null;
  /**
   * Per-placement employee-app visibility. Stored on the link (NOT the asset),
   * so the same image can be shown for one service and hidden for another.
   * Defaults to true. Future Employee App workflows filter on this flag.
   */
  visibleToEmployee: boolean;
  /** Lower numbers appear first within the same placement area. */
  sortOrder: number;
  createdAt: string;
}

/**
 * A work order connected to a customer. A work order is a container: services,
 * employee assignment and scheduling are added later inside it. This is the
 * foundation only.
 */
export interface WorkOrder {
  id: string;
  companyId: string;
  customerId: string;
  /** Human-friendly number, e.g. "WO-1001". */
  number: string;
  /** Optional work-order title. A work order is a container for service rows. */
  title?: string;
  /**
   * Legacy single-service label kept for backwards compatibility. A work order
   * is a container that holds multiple service rows (built later); no single
   * service is required at creation.
   */
  service?: string;
  status: WorkOrderStatus;
  startDate?: string;
  endDate?: string;
  /** Name of the assigned employee or team (legacy; rows carry this later). */
  assignedTo?: string;
  /** User id of the creator, when known. */
  createdBy?: string | null;
  /** Snapshot of the creator's name at creation time. */
  createdByName?: string;
  /** Work-order notes (admin-managed). Archived rather than deleted. */
  notes?: WorkOrderNote[];
  /** Service rows. A work order is a container for multiple services. */
  serviceRows?: WorkOrderServiceRow[];
  /** Activity log, automatically tracked. Newest first when displayed. */
  activity?: WorkOrderActivity[];
  /**
   * Image placement links pointing at Customer Media Library assets. These are
   * references only — the customer remains the image owner. See
   * {@link WorkOrderMediaPlacement}.
   */
  mediaPlacements?: WorkOrderMediaPlacement[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Display labels and order for the work-order statuses a user can pick. Note
 * that `inactive` is reached through the Inactivate action rather than chosen
 * directly during creation, but it is a valid stored status.
 */
export const WORK_ORDER_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "inactive", label: "Inactive" },
];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> =
  Object.fromEntries(WORK_ORDER_STATUSES.map((s) => [s.value, s.label])) as Record<
    WorkOrderStatus,
    string
  >;

/**
 * Per-company Work Order cleanup configuration. Controls automatic archiving so
 * admins primarily see active, relevant work orders while archived data stays
 * searchable and recoverable. Future integrations (invoicing, payroll exports,
 * scheduling, reporting) can trigger archiving against these thresholds.
 */
export interface WorkOrderSettings {
  companyId: string;
  /**
   * Days after a work order has zero active service rows before it is
   * automatically archived. `null` disables the rule.
   */
  autoArchiveEmptyAfterDays: number | null;
  /**
   * Days after a service row's end date has passed (and it has been invoiced
   * and/or exported to payroll) before the row is automatically archived.
   * `null` disables the rule.
   */
  autoArchiveCompletedRowsAfterDays: number | null;
  /**
   * AO (Work Order Services) setting. Number of days a service remains in the
   * "Archive Upcoming" lifecycle stage (eligible for archival) before the future
   * auto-archive process will archive it automatically. `null` disables
   * automatic archival entirely — eligible services stay in Archive Upcoming
   * until an administrator archives them manually. Defaults to 30. The automatic
   * archival job is not implemented yet; this value only configures it.
   */
  autoArchiveDelayDays: number | null;
  /**
   * Whether this company has activated the optional Preferred Time Evaluation
   * add-on. When true, the app may surface whether scheduled service times match
   * the customer's preferred days/time windows (Optimal / Acceptable / Outside
   * range). This company-level switch only takes effect when the platform Master
   * Admin has allowed the feature (see
   * {@link SystemSettings.allowPreferredTimeEvaluation}). Defaults to false.
   */
  preferredTimeEvaluationEnabled: boolean;
  updatedAt: string;
}

/** Selectable auto-archive thresholds. `null` means the rule is disabled. */
export const AUTO_ARCHIVE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Disabled" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

/**
 * Selectable Auto Archive Delay options for the AO settings section. `null`
 * means automatic archival is disabled (services stay in Archive Upcoming until
 * archived manually).
 */
export const AUTO_ARCHIVE_DELAY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Disabled" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

/** Default Auto Archive Delay (days) applied when a company hasn't customized it. */
export const DEFAULT_AUTO_ARCHIVE_DELAY_DAYS = 30;

/** Returns disabled-by-default work order settings for a company. */
export function defaultWorkOrderSettings(companyId: string): WorkOrderSettings {
  return {
    companyId,
    autoArchiveEmptyAfterDays: null,
    autoArchiveCompletedRowsAfterDays: null,
    autoArchiveDelayDays: DEFAULT_AUTO_ARCHIVE_DELAY_DAYS,
    preferredTimeEvaluationEnabled: false,
    updatedAt: new Date().toISOString(),
  };
}

/** Normalizes possibly-legacy persisted work order settings, filling new fields with defaults. */
export function normalizeWorkOrderSettings(
  settings: WorkOrderSettings,
): WorkOrderSettings {
  return {
    ...defaultWorkOrderSettings(settings.companyId),
    ...settings,
    autoArchiveDelayDays:
      settings.autoArchiveDelayDays === undefined
        ? DEFAULT_AUTO_ARCHIVE_DELAY_DAYS
        : settings.autoArchiveDelayDays,
    preferredTimeEvaluationEnabled: settings.preferredTimeEvaluationEnabled === true,
  };
}

/**
 * Per-company Time Reporting configuration. Controls whether employee time
 * reports can be approved automatically and how much deviation between the
 * scheduled and actual time is tolerated before an administrator must review
 * the report. Future time-reporting workflows consume these values when an
 * employee submits and confirms a time report.
 */
export interface TimeReportSettings {
  companyId: string;
  /**
   * When true, time reports whose deviation is within
   * {@link deviationToleranceMinutes} become eligible for automatic approval.
   * When false, every time report requires administrator approval.
   */
  autoApproveEnabled: boolean;
  /**
   * Allowed absolute deviation, in minutes, between scheduled and actual time.
   * Applies symmetrically to positive and negative deviations. `0` means the
   * actual time must match the scheduled time exactly.
   */
  deviationToleranceMinutes: number;
  updatedAt: string;
}

/** Suggested deviation-tolerance presets, in minutes. */
export const TIME_DEVIATION_TOLERANCE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "0 minutes (exact match)" },
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "60 minutes" },
];

/**
 * Per-company Time configuration. Holds the ordered Quick Duration presets used
 * to fill the planned end time from a planned start across the app (Add/Edit
 * Service, Variation Wizard, Schedule, Quick Booking). Presets are stored in
 * MINUTES — never decimal hours — so calculations stay exact; the UI renders a
 * decimal-hours label (60 → "1", 105 → "1.75").
 */
export interface DurationSettings {
  companyId: string;
  /** Ordered Quick Duration presets, in minutes. Order is the display order. */
  presetMinutes: number[];
  updatedAt: string;
}

/** Default Quick Duration presets, in minutes (1, 1.25, 1.5 … 4, 4.5 hours). */
export const DEFAULT_DURATION_PRESETS_MINUTES: number[] = [
  60, 75, 90, 105, 120, 135, 150, 165, 180, 210, 240, 270,
];

/** Returns the default Quick Duration settings for a company. */
export function defaultDurationSettings(companyId: string): DurationSettings {
  return {
    companyId,
    presetMinutes: [...DEFAULT_DURATION_PRESETS_MINUTES],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Normalizes a list of duration presets: keeps only positive whole minutes,
 * removes duplicates while preserving order. Used when persisting settings so
 * stored data is always clean.
 */
export function normalizeDurationPresets(minutes: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of minutes) {
    const m = Math.round(raw);
    if (!Number.isFinite(m) || m <= 0 || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/**
 * Checklist Manager V2 — Floor Preset (Phase 1 Foundation).
 *
 * A reusable floor/location level (Basement, Ground floor, Attic, …) that a
 * company configures once and later multi-selects when building checklist
 * protocols. This ticket establishes the model + storage only; management UI,
 * drag-and-drop ordering and protocol integration arrive in later tickets.
 *
 * Design notes:
 *  - Company-scoped (`companyId`) so each tenant curates its own list.
 *  - `sortOrder` makes display order explicit and is the anchor for future
 *    drag-and-drop reordering (deterministic sort, not insertion order).
 *  - `isArchived` is a soft-delete: archived presets disappear from active
 *    pickers but remain resolvable for historical references later.
 *  - Optional `locale`/`countryCode` support country-specific naming.
 *  - Optional `originType`/`originId`/`version` reserve provenance for the
 *    Global/Company/Customer layering introduced in later phases.
 */
export interface FloorPreset {
  id: string;
  companyId: string;
  /** Display name, e.g. "Ground floor". */
  name: string;
  /** Optional clarifying note shown in management UI. */
  description?: string;
  /** Explicit display order; lower comes first. */
  sortOrder: number;
  /** Soft-delete flag — archived presets are hidden from active lists. */
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optional BCP-47 locale for country-specific naming (future). */
  locale?: string;
  /** Optional ISO 3166-1 alpha-2 country code (future). */
  countryCode?: string;
  /** Provenance: where this preset originated (future layering). */
  originType?: "global" | "company" | "customer" | "seed";
  /** Provenance: id of the source preset this was copied from (future). */
  originId?: string;
  /** Optional version counter for future provenance tracking. */
  version?: number;
}

/** A default floor preset definition (no identity / company binding yet). */
export interface FloorPresetSpec {
  name: string;
  description?: string;
}

/**
 * Default floor presets seeded for a new company, in display order. Editable
 * later — these are starting points only, never enforced.
 */
export const DEFAULT_FLOOR_PRESET_SPECS: FloorPresetSpec[] = [
  { name: "Basement" },
  { name: "Entrance level" },
  { name: "Ground floor" },
  { name: "First floor" },
  { name: "Second floor" },
  { name: "Third floor" },
  { name: "Upper floor" },
  { name: "Attic" },
  { name: "Outdoor area" },
  { name: "Other" },
];

/**
 * Deterministic ordering for floor presets: by `sortOrder` ascending, then
 * `createdAt`, then `id` as a final tie-breaker so the order is stable across
 * reads regardless of insertion order.
 */
export function sortFloorPresets(presets: FloorPreset[]): FloorPreset[] {
  return [...presets].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Normalizes a preset name for duplicate detection (trim + case-fold). */
export function normalizeFloorPresetName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Checklist Manager V2 — Category Foundation (Phase 1 Foundation).
 *
 * One reusable, company-scoped category model shared across every checklist
 * domain (rooms, tasks, instructions, quality standards, media, templates,
 * industries). It exists to gradually replace the scattered hardcoded TS
 * category unions (`RoomLibraryCategory`, `TaskLibraryCategory`, `MediaCategory`)
 * with a single managed, editable data source.
 *
 * This ticket establishes the model + storage only; management UI, drag-and-drop
 * ordering and consumer integration (libraries, protocol builder) arrive later.
 * The existing hardcoded unions are intentionally left in place so nothing
 * breaks — they are migrated in a later ticket.
 *
 * Design notes mirror {@link FloorPreset}:
 *  - Company-scoped (`companyId`) so each tenant curates its own list.
 *  - `type` partitions categories into domains; a name may repeat across types
 *    but must be unique within a (company, type) pair.
 *  - `sortOrder` anchors deterministic ordering and future drag-and-drop.
 *  - `isArchived` is a soft-delete preserving historical references.
 *  - Optional `icon`/`color` reserve future visual treatment (UI only later).
 *  - Optional `locale`/`countryCode`/`originType`/`originId`/`version` reserve
 *    localization and provenance for the Global/Company/Customer layering.
 */
export type ChecklistCategoryType =
  | "room"
  | "task"
  | "instruction"
  | "quality"
  | "media"
  | "template"
  | "industry";

/** All category types, in the order they surface under Settings → Checklists. */
export const CHECKLIST_CATEGORY_TYPES: ChecklistCategoryType[] = [
  "room",
  "task",
  "instruction",
  "quality",
  "media",
  "template",
  "industry",
];

export interface ChecklistCategory {
  id: string;
  companyId: string;
  /** Which checklist domain this category belongs to. */
  type: ChecklistCategoryType;
  /** Display name, e.g. "Bathroom". */
  name: string;
  /** Optional clarifying note shown in management UI. */
  description?: string;
  /** Explicit display order within its (company, type); lower comes first. */
  sortOrder: number;
  /** Soft-delete flag — archived categories are hidden from active lists. */
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optional icon name reserved for future visual treatment. */
  icon?: string;
  /** Optional color (hex/token) reserved for future visual treatment. */
  color?: string;
  /** Optional BCP-47 locale for country-specific naming (future). */
  locale?: string;
  /** Optional ISO 3166-1 alpha-2 country code (future). */
  countryCode?: string;
  /** Provenance: where this category originated (future layering). */
  originType?: "global" | "company" | "customer" | "seed";
  /** Provenance: id of the source category this was copied from (future). */
  originId?: string;
  /** Optional version counter for future provenance tracking. */
  version?: number;
}

/** A default category definition (no identity / company binding yet). */
export interface ChecklistCategorySpec {
  name: string;
  description?: string;
}

/**
 * Default seed categories per type, in display order. Conservative starting
 * points only — fully editable later, never enforced.
 */
export const DEFAULT_CHECKLIST_CATEGORY_SPECS: Record<
  ChecklistCategoryType,
  ChecklistCategorySpec[]
> = {
  room: [
    { name: "Kitchen" },
    { name: "Bathroom" },
    { name: "Toilet" },
    { name: "Office" },
    { name: "Meeting Room" },
    { name: "Bedroom" },
    { name: "Living Area" },
    { name: "Common Area" },
    { name: "Reception" },
    { name: "Hallway" },
    { name: "Staircase" },
    { name: "Storage" },
    { name: "Laundry Area" },
    { name: "Outdoor Area" },
    { name: "Other" },
  ],
  task: [
    { name: "Dusting" },
    { name: "Vacuuming" },
    { name: "Mopping" },
    { name: "Sanitizing" },
    { name: "Waste Handling" },
    { name: "Restocking" },
    { name: "Glass & Mirrors" },
    { name: "Kitchen Cleaning" },
    { name: "Bathroom Cleaning" },
    { name: "Surface Cleaning" },
    { name: "Detail Cleaning" },
    { name: "Inspection" },
    { name: "Other" },
  ],
  instruction: [
    { name: "Cleaning Method" },
    { name: "Safety" },
    { name: "Equipment" },
    { name: "Chemical Use" },
    { name: "Customer-Specific" },
    { name: "Sequence / Workflow" },
    { name: "Access & Keys" },
    { name: "Waste Handling" },
    { name: "Other" },
  ],
  quality: [
    { name: "Surface Quality" },
    { name: "Hygiene" },
    { name: "Presentation" },
    { name: "Safety" },
    { name: "Odor" },
    { name: "Restocking" },
    { name: "Customer Requirement" },
    { name: "Final Inspection" },
    { name: "Other" },
  ],
  media: [
    { name: "Before Photo" },
    { name: "After Photo" },
    { name: "Instruction Image" },
    { name: "Reference Photo" },
    { name: "Damage Photo" },
    { name: "Quality Example" },
    { name: "Reference Document" },
    { name: "Customer Attachment" },
    { name: "Other" },
  ],
  template: [
    { name: "Regular Cleaning" },
    { name: "Deep Cleaning" },
    { name: "Move-Out Cleaning" },
    { name: "Office Cleaning" },
    { name: "Residential Cleaning" },
    { name: "Commercial Cleaning" },
    { name: "Post-Construction Cleaning" },
    { name: "Special Service" },
    { name: "Inspection Checklist" },
    { name: "Other" },
  ],
  industry: [
    { name: "Residential" },
    { name: "Office" },
    { name: "Retail" },
    { name: "Healthcare" },
    { name: "Hospitality" },
    { name: "Education" },
    { name: "Industrial" },
    { name: "Property Management" },
    { name: "Public Sector" },
    { name: "Other" },
  ],
};

/**
 * Deterministic ordering for checklist categories: by `sortOrder` ascending,
 * then `createdAt`, then `id` as a final tie-breaker so order is stable across
 * reads regardless of insertion order.
 */
export function sortChecklistCategories(
  categories: ChecklistCategory[],
): ChecklistCategory[] {
  return [...categories].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Normalizes a category name for duplicate detection (trim + case-fold). */
export function normalizeChecklistCategoryName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Checklist Manager V2 — Template / Section / Item models (Phase 2 Foundation).
 *
 * The data backbone of a checklist: a `ChecklistTemplateV2` owns ordered
 * `ChecklistSection`s, each owning ordered `ChecklistItem`s.
 *
 *   Template
 *   └── Section
 *       └── Item
 *
 * This phase is the data foundation only — no execution, completion tracking,
 * signatures, inspection results or protocol-runtime behavior live here. The
 * models deliberately mirror the {@link FloorPreset} / {@link ChecklistCategory}
 * conventions established in Phase 1:
 *  - Company-scoped (`companyId`) so each tenant curates its own data; child
 *    rows carry `companyId` too for cheap scoped reads and integrity checks.
 *  - `sortOrder` anchors deterministic ordering and future drag-and-drop.
 *  - `isArchived` on templates is a soft-delete preserving historical
 *    references (sections/items are owned children, deleted with their parent).
 *  - Optional `originType`/`originId`/`version` reserve provenance for the
 *    Global/Company/Customer layering introduced in later phases.
 */
/**
 * Ownership tier of a {@link ChecklistTemplateV2}:
 *  - `global`: system-owned, `companyId` is null, read-only for company admins,
 *    managed by Super Admin. A starting library of best-practice templates.
 *  - `company`: company-owned, fully editable, created from scratch or copied
 *    from a global template (a one-time deep copy — never inheritance/sync).
 */
export type ChecklistTemplateScope = "global" | "company";

/**
 * Audience a {@link ChecklistTemplateV2} is tailored for. Drives template
 * discovery and recommendations in the picker — it does not restrict usage
 * (any template can still be used for any customer):
 *  - `b2b`: business / commercial (offices, property management).
 *  - `b2c`: private households (homes, apartments).
 *  - `general`: broadly applicable (e.g. move-out / deep cleaning).
 */
export type TemplateAudience = "b2b" | "b2c" | "general";

/** Display labels for {@link TemplateAudience}. */
export const TEMPLATE_AUDIENCE_LABELS: Record<TemplateAudience, string> = {
  b2b: "B2B",
  b2c: "B2C",
  general: "General",
};

export interface ChecklistTemplateV2 {
  id: string;
  /**
   * Owning company for `company` templates; null for `global` templates
   * (system-owned). Reads stay scoped: company lookups never surface globals
   * and vice-versa.
   */
  companyId: string | null;
  /** Ownership tier — separates the global library from company templates. */
  scope: ChecklistTemplateScope;
  /**
   * Audience this template targets, for discovery / recommendations. Optional
   * for backwards compatibility — templates created before classification have
   * no audience and are treated as `general` for recommendation matching.
   */
  audience?: TemplateAudience;
  /** Display name, e.g. "Regular Office Cleaning". */
  name: string;
  /** Optional clarifying note shown in management UI. */
  description?: string;
  /** Linked checklist category ids (any type) — references, not ownership. */
  categoryIds: string[];
  /** Linked floor preset ids — references, not ownership. */
  floorPresetIds: string[];
  /** Explicit display order; lower comes first. */
  sortOrder: number;
  /** Soft-delete flag — archived templates are hidden from active lists. */
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Provenance: where this template originated (future layering). */
  originType?: "global" | "company" | "customer" | "seed";
  /** Provenance: id of the source template this was copied from (future). */
  originId?: string;
  /**
   * Provenance (informational only — no active linkage): id of the global
   * template a `company` template was deep-copied from, if any.
   */
  sourceGlobalTemplateId?: string;
  /** Provenance: name of the source global template at copy time. */
  sourceGlobalTemplateName?: string;
  /** Optional version counter for future provenance tracking. */
  version?: number;
  /** Schema version stamped at creation ({@link CHECKLIST_V2_SCHEMA_VERSION}). */
  schemaVersion?: number;
}

export interface ChecklistSection {
  id: string;
  /** Owning template. */
  templateId: string;
  /** Denormalized owner company (null for global-template sections). */
  companyId: string | null;
  /** Display title, e.g. "Kitchen". */
  title: string;
  /** Explicit display order within its template; lower comes first. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  /** Owning section. */
  sectionId: string;
  /** Denormalized owning template for scoped reads / integrity. */
  templateId: string;
  /** Denormalized owner company (null for global-template items). */
  companyId: string | null;
  /** Display title, e.g. "Wipe down counters". */
  title: string;
  /** Optional longer instruction shown under the title. */
  description?: string;
  /** Whether the item is mandatory (foundation flag; no runtime yet). */
  required: boolean;
  /** Explicit display order within its section; lower comes first. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** A default checklist item definition (no identity / binding yet). */
export interface ChecklistItemSpec {
  title: string;
  description?: string;
  required?: boolean;
}

/** A default checklist section definition with its items. */
export interface ChecklistSectionSpec {
  title: string;
  items: ChecklistItemSpec[];
}

/** A default checklist template definition with its nested sections/items. */
export interface ChecklistTemplateV2Spec {
  name: string;
  description?: string;
  sections: ChecklistSectionSpec[];
}

/**
 * Default checklist templates seeded for a new company, in display order.
 * Conservative starting points only — fully editable later, never enforced.
 */
export const DEFAULT_CHECKLIST_TEMPLATE_SPECS: ChecklistTemplateV2Spec[] = [
  {
    name: "Regular Office Cleaning",
    description: "Standard recurring clean for office spaces.",
    sections: [
      {
        title: "Workspaces",
        items: [
          { title: "Empty waste bins and replace liners", required: true },
          { title: "Dust desks and surfaces" },
          { title: "Wipe down shared equipment" },
        ],
      },
      {
        title: "Kitchen / Break Room",
        items: [
          { title: "Clean countertops and sink", required: true },
          { title: "Wipe appliance exteriors" },
          { title: "Restock paper towels and soap" },
        ],
      },
      {
        title: "Restrooms",
        items: [
          { title: "Sanitize toilets and urinals", required: true },
          { title: "Clean mirrors and sinks", required: true },
          { title: "Mop floors" },
        ],
      },
    ],
  },
  {
    name: "Move-Out Deep Clean",
    description: "Thorough end-of-tenancy clean for residential units.",
    sections: [
      {
        title: "Kitchen",
        items: [
          { title: "Clean inside oven and fridge", required: true },
          { title: "Degrease range hood and backsplash" },
          { title: "Wipe inside cabinets and drawers" },
        ],
      },
      {
        title: "Bathroom",
        items: [
          { title: "Descale shower, tub and tiles", required: true },
          { title: "Sanitize toilet thoroughly", required: true },
          { title: "Polish fixtures and mirrors" },
        ],
      },
    ],
  },
];

/**
 * Deterministic ordering for checklist templates: by `sortOrder` ascending,
 * then `createdAt`, then `id` as a final tie-breaker so order is stable across
 * reads regardless of insertion order.
 */
export function sortChecklistTemplates(
  templates: ChecklistTemplateV2[],
): ChecklistTemplateV2[] {
  return [...templates].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Deterministic ordering for checklist sections (same rule as templates). */
export function sortChecklistSections(
  sections: ChecklistSection[],
): ChecklistSection[] {
  return [...sections].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Deterministic ordering for checklist items (same rule as templates). */
export function sortChecklistItems(
  items: ChecklistItem[],
): ChecklistItem[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Normalizes a template name for duplicate detection (trim + case-fold). */
export function normalizeChecklistTemplateName(name: string): string {
  return name.trim().toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Checklist Manager V2 — Protocol execution snapshots (Phase 3A)              */
/* -------------------------------------------------------------------------- */
/**
 * Execution snapshot models. Generating a protocol run deep-copies a
 * {@link ChecklistTemplateV2} (and its sections/items) into independent rows so
 * that later template edits NEVER affect runs already generated — the approved
 * snapshot architecture, mirroring the legacy {@link CustomerProtocol} pattern.
 *
 *   ProtocolRunV2
 *   └── ProtocolRunSection
 *       └── ProtocolRunItem
 *
 * This is the execution data foundation only — no employee UI, booking/work-order
 * integration, photos, signatures, deviations or inspection results live here.
 * Conventions mirror Phase 1/2: company-scoped (`companyId` on every row),
 * `sortOrder` for deterministic ordering, child rows denormalize `runId`.
 */

/**
 * Current schema version for the Checklist Manager V2 execution-anchoring models
 * (Phase 4A, Ticket 55). Stamped onto {@link ChecklistTemplateV2},
 * {@link CustomerProtocolV2}, {@link ProtocolRunV2} and {@link VisitOccurrence}
 * at creation so future Supabase migrations have explicit version metadata to
 * branch on. This is metadata only — there is no migration framework yet.
 * Records persisted before versioning are normalized to version 1 on read.
 */
export const CHECKLIST_V2_SCHEMA_VERSION = 1;

/** Lifecycle status of a protocol run. */
export type ProtocolRunStatus =
  | "draft"
  | "in_progress"
  | "completed"
  | "cancelled";

/** Completion status of a single run item. */
export type ProtocolRunItemStatus = "pending" | "done" | "skipped" | "na";

export interface ProtocolRunV2 {
  id: string;
  companyId: string;
  /** Id of the template this run was generated from (reference only). */
  sourceTemplateId: string;
  /** Snapshotted template name at generation time. */
  sourceTemplateName: string;
  /** Snapshotted template version at generation time. */
  sourceTemplateVersion: number;
  /**
   * When generated from a {@link CustomerProtocolV2} (the operational AO path,
   * Phase 3E), the id of that customer protocol (reference only). Runs generated
   * directly from a template leave this undefined.
   */
  sourceCustomerProtocolId?: string;
  /** Snapshotted customer protocol name at generation time, if generated from one. */
  sourceCustomerProtocolName?: string;
  /** Customer the run belongs to when generated from a customer protocol. */
  customerId?: string;
  /** Optional originating booking (no booking integration yet). */
  bookingId?: string;
  /** Optional originating work order (no work-order integration yet). */
  workOrderId?: string;
  /**
   * Execution anchor (Phase 4A, Ticket 53): the {@link VisitOccurrence} this run
   * belongs to. A recurring service produces many occurrences; binding the run
   * to a specific occurrence gives every execution a stable operational identity
   * (Customer Protocol → VisitOccurrence → ProtocolRun). Optional for backwards
   * compatibility — runs generated before anchoring leave this undefined and
   * still resolve via `workOrderId`.
   */
  visitOccurrenceId?: string;
  /**
   * Employees assigned to execute this run (Phase 4A, Ticket 54). One run is
   * shared by a team — there is never one run per employee. Empty/undefined
   * means unassigned. Per-item `completedBy` still records who completed each
   * item. No assignment UI exists yet; this is the data foundation.
   */
  assignedEmployeeIds?: string[];
  /** Schema version stamped at creation ({@link CHECKLIST_V2_SCHEMA_VERSION}). */
  schemaVersion?: number;
  status: ProtocolRunStatus;
  /** ISO timestamp the snapshot was generated. */
  generatedAt: string;
  /** Id of the user/actor that generated the run. */
  generatedBy: string;
  /** ISO timestamp the run reached `completed`, if it has. */
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolRunSection {
  id: string;
  companyId: string;
  /** Owning run. */
  runId: string;
  /** Snapshotted section title. */
  title: string;
  /** Explicit display order within its run; lower comes first. */
  sortOrder: number;
}

export interface ProtocolRunItem {
  id: string;
  companyId: string;
  /** Owning run (denormalized for cheap scoped reads). */
  runId: string;
  /** Owning section. */
  sectionId: string;
  /** Snapshotted item title. */
  title: string;
  /** Snapshotted item description. */
  description?: string;
  /** Snapshotted required flag. */
  required: boolean;
  /** Explicit display order within its section; lower comes first. */
  sortOrder: number;
  /** Runtime completion status (initialized to `pending`). */
  status: ProtocolRunItemStatus;
  /** Id of the actor that completed the item, if any. */
  completedBy?: string;
  /** ISO timestamp the item was completed, if any. */
  completedAt?: string;
  /** Reason captured when the item is skipped. */
  skipReason?: string;
}

/** Deterministic ordering for protocol run sections (sortOrder, then id). */
export function sortProtocolRunSections(
  sections: ProtocolRunSection[],
): ProtocolRunSection[] {
  return [...sections].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Deterministic ordering for protocol run items (sortOrder, then id). */
export function sortProtocolRunItems(
  items: ProtocolRunItem[],
): ProtocolRunItem[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Checklist Manager V2 — Visit / occurrence execution anchor (Phase 4A)       */
/* -------------------------------------------------------------------------- */
/**
 * A lightweight execution anchor (Phase 4A, Ticket 52). A recurring service can
 * generate many executions (e.g. "Recurring Cleaning" every Tuesday → 3 June,
 * 10 June, 17 June). Each is the same service but needs a unique operational
 * identity. A `VisitOccurrence` provides that identity, sitting between the
 * customer protocol and the executable run:
 *
 *   CustomerProtocolV2 → VisitOccurrence → ProtocolRunV2
 *
 * This is foundation only — no scheduling UI, no employee UI. It establishes a
 * stable anchor for future Check-in, mobile execution, reporting and history,
 * and lets multiple runs / multiple employees attach to one occurrence of work.
 * Conventions mirror the other V2 models: company-scoped (`companyId`),
 * customer-scoped (`customerId`), ISO timestamps.
 */

/** Lifecycle status of a {@link VisitOccurrence}. */
export type VisitOccurrenceStatus =
  | "scheduled"
  | "active"
  | "completed"
  | "cancelled";

export interface VisitOccurrence {
  id: string;
  companyId: string;
  /** Customer this occurrence of work belongs to. */
  customerId: string;
  /** Originating work order. */
  workOrderId: string;
  /** Originating service row within the work order. */
  serviceRowId: string;
  /** Scheduled date of this occurrence (ISO date, e.g. "2026-06-03"). */
  scheduledDate: string;
  status: VisitOccurrenceStatus;
  /** Schema version stamped at creation ({@link CHECKLIST_V2_SCHEMA_VERSION}). */
  schemaVersion?: number;
  createdAt: string;
  updatedAt: string;
}

/** Deterministic ordering for visit occurrences (scheduledDate, createdAt, id). */
export function sortVisitOccurrences(
  occurrences: VisitOccurrence[],
): VisitOccurrence[] {
  return [...occurrences].sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate)
      return a.scheduledDate < b.scheduledDate ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Checklist Manager V2 — Customer Protocol Library (Phase 3C)                 */
/* -------------------------------------------------------------------------- */
/**
 * Customer-specific, editable protocol definitions. A `CustomerProtocolV2` is
 * deep-copied from a {@link ChecklistTemplateV2} into independent rows so the
 * customer can customize it (add reception, conference rooms, coffee stations,
 * alarm instructions…) without ever affecting the company-level template, and
 * vice-versa. This is the real operational protocol library that future phases
 * will link to services / work orders and surface at employee check-in.
 *
 *   CustomerProtocolV2
 *   └── CustomerProtocolSection
 *       └── CustomerProtocolItem
 *
 * These are editable DEFINITIONS, not execution runs: no completion status,
 * signatures, photos or deviations live here (those belong to {@link ProtocolRunV2}).
 * Conventions mirror Phase 1/2: company-scoped (`companyId`) AND customer-scoped
 * (`customerId`) on every row, `sortOrder` for deterministic ordering, child rows
 * denormalize their owning ids for cheap scoped reads. Optional `sourceSectionId`
 * / `sourceItemId` retain provenance back to the originating template rows.
 */
export interface CustomerProtocolV2 {
  id: string;
  companyId: string;
  /** The customer this protocol belongs to. */
  customerId: string;
  /** Id of the template this protocol was created from (reference only). */
  sourceTemplateId: string;
  /** Snapshotted template name at creation time. */
  sourceTemplateName: string;
  /** Snapshotted template version at creation time. */
  sourceTemplateVersion: number;
  /** Display name, e.g. "Bergen Office Park – Recurring Cleaning". */
  name: string;
  /** Optional clarifying note shown in management UI. */
  description?: string;
  /** Linked checklist category ids (copied from the template as a starting point). */
  categoryIds: string[];
  /** Linked floor preset ids (copied from the template as a starting point). */
  floorPresetIds: string[];
  /** Soft-delete flag — archived protocols are hidden from active lists. */
  isArchived: boolean;
  /** Schema version stamped at creation ({@link CHECKLIST_V2_SCHEMA_VERSION}). */
  schemaVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProtocolSection {
  id: string;
  companyId: string;
  customerId: string;
  /** Owning customer protocol. */
  customerProtocolId: string;
  /** Provenance: template section this was copied from, if any. */
  sourceSectionId?: string;
  /** Display title, e.g. "Kitchen". */
  title: string;
  /** Explicit display order within its protocol; lower comes first. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProtocolItem {
  id: string;
  companyId: string;
  customerId: string;
  /** Owning customer protocol (denormalized for cheap scoped reads). */
  customerProtocolId: string;
  /** Owning section. */
  sectionId: string;
  /** Provenance: template item this was copied from, if any. */
  sourceItemId?: string;
  /** Display title, e.g. "Clean sink". */
  title: string;
  /** Optional longer instruction shown under the title. */
  description?: string;
  /** Whether the item is mandatory (definition flag; no runtime here). */
  required: boolean;
  /** Explicit display order within its section; lower comes first. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Deterministic ordering for customer protocols (sortOrder, createdAt, id). */
export function sortCustomerProtocols(
  protocols: CustomerProtocolV2[],
): CustomerProtocolV2[] {
  return [...protocols].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Deterministic ordering for customer protocol sections (sortOrder, then id). */
export function sortCustomerProtocolSections(
  sections: CustomerProtocolSection[],
): CustomerProtocolSection[] {
  return [...sections].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Deterministic ordering for customer protocol items (sortOrder, then id). */
export function sortCustomerProtocolItems(
  items: CustomerProtocolItem[],
): CustomerProtocolItem[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Normalizes a customer protocol name for duplicate detection (trim + case-fold). */
export function normalizeCustomerProtocolName(name: string): string {
  return name.trim().toLowerCase();
}

/** Returns disabled-by-default time reporting settings for a company. */
export function defaultTimeReportSettings(companyId: string): TimeReportSettings {
  return {
    companyId,
    autoApproveEnabled: false,
    deviationToleranceMinutes: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Computes the absolute deviation, in minutes, between a scheduled and an
 * actual duration. Positive and negative differences are treated identically
 * (e.g. scheduled 180 / actual 184 → 4; scheduled 180 / actual 175 → 5).
 */
export function calculateTimeDeviationMinutes(
  scheduledMinutes: number,
  actualMinutes: number,
): number {
  return Math.abs(actualMinutes - scheduledMinutes);
}

/**
 * Computes the planned duration, in minutes, from a service row's planned start
 * and end times ("HH:MM"). Returns null when either time is missing or invalid,
 * or when the range is non-positive. Times are treated as same-day.
 */
export function calculatePlannedDurationMinutes(
  plannedStartTime?: string | null,
  plannedEndTime?: string | null,
): number | null {
  const parse = (t?: string | null): number | null => {
    if (!t) return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };
  const start = parse(plannedStartTime);
  const end = parse(plannedEndTime);
  if (start == null || end == null) return null;
  const duration = end - start;
  return duration > 0 ? duration : null;
}

/** Input shape for {@link calculatePlannedLabourMinutes}. Accepts resolved
 * occurrence values or a raw service row — anything exposing a planned time
 * window plus staffing. */
export interface PlannedLabourInput {
  /** Resolved/planned start time "HH:MM". */
  plannedStartTime?: string | null;
  /** Resolved/planned end time "HH:MM". */
  plannedEndTime?: string | null;
  /** Assigned employees on the (resolved) occurrence. */
  assignedEmployeeIds?: string[] | null;
  /** Open employee slots — planned capacity not yet filled. */
  unassignedEmployeeSlots?: number | null;
  /** Sparse per-employee time overrides, when present. */
  employeeTimeOverrides?: EmployeeTimeOverride[] | null;
  /**
   * Pinned total planned labour minutes, preserved independently of headcount
   * (a redistributed job). When a finite value > 0 is provided and the visit
   * window is valid, it overrides the headcount-scaled labour total.
   */
  totalLabourMinutesOverride?: number | null;
}

/** Result of {@link calculatePlannedLabourMinutes}: the visit window separated
 * from total planned labour effort. */
export interface PlannedLabourResult {
  /** Wall-clock service window in minutes (visit duration), or null if invalid. */
  visitMinutes: number | null;
  /** assignedEmployeeCount + unassignedEmployeeSlots. */
  plannedHeadcount: number;
  /** Number of assigned employees. */
  assignedEmployeeCount: number;
  /** Normalized open slots. */
  unassignedEmployeeSlots: number;
  /** Total planned work effort in minutes, or null when the visit window is invalid. */
  labourMinutes: number | null;
  /**
   * Planned labour minutes carried by each ASSIGNED employee. Without a labour
   * override this is the visit window (everyone works the same window in
   * parallel). With a {@link PlannedLabourInput.totalLabourMinutesOverride}
   * (a redistributed job) it is the pinned total ÷ assigned employees, so a
   * reduced crew shows the larger per-person workload. Null when the visit
   * window is invalid; falls back to the visit window when nobody is assigned.
   */
  perEmployeeMinutes: number | null;
  /** True when a labour override pinned the total (a redistributed job). */
  isLabourRedistributed: boolean;
}

/**
 * Separates **visit duration** (wall-clock window) from **labour minutes**
 * (total planned work effort across all planned people). Pure — safe during
 * render. Call it on the *final effective occurrence* (after variation resolver
 * and BookingOccurrenceException) so labour reflects resolved staffing/times.
 *
 * Labour formula:
 * - With no valid {@link EmployeeTimeOverride}s: `visitMinutes × plannedHeadcount`.
 * - With overrides: sum each assigned employee's own window (override duration
 *   when present, otherwise the visit window) plus
 *   `unassignedEmployeeSlots × visitMinutes`.
 *
 * Returns `labourMinutes: null` when the visit window is missing/invalid.
 * Zero planned people (no assigned, no slots) yields `labourMinutes: 0`.
 */
export function calculatePlannedLabourMinutes(
  input: PlannedLabourInput,
): PlannedLabourResult {
  const visitMinutes = calculatePlannedDurationMinutes(
    input.plannedStartTime,
    input.plannedEndTime,
  );
  const assignedIds = Array.isArray(input.assignedEmployeeIds)
    ? input.assignedEmployeeIds
    : [];
  const assignedEmployeeCount = assignedIds.length;
  const unassignedEmployeeSlots = normalizeUnassignedSlots(
    input.unassignedEmployeeSlots,
  );
  const plannedHeadcount = assignedEmployeeCount + unassignedEmployeeSlots;

  if (visitMinutes == null) {
    return {
      visitMinutes: null,
      plannedHeadcount,
      assignedEmployeeCount,
      unassignedEmployeeSlots,
      labourMinutes: null,
      perEmployeeMinutes: null,
      isLabourRedistributed: false,
    };
  }

  // A pinned total labour (a redistributed job) wins over headcount scaling: the
  // total job time is preserved even as the crew shrinks, and is spread evenly
  // across the assigned employees for the per-person figure.
  const override = input.totalLabourMinutesOverride;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    const perEmployeeMinutes =
      assignedEmployeeCount > 0
        ? Math.round(override / assignedEmployeeCount)
        : visitMinutes;
    return {
      visitMinutes,
      plannedHeadcount,
      assignedEmployeeCount,
      unassignedEmployeeSlots,
      labourMinutes: override,
      perEmployeeMinutes,
      isLabourRedistributed: true,
    };
  }

  const overrides = filterValidEmployeeTimeOverrides(
    input.employeeTimeOverrides,
    assignedIds,
  );

  let labourMinutes: number;
  if (overrides.length > 0) {
    const overrideByEmployee = new Map(
      overrides.map((o) => [
        o.employeeId,
        calculatePlannedDurationMinutes(o.startTime, o.endTime) ?? visitMinutes,
      ]),
    );
    const assignedMinutes = assignedIds.reduce(
      (sum, id) => sum + (overrideByEmployee.get(id) ?? visitMinutes),
      0,
    );
    labourMinutes = assignedMinutes + unassignedEmployeeSlots * visitMinutes;
  } else {
    labourMinutes = visitMinutes * plannedHeadcount;
  }

  return {
    visitMinutes,
    plannedHeadcount,
    assignedEmployeeCount,
    unassignedEmployeeSlots,
    labourMinutes,
    // Without an override, each assigned employee works the full visit window in
    // parallel, so per-employee planned time is simply the visit window.
    perEmployeeMinutes: visitMinutes,
    isLabourRedistributed: false,
  };
}

/**
 * Global, platform-level (Master Admin) configuration that is not scoped to a
 * single company. A single record exists for the whole installation.
 */
export interface SystemSettings {
  /**
   * How far into the future, in months from today, recurring Work Order service
   * rows may generate Booking Queue items. Generation must never create bookings
   * beyond this horizon — this keeps the queue from loading and storing unbounded
   * future data. The recurrence rule itself always stays on the service row.
   */
  bookingGenerationHorizonMonths: BookingGenerationHorizonMonths;
  /**
   * Master Admin gate for the optional Preferred Time Evaluation add-on. When
   * false, customer (company) admins cannot enable or use the feature, and any
   * existing company-level enabled state is ignored in the UI. When true,
   * company admins may activate it for their own company. Defaults to false so
   * the paid add-on is off until the platform owner switches it on.
   */
  allowPreferredTimeEvaluation: boolean;
  /**
   * Cutover switch selecting which resolver backs the company entitlement
   * accessors. `"legacy"` (the default) keeps the original per-company
   * entitlement path serving production; `"bundle"` routes the accessors through
   * the new bundle-first pipeline. Changing this flips the serving path; it does
   * not migrate any data.
   */
  entitlementsResolver: EntitlementsResolverMode;
  /**
   * Diagnostic flag. When true, the legacy resolver keeps serving but the bundle
   * resolver runs in parallel and any divergence is logged. Returned values are
   * never affected. Defaults to false.
   */
  entitlementsShadowLog: boolean;
  updatedAt: string;
}

/** Which resolver backs the company entitlement accessors. */
export type EntitlementsResolverMode = "legacy" | "bundle";

/** Allowed booking-generation horizon values, in months. */
export type BookingGenerationHorizonMonths = 1 | 3 | 6 | 12;

/** Selectable booking-generation horizon presets. */
export const BOOKING_HORIZON_OPTIONS: { value: BookingGenerationHorizonMonths; label: string }[] = [
  { value: 1, label: "1 month" },
  { value: 3, label: "3 months" },
  { value: 6, label: "6 months" },
  { value: 12, label: "12 months" },
];

/** Default platform settings: 6-month booking-generation horizon. */
export function defaultSystemSettings(): SystemSettings {
  return {
    bookingGenerationHorizonMonths: 6,
    allowPreferredTimeEvaluation: false,
    entitlementsResolver: "legacy",
    entitlementsShadowLog: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Normalizes possibly-legacy persisted system settings, filling fields that did
 * not exist when the record was first stored with their safe defaults.
 */
export function normalizeSystemSettings(settings: SystemSettings): SystemSettings {
  return {
    ...defaultSystemSettings(),
    ...settings,
    allowPreferredTimeEvaluation: settings.allowPreferredTimeEvaluation === true,
    entitlementsResolver:
      settings.entitlementsResolver === "bundle" ? "bundle" : "legacy",
    entitlementsShadowLog: settings.entitlementsShadowLog === true,
  };
}

/**
 * Computes the inclusive end date of the booking-generation horizon: `from`
 * advanced by the configured number of months. Recurring booking generation
 * (implemented later) must not create Booking Queue items dated after this.
 * Example: from 2026-05-30, horizon 6 → 2026-11-30.
 */
export function bookingHorizonEndDate(
  from: Date,
  horizonMonths: BookingGenerationHorizonMonths,
): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + horizonMonths);
  return end;
}

// ── Service / Feature Entitlements (paid add-on foundation) ──

/**
 * Stable identifier for an optional, entitlement-gated platform feature. The
 * full catalogue of features lives in the service registry
 * (`@/lib/serviceRegistry`); this is a hard-coded union so the data model and
 * audit log stay strongly typed. Add new keys here as features ship.
 */
export type ServiceFeatureKey =
  | "preferred_time_evaluation"
  | "media_uploads"
  | "time_bank"
  // ── Operational Execution (Phase 1 foundation) ──
  // Core operational-execution modules. UI/actions for these are entitlement-
  // gated; Phase 1 only registers the keys (no UI, no behaviour flip).
  | "mission_log"
  | "time_reporting"
  // Add-on modules. "active" → enabled, "trial" → trial, "inactive" → disabled,
  // resolved through the existing bundle-first resolver. Reserved in Phase 1.
  | "operational_flags"
  | "notification_center"
  | "incident_management"
  | "action_center"
  | "time_quality_analytics"
  | "payroll_basis"
  | "invoice_basis"
  // ── Admin Requests (registry identity only — Model 2) ──
  // Billable Admin Requests service granted through Super Admin Services. Registry
  // identity only: no runtime access, route gating, company module activation, or
  // Service→Module bridge is wired to this key. Company-side activation lives in
  // the existing Module model (the `admin-requests` module) in a later wave.
  //
  // Admin Requests and Employee & Customer Requests are SEPARATE products/modules
  // (they will differ significantly). The Employee & Customer Requests service is
  // deferred: its future key `employee_customer_requests` (affecting the
  // `employee-customer-requests` module) is intentionally NOT added here yet.
  | "admin_requests";

/**
 * The entitlement state for a company × service. This generic tri-state model
 * applies to every entitlement-gated service — no service hard-codes its own
 * states:
 *
 *  - `disabled` — the company has no access; gated actions are blocked.
 *  - `trial`    — the company has access up to a service-defined trial limit
 *                 (e.g. a maximum number of media uploads); beyond the limit,
 *                 gated actions are blocked while existing data stays usable.
 *  - `enabled`  — full access with no limits.
 *
 * Both `trial` and `enabled` count as "entitled" for access-resolution; the
 * trial *limit* is enforced separately at the point of the gated action.
 */
export type ServiceEntitlementStatus = "disabled" | "trial" | "enabled";

/**
 * The kind of entitlement change recorded in the entitlement log. Used for the
 * billing/support trail — distinguishes platform-wide (global) availability
 * changes from per-company access changes, including trial transitions.
 */
export type ServiceEntitlementAction =
  | "global_enabled"
  | "global_disabled"
  | "company_enabled"
  | "company_disabled"
  | "company_trial_started"
  | "company_trial_ended";

/**
 * Platform-wide (Master Admin) availability for an optional service/feature.
 * When a service is globally disabled no company can use it, regardless of
 * company entitlement or company setting. Stored per service key.
 *
 * Note: Preferred Time Evaluation's global availability is bridged to the
 * legacy {@link SystemSettings.allowPreferredTimeEvaluation} master gate for
 * backwards compatibility — see `@/lib/serviceRegistry`.
 */
export interface ServiceGlobalEntitlement {
  serviceKey: ServiceFeatureKey;
  enabled: boolean;
  /** User id of the Super Admin who last changed it, when known. */
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * Per-company access record for an optional service/feature — "does this
 * company have access to this paid feature?". This is deliberately distinct
 * from a company's own internal feature *setting* (e.g.
 * {@link WorkOrderSettings.preferredTimeEvaluationEnabled}): entitlement is
 * granted by the Super Admin, the setting is toggled by the company admin.
 *
 * The {@link enabledAt}/{@link disabledAt} timestamps capture the active period
 * so future invoicing can bill the enabled span — no prices are calculated yet.
 */
export interface CompanyServiceEntitlement {
  companyId: string;
  serviceKey: ServiceFeatureKey;
  /**
   * The tri-state entitlement state. Records persisted before the trial model
   * may omit this; readers derive it from {@link enabled} for compatibility.
   */
  status?: ServiceEntitlementStatus;
  /**
   * Whether the company currently has access (entitled). Retained for backwards
   * compatibility and kept in sync with {@link status}: `true` for `trial` and
   * `enabled`, `false` for `disabled`.
   */
  enabled: boolean;
  /** When the company was most recently granted access, or null if never. */
  enabledAt: string | null;
  /** When access was most recently revoked, or null if currently/never enabled. */
  disabledAt: string | null;
  /** When the company most recently entered a trial, or null if never. */
  trialStartedAt?: string | null;
  /** When the company most recently left a trial, or null. */
  trialEndedAt?: string | null;
  /** User id of whoever last changed it, when known. */
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * Immutable log entry for an entitlement change. Supports future billing
 * specifications and support/debugging. `companyId` is null for global changes.
 */
export interface ServiceEntitlementLogEntry {
  id: string;
  serviceKey: ServiceFeatureKey;
  /** The affected company, or null for a platform-wide (global) change. */
  companyId: string | null;
  action: ServiceEntitlementAction;
  previousValue: boolean;
  newValue: boolean;
  /** User id of whoever made the change, when known. */
  changedBy: string | null;
  changedAt: string;
}

/** The approval routing decision for a submitted time report. */
export type TimeReportApprovalOutcome = "auto_approve" | "requires_admin_approval";

/**
 * Resolves how a submitted time report should be routed for approval, given a
 * company's {@link TimeReportSettings} and the scheduled/actual durations. The
 * report is only auto-approvable when automatic approval is enabled AND the
 * absolute deviation is within the configured tolerance; otherwise it requires
 * administrator approval.
 */
export function resolveTimeReportApproval(
  settings: TimeReportSettings,
  scheduledMinutes: number,
  actualMinutes: number,
): {
  deviationMinutes: number;
  withinTolerance: boolean;
  autoApprovable: boolean;
  outcome: TimeReportApprovalOutcome;
} {
  const deviationMinutes = calculateTimeDeviationMinutes(scheduledMinutes, actualMinutes);
  const withinTolerance = deviationMinutes <= settings.deviationToleranceMinutes;
  const autoApprovable = settings.autoApproveEnabled && withinTolerance;
  return {
    deviationMinutes,
    withinTolerance,
    autoApprovable,
    outcome: autoApprovable ? "auto_approve" : "requires_admin_approval",
  };
}

/**
 * Stored approval state of a submitted employee time report.
 * - `auto_approved`: deviation was within tolerance and automatic approval was
 *   enabled, so the system approved it at checkout.
 * - `pending_admin_approval`: the report needs a human administrator to approve
 *   it (deviation exceeded tolerance, or automatic approval is disabled).
 */
export type TimeReportApprovalStatus = "auto_approved" | "pending_admin_approval";

/** Human-readable labels for {@link TimeReportApprovalStatus}. */
export const TIME_REPORT_APPROVAL_STATUS_LABELS: Record<TimeReportApprovalStatus, string> = {
  auto_approved: "Auto Approved",
  pending_admin_approval: "Pending Admin Approval",
};

/** The system actor recorded as the approver for auto-approved time reports. */
export const TIME_REPORT_SYSTEM_APPROVER = "System";

/**
 * Append-only audit actions for a {@link TimeReport}. The current prototype
 * only emits `checked_out` and `auto_approved`; the remaining values are
 * reserved so the future admin approval workflow (adjust allocation, convert to
 * internal, request correction, correct directly) can append without a schema
 * change. Entries are never mutated or removed.
 */
export type TimeReportAuditAction =
  | "checked_out"
  | "auto_approved"
  | "submitted_for_review"
  | "allocation_proposed"
  | "allocation_adjusted"
  | "approved"
  | "correction_requested"
  | "corrected";

/**
 * A single immutable entry in a {@link TimeReport.auditHistory}. Captures who
 * did what and when, plus an optional snapshot of the deviation allocation at
 * that moment, so worked time and its billable/internal split are always
 * traceable. Never edit or delete existing entries — only append.
 */
export interface TimeReportAuditEntry {
  id: string;
  action: TimeReportAuditAction;
  /** Human-readable description of what happened. */
  description: string;
  /** Actor responsible: {@link TIME_REPORT_SYSTEM_APPROVER} or a user name/id. */
  actor: string;
  /** ISO timestamp of the entry. */
  at: string;
  /** Optional snapshot of the deviation allocation when this entry was recorded. */
  snapshot?: {
    deviationMinutes: number;
    billableDeviationMinutes: number;
    internalDeviationMinutes: number;
    approvalStatus: TimeReportApprovalStatus;
  };
}

/**
 * Validates the deviation-allocation invariant: only the deviation is split,
 * both portions are non-negative finite integers, and
 * `billableDeviationMinutes + internalDeviationMinutes === deviationMinutes`.
 * The scheduled portion of the work is never part of this allocation.
 */
export function isValidDeviationAllocation(
  deviationMinutes: number,
  billableDeviationMinutes: number,
  internalDeviationMinutes: number,
): boolean {
  return (
    Number.isFinite(billableDeviationMinutes) &&
    Number.isFinite(internalDeviationMinutes) &&
    billableDeviationMinutes >= 0 &&
    internalDeviationMinutes >= 0 &&
    billableDeviationMinutes + internalDeviationMinutes === deviationMinutes
  );
}

/**
 * Returns the default deviation allocation used at checkout, before any admin
 * review. The full deviation defaults to billable so that worked time is never
 * lost; an administrator can later reallocate part of it to internal time. The
 * invariant always holds for the returned value.
 */
export function defaultDeviationAllocation(deviationMinutes: number): {
  billableDeviationMinutes: number;
  internalDeviationMinutes: number;
} {
  const safe = Number.isFinite(deviationMinutes) && deviationMinutes > 0 ? deviationMinutes : 0;
  return { billableDeviationMinutes: safe, internalDeviationMinutes: 0 };
}

/** Builds an immutable {@link TimeReportAuditEntry}. */
export function buildTimeReportAuditEntry(input: {
  action: TimeReportAuditAction;
  description: string;
  actor: string;
  at?: string;
  snapshot?: TimeReportAuditEntry["snapshot"];
}): TimeReportAuditEntry {
  return {
    id: `trau_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    action: input.action,
    description: input.description,
    actor: input.actor,
    at: input.at ?? new Date().toISOString(),
    snapshot: input.snapshot,
  };
}

/**
 * An employee time report produced when an employee confirms their time and
 * checks out of a job. It captures the scheduled vs. actual durations, the
 * resulting absolute deviation, and the approval routing decision derived from
 * the company's {@link TimeReportSettings}. Auto-approved reports record
 * `approvedBy = "System"` and an `approvedAt` timestamp; reports awaiting review
 * leave both null until an administrator acts.
 */
export interface TimeReport {
  id: string;
  companyId: string;
  /** The work order the job belongs to. */
  workOrderId: string;
  /** The work-order service row (the "job") this report covers, when applicable. */
  serviceRowId?: string | null;
  /** Snapshot of the job/service name at checkout time. */
  jobName: string;
  /** The employee who checked out, when known. */
  employeeId: string | null;
  /** Snapshot of the employee's name at checkout time. */
  employeeName: string;
  /** Planned duration of the job, in minutes. */
  scheduledMinutes: number;
  /** Actual reported duration of the job, in minutes. */
  actualMinutes: number;
  /** Absolute difference `|actual − scheduled|`, in minutes. */
  deviationMinutes: number;
  /**
   * The scheduled booking this report fulfils, once the Booking Queue and
   * Schedule modules exist. Null in the current prototype, where reports are
   * created directly from a work-order service row.
   */
  bookingId: string | null;
  /**
   * Portion of {@link deviationMinutes} allocated to billable time. Only the
   * deviation is allocated — the scheduled portion is never part of this split.
   * Invariant: `billableDeviationMinutes + internalDeviationMinutes === deviationMinutes`.
   */
  billableDeviationMinutes: number;
  /** Portion of {@link deviationMinutes} allocated to internal time. */
  internalDeviationMinutes: number;
  /** Optional reason for the deviation, proposed by the employee. */
  deviationReason: string | null;
  /** Optional free-text comment about the deviation. */
  deviationComment: string | null;
  /**
   * Append-only audit trail. Entries are never mutated or removed — every
   * change (checkout, allocation, approval, correction) appends a new entry so
   * worked time and its allocation stay fully traceable.
   */
  auditHistory: TimeReportAuditEntry[];
  /** Resulting approval state. */
  approvalStatus: TimeReportApprovalStatus;
  /** "System" for auto-approved reports; null while awaiting administrator review. */
  approvedBy: string | null;
  /** ISO timestamp of approval; null while awaiting administrator review. */
  approvedAt: string | null;
  /** ISO timestamp of when the employee confirmed their time and checked out. */
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolves the stored approval fields for a time report at checkout. Reuses
 * {@link resolveTimeReportApproval} so the routing rule lives in one place.
 * Auto-approved reports are stamped with the system approver and `at`; reports
 * requiring review leave `approvedBy`/`approvedAt` null.
 */
export function resolveTimeReportCheckout(
  settings: TimeReportSettings,
  scheduledMinutes: number,
  actualMinutes: number,
  at: string = new Date().toISOString(),
): {
  deviationMinutes: number;
  approvalStatus: TimeReportApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
} {
  const { deviationMinutes, autoApprovable } = resolveTimeReportApproval(
    settings,
    scheduledMinutes,
    actualMinutes,
  );
  return {
    deviationMinutes,
    approvalStatus: autoApprovable ? "auto_approved" : "pending_admin_approval",
    approvedBy: autoApprovable ? TIME_REPORT_SYSTEM_APPROVER : null,
    approvedAt: autoApprovable ? at : null,
  };
}

// ── Booking Ledger / Booking List (generated actual bookings) ──────────────

export type BookingLedgerBookingStatus = "scheduled" | "cancelled" | "completed";
export type BookingLedgerPlanningStatus = "unplanned" | "planned";
export type BookingLedgerExecutionStatus = "not_started" | "in_progress" | "completed" | "cancelled";
export type BookingLedgerBillingStatus = "not_ready" | "ready" | "billed";
export type BookingLedgerPayrollStatus = "not_ready" | "ready" | "processed";

/** One generated booking job in the new Booking List ledger. */
export interface BookingLedgerEntry {
  bookingId: string;
  bookingSeriesId: string;
  companyId: string;
  customerId: string;
  workOrderId: string;
  serviceRowId: string;
  bookingDate: string;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  bookingStatus: BookingLedgerBookingStatus;
  planningStatus: BookingLedgerPlanningStatus;
  executionStatus: BookingLedgerExecutionStatus;
  billingStatus: BookingLedgerBillingStatus;
  payrollStatus: BookingLedgerPayrollStatus;
  createdAt?: string;
  updatedAt?: string;
}

export const BOOKING_LEDGER_STATUS_DEFAULTS = {
  bookingStatus: "scheduled",
  planningStatus: "unplanned",
  executionStatus: "not_started",
  billingStatus: "not_ready",
  payrollStatus: "not_ready",
} as const satisfies Pick<
  BookingLedgerEntry,
  "bookingStatus" | "planningStatus" | "executionStatus" | "billingStatus" | "payrollStatus"
>;

// ── Booking Queue (legacy planning layer) ────────────────────────

/**
 * Whether a {@link BookingQueueItem} has been assigned to an employee/team yet.
 * Assignment automation is built later with the Schedule module; this is the
 * status field only.
 */
export type BookingAssignmentStatus =
  | "unassigned"
  | "staffing_needed"
  | "partially_assigned"
  | "assigned";

/** Whether a {@link BookingQueueItem} has been placed on a date/time yet. */
export type BookingScheduleStatus = "unscheduled" | "scheduled";

/** Display labels and order for {@link BookingAssignmentStatus}. */
export const BOOKING_ASSIGNMENT_STATUSES: { value: BookingAssignmentStatus; label: string }[] = [
  { value: "unassigned", label: "Unassigned" },
  { value: "staffing_needed", label: "Staffing Needed" },
  { value: "partially_assigned", label: "Partially Assigned" },
  { value: "assigned", label: "Assigned" },
];

/**
 * Derives the {@link BookingAssignmentStatus} from the number of assigned
 * employees and open (unassigned) slots on a service row.
 *
 * - "assigned": at least one employee and no open slots — fully staffed.
 * - "partially_assigned": at least one employee but open slots remain.
 * - "staffing_needed": no employees but open slots exist — a staffing
 *   requirement is configured and still needs to be filled.
 * - "unassigned": no employees and no open slots — no staffing configured yet.
 *
 * Note "staffing_needed" and "unassigned" are intentionally distinct: the former
 * means the job declares it needs staff, the latter means nothing is configured.
 * Pure — safe to call during render or load-time normalization.
 */
export function deriveBookingAssignmentStatus(
  assignedCount: number,
  unassignedSlots: number,
): BookingAssignmentStatus {
  if (unassignedSlots > 0) {
    return assignedCount > 0 ? "partially_assigned" : "staffing_needed";
  }
  return assignedCount > 0 ? "assigned" : "unassigned";
}

/** Coerces any stored value into a non-negative integer count of open slots. */
export function normalizeUnassignedSlots(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Human label for open employee slots, e.g. "Unassigned slot" / "2 unassigned slots". */
export function formatUnassignedSlots(count: number): string | null {
  const n = normalizeUnassignedSlots(count);
  if (n <= 0) return null;
  return n === 1 ? "Unassigned slot" : `${n} unassigned slots`;
}

export const BOOKING_ASSIGNMENT_STATUS_LABELS: Record<BookingAssignmentStatus, string> =
  Object.fromEntries(
    BOOKING_ASSIGNMENT_STATUSES.map((s) => [s.value, s.label]),
  ) as Record<BookingAssignmentStatus, string>;

/** Display labels and order for {@link BookingScheduleStatus}. */
export const BOOKING_SCHEDULE_STATUSES: { value: BookingScheduleStatus; label: string }[] = [
  { value: "unscheduled", label: "Unscheduled" },
  { value: "scheduled", label: "Scheduled" },
];

export const BOOKING_SCHEDULE_STATUS_LABELS: Record<BookingScheduleStatus, string> =
  Object.fromEntries(
    BOOKING_SCHEDULE_STATUSES.map((s) => [s.value, s.label]),
  ) as Record<BookingScheduleStatus, string>;

/**
 * An item in the Booking Queue — the planning layer that sits between Work
 * Orders (the source of work) and the future Schedule module (which only
 * consumes queue items). Every service row added to a work order creates one
 * queue item. The item carries snapshot values (customer, service, work-order
 * reference) so the planner list renders without joining back to live records.
 *
 * Scheduling itself (assigning a date/time, employee, team, vehicle, recurring
 * expansion) is deliberately NOT implemented yet — `assignmentStatus` and
 * `scheduleStatus` start at their defaults and the schedule fields stay null
 * until the Schedule module is built. This is the foundation data model only.
 */
/**
 * A recorded reschedule of a booking — the planning intent to move work from one
 * date to another. Captured on the booking so the queue can clearly flag moved
 * jobs with their original/new dates, reason, comment and whether the change is
 * a one-time exception (does not affect future recurring occurrences).
 */
export interface BookingReschedule {
  /** The date the booking was planned for before the move (ISO). */
  originalDate: string;
  /** The new planned date after the move (ISO). */
  newDate: string;
  /** Short reason for the move, e.g. "Customer request". */
  reason?: string;
  /** Free-form comment with extra context. */
  comment?: string;
  /**
   * When true this move applies only to this occurrence and must not alter the
   * underlying recurring service (e.g. future Wednesdays stay unchanged).
   */
  oneTime: boolean;
  /** ISO timestamp of when the reschedule was recorded. */
  rescheduledAt: string;
}

export interface BookingQueueItem {
  id: string;
  companyId: string;
  /** The source work order this item came from. */
  workOrderId: string;
  /** Snapshot of the work-order number for list display (e.g. "WO-1001"). */
  workOrderNumber: string;
  /** The work-order service row that produced this item. */
  serviceRowId: string;
  /** The customer the work belongs to. */
  customerId: string;
  /** Snapshot of the customer's name at creation time. */
  customerName: string;
  /** Snapshot of the service name at creation time. */
  serviceName: string;
  /**
   * Snapshot of the source service row's intended date ("YYYY-MM-DD"). This is
   * the planning date the queue places the booking against — distinct from
   * {@link scheduledDate}, which the future Schedule module owns. Null only for
   * orphaned items whose source row no longer exists.
   */
  serviceDate?: string | null;
  /**
   * Snapshot of the source row's inclusive recurrence end date ("YYYY-MM-DD").
   * Null/undefined when unbounded or for one-time services. Recurring booking
   * occurrences are never displayed after this date.
   */
  serviceEndDate?: string | null;
  /** Snapshot of the source row's planned start time ("HH:MM"). */
  plannedStartTime?: string | null;
  /** Snapshot of the source row's planned end time ("HH:MM"). */
  plannedEndTime?: string | null;
  /** Snapshot of the source row's assigned employee ids. Defaults to []. */
  assignedEmployeeIds?: string[];
  /** Snapshot of the source row's open employee slot count. Defaults to 0. */
  unassignedEmployeeSlots?: number;
  /** Snapshot of the source row's recurrence interval. Defaults to "one_time". */
  recurrenceInterval?: RecurrenceInterval;
  /**
   * Snapshot of valid per-employee planned-time overrides from the source row.
   * Empty/undefined when all assigned employees follow the service-level
   * window. Data model only — no UI yet.
   */
  employeeTimeOverrides?: EmployeeTimeOverride[];
  /**
   * True when at least one valid {@link employeeTimeOverrides} entry exists, so
   * the queue can flag "custom employee times" without recomputing. Defaults to
   * false. Data model only — no UI yet.
   */
  hasCustomEmployeeTimes?: boolean;
  assignmentStatus: BookingAssignmentStatus;
  scheduleStatus: BookingScheduleStatus;
  /** Planned date, set by the future Schedule module. Null until scheduled. */
  scheduledDate: string | null;
  /** Planned start time, set by the future Schedule module. Null until scheduled. */
  scheduledStartTime: string | null;
  /** Planned end time, set by the future Schedule module. Null until scheduled. */
  scheduledEndTime: string | null;
  /**
   * Timestamp the booking was cancelled, or null/undefined if still active.
   * Cancellation flows arrive with the Schedule module; this field exists now
   * only so date filtering and the "Show cancelled" toggle are forward-ready.
   */
  cancelledAt?: string | null;
  /** Optional reason captured when the booking was cancelled. */
  cancelReason?: string | null;
  /**
   * Planned duration of the service in minutes, used for capacity planning. Null
   * until a duration is known (set by the future Schedule module). Shown in the
   * queue because duration is essential for planning.
   */
  durationMinutes?: number | null;
  /**
   * Snapshot of assigned employee names for list display. Empty until assignment
   * is built with the Schedule module; the array shape keeps multi-employee
   * assignment forward-ready.
   */
  assignedEmployeeNames?: string[];
  /** Reschedule record, present only when this booking has been moved. */
  reschedule?: BookingReschedule | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The planning snapshot fields a {@link BookingQueueItem} mirrors from its
 * source {@link WorkOrderServiceRow}. The service row is the source of truth;
 * these values are re-derived whenever the row changes so the queue always
 * reflects the latest service-row state.
 */
export interface BookingSnapshot {
  serviceName: string;
  serviceDate: string | null;
  /** Inclusive recurrence end date ("YYYY-MM-DD"); null when unbounded or one-time. */
  serviceEndDate: string | null;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  durationMinutes: number | null;
  assignedEmployeeIds: string[];
  assignedEmployeeNames: string[];
  /** Open employee slots copied from the source row; 0 when fully staffed. */
  unassignedEmployeeSlots: number;
  assignmentStatus: BookingAssignmentStatus;
  recurrenceInterval: RecurrenceInterval;
  /** Valid per-employee planned-time overrides; [] when none apply. */
  employeeTimeOverrides: EmployeeTimeOverride[];
  /** True when at least one valid override exists. */
  hasCustomEmployeeTimes: boolean;
}

/**
 * Builds the {@link BookingSnapshot} for a booking item from its source service
 * row. Duration is derived from the planned times, assignment status from the
 * assigned employees, and employee names are resolved via `resolveEmployeeName`
 * (unresolved ids are skipped). Pure — safe to call during render or in the
 * store's load-time normalization.
 */
export function buildBookingSnapshot(
  row: Pick<
    WorkOrderServiceRow,
    | "serviceName"
    | "serviceDate"
    | "plannedStartTime"
    | "plannedEndTime"
    | "assignedEmployeeIds"
    | "unassignedEmployeeSlots"
    | "recurrenceInterval"
    | "employeeTimeOverrides"
    | "serviceEndDate"
  >,
  resolveEmployeeName: (id: string) => string | undefined,
): BookingSnapshot {
  const ids = Array.isArray(row.assignedEmployeeIds) ? row.assignedEmployeeIds : [];
  const names = ids
    .map((id) => resolveEmployeeName(id))
    .filter((n): n is string => Boolean(n && n.trim()));
  const employeeTimeOverrides = filterValidEmployeeTimeOverrides(row.employeeTimeOverrides, ids);
  const unassignedEmployeeSlots = normalizeUnassignedSlots(row.unassignedEmployeeSlots);
  return {
    serviceName: row.serviceName,
    serviceDate: row.serviceDate?.trim() ? row.serviceDate : null,
    serviceEndDate: row.serviceEndDate?.trim() ? row.serviceEndDate : null,
    plannedStartTime: row.plannedStartTime?.trim() ? row.plannedStartTime : null,
    plannedEndTime: row.plannedEndTime?.trim() ? row.plannedEndTime : null,
    durationMinutes: calculatePlannedDurationMinutes(row.plannedStartTime, row.plannedEndTime),
    assignedEmployeeIds: ids,
    assignedEmployeeNames: names,
    unassignedEmployeeSlots,
    assignmentStatus: deriveBookingAssignmentStatus(ids.length, unassignedEmployeeSlots),
    recurrenceInterval: row.recurrenceInterval ?? "one_time",
    employeeTimeOverrides,
    hasCustomEmployeeTimes: employeeTimeOverrides.length > 0,
  };
}

/** A booking's high-level planning state, derived for list display. */
export type BookingDisplayStatus =
  | "cancelled"
  | "rescheduled"
  | "scheduled"
  | "unscheduled";

export const BOOKING_DISPLAY_STATUS_LABELS: Record<BookingDisplayStatus, string> = {
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  scheduled: "Scheduled",
  unscheduled: "Unscheduled",
};

/**
 * Resolves the high-level {@link BookingDisplayStatus} shown in the queue.
 * Cancellation wins, then a reschedule flag, then the underlying schedule state.
 */
export function getBookingDisplayStatus(item: BookingQueueItem): BookingDisplayStatus {
  if (item.cancelledAt) return "cancelled";
  if (item.reschedule) return "rescheduled";
  return item.scheduleStatus === "scheduled" ? "scheduled" : "unscheduled";
}

// ── Booking occurrences (recurrence identity) ─────────────

/**
 * Why a concrete booking occurrence exists. The base recurring service rule
 * produces "base_service" occurrences; the remaining sources are reserved for
 * later steps (variation rules, manual extras, reschedules, complaint
 * follow-ups) and do not generate occurrences yet.
 */
export type BookingOccurrenceSourceType =
  | "base_service"
  | "variation"
  | "manual_extra"
  | "rescheduled"
  | "complaint_followup";

/**
 * Builds the stable identity key for a booking occurrence:
 * `parentServiceRowId + ":" + occurrenceDate` (e.g. "serviceRow_123:2026-06-15").
 * Deterministic, so the same recurring date always resolves to the same
 * occurrence across refreshes — generation never creates duplicates. Pure.
 */
export function makeOccurrenceKey(parentServiceRowId: string, occurrenceDate: string): string {
  return `${parentServiceRowId}:${occurrenceDate}`;
}

/**
 * A concrete booking occurrence shown in the Booking Queue. In this step
 * occurrences are still derived on the fly from the source service row's
 * recurrence rule (not persisted), but every occurrence carries a stable
 * {@link occurrenceKey} so it can be addressed individually in later steps
 * (per-occurrence cancel, reschedule, variation, time reporting). Only
 * exceptions will be persisted later; the base-rule + key + exceptions model
 * avoids storing every generated occurrence.
 */
export interface BookingOccurrence {
  /** Stable identity; equals {@link occurrenceKey} for derived occurrences. */
  id: string;
  /** `parentServiceRowId:occurrenceDate` — unique, deterministic, refresh-safe. */
  occurrenceKey: string;
  /** What produced this occurrence. "base_service" for the base recurring rule. */
  sourceType: BookingOccurrenceSourceType;
  /** Id of the source that produced it (the service row for base occurrences). */
  sourceId: string;
  /** The base recurring service row this occurrence belongs to. */
  parentServiceRowId: string;
  /** The concrete date of this occurrence ("YYYY-MM-DD"). */
  occurrenceDate: string;
  companyId: string;
  workOrderId: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  /** Planning date snapshot; equals {@link occurrenceDate} for base occurrences. */
  serviceDate: string;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  assignedEmployeeIds: string[];
  assignedEmployeeNames: string[];
  /**
   * Open employee slots for this occurrence; 0 when fully staffed. Carried on
   * the occurrence (not just the queue item) because future occurrence
   * exceptions and variation rules operate on {@link BookingOccurrence}.
   */
  unassignedEmployeeSlots: number;
  /**
   * Staffing status derived from {@link assignedEmployeeIds} and
   * {@link unassignedEmployeeSlots}. Lives on the occurrence so exceptions and
   * variations can recompute it per occurrence without re-joining the source.
   */
  assignmentStatus: BookingAssignmentStatus;
  employeeTimeOverrides: EmployeeTimeOverride[];
  hasCustomEmployeeTimes: boolean;
  /**
   * Pinned total planned labour minutes for THIS occurrence (a split /
   * redistributed job), or null to scale labour with headcount. Normally null;
   * set when a per-occurrence exception overrides labour. Read by the labour
   * calculator so the queue/board reflect the resolved per-occurrence total.
   */
  totalLabourMinutesOverride?: number | null;
  recurrenceInterval: RecurrenceInterval;
  /** High-level display status, derived from the source booking item. */
  status: BookingDisplayStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Derives a {@link BookingOccurrence} identity from a source
 * {@link BookingQueueItem} and a concrete occurrence date. Used by the Booking
 * Queue to give every recurring occurrence a stable key while occurrences
 * remain display-only in this step. Pure — safe to call during render.
 */
export function buildBookingOccurrence(
  item: BookingQueueItem,
  occurrenceDate: string,
  sourceType: BookingOccurrenceSourceType = "base_service",
): BookingOccurrence {
  const parentServiceRowId = item.serviceRowId;
  const occurrenceKey = makeOccurrenceKey(parentServiceRowId, occurrenceDate);
  const assignedEmployeeIds = item.assignedEmployeeIds ?? [];
  const unassignedEmployeeSlots = normalizeUnassignedSlots(item.unassignedEmployeeSlots);
  return {
    id: occurrenceKey,
    occurrenceKey,
    sourceType,
    sourceId: item.serviceRowId,
    parentServiceRowId,
    occurrenceDate,
    companyId: item.companyId,
    workOrderId: item.workOrderId,
    customerId: item.customerId,
    customerName: item.customerName,
    serviceName: item.serviceName,
    serviceDate: occurrenceDate,
    plannedStartTime: item.plannedStartTime ?? null,
    plannedEndTime: item.plannedEndTime ?? null,
    assignedEmployeeIds,
    assignedEmployeeNames: item.assignedEmployeeNames ?? [],
    unassignedEmployeeSlots,
    assignmentStatus: deriveBookingAssignmentStatus(
      assignedEmployeeIds.length,
      unassignedEmployeeSlots,
    ),
    employeeTimeOverrides: item.employeeTimeOverrides ?? [],
    hasCustomEmployeeTimes: item.hasCustomEmployeeTimes ?? false,
    totalLabourMinutesOverride: null,
    recurrenceInterval: item.recurrenceInterval ?? "one_time",
    status: getBookingDisplayStatus(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ── Booking occurrence exceptions (overlay layer) ─────────

/**
 * The persisted state of a single booking occurrence that has been changed away
 * from the base recurrence rule. Occurrences themselves are still derived on the
 * fly from the service row; only the *exceptions* are stored. An occurrence with
 * no exception simply follows the rule ("active").
 * - active: explicitly reaffirmed (rare today; reserved for later overlays).
 * - cancelled: this single occurrence is cancelled; the series is unaffected.
 * - rescheduled: this single occurrence has been moved (date/time overlay
 *   arrives in a later step — this step records the status only).
 */
export type BookingOccurrenceExceptionStatus = "active" | "cancelled" | "rescheduled";

/**
 * A persisted exception for one concrete booking occurrence, addressed by its
 * stable {@link makeOccurrenceKey} value. This is the only part of a recurring
 * series that is stored: the base rule stays on the service row, occurrences are
 * derived, and an exception overlays a single occurrence when it diverges. At
 * most one exception exists per {@link occurrenceKey} (see
 * {@link indexOccurrenceExceptions}). No per-occurrence actions, employee/time
 * overrides or variation support are built in this step — status only.
 */
export interface BookingOccurrenceException {
  id: string;
  /** `parentServiceRowId:occurrenceDate` — the occurrence this overlays. */
  occurrenceKey: string;
  /** The base recurring service row the occurrence belongs to. */
  parentServiceRowId: string;
  /** The original (rule-derived) date of the occurrence ("YYYY-MM-DD"). */
  occurrenceDate: string;
  status: BookingOccurrenceExceptionStatus;
  /**
   * When {@link status} is "rescheduled", the date this single occurrence was
   * moved to ("YYYY-MM-DD"). The occurrence renders here instead of
   * {@link occurrenceDate}; its identity ({@link occurrenceKey}) is unchanged so
   * it stays addressable and no duplicate appears on the original date.
   */
  overrideOccurrenceDate?: string | null;
  /** Optional moved start time ("HH:MM"); null/undefined keeps the rule's time. */
  overrideStartTime?: string | null;
  /** Optional moved end time ("HH:MM"); null/undefined keeps the rule's time. */
  overrideEndTime?: string | null;
  /**
   * Per-occurrence STAFFING override: replaces the resolved assigned employees
   * for THIS occurrence only (the series stays on the service row). An array —
   * including an empty one — is an explicit override; null/undefined follows the
   * series. Applied at occurrence resolve time, independently of {@link status},
   * so a single recurring occurrence can be reassigned without touching the rule
   * (the foundation for drag-and-drop reassignment).
   */
  overrideAssignedEmployeeIds?: string[] | null;
  /**
   * Per-occurrence open-slot override. A finite number is an explicit override;
   * null/undefined follows the series. Lets a reassignment also change the open
   * staffing need for one occurrence without editing the series.
   */
  overrideUnassignedEmployeeSlots?: number | null;
  /**
   * Per-occurrence pinned total labour minutes (a split/redistributed job),
   * mirroring {@link WorkOrderServiceRow.totalLabourMinutesOverride} but scoped
   * to one occurrence. A finite value > 0 pins the total; null/undefined follows
   * the series. Preserves split/increase/reduce labour parity per occurrence.
   */
  overrideTotalLabourMinutes?: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * True when the exception carries any per-occurrence staffing/labour override
 * (assigned employees, open slots, or pinned labour). Pure — safe during render.
 */
export function occurrenceExceptionHasStaffingOverride(
  exception: BookingOccurrenceException | undefined | null,
): boolean {
  if (!exception) return false;
  return (
    Array.isArray(exception.overrideAssignedEmployeeIds) ||
    typeof exception.overrideUnassignedEmployeeSlots === "number" ||
    (typeof exception.overrideTotalLabourMinutes === "number" &&
      Number.isFinite(exception.overrideTotalLabourMinutes) &&
      exception.overrideTotalLabourMinutes > 0)
  );
}

/**
 * Indexes exceptions by {@link BookingOccurrenceException.occurrenceKey},
 * enforcing the invariant that a key resolves to a single exception. When
 * duplicates exist (e.g. from a bad import), the most recently updated wins so
 * refreshes never surface two conflicting overlays for one occurrence. Pure —
 * safe to call during render.
 */
export function indexOccurrenceExceptions(
  exceptions: BookingOccurrenceException[] | undefined | null,
): Map<string, BookingOccurrenceException> {
  const map = new Map<string, BookingOccurrenceException>();
  if (!Array.isArray(exceptions)) return map;
  for (const ex of exceptions) {
    if (!ex || typeof ex.occurrenceKey !== "string" || !ex.occurrenceKey) continue;
    const existing = map.get(ex.occurrenceKey);
    if (!existing || (ex.updatedAt ?? "") >= (existing.updatedAt ?? "")) {
      map.set(ex.occurrenceKey, ex);
    }
  }
  return map;
}

/**
 * Overlays a persisted {@link BookingOccurrenceException} onto a derived
 * {@link BookingOccurrence}, returning the final occurrence the queue renders.
 * Maps the exception status onto the occurrence's display status (cancelled /
 * rescheduled); an "active" exception or no exception leaves the derived status
 * untouched. Returns the same reference when nothing changes. Pure.
 */
export function applyOccurrenceException(
  occurrence: BookingOccurrence,
  exception: BookingOccurrenceException | undefined | null,
  resolveEmployeeName?: (id: string) => string | undefined,
): BookingOccurrence {
  if (!exception) return occurrence;

  // 1) Per-occurrence staffing override (reassignment). Applied under ANY status
  // so a reassigned occurrence that is also moved keeps both changes. A new
  // object is created only when an override is actually present.
  const next = applyOccurrenceStaffingOverride(occurrence, exception, resolveEmployeeName);

  // 2) Status overlay (cancel / reschedule) on top of the staffing override.
  if (exception.status === "cancelled") {
    return next.status === "cancelled" ? next : { ...next, status: "cancelled" };
  }
  if (exception.status === "rescheduled") {
    // Move this single occurrence to its override date/time. The identity
    // (occurrenceKey/occurrenceDate) is preserved so it stays addressable and
    // no duplicate is generated on the original recurrence date.
    const overrideDate = exception.overrideOccurrenceDate ?? next.serviceDate;
    return {
      ...next,
      status: "rescheduled",
      serviceDate: overrideDate,
      plannedStartTime: exception.overrideStartTime ?? next.plannedStartTime,
      plannedEndTime: exception.overrideEndTime ?? next.plannedEndTime,
    };
  }
  return next;
}

/**
 * Overlays a per-occurrence staffing override onto an occurrence: reassigned
 * employees (+ resolved names), open slots and pinned labour. Returns the same
 * reference when the exception carries no staffing override. Pure.
 */
function applyOccurrenceStaffingOverride(
  occurrence: BookingOccurrence,
  exception: BookingOccurrenceException,
  resolveEmployeeName?: (id: string) => string | undefined,
): BookingOccurrence {
  if (!occurrenceExceptionHasStaffingOverride(exception)) return occurrence;

  const hasAssignment = Array.isArray(exception.overrideAssignedEmployeeIds);
  const assignedEmployeeIds = hasAssignment
    ? exception.overrideAssignedEmployeeIds!.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : occurrence.assignedEmployeeIds;
  const assignedEmployeeNames = hasAssignment
    ? resolveEmployeeName
      ? assignedEmployeeIds
          .map((id) => resolveEmployeeName(id))
          .filter((n): n is string => Boolean(n))
      : occurrence.assignedEmployeeNames
    : occurrence.assignedEmployeeNames;
  const unassignedEmployeeSlots =
    typeof exception.overrideUnassignedEmployeeSlots === "number"
      ? normalizeUnassignedSlots(exception.overrideUnassignedEmployeeSlots)
      : occurrence.unassignedEmployeeSlots;
  const rawLabour = exception.overrideTotalLabourMinutes;
  const totalLabourMinutesOverride =
    typeof rawLabour === "number" && Number.isFinite(rawLabour) && rawLabour > 0
      ? rawLabour
      : (occurrence.totalLabourMinutesOverride ?? null);

  return {
    ...occurrence,
    assignedEmployeeIds,
    assignedEmployeeNames,
    unassignedEmployeeSlots,
    assignmentStatus: deriveBookingAssignmentStatus(
      assignedEmployeeIds.length,
      unassignedEmployeeSlots,
    ),
    totalLabourMinutesOverride,
  };
}

/**
 * Formats a planned duration like "4 hours (240 min)". Returns null when no
 * duration is known so callers can render a neutral placeholder.
 */
export function formatBookingDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = minutes / 60;
  const hoursLabel = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  const unit = hours === 1 ? "hour" : "hours";
  return `${hoursLabel} ${unit} (${minutes} min)`;
}

/**
 * A company-scoped favorite service shortcut. Marking a service as a favorite
 * is purely a convenience for adding it quickly to work orders — it never
 * affects permissions, pricing, scheduling, payroll, invoicing or the service
 * itself. Visible only within the owning company.
 */
export interface CompanyServiceFavorite {
  companyId: string;
  serviceId: string;
  createdAt: string;
}

// ── Customer cleaning day & time preferences ──────────────

/** A day of the week, used for cleaning-day preferences. */
export type WeekDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Display labels and week order for {@link WeekDay}. */
export const WEEK_DAYS: { value: WeekDay; label: string }[] = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

export const WEEK_DAY_LABELS: Record<WeekDay, string> = Object.fromEntries(
  WEEK_DAYS.map((d) => [d.value, d.label]),
) as Record<WeekDay, string>;

/**
 * A preferred cleaning day with optimal and acceptable time windows. Times are
 * stored as 24h "HH:mm" strings. The acceptable window should be equal to or
 * wider than the optimal window. Used for both primary and secondary lists.
 */
export interface CleaningDayPreference {
  id: string;
  day: WeekDay;
  /** Start of the optimal window, e.g. "09:00". */
  optimalStartTime: string;
  /** End of the optimal window, e.g. "12:00". */
  optimalEndTime: string;
  /** Start of the acceptable (wider) window, e.g. "08:00". */
  acceptableStartTime: string;
  /** End of the acceptable (wider) window, e.g. "15:00". */
  acceptableEndTime: string;
  /** @deprecated Legacy single-window start; read as a fallback only. */
  startTime?: string;
  /** @deprecated Legacy single-window end; read as a fallback only. */
  endTime?: string;
}

/** Resolves the optimal window for a day, falling back to legacy single-window fields. */
export function dayOptimalWindow(d: CleaningDayPreference): { start: string; end: string } {
  return {
    start: d.optimalStartTime ?? d.startTime ?? "",
    end: d.optimalEndTime ?? d.endTime ?? "",
  };
}

/** Resolves the acceptable window for a day, falling back to the optimal/legacy fields. */
export function dayAcceptableWindow(d: CleaningDayPreference): { start: string; end: string } {
  const optimal = dayOptimalWindow(d);
  return {
    start: d.acceptableStartTime ?? optimal.start,
    end: d.acceptableEndTime ?? optimal.end,
  };
}

/** How scheduling should react when the regular employee is absent. */
export type AbsenceHandlingPreference =
  | "regular_employee_within_interval"
  | "regular_employee_outside_interval"
  | "regular_day_substitute_employee"
  | "skip_visit_wait_regular_employee";

/** Display labels and order for {@link AbsenceHandlingPreference}. */
export const ABSENCE_HANDLING_OPTIONS: {
  value: AbsenceHandlingPreference;
  label: string;
}[] = [
  {
    value: "regular_employee_within_interval",
    label: "Prioritize regular employee, change day within preferred interval",
  },
  {
    value: "regular_employee_outside_interval",
    label: "Prioritize regular employee, change day even outside preferred interval",
  },
  {
    value: "regular_day_substitute_employee",
    label: "Prioritize regular day/time with substitute employee",
  },
  {
    value: "skip_visit_wait_regular_employee",
    label: "Skip the visit and wait for the regular employee",
  },
];

export const ABSENCE_HANDLING_LABELS: Record<AbsenceHandlingPreference, string> =
  Object.fromEntries(ABSENCE_HANDLING_OPTIONS.map((o) => [o.value, o.label])) as Record<
    AbsenceHandlingPreference,
    string
  >;

/** The default ranked order of all absence-handling options (rank 1 first). */
export const ABSENCE_HANDLING_ORDER: AbsenceHandlingPreference[] =
  ABSENCE_HANDLING_OPTIONS.map((o) => o.value);

/**
 * Normalizes a stored absence priority into a complete, de-duplicated ranking
 * containing all three options. Honors any legacy single-choice value first,
 * then any stored ordering, then fills in remaining options in default order.
 */
export function normalizeAbsencePriority(
  priority?: AbsenceHandlingPreference[] | null,
  legacy?: AbsenceHandlingPreference | null,
): AbsenceHandlingPreference[] {
  const seen = new Set<AbsenceHandlingPreference>();
  const result: AbsenceHandlingPreference[] = [];
  const add = (p?: AbsenceHandlingPreference | null) => {
    if (p && ABSENCE_HANDLING_ORDER.includes(p) && !seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  };
  add(legacy);
  (priority ?? []).forEach(add);
  ABSENCE_HANDLING_ORDER.forEach(add);
  return result;
}

/** A customer-approved day/time window used by the V2 scheduling preference model. */
export interface SchedulingPreferenceWindow {
  id: string;
  /** Weekday this window applies to. */
  day: WeekDay;
  /** Window start as 24h "HH:mm". */
  startTime: string;
  /** Window end as 24h "HH:mm". */
  endTime: string;
  /** Optional human label for admins and future AI explanations. */
  label?: string;
  /** Optional customer/admin note for this specific window. */
  note?: string;
  /** Lower numbers are higher priority inside the same window group. */
  priority?: number;
}

export type TemporaryReschedulingPriority = AbsenceHandlingPreference[];

/**
 * A customer's scheduling preferences. V2 distinguishes permanent recurring
 * schedule preferences from temporary one-off rescheduling flexibility while
 * keeping legacy fields readable during transition.
 */
export interface CustomerSchedulingPreferences {
  /** Current preference schema version. Missing means legacy V1 data. */
  version?: 2;
  /** Highest-priority windows for normal recurring service schedules. */
  preferredRecurringWindows?: SchedulingPreferenceWindow[];
  /** Allowed alternatives for normal recurring service schedules. */
  acceptableRecurringWindows?: SchedulingPreferenceWindow[];
  /** Broader windows allowed only for explicit one-off rescheduling events. */
  acceptableTemporaryWindows?: SchedulingPreferenceWindow[];
  /** Ranked policy for how aggressively temporary flexibility may be used. */
  temporaryReschedulingPriority?: TemporaryReschedulingPriority;
  /** @deprecated Legacy primary cleaning days, readable during transition. */
  preferredDays: CleaningDayPreference[];
  /** @deprecated Legacy fallback cleaning days, readable during transition. */
  secondaryDays: CleaningDayPreference[];
  /** @deprecated Legacy absence-specific priority, readable during transition. */
  absencePriority: AbsenceHandlingPreference[];
  /** @deprecated Legacy single absence choice; superseded by {@link absencePriority}. */
  absenceHandling?: AbsenceHandlingPreference | null;
  /** Free-form scheduling notes. */
  schedulingNotes?: string;
  /** ISO timestamp of the last edit. */
  updatedAt?: string;
}

const TIME_24H_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidSchedulingWindow(window: SchedulingPreferenceWindow): boolean {
  return (
    WEEK_DAYS.some((d) => d.value === window.day) &&
    TIME_24H_PATTERN.test(window.startTime) &&
    TIME_24H_PATTERN.test(window.endTime) &&
    window.endTime > window.startTime
  );
}

function cleanSchedulingWindow(
  window: Partial<SchedulingPreferenceWindow> | null | undefined,
  fallbackId: string,
  fallbackPriority: number,
): SchedulingPreferenceWindow | null {
  if (!window?.day) return null;
  const next: SchedulingPreferenceWindow = {
    id: window.id?.trim() || fallbackId,
    day: window.day,
    startTime: window.startTime?.trim() ?? "",
    endTime: window.endTime?.trim() ?? "",
    label: window.label?.trim() || undefined,
    note: window.note?.trim() || undefined,
    priority: Number.isFinite(window.priority) ? window.priority : fallbackPriority,
  };
  return isValidSchedulingWindow(next) ? next : null;
}

function cleanSchedulingWindows(
  windows: (Partial<SchedulingPreferenceWindow> | null | undefined)[] | null | undefined,
  idPrefix: string,
): SchedulingPreferenceWindow[] {
  return (windows ?? [])
    .map((window, index) => cleanSchedulingWindow(window, `${idPrefix}_${index + 1}`, index + 1))
    .filter((window): window is SchedulingPreferenceWindow => window != null);
}

function legacyDayToWindow(
  day: CleaningDayPreference,
  kind: "optimal" | "acceptable",
  priority: number,
  idSuffix: string,
): SchedulingPreferenceWindow | null {
  const source = kind === "optimal" ? dayOptimalWindow(day) : dayAcceptableWindow(day);
  return cleanSchedulingWindow(
    {
      id: `${day.id || "legacy"}_${idSuffix}`,
      day: day.day,
      startTime: source.start,
      endTime: source.end,
      label: kind === "optimal" ? "Preferred recurring" : "Acceptable recurring",
      priority,
    },
    `legacy_${idSuffix}_${priority}`,
    priority,
  );
}

function normalizeLegacyDay(day: CleaningDayPreference): CleaningDayPreference {
  const optimal = dayOptimalWindow(day);
  const acceptable = dayAcceptableWindow(day);
  return {
    id: day.id,
    day: day.day,
    optimalStartTime: optimal.start || "09:00",
    optimalEndTime: optimal.end || "12:00",
    acceptableStartTime: acceptable.start || optimal.start || "08:00",
    acceptableEndTime: acceptable.end || optimal.end || "15:00",
  };
}

/** Converts legacy V1 preferences into the V2 recurring/temporary preference model. */
export function legacyPreferencesToV2(
  prefs?: CustomerSchedulingPreferences | null,
): CustomerSchedulingPreferences {
  const base = prefs ?? emptySchedulingPreferences();
  const preferredDays = (base.preferredDays ?? []).map(normalizeLegacyDay);
  const secondaryDays = (base.secondaryDays ?? []).map(normalizeLegacyDay);
  const preferredRecurringWindows = preferredDays
    .map((day, index) => legacyDayToWindow(day, "optimal", index + 1, "preferred"))
    .filter((window): window is SchedulingPreferenceWindow => window != null);
  const acceptableFromPreferred = preferredDays
    .map((day, index) => legacyDayToWindow(day, "acceptable", index + 1, "preferred_acceptable"))
    .filter((window): window is SchedulingPreferenceWindow => window != null);
  const acceptableFromSecondary = secondaryDays
    .map((day, index) => legacyDayToWindow(day, "acceptable", index + 1 + acceptableFromPreferred.length, "secondary"))
    .filter((window): window is SchedulingPreferenceWindow => window != null);

  return {
    version: 2,
    preferredRecurringWindows,
    acceptableRecurringWindows: [...acceptableFromPreferred, ...acceptableFromSecondary],
    acceptableTemporaryWindows: [],
    temporaryReschedulingPriority: normalizeAbsencePriority(base.absencePriority, base.absenceHandling),
    preferredDays,
    secondaryDays,
    absencePriority: normalizeAbsencePriority(base.absencePriority, base.absenceHandling),
    absenceHandling: base.absenceHandling ?? null,
    schedulingNotes: base.schedulingNotes ?? "",
    updatedAt: base.updatedAt,
  };
}

/** Normalizes V2 scheduling preferences while keeping legacy fields readable. */
export function normalizeSchedulingPreferencesV2(
  prefs?: CustomerSchedulingPreferences | null,
): CustomerSchedulingPreferences {
  const legacy = legacyPreferencesToV2(prefs);
  const useStoredPreferredWindows =
    prefs?.version === 2 && Array.isArray(prefs.preferredRecurringWindows);
  const useStoredAcceptableWindows =
    prefs?.version === 2 && Array.isArray(prefs.acceptableRecurringWindows);
  const preferredRecurringWindows = useStoredPreferredWindows
    ? cleanSchedulingWindows(prefs?.preferredRecurringWindows, "preferred_recurring")
    : legacy.preferredRecurringWindows ?? [];
  const acceptableRecurringWindows = useStoredAcceptableWindows
    ? cleanSchedulingWindows(prefs?.acceptableRecurringWindows, "acceptable_recurring")
    : legacy.acceptableRecurringWindows ?? [];
  const acceptableTemporaryWindows =
    prefs?.version === 2 && prefs.acceptableTemporaryWindows
      ? cleanSchedulingWindows(prefs.acceptableTemporaryWindows, "acceptable_temporary")
      : [];
  const temporaryReschedulingPriority = normalizeAbsencePriority(
    prefs?.temporaryReschedulingPriority ?? prefs?.absencePriority,
    prefs?.absenceHandling,
  );

  return {
    ...legacy,
    version: 2,
    preferredRecurringWindows,
    acceptableRecurringWindows,
    acceptableTemporaryWindows,
    temporaryReschedulingPriority,
    absencePriority: temporaryReschedulingPriority,
    schedulingNotes: prefs?.schedulingNotes ?? "",
    updatedAt: prefs?.updatedAt,
  };
}

/** Returns empty cleaning day/time preferences using the V2 model. */
export function emptySchedulingPreferences(): CustomerSchedulingPreferences {
  return {
    version: 2,
    preferredRecurringWindows: [],
    acceptableRecurringWindows: [],
    acceptableTemporaryWindows: [],
    temporaryReschedulingPriority: [...ABSENCE_HANDLING_ORDER],
    preferredDays: [],
    secondaryDays: [],
    absencePriority: [...ABSENCE_HANDLING_ORDER],
    schedulingNotes: "",
  };
}

// ── Customer Card Log ─────────────────────────────────────

/** Where a customer-card change originated. */
export type CustomerCardLogSource = "admin_portal" | "customer_portal";

export const CUSTOMER_CARD_LOG_SOURCE_LABELS: Record<CustomerCardLogSource, string> = {
  admin_portal: "Admin Portal",
  customer_portal: "Customer Portal",
};

/**
 * The kind of actor behind a customer-card change. Supports future filtering
 * and reporting (e.g. "show only customer-initiated changes").
 */
export type CustomerCardLogChangeType =
  | "admin_change"
  | "customer_change"
  | "system_change";

export const CUSTOMER_CARD_LOG_CHANGE_TYPE_LABELS: Record<
  CustomerCardLogChangeType,
  string
> = {
  admin_change: "Admin Change",
  customer_change: "Customer Change",
  system_change: "System Change",
};

/**
 * Derives the change type from the originating portal and acting user. Customer
 * portal edits are customer changes; admin portal edits with a known user are
 * admin changes; anything without a user is treated as a system change.
 */
export function resolveCustomerCardLogChangeType(
  source: CustomerCardLogSource,
  hasActingUser: boolean,
): CustomerCardLogChangeType {
  if (source === "customer_portal") return "customer_change";
  if (!hasActingUser) return "system_change";
  return "admin_change";
}

/**
 * An immutable record of a meaningful change to a customer card. Captures who
 * changed what, the old and new value, and whether it came from the admin or
 * customer portal. Newest displayed first.
 */
export interface CustomerCardLogEntry {
  id: string;
  /** ISO timestamp of when the change happened. */
  at: string;
  /** High-level section that changed, e.g. "Cleaning Days & Times". */
  section: string;
  /** Optional specific field within the section. */
  field?: string;
  /** The kind of actor behind the change (admin / customer / system). */
  changeType: CustomerCardLogChangeType;
  oldValue: string;
  newValue: string;
  changedById: string | null;
  changedByName: string;
  changedByRole: UserRole;
  source: CustomerCardLogSource;
}

/** Payment status of an invoice. */
export type InvoiceStatus = "paid" | "unpaid" | "overdue";

/**
 * An invoice connected to a customer. Read-only on the customer card — invoice
 * generation and finance logic are built later.
 */
export interface Invoice {
  id: string;
  companyId: string;
  customerId: string;
  /** Human-friendly number, e.g. "INV-2001". */
  number: string;
  status: InvoiceStatus;
  /** Total amount due. */
  amountToPay: number;
  /** Amount paid so far. */
  amountPaid: number;
  invoiceDate: string;
  dueDate: string;
  /** Set once the invoice is fully paid. */
  fullyPaidDate?: string;
  /** Date a payment reminder was sent. */
  reminderDate?: string;
  createdAt: string;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
};

/**
 * Structured customer audience segment, used to recommend the right templates:
 *  - `b2b`: businesses (offices, property management).
 *  - `b2c`: private households (homes, apartments).
 *  - `one_time`: single-event jobs (move-out, deep cleaning).
 *
 * Internal recommendation axis derived from {@link CustomerType}. Not edited
 * directly anymore — {@link CustomerType} is the single source of truth.
 */
export type CustomerSegment = "b2b" | "b2c" | "one_time";

/** Display labels for {@link CustomerSegment}. */
export const CUSTOMER_SEGMENT_LABELS: Record<CustomerSegment, string> = {
  b2b: "B2B",
  b2c: "B2C",
  one_time: "One-Time",
};

/**
 * Core, platform-wide customer classification. This is a fixed, hardcoded set —
 * free-text values are not allowed — and is mandatory when creating a customer.
 *
 * Customer Type is a foundational system dimension consumed across modules
 * (work orders, checklists/protocols, portal, news, reporting, AI/automation),
 * not a display label. Use {@link CUSTOMER_TYPE_LABELS} for display.
 *
 *  - `commercial`: businesses — offices, property management, facilities.
 *  - `private`: private households — homes, apartments.
 *  - `one_time`: single-event jobs — move-out, one-off deep cleaning.
 *  - `special_services`: specialized projects — floor care, sanitization, custom packages.
 */
export type CustomerType =
  | "commercial"
  | "private"
  | "one_time"
  | "special_services";

/** Stable, ordered list of the supported {@link CustomerType} values. */
export const CUSTOMER_TYPES: readonly CustomerType[] = [
  "commercial",
  "private",
  "one_time",
  "special_services",
] as const;

/** Display labels for {@link CustomerType}. */
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  commercial: "Commercial",
  private: "Private",
  one_time: "One-Time Customer",
  special_services: "Special Services",
};

/** Short, human-readable descriptions for each {@link CustomerType}. */
export const CUSTOMER_TYPE_DESCRIPTIONS: Record<CustomerType, string> = {
  commercial: "Offices, property management and businesses.",
  private: "Homes, apartments and private households.",
  one_time: "Move-out, deep cleaning and single-event jobs.",
  special_services: "Floor care, sanitization and specialized projects.",
};

/** External customer profile or contact. May connect to one or more logins. */
export interface Customer {
  id: string;
  companyId: string;
  name: string;
  /** Human-friendly customer number, e.g. "C-1001". Searchable. */
  customerNumber: string;
  email: string;
  /** Organization / company registration number (free text). */
  orgNumber?: string;
  status: EntityStatus;
  /**
   * Core customer classification — one of the fixed {@link CustomerType} values.
   * Mandatory for newly created customers; optional on the type only for
   * backwards compatibility with legacy records (normalized on read).
   */
  customerType?: CustomerType;
  /**
   * Internal audience segment used for template discovery / recommendations.
   * Derived automatically from {@link customerType} — not edited directly.
   * Optional for backwards compatibility with pre-classification records.
   */
  customerSegment?: CustomerSegment;
  /**
   * Legacy free-text geographic/operational area. Kept for backwards
   * compatibility and never shown directly once {@link areaId} is set — prefer
   * the structured {@link areaId} going forward.
   */
  area?: string;
  /**
   * Structured operational {@link Area} this customer belongs to. The source of
   * truth for filtering, reporting, scheduling and future assignment rules.
   * Derived from legacy {@link area} text on migration when a name matches.
   */
  areaId?: string;
  /**
   * Internal {@link Employee} responsible for this customer (account owner /
   * customer owner). Optional — unassigned customers display "Not assigned".
   */
  ownerId?: string;
  /**
   * Structured {@link PostalCity} the customer's postal address belongs to. A
   * postal city maps to an {@link Area}, so selecting one can suggest or (when
   * the company enables automatic assignment) set {@link areaId}. Optional — the
   * postal code itself stays free text on the customer's addresses.
   */
  postalCityId?: string;
  /** Free-form labels for grouping and filtering. */
  tags?: string[];
  /** Name of the main contact person at the customer. */
  mainContact?: string;
  /** Primary phone number. */
  phone?: string;
  /** Postal/visiting addresses; flagged for invoice and delivery use. */
  addresses?: CustomerAddress[];
  /** Contact people at the customer. */
  contacts?: CustomerContact[];
  /** Internal admin-only notes. Never exposed to the customer portal. */
  internalNotes?: CustomerNote[];
  /** Structured, typed customer-card notes (admin / assignment / finance). */
  cardNotes?: CustomerCardNote[];
  /** Preferred cleaning days, times and absence handling. Read by Work Orders. */
  schedulingPreferences?: CustomerSchedulingPreferences;
  /** Customer Card change log (contact info, scheduling, notes, settings, …). */
  cardLog?: CustomerCardLogEntry[];
  /**
   * Active cover image. Points to a {@link MediaAsset} in this customer's media
   * library — the asset is never duplicated or moved; this only marks which one
   * represents the customer visually (header, lists, work orders, …). Falls back
   * to initials when unset or when the referenced asset no longer exists.
   */
  coverMediaAssetId?: string;
  /**
   * Reserved for future "featured" imagery (entrance, alarm panel, key cabinet, …)
   * distinct from the single cover. Declared now so featured support needs no
   * schema redesign; no UI ships against it yet.
   */
  featuredMediaAssetIds?: string[];
  /** Linked customer-portal logins. */
  userIds: string[];
  createdAt: string;
  /** ISO timestamp of the last edit to this customer's card. */
  updatedAt?: string;
  /**
   * ISO timestamp when this customer was archived. Archiving is the
   * history-preserving alternative to a permanent delete: it is used when a
   * customer has operational history (work orders / scheduled visits) that must
   * be retained. An archived customer is also set {@link status} inactive so it
   * leaves live planning surfaces. Absent on active/deactivated records.
   */
  archivedAt?: string | null;
  /**
   * Onboarding lifecycle. Absent means onboarding was never started (the
   * customer was added with "Add customer only", or is a legacy record).
   * `in_progress` is set when an admin starts the guided onboarding; the
   * customer list surfaces a badge and the workspace shows an Onboard Process
   * step until it is marked complete.
   */
  onboardingStatus?: "in_progress" | "completed";
  /** ISO timestamp when onboarding was started. */
  onboardingStartedAt?: string;
  /** ISO timestamp when onboarding was marked complete. */
  onboardingCompletedAt?: string;
}

/**
 * A structured operational area (e.g. Gothenburg, Stockholm, Malmö) a customer
 * can belong to. Company-scoped and a real system dimension — it replaces loose
 * free-text area values so filtering, reporting, scheduling and future
 * assignment rules can rely on stable ids rather than typed strings.
 */
export interface Area {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  /** Inactive areas are hidden from pickers but kept for historical references. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A structured postal city (e.g. Mölndal, Partille, Alingsås) that maps to an
 * operational {@link Area}. Company-scoped and managed manually by admins — no
 * external postal-code API is involved. When a customer selects a postal city,
 * the linked area can be suggested or auto-applied. Inactive postal cities are
 * hidden from customer pickers but remain visible in settings for restore/edit.
 */
export interface PostalCity {
  id: string;
  companyId: string;
  /** Display name of the postal city. Normalized for duplicate detection. */
  name: string;
  /** The {@link Area} this postal city belongs to. */
  areaId: string;
  /** Inactive postal cities are hidden from customer pickers but kept. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A controlled, company-scoped language used for employee settings (preferred
 * language) and, in future phases, multilingual checklists, protocols,
 * notifications and portal content. Languages are managed manually by admins —
 * there is no external locale source. Exactly one active language is the
 * company default; inactive languages are hidden from pickers but kept for
 * restore/edit. Employees reference a language by id rather than free text.
 */
export interface EmployeeLanguage {
  id: string;
  companyId: string;
  /** ISO-639 style language code (e.g. "en", "sv", "pl"). Unique per company. */
  code: string;
  /** Display name in the workspace language (e.g. "Polish"). */
  name: string;
  /** Native endonym (e.g. "Polski", "Українська"). */
  nativeName: string;
  /** Inactive languages are hidden from pickers but kept for history. */
  isActive: boolean;
  /** Exactly one active language per company is the default. */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Internal company group or department. Contains employees only, never customers. */
export interface Team {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  createdAt: string;
}

/** A platform feature module that companies can be granted and enable. */
export interface Module {
  id: string;
  name: string;
  description: string;
  /** Global platform availability, controlled by Super Admin. */
  status: EntityStatus;
  /** User types permitted to access this module. */
  allowedUserTypes: UserRole[];
  createdAt: string;
}

/**
 * A global grouping of modules, managed by the Super Admin. A module can belong
 * to multiple categories. Categories drive how modules are grouped in navigation.
 */
export interface ModuleCategory {
  id: string;
  name: string;
  description: string;
  /** Icon key from CATEGORY_ICONS in lib/modules. */
  icon: string;
  /** Lower numbers appear first in navigation. */
  sortOrder: number;
  status: EntityStatus;
  /** User types that may see this category and its modules in navigation. */
  visibleUserTypes: UserRole[];
  /** Modules connected to this category. */
  moduleIds: string[];
  createdAt: string;
}

/** Per-company module configuration. */
export interface CompanyModuleSetting {
  companyId: string;
  moduleId: string;
  /** Super Admin: whether the module is offered to this company. */
  available: boolean;
  /** Company Admin: whether the company has switched it on. */
  enabled: boolean;
}

/**
 * Whether a role is a system-provided template (managed centrally, owned by the
 * platform) or a company-owned role. Derived from the existing
 * {@link Role.companyId}/{@link Role.isSystem} fields via
 * {@link import("@/lib/employeeRoles").roleSourceType} — never stored directly,
 * so legacy persisted roles keep working without migration.
 */
export type RoleSourceType = "systemTemplate" | "companyRole";

export interface Role {
  id: string;
  name: string;
  description: string;
  /** Owning company, or null for a global Super Admin template. */
  companyId: string | null;
  /** Built-in roles cannot be deleted and map to a {@link UserRole}. */
  isSystem: boolean;
  baseRole?: UserRole;
  /** Granted permission keys (see lib/permissions). */
  permissions: string[];
  createdAt: string;
  /**
   * Forward-compatible: id of the {@link Role} template this role was copied
   * from, when created via "copy from template". Absent on legacy/seeded roles.
   * Reserved for the Employee Role Assignment phase; no behaviour depends on it
   * yet.
   */
  templateId?: string | null;
  /**
   * Forward-compatible activation flag. `undefined`/absent is treated as active
   * everywhere (see {@link import("@/lib/employeeRoles").isRoleActive}) so legacy
   * roles need no migration. Inactive company roles are excluded from the
   * assignable list but never deleted.
   */
  isActive?: boolean;
  /** ISO timestamp of the last edit, when tracked. Absent on legacy roles. */
  updatedAt?: string;
}

/** An image attached to any checklist entity (template, floor, room or task). */
export interface ChecklistImage {
  id: string;
  /**
   * Display source. For uploaded images this is the compressed preview layer
   * (never the original); for externally referenced images it is a remote URL.
   */
  url: string;
  caption?: string;
  /**
   * Compressed Media Foundation layers, present when the image was uploaded and
   * processed client-side. Externally referenced (URL) images omit these.
   * Originals are never stored.
   */
  microThumbnailUrl?: string;
  hoverThumbnailUrl?: string;
  previewImageUrl?: string;
}

/** A single cleaning task within a room. */
export interface CleaningTask {
  id: string;
  name: string;
  description?: string;
  /** Whether the task is pre-checked/enabled by default when the checklist is used. */
  autoEnabled: boolean;
  /** Lower numbers appear first. */
  sortOrder: number;
  /** Archived items are hidden by default but never permanently deleted. */
  archived?: boolean;
  /** Free-text notes for training, instructions or quality guidance. */
  notes?: string;
  /** Reference or instructional images. */
  images?: ChecklistImage[];
}

/** A room belonging to a floor, containing cleaning tasks. */
export interface ChecklistRoom {
  id: string;
  name: string;
  sortOrder: number;
  tasks: CleaningTask[];
  archived?: boolean;
  notes?: string;
  images?: ChecklistImage[];
}

/** A floor within a checklist template, containing rooms. */
export interface ChecklistFloor {
  id: string;
  name: string;
  sortOrder: number;
  rooms: ChecklistRoom[];
  archived?: boolean;
  notes?: string;
  images?: ChecklistImage[];
}

/** Whether a template is owned globally by the platform or by a single company. */
export type ChecklistTemplateType = "global" | "company";

/**
 * A reusable cleaning checklist template. Owned globally by the Super Admin
 * (companyId === null) or by a single company. Structure is Template → Floor →
 * Room → Cleaning Task.
 */
export interface ChecklistTemplate {
  id: string;
  /** null = global Super Admin template; otherwise the owning company. */
  companyId: string | null;
  name: string;
  description?: string;
  /** Activate/deactivate without archiving. */
  status: EntityStatus;
  /** Archived templates are hidden from active lists but retained. */
  archived: boolean;
  /** Global templates only: whether offered to companies to adopt. */
  availableToCompanies: boolean;
  /** Explicit ownership type. Global templates have companyId === null. */
  templateType?: ChecklistTemplateType;
  /** User id of the creator, when known. */
  createdBy?: string | null;
  /** Template-level notes for training or customer-specific information. */
  notes?: string;
  /** Template-level reference images. */
  images?: ChecklistImage[];
  floors: ChecklistFloor[];
  createdAt: string;
  updatedAt: string;
}

/** Whether a library item is owned globally by the platform or by a company. */
export type LibraryOwnerType = "global" | "company";

/** Lifecycle status of a reusable library item. */
export type LibraryItemStatus = "active" | "archived";

/** Category groupings for reusable rooms in the Room Library. */
export type RoomLibraryCategory =
  | "office"
  | "residential"
  | "common_area"
  | "sanitary_area"
  | "storage"
  | "outdoor";

/** Category groupings for reusable cleaning tasks in the Cleaning Task Library. */
export type TaskLibraryCategory =
  | "floor_care"
  | "dusting"
  | "waste"
  | "kitchen"
  | "bathroom"
  | "glass"
  | "surface_cleaning"
  | "refill"
  | "special_cleaning";

/**
 * A reusable room/area type stored in the Room Library. Global items (companyId
 * === null) are made available to companies; company items are owned by one
 * company. Items are copied — never live-linked — when added to a template.
 */
export interface LibraryRoom {
  id: string;
  /** null = global Super Admin item; otherwise the owning company. */
  companyId: string | null;
  name: string;
  description?: string;
  /** Optional suggested floor type, e.g. "Ground Floor". */
  suggestedFloorType?: string;
  category: RoomLibraryCategory;
  status: LibraryItemStatus;
  createdBy?: string | null;
  createdAt: string;
}

/**
 * A reusable cleaning task stored in the Cleaning Task Library. Global items are
 * available to companies; company items are owned by one company. Items are
 * copied — never live-linked — when added to a template room.
 */
export interface LibraryTask {
  id: string;
  /** null = global Super Admin item; otherwise the owning company. */
  companyId: string | null;
  name: string;
  description?: string;
  /** The auto-enabled default carried into new template tasks. */
  defaultAutoEnabled: boolean;
  category: TaskLibraryCategory;
  status: LibraryItemStatus;
  createdBy?: string | null;
  createdAt: string;
}

/** Per-company adoption of a global template made available by the Super Admin. */
export interface ChecklistTemplateAdoption {
  companyId: string;
  templateId: string;
  enabled: boolean;
}

/**
 * Lifecycle of a customer protocol.
 * - `inactive_customer` is applied automatically when the owning customer is
 *   deactivated; a company admin can later reactivate the protocol.
 */
export type CustomerProtocolStatus = "draft" | "active" | "archived" | "inactive_customer";

/**
 * The state of a task inside a customer protocol.
 * - `active`: the task should be performed.
 * - `excluded`: visible but intentionally NOT performed (customer opted out).
 * - `inactive`: hidden and not relevant for this protocol.
 */
export type ProtocolTaskState = "active" | "excluded" | "inactive";

/** A cleaning task within a customer protocol, copied from a template task. */
export interface ProtocolTask {
  id: string;
  name: string;
  description?: string;
  /** Carried from the template: whether to auto-activate when the room is enabled. */
  autoEnabled: boolean;
  /** The task state for this customer. Starts inactive. */
  state: ProtocolTaskState;
  /** Optional reason shown when the task is excluded. */
  exclusionReason?: string;
  sortOrder: number;
  /** Archived tasks are hidden by default but recoverable. */
  archived?: boolean;
  /** Customer-specific note, e.g. "Use blue microfiber cloth". */
  notes?: string;
}

/** A room within a customer protocol, copied from a template room. */
export interface ProtocolRoom {
  id: string;
  name: string;
  /** Whether this room is enabled for this customer. Starts inactive. */
  active: boolean;
  sortOrder: number;
  tasks: ProtocolTask[];
  /** Archived rooms are hidden by default but recoverable. */
  archived?: boolean;
  /** Customer-specific note, e.g. "Alarm panel behind door". */
  notes?: string;
}

/** A floor within a customer protocol, copied from a template floor. */
export interface ProtocolFloor {
  id: string;
  name: string;
  sortOrder: number;
  rooms: ProtocolRoom[];
  /** Archived floors are hidden by default but recoverable. */
  archived?: boolean;
  /** Customer-specific note for the whole floor. */
  notes?: string;
}

/**
 * A customer-specific cleaning protocol, created from a {@link ChecklistTemplate}.
 * Once created it is an independent entity: later template changes never modify
 * existing protocols, and protocol edits never affect the source template.
 */
export interface CustomerProtocol {
  id: string;
  /** Owning company — enforces tenant isolation. */
  companyId: string;
  /** The customer this protocol belongs to. */
  customerId: string;
  name: string;
  description?: string;
  /** Template the structure was copied from (reference only; not linked). */
  sourceTemplateId: string;
  /** Snapshot of the source template name at creation time. */
  sourceTemplateName: string;
  createdBy?: string | null;
  status: CustomerProtocolStatus;
  /** Customer-specific note for the whole protocol. */
  notes?: string;
  floors: ProtocolFloor[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A single configurable value within a settings template or a company's copied
 * settings (e.g. a service, customer type, tag or public holiday). The optional
 * {@link detail} carries category-specific extra info such as a description,
 * code, date or parent group — kept generic to avoid premature complexity.
 */
export interface SettingsItem {
  id: string;
  name: string;
  /** Category-specific secondary value (description, code, date, group, …). */
  detail?: string;
}

/** The default values a settings template (or company settings) holds per category. */
export interface SettingsData {
  /**
   * @deprecated Services are now managed in Settings → Services as universal
   * master data. Retained on the type so existing persisted data stays valid;
   * it is no longer edited inline in templates or company setup.
   */
  services: SettingsItem[];
  /**
   * @deprecated Legacy free-text customer types. Customer classification is now
   * governed by the fixed {@link CustomerType} enum (the single source of truth
   * for pricing, RUT, invoice rules, agreement templates, statistics and
   * automation). This free-text list must NOT drive business logic; it is
   * retained only so existing persisted data stays valid and is no longer shown
   * as an editable Settings category.
   */
  customerTypes: SettingsItem[];
  areas: SettingsItem[];
  tags: SettingsItem[];
  tagGroups: SettingsItem[];
  materials: SettingsItem[];
  workOrderGroups: SettingsItem[];
  /**
   * @deprecated Time Codes are now a platform-level entity managed in
   * Settings → Time Codes (see {@link TimeCode}). Retained on the type so
   * existing persisted data stays valid; no longer edited inline in templates
   * or company setup.
   */
  timeCodes: SettingsItem[];
  publicHolidays: SettingsItem[];
}

/** The settings categories, in display order, with labels for their detail field. */
export const SETTINGS_CATEGORIES: {
  key: keyof SettingsData;
  label: string;
  /** Whether items carry a secondary detail, and what to call it. */
  detailLabel?: string;
  /** Placeholder for the detail input. */
  detailPlaceholder?: string;
}[] = [
  { key: "areas", label: "Areas" },
  { key: "tagGroups", label: "Tag Groups" },
  { key: "tags", label: "Tags", detailLabel: "Group", detailPlaceholder: "Optional group" },
  { key: "materials", label: "Materials" },
  { key: "workOrderGroups", label: "Work Order Groups" },
  { key: "publicHolidays", label: "Public Holidays", detailLabel: "Date", detailPlaceholder: "e.g. 17 May" },
];

/** Returns an empty settings data object with all categories present. */
export function emptySettingsData(): SettingsData {
  return {
    services: [],
    customerTypes: [],
    areas: [],
    tags: [],
    tagGroups: [],
    materials: [],
    workOrderGroups: [],
    timeCodes: [],
    publicHolidays: [],
  };
}

/**
 * A global, Super Admin-owned settings template. Companies can copy one of these
 * into their workspace at setup time; the copy is independent so later template
 * edits never change a company's settings.
 */
export interface SettingsTemplate {
  id: string;
  name: string;
  description?: string;
  /** Archived templates are hidden from the active list but recoverable. */
  archived: boolean;
  createdBy?: string | null;
  /**
   * Recommended service package a company can copy when starting from this
   * template. Reference only — services are managed in Settings → Services.
   */
  recommendedServicePackageId?: string | null;
  data: SettingsData;
  createdAt: string;
  updatedAt: string;
}

// ── Services (universal business catalog) ──────────────────

/** How a service is billed. Pricing logic itself is built later. */
export type ServiceBillingType = "fixed" | "hourly" | "per_unit" | "subscription";

/** Tax-deduction scheme a service may qualify for (e.g. Swedish RUT/ROT). */
export type ServiceDeductionType = "none" | "rut" | "rot" | "green";

/**
 * Whether a service contributes to the Payroll Basis, the Invoice Basis, or
 * neither. This is the foundation classification consumed by future
 * PayrollBasis, InvoiceBasis and workforce-statistics calculations.
 *
 * IMPORTANT — this is a distinct concern from {@link ServiceBillingType}
 * (how the service is *priced*) and {@link Service.timeCodeId} (the payroll
 * *time-code* classification). It must never be derived from either:
 *  - `billable`     → included in Payroll Basis AND Invoice Basis (e.g. Home cleaning).
 *  - `non_billable` → included in Payroll Basis, EXCLUDED from Invoice Basis (e.g. travel, internal time).
 *  - `excluded`     → excluded from BOTH (pure informational time blocks).
 *
 * Generated payroll/statistics rows must SNAPSHOT this value so historical
 * figures never change if a Service is reclassified later.
 */
export type ServiceBasisType = "billable" | "non_billable" | "excluded";

/**
 * Stable, system-level classification of a {@link ServiceCategory}. This is the
 * value all logic (future category-scoped registration flows, statistics
 * aggregation, payroll/absence filtering) must key off — NEVER the human display
 * name, which is editable. Owned by the Super Admin governance catalogue.
 *
 *  - `recurring_service` → scheduled, repeating customer services.
 *  - `one_time_service`  → single-occasion customer services.
 *  - `special_service`   → specialised/add-on customer services.
 *  - `window_cleaning`   → window-cleaning services (distinct operational flow).
 *  - `non_billable`      → worked time that is not invoiced (travel, internal, meetings).
 *  - `absence`           → leave (vacation, sick, VAB, parental).
 *  - `information`       → pure informational entries / time blocks.
 */
export type ServiceCategoryType =
  | "recurring_service"
  | "one_time_service"
  | "special_service"
  | "window_cleaning"
  | "non_billable"
  | "absence"
  | "information";

/**
 * A category grouping services in the universal catalog. Global items
 * (companyId === null) are managed by the Super Admin; company items are owned
 * by one company. Categories are copied — never live-linked — when a service
 * package is applied to a company.
 */
export interface ServiceCategory {
  id: string;
  /** null = global Super Admin category; otherwise the owning company. */
  companyId: string | null;
  name: string;
  /**
   * Stable system classification. Optional for backward compatibility with
   * records written before the field existed; legacy/company categories without
   * one are treated as uncategorised by type-scoped flows. Display logic must
   * read this, never {@link name}.
   */
  categoryType?: ServiceCategoryType;
  description?: string;
  /** Lower numbers appear first. */
  sortOrder: number;
  status: LibraryItemStatus;
  createdBy?: string | null;
  createdAt: string;
  /** Last edit timestamp. Optional for records written before the field existed. */
  updatedAt?: string;
}

/**
 * A payroll/statistics aggregation group a {@link Service} can optionally belong
 * to. Future payroll and workforce-statistics features aggregate by group rather
 * than reading individual services, so reclassifying a single service never
 * forces a reporting refactor. Super Admin governed master data.
 */
export type PayrollGroupType =
  | "working_time"
  | "travel_time"
  | "absence"
  | "internal_time"
  | "information";

/** A payroll/statistics aggregation group (master data). */
export interface PayrollGroup {
  id: string;
  /** null = global Super Admin group; otherwise the owning company. */
  companyId: string | null;
  name: string;
  /** Stable system classification; logic keys off this, never {@link name}. */
  groupType: PayrollGroupType;
  description?: string;
  /** Lower numbers appear first. */
  sortOrder: number;
  status: LibraryItemStatus;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/**
 * A universal service item (master data). Services are not country-specific by
 * default; country settings (VAT defaults, deductions, sales accounts) connect
 * later. Global services (companyId === null) are managed by the Super Admin.
 */
export interface Service {
  id: string;
  /** null = global Super Admin service; otherwise the owning company. */
  companyId: string | null;
  /** Owning category id, or null if uncategorised. */
  categoryId: string | null;
  name: string;
  description?: string;
  articleNumber?: string;
  /**
   * Business behavior of the service (e.g. Cleaning, Travel, Material). Distinct
   * from {@link categoryId}, which is the organizational grouping. See
   * {@link SERVICE_TYPES}.
   */
  serviceType?: string;
  /**
   * Reference to a Time Code defined in company settings (the SettingsItem id).
   * The denormalized {@link timeCode} string is kept in sync for search/copy.
   */
  timeCodeId?: string | null;
  /** Denormalized time-code label (e.g. "T-100"), derived from {@link timeCodeId}. */
  timeCode?: string;
  /** Unit of measure (e.g. hour, m², piece). Free text for now. */
  unit?: string;
  billingType: ServiceBillingType;
  /**
   * Whether the service contributes to payroll basis, invoice basis, or neither.
   * Mandatory classification; existing records are backfilled to `billable`.
   * Kept independent of {@link billingType} and {@link timeCodeId}.
   */
  serviceBasisType: ServiceBasisType;
  /**
   * Optional {@link PayrollGroup} the service rolls up into for payroll/statistics
   * aggregation. Independent of {@link serviceBasisType} and {@link timeCodeId}.
   * Null/undefined = ungrouped.
   */
  payrollGroupId?: string | null;
  deductionEligible: boolean;
  deductionType: ServiceDeductionType;
  price?: number;
  vat?: number;
  minimumPrice?: number;
  salesAccount?: string;
  smsEnabled: boolean;
  status: LibraryItemStatus;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A self-contained service definition inside a {@link ServicePackage}. Carries
 * its category by name so packages can be copied into any company without a
 * live link to global categories.
 */
export interface ServicePackageItem {
  id: string;
  name: string;
  description?: string;
  /** Category grouping by name; recreated as a company category on copy. */
  categoryName: string;
  /**
   * Source catalog {@link Service.id} this item was snapshotted from (Phase 2,
   * controlled selection). Optional: legacy free-text package items written
   * before controlled selection have no source link. Never used as a live link —
   * the snapshot fields above remain authoritative for copy-safety.
   */
  sourceServiceId?: string;
  /**
   * Source catalog {@link ServiceCategory.id} the snapshotted service belonged to
   * (Phase 2). Optional: undefined for uncategorised services and legacy items.
   */
  sourceCategoryId?: string;
  articleNumber?: string;
  serviceType?: string;
  timeCode?: string;
  billingType: ServiceBillingType;
  /**
   * Mirrors {@link Service.serviceBasisType} so the classification survives a
   * package copy. Optional on the package item for backward compatibility;
   * defaults to `billable` when copied into a company catalog.
   */
  serviceBasisType?: ServiceBasisType;
  /** Mirrors {@link Service.payrollGroupId} by group type so the rollup survives a package copy. */
  payrollGroupType?: PayrollGroupType;
  deductionEligible: boolean;
  deductionType: ServiceDeductionType;
  price?: number;
  vat?: number;
  minimumPrice?: number;
  salesAccount?: string;
  smsEnabled: boolean;
}

// ── Time Codes (payroll foundation) ──────────────────

/**
 * The behavioural class of a {@link TimeCode}. Drives future payroll reports,
 * salary-basis exports (Fortnox Payroll, PAXml) and attendance/absence
 * statistics. `attendance` covers worked/travel time; `absence` covers leave
 * (vacation, sick, VAB, parental).
 */
export type TimeCodeType = "attendance" | "absence";

/** Display labels and order for time-code types. */
export const TIME_CODE_TYPES: { value: TimeCodeType; label: string }[] = [
  { value: "attendance", label: "Attendance" },
  { value: "absence", label: "Absence" },
];

export const TIME_CODE_TYPE_LABELS: Record<TimeCodeType, string> =
  Object.fromEntries(TIME_CODE_TYPES.map((t) => [t.value, t.label])) as Record<
    TimeCodeType,
    string
  >;

/**
 * A platform-level payroll Time Code (master data). This is a reusable platform
 * component — NOT a free-text field on a service. Time Codes are the foundation
 * for payroll reports, salary-basis exports, Fortnox Payroll, PAXml exports,
 * and attendance/absence reporting.
 *
 * Ownership model:
 *  - `companyId === null` is a global master code owned by the Super Admin
 *    (the `global_time_codes` library).
 *  - A non-null `companyId` is a company-specific custom code (the future
 *    `company_time_codes` library). The schema supports it now so future
 *    migrations never break; company codes are not authored in this phase.
 *
 * Codes are never hard-deleted while referenced by historical data — they are
 * deactivated ({@link active} = false) so existing services and exports keep
 * resolving. {@link systemManaged} codes (the seeded master library) can never
 * be deleted, only deactivated.
 */
export interface TimeCode {
  id: string;
  /** null = global Super Admin master code; otherwise a company-specific code (future). */
  companyId: string | null;
  /** Payroll code, e.g. "10", "355". Unique within its (scope, code) pair. */
  code: string;
  name: string;
  type: TimeCodeType;
  description?: string;
  /** Whether the code is active and selectable. Inactive codes stay for history. */
  active: boolean;
  /** Seeded master codes that can be deactivated but never deleted. */
  systemManaged: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Payroll Export (architecture foundation) ──────────────────

/**
 * The destination kind for a payroll export. Each value maps 1:1 to an
 * entitlement key (`payroll.export.<target>`) and to a {@link PayrollExportAdapter}.
 *
 * IMPORTANT — adapter-based by design: NOTHING here hardcodes Fortnox/PAXml/Visma/
 * Hogia as the only paths. New targets are added by registering a new adapter and
 * entitlement key, never by rewriting {@link PayrollBasis}. Real adapters are not
 * implemented in this phase (only a CSV reference adapter for testing).
 */
export type PayrollExportTargetKey =
  | "csv"
  | "excel"
  | "paxml"
  | "fortnox"
  | "visma"
  | "hogia"
  | "api"
  | "sftp"
  | "webhook"
  | "custom";

/** Every payroll export target, in display order, with its label. */
export const PAYROLL_EXPORT_TARGETS: {
  value: PayrollExportTargetKey;
  label: string;
  /** A short description of the destination, for the admin UI. */
  description: string;
}[] = [
  { value: "csv", label: "CSV", description: "Generic comma-separated file." },
  { value: "excel", label: "Excel", description: "Spreadsheet workbook export." },
  { value: "paxml", label: "PAXml", description: "Swedish payroll interchange (PAXml)." },
  { value: "fortnox", label: "Fortnox Payroll", description: "Fortnox payroll integration." },
  { value: "visma", label: "Visma", description: "Visma payroll integration." },
  { value: "hogia", label: "Hogia", description: "Hogia payroll integration." },
  { value: "api", label: "API", description: "Generic HTTP API push." },
  { value: "sftp", label: "SFTP", description: "Secure file transfer to a remote server." },
  { value: "webhook", label: "Webhook", description: "Outbound webhook delivery." },
  { value: "custom", label: "Custom", description: "Customer-specific custom export." },
];

export const PAYROLL_EXPORT_TARGET_LABELS: Record<PayrollExportTargetKey, string> =
  Object.fromEntries(PAYROLL_EXPORT_TARGETS.map((t) => [t.value, t.label])) as Record<
    PayrollExportTargetKey,
    string
  >;

/**
 * The entitlement key gating a payroll export target. Each target is separately
 * activatable by the Super Admin per company, so company admins only ever see the
 * export options their company has been granted.
 */
export type PayrollExportEntitlementKey = `payroll.export.${PayrollExportTargetKey}`;

/** The entitlement key for a target, e.g. `csv` → `payroll.export.csv`. */
export function payrollExportEntitlementKey(
  target: PayrollExportTargetKey,
): PayrollExportEntitlementKey {
  return `payroll.export.${target}`;
}

/** Every payroll-export entitlement key, in target order. */
export const PAYROLL_EXPORT_ENTITLEMENT_KEYS: PayrollExportEntitlementKey[] =
  PAYROLL_EXPORT_TARGETS.map((t) => payrollExportEntitlementKey(t.value));

/**
 * A per-company activation of a payroll export target, owned by the Super Admin.
 * Presence with `enabled: true` means the company may create/configure profiles
 * for that target. This is intentionally a thin capability record (NOT the heavy
 * service-entitlement bundle system) so the payroll layer stays self-contained
 * and adapter-based.
 */
export interface PayrollExportCapability {
  companyId: string;
  target: PayrollExportTargetKey;
  enabled: boolean;
  /** When the capability was last enabled; null while disabled. */
  enabledAt: string | null;
  /** The user id (Super Admin) who last changed it. */
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * A company-specific export setup. Defines WHERE and in WHAT FORMAT a payroll
 * basis is exported. Format-agnostic configuration lives in {@link config}; real
 * secrets are NEVER stored here — only a {@link credentialsRef} pointing at a
 * future secrets store (e.g. a Supabase Vault / KMS handle).
 */
export interface PayrollExportProfile {
  id: string;
  companyId: string;
  name: string;
  /** The export destination; gated by its entitlement + adapter. */
  target: PayrollExportTargetKey;
  /** Whether this profile may be used to run exports. */
  active: boolean;
  /**
   * Non-secret configuration metadata (e.g. delimiter, endpoint path, mapping
   * options). Never store credentials/tokens here — use {@link credentialsRef}.
   */
  config: Record<string, string | number | boolean>;
  /**
   * Opaque reference to externally-stored credentials (NOT the secret itself).
   * Null until a credential is provisioned by a future secrets-management step.
   */
  credentialsRef: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The unit a {@link PayrollBasisRow} quantity is expressed in. */
export type PayrollBasisUnit = "hours" | "days" | "units";

/**
 * One approved/calculated payroll line in a {@link PayrollBasis}. Always carries
 * a {@link timeCodeId} reference (never free text) so exports resolve the code
 * label/type at transform time. This is the internal, format-independent shape.
 */
export interface PayrollBasisRow {
  id: string;
  employeeId: string;
  /** Denormalised name for display/export convenience. */
  employeeName: string;
  /** Reference to a {@link TimeCode}; resolved by adapters at export time. */
  timeCodeId: string;
  /** ISO date (YYYY-MM-DD) the row applies to. */
  date: string;
  quantity: number;
  unit: PayrollBasisUnit;
  /** Optional source work order, for traceability. */
  workOrderId?: string | null;
  note?: string;
}

/**
 * FUTURE row shape (architecture only — not generated yet). One worked/registered
 * line for an employee on a date, fully SNAPSHOTTED so historical statistics are
 * immutable when the source Service / TimeCode / employment terms change later.
 *
 * Canonical storage is {@link durationMinutes}; hours are derived at read time
 * (`durationMinutes / 60`). Calculations must read ONLY the `*Snapshot` fields,
 * never the live Service/TimeCode/employee records.
 *
 * Supports future workforce statistics: contracted vs registered hours,
 * remaining/missing hours, overtime, billable / non-billable / excluded hours,
 * and billable percentage — all derivable from {@link serviceBasisTypeSnapshot}
 * + {@link durationMinutes} + the employment snapshots.
 */
export interface WorkStatisticsRow {
  id: string;
  /** Source service id (reference for traceability only — never read for math). */
  serviceId: string;
  /** Snapshot of the service name at generation time. */
  serviceNameSnapshot: string;
  /** Snapshot of the service basis type — drives payroll/invoice inclusion. */
  serviceBasisTypeSnapshot: ServiceBasisType;
  /** Reference to the {@link TimeCode} (resolved by adapters at export time). */
  timeCodeId: string | null;
  /** Snapshot of the time-code label (e.g. "10 — Worked Time") at generation time. */
  timeCodeSnapshot: string | null;
  employeeId: string;
  /** ISO date (YYYY-MM-DD) the row applies to. */
  date: string;
  /** Canonical duration in minutes. Hours are derived (`/ 60`) at read time. */
  durationMinutes: number;
  /** What produced this row (e.g. "work_order", "time_report", "manual"). */
  sourceType: string;
  /** Id of the producing record (e.g. a work order id). */
  sourceId: string;
  /** Snapshot of the employee's employment rate (0–1) at generation time, if known. */
  employeeEmploymentRateSnapshot?: number | null;
  /** Snapshot of the employee's contracted hours at generation time, if known. */
  employeeContractHoursSnapshot?: number | null;
}

/** The lifecycle of a {@link PayrollBasis}. Only `approved` bases may be exported. */
export type PayrollBasisStatus = "draft" | "calculated" | "approved";

/**
 * The internal SOURCE OF TRUTH for payroll: a set of calculated/approved rows for
 * one company over a period. It is deliberately INDEPENDENT of any export format —
 * adapters transform it; it never knows about CSV/Fortnox/etc. Full payroll
 * calculation is out of scope this phase; the shape is established now.
 */
export interface PayrollBasis {
  id: string;
  companyId: string;
  /** ISO date (inclusive) the period starts. */
  periodStart: string;
  /** ISO date (inclusive) the period ends. */
  periodEnd: string;
  status: PayrollBasisStatus;
  rows: PayrollBasisRow[];
  createdAt: string;
  updatedAt: string;
}

/** The outcome status of a {@link PayrollExportRun}. */
export type PayrollExportRunStatus = "pending" | "success" | "partial" | "failed";

/**
 * A record of a single export attempt. Stored for audit/observability so every
 * run is traceable. `resultRef` points at a generated file reference or an API
 * response reference — never the raw payload of a sensitive integration.
 */
export interface PayrollExportRun {
  id: string;
  companyId: string;
  profileId: string;
  /** The basis exported, when one was attached. */
  basisId: string | null;
  status: PayrollExportRunStatus;
  /** ISO timestamp the run was attempted. */
  timestamp: string;
  /** The user who triggered the run. */
  userId: string | null;
  rowsIncluded: number;
  warnings: string[];
  errors: string[];
  /** Generated file reference or API response reference (not the payload). */
  resultRef: string | null;
  createdAt: string;
}

/**
 * A reusable group of services a company can copy into its own catalog. Managed
 * globally by the Super Admin. On copy, company-owned categories and services
 * are created — never live links — so later package edits don't change a company.
 */
export interface ServicePackage {
  id: string;
  name: string;
  description?: string;
  archived: boolean;
  createdBy?: string | null;
  items: ServicePackageItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Common service types describing a service's business behavior (as opposed to
 * its organizational {@link ServiceCategory}). Used as suggestions in the
 * service editor; custom values remain supported.
 */
export const SERVICE_TYPES: string[] = [
  "Cleaning",
  "Travel",
  "Material",
  "Invoice Item",
  "Payroll Item",
];

/** Display labels and order for service billing types. */
export const SERVICE_BILLING_TYPES: { value: ServiceBillingType; label: string }[] = [
  { value: "fixed", label: "Fixed Price" },
  { value: "hourly", label: "Hourly" },
  { value: "per_unit", label: "Per Unit" },
  { value: "subscription", label: "Subscription" },
];

/** Display labels and order for service deduction types. */
export const SERVICE_DEDUCTION_TYPES: { value: ServiceDeductionType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "rut", label: "RUT" },
  { value: "rot", label: "ROT" },
  { value: "green", label: "Green Deduction" },
];

export const SERVICE_BILLING_TYPE_LABELS: Record<ServiceBillingType, string> =
  Object.fromEntries(SERVICE_BILLING_TYPES.map((b) => [b.value, b.label])) as Record<
    ServiceBillingType,
    string
  >;

export const SERVICE_DEDUCTION_TYPE_LABELS: Record<ServiceDeductionType, string> =
  Object.fromEntries(SERVICE_DEDUCTION_TYPES.map((d) => [d.value, d.label])) as Record<
    ServiceDeductionType,
    string
  >;

/**
 * Display labels and order for service basis types. Labels are Swedish, matching
 * the rest of the payroll/billing terminology shown to operators.
 */
export const SERVICE_BASIS_TYPES: {
  value: ServiceBasisType;
  label: string;
  /** Short operator-facing explanation of the rule. */
  description: string;
}[] = [
  {
    value: "billable",
    label: "Debiterbar",
    description: "Included in payroll basis and invoice basis.",
  },
  {
    value: "non_billable",
    label: "Ej debiterbar",
    description: "Included in payroll basis, excluded from invoice basis.",
  },
  {
    value: "excluded",
    label: "Ej underlag",
    description: "Excluded from both payroll basis and invoice basis.",
  },
];

export const SERVICE_BASIS_TYPE_LABELS: Record<ServiceBasisType, string> =
  Object.fromEntries(SERVICE_BASIS_TYPES.map((b) => [b.value, b.label])) as Record<
    ServiceBasisType,
    string
  >;

/** The default basis type for new services and backfilled legacy records. */
export const DEFAULT_SERVICE_BASIS_TYPE: ServiceBasisType = "billable";

/**
 * The governed Service Category catalogue, owned by the Super Admin. Display
 * order, names and descriptions live here; the {@link ServiceCategoryType} is
 * the stable system key. Seeding and migrations build the global catalogue from
 * this list, so it is the single source of truth for the initial categories.
 */
export const SERVICE_CATEGORY_TYPES: {
  value: ServiceCategoryType;
  /** Default display name for the seeded global category. */
  label: string;
  description: string;
}[] = [
  { value: "recurring_service", label: "Recurring Services", description: "Scheduled, repeating customer services." },
  { value: "one_time_service", label: "One-Time Services", description: "Single-occasion customer services." },
  { value: "special_service", label: "Special Services", description: "Specialised and add-on services." },
  { value: "window_cleaning", label: "Window Cleaning", description: "Window-cleaning services." },
  { value: "non_billable", label: "Non-Billable Time", description: "Worked time not invoiced (travel, internal, meetings)." },
  { value: "absence", label: "Absence", description: "Leave: vacation, sick, VAB, parental." },
  { value: "information", label: "Information Entries", description: "Pure informational entries and time blocks." },
];

export const SERVICE_CATEGORY_TYPE_LABELS: Record<ServiceCategoryType, string> =
  Object.fromEntries(SERVICE_CATEGORY_TYPES.map((c) => [c.value, c.label])) as Record<
    ServiceCategoryType,
    string
  >;

/**
 * The governed Payroll Group catalogue, owned by the Super Admin. Used as the
 * seed for global payroll groups and as the label source for UI. Logic keys off
 * {@link PayrollGroupType}.
 */
export const PAYROLL_GROUP_TYPES: {
  value: PayrollGroupType;
  label: string;
  description: string;
}[] = [
  { value: "working_time", label: "Working Time", description: "Worked, billable/non-billable customer service time." },
  { value: "travel_time", label: "Travel Time", description: "Time spent travelling between assignments." },
  { value: "absence", label: "Absence", description: "Leave: vacation, sick, VAB, parental." },
  { value: "internal_time", label: "Internal Time", description: "Meetings, administration, training." },
  { value: "information", label: "Information", description: "Informational entries with no payroll effect." },
];

export const PAYROLL_GROUP_TYPE_LABELS: Record<PayrollGroupType, string> =
  Object.fromEntries(PAYROLL_GROUP_TYPES.map((g) => [g.value, g.label])) as Record<
    PayrollGroupType,
    string
  >;

/**
 * A company's own settings, established at setup time. {@link initialized} flips
 * true once the admin chooses to start from a template or start blank. When a
 * template is used, {@link sourceTemplateId} records where it came from (for
 * reference only — the data is an independent copy).
 */
export interface CompanySettings {
  companyId: string;
  initialized: boolean;
  sourceTemplateId: string | null;
  sourceTemplateName: string | null;
  data: SettingsData;
  updatedAt: string;
}

/** A recorded action for the audit-log foundation. */
export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.password_reset"
  | "company.create"
  | "company.update"
  | "user.create"
  | "user.update"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "role.assign"
  | "module.status"
  | "module.available"
  | "module.enabled"
  | "category.create"
  | "category.update"
  | "category.delete"
  | "checklist.create"
  | "checklist.update"
  | "checklist.archive"
  | "checklist.clone"
  | "checklist.adopt"
  | "library.create"
  | "library.update"
  | "library.archive"
  | "protocol.create"
  | "protocol.update"
  | "protocol.archive"
  | "settings_template.create"
  | "settings_template.update"
  | "settings_template.archive"
  | "settings_template.clone"
  | "service.create"
  | "service.update"
  | "service.basis_type"
  | "service.archive"
  | "service.delete"
  | "service_category.create"
  | "service_category.update"
  | "service_category.archive"
  | "service_package.create"
  | "service_package.update"
  | "service_package.archive"
  | "service_package.clone"
  | "service_package.apply"
  | "timecode.create"
  | "timecode.update"
  | "timecode.activate"
  | "timecode.deactivate"
  | "timecode.assign"
  | "workorder.create"
  | "workorder.update"
  | "workorder.note"
  | "workorder.service"
  | "workorder.timereport"
  | "bookingqueue.create"
  | "bookingqueue.delete"
  | "bookingqueue.cancel"
  | "bookingqueue.restore"
  | "bookingqueue.reschedule"
  | "workorder.service.force_delete"
  | "company_settings.initialize"
  | "system_settings.update"
  | "calculator.pricing_rule_update"
  | "entitlements.resolver_changed"
  | "entitlements.shadow_log_changed"
  | "service_entitlement.global"
  | "service_entitlement.company"
  | "impersonation.start"
  | "impersonation.end"
  | "customer.archive"
  | "customer.delete"
  | "employee.archive"
  | "employee.delete"
  | "payroll.export.capability.enable"
  | "payroll.export.capability.disable"
  | "payroll.export.profile.create"
  | "payroll.export.profile.update"
  | "payroll.export.profile.activate"
  | "payroll.export.profile.deactivate"
  | "payroll.export.profile.delete"
  | "payroll.export.run";

/** An immutable record of a meaningful action, scoped to a company when relevant. */
export interface AuditEvent {
  id: string;
  /** ISO timestamp of when the action happened. */
  at: string;
  actorId: string | null;
  actorName: string;
  actorRole: UserRole;
  /** Company the affected resource belongs to, or null for platform-level events. */
  companyId: string | null;
  action: AuditAction;
  /** Human-readable description of what happened. */
  summary: string;
}

/**
 * Metadata for the secure file storage foundation. Files are company-scoped and
 * gated by a permission key so future modules can store documents safely.
 */
export interface StoredFile {
  id: string;
  /** Owning company — enforces tenant isolation. */
  companyId: string;
  /** Module the file belongs to, or null for general workspace files. */
  moduleId: string | null;
  name: string;
  mimeType: string;
  /** Size in bytes. */
  size: number;
  /** Permission key a user must hold to read this file. */
  requiredPermission: string;
  uploadedBy: string;
  uploadedAt: string;
}

// ---------------------------------------------------------------------------
// Media Foundation V1
//
// A storage-efficient, mobile-first image system for field workers. The
// guiding principle is that original images are NEVER persisted. The camera /
// picker image is processed client-side into three heavily compressed WebP
// layers, only those layers are stored, and the original is discarded.
// ---------------------------------------------------------------------------

/** Optional-feature categories an image can belong to. Registry-driven. */
export type MediaCategory =
  | "customer"
  | "cover"
  | "profile"
  | "key"
  | "alarm"
  | "entrance"
  | "cleaning_result"
  | "quality_issue"
  | "work_order"
  | "employee"
  | "protocol"
  | "deviation"
  | "damage"
  | "material"
  | "before_after"
  | "instruction";

/**
 * The kind of entity a media asset is attached to. Generic entity linking is
 * preferred over per-module image tables so new modules need no schema change.
 */
export type MediaEntityType =
  | "customer"
  | "work_order"
  | "employee"
  | "protocol"
  | "deviation"
  | "damage"
  | "material";

/** The three compressed layers produced for every uploaded image. */
export type MediaLayer = "micro" | "hover" | "preview";

/**
 * Where an image is *used* — i.e. which surfaces/modules may surface it. This is
 * a content-availability concept, not a security boundary. Registry-driven so
 * new surfaces can be added without schema changes.
 */
export type MediaUsageTarget =
  | "customer_card"
  | "work_order"
  | "cleaning_protocol"
  | "schedule"
  | "employee_app"
  | "customer_portal"
  | "material"
  | "deviation"
  | "damage";

/**
 * Who an image is *visible for* — a content-visibility rule layered on top of
 * (never instead of) company isolation and role permissions. `scheduler` is a
 * forward-looking target that has no dedicated {@link UserRole} yet.
 */
export type MediaVisibilityTarget =
  | "super_admin"
  | "company_admin"
  | "scheduler"
  | "employee"
  | "customer";

/**
 * A processed image in the Media Foundation. Only the three derived WebP layers
 * are ever stored — there is intentionally no `originalUrl`. Each asset is
 * company-scoped for tenant isolation and links to a host entity generically.
 */
export interface MediaAsset {
  id: string;
  /** Owning company — enforces tenant isolation. */
  companyId: string;
  /** Feature/usage category (see {@link MediaCategory}). */
  category: MediaCategory;
  /** Host entity kind this image is attached to. */
  entityType: MediaEntityType;
  /** Host entity id this image is attached to. */
  entityId: string;
  /** User id of the uploader. */
  uploadedBy: string;
  /** Role of the uploader at upload time (audit / future billing). */
  uploadedByRole: UserRole;
  /** ~50–80px WebP for lists & grids. Loads first, everywhere. */
  microThumbnailUrl: string;
  /** ~300–500px WebP for hover / popover previews. Loaded on demand. */
  hoverThumbnailUrl: string;
  /** ~1000–1400px WebP for the image viewer. Loaded only when opened. */
  previewImageUrl: string;
  /** Intrinsic width of the source image, in pixels. */
  width: number;
  /** Intrinsic height of the source image, in pixels. */
  height: number;
  /** Combined stored size of all three layers, in bytes. */
  fileSize: number;
  createdAt: string;
  /**
   * Optional caption / alt text. Reserved for future tagging & comments — the
   * field exists now so the model is stable, but no editing UI ships in V1.
   */
  caption?: string;
  /**
   * Surfaces/modules this image may appear in. When omitted (e.g. assets created
   * before this model), callers fall back to the category defaults — see
   * `resolveMediaUsage` in the media store. Never duplicates the image.
   */
  usedIn?: MediaUsageTarget[];
  /**
   * Audiences allowed to see this image. When omitted, callers fall back to the
   * category defaults — see `resolveMediaVisibility`. This is a content rule and
   * is always enforced alongside company isolation and role permissions.
   */
  visibleFor?: MediaVisibilityTarget[];
}

/** Display labels and order for protocol task states. */
export const PROTOCOL_TASK_STATES: { value: ProtocolTaskState; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "excluded", label: "Excluded" },
  { value: "inactive", label: "Inactive" },
];

export const PROTOCOL_TASK_STATE_LABELS: Record<ProtocolTaskState, string> = {
  active: "Active",
  excluded: "Excluded",
  inactive: "Inactive",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  employee: "Employee",
  customer: "Customer",
};

/** Roles a Company Admin is allowed to assign within their own company. */
export const ASSIGNABLE_ROLES: UserRole[] = ["company_admin", "employee", "customer"];

/** Display labels and order for Room Library categories. */
export const ROOM_LIBRARY_CATEGORIES: { value: RoomLibraryCategory; label: string }[] = [
  { value: "office", label: "Office" },
  { value: "residential", label: "Residential" },
  { value: "common_area", label: "Common Area" },
  { value: "sanitary_area", label: "Sanitary Area" },
  { value: "storage", label: "Storage" },
  { value: "outdoor", label: "Outdoor" },
];

/** Display labels and order for Cleaning Task Library categories. */
export const TASK_LIBRARY_CATEGORIES: { value: TaskLibraryCategory; label: string }[] = [
  { value: "floor_care", label: "Floor Care" },
  { value: "dusting", label: "Dusting" },
  { value: "waste", label: "Waste" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "glass", label: "Glass" },
  { value: "surface_cleaning", label: "Surface Cleaning" },
  { value: "refill", label: "Refill" },
  { value: "special_cleaning", label: "Special Cleaning" },
];

export const ROOM_LIBRARY_CATEGORY_LABELS: Record<RoomLibraryCategory, string> =
  Object.fromEntries(ROOM_LIBRARY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
    RoomLibraryCategory,
    string
  >;

export const TASK_LIBRARY_CATEGORY_LABELS: Record<TaskLibraryCategory, string> =
  Object.fromEntries(TASK_LIBRARY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
    TaskLibraryCategory,
    string
  >;

// ── Customer Agreement (commercial foundation — Phase 1) ──────────────────
//
// The missing COMMERCIAL parent between Customer and operational data:
//   Customer → CustomerAgreement (versioned header) → CustomerAgreementLine.
// This becomes the authoritative commercial source; Service stays catalog data.
// SCHEMA LOCKED — see Development Center `customer_agreement`. Phase 1 covers
// ONLY these two entities + their governed enums. Out of scope (no fields here):
// Time Bank, Invoice Basis, Agreement Templates, Pricing Engine, RUT, Customer
// Portal, PayrollBasis.

/**
 * Header-level commercial model. GOVERNED enum — extend ONLY via deliberate
 * schema changes (no free-text models). `hybrid` is the only model that unlocks
 * a per-line {@link CustomerAgreementLine.billingModelOverride} (see CONTRACT 1).
 * Future candidates (each needs a label, an Invoice Basis rule and hybrid
 * precedence validation): per_hour, usage_based, retainer.
 *
 *  - `per_visit`     → billed per executed visit.
 *  - `monthly_fixed` → flat recurring fee.
 *  - `time_bank`     → draws from a future TimeBankWallet (minutes).
 *  - `hybrid`        → mixed; each line resolves its own model via override.
 */
export type BillingModel = "per_visit" | "monthly_fixed" | "time_bank" | "hybrid";

/** Stable, ordered list of {@link BillingModel} values. */
export const BILLING_MODELS: readonly BillingModel[] = [
  "per_visit",
  "monthly_fixed",
  "time_bank",
  "hybrid",
] as const;

/** Display labels for {@link BillingModel}. */
export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  per_visit: "Per Visit",
  monthly_fixed: "Monthly Fixed",
  time_bank: "Time Bank",
  hybrid: "Hybrid",
};

/**
 * Agreement lifecycle. See the LOCKED state machine (CONTRACT 3):
 *   draft → active | cancelled
 *   active → paused | superseded | cancelled | ended
 *   paused → active | cancelled | ended
 *   superseded / cancelled / ended are TERMINAL (never return to active).
 * Only `active` or `paused` agreements may be superseded by a new version.
 */
export type AgreementStatus =
  | "draft"
  | "active"
  | "paused"
  | "superseded"
  | "cancelled"
  | "ended";

/** Stable, ordered list of {@link AgreementStatus} values. */
export const AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "draft",
  "active",
  "paused",
  "superseded",
  "cancelled",
  "ended",
] as const;

/** Display labels for {@link AgreementStatus}. */
export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  superseded: "Superseded",
  cancelled: "Cancelled",
  ended: "Ended",
};

/**
 * How an agreement LINE's price is computed. Distinct from {@link BillingModel}
 * (when/how the agreement is billed).
 *  - `fixed`    → the agreed line price/snapshot is the line total.
 *  - `per_unit` → agreed price × quantity.
 *  - `custom`   → the agreed line price/snapshot is authoritative and NO
 *                 pricing-engine derivation is applied (REFINEMENT 3).
 */
export type PricingModel = "fixed" | "per_unit" | "custom";

/** Stable, ordered list of {@link PricingModel} values. */
export const PRICING_MODELS: readonly PricingModel[] = [
  "fixed",
  "per_unit",
  "custom",
] as const;

/** Display labels for {@link PricingModel}. */
export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: "Fixed Price",
  per_unit: "Per Unit",
  custom: "Custom",
};

/**
 * Billing cadence for an agreement. Its OWN enum — deliberately separate from
 * the scheduling {@link RecurrenceInterval} (REFINEMENT 1): invoice cadence and
 * scheduling recurrence are different concepts and must not be conflated.
 */
export type InvoiceInterval =
  | "per_visit"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "biannual"
  | "yearly"
  | "on_completion";

/** Stable, ordered list of {@link InvoiceInterval} values. */
export const INVOICE_INTERVALS: readonly InvoiceInterval[] = [
  "per_visit",
  "weekly",
  "monthly",
  "quarterly",
  "biannual",
  "yearly",
  "on_completion",
] as const;

/** Display labels for {@link InvoiceInterval}. */
export const INVOICE_INTERVAL_LABELS: Record<InvoiceInterval, string> = {
  per_visit: "Per Visit",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Biannual",
  yearly: "Yearly",
  on_completion: "On Completion",
};

/**
 * Where a {@link CustomerAgreement} originated (REFINEMENT 4). `sourceReferenceId`
 * is a NULLABLE soft reference — no FK constraint is enforced in Phase 1.
 */
export type AgreementSourceType = "manual" | "template" | "imported" | "converted_quote";

/** Stable, ordered list of {@link AgreementSourceType} values. */
export const AGREEMENT_SOURCE_TYPES: readonly AgreementSourceType[] = [
  "manual",
  "template",
  "imported",
  "converted_quote",
] as const;

/** Display labels for {@link AgreementSourceType}. */
export const AGREEMENT_SOURCE_TYPE_LABELS: Record<AgreementSourceType, string> = {
  manual: "Manual",
  template: "From Template",
  imported: "Imported",
  converted_quote: "Converted Quote",
};

/**
 * A versioned commercial AGREEMENT header — the authoritative commercial source
 * for a customer. Each row is ONE version; commercial changes create a NEW
 * version (never an in-place overwrite of historical terms).
 *
 * Versioning (agreementGroupId chain):
 *  - {@link agreementGroupId} groups every version of one logical agreement.
 *  - {@link version} is 1-based within the group.
 *  - {@link supersedesVersionId} / {@link supersededById} link the chain. Old
 *    versions are marked `superseded`, never deleted. Exactly one non-terminal
 *    version per group is the live one.
 *
 * The future TimeBankWallet binds to {@link agreementGroupId} (NOT the version
 * id) so it survives version changes — not modelled in Phase 1.
 */
export interface CustomerAgreement {
  /** App-facing id of THIS version. */
  id: string;
  /** Groups all versions of one logical agreement (the version-chain key). */
  agreementGroupId: string;
  companyId: string;
  /** App-facing customer id this agreement belongs to. */
  customerId: string;
  /** 1-based version number within the agreement group. */
  version: number;
  status: AgreementStatus;
  /** Header-level commercial model. Gates per-line override (CONTRACT 1). */
  billingModel: BillingModel;
  /** Billing cadence (separate from scheduling recurrence — REFINEMENT 1). */
  invoiceInterval: InvoiceInterval;
  /** Optional internal name/label (in-place editable, not a versioned term). */
  name?: string;
  /** Inclusive commercial start date "YYYY-MM-DD". */
  validFrom?: string;
  /** Inclusive commercial end date "YYYY-MM-DD", or null for open-ended. */
  validTo?: string | null;
  /** Prior version id this version supersedes (null for v1). */
  supersedesVersionId?: string | null;
  /** Next version id that superseded this one (null while live/terminal-leaf). */
  supersededById?: string | null;
  /** Where this agreement originated. */
  sourceType: AgreementSourceType;
  /** Nullable soft reference to the source (template/quote/import). No FK. */
  sourceReferenceId?: string | null;
  /** Free-text internal notes (in-place editable). */
  notes?: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single commercial LINE belonging to one {@link CustomerAgreement} version.
 * Lines SNAPSHOT catalog/service values at creation time — they never live-link
 * to mutable {@link Service} rows, so historical commercial terms are immutable.
 */
export interface CustomerAgreementLine {
  id: string;
  /** The agreement VERSION id ({@link CustomerAgreement.id}) this line belongs to. */
  agreementId: string;
  /** Denormalised version-chain key for group-scoped reads. */
  agreementGroupId: string;
  companyId: string;
  /** Lower numbers appear first. */
  sortOrder: number;
  /**
   * Per-line billing override. CONTRACT 1: ONLY legal when the header
   * {@link CustomerAgreement.billingModel} = `hybrid`; MUST be null/undefined
   * for all non-hybrid agreements. Effective model =
   * `billingModelOverride ?? agreement.billingModel`.
   */
  billingModelOverride?: BillingModel | null;
  /** How this line's price is computed. */
  pricingModel: PricingModel;
  /** Agreed commercial price (money). Authoritative when pricingModel=custom. */
  agreedPrice?: number | null;
  quantity?: number | null;
  unit?: string;
  vat?: number | null;
  /** Source catalog service id — reference/snapshot only, never a live link. */
  sourceServiceId?: string | null;
  /** Snapshot of the service name at line creation. */
  serviceNameSnapshot: string;
  /** Snapshot of the category name at line creation. */
  categoryNameSnapshot?: string | null;
  /** Snapshot of the stable category classification at line creation. */
  categoryTypeSnapshot?: ServiceCategoryType | null;
  /** Snapshot of the service basis type (drives future invoice inclusion). */
  serviceBasisTypeSnapshot?: ServiceBasisType | null;
  /** Free-text internal notes for the line. */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Agreement Template Foundation (Phase 9 · template model) ──

/**
 * Ownership tier of an {@link AgreementTemplate}:
 *  - `global`: system-owned (Super Admin), `companyId` is null, read-only for
 *    company admins. Platform-standard templates.
 *  - `company`: company-owned, fully editable. Created by copying a global
 *    template or from scratch.
 */
export type AgreementTemplateOwnerType = "global" | "company";

/** Stable, ordered list of {@link AgreementTemplateOwnerType} values. */
export const AGREEMENT_TEMPLATE_OWNER_TYPES: readonly AgreementTemplateOwnerType[] = [
  "global",
  "company",
] as const;

/** Display labels for {@link AgreementTemplateOwnerType}. */
export const AGREEMENT_TEMPLATE_OWNER_TYPE_LABELS: Record<AgreementTemplateOwnerType, string> = {
  global: "Global",
  company: "Company",
};

/**
 * Lifecycle status of an {@link AgreementTemplate}:
 *  - `draft`: being prepared, not usable for agreement creation.
 *  - `active`: published and usable for agreement creation.
 *  - `inactive`: temporarily disabled — existing agreements created from it
 *    are unaffected, but no new agreements may be created.
 *  - `superseded`: replaced by a newer version; kept readable for audit.
 */
export type AgreementTemplateStatus = "draft" | "active" | "inactive" | "superseded";

/** Stable, ordered list of {@link AgreementTemplateStatus} values. */
export const AGREEMENT_TEMPLATE_STATUSES: readonly AgreementTemplateStatus[] = [
  "draft",
  "active",
  "inactive",
  "superseded",
] as const;

/** Display labels for {@link AgreementTemplateStatus}. */
export const AGREEMENT_TEMPLATE_STATUS_LABELS: Record<AgreementTemplateStatus, string> = {
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
  superseded: "Superseded",
};

/**
 * A reusable Agreement Template — a BLUEPRINT that suggests default values
 * for creating a {@link CustomerAgreement}. Templates are NOT contracts:
 * they provide defaults; Customer Agreements own the final active rules.
 *
 * After a Customer Agreement is created from a template, the agreement is
 * INDEPENDENT — future template changes never rewrite existing agreements.
 * The agreement stores `sourceType: "template"` and `sourceReferenceId`
 * (the template id) for traceability only.
 */
export interface AgreementTemplate {
  id: string;
  /** Groups all versions of one logical template (version-chain key). */
  templateGroupId: string;
  /** Ownership tier — separates global platform templates from company ones. */
  ownerType: AgreementTemplateOwnerType;
  /** Owning company for `company` templates; null for `global` templates. */
  companyId: string | null;
  /** Display name, e.g. "Private Standard" or "Office Monthly Cleaning". */
  name: string;
  /** Optional clarifying note shown in management UI. */
  description?: string;
  /** 1-based version number within the template group. */
  version: number;
  /** Lifecycle status. Only `active` templates are usable for agreement creation. */
  status: AgreementTemplateStatus;
  /**
   * For COMPANY templates copied from a GLOBAL template, the source global
   * template's id (traceability only — the copy is fully independent). Null for
   * scratch-built templates and all global templates.
   */
  copiedFromTemplateId?: string | null;
  /** Header-level suggested billing model for agreements created from this template. */
  billingModel: BillingModel;
  /** Suggested billing cadence for agreements created from this template. */
  invoiceInterval: InvoiceInterval;
  /** Optional suggestion for a default cancellation policy (future). */
  defaultCancellationPolicyId?: string | null;
  /** Optional suggestion for a default reschedule policy (future). */
  defaultReschedulePolicyId?: string | null;
  /**
   * Whether agreements created from this template are automatically eligible
   * for a Time Bank wallet. NOTE: this is a SUGGESTION only — the entitlement
   * gate must still be applied before any wallet is created.
   */
  timeBankEligible: boolean;
  /** Advisory Time Bank rules copied into the agreement at creation time. */
  timeBankTemplateRules?: TimeBankTemplateRules | null;
  /** Free-text internal notes. */
  notes?: string;
  /** ISO timestamp the template is valid from, or null for always-valid. */
  validFrom?: string | null;
  /** ISO timestamp the template is valid until, or null for open-ended. */
  validTo?: string | null;
  /** Prior template version id this version supersedes (null for v1). */
  supersedesVersionId?: string | null;
  /** Next template version id that superseded this one. */
  supersededById?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single LINE on an {@link AgreementTemplate} — a suggested service with
 * default pricing, recurrence and operational settings. When an agreement is
 * created from the template, these lines are SNAPSHOT-COPIED into
 * {@link CustomerAgreementLine}s, capturing service name, category, pricing
 * model and other defaults. The snapshot is NEVER live-linked to the template.
 */
export interface AgreementTemplateLine {
  id: string;
  /** The template VERSION id ({@link AgreementTemplate.id}) this line belongs to. */
  templateId: string;
  /** Denormalised template group key for group-scoped reads. */
  templateGroupId: string;
  /** Denormalised owner type for cheap scoped reads. */
  ownerType: AgreementTemplateOwnerType;
  /** Denormalised owner company (null for global template lines). */
  companyId: string | null;
  /** Lower numbers appear first. */
  sortOrder: number;
  /**
   * Source catalog service id — a reference (not a live link). When the
   * template line is snapshot-copied into an agreement line, this becomes
   * the agreement line's `sourceServiceId`.
   */
  sourceServiceId?: string | null;
  /** Snapshot of the service name at the time the template line was created. */
  serviceNameSnapshot: string;
  /** Snapshot of the category name. */
  categoryNameSnapshot?: string | null;
  /** Snapshot of the stable category classification. */
  categoryTypeSnapshot?: ServiceCategoryType | null;
  /** Snapshot of the service basis type (drives future invoice inclusion). */
  serviceBasisTypeSnapshot?: ServiceBasisType | null;
  /** Suggested default price (money). */
  defaultPrice?: number | null;
  /** Suggested default VAT rate. */
  defaultVat?: number | null;
  /** How this line's price should be computed. */
  pricingModel: PricingModel;
  /**
   * Per-line billing override suggestion. Only meaningful when the template
   * header's `billingModel` is `hybrid`; must be null otherwise (CONTRACT 1).
   */
  billingModelOverride?: BillingModel | null;
  /** Suggested default quantity. */
  defaultQuantity?: number | null;
  /** Suggested unit (e.g. "hours", "visits"). */
  unit?: string;
  /** Suggested default duration in minutes. */
  defaultDurationMinutes?: number | null;
  /** Snapshotted recurrence defaults — purely advisory. */
  recurrenceDefaults?: AgreementTemplateRecurrenceDefaults | null;
  /** Snapshotted payroll group type for the line. */
  payrollGroupTypeSnapshot?: PayrollGroupType | null;
  /** Snapshotted time code id for the line. */
  timeCodeSnapshot?: string | null;
  /** Free-text internal notes for the line. */
  notes?: string;
  /** Whether the line is active (can be copied into new agreements). */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Advisory recurrence defaults on an {@link AgreementTemplateLine}.
 * These are SUGGESTIONS only — the line's values are snapshot-copied at
 * agreement creation; the agreement line owns the final recurrence rules.
 */
export interface AgreementTemplateRecurrenceDefaults {
  /** How often the service should recur. */
  interval?: RecurrenceInterval;
  /** Suggested service date for the first occurrence. */
  serviceDate?: string;
  /** Suggested planned start time "HH:MM". */
  plannedStartTime?: string;
  /** Suggested planned end time "HH:MM". */
  plannedEndTime?: string;
}

// ── Time Bank Foundation (Phase 3 · domain model) ────────────

/**
 * Lifecycle of a {@link TimeBankWallet} (LOCKED decision 3).
 *  - `active`  — full operation: refills, reservations, consumption, adjustments.
 *  - `frozen`  — HONORS existing reservations (still consumable / releasable) but
 *                BLOCKS new reservations, refills and manual adjustments. This is
 *                how Customer Agreement CONTRACT 2 is resolved (honor strategy):
 *                no reserved time is ever orphaned.
 *  - `closed`  — terminal. No new transactions of any kind; the ledger stays
 *                fully readable for audit/statistics.
 */
export type TimeBankWalletStatus = "active" | "frozen" | "closed";

/** Stable, ordered list of {@link TimeBankWalletStatus} values. */
export const TIME_BANK_WALLET_STATUSES: readonly TimeBankWalletStatus[] = [
  "active",
  "frozen",
  "closed",
] as const;

/** Display labels for {@link TimeBankWalletStatus}. */
export const TIME_BANK_WALLET_STATUS_LABELS: Record<TimeBankWalletStatus, string> = {
  active: "Active",
  frozen: "Frozen",
  closed: "Closed",
};

/**
 * The append-only transaction kinds in the time ledger (LOCKED decision 4).
 * Every balance change is one of these — there is NO direct balance editing
 * (LOCKED decision 5). All amounts are SIGNED INTEGER MINUTES, never hours.
 *
 *  - `monthly_refill`            — scheduled allocation top-up (accrual, +).
 *  - `manual_add`                — admin adds minutes (adjustment, +).
 *  - `manual_remove`             — admin removes minutes (adjustment, −).
 *  - `visit_consumption`         — a performed visit consumes minutes (−).
 *  - `cancellation_consumption`  — late cancellation consumes minutes (−).
 *  - `reschedule_consumption`    — reschedule penalty consumes minutes (−).
 *  - `cancelled_visit_credit`    — NET credit for a cancelled visit: the
 *                                  remaining visit time (after the configured
 *                                  cancellation deduction) is transferred into
 *                                  the wallet as a single positive entry (+).
 *  - `reservation`               — holds minutes for a planned visit (reserved, +).
 *  - `reservation_release`       — releases a prior hold (reserved, −).
 *  - `correction`                — audited fix to a prior error (signed ±).
 *  - `expiry`                    — carryover/expiry policy removes minutes (−).
 *  - `opening_balance`           — the explicit STARTING balance imported into
 *                                  CleanOps at onboarding/migration (signed ±).
 *                                  Affects the wallet balance like any ledger
 *                                  entry, but is a distinct, audit-friendly type
 *                                  so statements can label it "Opening Balance".
 *                                  At most ONE per wallet (see
 *                                  validateSingleOpeningBalance).
 *  - `migration`                 — other history carried as a signed ledger entry
 *                                  (legacy/correction-style import; signed ±).
 */
export type TimeBankTransactionType =
  | "monthly_refill"
  | "manual_add"
  | "manual_remove"
  | "visit_consumption"
  | "cancellation_consumption"
  | "reschedule_consumption"
  | "cancelled_visit_credit"
  | "reservation"
  | "reservation_release"
  | "correction"
  | "expiry"
  | "opening_balance"
  | "migration";

/** Stable, ordered list of {@link TimeBankTransactionType} values. */
export const TIME_BANK_TRANSACTION_TYPES: readonly TimeBankTransactionType[] = [
  "monthly_refill",
  "manual_add",
  "manual_remove",
  "visit_consumption",
  "cancellation_consumption",
  "reschedule_consumption",
  "cancelled_visit_credit",
  "reservation",
  "reservation_release",
  "correction",
  "expiry",
  "opening_balance",
  "migration",
] as const;

/** Display labels for {@link TimeBankTransactionType}. */
export const TIME_BANK_TRANSACTION_TYPE_LABELS: Record<TimeBankTransactionType, string> = {
  monthly_refill: "Monthly Refill",
  manual_add: "Manual Add",
  manual_remove: "Manual Remove",
  visit_consumption: "Visit Consumption",
  cancellation_consumption: "Cancellation Consumption",
  reschedule_consumption: "Reschedule Consumption",
  cancelled_visit_credit: "Cancelled Visit Credit",
  reservation: "Reservation",
  reservation_release: "Reservation Release",
  correction: "Correction",
  expiry: "Expiry",
  opening_balance: "Opening Balance",
  migration: "Migration",
};

/**
 * Semantic family a {@link TimeBankTransactionType} belongs to. Maps the granular
 * locked ledger types onto the high-level concepts (accrual / consumption /
 * adjustment / expiration / migration / correction / reservation) so statistics,
 * statements and reporting can group entries without hard-coding every type.
 */
export type TimeBankTransactionKind =
  | "accrual"
  | "consumption"
  | "adjustment"
  | "reservation"
  | "expiration"
  | "migration"
  | "correction";

/**
 * How a wallet refills its allocation (drives the Refill Engine).
 *  - `none`      — disabled: no automatic refill is ever scheduled.
 *  - `manual`    — one-time / manual: refills happen only when an admin triggers
 *                  them; the engine never auto-schedules a period refill.
 *  - `weekly`    — refill once per ISO week.
 *  - `monthly`   — refill once per calendar month.
 *  - `quarterly` — refill once per calendar quarter.
 *  - `yearly`    — refill once per calendar year.
 */
export type TimeBankRefillFrequency =
  | "none"
  | "manual"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

/** Stable, ordered list of {@link TimeBankRefillFrequency} values. */
export const TIME_BANK_REFILL_FREQUENCIES: readonly TimeBankRefillFrequency[] = [
  "none",
  "manual",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

/** Frequencies that the Refill Engine auto-schedules. `none`/`manual` are excluded. */
export const TIME_BANK_AUTO_REFILL_FREQUENCIES: readonly TimeBankRefillFrequency[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

/**
 * Carryover handling at refill time (LOCKED decision 8). Default is `unlimited`
 * (no cap); Agreement Templates / Customer Agreements may later override.
 *  - `unlimited`    — balance accumulates without limit.
 *  - `capped`       — balance is capped at {@link TimeBankRules.maxBalanceMinutes}.
 *  - `expiry`       — unused balance expires per policy (drives `expiry` txns).
 *  - `no_carryover` — balance resets to the allocation each period.
 */
export type TimeBankCarryoverPolicy = "unlimited" | "capped" | "expiry" | "no_carryover";

/** Stable, ordered list of {@link TimeBankCarryoverPolicy} values. */
export const TIME_BANK_CARRYOVER_POLICIES: readonly TimeBankCarryoverPolicy[] = [
  "unlimited",
  "capped",
  "expiry",
  "no_carryover",
] as const;

/**
 * The configurable POLICY for a {@link TimeBankWallet} — the "rules" half of the
 * Time Bank model. All minute values are INTEGERS. {@link allocationMinutes} is
 * AUTHORITATIVE and drives refill; {@link suggestedAllocationMinutes} is advisory
 * only (schedule-derived, never the live commercial source of truth — LOCKED
 * decision 7).
 */
export interface TimeBankRules {
  /** Authoritative allocation (minutes) applied on each refill. */
  allocationMinutes: number;
  /** Advisory, schedule-derived suggestion. NOT authoritative. */
  suggestedAllocationMinutes?: number | null;
  /** How the wallet refills its allocation. */
  refillFrequency: TimeBankRefillFrequency;
  /** Refill anchor — e.g. "01" day-of-month, weekday, or ISO date. */
  refillAnchor?: string | null;
  /**
   * How far below zero consumption may go (a non-negative magnitude; the floor
   * itself is `-negativeFloorMinutes`). 0 means consumption may never overdraw.
   */
  negativeFloorMinutes: number;
  /** Carryover handling at refill time. */
  carryoverPolicy: TimeBankCarryoverPolicy;
  /** Balance cap (minutes) for the `capped` carryover policy. */
  maxBalanceMinutes?: number | null;
  /**
   * For the `expiry` carryover policy: how many days a credited minute survives
   * before it expires (FIFO). When null, the `expiry` policy expires the
   * pre-period leftover at the period boundary instead of by age.
   */
  expiryAfterDays?: number | null;
  /** Warning threshold as a percent of {@link allocationMinutes} (0–100). */
  warningThresholdPercent?: number | null;
  /** Critical threshold as a percent of {@link allocationMinutes} (0–100). */
  criticalThresholdPercent?: number | null;
  /** Absolute warning threshold (minutes) — fallback for zero-allocation wallets. */
  warningThresholdMinutes?: number | null;
  /** Absolute critical threshold (minutes) — fallback for zero-allocation wallets. */
  criticalThresholdMinutes?: number | null;
}

/**
 * A customer's Time Bank wallet. There is at most ONE active wallet per
 * {@link agreementGroupId} (LOCKED decision 1). The wallet binds to the STABLE
 * {@link agreementGroupId} — NEVER an agreement version id (LOCKED decision 2) —
 * so it survives agreement versioning, price changes, line additions/removals
 * and recurrence changes without losing continuity.
 *
 * The wallet holds NO stored balance: every balance is derived from the
 * immutable {@link TimeBankTransaction} ledger (LOCKED decision 5).
 */
export interface TimeBankWallet {
  id: string;
  /** BINDING KEY — the stable agreement-group id, never a version id. */
  agreementGroupId: string;
  customerId: string;
  companyId: string;
  status: TimeBankWalletStatus;
  /** The configurable policy for this wallet. */
  rules: TimeBankRules;
  createdAt: string;
  updatedAt: string;
}

/**
 * One immutable entry in a wallet's append-only time ledger. Balances are NEVER
 * stored — they are reproduced by folding transactions (LOCKED decision 5), so
 * historical balances are always reconstructable and future transactions can
 * never rewrite the past. {@link minutes} is SIGNED INTEGER MINUTES.
 *
 * Reservation entries (`reservation` / `reservation_release`) affect the
 * RESERVED balance; every other type affects the CURRENT balance.
 */
export interface TimeBankTransaction {
  id: string;
  walletId: string;
  /** Denormalised binding key — must equal the owning wallet's agreementGroupId. */
  agreementGroupId: string;
  companyId: string;
  type: TimeBankTransactionType;
  /** Signed INTEGER minutes (positive credits, negative debits). Never hours. */
  minutes: number;
  /** Effective timestamp (ISO) used for historical balance reproduction. */
  effectiveAt: string;
  /** Audit: who/what created this entry. */
  actorId?: string | null;
  actorName?: string | null;
  /** Human-readable reason (required in practice for manual/correction entries). */
  reason?: string | null;
  /** Statistics hook: service-category snapshot for usage breakdowns. */
  serviceCategorySnapshot?: string | null;
  /** Statistics hook: whether the consumed time is billable (payroll/reporting). */
  billable?: boolean | null;
  /** Audit link to the work order that produced this entry, if any. */
  sourceWorkOrderId?: string | null;
  /** Audit link to the schedule occurrence that produced this entry, if any. */
  sourceOccurrenceId?: string | null;
  /**
   * Snapshot of the agreement VERSION id in effect when this entry was recorded.
   * Audit/traceability only — the wallet still binds to agreementGroupId, so a
   * version change never breaks wallet continuity.
   */
  sourceAgreementVersionId?: string | null;
  /**
   * Full, audit-grade breakdown for a `cancelled_visit_credit` entry. Present
   * ONLY on cancellation-credit transactions. The ledger's `minutes` equals
   * {@link TimeBankCancellationCredit.creditedMinutes}; this object preserves
   * the underlying calculation (original duration, deduction method/value,
   * computed deduction) so admin/audit views can show the full math while
   * customer-facing views show only the net "+X minutes".
   */
  cancellationCredit?: TimeBankCancellationCredit | null;
  createdAt: string;
}

/**
 * A derived snapshot of a wallet's balances (minutes). Never stored — always
 * computed from the ledger. `availableBalance = currentBalance - reservedBalance`
 * (LOCKED decision 10).
 */
export interface TimeBankBalance {
  /** Real balance: sum of all non-reservation transactions. */
  currentBalance: number;
  /** Held balance: sum of reservation / reservation_release transactions. */
  reservedBalance: number;
  /** Spendable balance: current minus reserved. */
  availableBalance: number;
}

// ── Time Bank Cancellation Credit (Phase 7 · business-rule model) ──

/**
 * How a cancelled visit's deduction is computed before the remainder is
 * credited to the wallet (LOCKED cancellation-credit decision 2).
 *  - `none`       — full credit: the entire visit duration is returned.
 *  - `fixed`      — a fixed number of minutes is deducted.
 *  - `percentage` — a percentage (0–100) of the visit duration is deducted.
 */
export type TimeBankCancellationDeductionMethod = "none" | "fixed" | "percentage";

/** Stable, ordered list of {@link TimeBankCancellationDeductionMethod} values. */
export const TIME_BANK_CANCELLATION_DEDUCTION_METHODS: readonly TimeBankCancellationDeductionMethod[] =
  ["none", "fixed", "percentage"] as const;

/** Display labels for {@link TimeBankCancellationDeductionMethod}. */
export const TIME_BANK_CANCELLATION_DEDUCTION_METHOD_LABELS: Record<
  TimeBankCancellationDeductionMethod,
  string
> = {
  none: "Full Credit (no deduction)",
  fixed: "Fixed Time Deduction",
  percentage: "Percentage Deduction",
};

/**
 * Configurable cancellation-credit policy. Set at COMPANY level and optionally
 * overridden per Agreement Template / Customer Agreement (decision: company
 * default + agreement override). When {@link enabled} is false no
 * `cancelled_visit_credit` transaction is ever produced for a cancelled visit.
 *
 * All minute values are INTEGERS; {@link deductionPercent} is an integer 0–100.
 */
export interface TimeBankCancellationPolicy {
  /** Master switch. When false, cancelled visits never credit the wallet. */
  enabled: boolean;
  /** How the deduction is computed. */
  deductionMethod: TimeBankCancellationDeductionMethod;
  /** Deducted minutes for the `fixed` method (integer ≥ 0). */
  deductionMinutes?: number | null;
  /** Deducted percent (0–100 integer) of the visit duration for `percentage`. */
  deductionPercent?: number | null;
  /**
   * Optional floor on the resulting credit (integer ≥ 0). Guards against a
   * deduction larger than the visit (credit is clamped to be ≥ this value, and
   * never negative). Defaults to 0 when null.
   */
  minCreditMinutes?: number | null;
}

/**
 * The audit-grade breakdown stored on a `cancelled_visit_credit` transaction.
 * Customer-facing views display only {@link creditedMinutes} as a positive
 * "Cancelled Visit Credit"; admin/audit views display the full calculation.
 */
export interface TimeBankCancellationCredit {
  /** Originally scheduled visit duration (integer minutes). */
  originalVisitMinutes: number;
  /** Deduction method that was applied. */
  deductionMethod: TimeBankCancellationDeductionMethod;
  /** Raw configured value: fixed minutes or percent, by method (null for `none`). */
  deductionValue: number | null;
  /** Computed deduction in minutes (integer ≥ 0). */
  deductionMinutes: number;
  /** Net minutes credited to the wallet (= originalVisitMinutes − deductionMinutes). */
  creditedMinutes: number;
  /** Human-readable cancellation reason (audit). */
  cancellationReason?: string | null;
}

// ── Time Bank Template Binding (Phase 8 · template rule model) ──

/**
 * Suggested Time Bank settings an Agreement Template may carry. Templates
 * provide DEFAULTS only — the Customer Agreement owns the final authoritative
 * {@link TimeBankRules} after creation. Template changes never rewrite existing
 * agreements (snapshot-on-create principle).
 *
 * All fields are optional by design: a template with no Time Bank settings
 * inherits the safe default (timeBankEnabled = false).
 *
 * This is kept SEPARATE from {@link TimeBankRules} to make the
 * template→agreement boundary explicit: templates are advisory, agreement
 * rules are authoritative.
 */
export interface TimeBankTemplateRules {
  /** Master switch. When false/unset, no wallet is ever auto-created. */
  timeBankEnabled?: boolean;
  /** Suggested minutes allocated per refill period (integer). */
  allocationMinutes?: number;
  /** How the wallet refills its allocation. */
  refillFrequency?: TimeBankRefillFrequency;
  /** Carryover handling at refill time. */
  carryoverPolicy?: TimeBankCarryoverPolicy;
  /** Balance cap (minutes) for the `capped` carryover policy. */
  maxBalanceMinutes?: number | null;
  /** For `expiry` carryover: how many days before a minute expires (FIFO). */
  expiryAfterDays?: number | null;
  /** How far below zero consumption may go (non-negative integer). */
  negativeFloorMinutes?: number;
  /**
   * Configurable cancellation-credit policy (Phase 7). When unset the
   * agreement inherits the company default; when set it overrides.
   */
  cancellationCreditPolicy?: TimeBankCancellationPolicy;
  /** Warning threshold as a percent of allocationMinutes (0–100). */
  warningThresholdPercent?: number | null;
  /** Critical threshold as a percent of allocationMinutes (0–100). */
  criticalThresholdPercent?: number | null;
  /** Absolute warning threshold in minutes (fallback). */
  warningThresholdMinutes?: number | null;
  /** Absolute critical threshold in minutes (fallback). */
  criticalThresholdMinutes?: number | null;
  /** Refill anchor (e.g. "01" for monthly day-of-month). */
  refillAnchor?: string | null;
}

// ── Time Bank Migration / Opening Balance & Legacy History (Phase 11) ──

/**
 * A future-proof reference to a document supporting a {@link TimeBankLegacyHistoryNote}
 * (e.g. a scanned statement from the legacy system). Foundation only — the
 * attachment is described, not yet uploaded/stored anywhere. Purely
 * INFORMATIONAL: an attachment NEVER affects the ledger balance.
 */
export interface TimeBankLegacyAttachmentRef {
  /** Stable id for the attachment reference. */
  id: string;
  /** Human label shown in admin/audit views. */
  label: string;
  /** Optional external/storage reference (URL, object key, or file name). */
  href?: string | null;
  /** Optional MIME type hint for future rendering. */
  contentType?: string | null;
}

/**
 * INFORMATIONAL-ONLY historical Time Bank information that originated OUTSIDE
 * CleanOps and is recorded during migration/onboarding (e.g. "Customer
 * previously accumulated 8 hours in the legacy system", "3 hours used during
 * March 2025").
 *
 * CRITICAL SEPARATION (LOCKED): a legacy history note is NOT a ledger entry. It
 * is deliberately a DIFFERENT type from {@link TimeBankTransaction} so it can
 * never enter balance derivation, statements, warnings, refill, expiry or
 * carryover. Only ledger transactions (notably {@link TimeBankTransaction} of
 * type `opening_balance`) ever affect a wallet's balance. Legacy notes are
 * reference text for humans only.
 */
export interface TimeBankLegacyHistoryNote {
  /** Stable id (also the persistence idempotency key). */
  id: string;
  /** The wallet this informational note is attached to. */
  walletId: string;
  /** Denormalised binding key — must equal the owning wallet's agreementGroupId. */
  agreementGroupId: string;
  /** Owning company (app-facing id). */
  companyId: string;
  /** Free-text, multiline historical summary pasted/imported from the legacy system. */
  note: string;
  /** Audit: who recorded this note (app-facing user id or name). */
  importedBy?: string | null;
  /** Audit: when the note was recorded (ISO). */
  importedAt?: string | null;
  /** The legacy/source system the information came from (free text). */
  sourceSystem?: string | null;
  /** Future document-attachment support (described only; never affects balance). */
  attachments?: TimeBankLegacyAttachmentRef[] | null;
  createdAt: string;
}
