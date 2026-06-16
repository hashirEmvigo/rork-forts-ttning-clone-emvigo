import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Archive, Blocks, Box, ClipboardList, Clock, Compass, FolderTree, GitCompare, History, Images, Languages, MapPin, ShieldCheck, SlidersHorizontal, Timer, Hourglass, Wallet } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { RolesPanel } from "@/components/roles/RolesPanel";
import { SuperAdminRolesView } from "@/components/roles/SuperAdminRolesView";
import { CompanyUsersPanel } from "@/components/roles/CompanyUsersPanel";
import { ModulesPanel } from "@/components/modules/ModulesPanel";
import { PlatformModulesPanel } from "@/components/modules/PlatformModulesPanel";
import { CategoriesPanel } from "@/components/modules/CategoriesPanel";
import { ChecklistSettingsOverview } from "@/components/settings/ChecklistSettingsOverview";
import { CompanySetupPanel } from "@/components/settings/CompanySetupPanel";
import { ServicesPanel } from "@/components/settings/ServicesPanel";
import { TimeCodesPanel } from "@/components/settings/TimeCodesPanel";
import { PayrollExportPanel } from "@/components/settings/PayrollExportPanel";
import { WorkOrderSettingsPanel } from "@/components/settings/WorkOrderSettingsPanel";
import { AOSettingsPanel } from "@/components/settings/AOSettingsPanel";
import { TimeReportSettingsPanel } from "@/components/settings/TimeReportSettingsPanel";
import { TimeSettingsPanel } from "@/components/settings/TimeSettingsPanel";
import { CustomerAssignmentPanel } from "@/components/settings/CustomerAssignmentPanel";
import { EmployeeLanguagesPanel } from "@/components/settings/EmployeeLanguagesPanel";
import { AuditLogPanel } from "@/components/audit/AuditLogPanel";
import { NavigationMenuPanel } from "@/components/settings/NavigationMenuPanel";
import { EntitlementValidationPanel } from "@/components/settings/EntitlementValidationPanel";
import { EntitlementResolverCutoverPanel } from "@/components/settings/EntitlementResolverCutoverPanel";
import { AccessDenied } from "@/components/AccessDenied";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "@/components/navigation/PageMenuTiles";
import { useApp } from "@/context/AppContext";
import { selectCompanyRoles } from "@/lib/companyRoleSeed";
import {
  COMPANY_MEDIA_LIBRARY_SETTINGS_PATH,
  shouldShowCompanyMediaLibrarySettingsNav,
} from "@/lib/assets/companyMediaSettingsNav";

