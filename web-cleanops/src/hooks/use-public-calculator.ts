import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchPublicCalculatorConfig,
  requestPublicCalculation,
  submitPublicQuoteRequest,
  type PublicCalculateRequest,
  type PublicCalculateResponse,
  type PublicCalculatorConfigResult,
  type PublicSubmitRequest,
  type PublicSubmitResponse,
} from "@/lib/calculator/publicCalculatorClient";

/** Shared React Query key for a public calculator config (by slug). */
export function publicCalculatorConfigKey(slug: string): readonly [string, string, string] {
  return ["public-calculator", "config", slug] as const;
}

/**
 * Loads the public-safe calculator config for a slug through the Edge Function.
 * Config rarely changes, so it is cached for a minute; a single retry covers a
 * transient cold start without hammering the function.
 */
export function usePublicCalculatorConfig(slug: string): UseQueryResult<PublicCalculatorConfigResult> {
  return useQuery({
    queryKey: publicCalculatorConfigKey(slug),
    queryFn: () => fetchPublicCalculatorConfig(slug),
    staleTime: 60_000,
    retry: 1,
  });
}

export interface UsePublicPriceCalculationParams {
  slug: string;
  /** The (already debounced) calculate request, or null when not ready to price. */
  request: PublicCalculateRequest | null;
  /** Gate: only call the server when the calculator is enabled AND inputs are ready. */
  enabled: boolean;
}

/**
 * Requests a server-authoritative price for the current (debounced) inputs. The
 * query key includes the serialized request so identical inputs are cached and a
 * changed input refetches; `placeholderData` keeps the previous figures on screen
 * while the next calculation is in flight (no flicker). Never trusts a local price.
 */
export function usePublicPriceCalculation({
  slug,
  request,
  enabled,
}: UsePublicPriceCalculationParams): UseQueryResult<PublicCalculateResponse> {
  return useQuery({
    queryKey: ["public-calculator", "calculate", slug, request ? JSON.stringify(request) : "idle"],
    queryFn: () => requestPublicCalculation(slug, request as PublicCalculateRequest),
    enabled: enabled && request !== null,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * Mutation for the public quote SUBMIT (write) path. The page guards against a
 * duplicate submit via {@link UseMutationResult.isPending} (the CTA disables and
 * the handler early-returns while a request is in flight). No retry — a write
 * must never be silently repeated. The server is the single source of truth, so
 * a `valid:false` / `available:false` response resolves (not rejects) and the
 * page reacts without any local write.
 */
export function useSubmitPublicQuote(
  slug: string,
): UseMutationResult<PublicSubmitResponse, Error, PublicSubmitRequest> {
  return useMutation({
    mutationFn: (request: PublicSubmitRequest) => submitPublicQuoteRequest(slug, request),
    retry: false,
  });
}
