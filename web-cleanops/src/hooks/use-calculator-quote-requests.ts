import { useQuery } from "@tanstack/react-query";

import {
  getCalculatorQuoteRequests,
  type QuoteRequestView,
} from "@/lib/calculator/calculatorQuoteRequests";

/** Shared React Query key for the Super Admin quote-requests inbox. */
export const CALCULATOR_QUOTE_REQUESTS_QUERY_KEY = ["calculator-quote-requests"] as const;

export interface UseCalculatorQuoteRequestsResult {
  quoteRequests: QuoteRequestView[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Loads the locked Super Admin quote-requests inbox (Supabase-authoritative,
 * gated by super_admin RLS). READ-ONLY: there is no mutation here — this slice
 * only surfaces submitted quote requests; it never updates their status or any
 * other field.
 */
export function useCalculatorQuoteRequests(): UseCalculatorQuoteRequestsResult {
  const query = useQuery({
    queryKey: CALCULATOR_QUOTE_REQUESTS_QUERY_KEY,
    queryFn: () => getCalculatorQuoteRequests(),
  });

  return {
    quoteRequests: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: () => {
      void query.refetch();
    },
  };
}
