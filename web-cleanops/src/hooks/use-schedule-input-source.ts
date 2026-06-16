import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkOrder, BookingOccurrenceException } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  resolveScheduleProgram,
  type ScheduleCoreInput,
} from "@/lib/scheduleCore";
import {
  fetchScheduleIntervalFromSupabase,
  compareScheduleEntries,
  shouldReadScheduleFromSupabase,
  isScheduleSupabaseAuthoritative,
  recordScheduleSupabaseInput,
  recordScheduleInputFallback,
  recordScheduleShadowDrift,
  recordScheduleIntervalQuery,
  type ScheduleIntervalComparison,
} from "@/lib/data";

/** Where the Schedule resolver INPUT (work orders + base exceptions) comes from. */
export type ScheduleInputSourceKind = "local" | "supabase";

/** The lookups that stay local while their own migrations complete. */
type ScheduleLookups = Pick<ScheduleCoreInput, "customers" | "employees" | "postalCities">;

export interface ScheduleInputSourceParams {
  /** The localStorage work orders the board renders today (fallback). */
  localWorkOrders: WorkOrder[];
  /** The localStorage base occurrence exceptions (fallback). */
  localExceptions: BookingOccurrenceException[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
  /** Inclusive interval bounds the board is currently showing (for the shadow compare). */
  fromDate: string;
  toDate: string;
  /** Whether cancelled occurrences are included in the current resolve. */
  includeCancelled: boolean;
  /** Lookups held constant from the local store (same on both sides). */
  lookups: ScheduleLookups;
}

export interface ScheduleInputSourceResult {
  /** Work orders the resolver should consume (Supabase when flag ON + healthy). */
  workOrders: WorkOrder[];
  /** Base occurrence exceptions (Supabase when flag ON + healthy). */
  exceptions: BookingOccurrenceException[];
  /** The source actually backing `workOrders` / `exceptions` right now. */
  source: ScheduleInputSourceKind;
  /** True while the Supabase input read is in flight (only when the flag is on). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back). */
  error: string | null;
  /** Latest background interval shadow-comparison result, when the flag is on. */
  shadow: ScheduleIntervalComparison | null;
  /**
   * Per-interval data token (P6C) reflecting source + scope + interval + the
   * fetched parent/row/exception counts. Folded into the Schedule cache key so
   * an interval whose underlying Supabase data changed is dropped, and a source
   * switch can never collide with a local-keyed interval.
   */
  dataToken: string;
}

/**
 * Resolves the SOURCE of the Schedule's resolver INPUT (P6B) — the Schedule
 * analogue of {@link import("./use-work-order-list-source").useWorkOrderListSource}.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localWorkOrders`
 * + `localExceptions` unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON ({@link SCHEDULE_SUPABASE_INTERVAL_READ}): reads the FULL work orders
 * (losslessly reconstructed from the `data` jsonb) and the occurrence exceptions
 * from Supabase via the validated WO-4 builders, and returns those instead. The
 * customer / employee / postal-city LOOKUPS stay local (passed in unchanged), so
 * any divergence is attributable purely to the migrated work-order / exception
 * representation. Empty Supabase intervals render empty schedule input;
 * browser-persistent local work orders/exceptions are not used as fallback data.
 *
 * The Supabase fetch is interval-INDEPENDENT (it returns the company's full set;
 * the resolver applies the range), so navigating the board does NOT refetch.
 * A background interval shadow comparison runs whenever the flag is ON: it
 * resolves BOTH inputs over the current range and diffs every occurrence via
 * {@link compareScheduleEntries}, surfacing any drift (never silently ignored).
 *
 * This hook ONLY moves the input source. The resolver, recurrence, variation and
 * exception LOGIC, the board, metrics, filters, cache and interactions are all
 * untouched. Rollback is instant: flip the flag OFF.
 */
export function useScheduleInputSource(
  params: ScheduleInputSourceParams,
): ScheduleInputSourceResult {
  const {
    localWorkOrders,
    localExceptions,
    companyId,
    fromDate,
    toDate,
    includeCancelled,
    lookups,
  } = params;

  const enabled = shouldReadScheduleFromSupabase() && isSupabaseConfigured;

  const [remoteWorkOrders, setRemoteWorkOrders] = useState<WorkOrder[] | null>(null);
  const [remoteExceptions, setRemoteExceptions] = useState<BookingOccurrenceException[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shadow, setShadow] = useState<ScheduleIntervalComparison | null>(null);

  // Guards stale async results from overwriting a newer fetch.
  const requestSeq = useRef<number>(0);

  // ── Interval-SCOPED input fetch (P6C — re-runs on scope / range / local change) ──
  // Replaces the WO-4/P6B whole-company hydration: only the work orders +
  // exceptions the [fromDate, toDate] window can touch are fetched, with the scan
  // window widened exactly as the resolver widens it for cross-boundary
  // reschedules. Navigating the board now refetches the (small) interval slice.
  useEffect(() => {
    if (!enabled) {
      setRemoteWorkOrders(null);
      setRemoteExceptions([]);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    setLoading(true);

    void (async () => {
      const stop = perf.start("schedule.input.supabase");
      try {
        const fetched = await fetchScheduleIntervalFromSupabase({
          companyId: scope,
          fromDate,
          toDate,
        });
        if (seq !== requestSeq.current) return; // superseded
        // Empty interval is authoritative absence. Never fall back to browser-
        // persistent local schedule input, because that can resurrect reset data.
        setRemoteWorkOrders(fetched.workOrders);
        setRemoteExceptions(fetched.exceptions);
        setError(null);
        recordScheduleSupabaseInput();
        recordScheduleIntervalQuery({
          fromDate,
          toDate,
          queryFromDate: fetched.queryFromDate,
          queryToDate: fetched.queryToDate,
          serviceRows: fetched.serviceRowsFetched,
          parents: fetched.parentsFetched,
          exceptions: fetched.exceptionsFetched,
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteWorkOrders([]);
        setRemoteExceptions([]);
        const message =
          err instanceof Error ? err.message : "Supabase schedule input read failed.";
        setError(message);
        recordScheduleInputFallback(scope ?? "*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [enabled, companyId, fromDate, toDate]);

  const usingSupabase = enabled;
  const workOrders = usingSupabase ? remoteWorkOrders ?? [] : localWorkOrders;
  const exceptions = usingSupabase ? remoteExceptions : localExceptions;

  // ── Background interval shadow comparison (re-runs on range / source change) ──
  useEffect(() => {
    if (!usingSupabase) {
      setShadow(null);
      return;
    }

    const stop = perf.start("schedule.shadowCompare");
    try {
      const base: Pick<ScheduleCoreInput, "fromDate" | "toDate" | "includeCancelled"> & ScheduleLookups = {
        ...lookups,
        fromDate,
        toDate,
        includeCancelled,
      };
      const localEntries = resolveScheduleProgram({
        ...base,
        workOrders: localWorkOrders,
        exceptions: localExceptions,
      });
      const supabaseEntries = resolveScheduleProgram({
        ...base,
        workOrders: remoteWorkOrders ?? [],
        exceptions: remoteExceptions,
      });
      const report = compareScheduleEntries(localEntries, supabaseEntries, {
        companyId: companyId ?? null,
        fromDate,
        toDate,
      });
      setShadow(report);
      if (!report.ok) recordScheduleShadowDrift(report.notes.join("; ") || "interval drift");
    } finally {
      stop();
    }
  }, [
    usingSupabase,
    remoteWorkOrders,
    remoteExceptions,
    localWorkOrders,
    localExceptions,
    companyId,
    fromDate,
    toDate,
    includeCancelled,
    lookups,
  ]);

  return useMemo<ScheduleInputSourceResult>(() => {
    const scope = companyId ?? "*";
    // P6D — the authority mode is folded into the data token (and thus the
    // interval cache key) so a Supabase-input interval can never collide with a
    // local-keyed interval.
    const authority = isScheduleSupabaseAuthoritative() ? "auth" : "read";
    if (usingSupabase) {
      perf.count("schedule.input.source.supabase");
      const dataToken = `supabase|${authority}|${scope}|${fromDate}..${toDate}|wo${workOrders.length}|ex${exceptions.length}`;
      return { workOrders, exceptions, source: "supabase", loading, error, shadow, dataToken };
    }
    perf.count("schedule.input.source.local");
    return { workOrders, exceptions, source: "local", loading, error, shadow, dataToken: `local|${authority}|${scope}` };
  }, [usingSupabase, workOrders, exceptions, loading, error, shadow, companyId, fromDate, toDate]);
}
