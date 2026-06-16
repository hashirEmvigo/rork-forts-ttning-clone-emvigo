/**
 * REQUEST CRM shell sub-navigation (Slice 0).
 *
 * A small read-only tab strip that links the REQUEST CRM workspace surfaces
 * (Dashboard, Requests, and — only when its own flag is on — Settings). It is
 * pure navigation: no data is fetched or mutated. The Settings link appears only
 * when the settings sub-shell is enabled so the two flags stay independent.
 */
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Inbox, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  REQUEST_CRM_DASHBOARD_PATH,
  REQUEST_CRM_REQUESTS_PATH,
} from "@/lib/requestCrm/shellNav";
import {
  REQUEST_CRM_SETTINGS_BASE_PATH,
  isRequestCrmSettingsShellEnabled,
} from "@/lib/requestCrm/settingsNav";

interface CrmShellNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export function CrmShellNav() {
  const items: CrmShellNavItem[] = [
    { to: REQUEST_CRM_DASHBOARD_PATH, label: "Dashboard", icon: LayoutDashboard },
    { to: REQUEST_CRM_REQUESTS_PATH, label: "Requests", icon: Inbox },
  ];

  if (isRequestCrmSettingsShellEnabled()) {
    items.push({ to: REQUEST_CRM_SETTINGS_BASE_PATH, label: "Settings", icon: Settings2 });
  }

  return (
    <nav
      data-testid="crm-shell-nav"
      className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1"
    >
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
