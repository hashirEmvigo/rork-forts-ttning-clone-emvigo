/**
 * Read-only Supabase dependency counts for customer delete/archive decisions.
 *
 * This intentionally does not read browser-local Work Orders, booking queue, or
 * time reports. The Customers UI uses these shared backend counts so two browser
 * surfaces make the same Delete vs Archive decision for the same customer.
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  validateCustomerDelete,
  type CustomerDeleteContext,
  type EntityDeleteValidationResult,
} from "@/lib/entityDeleteValidation";

export interface CustomerDeleteDependencyCounts extends CustomerDeleteContext {
  /** Active planning bookings from `booking_queue`. */
  bookingQueueCount: number;
  /** Execution-ledger missions from `mission_log_entries`. */
  missionLogEntryCount: number;
  /** Submitted/approval records from `time_reports`. */
  timeReportCount: number;
  /** Commercial agreement headers from `customer_agreements`. */
  customerAgreementCount: number;
  /** Time Bank wallet records from `time_bank_wallets`. */
  timeBankWalletCount: number;
  /** Visit occurrence records from `visit_occurrences`. */
  visitOccurrenceCount: number;
  /** Customer protocol aggregates from `customer_protocols`. */
  customerProtocolCount: number;
  /** Protocol execution runs from `protocol_runs`. */
  protocolRunCount: number;
  /** Customer media assets from `media_assets`. */
  mediaAssetCount: number;
  /** Customer portal/app-user links from `app_users`. */
  appUserLinkCount: number;
}

export interface CustomerDeleteDependencyResult {
  counts: CustomerDeleteDependencyCounts;
  validation: EntityDeleteValidationResult;
  source: "supabase";
  checkedAt: string;
}

interface CountResponse {
  count: number | null;
  error: { message: string } | null;
}

interface CountQueryBuilder extends PromiseLike<CountResponse> {
  eq(column: string, value: string): CountQueryBuilder;
  is(column: string, value: null): CountQueryBuilder;
}

class CustomerDependencySupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerDependencySupabaseError";
  }
}

function configuredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new CustomerDependencySupabaseError(
      "Supabase is not configured for customer dependency verification.",
    );
  }
  return supabase;
}

type DependencyTable =
  | "work_orders"
  | "booking_queue"
  | "mission_log_entries"
  | "time_reports"
  | "customer_agreements"
  | "time_bank_wallets"
  | "visit_occurrences"
  | "customer_protocols"
  | "protocol_runs"
  | "media_assets"
  | "app_users";

async function countActiveRows(params: {
  table: DependencyTable;
  customerId: string;
  companyId?: string | null;
  customerColumn?: string;
  hasDeletedAt?: boolean;
  activeBookingOnly?: boolean;
  entityType?: string;
}): Promise<number> {
  const client = configuredClient();
  const customerColumn = params.customerColumn ?? "customer_legacy_id";
  let query = client
    .from(params.table)
    .select("legacy_id", { count: "exact", head: true })
    .eq(customerColumn, params.customerId) as unknown as CountQueryBuilder;

  if (params.hasDeletedAt !== false) {
    query = query.is("deleted_at", null);
  }
  if (params.companyId !== undefined && params.companyId !== null && params.companyId !== "") {
    query = query.eq("company_legacy_id", params.companyId);
  }
  if (params.activeBookingOnly) {
    query = query.is("cancelled_at", null);
  }
  if (params.entityType) {
    query = query.eq("entity_type", params.entityType);
  }

  const { count, error } = await query;
  if (error) {
    throw new CustomerDependencySupabaseError(
      `[${params.table}] dependency count failed: ${error.message}`,
    );
  }
  return count ?? 0;
}

/**
 * Fetches shared backend dependency counts for a customer. Read-only: only
 * `select(..., { count: "exact", head: true })` queries are issued.
 */
export async function fetchCustomerDeleteDependencyContext(params: {
  customerId: string;
  companyId?: string | null;
}): Promise<CustomerDeleteDependencyResult> {
  const [
    workOrderCount,
    bookingQueueCount,
    missionLogEntryCount,
    timeReportCount,
    customerAgreementCount,
    timeBankWalletCount,
    visitOccurrenceCount,
    customerProtocolCount,
    protocolRunCount,
    mediaAssetCount,
    appUserLinkCount,
  ] = await Promise.all([
    countActiveRows({
      table: "work_orders",
      customerId: params.customerId,
      companyId: params.companyId,
    }),
    countActiveRows({
      table: "booking_queue",
      customerId: params.customerId,
      companyId: params.companyId,
      activeBookingOnly: true,
    }),
    countActiveRows({
      table: "mission_log_entries",
      customerId: params.customerId,
      companyId: params.companyId,
    }),
    countActiveRows({
      table: "time_reports",
      customerId: params.customerId,
      companyId: params.companyId,
    }),
    countActiveRows({
      table: "customer_agreements",
      customerId: params.customerId,
      companyId: params.companyId,
      hasDeletedAt: false,
    }),
    countActiveRows({
      table: "time_bank_wallets",
      customerId: params.customerId,
      companyId: params.companyId,
      hasDeletedAt: false,
    }),
    countActiveRows({
      table: "visit_occurrences",
      customerId: params.customerId,
      companyId: params.companyId,
    }),
    countActiveRows({
      table: "customer_protocols",
      customerId: params.customerId,
      companyId: params.companyId,
    }),
    countActiveRows({
      table: "protocol_runs",
      customerId: params.customerId,
      companyId: params.companyId,
    }),
    countActiveRows({
      table: "media_assets",
      customerId: params.customerId,
      companyId: params.companyId,
      customerColumn: "entity_id",
      entityType: "customer",
    }),
    countActiveRows({
      table: "app_users",
      customerId: params.customerId,
      companyId: params.companyId,
      customerColumn: "data->>linkedCustomerId",
    }),
  ]);

  const counts: CustomerDeleteDependencyCounts = {
    workOrderCount,
    missionCount: bookingQueueCount + missionLogEntryCount + timeReportCount + visitOccurrenceCount + protocolRunCount,
    bookingQueueCount,
    missionLogEntryCount,
    timeReportCount,
    customerAgreementCount,
    timeBankWalletCount,
    visitOccurrenceCount,
    customerProtocolCount,
    protocolRunCount,
    mediaAssetCount,
    appUserLinkCount,
  };

  return {
    counts,
    validation: validateCustomerDelete(counts),
    source: "supabase",
    checkedAt: new Date().toISOString(),
  };
}
