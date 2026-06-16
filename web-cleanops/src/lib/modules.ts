import {
  BadgeCheck,
  Boxes,
  ScrollText,
  Briefcase,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  Folder,
  Headset,
  HelpCircle,
  Inbox,
  KeyRound,
  Layers,
  MessagesSquare,
  Newspaper,
  PieChart,
  Receipt,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { UserRole } from "@/types";

/**
 * Static definition of a platform module. Runtime status (global availability,
 * per-company availability and enablement) lives in the store; this catalogue
 * is the source of truth for a module's identity, copy and allowed user types.
 */
export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Default user types allowed to access the module. */
  allowedUserTypes: UserRole[];
}

/**
 * The initial module catalogue. Business logic for each module is not built yet —
 * these power module management, activation, navigation visibility and access control.
 */
export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: "checklist-manager",
    name: "Checklist Manager",
    description: "Build and assign cleaning checklists to teams and sites.",
    icon: ClipboardCheck,
    allowedUserTypes: ["company_admin", "employee"],
  },
  {
    id: "quality-control",
    name: "Quality Control",
    description: "Run inspections and track quality scores across jobs.",
    icon: BadgeCheck,
    allowedUserTypes: ["company_admin", "employee"],
  },
  {
    id: "admin-requests",
    name: "Admin Requests",
    description: "Internal requests routed to company administrators.",
    icon: Inbox,
    allowedUserTypes: ["company_admin"],
  },
  {
    id: "employee-customer-requests",
    name: "Employee & Customer Requests",
    description: "Shared request inbox for staff and customers.",
    icon: MessagesSquare,
    allowedUserTypes: ["company_admin", "employee", "customer"],
  },
  {
    id: "expense-receipts",
    name: "Expense Receipts",
    description: "Capture and approve staff expense receipts.",
    icon: Receipt,
    allowedUserTypes: ["company_admin", "employee"],
  },
  {
    id: "key-management",
    name: "Key Management",
    description: "Track physical keys and access handovers.",
    icon: KeyRound,
    allowedUserTypes: ["company_admin", "employee"],
  },
  {
    id: "news",
    name: "News",
    description: "Company announcements for staff and customers.",
    icon: Newspaper,
    allowedUserTypes: ["company_admin", "employee", "customer"],
  },
  {
    id: "reports",
    name: "Reports",
    description: "Operational reporting and exports.",
    icon: PieChart,
    allowedUserTypes: ["company_admin"],
  },
  {
    id: "faq",
    name: "FAQ",
    description: "Self-service answers for staff and customers.",
    icon: HelpCircle,
    allowedUserTypes: ["company_admin", "employee", "customer"],
  },
  {
    id: "admin-invoices",
    name: "Admin Invoices",
    description: "Internal billing and supplier invoices.",
    icon: FileText,
    allowedUserTypes: ["company_admin"],
  },
  {
    id: "customer-invoices",
    name: "Customer Invoices",
    description: "Invoices issued to and viewed by customers.",
    icon: FileSpreadsheet,
    allowedUserTypes: ["company_admin", "customer"],
  },
  {
    id: "my-cleaning-protocols",
    name: "My Cleaning Protocols",
    description: "Customers can view the cleaning protocols connected to their account.",
    icon: ScrollText,
    allowedUserTypes: ["customer", "company_admin", "super_admin"],
  },
];

/** Quick lookup of a module definition by id. */
export function getModuleDefinition(id: string): ModuleDefinition | undefined {
  return MODULE_DEFINITIONS.find((m) => m.id === id);
}

/**
 * Selectable icons for module categories. Stored by key on each category so the
 * choice persists; resolved to a Lucide component via {@link getCategoryIcon}.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  layers: Layers,
  boxes: Boxes,
  wrench: Wrench,
  briefcase: Briefcase,
  building: Building2,
  wallet: Wallet,
  chart: PieChart,
  users: Users,
  headset: Headset,
  shield: ShieldCheck,
  settings: Settings2,
  truck: Truck,
  clipboard: ClipboardCheck,
  sparkles: Sparkles,
  folder: Folder,
};

/** Ordered list of category icon keys for selection UIs. */
export const CATEGORY_ICON_KEYS: string[] = Object.keys(CATEGORY_ICONS);

/** Resolves a category icon key to its component, falling back to a folder. */
export function getCategoryIcon(key: string): LucideIcon {
  return CATEGORY_ICONS[key] ?? Folder;
}
