import { type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { useApp } from "@/context/AppContext";

/**
 * Minimal branded splash shown while the persisted session is still being
 * restored. It prevents a logged-in visitor from briefly flashing the public
 * marketing page (and a logged-out visitor from flashing app chrome) on the
 * shared root/`/services` routes.
 */
function SmartRouteSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <span className="flex h-11 w-11 animate-pulse items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="h-6 w-6" />
        </span>
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}

interface SmartRouteProps {
  /** What logged-out visitors (and crawlers) see — the public marketing page. */
  publicView: ReactNode;
  /**
   * What authenticated users see. For the root this is a redirect to
   * `/dashboard`; for `/services` it is the guarded app catalog. The child is
   * responsible for its own role/permission guarding.
   */
  children: ReactNode;
}

/**
 * Routes a single path between the public marketing site and the authenticated
 * app based on session state — the "smart root" pattern. Anonymous visitors get
 * the public experience; signed-in users get the app experience. While the
 * session restores, a neutral splash avoids any cross-flash.
 */
export function SmartRoute({ publicView, children }: SmartRouteProps) {
  const { currentUser, isAuthRestoring } = useApp();

  if (isAuthRestoring) return <SmartRouteSplash />;
  if (!currentUser) return <>{publicView}</>;
  return <>{children}</>;
}
