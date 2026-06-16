import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { requestPasswordReset } from "@/lib/authSupabase";
import { passwordRecoveryRedirectUrl } from "@/lib/employeeLoginInvite";
import {
  resendUserInvite,
  setUserLifecycleStatus,
} from "@/lib/adminUserLifecycle";
import { DIRECTORY_PROFILES_QUERY_KEY } from "@/hooks/use-directory-profiles";
import { USER_AUTH_META_QUERY_KEY } from "@/hooks/use-user-auth-meta";

/** Minimal user shape the lifecycle actions operate on. */
export interface LifecycleTarget {
  id: string;
  email: string;
  name: string;
}

interface SetStatusVars {
  target: LifecycleTarget;
  status: "active" | "inactive";
}

/**
 * Wires the User Lifecycle Actions (resend invite, send password reset,
 * disable/enable) to their server/client helpers with consistent success/error
 * toasts and cache invalidation. Each action is a React Query mutation so the
 * UI gets a single in-flight target to disable the row while it runs.
 *
 * Password reset runs entirely client-side (it reuses the same Supabase recovery
 * email + redirect as the Forgot Password screen); resend invite and status
 * changes go through the `admin-user-lifecycle` Edge Function.
 */
export function useUserLifecycleActions(): {
  resendInvite: (target: LifecycleTarget) => void;
  sendPasswordReset: (target: LifecycleTarget) => void;
  setStatus: (target: LifecycleTarget, status: "active" | "inactive") => void;
  /** The id of the user currently being acted on, or null when idle. */
  busyUserId: string | null;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refreshDirectories = () => {
    queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: USER_AUTH_META_QUERY_KEY });
  };

  const resend = useMutation({
    mutationFn: async (target: LifecycleTarget) => {
      const res = await resendUserInvite({ userId: target.id, email: target.email });
      if (!res.ok) throw new Error(res.error ?? "Could not re-send the invite.");
      return res;
    },
    onSuccess: (res, target) => {
      toast({
        title: "Invite sent",
        description:
          res.mode === "recovery_fallback"
            ? `${target.name} already has an account — sent a link to set their password.`
            : `Re-sent the invite email to ${target.email}.`,
      });
      refreshDirectories();
    },
    onError: (err, target) => {
      toast({
        variant: "destructive",
        title: "Couldn't send invite",
        description: err instanceof Error ? err.message : `Failed to invite ${target.name}.`,
      });
    },
  });

  const reset = useMutation({
    mutationFn: async (target: LifecycleTarget) => {
      const res = await requestPasswordReset(target.email, passwordRecoveryRedirectUrl());
      if (!res.sent) {
        throw new Error(res.error ?? "Could not send the password reset email.");
      }
      return res;
    },
    onSuccess: (_res, target) => {
      toast({
        title: "Password reset sent",
        description: `Sent a password reset link to ${target.email}.`,
      });
    },
    onError: (err, target) => {
      toast({
        variant: "destructive",
        title: "Couldn't send reset",
        description:
          err instanceof Error ? err.message : `Failed to reset ${target.name}'s password.`,
      });
    },
  });

  const status = useMutation({
    mutationFn: async ({ target, status: next }: SetStatusVars) => {
      const res = await setUserLifecycleStatus({ userId: target.id, status: next });
      if (!res.ok) throw new Error(res.error ?? "Could not update the user's status.");
      return res;
    },
    onSuccess: (_res, { target, status: next }) => {
      toast({
        title: next === "inactive" ? "User disabled" : "User enabled",
        description:
          next === "inactive"
            ? `${target.name} can no longer sign in.`
            : `${target.name} can sign in again.`,
      });
      refreshDirectories();
    },
    onError: (err, { target }) => {
      toast({
        variant: "destructive",
        title: "Couldn't update status",
        description: err instanceof Error ? err.message : `Failed to update ${target.name}.`,
      });
    },
  });

  const busyUserId =
    (resend.isPending ? resend.variables?.id : undefined) ??
    (reset.isPending ? reset.variables?.id : undefined) ??
    (status.isPending ? status.variables?.target.id : undefined) ??
    null;

  return {
    resendInvite: (target) => resend.mutate(target),
    sendPasswordReset: (target) => reset.mutate(target),
    setStatus: (target, next) => status.mutate({ target, status: next }),
    busyUserId,
  };
}
