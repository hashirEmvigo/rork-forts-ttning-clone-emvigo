import { describe, expect, it } from "vitest";

import { ICON_REGISTRY } from "./icons";
import { PUBLIC_PAGES, getPublicNavPages, getPublicPage } from "./pages";
import type { PublicSection } from "./types";

/** Internal route targets a public CTA/link is allowed to point at. */
const KNOWN_ROUTE_TARGETS = new Set<string>([
  "/",
  "/features",
  "/services",
  "/get-started",
  "/about",
  "/contact",
  "/login",
  "/forgot-password",
]);

/** Collects every CTA `to` target referenced by a section. */
function ctaTargets(section: PublicSection): string[] {
  switch (section.type) {
    case "hero":
      return [section.primaryCta?.to, section.secondaryCta?.to].filter(
        (to): to is string => Boolean(to),
      );
    case "textImage":
      return section.cta ? [section.cta.to] : [];
    case "cta":
      return [section.primaryCta.to, section.secondaryCta?.to].filter(
        (to): to is string => Boolean(to),
      );
    default:
      return [];
  }
}

describe("public site page registry", () => {
  it("has unique slugs and paths", () => {
    const slugs = PUBLIC_PAGES.map((page) => page.slug);
    const paths = PUBLIC_PAGES.map((page) => page.path);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("includes the required public pages", () => {
    const paths = PUBLIC_PAGES.map((page) => page.path);
    for (const required of ["/", "/services", "/features", "/get-started", "/about", "/contact"]) {
      expect(paths).toContain(required);
    }
  });

  it("keeps SEO canonicalPath in sync with the route path", () => {
    for (const page of PUBLIC_PAGES) {
      expect(page.seo.canonicalPath).toBe(page.path);
    }
  });

  it("provides non-empty, search-friendly SEO metadata", () => {
    for (const page of PUBLIC_PAGES) {
      expect(page.seo.title.trim().length).toBeGreaterThan(0);
      expect(page.seo.description.trim().length).toBeGreaterThan(0);
      // Keep descriptions within a typical search snippet length.
      expect(page.seo.description.length).toBeLessThanOrEqual(170);
    }
  });

  it("starts every page with exactly one hero (a single H1)", () => {
    for (const page of PUBLIC_PAGES) {
      expect(page.sections.length).toBeGreaterThan(0);
      expect(page.sections[0]?.type).toBe("hero");
      const heroCount = page.sections.filter((section) => section.type === "hero").length;
      expect(heroCount).toBe(1);
    }
  });

  it("only references known internal routes in CTAs", () => {
    for (const page of PUBLIC_PAGES) {
      for (const section of page.sections) {
        for (const target of ctaTargets(section)) {
          expect(target.startsWith("/")).toBe(true);
          expect(KNOWN_ROUTE_TARGETS.has(target)).toBe(true);
        }
      }
    }
  });

  it("only uses icons present in the registry", () => {
    for (const page of PUBLIC_PAGES) {
      for (const section of page.sections) {
        if (section.type === "featureGrid") {
          for (const feature of section.features) {
            expect(feature.icon in ICON_REGISTRY).toBe(true);
          }
        }
      }
    }
  });

  it("resolves pages by slug and returns null for unknown slugs", () => {
    expect(getPublicPage("home")?.path).toBe("/");
    expect(getPublicPage("does-not-exist")).toBeNull();
  });

  it("exposes only labelled pages in the primary navigation", () => {
    const navPaths = getPublicNavPages().map((page) => page.path);
    expect(navPaths).toEqual(["/features", "/services", "/about", "/contact"]);
    // The root and get-started are intentionally not primary nav items.
    expect(navPaths).not.toContain("/");
    expect(navPaths).not.toContain("/get-started");
  });
});
