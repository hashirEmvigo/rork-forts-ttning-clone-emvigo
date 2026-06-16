import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicWebsiteLayout } from "@/components/public/PublicWebsiteLayout";
import { getPublicPage } from "@/lib/publicSite/pages";

import NotFound from "../NotFound";

/**
 * Route entry for a public marketing page. Resolves its content from the
 * config registry by `slug` and renders it inside the public website chrome.
 * Falls back to the 404 page if a slug has no config (should not happen for
 * wired routes).
 */
export default function PublicPage({ slug }: { slug: string }) {
  const config = getPublicPage(slug);
  if (!config) return <NotFound />;

  return (
    <PublicWebsiteLayout>
      <PublicPageShell config={config} />
    </PublicWebsiteLayout>
  );
}
