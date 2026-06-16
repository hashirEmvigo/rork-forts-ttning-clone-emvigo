import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  supabaseCustomerProtocolRepository,
  type CustomerProtocolAggregate,
} from "@/lib/data/supabaseCustomerProtocolRepository";
import type { CustomerProtocolV2 } from "@/types";

export interface CustomerProtocolReadModelCounts {
  categories: number;
  floorPresets: number;
  sections: number;
  items: number;
}

export interface CustomerProtocolReadModelResult {
  aggregates: CustomerProtocolAggregate[];
  protocols: CustomerProtocolV2[];
  active: CustomerProtocolV2[];
  archived: CustomerProtocolV2[];
  counts: Record<string, CustomerProtocolReadModelCounts>;
  isLoading: boolean;
  error: Error | null;
}

export interface CustomerProtocolDetailReadModelResult {
  aggregate: CustomerProtocolAggregate | null;
  protocol: CustomerProtocolV2 | null;
  counts: CustomerProtocolReadModelCounts | null;
  isLoading: boolean;
  error: Error | null;
}

function countCustomerProtocolAggregate(
  aggregate: CustomerProtocolAggregate,
): CustomerProtocolReadModelCounts {
  return {
    categories: aggregate.protocol.categoryIds.length,
    floorPresets: aggregate.protocol.floorPresetIds.length,
    sections: aggregate.sections.length,
    items: aggregate.items.length,
  };
}

/**
 * Supabase-only customer protocol read model. Empty Supabase reads remain empty;
 * this hook never reads browser storage and never falls back to legacy stores.
 */
export function useCustomerProtocolReadModel(
  companyId: string | null | undefined,
  customerId: string | null | undefined,
): CustomerProtocolReadModelResult {
  const enabled = Boolean(companyId && customerId);
  const query = useQuery<CustomerProtocolAggregate[], Error>({
    queryKey: ["customer-protocol-read-model", companyId ?? null, customerId ?? null],
    queryFn: () =>
      supabaseCustomerProtocolRepository.listByCustomer(companyId!, customerId!, {
        includeArchived: true,
      }),
    enabled,
  });

  const aggregates = query.data ?? [];
  return useMemo<CustomerProtocolReadModelResult>(() => {
    const protocols = aggregates.map((aggregate) => aggregate.protocol);
    const counts: Record<string, CustomerProtocolReadModelCounts> = {};
    for (const aggregate of aggregates) {
      counts[aggregate.protocol.id] = countCustomerProtocolAggregate(aggregate);
    }
    return {
      aggregates,
      protocols,
      active: protocols.filter((protocol) => !protocol.isArchived),
      archived: protocols.filter((protocol) => protocol.isArchived),
      counts,
      isLoading: query.isLoading,
      error: query.error ?? null,
    };
  }, [aggregates, query.error, query.isLoading]);
}

/** Supabase-only customer protocol detail read model. Missing rows return null. */
export function useCustomerProtocolDetailReadModel(
  companyId: string | null | undefined,
  customerId: string | null | undefined,
  legacyId: string | null | undefined,
): CustomerProtocolDetailReadModelResult {
  const enabled = Boolean(companyId && customerId && legacyId);
  const query = useQuery<CustomerProtocolAggregate | null, Error>({
    queryKey: [
      "customer-protocol-detail-read-model",
      companyId ?? null,
      customerId ?? null,
      legacyId ?? null,
    ],
    queryFn: () =>
      supabaseCustomerProtocolRepository.getByLegacyId(legacyId!, {
        companyId: companyId!,
        customerId: customerId!,
        includeArchived: true,
      }),
    enabled,
  });

  const aggregate = query.data ?? null;
  return useMemo<CustomerProtocolDetailReadModelResult>(() => {
    return {
      aggregate,
      protocol: aggregate?.protocol ?? null,
      counts: aggregate ? countCustomerProtocolAggregate(aggregate) : null,
      isLoading: query.isLoading,
      error: query.error ?? null,
    };
  }, [aggregate, query.error, query.isLoading]);
}
