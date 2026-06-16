import { describe, expect, it } from "vitest";

import {
  WEBSITE_IMAGE_SLOTS,
  getWebsiteImageSlotGroups,
  getWebsiteImageSlots,
  isWebsiteImageSlotKey,
  type WebsiteImageSlotKey,
} from "./imageSlots";
import { PUBLIC_PAGES } from "./pages";

/** Collects every (pageSlug, slotKey, sectionType) referenced by the page config. */
function referencedSlots(): { pageSlug: string; slotKey: string; sectionType: string }[] {
  const out: { pageSlug: string; slotKey: string; sectionType: string }[] = [];
  for (const page of PUBLIC_PAGES) {
    for (const section of page.sections) {
      if ((section.type === "hero" || section.type === "textImage") && section.imageSlot) {
        out.push({ pageSlug: page.slug, slotKey: section.imageSlot, sectionType: section.type });
      }
    }
  }
  return out;
}

describe("website image slot registry", () => {
  it("derives a slot per registry entry with its own key", () => {
    const slots = getWebsiteImageSlots();
    expect(slots.length).toBe(Object.keys(WEBSITE_IMAGE_SLOTS).length);
    for (const slot of slots) {
      expect(slot.key in WEBSITE_IMAGE_SLOTS).toBe(true);
      expect(slot.label.trim().length).toBeGreaterThan(0);
      expect(slot.pageSlug.trim().length).toBeGreaterThan(0);
    }
  });

  it("only registers slots for pages that actually exist", () => {
    const pageSlugs = new Set(PUBLIC_PAGES.map((p) => p.slug));
    for (const slot of getWebsiteImageSlots()) {
      expect(pageSlugs.has(slot.pageSlug)).toBe(true);
    }
  });

  it("groups slots by page without losing any", () => {
    const groups = getWebsiteImageSlotGroups();
    const grouped = groups.reduce((sum, g) => sum + g.slots.length, 0);
    expect(grouped).toBe(getWebsiteImageSlots().length);
    // No page appears twice.
    const pages = groups.map((g) => g.pageSlug);
    expect(new Set(pages).size).toBe(pages.length);
  });

  it("recognises known keys and rejects unknown ones", () => {
    expect(isWebsiteImageSlotKey("home_hero")).toBe(true);
    expect(isWebsiteImageSlotKey("not_a_slot")).toBe(false);
  });
});

describe("page config ↔ slot registry consistency", () => {
  it("references only known slot keys, on the matching page", () => {
    for (const ref of referencedSlots()) {
      expect(isWebsiteImageSlotKey(ref.slotKey)).toBe(true);
      const meta = WEBSITE_IMAGE_SLOTS[ref.slotKey as WebsiteImageSlotKey];
      expect(meta.pageSlug).toBe(ref.pageSlug);
    }
  });

  it("uses every registered slot exactly once in the page config (no orphans/dupes)", () => {
    const referenced = referencedSlots().map((r) => r.slotKey);
    // Each registry key is referenced.
    for (const key of Object.keys(WEBSITE_IMAGE_SLOTS)) {
      expect(referenced).toContain(key);
    }
    // No slot key is referenced more than once.
    expect(new Set(referenced).size).toBe(referenced.length);
  });
});
