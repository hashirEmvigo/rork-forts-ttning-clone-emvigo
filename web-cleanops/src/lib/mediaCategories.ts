import type {
  MediaCategory,
  MediaEntityType,
  MediaUsageTarget,
  MediaVisibilityTarget,
} from "@/types";

/**
 * Registry of the optional-feature image categories supported by the Media
 * Foundation. Keeping this declarative means new modules can attach images
 * simply by adding an entry here — no per-module image tables or bespoke UI.
 */
export interface MediaCategoryDefinition {
  key: MediaCategory;
  /** Human-readable label for UI surfaces. */
  label: string;
  /** Short description of what this category is for. */
  description: string;
  /** Lucide icon identifier used by future galleries. */
  icon: string;
  /** Entity kinds an image in this category is typically attached to. */
  entityTypes: MediaEntityType[];
  /** Surfaces an image of this category is made available in by default. */
  defaultUsedIn: MediaUsageTarget[];
  /** Audiences an image of this category is visible to by default. */
  defaultVisibleFor: MediaVisibilityTarget[];
}

/** Internal audiences (everyone in the company except the end customer). */
const INTERNAL_VISIBILITY: MediaVisibilityTarget[] = [
  "super_admin",
  "company_admin",
  "scheduler",
  "employee",
];

/** Internal audiences plus the customer. */
const INTERNAL_AND_CUSTOMER: MediaVisibilityTarget[] = [
  ...INTERNAL_VISIBILITY,
  "customer",
];

