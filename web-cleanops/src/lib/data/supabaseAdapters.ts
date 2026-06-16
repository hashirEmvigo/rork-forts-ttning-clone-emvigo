/**
 * Supabase-backed query-layer adapters — PLACEHOLDER (Migration Wave 0).
 *
 * This file documents the exact insertion point where the future server-backed
 * implementation of each repository will live. It does NOT connect to Supabase,
 * does NOT contain real or fake queries, and is NOT wired anywhere. Every method
 * throws {@link NotImplementedError} so any accidental use fails loudly instead
 * of silently returning empty data.
 *
 * The purpose is purely architectural:
 *  - prove the {@link DataLayer} contract is implementation-agnostic, and
 *  - give later waves a ready, typed skeleton to fill in (one entity at a time)
 *    without UI/business code ever importing a storage implementation directly.
 */
import type {
  CustomerRepository,
  EmployeeRepository,
  ScheduleRepository,
  ActivityLogRepository,
  TimeReportRepository,
  DataLayer,
} from "./contracts";
import { supabaseCustomerRepository } from "./supabaseCustomerRepository";
import { supabaseWorkOrderRepository } from "./supabaseWorkOrderRepository";

/** Thrown by every placeholder method until the entity is migrated. */
export class NotImplementedError extends Error {
  constructor(entity: string, method: string) {
    super(
      `SupabaseDataLayer.${entity}.${method} is not implemented yet. ` +
        `It will be filled in during its migration wave; until then use localDataLayer.`,
    );
    this.name = "NotImplementedError";
  }
}

/** Builds a repository whose every method throws NotImplementedError. */
function notImplementedRepository<R>(entity: string): R {
  const fail = (method: string): never => {
    throw new NotImplementedError(entity, method);
  };
  return {
    listSummaries: () => fail("listSummaries"),
    getDetail: () => fail("getDetail"),
    search: () => fail("search"),
    count: () => fail("count"),
  } as R;
}

/**
 * The future Supabase data layer. `customers` (P4D Wave 1A) and `workOrders`
 * (P5C WO-1) are implemented and read their real tables; the remaining
 * repositories are still typed placeholders that throw NotImplementedError until
 * their migration wave (schedule, activity, time reports — per the P4A waves).
 *
 * NOTE: this layer is NOT wired into any page. localStorage (`localDataLayer`)
 * remains the source of truth; the Supabase customers path is exercised only by
 * the migration + shadow-read tooling during Wave 1A.
 */
export const supabaseDataLayer: DataLayer = {
  customers: supabaseCustomerRepository,
  employees: notImplementedRepository<EmployeeRepository>("employees"),
  workOrders: supabaseWorkOrderRepository,
  schedule: notImplementedRepository<ScheduleRepository>("schedule"),
  activityLog: notImplementedRepository<ActivityLogRepository>("activityLog"),
  timeReports: notImplementedRepository<TimeReportRepository>("timeReports"),
};
