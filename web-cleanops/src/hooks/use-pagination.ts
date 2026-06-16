import { useEffect, useMemo, useState } from "react";

/** Standard page-size options (Performance Policy §3). */
export const DEFAULT_PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100] as const;

export interface UsePaginationOptions {
  /** Initial page size. Defaults to 20. */
  pageSize?: number;
  /**
   * When this value changes the view resets to page 1. Pass a key derived from
   * the active filters/search so a new query always starts at the top.
   */
  resetKey?: unknown;
}

export interface UsePaginationResult<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  /** The items belonging to the current page (already sliced). */
  pageItems: T[];
  /** 0-based index of the first item on the page (for "showing X–Y"). */
  startIndex: number;
  /** Exclusive end index of the page window. */
  endIndex: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/**
 * Client-side pagination over an already-filtered array.
 *
 * Slices the data to the current page so large result sets never all render at
 * once (Performance Policy §3/§6/§7). It is intentionally source-agnostic: the
 * same hook works over in-memory arrays today and can wrap a server page after
 * the Supabase migration with no call-site changes.
 */
export function usePagination<T>(
  items: T[],
  options: UsePaginationOptions = {},
): UsePaginationResult<T> {
  const { pageSize: initialPageSize = 20, resetKey } = options;
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSizeState] = useState<number>(initialPageSize);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Reset to the first page when the dataset identity or page size changes.
  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  // Clamp the page if the dataset shrinks below the current window.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const pageItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex],
  );

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setPage(1);
  };

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems,
    pageItems,
    startIndex,
    endIndex,
    setPage,
    setPageSize,
  };
}
