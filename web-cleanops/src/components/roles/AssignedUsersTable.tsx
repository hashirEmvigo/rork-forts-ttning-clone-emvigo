import { useMemo, useState } from "react";
import {
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MoreHorizontal,
  Search,
  UserCheck,
  UserMinus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RoleBadge } from "@/components/RoleBadge";
import { StatusBadge } from "@/components/StatusBadge";
import {
  UserStatusConfirmDialog,
  type PendingStatusChange,
} from "@/components/roles/UserStatusConfirmDialog";
import { useApp } from "@/context/AppContext";
import { useAssignedUsers } from "@/hooks/use-assigned-users";
import { useUserAuthMeta } from "@/hooks/use-user-auth-meta";
import {
  useUserLifecycleActions,
  type LifecycleTarget,
} from "@/hooks/use-user-lifecycle-actions";
import { companiesFromAssignedUserRoster } from "@/lib/assignedUsersRoster";
import { formatDate, formatDateTime, initials } from "@/lib/format";
import { BASE_ROLE_ORDER } from "@/lib/rolesOverview";
import {
  canResendInvite,
  deriveInviteStatus,
  inviteStatusLabel,
  type InviteStatus,
} from "@/lib/userInviteStatus";
import { ROLE_LABELS, type EntityStatus, type Role, type UserRole } from "@/types";

interface AssignedUsersTableProps {
  /** "all" or a company id. Controlled so other tabs can deep-link here. */
  companyFilter: string;
  onCompanyFilterChange: (value: string) => void;
  /** "all" or a base role. Controlled so other tabs can deep-link here. */
  roleFilter: string;
  onRoleFilterChange: (value: string) => void;
  /**
   * Single-company admin view: hides the Company filter + column (the roster is
   * already scoped to the admin's own company) so the table stays focused.
   */
  singleCompany?: boolean;
}

/**
 * A flat, filterable directory of every user and the role they hold, with the
 * authentication lifecycle metadata (Last Login, Invite Status, User Status) and
 * the per-user lifecycle actions (resend invite, send password reset, disable /
 * enable). Replaces the need to scan role cards to discover who holds each role.
 */
