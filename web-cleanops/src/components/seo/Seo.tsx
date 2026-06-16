import { useEffect, useMemo } from "react";

/** Canonical production origin used for canonical/OG URLs across the public site. */
export const PUBLIC_SITE_URL = "https://stadportalen.se";
/** Public brand name used in document titles and structured data. */
export const PUBLIC_SITE_NAME = "Städportalen";

interface SeoProps {
  /** Full document title (rendered verbatim into <title> and og:title). */
  title: string;
  /** Meta description + og:description (keep ≤ 160 chars for search snippets). */
  description: string;
  /** SEO-friendly path for the canonical URL, e.g. "/services" or "/". */
  canonicalPath: string;
  /** Optional absolute Open Graph image URL (added later from the Asset Center). */
  ogImage?: string;
  /**
   * When true, emits `<meta name="robots" content="noindex, follow">` so crawlers
   * skip this page (used for transient/empty states like a dark coming-soon page).
   * Defaults to false — the page is indexable ("index, follow").
   */
  noindex?: boolean;
  /**
   * Optional JSON-LD structured data (a single object or an array). Rendered into
   * a managed `<script type="application/ld+json">` and removed when absent, so it
   * never leaks across SPA navigations.
   */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

/** Finds or creates a `<meta name="…">` tag and sets its content. */
function upsertMetaByName(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Finds or creates a `<meta property="…">` tag (Open Graph) and sets its content. */
function upsertMetaByProperty(property: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Finds or creates the single `<link rel="canonical">` tag and sets its href. */
function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Stable marker for the single SEO-managed JSON-LD script tag. */
const JSON_LD_MARKER = "data-seo-jsonld";

/** Sets the managed JSON-LD `<script>` content, or removes it when `json` is null. */
function syncJsonLd(json: string | null): void {
  let el = document.head.querySelector<HTMLScriptElement>(`script[${JSON_LD_MARKER}]`);
  if (json === null) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.setAttribute("type", "application/ld+json");
    el.setAttribute(JSON_LD_MARKER, "");
    document.head.appendChild(el);
  }
  el.textContent = json;
}

/**
 * Declaratively manages the document head for a public page. This is a
 * lightweight, dependency-free replacement for react-helmet: it imperatively
 * upserts the title, meta description, canonical link and core Open Graph tags
 * whenever its props change. Modern crawlers execute the SPA and read the
 * resulting head, so config-driven pages stay SEO-friendly without SSR.
 *
 * Renders nothing.
 */
export function Seo({ title, description, canonicalPath, ogImage, noindex = false, jsonLd }: SeoProps): null {
  // Serialize once per content change so the effect dep stays value-stable even
  // when the caller passes a freshly-built object each render.
  const jsonLdString = useMemo(() => (jsonLd ? JSON.stringify(jsonLd) : null), [jsonLd]);

  useEffect(() => {
    const normalizedPath = canonicalPath === "/" ? "" : canonicalPath;
    const canonicalUrl = `${PUBLIC_SITE_URL}${normalizedPath}`;

    document.title = title;
    upsertMetaByName("description", description);
    upsertMetaByName("robots", noindex ? "noindex, follow" : "index, follow");
    upsertMetaByProperty("og:title", title);
    upsertMetaByProperty("og:description", description);
    upsertMetaByProperty("og:type", "website");
    upsertMetaByProperty("og:site_name", PUBLIC_SITE_NAME);
    upsertMetaByProperty("og:url", canonicalUrl);
    if (ogImage) {
      upsertMetaByProperty("og:image", ogImage);
    }
    upsertCanonical(canonicalUrl);
    syncJsonLd(jsonLdString);
  }, [title, description, canonicalPath, ogImage, noindex, jsonLdString]);

  return null;
}
