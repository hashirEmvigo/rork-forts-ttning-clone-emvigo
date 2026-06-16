import {
  BadgeCheck,
  BookOpen,
  Building2,
  DoorOpen,
  FileStack,
  Image,
  Layers3,
  LayoutTemplate,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Checklist Manager V2 — Settings → Checklists.
 *
 * Ticket 1 (Phase 1 Foundation) establishes navigation, routing and page
 * structure only. Each entry below maps to its own dedicated placeholder
 * route under `/settings/checklists/*`. Future tickets replace the placeholder
 * page for a given module without touching routing — minimizing refactoring.
 */
export interface ChecklistSettingsModule {
  /** Stable identifier, also used as the route slug. */
  id: string;
  /** Absolute route for the module's dedicated page. */
  path: string;
  /** Display name shown on the overview card and module page. */
  title: string;
  /** One-line summary of what the module will eventually configure. */
  description: string;
  /** Placeholder copy shown on the (currently empty) module page. */
  placeholder: string;
  icon: LucideIcon;
}

/** The future configuration modules surfaced under Settings → Checklists. */
export const CHECKLIST_SETTINGS_MODULES: ChecklistSettingsModule[] = [
  {
    id: "checklist-templates",
    path: "/settings/checklists/checklist-templates",
    title: "Checklist Templates",
    description: "Create and manage reusable checklist templates for your company.",
    placeholder: "Checklist Templates will be configured here.",
    icon: FileStack,
  },
  {
    id: "floor-presets",
    path: "/settings/checklists/floor-presets",
    title: "Floor Presets",
    description: "Reusable, country-friendly floor definitions used when building protocols.",
    placeholder: "Floor Presets will be configured here.",
    icon: Layers3,
  },
  {
    id: "room-categories",
    path: "/settings/checklists/room-categories",
    title: "Room Categories",
    description: "Group rooms in the libraries and protocol builder.",
    placeholder: "Room Categories will be configured here.",
    icon: DoorOpen,
  },
  {
    id: "task-categories",
    path: "/settings/checklists/task-categories",
    title: "Task Categories",
    description: "Organize cleaning tasks across templates and protocols.",
    placeholder: "Task Categories will be configured here.",
    icon: ListChecks,
  },
  {
    id: "instruction-categories",
    path: "/settings/checklists/instruction-categories",
    title: "Instruction Categories",
    description: "Classify reusable instructions such as method, safety and chemicals.",
    placeholder: "Instruction Categories will be configured here.",
    icon: BookOpen,
  },
  {
    id: "quality-categories",
    path: "/settings/checklists/quality-categories",
    title: "Quality Categories",
    description: "Group quality standards used for self-check and quality control.",
    placeholder: "Quality Categories will be configured here.",
    icon: BadgeCheck,
  },
  {
    id: "media-categories",
    path: "/settings/checklists/media-categories",
    title: "Media Categories",
    description: "Organize reusable media assets across the knowledge system.",
    placeholder: "Media Categories will be configured here.",
    icon: Image,
  },
  {
    id: "template-categories",
    path: "/settings/checklists/template-categories",
    title: "Template Categories",
    description: "Group protocol templates so they are easy to find and reuse.",
    placeholder: "Template Categories will be configured here.",
    icon: LayoutTemplate,
  },
  {
    id: "industry-categories",
    path: "/settings/checklists/industry-categories",
    title: "Industry Categories",
    description: "Classify templates by industry such as office, school or healthcare.",
    placeholder: "Industry Categories will be configured here.",
    icon: Building2,
  },
];

/** Look up a module by its route slug / id. */
export function getChecklistSettingsModule(
  id: string,
): ChecklistSettingsModule | undefined {
  return CHECKLIST_SETTINGS_MODULES.find((m) => m.id === id);
}
