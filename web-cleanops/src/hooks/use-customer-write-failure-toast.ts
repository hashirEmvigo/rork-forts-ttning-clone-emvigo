import { useEffect } from "react";

import { useToast } from "@/hooks/use-toast";
import {
  isCustomerSupabaseAuthoritative,
  subscribeCustomerCutoverFailure,
} from "@/lib/data";

/**
 * Surfaces Customer Supabase cut-over WRITE failures to the admin (Wave 1F).
 *
 * When Customers are Supabase-authoritative, a failed mirror means the write
 * landed in the localStorage backout copy but NOT in the authoritative Supabase
 * store. That divergence must never be silent — this hook listens for
 * `write.mirror` cut-over failures and raises a destructive toast so the admin
 * can retry / investigate. Read fallbacks are already recorded in telemetry and
 * are deliberately not toasted (the list/card never go blank).
 *
 * No-op unless authoritative mode is on. Mount once in an always-rendered admin
 * shell (the dashboard layout).
 */
export function useCustomerWriteFailureToast(): void {
  const { toast } = useToast();

  useEffect(() => {
    if (!isCustomerSupabaseAuthoritative()) return;
    return subscribeCustomerCutoverFailure((failure) => {
      if (failure.kind !== "write.mirror") return;
      toast({
        title: "Customer not saved to the server",
        description:
          "The change was kept locally but failed to reach Supabase. " +
          `Reference ${failure.ref}: ${failure.message}`,
        variant: "destructive",
      });
    });
  }, [toast]);
}
