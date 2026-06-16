import type { Area, Customer, WorkOrder, WorkOrderServiceRow } from "@/types";
import { resolveCustomerArea } from "./area";

/**
 * Area Scoped Access — activation pre-check.
 *
 * Turning on Area Scoped Access makes the platform hide records whose
 * {@link Area} the acting login cannot see. If a customer that is still
 * operationally active has no structured area, it would silently disappear from
 * scoped admins and leave future Work Orders / Schedules / Reports inconsistent.
 *
 * To prevent that, activation is gated: it may only be enabled when every
 * *operationally active* customer already resolves to an area. "Operationally
 * active" means any of:
 * - the customer record is active ({@link Customer.status} === "active"), or
 * - the customer has an active service (a planned / in-progress service row), or
 * - the customer has a future booking (an operational row dated today or later).
 *
 * Inactive/archived customers with no future operational data never block.
 * There is intentionally NO "Unassigned" area — "Not assigned" is only an empty
 * state, and customers are never auto-assigned. The fix is for an admin to give
 * each blocking customer a real area first.
 *
 * Everything here is deterministic and side-effect free so the store/UI can
 * reuse it and it can be unit-tested in isolation.
 */

/** Why a customer requires an area before Area Scoped Access can be enabled. */
export type AreaActivationBlockReason =
  | "active_customer"
  | "active_service"
  | "future_booking";

/** A customer that must be given an area before activation can proceed. */
export interface AreaActivationBlocker {
  customerId: string;
  customerName: string;
  /** Every operational reason this customer is required to have an area. */
  reasons: AreaActivationBlockReason[];
}

/** Result of the activation pre-check. */
export interface AreaActivationPrecheck {
  /** True only when no operationally active customer is missing an area. */
  canEnable: boolean;
  /** The customers that must be given an area first (empty when canEnable). */
  blockingCustomers: AreaActivationBlocker[];
  /** Breakdown of how many blocking customers hit each reason. */
  counts: {
    /** Total distinct blocking customers. */
    blocking: number;
    activeCustomers: number;
    activeServices: number;
    futureBookings: number;
  };
}

/** Inputs for the activation pre-check. Pass company-scoped collections. */
export interface AreaActivationInput {
  customers: readonly Customer[];
  workOrders: readonly WorkOrder[];
  areas: readonly Area[];
  /** Reference "now" for future-booking detection. Defaults to the system clock. */
  now?: Date;
}

/** A service row that is still operationally live (not completed/inactive). */
function isOperationalRow(row: WorkOrderServiceRow): boolean {
  return row.status === "planned" || row.status === "in_progress";
}

/** Local "YYYY-MM-DD" for `date`, matching the format service rows are stored in. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whether an operational row represents a booking that occurs today or later.
 * One-time rows count when their date is in the future; recurring rows count
 * when they have no end date (open-ended) or their start/end date reaches today.
 */
function rowHasFutureBooking(row: WorkOrderServiceRow, todayKey: string): boolean {
  if (!isOperationalRow(row)) return false;
  const recurring = !!row.recurrenceInterval && row.recurrenceInterval !== "one_time";
  if (recurring) {
    const end = row.serviceEndDate?.trim();
    if (!end) return true; // open-ended recurrence → future occurrences exist
    if (end >= todayKey) return true;
  }
  return !!row.serviceDate && row.serviceDate >= todayKey;
}

/**
 * Runs the Area Scoped Access activation pre-check over a company's data.
 * Returns whether the feature can be enabled and, if not, the customers that
 * still need an area together with the reason breakdown.
 */
export function checkAreaScopedAccessActivation(
  input: AreaActivationInput,
): AreaActivationPrecheck {
  const { customers, workOrders, areas } = input;
  const todayKey = toDateKey(input.now ?? new Date());

  // Index operational signals per customer in a single pass over work orders.
  const activeServiceCustomerIds = new Set<string>();
  const futureBookingCustomerIds = new Set<string>();
  for (const wo of workOrders) {
    if (wo.status === "inactive") continue;
    const rows = wo.serviceRows ?? [];
    for (const row of rows) {
      if (isOperationalRow(row)) activeServiceCustomerIds.add(wo.customerId);
      if (rowHasFutureBooking(row, todayKey)) futureBookingCustomerIds.add(wo.customerId);
    }
  }

  const blockingCustomers: AreaActivationBlocker[] = [];
  let activeCustomers = 0;
  let activeServices = 0;
  let futureBookings = 0;

  for (const customer of customers) {
    const hasArea = !!resolveCustomerArea(customer, areas);
    if (hasArea) continue;

    const reasons: AreaActivationBlockReason[] = [];
    if (customer.status === "active") reasons.push("active_customer");
    if (activeServiceCustomerIds.has(customer.id)) reasons.push("active_service");
    if (futureBookingCustomerIds.has(customer.id)) reasons.push("future_booking");

    if (reasons.length === 0) continue; // inactive + no operational data → safe

    blockingCustomers.push({
      customerId: customer.id,
      customerName: customer.name,
      reasons,
    });
    if (reasons.includes("active_customer")) activeCustomers += 1;
    if (reasons.includes("active_service")) activeServices += 1;
    if (reasons.includes("future_booking")) futureBookings += 1;
  }

  return {
    canEnable: blockingCustomers.length === 0,
    blockingCustomers,
    counts: {
      blocking: blockingCustomers.length,
      activeCustomers,
      activeServices,
      futureBookings,
    },
  };
}
