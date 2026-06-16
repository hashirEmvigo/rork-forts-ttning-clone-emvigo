import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { Seo } from "@/components/seo/Seo";
import { getWebsiteImagesForPage, type WebsiteImage } from "@/lib/assets";
import type { PublicPageConfig } from "@/lib/publicSite/types";

import { SectionRenderer } from "./sections/SectionRenderer";

/** Stable empty map so sections fall back to placeholders without re-rendering. */
const EMPTY_IMAGES: ReadonlyMap<string, WebsiteImage> = new Map();

/**
 * Renders a config-driven public page: applies SEO head tags, scrolls to the
 * top on navigation, resolves any Super-Admin-assigned Media Center images for
 * this page (public read — works for logged-out visitors), then renders each
 * section in order. Unassigned image slots fall back to built-in placeholders.
 */
export function PublicPageShell({ config }: { config: PublicPageConfig }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [config.slug]);

  const { data: images } = useQuery({
    queryKey: ["public", "websiteImages", config.slug],
    queryFn: () => getWebsiteImagesForPage(config.slug),
    staleTime: 5 * 60 * 1000,
  });

  const resolvedImages = images ?? EMPTY_IMAGES;

  return (
    <>
      <Seo
        title={config.seo.title}
        description={config.seo.description}
        canonicalPath={config.seo.canonicalPath}
        ogImage={config.seo.ogImage}
      />
      {config.sections.map((section, index) => (
        <SectionRenderer
          key={`${config.slug}-${section.type}-${index}`}
          section={section}
          images={resolvedImages}
        />
      ))}
    </>
  );
}
