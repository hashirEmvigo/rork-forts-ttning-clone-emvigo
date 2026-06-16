import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import type { UserRole } from "@/types";

interface ProtectedRouteProps {
  children: ReactNode;
  allow?: UserRole[];
  /** Permission key the signed-in user must hold to view this route. */
  requirePermission?: string;
  /**
   * Module id the signed-in user must be able to access, resolved through the
   * existing `canAccessModule` seam (global status → company availability →
   * company enablement, including any Service → Module entitlement bridge such as
   * `admin-requests` ← `admin_requests`). The check runs AFTER the auth/role/
   * permission gates and, like them, redirects a blocked user to `/dashboard`.
   * `undefined` (the default) leaves every existing route's behaviour unchanged.
   */
  requireModule?: string;
}

export const AUTH_RESTORE_FALLBACK_MS = 8000;

const BUILD_MARKER = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "unknown";

function BuildMarker() {
  return (
    <p className="mt-3 text-[11px] text-muted-foreground/70" data-testid="build-marker">
      Build {BUILD_MARKER}
    </p>
  );
}

/**
 * Guards a route: redirects to login when signed out, otherwise enforces role
 * and/or permission checks, showing the Access Denied screen on failure.
 */
export function ProtectedRoute({
  children,
  allow,
  requirePermission,
  requireModule,
}: ProtectedRouteProps) {
  const { currentUser, hasPermission, canAccessModule, isAuthRestoring, logout } = useApp();
  const location = useLocation();
  const [showRestoreFallback, setShowRestoreFallback] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthRestoring) {
      setShowRestoreFallback(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowRestoreFallback(true);
    }, AUTH_RESTORE_FALLBACK_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isAuthRestoring]);

  if (isAuthRestoring) {
    if (showRestoreFallback) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-foreground" role="alert">
              We couldn’t finish loading your workspace.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Your sign-in session has not been cleared. Try reloading, or go to sign in if
              this device needs a fresh session.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button type="button" onClick={() => window.location.reload()}>
                Retry
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/login">Go to login</Link>
              </Button>
              <Button type="button" variant="ghost" onClick={logout}>
                Sign out
              </Button>
            </div>
            <BuildMarker />
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground" role="status">
            Loading workspace…
          </p>
          <BuildMarker />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allow && !allow.includes(currentUser.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requirePermission && !hasPermission(requirePermission)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Module gate: for module-bound routes the user must additionally be able to
  // access the module through the single `canAccessModule` seam (never a
  // route-local entitlement re-implementation). Runs last so it can only narrow,
  // not widen, the existing role/permission decision.
  if (requireModule && !canAccessModule(currentUser, requireModule)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
