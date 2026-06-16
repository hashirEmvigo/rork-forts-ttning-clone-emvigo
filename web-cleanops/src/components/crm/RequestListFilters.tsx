/**
 * REQUEST CRM request list — read-only filter controls (Slice 0).
 *
 * A controlled component: it renders the search box, selects, toggles and sort
 * control, and emits filter-state patches to the parent. It performs NO data
 * fetching and NO mutations — it only ever updates local view state, exactly as
 * the UI filter/sort spec requires for Slice 0.
 */
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REQUEST_STATUS_OPTIONS,
  REQUEST_PRIORITY_OPTIONS,
  REQUEST_SEVERITY_OPTIONS,
  REQUEST_SLA_OPTIONS,
  REQUEST_SOURCE_OPTIONS,
  REQUEST_SORT_OPTIONS,
  hasActiveRequestFilters,
  type RequestListFilterState,
} from "@/lib/requestCrm/requestListFilters";
import { REQUEST_CRM_CATEGORIES, REQUEST_CRM_OWNERS } from "@/lib/requestCrm/mockData";

interface RequestListFiltersProps {
  filters: RequestListFilterState;
  onChange: (patch: Partial<RequestListFilterState>) => void;
  onReset: () => void;
}

interface FilterSelectProps {
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  testId?: string;
  extraOptions?: { value: string; label: string }[];
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onValueChange,
  testId,
  extraOptions,
}: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9" data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allLabel}</SelectItem>
          {extraOptions?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RequestListFilters({ filters, onChange, onReset }: RequestListFiltersProps) {
  const categoryOptions = REQUEST_CRM_CATEGORIES.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const ownerOptions = Object.entries(REQUEST_CRM_OWNERS).map(([value, label]) => ({
    value,
    label,
  }));

  const showClear = hasActiveRequestFilters(filters);

  return (
    <div
      data-testid="crm-request-filters"
      className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="crm-request-search"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="Search by number, title, owner or customer"
            className="h-9 pl-9"
            aria-label="Search requests"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Sort
          </Label>
          <Select
            value={filters.sort}
            onValueChange={(value) =>
              onChange({ sort: value as RequestListFilterState["sort"] })
            }
          >
            <SelectTrigger className="h-9 w-[180px]" data-testid="crm-request-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-auto h-9 gap-1.5"
            onClick={onReset}
            data-testid="crm-request-clear-filters"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <FilterSelect
          label="Status"
          allLabel="All statuses"
          value={filters.status}
          options={REQUEST_STATUS_OPTIONS}
          onValueChange={(value) =>
            onChange({ status: value as RequestListFilterState["status"] })
          }
          testId="crm-request-filter-status"
        />
        <FilterSelect
          label="Priority"
          allLabel="All priorities"
          value={filters.priority}
          options={REQUEST_PRIORITY_OPTIONS}
          onValueChange={(value) =>
            onChange({ priority: value as RequestListFilterState["priority"] })
          }
          testId="crm-request-filter-priority"
        />
        <FilterSelect
          label="Severity"
          allLabel="All severities"
          value={filters.severity}
          options={REQUEST_SEVERITY_OPTIONS}
          onValueChange={(value) =>
            onChange({ severity: value as RequestListFilterState["severity"] })
          }
          testId="crm-request-filter-severity"
        />
        <FilterSelect
          label="Category"
          allLabel="All categories"
          value={filters.categoryId}
          options={categoryOptions}
          onValueChange={(value) => onChange({ categoryId: value })}
          testId="crm-request-filter-category"
        />
        <FilterSelect
          label="Owner"
          allLabel="All owners"
          value={filters.ownerAdminId}
          options={ownerOptions}
          extraOptions={[{ value: "unassigned", label: "Unassigned" }]}
          onValueChange={(value) =>
            onChange({ ownerAdminId: value as RequestListFilterState["ownerAdminId"] })
          }
          testId="crm-request-filter-owner"
        />
        <FilterSelect
          label="Source"
          allLabel="All sources"
          value={filters.source}
          options={REQUEST_SOURCE_OPTIONS}
          onValueChange={(value) =>
            onChange({ source: value as RequestListFilterState["source"] })
          }
          testId="crm-request-filter-source"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
        <FilterSelect
          label="SLA"
          allLabel="All SLA states"
          value={filters.slaState}
          options={REQUEST_SLA_OPTIONS}
          onValueChange={(value) =>
            onChange({ slaState: value as RequestListFilterState["slaState"] })
          }
          testId="crm-request-filter-sla"
        />
        <div className="mt-auto flex items-center gap-2">
          <Switch
            id="crm-filter-unread"
            checked={filters.onlyUnreadExternal}
            onCheckedChange={(checked) => onChange({ onlyUnreadExternal: checked })}
            data-testid="crm-request-filter-unread"
          />
          <Label htmlFor="crm-filter-unread" className="text-sm text-foreground">
            Unread external only
          </Label>
        </div>
        <div className="mt-auto flex items-center gap-2">
          <Switch
            id="crm-filter-automation"
            checked={filters.onlyAutomationLinked}
            onCheckedChange={(checked) => onChange({ onlyAutomationLinked: checked })}
            data-testid="crm-request-filter-automation"
          />
          <Label htmlFor="crm-filter-automation" className="text-sm text-foreground">
            Automation linked only
          </Label>
        </div>
      </div>
    </div>
  );
}
