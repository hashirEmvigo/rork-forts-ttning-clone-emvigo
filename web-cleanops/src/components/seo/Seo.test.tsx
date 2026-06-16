import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PUBLIC_SITE_NAME, PUBLIC_SITE_URL, Seo } from "./Seo";

/**
 * Unit tests for the head-managing <Seo> component. It renders nothing but
 * imperatively upserts the document title, description, robots, canonical,
 * Open Graph tags and a single managed JSON-LD script. These tests pin the
 * indexability + structured-data contract the public calculator depends on:
 * a dark/transient state is `noindex`, an active page is indexable, and broken
 * JSON-LD is never emitted.
 */

const CANONICAL_PATH = "/rakna-ut-ditt-pris";
const TITLE = "Räkna ut ditt pris | Städportalen";

function metaByName(name: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
}
function metaByProperty(property: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.getAttribute("content") ?? null;
}
function canonicalHref(): string | null {
  return document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ?? null;
}
function jsonLdScript(): HTMLScriptElement | null {
  return document.head.querySelector<HTMLScriptElement>("script[data-seo-jsonld]");
}

afterEach(() => {
  // Managed tags are reused by selector across renders; clear them so each test
  // asserts against a clean head.
  document.head.querySelectorAll("script[data-seo-jsonld]").forEach((el) => el.remove());
});

describe("Seo — core head tags", () => {
  it("sets the document title, description and canonical URL", () => {
    render(
      <Seo
        title={TITLE}
        description="Räkna ut ett uppskattat pris för städning."
        canonicalPath={CANONICAL_PATH}
      />,
    );

    expect(document.title).toBe(TITLE);
    expect(metaByName("description")).toBe("Räkna ut ett uppskattat pris för städning.");
    expect(canonicalHref()).toBe(`${PUBLIC_SITE_URL}${CANONICAL_PATH}`);
  });

  it("emits the Open Graph tags (title, description, type, site_name, url)", () => {
    render(<Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} />);

    expect(metaByProperty("og:title")).toBe(TITLE);
    expect(metaByProperty("og:description")).toBe("desc");
    expect(metaByProperty("og:type")).toBe("website");
    expect(metaByProperty("og:site_name")).toBe(PUBLIC_SITE_NAME);
    expect(metaByProperty("og:url")).toBe(`${PUBLIC_SITE_URL}${CANONICAL_PATH}`);
  });

  it("treats the root path as the bare origin (no trailing slash)", () => {
    render(<Seo title="Home" description="desc" canonicalPath="/" />);
    expect(canonicalHref()).toBe(PUBLIC_SITE_URL);
  });
});

describe("Seo — indexability", () => {
  it("is indexable by default (enabled calculator state)", () => {
    render(<Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} />);
    expect(metaByName("robots")).toBe("index, follow");
  });

  it("is noindex when requested (disabled/dark calculator state)", () => {
    render(<Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} noindex />);
    expect(metaByName("robots")).toBe("noindex, follow");
  });
});

describe("Seo — JSON-LD structured data", () => {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "Hur beräknas priset?", acceptedAnswer: { "@type": "Answer", text: "Per yta." } },
    ],
  };

  it("emits a single, parseable JSON-LD script when valid data is supplied", () => {
    render(<Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} jsonLd={faqJsonLd} />);

    const script = jsonLdScript();
    expect(script).not.toBeNull();
    expect(script?.getAttribute("type")).toBe("application/ld+json");
    const parsed = JSON.parse(script?.textContent ?? "null") as Record<string, unknown>;
    expect(parsed["@type"]).toBe("FAQPage");
  });

  it("emits NO JSON-LD script when none is supplied (empty/malformed FAQ → nothing)", () => {
    render(<Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} />);
    expect(jsonLdScript()).toBeNull();
  });

  it("removes a previously-emitted JSON-LD script when it disappears (no SPA leak)", () => {
    const { rerender } = render(
      <Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} jsonLd={faqJsonLd} />,
    );
    expect(jsonLdScript()).not.toBeNull();

    rerender(<Seo title={TITLE} description="desc" canonicalPath={CANONICAL_PATH} />);
    expect(jsonLdScript()).toBeNull();
  });
});
