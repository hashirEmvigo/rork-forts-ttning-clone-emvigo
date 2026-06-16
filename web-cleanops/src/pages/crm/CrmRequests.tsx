import { useMemo, useState } from "react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { MockDataNotice } from "@/components/crm/MockDataNotice";
import { AutomationCenterReference } from "@/components/crm/AutomationCenterReference";
import { CrmShellNav } from "@/components/crm/CrmShellNav";
import { RequestListFilters } from "@/components/crm/RequestListFilters";
import { RequestListTable } from "@/components/crm/RequestListTable";
import { RequestDetailSheet } from "@/components/crm/RequestDetailSheet";
import { RequestCreateSheet } from "@/components/crm/RequestCreateSheet";
import { REQUEST_CRM_REQUESTS } from "@/lib/requestCrm/mockData";
import { REQUEST_CRM_VIEW_PERMISSION } from "@/lib/requestCrm/shellNav";
import {
  DEFAULT_REQUEST_LIST_FILTERS,
  filterAndSortRequests,
  type RequestListFilterState,
} from "@/lib/requestCrm/requestListFilters";
import type { RequestListRow } from "@/lib/requestCrm/types";

/**
 * REQUEST CRM Request List shell (Slice 0 / TICKET-003B).
 *
 * A feature-flagged, shared-admin-only request list at `/crm/requests`. Search,
 * filter, sorting and manual-create draft capture update LOCAL view state only —
 * the mock rows live in an in-`src` fixture and nothing is fetched or mutated. Route
 * access is gated by `ProtectedRoute` (flags + role + permission) in `App.tsx`;
 * this component adds a defensive permission check so a direct mount still fails
 * closed.
 */
export default function CrmRequests() {
  const { currentUser, hasPermission } = useApp();
  const [filters, setFilters] = useState<RequestListFilterState>(DEFAULT_REQUEST_LIST_FILTERS);
  const [selectedRow, setSelectedRow] = useState<RequestListRow | null>(null);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);

  const rows = useMemo(() => filterAndSortRequests(REQUEST_CRM_REQUESTS, filters), [filters]);
  const canUseManualCreate = currentUser?.role === "company_admin";

  if (!hasPermission(REQUEST_CRM_VIEW_PERMISSION)) return <AccessDenied />;

  const handleChange = (patch: Partial<RequestListFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleReset = () => setFilters(DEFAULT_REQUEST_LIST_FILTERS);

  return (
    <DashboardLayout wide>
      <PageHeader
        title="REQUEST CRM Requests"
        description="A frontend/mock operational list. Filters, previews and manual-create draft capture only change local UI state — no request is persisted."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap items-center gap-1.5" data-testid="crm-requests-badges">
              <Badge variant="outline" className="border-sky-200 bg-sky-50 font-medium text-sky-700">
                Mock
              </Badge>
              <Badge variant="outline" className="border-border bg-muted font-medium text-muted-foreground">
                Local-only
              </Badge>
              <Badge variant="outline" className="border-amber-200 bg-amber-50 font-medium text-amber-700">
                Foundation
              </Badge>
            </div>
            {canUseManualCreate ? (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => setCreateSheetOpen(true)}
                data-testid="crm-request-create-button"
              >
                <Plus className="h-3.5 w-3.5" />
                Create request
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4" data-testid="crm-requests">
        <CrmShellNav />
        <MockDataNotice />
        <AutomationCenterReference compact />

        <RequestListFilters filters={filters} onChange={handleChange} onReset={handleReset} />

        <p className="text-sm text-muted-foreground" data-testid="crm-request-count">
          Showing {rows.length} of {REQUEST_CRM_REQUESTS.length} mock requests
        </p>

        <RequestListTable rows={rows} onPreview={setSelectedRow} />
      </div>

      <RequestDetailSheet
        row={selectedRow}
        open={selectedRow !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedRow(null);
        }}
      />
      <RequestCreateSheet open={createSheetOpen} onOpenChange={setCreateSheetOpen} />
    </DashboardLayout>
  );
}
