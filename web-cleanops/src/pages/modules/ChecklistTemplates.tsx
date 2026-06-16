import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ClipboardCheck,
  Copy,
  Globe,
  Layers,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  SquareStack,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "@/components/navigation/PageMenuTiles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TemplateDialog } from "@/components/checklist/TemplateDialog";
import { ChecklistTabs } from "@/components/checklist/ChecklistTabs";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import type { ChecklistTemplate } from "@/types";

/**
 * Page-level section menu (Slice 11E) — shared icon-above-label tile standard.
 * Shown to company admins (Super Admin sees the global grid instead). Tab
 * values/content unchanged.
 */
const TEMPLATE_TAB_ITEMS: PageMenuTileItem[] = [
  { value: "own", label: "My Templates", icon: ClipboardCheck },
  { value: "available", label: "Available", icon: Globe },
];

/** Returns counts of floors, rooms and tasks within a template. */
function templateStats(t: ChecklistTemplate): { floors: number; rooms: number; tasks: number } {
  const floors = t.floors ?? [];
  const rooms = floors.reduce((sum, f) => sum + (f.rooms?.length ?? 0), 0);
  const tasks = floors.reduce(
    (sum, f) => sum + (f.rooms ?? []).reduce((s, r) => s + (r.tasks?.length ?? 0), 0),
    0,
  );
  return { floors: floors.length, rooms, tasks };
}

interface TemplateCardProps {
  template: ChecklistTemplate;
  editable: boolean;
  onOpen: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onToggleArchive?: () => void;
  /** When provided, shows a Clone button (company admins cloning a global template). */
  onClone?: () => void;
  /** When provided, shows an adopt toggle for company adoption of a global template. */
  adoption?: { enabled: boolean; onToggle: (next: boolean) => void };
}