export function AssignedUsersTable({
  companyFilter,
  onCompanyFilterChange,
  roleFilter,
  onRoleFilterChange,
  singleCompany = false,
}: AssignedUsersTableProps) {
  const { roles, currentUser } = useApp();
  const { roster } = useAssignedUsers();
  const { meta, isAvailable: metaAvailable } = useUserAuthMeta();
  const { resendInvite, sendPasswordReset, setStatus, busyUserId } =
    useUserLifecycleActions();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  // The disable/enable action queued for confirmation, or null when no dialog is
  // open. Lifted here (not inside the per-row dropdown) so a single AlertDialog
  // instance renders the affected user's details outside the closing menu.
  const [pendingStatus, setPendingStatus] = useState<PendingStatusChange | null>(
    null,
  );

  const canManage =
    currentUser?.role === "super_admin" || currentUser?.role === "company_admin";

  const companyOptions = useMemo(() => companiesFromAssignedUserRoster(roster), [roster]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster
      .filter((u) => companyFilter === "all" || (u.companyId ?? "") === companyFilter)
      .filter((u) => roleFilter === "all" || u.role === roleFilter)
      .filter((u) => statusFilter === "all" || u.status === (statusFilter as EntityStatus))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, companyFilter, roleFilter, statusFilter, query]);

  const colSpan = singleCompany ? 7 : 8;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {!singleCompany ? (
          <Select value={companyFilter} onValueChange={onCompanyFilterChange}>
            <SelectTrigger className="sm:w-44">
              <SelectValue placeholder="Company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companyOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select value={roleFilter} onValueChange={onRoleFilterChange}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {BASE_ROLE_ORDER.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>User</TableHead>
              {!singleCompany ? <TableHead>Company</TableHead> : null}
              <TableHead>Role</TableHead>
              <TableHead>Invite</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  No users match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => {
                const userMeta = meta[user.id];
                const inviteStatus = deriveInviteStatus(userMeta);
                const lastLogin = userMeta?.lastSignInAt
                  ? formatDateTime(userMeta.lastSignInAt)
                  : userMeta
                    ? "Never"
                    : "—";
                const isSelf = user.id === currentUser?.id;
                const isBusy = busyUserId === user.id;
                const target: LifecycleTarget = {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                };
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                          {initials(user.name)}
                        </div>
                        <div className="min-w-0 leading-tight">
                          <p className="truncate text-sm font-medium">{user.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    {!singleCompany ? (
                      <TableCell className="text-sm text-muted-foreground">
                        {user.companyName}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <RoleCell
                        userName={user.name}
                        baseRole={user.role}
                        roleId={user.roleId}
                        roles={roles}
                      />
                    </TableCell>
                    <TableCell>
                      <InviteStatusBadge status={inviteStatus} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {lastLogin}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <UserActionsMenu
                          target={target}
                          inviteStatus={inviteStatus}
                          userStatus={user.status}
                          isSelf={isSelf}
                          isBusy={isBusy}
                          onResendInvite={() => resendInvite(target)}
                          onSendPasswordReset={() => sendPasswordReset(target)}
                          onRequestStatusChange={(next) =>
                            setPendingStatus({
                              userId: user.id,
                              name: user.name,
                              email: user.email,
                              role: user.role,
                              companyName: user.companyName,
                              next,
                            })
                          }
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <UserStatusConfirmDialog
        pending={pendingStatus}
        onConfirm={(p) => {
          setStatus({ id: p.userId, email: p.email, name: p.name }, p.next);
          setPendingStatus(null);
        }}
        onClose={() => setPendingStatus(null)}
      />

      {canManage && !metaAvailable && filtered.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Last login and invite status appear once the{" "}
          <code className="rounded bg-muted px-1 py-0.5">admin-user-lifecycle</code> function is
          deployed. Resend invite and disable/enable also need it; send password reset works now.
        </p>
      ) : null}
    </div>
  );
}

interface UserActionsMenuProps {
  target: LifecycleTarget;
  inviteStatus: InviteStatus;
  userStatus: EntityStatus;
  isSelf: boolean;
  isBusy: boolean;
  onResendInvite: () => void;
  onSendPasswordReset: () => void;
  /** Queues a disable/enable; the parent confirms it before the status flips. */
  onRequestStatusChange: (status: "active" | "inactive") => void;
}

/** The per-user lifecycle actions dropdown. */
function UserActionsMenu({
  target,
  inviteStatus,
  userStatus,
  isSelf,
  isBusy,
  onResendInvite,
  onSendPasswordReset,
  onRequestStatusChange,
}: UserActionsMenuProps) {
  const isActive = userStatus === "active";
  const showResend = canResendInvite(inviteStatus);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={isBusy}
          aria-label={`Actions for ${target.name}`}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{target.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {showResend ? (
          <DropdownMenuItem onClick={onResendInvite}>
            <Mail className="h-4 w-4" /> Resend invite
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem onClick={onSendPasswordReset}>
          <KeyRound className="h-4 w-4" /> Send password reset
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isActive ? (
          <DropdownMenuItem
            onClick={() => onRequestStatusChange("inactive")}
            disabled={isSelf}
            className={cn(!isSelf && "text-destructive focus:text-destructive")}
          >
            <UserMinus className="h-4 w-4" /> Disable user
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onRequestStatusChange("active")}>
            <UserCheck className="h-4 w-4" /> Enable user
          </DropdownMenuItem>
        )}

        <DropdownMenuItem disabled className="text-muted-foreground">
          <LogOut className="h-4 w-4" /> Force sign out (soon)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const INVITE_STATUS_STYLES: Record<InviteStatus, string> = {
  accepted: "border-success/20 bg-success/10 text-success",
  pending: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unknown: "border-border bg-muted text-muted-foreground",
};

/** Compact pill conveying onboarding/invite state. */
function InviteStatusBadge({ status }: { status: InviteStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        INVITE_STATUS_STYLES[status],
      )}
    >
      {inviteStatusLabel(status)}
    </span>
  );
}

interface RoleCellProps {
  userName: string;
  baseRole: UserRole;
  roleId: string | null | undefined;
  roles: Role[];
}

/**
 * The Role column cell is intentionally read-only in CORE-WRITES-A2.2.1.
 * Role assignment persistence remains deferred until the assignment-write slice.
 */
function RoleCell({
  userName,
  baseRole,
  roleId,
  roles,
}: RoleCellProps) {
  const customName = roleId ? roles.find((r) => r.id === roleId)?.name : undefined;

  return (
    <div className="flex items-center gap-2" aria-label={`Role for ${userName}`}>
      <RoleBadge role={baseRole} />
      {customName ? (
        <span className="truncate text-xs text-muted-foreground">{customName}</span>
      ) : null}
    </div>
  );
}
