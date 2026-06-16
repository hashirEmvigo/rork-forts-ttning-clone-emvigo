/**
 * REQUEST CRM Settings Shell — tab registry (Slice 0, frontend only).
 *
 * Mirrors the registry-driven settings-shell precedent used by Checklist Manager
 * (`src/lib/checklistSettingsModules.ts`). This is a SHELL, not a rule builder:
 * each tab renders read-only rows sourced from the typed mock fixtures. A future
 * ticket can replace a single tab's body without touching routing or the shell.
 *
 * The eleven sections are fixed by `TICKET-003A`. `ownership` makes the
 * Automation & AI Center boundary explicit in the UI:
 *  - `local`          REQUEST CRM owns this domain data outright.
 *  - `central-linked` REQUEST CRM displays references to Automation & AI Center.
 *  - `central`        Owned centrally; REQUEST CRM is display-only.
 */
import {
  Bell,
  Bot,
  ClipboardList,
  Clock,
  Eye,
  FolderTree,
  Settings2,
  ShieldAlert,
  SignalHigh,
  CircleDot,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  RequestSettingsSectionId,
  RequestSettingsOwnership,
} from "@/lib/requestCrm/types";

export interface RequestCrmSettingsTab {
  /** Stable id, also the `/crm/settings/:tab` route slug. */
  id: RequestSettingsSectionId;
  /** Absolute deep-link route for this tab. */
  path: string;
  /** Full section title shown in the panel header. */
  title: string;
  /** Short label shown on the tab trigger. */
  shortLabel: string;
  /** One-line summary of what the section will eventually configure. */
  description: string;
  icon: LucideIcon;
  /** Where the authoritative data for this section lives. */
  ownership: RequestSettingsOwnership;
}

/** Base route for the REQUEST CRM settings shell. */
export const REQUEST_CRM_SETTINGS_BASE_PATH = "/crm/settings" as const;

function tabPath(id: RequestSettingsSectionId): string {
  return `${REQUEST_CRM_SETTINGS_BASE_PATH}/${id}`;
}

/** The eleven REQUEST CRM settings sections, in reading order. */
export const REQUEST_CRM_SETTINGS_TABS: RequestCrmSettingsTab[] = [
  {
    id: "general",
    path: tabPath("general"),
    title: "General",
    shortLabel: "General",
    description: "Module status, shared-admin scope and test-data mode for REQUEST CRM.",
    icon: Settings2,
    ownership: "local",
  },
  {
    id: "categories",
    path: tabPath("categories"),
    title: "Categories",
    shortLabel: "Categories",
    description: "Request categories and their default metadata labels.",
    icon: FolderTree,
    ownership: "local",
  },
  {
    id: "request-types",
    path: tabPath("request-types"),
    title: "Request Types",
    shortLabel: "Types",
    description: "Request type catalogue per category, including system types.",
    icon: ListChecks,
    ownership: "local",
  },
  {
    id: "statuses",
    path: tabPath("statuses"),
    title: "Statuses",
    shortLabel: "Statuses",
    description: "The request status lifecycle and reopen handling labels.",
    icon: CircleDot,
    ownership: "local",
  },
  {
    id: "priority-severity",
    path: tabPath("priority-severity"),
    title: "Priority & Severity",
    shortLabel: "Priority",
    description: "Priority and severity levels used across requests.",
    icon: SignalHigh,
    ownership: "central-linked",
  },
  {
    id: "sla-defaults",
    path: tabPath("sla-defaults"),
    title: "SLA Defaults",
    shortLabel: "SLA",
    description: "Default SLA placeholders and due-soon / overdue signals.",
    icon: Clock,
    ownership: "central-linked",
  },
  {
    id: "visibility-access",
    path: tabPath("visibility-access"),
    title: "Visibility & Access",
    shortLabel: "Access",
    description: "Thread separation, locked-request access and external exposure defaults.",
    icon: Eye,
    ownership: "central-linked",
  },
  {
    id: "notifications",
    path: tabPath("notifications"),
    title: "Notifications",
    shortLabel: "Notifications",
    description: "Notification type labels and the notification status model.",
    icon: Bell,
    ownership: "central-linked",
  },
  {
    id: "internal-posts-tasks",
    path: tabPath("internal-posts-tasks"),
    title: "Internal Posts & Tasks",
    shortLabel: "Tasks",
    description: "Internal post types and task acknowledgement / read-state labels.",
    icon: ClipboardList,
    ownership: "local",
  },
  {
    id: "ai-automation",
    path: tabPath("ai-automation"),
    title: "AI & Automation",
    shortLabel: "AI",
    description: "AI extension references and automation candidate quick-review (display only).",
    icon: Bot,
    ownership: "central",
  },
  {
    id: "runtime-safety-links",
    path: tabPath("runtime-safety-links"),
    title: "Runtime Safety Links",
    shortLabel: "Runtime",
    description: "Runtime guard, kill switch and incident visibility (display only).",
    icon: ShieldAlert,
    ownership: "central",
  },
];

/** The default tab id used when no `:tab` slug is present. */
export const REQUEST_CRM_DEFAULT_SETTINGS_TAB: RequestSettingsSectionId = "general";

/** Looks up a settings tab by its id / route slug. */
export function getRequestCrmSettingsTab(
  id: string | undefined,
): RequestCrmSettingsTab | undefined {
  if (!id) return undefined;
  return REQUEST_CRM_SETTINGS_TABS.find((tab) => tab.id === id);
}
