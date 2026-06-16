import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsTemplateDialog } from "@/components/settings/SettingsTemplateDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { SETTINGS_CATEGORIES } from "@/types";
import type { SettingsData, SettingsTemplate } from "@/types";

/** Total number of configured values across every category. */
function countItems(data: SettingsData): number {
  return SETTINGS_CATEGORIES.reduce((sum, cat) => sum + data[cat.key].length, 0);
}

export default function SettingsTemplates() {
  const {
    settingsTemplates,
    hasPermission,
    setSettingsTemplateArchived,
    duplicateSettingsTemplate,
  } = useApp();
  const { toast } = useToast();
  const [query, setQuery] = useState<string>("");
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingsTemplate | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return settingsTemplates
      .filter((t) => (showArchived ? t.archived : !t.archived))
      .filter((t) => !q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
  }, [settingsTemplates, query, showArchived]);

  const activeCount = settingsTemplates.filter((t) => !t.archived).length;
  const archivedCount = settingsTemplates.filter((t) => t.archived).length;

  if (!hasPermission("settings_templates.manage")) return <AccessDenied />;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (template: SettingsTemplate) => {
    setEditing(template);
    setDialogOpen(true);
  };

  const toggleArchived = (template: SettingsTemplate) => {
    const result = setSettingsTemplateArchived(template.id, !template.archived);
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: template.archived ? "Template restored" : "Template archived",
      description: `${template.name} has been ${template.archived ? "restored" : "archived"}.`,
    });
  };

  const duplicate = (template: SettingsTemplate) => {
    const result = duplicateSettingsTemplate(template.id);
    if (!result.ok) {
      toast({ title: "Couldn't duplicate", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Template duplicated", description: `Created a copy of ${template.name}.` });
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Settings Templates"
        description="Global default settings companies can start from. Copies are independent — later edits here never change a company's own settings."
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New template
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search templates…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-border p-1">
          <Button
            type="button"
            variant={showArchived ? "ghost" : "secondary"}
            size="sm"
            onClick={() => setShowArchived(false)}
          >
            Active ({activeCount})
          </Button>
          <Button
            type="button"
            variant={showArchived ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowArchived(true)}
          >
            Archived ({archivedCount})
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-20 text-center text-muted-foreground">
          <SlidersHorizontal className="h-8 w-8 opacity-40" />
          <p className="text-sm">
            {showArchived ? "No archived templates." : "No settings templates yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((template) => (
            <div
              key={template.id}
              className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <SlidersHorizontal className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{template.name}</p>
                    {template.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {template.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(template)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => duplicate(template)}>
                      <Copy className="h-4 w-4" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => toggleArchived(template)}
                      className={template.archived ? "" : "text-destructive focus:text-destructive"}
                    >
                      {template.archived ? (
                        <>
                          <ArchiveRestore className="h-4 w-4" /> Restore
                        </>
                      ) : (
                        <>
                          <Archive className="h-4 w-4" /> Archive
                        </>
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {SETTINGS_CATEGORIES.filter((cat) => template.data[cat.key].length > 0).map((cat) => (
                  <Badge key={cat.key} variant="secondary" className="font-normal">
                    {cat.label} · {template.data[cat.key].length}
                  </Badge>
                ))}
                {countItems(template.data) === 0 ? (
                  <span className="text-xs text-muted-foreground">No default values yet.</span>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>{countItems(template.data)} values</span>
                <span>Updated {formatDate(template.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <SettingsTemplateDialog open={dialogOpen} onOpenChange={setDialogOpen} template={editing} />
    </DashboardLayout>
  );
}
