/**
 * Phase 3B — Supabase-only read foundation for customer temporary scheduling exceptions.
 *
 * Foundation only: not wired into runtime/UI, no writes, and no RPCs.
 * Supabase is the only read source; a clean empty Supabase result remains an empty array.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE =
  "customer_temporary_scheduling_exceptions" as const;

const CTSE_SELECT_COLUMNS =
  "id, company_id, customer_id, source, status, start_date, end_date, windows, reason_code, customer_note, admin_note, created_by_actor_type, created_by_user_id, created_by_customer_id, client_request_id, created_at, updated_at, cancelled_at, cancelled_by_actor_type, cancelled_by_user_id, cancelled_by_customer_id, reviewed_at, reviewed_by_user_id";

export type CustomerTemporarySchedulingExceptionStatus =
  | "submitted"
  | "accepted_for_planning"
  | "cancelled";

export type CustomerTemporarySchedulingExceptionSource =
  | "admin_console"
  | "customer_portal"
  | "system";

export type CustomerTemporarySchedulingExceptionActorType = "admin" | "customer" | "system";

export type CustomerTemporarySchedulingExceptionReasonCode =
  | "customer_away"
  | "temporary_access_change"
  | "temporary_time_preference"
  | "holiday_period"
  | "building_access"
  | "other";

export type CustomerTemporarySchedulingExceptionTemporalState =
  | "upcoming"
  | "active"
  | "expired"
  | "cancelled";

export interface CustomerTemporarySchedulingWindow {
  start_time: string;
  end_time: string;
}

export interface CustomerTemporarySchedulingExceptionSupabaseRow {
  id: string;
  company_id: string;
  customer_id: string;
  source: CustomerTemporarySchedulingExceptionSource;
  status: CustomerTemporarySchedulingExceptionStatus;
  start_date: string;
  end_date: string;
  windows: unknown;
  reason_code: CustomerTemporarySchedulingExceptionReasonCode;
  customer_note: string | null;
  admin_note: string | null;
  created_by_actor_type: CustomerTemporarySchedulingExceptionActorType;
  created_by_user_id: string | null;
  created_by_customer_id: string | null;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by_actor_type: CustomerTemporarySchedulingExceptionActorType | null;
  cancelled_by_user_id: string | null;
  cancelled_by_customer_id: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
}

export interface CustomerTemporarySchedulingExceptionReadModel {
  id: string;
  companyId: string;
  customerId: string;
  source: CustomerTemporarySchedulingExceptionSource;
  status: CustomerTemporarySchedulingExceptionStatus;
  temporalState: CustomerTemporarySchedulingExceptionTemporalState;
  startDate: string;
  endDate: string;
  windows: CustomerTemporarySchedulingWindow[];
  reasonCode: CustomerTemporarySchedulingExceptionReasonCode;
  customerNote: string | null;
  adminNote: string | null;
  createdByActorType: CustomerTemporarySchedulingExceptionActorType;
  createdByUserId: string | null;
  createdByCustomerId: string | null;
  clientRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledByActorType: CustomerTemporarySchedulingExceptionActorType | null;
  cancelledByUserId: string | null;
  cancelledByCustomerId: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
}

export interface CustomerTemporarySchedulingExceptionCustomerListParams {
  companyId: string;
  customerId: string;
  includeCancelled?: boolean;
  today?: string | Date;
}

export interface CustomerTemporarySchedulingExceptionReviewQueueParams {
  companyId?: string | null;
  today?: string | Date;
}

class CustomerTemporarySchedulingExceptionsSupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "customerTemporarySchedulingExceptionsRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "CustomerTemporarySchedulingExceptionsSupabaseNotConfiguredError";
  }
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeWindows(value: unknown): CustomerTemporarySchedulingWindow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is CustomerTemporarySchedulingWindow =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as CustomerTemporarySchedulingWindow).start_time === "string" &&
        typeof (item as CustomerTemporarySchedulingWindow).end_time === "string",
    )
    .map((item) => ({ start_time: item.start_time, end_time: item.end_time }));
}

export function deriveCustomerTemporarySchedulingExceptionTemporalState(input: {
  status: CustomerTemporarySchedulingExceptionStatus;
  startDate: string;
  endDate: string;
  cancelledAt?: string | null;
  today: string | Date;
}): CustomerTemporarySchedulingExceptionTemporalState {
  if (input.status === "cancelled" || input.cancelledAt) return "cancelled";

  const today = dateOnly(input.today);
  if (today < input.startDate) return "upcoming";
  if (today > input.endDate) return "expired";
  return "active";
}

export function mapCustomerTemporarySchedulingExceptionRow(
  row: CustomerTemporarySchedulingExceptionSupabaseRow,
  today: string | Date = todayDateOnly(),
): CustomerTemporarySchedulingExceptionReadModel {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    source: row.source,
    status: row.status,
    temporalState: deriveCustomerTemporarySchedulingExceptionTemporalState({
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      cancelledAt: row.cancelled_at,
      today,
    }),
    startDate: row.start_date,
    endDate: row.end_date,
    windows: normalizeWindows(row.windows),
    reasonCode: row.reason_code,
    customerNote: row.customer_note,
    adminNote: row.admin_note,
    createdByActorType: row.created_by_actor_type,
    createdByUserId: row.created_by_user_id,
    createdByCustomerId: row.created_by_customer_id,
    clientRequestId: row.client_request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    cancelledByActorType: row.cancelled_by_actor_type,
    cancelledByUserId: row.cancelled_by_user_id,
    cancelledByCustomerId: row.cancelled_by_customer_id,
    reviewedAt: row.reviewed_at,
    reviewedByUserId: row.reviewed_by_user_id,
  };
}

type SupabaseListResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

type SupabaseListQuery = PromiseLike<SupabaseListResponse>;

function ensureSupabaseConfigured(): NonNullable<typeof supabase> {
  if (!isSupabaseConfigured || !supabase) {
    throw new CustomerTemporarySchedulingExceptionsSupabaseNotConfiguredError();
  }
  return supabase;
}

async function readRows(
  query: SupabaseListQuery,
  context: string,
  today: string | Date,
): Promise<CustomerTemporarySchedulingExceptionReadModel[]> {
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `[${CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE}] Supabase ${context} failed: ${error.message}`,
    );
  }

  return ((data ?? []) as CustomerTemporarySchedulingExceptionSupabaseRow[]).map((row) =>
    mapCustomerTemporarySchedulingExceptionRow(row, today),
  );
}

/**
 * Supabase-only, read-only repository for Phase 3B. It is intentionally not wired
 * into app runtime; later display phases can consume this narrow surface.
 */
