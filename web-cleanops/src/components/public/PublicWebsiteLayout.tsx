import type { ReactNode } from "react";

import { PublicFooter } from "./PublicFooter";
import { PublicHeader } from "./PublicHeader";

/**
 * Chrome for every public marketing page: a sticky header, the page content,
 * and the footer. Carries no authenticated app data and renders for logged-out
 * visitors (and logged-in users browsing public pages other than the root).
 */
export function PublicWebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
