import { UserCheck, UserMinus } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RoleBadge } from "@/components/RoleBadge";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

/**
 * A queued enable/disable lifecycle action awaiting explicit confirmation.
 * Carries everything the dialog needs to identify the affected person (name,
 * email, role, company) so the admin can verify exactly who they are acting on.
 */
export interface PendingStatusChange {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  companyName: string;
  /** The status the user will be moved to once confirmed. */
  next: "active" | "inactive";
}

interface UserStatusConfirmDialogProps {
  /** The queued action, or null when the dialog is closed. */
  pending: PendingStatusChange | null;
  /** Confirms the queued action (the caller performs the actual status flip). */
  onConfirm: (pending: PendingStatusChange) => void;
  /** Dismisses the dialog without acting (Cancel, Esc, or overlay click). */
  onClose: () => void;
}

/**
 * Confirmation gate for the Disable / Enable user lifecycle actions. It restates
 * exactly who is affected (name, email, role, company) and the consequence
 * before the status flip is sent to the `admin-user-lifecycle` Edge Function.
 *
 * This is a presentation-only guard: the server independently re-checks every
 * authorization and lockout rule (cannot disable yourself, cannot disable the
 * last active Super Admin, company admins are scoped to their own company and
 * can never touch a Super Admin). The dialog never weakens those protections.
 */
export function UserStatusConfirmDialog({
  pending,
  onConfirm,
  onClose,
}: UserStatusConfirmDialogProps) {
  const isDisable = pending?.next === "inactive";

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        {pending ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isDisable ? "Disable user?" : "Enable user?"}
              </AlertDialogTitle>
            </AlertDialogHeader>

            <dl className="space-y-2.5 rounded-xl border border-border bg-muted/30 p-4 text-sm">
              <DetailRow label="Name" value={pending.name} />
              <DetailRow label="Email" value={pending.email} />
              <div className="flex items-center justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">Role</dt>
                <dd>
                  <RoleBadge role={pending.role} />
                </dd>
              </div>
              <DetailRow label="Company" value={pending.companyName} />
            </dl>

            <AlertDialogDescription
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                isDisable
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {isDisable
                ? "This user will no longer be able to sign in after being disabled."
                : "This user will regain access after being enabled."}
            </AlertDialogDescription>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onConfirm(pending)}
                className={cn(
                  isDisable &&
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                )}
              >
                {isDisable ? (
                  <UserMinus className="h-4 w-4" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )}
                {isDisable ? "Disable User" : "Enable User"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A single label/value row in the affected-user summary. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}