function TemplateCard({
  template,
  editable,
  onOpen,
  onEdit,
  onToggleStatus,
  onToggleArchive,
  onClone,
  adoption,
}: TemplateCardProps) {
  const stats = templateStats(template);
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{template.name}</p>
            <p className="text-xs text-muted-foreground">
              Updated {formatDate(template.updatedAt)}
            </p>
          </div>
        </div>

        {editable && (onEdit || onToggleStatus || onToggleArchive) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit ? (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4" /> Edit details
                </DropdownMenuItem>
              ) : null}
              {onToggleStatus ? (
                <DropdownMenuItem onClick={onToggleStatus}>
                  <Power className="h-4 w-4" />
                  {template.status === "active" ? "Deactivate" : "Activate"}
                </DropdownMenuItem>
              ) : null}
              {onToggleArchive ? (
                <DropdownMenuItem
                  onClick={onToggleArchive}
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
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {template.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{template.description}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={template.status} />
        <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {template.companyId === null ? "Global" : "Company"}
        </span>
        {template.archived ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <Archive className="h-3 w-3" /> Archived
          </span>
        ) : null}
        {template.companyId === null && template.availableToCompanies ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary">
            <Globe className="h-3 w-3" /> Available
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> {stats.floors} floors
        </span>
        <span className="inline-flex items-center gap-1.5">
          <SquareStack className="h-3.5 w-3.5" /> {stats.rooms} rooms
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" /> {stats.tasks} tasks
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onOpen}>
            {editable ? "Open editor" : "View structure"}
          </Button>
          {onClone ? (
            <Button variant="ghost" size="sm" onClick={onClone}>
              <Copy className="h-4 w-4" /> Clone
            </Button>
          ) : null}
        </div>
        {adoption ? (
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {adoption.enabled ? "Active for company" : "Activate"}
            <Switch
              checked={adoption.enabled}
              onCheckedChange={adoption.onToggle}
              aria-label="Activate template for company"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

export default function ChecklistTemplates() {
  const {
    currentUser,
    hasPermission,
    canAccessModule,
    getVisibleTemplates,
    canEditTemplate,
    updateTemplate,
    cloneTemplate,
    getTemplateAdoption,
    setTemplateAdopted,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);

  const isSuperAdmin = currentUser?.role === "super_admin";

  const visible = useMemo(
    () => (currentUser ? getVisibleTemplates(currentUser) : []),
    [currentUser, getVisibleTemplates],
  );

  // Access control beyond the UI: management requires the view permission, and
  // company users additionally need the module enabled for their company.
  if (!currentUser || !hasPermission("checklist_templates.view")) {
    return <AccessDenied />;
  }
  if (!isSuperAdmin && !canAccessModule(currentUser, "checklist-manager")) {
    return <AccessDenied />;
  }

  const ownTemplates = visible.filter((t) => t.companyId === currentUser.companyId);
  const availableTemplates = visible.filter((t) => t.companyId === null);

  const openEditor = (t: ChecklistTemplate) => navigate(`/modules/checklist-manager/templates/${t.id}`);

  const openEdit = (t: ChecklistTemplate) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const toggleStatus = (t: ChecklistTemplate) => {
    const next = t.status === "active" ? "inactive" : "active";
    updateTemplate(t.id, { status: next });
    toast({
      title: next === "active" ? "Template activated" : "Template deactivated",
      description: `${t.name} is now ${next}.`,
    });
  };

  const toggleArchive = (t: ChecklistTemplate) => {
    updateTemplate(t.id, { archived: !t.archived });
    toast({
      title: t.archived ? "Template restored" : "Template archived",
      description: `${t.name} has been ${t.archived ? "restored" : "archived"}.`,
    });
  };

  const cloneToCompany = (t: ChecklistTemplate) => {
    const result = cloneTemplate(t.id);
    if (!result.ok || !result.template) {
      toast({
        title: "Couldn't clone template",
        description: result.error ?? "Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Template cloned",
      description: `“${result.template.name}” is now an editable company template.`,
    });
    navigate(`/modules/checklist-manager/templates/${result.template.id}`);
  };

  const newTemplateButton = (
    <Button
      onClick={() => {
        setEditing(null);
        setDialogOpen(true);
      }}
    >
      <Plus className="h-4 w-4" /> New template
    </Button>
  );

  const emptyState = (label: string) => (
    <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ClipboardCheck className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-medium">{label}</p>
    </div>
  );

  return (
    <DashboardLayout wide>
      <ChecklistTabs />
      <PageHeader
        title="Checklist Templates"
        description={
          isSuperAdmin
            ? "Build global cleaning templates and make them available to companies."
            : "Manage your company's cleaning templates and adopt available global ones."
        }
        action={newTemplateButton}
      />

      {isSuperAdmin ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {availableTemplates.length === 0
            ? emptyState("No global templates yet. Create your first one.")
            : availableTemplates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  editable
                  onOpen={() => openEditor(t)}
                  onEdit={() => openEdit(t)}
                  onToggleStatus={() => toggleStatus(t)}
                  onToggleArchive={() => toggleArchive(t)}
                />
              ))}
        </div>
      ) : (
        <Tabs defaultValue="own" className="w-full">
          <PageMenuTiles items={TEMPLATE_TAB_ITEMS} ariaLabel="Template sections" testId="template-menu-tiles" />

          <TabsContent value="own" className="mt-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {ownTemplates.length === 0
                ? emptyState("No company templates yet. Create your first one.")
                : ownTemplates.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      editable={canEditTemplate(currentUser, t)}
                      onOpen={() => openEditor(t)}
                      onEdit={() => openEdit(t)}
                      onToggleStatus={() => toggleStatus(t)}
                      onToggleArchive={() => toggleArchive(t)}
                    />
                  ))}
            </div>
          </TabsContent>

          <TabsContent value="available" className="mt-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {availableTemplates.length === 0
                ? emptyState("No templates have been made available to your company yet.")
                : availableTemplates.map((t) => {
                    const adoption = currentUser.companyId
                      ? getTemplateAdoption(currentUser.companyId, t.id)
                      : undefined;
                    return (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        editable={false}
                        onOpen={() => openEditor(t)}
                        onClone={() => cloneToCompany(t)}
                        adoption={
                          currentUser.companyId
                            ? {
                                enabled: Boolean(adoption?.enabled),
                                onToggle: (next) =>
                                  setTemplateAdopted(currentUser.companyId as string, t.id, next),
                              }
                            : undefined
                        }
                      />
                    );
                  })}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={isSuperAdmin ? null : currentUser.companyId}
        template={editing}
        showAvailability={isSuperAdmin}
      />
    </DashboardLayout>
  );
}
