import { Link, useLocation } from "react-router-dom";
import { ClipboardCheck, Globe, Library, ScrollText, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";

interface ChecklistTab {
  label: string;
  to: string;
  icon: LucideIcon;
}

/** Sub-navigation between the Checklist Manager's main sections. */
export function ChecklistTabs() {
  const location = useLocation();
  const { hasPermission, currentUser } = useApp();
  const isSuperAdmin = currentUser?.role === "super_admin";

  const tabs: ChecklistTab[] = [
    { label: "Templates", to: "/modules/checklist-manager", icon: ClipboardCheck },
    { label: "Libraries", to: "/modules/checklist-manager/libraries", icon: Library },
  ];
  if (isSuperAdmin) {
    // Platform-level checklist configuration lives together under Checklist Manager.
    if (hasPermission("global_templates.view")) {
      tabs.push({ label: "Global Templates", to: "/global-templates", icon: Globe });
    }
    if (hasPermission("checklists.settings.view")) {
      tabs.push({ label: "Checklist Configuration", to: "/settings/checklists", icon: SlidersHorizontal });
    }
  } else if (hasPermission("customer_protocols.view")) {
    // Customer Protocols are company-level operational data — company users only.
    tabs.push({
      label: "Customer Protocols",
      to: "/modules/checklist-manager/protocols",
      icon: ScrollText,
    });
  }
  return (
    <div className="mb-6 inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
      {tabs.map((tab) => {
        const active =
          tab.to === "/modules/checklist-manager"
            ? location.pathname === tab.to ||
              location.pathname.startsWith("/modules/checklist-manager/templates")
            : location.pathname.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
