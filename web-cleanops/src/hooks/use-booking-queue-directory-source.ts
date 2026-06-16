import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { BookingQueueItem } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullBookingQueueFromSupabase } from "@/lib/data/supabaseBookingQueueRepository";
import { shadowReadBookingQueue } from "@/lib/data/bookingQueueMigration";
import {
  shouldReadBookingQueueFromSupabase,
  shouldUseBookingQueueLocalBackoutBridge,
  recordBookingQueueSupabaseRead,
  recordBookingQueueReadFallback,
  recordBookingQueueUnsafeEmpty,
  recordBookingQueueShadowDrift,
} from "@/lib/data/bookingQueueCutover";
import {
  getBookingQueueDirectoryRefreshVersion,
  subscribeBookingQueueDirectoryRefresh,
} from "@/lib/data/bookingQueueDirectoryRefresh";

export type BookingQueueDirectorySourceKind = "local" | "supabase";
export type BookingQueueDirectoryReadStatus =
  | "local_disabled"
  | "supabase_non_empty"
  | "supabase_empty_authoritative"
  | "supabase_read_error"
  | "supabase_read_unsafe_empty";

export interface BookingQueueDirectorySourceParams {
  localItems: BookingQueueItem[];
  companyId: string | null | undefined;
}

export interface BookingQueueDirectorySourceResult {
  items: BookingQueueItem[];
  source: BookingQueueDirectorySourceKind;
  loading: boolean;
  error: string | null;
  readStatus: BookingQueueDirectoryReadStatus;
  localBackoutVisible: boolean;
}

/**
 * Resolves the SOURCE of the booking-queue directory (BQ-1) — the Booking Queue
 * analogue of {@link import("./use-area-directory-source").useAreaDirectorySource}.
 * Default (flag OFF): returns `localItems` unchanged. Flag ON: reconciles to a
 * Supabase result directly. Clean successful empty reads are authoritative and
 * stay empty. The local backout copy is temporary technical debt and is visible
 * only on read errors or the explicit unsafe-empty migration bridge. Rollback =
 * flag OFF.
 *
 * NOTE: this hook supplies the RAW persisted queue; the AppContext continues to
 * apply its `syncBookingItem` re-derivation + access filtering on top, so the
 * source swap is transparent to every consumer.
 */
export function useBookingQueueDirectorySource(
  params: BookingQueueDirectorySourceParams,
): BookingQueueDirectorySourceResult {
  const { localItems, companyId } = params;

  const enabled = shouldReadBookingQueueFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<BookingQueueItem[] | null>(null);
  const [fallbackToLocal, setFallbackToLocal] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [readStatus, setReadStatus] =
    useState<BookingQueueDirectoryReadStatus>("local_disabled");

  const requestSeq = useRef<number>(0);
  const refreshVersion = useSyncExternalStore(
    subscribeBookingQueueDirectoryRefresh,
    getBookingQueueDirectoryRefreshVersion,
    getBookingQueueDirectoryRefreshVersion,
  );

  useEffect(() => {
    if (!enabled) {
      setRemote(null);
      setFallbackToLocal(false);
      setError(null);
      setReadStatus("local_disabled");
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("bookingQueue.directory.supabase");
      try {
        const fetched = await listFullBookingQueueFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        const emptyReadNeedsExplicitBridge =
          fetched.length === 0 &&
          localItems.length > 0 &&
          shouldUseBookingQueueLocalBackoutBridge();

        if (emptyReadNeedsExplicitBridge) {
          // Temporary technical debt: only an explicit migration/backout bridge
          // can make local Booking Queue rows visible after an empty Supabase read.
          // Clean authoritative empty reads must remain empty.
          setFallbackToLocal(true);
          setReadStatus("supabase_read_unsafe_empty");
          recordBookingQueueUnsafeEmpty(ref);
        } else {
          setFallbackToLocal(false);
          setReadStatus(fetched.length === 0 ? "supabase_empty_authoritative" : "supabase_non_empty");
          recordBookingQueueSupabaseRead();
          if (fetched.length > 0) void runShadowCompare(scope);
        }
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        setFallbackToLocal(localItems.length > 0);
        setReadStatus("supabase_read_error");
        const message =
          err instanceof Error ? err.message : "Supabase booking-queue directory read failed.";
        setError(message);
        recordBookingQueueReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // Browser-persistent local data is intentionally not a refetch trigger; it is
    // only used as the already-mounted backout copy when Supabase cannot safely serve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId, refreshVersion]);

  const usingSupabase = enabled && !fallbackToLocal;
  const items = enabled ? (fallbackToLocal ? localItems : remote ?? []) : localItems;

  return useMemo<BookingQueueDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("bookingQueue.directory.source.supabase");
      return { items, source: "supabase", loading, error, readStatus, localBackoutVisible: false };
    }
    perf.count("bookingQueue.directory.source.local");
    return {
      items,
      source: "local",
      loading,
      error,
      readStatus,
      localBackoutVisible: enabled && fallbackToLocal,
    };
  }, [usingSupabase, items, loading, error, readStatus, enabled, fallbackToLocal]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadBookingQueue(scope ?? null);
    if (!report.ok) {
      recordBookingQueueShadowDrift(report.notes.join("; ") || "booking-queue directory drift");
    }
  } catch {
    // observability-only
  }
}
