/**
 * Browser cache recovery for stale custom-domain deployments.
 *
 * CleanOps does not intentionally register a service worker. If a previous
 * deployment, browser experiment, or hosting fallback left one behind, it can
 * keep serving an old app bundle after the live domain has been redeployed.
 * This cleanup removes only browser Cache API entries and service-worker
 * registrations; it never touches localStorage, sessionStorage, cookies, or
 * Supabase Auth tokens.
 */
export async function unregisterStaleServiceWorkersAndCaches(): Promise<void> {
  if (typeof window === "undefined") return;

  const cleanupTasks: Promise<unknown>[] = [];

  if ("serviceWorker" in navigator) {
    cleanupTasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
    );
  }

  if ("caches" in window) {
    cleanupTasks.push(
      caches.keys().then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))),
    );
  }

  if (cleanupTasks.length === 0) return;

  try {
    await Promise.allSettled(cleanupTasks);
  } catch (error) {
    console.warn("[cache.recovery] Unable to complete browser cache cleanup.", {
      message: error instanceof Error ? error.message : "Unknown cache cleanup error.",
    });
  }
}