export const MEDIA_CATEGORY_REGISTRY: MediaCategoryDefinition[] = [
  {
    key: "customer",
    label: "Customer",
    description: "General customer imagery such as site or building photos.",
    icon: "Building2",
    entityTypes: ["customer"],
    defaultUsedIn: ["customer_card"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "cover",
    label: "Cover",
    description: "Cover or hero photo representing the customer site.",
    icon: "Image",
    entityTypes: ["customer"],
    defaultUsedIn: ["customer_card", "work_order", "schedule", "customer_portal"],
    defaultVisibleFor: INTERNAL_AND_CUSTOMER,
  },
  {
    key: "profile",
    label: "Profile",
    description: "Profile or logo image for the customer.",
    icon: "CircleUserRound",
    entityTypes: ["customer", "employee"],
    defaultUsedIn: ["customer_card"],
    defaultVisibleFor: INTERNAL_AND_CUSTOMER,
  },
  {
    key: "key",
    label: "Key",
    description: "Photos of keys, key tags or lockboxes for access.",
    icon: "KeyRound",
    entityTypes: ["customer"],
    defaultUsedIn: ["work_order", "employee_app"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "alarm",
    label: "Alarm",
    description: "Alarm panels, codes location and disarm instructions.",
    icon: "BellRing",
    entityTypes: ["customer"],
    defaultUsedIn: ["work_order", "cleaning_protocol", "employee_app"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "entrance",
    label: "Entrance",
    description: "Entrance, doors and access-point photos.",
    icon: "DoorOpen",
    entityTypes: ["customer"],
    defaultUsedIn: ["work_order", "cleaning_protocol", "employee_app"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "cleaning_result",
    label: "Cleaning Result",
    description: "Photos documenting completed cleaning results.",
    icon: "Sparkles",
    entityTypes: ["customer", "work_order"],
    defaultUsedIn: ["work_order", "cleaning_protocol", "customer_portal"],
    defaultVisibleFor: INTERNAL_AND_CUSTOMER,
  },
  {
    key: "quality_issue",
    label: "Quality Issue",
    description: "Photos highlighting quality issues or complaints.",
    icon: "TriangleAlert",
    entityTypes: ["customer", "work_order"],
    defaultUsedIn: ["work_order", "cleaning_protocol", "deviation"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "work_order",
    label: "Work Order",
    description: "Images tied to a specific work order or contract.",
    icon: "ClipboardList",
    entityTypes: ["work_order", "customer"],
    defaultUsedIn: ["work_order"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "employee",
    label: "Employee",
    description: "Employee profile and identification photos.",
    icon: "User",
    entityTypes: ["employee"],
    defaultUsedIn: ["employee_app"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "protocol",
    label: "Cleaning Protocol",
    description: "Reference and instructional images for cleaning protocols.",
    icon: "ListChecks",
    entityTypes: ["protocol", "customer"],
    defaultUsedIn: ["cleaning_protocol", "employee_app"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "deviation",
    label: "Deviation",
    description: "Evidence images attached to reported deviations.",
    icon: "AlertTriangle",
    entityTypes: ["deviation", "work_order", "customer"],
    defaultUsedIn: ["work_order", "deviation"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "damage",
    label: "Damage Report",
    description: "Photos documenting damage at a site.",
    icon: "ShieldAlert",
    entityTypes: ["damage", "work_order", "customer"],
    defaultUsedIn: ["work_order", "damage"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "material",
    label: "Cleaning Material",
    description: "Images of cleaning materials and equipment.",
    icon: "SprayCan",
    entityTypes: ["material", "customer"],
    defaultUsedIn: ["material"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
  {
    key: "before_after",
    label: "Before / After",
    description: "Paired before-and-after cleaning images.",
    icon: "Images",
    entityTypes: ["work_order", "protocol"],
    defaultUsedIn: ["work_order", "cleaning_protocol", "customer_portal"],
    defaultVisibleFor: INTERNAL_AND_CUSTOMER,
  },
  {
    key: "instruction",
    label: "Instruction",
    description: "Instructional or guidance images for field workers.",
    icon: "BookOpen",
    entityTypes: ["work_order", "protocol", "customer"],
    defaultUsedIn: ["work_order", "cleaning_protocol", "employee_app"],
    defaultVisibleFor: INTERNAL_VISIBILITY,
  },
];

/** Categories that can be attached to a customer, in registry order. */
export const CUSTOMER_MEDIA_CATEGORIES: MediaCategory[] = MEDIA_CATEGORY_REGISTRY.filter(
  (def) => def.entityTypes.includes("customer"),
).map((def) => def.key);

const REGISTRY_BY_KEY: Record<MediaCategory, MediaCategoryDefinition> =
  MEDIA_CATEGORY_REGISTRY.reduce(
    (acc, def) => {
      acc[def.key] = def;
      return acc;
    },
    {} as Record<MediaCategory, MediaCategoryDefinition>,
  );

/** Looks up a category definition by key. */
export function getMediaCategory(
  key: MediaCategory,
): MediaCategoryDefinition | undefined {
  return REGISTRY_BY_KEY[key];
}

/** Whether a category is registered. */
export function isKnownMediaCategory(key: string): key is MediaCategory {
  return key in REGISTRY_BY_KEY;
}

/** Whether the given category may attach to the given entity type. */
export function categorySupportsEntity(
  category: MediaCategory,
  entityType: MediaEntityType,
): boolean {
  return REGISTRY_BY_KEY[category]?.entityTypes.includes(entityType) ?? false;
}

// ---------------------------------------------------------------------------
// Usage (“Used In”) & visibility (“Visible For”) target registries
// ---------------------------------------------------------------------------

export interface MediaTargetDefinition<T extends string> {
  key: T;
  label: string;
  description: string;
}

/** Surfaces/modules an image can be made available in, in display order. */
export const MEDIA_USAGE_TARGETS: MediaTargetDefinition<MediaUsageTarget>[] = [
  {
    key: "customer_card",
    label: "Customer Card",
    description: "Shown on the customer record.",
  },
  {
    key: "work_order",
    label: "Work Order",
    description: "Available on work orders for this customer.",
  },
  {
    key: "cleaning_protocol",
    label: "Cleaning Protocol",
    description: "Available on cleaning protocols.",
  },
  {
    key: "schedule",
    label: "Schedule",
    description: "Available in the scheduling module.",
  },
  {
    key: "employee_app",
    label: "Employee App",
    description: "Visible to field workers in the employee app.",
  },
  {
    key: "customer_portal",
    label: "Customer Portal",
    description: "Shared with the customer in their portal.",
  },
  {
    key: "material",
    label: "Material",
    description: "Available on cleaning material records.",
  },
  {
    key: "deviation",
    label: "Deviation",
    description: "Available on deviation reports.",
  },
  {
    key: "damage",
    label: "Damage Report",
    description: "Available on damage reports.",
  },
];

/** Audiences an image can be made visible to, in display order. */
export const MEDIA_VISIBILITY_TARGETS: MediaTargetDefinition<MediaVisibilityTarget>[] = [
  { key: "super_admin", label: "Super Admin", description: "Platform administrators." },
  { key: "company_admin", label: "Company Admin", description: "Company administrators." },
  { key: "scheduler", label: "Scheduler", description: "Scheduling staff (future role)." },
  { key: "employee", label: "Employee", description: "Field workers." },
  { key: "customer", label: "Customer", description: "The end customer." },
];

const USAGE_LABELS: Record<MediaUsageTarget, string> = MEDIA_USAGE_TARGETS.reduce(
  (acc, t) => {
    acc[t.key] = t.label;
    return acc;
  },
  {} as Record<MediaUsageTarget, string>,
);

const VISIBILITY_LABELS: Record<MediaVisibilityTarget, string> =
  MEDIA_VISIBILITY_TARGETS.reduce(
    (acc, t) => {
      acc[t.key] = t.label;
      return acc;
    },
    {} as Record<MediaVisibilityTarget, string>,
  );

/** Label for a usage target key. */
export function getUsageTargetLabel(target: MediaUsageTarget): string {
  return USAGE_LABELS[target] ?? target;
}

/** Label for a visibility target key. */
export function getVisibilityTargetLabel(target: MediaVisibilityTarget): string {
  return VISIBILITY_LABELS[target] ?? target;
}

/** Default “Used In” preset for a category (empty array if unknown). */
export function defaultUsageForCategory(
  category: MediaCategory,
): MediaUsageTarget[] {
  return [...(REGISTRY_BY_KEY[category]?.defaultUsedIn ?? [])];
}

/** Default “Visible For” preset for a category (empty array if unknown). */
export function defaultVisibilityForCategory(
  category: MediaCategory,
): MediaVisibilityTarget[] {
  return [...(REGISTRY_BY_KEY[category]?.defaultVisibleFor ?? [])];
}
