/**
 * Operational Execution — Mission Log repository interface (Phase 1 foundation).
 *
 * INTERFACE ONLY. This declares the storage-agnostic read contract for Mission
 * Log, modelled on the existing {@link ReadRepository} seam (the same shape the
 * customer/work-order/schedule repositories use). There is NO implementation
 * here — no localStorage adapter, no Supabase adapter, no wiring into the
 * `DataLayer`. Later phases provide an adapter behind this exact interface.
 *
 * Mission Log is company-scoped and read through lightweight summaries + a full
 * detail lookup, mirroring every other operational entity.
 */

import type { ReadRepository } from "./contracts";
import type { ListParams } from "./types";
import type {
  DelayStatus,
  MissionLogEntry,
  MissionLogEvent,
  MissionStaffSession,
  MissionStatus,
} from "@/types/missionLog";

/** Lightweight Mission Log row for board/list surfaces. */
export interface MissionLogSummary {
  id: string;
  companyId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;
  customerId: string;
  customerNameSnapshot: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  actualStartTime?: string;
  actualEndTime?: string;
  missionStatus: MissionStatus;
  delayStatus: DelayStatus;
  requiresAdminReview: boolean;
}

/** Full Mission Log record (incl. the per-employee sessions + event stream). */
export interface MissionLogDetail extends MissionLogEntry {
  staffSessions: MissionStaffSession[];
  events: MissionLogEvent[];
}

/**
 * Mission Log list/search params. Date-window scoped (Mission Log never shows
 * future planned work — that is Schedule) with optional status filters.
 */
export interface MissionLogListParams extends ListParams {
  /** Inclusive date lower bound "YYYY-MM-DD". */
  fromDate?: string;
  /** Inclusive date upper bound "YYYY-MM-DD" (never past today in Mission Log). */
  toDate?: string;
  missionStatuses?: MissionStatus[];
  delayStatuses?: DelayStatus[];
  /** Restrict to a team, when team scoping is requested. */
  teamId?: string;
  /** Restrict to specific employees. */
  employeeIds?: string[];
  customerId?: string;
  /** Only missions still needing admin attention. */
  requiresAdminReviewOnly?: boolean;
  /**
   * Restrict to a single service row by its app-facing legacy id. Backs the
   * legacy delete-guard / cut-over parity lookups (the flat
   * `service_row_legacy_id` column on `mission_log_entries`, migration 0031).
   */
  serviceRowLegacyId?: string;
}

/** The Mission Log read repository contract. Interface only — no implementation. */
export type MissionLogRepository = ReadRepository<
  MissionLogSummary,
  MissionLogDetail,
  MissionLogListParams
>;
