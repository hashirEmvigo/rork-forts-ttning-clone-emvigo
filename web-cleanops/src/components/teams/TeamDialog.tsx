import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { Team } from "@/types";

interface TeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  team?: Team | null;
}

/** Create or edit an internal team. Membership is managed from the employee profile. */
export function TeamDialog({ open, onOpenChange, companyId, team }: TeamDialogProps) {
  const { createTeam, updateTeam } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [error, setError] = useState<string>("");
  const isEdit = Boolean(team);

  useEffect(() => {
    if (open) {
      setName(team?.name ?? "");
      setDescription(team?.description ?? "");
      setError("");
    }
  }, [open, team]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) return;

    const result = team
      ? updateTeam(team.id, { name: name.trim(), description: description.trim() || undefined })
      : createTeam({ companyId, name: name.trim(), description: description.trim() || undefined });

    if (!result.ok) {
      setError(result.error ?? "Unable to save team.");
      return;
    }
    toast({
      title: isEdit ? "Team updated" : "Team created",
      description: `${name.trim()} has been saved.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit team" : "New team"}</DialogTitle>
            <DialogDescription>
              Internal company group. Add employees to it from their profiles.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                placeholder="e.g. Cleaning Team"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="team-desc">Description</Label>
              <Textarea
                id="team-desc"
                placeholder="What this team is responsible for…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create team"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
