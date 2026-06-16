import { useMemo, useState } from "react";
import { Clock, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { TimeCodeDialog } from "@/components/settings/TimeCodeDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { sortTimeCodes } from "@/lib/timeCodeResolver";
import { TIME_CODE_TYPE_LABELS } from "@/types";
import type { TimeCode, TimeCodeType } from "@/types";

type TypeFilter = "all" | TimeCodeType;
type StatusFilter = "all" | "active" | "inactive";

/**
 * Settings → Time Codes. Lists the platform master library, with create, edit,
 * activate/deactivate, search and filtering. Super Admin manages the library;
 * company admins get a read-only view (used to understand assignments).
 */
export function TimeCodesPanel() {
  const {
    timeCodes,
    canManageTimeCodes,
    getTimeCodeUsageCount,
    getServicesForTimeCode,
    setTimeCodeActive,
    deleteTimeCode,
  } = useApp();
  const { toast } = useToast();

  const canManage = canManageTimeCodes();

  const [query, setQuery] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<TimeCode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimeCode | null>(null);

  const debouncedQuery = useDebouncedValue(query, 250);

  const visible = useMemo<TimeCode[]>(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return timeCodes
      .filter((t) => {
        if (typeFilter !== "all" && t.type !== typeFilter) return false;
        if (statusFilter === "active" && !t.active) return false;
        if (statusFilter === "inactive" && t.active) return false;
        if (!q) return true;
        return (
          t.code.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          (t.description?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort(sortTimeCodes);
  }, [timeCodes, debouncedQuery, typeFilter, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (timeCode: TimeCode) => {
    setEditing(timeCode);
    setDialogOpen(true);
  };

  const handleToggle = async (timeCode: TimeCode, active: boolean) => {
    // Authoritative: the Switch only flips once the directory refetch confirms
    // the Supabase write — a failed write leaves the row (and toggle) unchanged.
    const result = await setTimeCodeActive(timeCode.id, active);
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const result = await deleteTimeCode(pendingDelete.id);
    if (!result.ok) {
      toast({ title: "Couldn't delete", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Time code deleted", description: `${pendingDelete.code} — ${pendingDelete.name} removed.` });
    }
    setPendingDelete(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search code, name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="attendance">Attendance</SelectItem>
              <SelectItem value="absence">Absence</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage ? (
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4" /> New time code
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 py-16 text-center text-muted-foreground">
          <Clock className="h-8 w-8 opacity-40" />
          <p className="text-sm">No time codes match your filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-24 text-center">Usage</TableHead>
                <TableHead className="w-28">Status</TableHead>
                {canManage ? <TableHead className="w-28 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((tc) => {
                const usage = getTimeCodeUsageCount(tc.id);
                const services = getServicesForTimeCode(tc.id);
                const inUse = usage > 0;
                return (
                  <TableRow key={tc.id}>
                    <TableCell className="font-mono text-sm font-medium">{tc.code}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{tc.name}</span>
                        {tc.description ? (
                          <span className="text-xs text-muted-foreground">{tc.description}</span>
                        ) : null}
                        {tc.systemManaged ? (
                          <span className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                            System managed
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={tc.type === "attendance" ? "default" : "secondary"}>
                        {TIME_CODE_TYPE_LABELS[tc.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {inUse ? (
                        <span
                          className="text-sm"
                          title={services.map((s) => s.name).join(", ")}
                        >
                          {usage} service{usage === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={tc.active}
                            onCheckedChange={(v) => handleToggle(tc, v)}
                            aria-label={tc.active ? "Deactivate" : "Activate"}
                          />
                          <span className="text-xs text-muted-foreground">
                            {tc.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                      ) : (
                        <Badge variant={tc.active ? "outline" : "secondary"}>
                          {tc.active ? "Active" : "Inactive"}
                        </Badge>
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(tc)}
                            aria-label="Edit time code"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={tc.systemManaged || inUse}
                            title={
                              tc.systemManaged
                                ? "System-managed codes can't be deleted. Deactivate instead."
                                : inUse
                                  ? "In use by services. Deactivate instead."
                                  : "Delete time code"
                            }
                            onClick={() => setPendingDelete(tc)}
                            aria-label="Delete time code"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <TimeCodeDialog open={dialogOpen} onOpenChange={setDialogOpen} timeCode={editing} />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this time code?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.code} — ${pendingDelete.name}" will be permanently removed. This can't be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