export default function Settings() {
  const { currentUser, roles, hasPermission } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get("tab") ?? "roles";
  const setActiveTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };

  const isSuperAdmin = currentUser?.role === "super_admin";
  const companyId = currentUser?.companyId ?? null;
  const showCompanySetup = !isSuperAdmin && Boolean(companyId);
  const showWorkOrders = !isSuperAdmin && Boolean(companyId);
  const showAO = !isSuperAdmin && Boolean(companyId);
  const showTimeReporting = !isSuperAdmin && Boolean(companyId);
  const showTime = !isSuperAdmin && Boolean(companyId);
  const showAssignment = !isSuperAdmin && Boolean(companyId);
  const showEmployeeSettings = !isSuperAdmin && Boolean(companyId);
  const showMediaLibrary = shouldShowCompanyMediaLibrarySettingsNav(currentUser?.role, hasPermission) && Boolean(companyId);
  const showNavigation = isSuperAdmin && hasPermission("navigation.manage");
  const showServices = hasPermission("services.manage");
  const showTimeCodes = hasPermission("settings.timecodes.view");
  const showPayrollExport = hasPermission("payroll.export.view");
  // Super Admin manages checklist configuration exclusively through
  // Checklist Manager → Checklist Configuration, so it is hidden here to
  // avoid a duplicate navigation surface. Company Admin keeps it.
  const showChecklists = !isSuperAdmin && hasPermission("checklists.settings.view");

  const companyRoles = useMemo(
    () => selectCompanyRoles(roles, currentUser?.companyId ?? null),
    [roles, currentUser?.companyId],
  );

  if (!hasPermission("settings.manage")) return <AccessDenied />;

  const canManageRoles = hasPermission("roles.manage");

  // Page-level menu uses the shared icon-above-label tile standard (Slice 11D).
  // Labels are kept short so tiles stay equal-sized and never distort on wide
  // screens; the JSX order below is preserved exactly. Permission/role gating is
  // unchanged — each tile only appears when its existing `show*` flag is true.
  const tabItems: PageMenuTileItem[] = [
    { value: "roles", label: "Roles", icon: ShieldCheck },
    { value: "modules", label: "Modules", icon: Blocks },
    ...(showChecklists ? [{ value: "checklists", label: "Checklists", icon: ClipboardList }] : []),
    ...(showServices ? [{ value: "services", label: "Services", icon: Box }] : []),
    ...(showMediaLibrary ? [{ value: "media_library", label: "Media Library", icon: Images }] : []),
    ...(showTimeCodes ? [{ value: "time_codes", label: "Time Codes", icon: Hourglass }] : []),
    ...(showPayrollExport ? [{ value: "payroll_export", label: "Payroll", icon: Wallet }] : []),
    ...(showWorkOrders ? [{ value: "work_orders", label: "Work Orders", icon: ClipboardList }] : []),
    ...(showAO ? [{ value: "ao", label: "AO", icon: Archive }] : []),
    ...(showTimeReporting ? [{ value: "time_reporting", label: "Time Reporting", icon: Timer }] : []),
    ...(showTime ? [{ value: "time", label: "Time", icon: Clock }] : []),
    ...(showAssignment ? [{ value: "assignment", label: "Assignment", icon: MapPin }] : []),
    ...(showEmployeeSettings ? [{ value: "employee_settings", label: "Employees", icon: Languages }] : []),
    ...(showCompanySetup ? [{ value: "setup", label: "Setup", icon: SlidersHorizontal }] : []),
    ...(isSuperAdmin ? [{ value: "categories", label: "Categories", icon: FolderTree }] : []),
    ...(showNavigation ? [{ value: "navigation", label: "Menus", icon: Compass }] : []),
    { value: "audit", label: "Audit", icon: History },
    ...(isSuperAdmin ? [{ value: "entitlement_validation", label: "Entitlements", icon: GitCompare }] : []),
  ];

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Settings"
        description="Configure your workspace. Manage who can access what across the platform."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageMenuTiles items={tabItems} ariaLabel="Settings sections" testId="settings-menu-tiles" />

        <TabsContent value="roles" className="mt-5">
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Roles &amp; Permissions</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {isSuperAdmin
                    ? "Manage global role templates and review every role across all companies."
                    : "Create roles, choose what each can access, and assign people to them."}
                </p>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {!canManageRoles ? (
                <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  You don't have permission to manage roles.
                </p>
              ) : isSuperAdmin ? (
                <SuperAdminRolesView />
              ) : (
                <div className="space-y-8">
                  <RolesPanel roles={companyRoles} companyId={currentUser?.companyId ?? null} editable />
                  <div className="border-t border-border pt-6">
                    <CompanyUsersPanel />
                  </div>
                </div>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="modules" className="mt-5">
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Blocks className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Modules</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {isSuperAdmin
                    ? "Control which modules exist platform-wide and which each company can use."
                    : "Switch on the modules your company has been given access to."}
                </p>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {isSuperAdmin ? (
                <PlatformModulesPanel />
              ) : currentUser?.companyId ? (
                <ModulesPanel companyId={currentUser.companyId} />
              ) : (
                <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  Modules are managed per company.
                </p>
              )}
            </div>
          </section>
        </TabsContent>

        {showChecklists ? (
        <TabsContent value="checklists" className="mt-5">
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ClipboardList className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Checklist Configuration</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Configure the structure and categories used when building checklist
                  libraries, templates and protocols. This is not for creating checklists
                  directly — it manages the reusable configuration behind checklist creation.
                </p>
              </div>
            </div>
            <div className="px-5 py-5 sm:px-6">
              <ChecklistSettingsOverview />
            </div>
          </section>
        </TabsContent>
        ) : null}

        {showServices ? (
          <TabsContent value="services" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Box className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Services</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {isSuperAdmin
                      ? "Manage the universal service catalog, categories and reusable packages."
                      : "Manage your company's service catalog and categories, or start from a package."}
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <ServicesPanel />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showMediaLibrary ? (
          <TabsContent value="media_library" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Images className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Media Library</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Manage company media and view global assets made available by Super Admin.
                  </p>
                </div>
              </div>
              <div className="space-y-4 px-5 py-5 sm:px-6">
                <p className="text-sm text-muted-foreground">
                  Opens the company media workspace with separate Global library and Company library sections.
                </p>
                <Link
                  to={COMPANY_MEDIA_LIBRARY_SETTINGS_PATH}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Open Media Library
                </Link>
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showTimeCodes ? (
          <TabsContent value="time_codes" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Hourglass className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Time Codes</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {isSuperAdmin
                      ? "Own the platform master library of payroll time codes (attendance & absence). These power salary basis, payroll exports and attendance reporting."
                      : "Review the payroll time codes available to assign to your services. The master library is managed by the platform."}
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <TimeCodesPanel />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showPayrollExport ? (
          <TabsContent value="payroll_export" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Payroll Export</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {isSuperAdmin
                      ? "Activate which payroll export types each company can use. The export layer is adapter-based, so integrations are added per type without changing payroll calculation."
                      : "Configure export profiles for the payroll export types enabled for your company."}
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <PayrollExportPanel />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showWorkOrders && companyId ? (
          <TabsContent value="work_orders" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Work Orders</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Control automatic Work Order cleanup and archiving so your daily workflow
                    stays focused on active, relevant work.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <WorkOrderSettingsPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showAO && companyId ? (
          <TabsContent value="ao" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Archive className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">AO</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Operational settings for Work Order services, including how they move
                    through their lifecycle towards archival.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <AOSettingsPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showTimeReporting && companyId ? (
          <TabsContent value="time_reporting" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Timer className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Time Reporting</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Decide whether employee time reports are approved automatically and how
                    much deviation from the scheduled time is tolerated before an
                    administrator must review them.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <TimeReportSettingsPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showTime && companyId ? (
          <TabsContent value="time" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Time</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Manage the Quick Duration presets used to fill planned end times from a start
                    time across the app. Presets are stored in minutes.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <TimeSettingsPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showAssignment && companyId ? (
          <TabsContent value="assignment" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Customer / Employee Assignment</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Manage the structured operational areas customers belong to. Areas
                    are the foundation for future automatic assignment rules,
                    scheduling and reporting.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <CustomerAssignmentPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showEmployeeSettings && companyId ? (
          <TabsContent value="employee_settings" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Languages className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Employee Settings</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Controlled options that power employee fields. Start with the
                    languages employees can be assigned — the foundation for future
                    multilingual checklists, notifications and portal content.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <EmployeeLanguagesPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showCompanySetup && companyId ? (
          <TabsContent value="setup" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Company Setup</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Start your company's settings from a template or from scratch. Copied
                    settings become yours to edit — template changes won't affect them.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <CompanySetupPanel companyId={companyId} />
              </div>
            </section>
          </TabsContent>
        ) : null}

        <TabsContent value="audit" className="mt-5">
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <History className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Audit Log</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {isSuperAdmin
                    ? "A platform-wide trail of key actions across every company."
                    : "A trail of key actions taken within your company."}
                </p>
              </div>
            </div>
            <div className="px-5 py-5 sm:px-6">
              <AuditLogPanel />
            </div>
          </section>
        </TabsContent>

        {isSuperAdmin ? (
          <TabsContent value="entitlement_validation" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <GitCompare className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Entitlement Validation</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Real-data parity check between the legacy entitlement path and
                    the new bundle pipeline. Read-only — nothing is written and no
                    flag is changed.
                  </p>
                </div>
              </div>
              <div className="space-y-5 px-5 py-5 sm:px-6">
                <EntitlementResolverCutoverPanel />
                <EntitlementValidationPanel />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {showNavigation ? (
          <TabsContent value="navigation" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Compass className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Navigation &amp; Menus</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Rename, re-icon, reorder and show/hide menu items across the platform. Presentation only — the
                    permission system stays authoritative.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <NavigationMenuPanel />
              </div>
            </section>
          </TabsContent>
        ) : null}

        {isSuperAdmin ? (
          <TabsContent value="categories" className="mt-5">
            <section className="rounded-2xl border border-border bg-card">
              <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderTree className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Module Categories</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Group modules, set their order, and choose which user types each
                    category is visible for across every company.
                  </p>
                </div>
              </div>

              <div className="px-5 py-5 sm:px-6">
                <CategoriesPanel />
              </div>
            </section>
          </TabsContent>
        ) : null}
      </Tabs>
    </DashboardLayout>
  );
}
