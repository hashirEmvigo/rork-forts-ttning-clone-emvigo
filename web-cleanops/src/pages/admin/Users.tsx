import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Power, Search, Users as UsersIcon } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { RoleBadge } from "@/components/RoleBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserDialog } from "@/components/users/UserDialog";
import { useApp } from "@/context/AppContext";
import { useDirectoryProfiles } from "@/hooks/use-directory-profiles";
import { useToast } from "@/hooks/use-toast";
import { formatDate, initials } from "@/lib/format";
import { areaScopeSummary } from "@/lib/areaScope";
import type { EntityStatus, User, UserRole } from "@/types";

/**
 * A team member row sourced from the Supabase `profiles` roster (the single
 * identity source of truth). `localUser` is the matching localStorage login, if
 * any — resolved ONLY so legacy edit/activate actions keep working. A profile
 * with no matching local user is shown read-only.
 */
interface TeamRow {
  /** Stable profile id (auth user id). */
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: EntityStatus;
  createdAt: string | null;
  localUser: User | null;
}

export default function Users() {
  const { currentUser, users, updateUser, areas } = useApp();
  const { profiles } = useDirectoryProfiles();
  const { toast } = useToast();
  const [query, setQuery] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<User | null>(null);

  const companyId = currentUser?.companyId ?? "";

  // Source of truth: the company-scoped Supabase profile roster. The local
  // `users` collection is NEVER the authority here — it is consulted only to
  // resolve a matching login for legacy edit/activate actions.
  const companyMembers = useMemo<TeamRow[]>(() => {
    return profiles
      .filter((profile) => profile.companyId === companyId)
      .map((profile) => {
        const email = profile.email?.trim().toLowerCase() ?? "";
        const localUser =
          users.find((u) => u.id === profile.id) ??
          users.find((u) => u.email.trim().toLowerCase() === email && email !== "") ??
          null;
        const status: EntityStatus = profile.status === "active" ? "active" : "inactive";
        return {
          id: profile.id,
          name: profile.fullName?.trim() || localUser?.name || profile.email || "Unnamed",
          email: profile.email ?? localUser?.email ?? "",
          role: profile.baseRole,
          status,
          createdAt: profile.createdAt ?? localUser?.createdAt ?? null,
          localUser,
        };
      });
  }, [profiles, users, companyId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companyMembers;
    return companyMembers.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [companyMembers, query]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (member: TeamRow) => {
    if (!member.localUser) return;
    setEditing(member.localUser);
    setDialogOpen(true);
  };

  const toggleStatus = (member: TeamRow) => {
    const login = member.localUser;
    if (!login) return;
    const next = login.status === "active" ? "inactive" : "active";
    updateUser(login.id, { status: next });
    toast({
      title: next === "active" ? "User activated" : "User deactivated",
      description: `${member.name} is now ${next}.`,
    });
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Team & users"
        description="Manage everyone in your company — invite members, assign roles and control access."
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {companyMembers.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Area access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <UsersIcon className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No users match your search.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((member) => {
                const isSelf = member.id === currentUser?.id;
                const login = member.localUser;
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                          {initials(member.name)}
                        </div>
                        <span className="font-medium">
                          {member.name}
                          {isSelf ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>
                          ) : null}
                          {!login ? (
                            <span className="ml-2 inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Read-only · Login only
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      <RoleBadge role={member.role} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {login ? areaScopeSummary(login.areaScope, areas) : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={member.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.createdAt ? formatDate(member.createdAt) : "—"}
                    </TableCell>
                    <TableCell>
                      {login ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(member)}>
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isSelf}
                              onClick={() => toggleStatus(member)}
                              className={
                                member.status === "active"
                                  ? "text-destructive focus:text-destructive"
                                  : ""
                              }
                            >
                              <Power className="h-4 w-4" />
                              {member.status === "active" ? "Deactivate" : "Activate"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-xs text-muted-foreground">Read-only</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        user={editing}
      />
    </DashboardLayout>
  );
}
