import { useNavigate, useParams, Navigate } from "react-router-dom";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useApp } from "@/context/AppContext";
import { MockDataNotice } from "@/components/crm/MockDataNotice";
import { AutomationCenterReference } from "@/components/crm/AutomationCenterReference";
import { CrmSettingsSection } from "@/components/crm/settings/CrmSettingsSection";
import {
  REQUEST_CRM_SETTINGS_TABS,
  REQUEST_CRM_DEFAULT_SETTINGS_TAB,
  REQUEST_CRM_SETTINGS_BASE_PATH,
  getRequestCrmSettingsTab,
} from "@/lib/requestCrm/settingsTabs";
import { REQUEST_CRM_SETTINGS_VIEW_PERMISSION } from "@/lib/requestCrm/settingsNav";
import { ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW } from "@/lib/featureFlags";

/**
 * REQUEST CRM Settings Shell (Slice 0).
 *
 * A feature-flagged, shared-admin-only, read-only settings shell at
 * `/crm/settings(/:tab)`. It renders eleven mock/read-only settings sections and
 * keeps the Automation & AI Center source-of-truth boundary visible throughout.
 *
 * Route access is gated by `ProtectedRoute` (flags + role + permission) in
 * `App.tsx`. This component adds a defensive permission check so a direct mount
 * still fails closed, matching the existing settings-module pattern.
 */
export default function CrmSettings() {
  const { hasPermission } = useApp();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams<{ tab?: string }>();

  if (!hasPermission(REQUEST_CRM_SETTINGS_VIEW_PERMISSION)) return <AccessDenied />;

  // Unknown deep-link slug → fall back to the base settings route.
  if (tabParam && !getRequestCrmSettingsTab(tabParam)) {
    return <Navigate to={REQUEST_CRM_SETTINGS_BASE_PATH} replace />;
  }

  const activeTabId = getRequestCrmSettingsTab(tabParam)?.id ?? REQUEST_CRM_DEFAULT_SETTINGS_TAB;
  const quickReviewEnabled = ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW;

  const handleTabChange = (value: string) => {
    navigate(`${REQUEST_CRM_SETTINGS_BASE_PATH}/${value}`);
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="REQUEST CRM Settings"
        description="Configure the categories, types, statuses, labels and policy references that future REQUEST CRM surfaces will reuse. This is a read-only Slice 0 shell."
        action={
          <div className="flex flex-wrap items-center gap-1.5" data-testid="crm-settings-badges">
            <Badge variant="outline" className="border-sky-200 bg-sky-50 font-medium text-sky-700">
              Mock
            </Badge>
            <Badge
              variant="outline"
              className="border-border bg-muted font-medium text-muted-foreground"
            >
              Read-only
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 font-medium text-amber-700"
            >
              Slice 0
            </Badge>
          </div>
        }
      />

      <div className="space-y-4">
        <MockDataNotice />
        <AutomationCenterReference />

        <Tabs value={activeTabId} onValueChange={handleTabChange} className="w-full">
          <TabsList
            data-testid="crm-settings-tabs"
            className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1"
          >
            {REQUEST_CRM_SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {tab.shortLabel}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {REQUEST_CRM_SETTINGS_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="mt-5">
              <CrmSettingsSection tab={tab} quickReviewEnabled={quickReviewEnabled} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
