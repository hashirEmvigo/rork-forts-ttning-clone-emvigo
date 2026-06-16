import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  configureArticleNumberSeries,
  listArticleNumberSeriesFromSupabase,
  type ArticleNumberSeries,
  type ArticleNumberSeriesScope,
} from "@/lib/data/supabaseArticleNumberSeriesRepository";

export const ARTICLE_NUMBER_SERIES_QUERY_KEY = ["article-number-series"] as const;

export interface UseArticleNumberSeriesResult {
  /** Configured series keyed by owning category id (for the active scope). */
  seriesByCategory: Map<string, ArticleNumberSeries>;
  isLoading: boolean;
  /** Creates/updates a category series; resolves to the saved series. */
  configure: (input: {
    scope: ArticleNumberSeriesScope;
    rangeStart: number;
    rangeEnd: number;
    isActive?: boolean;
  }) => Promise<ArticleNumberSeries>;
  isConfiguring: boolean;
}

/**
 * Loads (and lets an admin configure) the article-number series for a catalog
 * scope. Pass the active service scope: `null` for the Super Admin global
 * catalog, a company legacy id for a company catalog, `undefined` to disable.
 */
export function useArticleNumberSeries(
  companyId: string | null | undefined,
): UseArticleNumberSeriesResult {
  const queryClient = useQueryClient();
  const scopeKey = companyId == null ? "__global__" : companyId;
  const queryKey = useMemo(() => [...ARTICLE_NUMBER_SERIES_QUERY_KEY, scopeKey], [scopeKey]);

  const query = useQuery({
    queryKey,
    queryFn: () => listArticleNumberSeriesFromSupabase(companyId ?? null),
    enabled: companyId !== undefined,
  });

  const seriesByCategory = useMemo(() => {
    const map = new Map<string, ArticleNumberSeries>();
    for (const series of query.data ?? []) map.set(series.categoryId, series);
    return map;
  }, [query.data]);

  const configureMutation = useMutation({
    mutationFn: configureArticleNumberSeries,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const configure = useCallback(
    (input: {
      scope: ArticleNumberSeriesScope;
      rangeStart: number;
      rangeEnd: number;
      isActive?: boolean;
    }) => configureMutation.mutateAsync(input),
    [configureMutation],
  );

  return {
    seriesByCategory,
    isLoading: query.isLoading,
    configure,
    isConfiguring: configureMutation.isPending,
  };
}