export const customerTemporarySchedulingExceptionsRepository = {
  async listForCustomer(
    params: CustomerTemporarySchedulingExceptionCustomerListParams,
  ): Promise<CustomerTemporarySchedulingExceptionReadModel[]> {
    const client = ensureSupabaseConfigured();
    let query = client
      .from(CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE)
      .select(CTSE_SELECT_COLUMNS)
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId);

    if (params.includeCancelled !== true) {
      query = query.neq("status", "cancelled").is("cancelled_at", null);
    }

    query = query.order("start_date", { ascending: false }).order("created_at", { ascending: false });

    return readRows(query, "customer list", params.today ?? todayDateOnly());
  },

  async listActiveOrUpcomingForCustomer(
    params: CustomerTemporarySchedulingExceptionCustomerListParams,
  ): Promise<CustomerTemporarySchedulingExceptionReadModel[]> {
    const client = ensureSupabaseConfigured();
    const today = dateOnly(params.today ?? todayDateOnly());
    const query = client
      .from(CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE)
      .select(CTSE_SELECT_COLUMNS)
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId)
      .neq("status", "cancelled")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .order("start_date", { ascending: true })
      .order("created_at", { ascending: false });

    return readRows(query, "active/upcoming customer list", today);
  },

  async listSubmittedForAdminReview(
    params: CustomerTemporarySchedulingExceptionReviewQueueParams = {},
  ): Promise<CustomerTemporarySchedulingExceptionReadModel[]> {
    const client = ensureSupabaseConfigured();
    let query = client
      .from(CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE)
      .select(CTSE_SELECT_COLUMNS)
      .eq("status", "submitted")
      .is("cancelled_at", null);

    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_id", params.companyId);
    }

    query = query.order("created_at", { ascending: true });

    return readRows(query, "submitted review queue list", params.today ?? todayDateOnly());
  },
};
