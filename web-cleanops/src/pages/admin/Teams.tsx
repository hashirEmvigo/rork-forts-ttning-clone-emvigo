import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2, Users2 } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { TeamDialog } from "@/components/teams/TeamDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { initials } from "@/lib/format";
import type { Employee, Team } from "@/types";

export default function Teams() {
  const { currentUser, teams, employees, deleteTeam } = useApp();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Team | null>(null);

  const companyId = currentUser?.companyId ?? "";

  const companyTeams = useMemo(
    () => teams.filter((t) => t.companyId === companyId),
    [teams, companyId],
  );

  const membersByTeam = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const e of employees) {
      if (e.companyId !== companyId) continue;
      for (const id of e.teamIds) {
        const list = map.get(id) ?? [];
        list.push(e);
        map.set(id, list);
      }
    }
    return map;
  }, [employees, companyId]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (team: Team) => {
    setEditing(team);
    setDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteTeam(pendingDelete.id);
    toast({ title: "Team deleted", description: `${pendingDelete.name} has been removed.` });
    setPendingDelete(null);
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Teams"
        description="Internal employee groups and departments. Teams contain employees only — never customers."
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New team
          </Button>
        }
      />

      {companyTeams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Users2 className="h-8 w-8 opacity-40" />
            <p className="text-sm">No teams yet. Create your first team to organise staff.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {companyTeams.map((team) => {
            const members = membersByTeam.get(team.id) ?? [];
            return (
              <div key={team.id} className="flex flex-col rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Users2 className="h-4 w-4" />
                    </div>
                    <div className="leading-tight">
                      <p className="text-sm font-semibold">{team.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {members.length} {members.length === 1 ? "member" : "members"}
                      </p>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(team)}>
                        <Pencil className="h-4 w-4" /> Edit team
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setPendingDelete(team)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" /> Delete team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {team.description ? (
                  <p className="mt-3 text-sm text-muted-foreground">{team.description}</p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {members.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No employees assigned yet.
                    </span>
                  ) : (
                    members.map((m) => (
                      <span
                        key={m.id}
                        className="flex items-center gap-1.5 rounded-full border border-border bg-secondary py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-secondary-foreground"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[9px]">
                          {initials(m.name)}
                        </span>
                        {m.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TeamDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        team={editing}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This team will be removed and unlinked from its employees. Employees themselves
              are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
