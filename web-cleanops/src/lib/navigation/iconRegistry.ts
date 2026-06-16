import {
  Bell,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  CalendarClock,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  FileQuestion,
  FileText,
  Folder,
  Home,
  Image,
  Images,
  Inbox,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MessageSquare,
  NotebookPen,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The CONTROLLED icon set for the navigation/menu registry.
 *
 * Menu customization may only pick an icon from this curated list — never an
 * arbitrary string or an uploaded asset — so every icon renders with the same
 * size/stroke and can be resolved deterministically from a stable string key.
 * Add new options here (not inline in components) so the icon picker, the
 * registry defaults and any override all draw from one source of truth.
 */
export const NAVIGATION_ICONS = {
  LayoutDashboard,
  Building2,
  Users,
  User,
  UserCheck,
  Briefcase,
  Calendar,
  CalendarClock,
  Clock,
  ClipboardList,
  ListChecks,
  FileText,
  FileQuestion,
  ScrollText,
  NotebookPen,
  Folder,
  Image,
  Images,
  Inbox,
  MessageSquare,
  Calculator,
  SlidersHorizontal,
  Layers,
  Receipt,
  CreditCard,
  MapPin,
  KeyRound,
  Shield,
  ShieldCheck,
  Settings,
  Bell,
  Database,
  Sparkles,
  Star,
  Home,
} as const satisfies Record<string, LucideIcon>;

/** A valid icon key into {@link NAVIGATION_ICONS}. */
export type NavigationIconKey = keyof typeof NAVIGATION_ICONS;

/** Stable fallback used whenever an icon key is missing/unknown (never crashes). */
export const FALLBACK_NAVIGATION_ICON_KEY: NavigationIconKey = "Folder";

/** Every allowed icon key, in registry/display order (powers the icon picker). */
export const NAVIGATION_ICON_KEYS = Object.keys(NAVIGATION_ICONS) as NavigationIconKey[];

/** Type guard: is `value` a known, allowed navigation icon key? */
export function isNavigationIconKey(value: unknown): value is NavigationIconKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NAVIGATION_ICONS, value);
}

/**
 * Resolves an icon key to its Lucide component, defaulting to the safe fallback
 * for any unknown/blank key so a bad override can never break a menu.
 */
export function getNavigationIcon(key: string | null | undefined): LucideIcon {
  if (isNavigationIconKey(key)) return NAVIGATION_ICONS[key];
  return NAVIGATION_ICONS[FALLBACK_NAVIGATION_ICON_KEY];
}
