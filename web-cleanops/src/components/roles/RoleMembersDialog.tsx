import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RoleBadge } from "@/components/RoleBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { initials } from "@/lib/format";
import type { AssignedUser } from "@/lib/assignedUsersRoster";

interface RoleMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the role whose members are listed. */
  roleName: string;
  /** Members holding this role, sourced from the assigned-user roster. */
  members: AssignedUser[];
}

/**
 * Read-only list of the people who hold a given role. Members come from the same
 * assigned-user roster that powers the role-card counts, so what's shown here
 * always matches the count on the card. Pure presentation — it changes no role,
 * permission, or membership data.
 */
export function RoleMembersDialog({
  open,
  onOpenChange,
  roleName,
  members,
}: RoleMembersDialogProps) {
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{roleName} members</DialogTitle>
          <DialogDescription>
            {members.length === 0
              ? "No one holds this role yet."
              : `${members.length} ${members.length === 1 ? "person holds" : "people hold"} this role.`}
          </DialogDescription>
        </DialogHeader>

        {members.length > 0 ? (
          <div className="border-b border-border px-6 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search people…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        ) : null}

        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-6 py-10 text-center text-sm text-muted-foreground">
              {members.length === 0
                ? "No members to show."
                : "No members match your search."}
            </li>
          ) : (
            filtered.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-6 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {initials(member.name)}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email || "No email"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RoleBadge role={member.role} />
                  <StatusBadge status={member.status} />
                </div>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
