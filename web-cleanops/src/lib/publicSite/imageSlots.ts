/**
 * Public website imagery — slot registry (the placement catalog).
 *
 * Each "slot" is a named spot on a public marketing page that a Super Admin can
 * fill with a PUBLIC Asset Center image from the Media Center (login-page
 * branding works the same way — see {@link ../assets/loginBranding}). Slots are
 * declared here as a fixed, type-safe catalog so:
 *   • page content (`pages.ts`) can reference a slot by a stable key while the
 *     compiler guarantees the key exists ({@link WebsiteImageSlotKey});
 *   • the Media Center can list every assignable slot (grouped by page) without
 *     re-deriving anything from the rendering components;
 *   • a placement is modelled as an `asset_link` keyed by
 *     `entity_type = "public_website_page"`, `entity_id = <pageSlug>`,
 *     `placement_key = <slot key>` (see {@link ../assets/websiteImagery}).
 *
 * IMPORTANT: only PUBLIC assets (public-assets bucket, stable public URL) may be
 * assigned, because public pages are unauthenticated — a private/signed URL
 * would expire and 404. Slots left unassigned fall back to the built-in
 * placeholder visual in the section renderer.
 */

/** Static metadata describing one assignable website image slot. */
export interface WebsiteImageSlotMeta {
  /** The public page (slug) this slot belongs to — also the link's entity_id. */
  pageSlug: string;
  /** Human label shown in the Media Center, e.g. "Home · Hero". */
  label: string;
  /** What the image is used for (helps pick the right asset). */
  description: string;
  /** Aspect-ratio hint for the picker, e.g. "4 / 3". Display only. */
  recommendedAspect: string;
}

/**
 * The catalog of website image slots. The keys are the stable placement keys
 * persisted on each `asset_link`. Add a slot here and reference its key from a
 * section in `pages.ts` to make a new spot assignable — no migration needed.
 */
export const WEBSITE_IMAGE_SLOTS = {
  home_hero: {
    pageSlug: "home",
    label: "Home · Hero",
    description: "Large lead visual beside the homepage headline.",
    recommendedAspect: "4 / 3",
  },
  home_planning: {
    pageSlug: "home",
    label: "Home · Planning section",
    description: "Visual for the “Plan every shift” block.",
    recommendedAspect: "4 / 3",
  },
  home_quality: {
    pageSlug: "home",
    label: "Home · Quality section",
    description: "Visual for the “Quality you can prove” block.",
    recommendedAspect: "4 / 3",
  },
  features_hero: {
    pageSlug: "features",
    label: "Features · Hero",
    description: "Lead visual beside the features headline.",
    recommendedAspect: "4 / 3",
  },
  features_office_field: {
    pageSlug: "features",
    label: "Features · Office-to-field section",
    description: "Visual for the “One source of truth” block.",
    recommendedAspect: "4 / 3",
  },
  services_hero: {
    pageSlug: "services",
    label: "Services · Hero",
    description: "Lead visual beside the services headline.",
    recommendedAspect: "4 / 3",
  },
  services_implementation: {
    pageSlug: "services",
    label: "Services · Implementation section",
    description: "Visual for the “A calm path from sign-up to live” block.",
    recommendedAspect: "4 / 3",
  },
  get_started_hero: {
    pageSlug: "get-started",
    label: "Get started · Hero",
    description: "Lead visual beside the get-started headline.",
    recommendedAspect: "4 / 3",
  },
  about_hero: {
    pageSlug: "about",
    label: "About · Hero",
    description: "Lead visual beside the about headline.",
    recommendedAspect: "4 / 3",
  },
  about_mission: {
    pageSlug: "about",
    label: "About · Mission section",
    description: "Visual for the “Calm tools for hard-working teams” block.",
    recommendedAspect: "4 / 3",
  },
  contact_hero: {
    pageSlug: "contact",
    label: "Contact · Hero",
    description: "Lead visual beside the contact headline.",
    recommendedAspect: "4 / 3",
  },
} as const satisfies Record<string, WebsiteImageSlotMeta>;

/** Union of every valid website image slot key (compiler-enforced in `pages.ts`). */
export type WebsiteImageSlotKey = keyof typeof WEBSITE_IMAGE_SLOTS;

/** A slot enriched with its own key — the shape the Media Center renders. */
export interface WebsiteImageSlot extends WebsiteImageSlotMeta {
  key: WebsiteImageSlotKey;
}

/** All slots as a flat, ordered list (registry declaration order). */
export function getWebsiteImageSlots(): WebsiteImageSlot[] {
  return (Object.keys(WEBSITE_IMAGE_SLOTS) as WebsiteImageSlotKey[]).map((key) => ({
    key,
    ...WEBSITE_IMAGE_SLOTS[key],
  }));
}

/** Narrows an arbitrary string to a known slot key. */
export function isWebsiteImageSlotKey(value: string): value is WebsiteImageSlotKey {
  return Object.prototype.hasOwnProperty.call(WEBSITE_IMAGE_SLOTS, value);
}

/** A page heading paired with its slots, for grouped rendering in the Media Center. */
export interface WebsiteImageSlotGroup {
  pageSlug: string;
  slots: WebsiteImageSlot[];
}

/** Slots grouped by page (page order follows first appearance in the registry). */
export function getWebsiteImageSlotGroups(): WebsiteImageSlotGroup[] {
  const groups: WebsiteImageSlotGroup[] = [];
  const byPage = new Map<string, WebsiteImageSlot[]>();
  for (const slot of getWebsiteImageSlots()) {
    const existing = byPage.get(slot.pageSlug);
    if (existing) {
      existing.push(slot);
    } else {
      const list = [slot];
      byPage.set(slot.pageSlug, list);
      groups.push({ pageSlug: slot.pageSlug, slots: list });
    }
  }
  return groups;
}
