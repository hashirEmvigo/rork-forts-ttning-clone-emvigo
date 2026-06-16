/**
 * Defensive root-level catcher for Supabase auth email links that land on the
 * site root instead of their dedicated in-app route.
 *
 * Supabase password-recovery and invite/confirmation emails are configured to
 * redirect to `/reset-password` or `/accept-invite`. When the Supabase project's
 * Site URL / redirect allow-list is misconfigured, the link can fall back to the
 * site root and arrive as `/#access_token=...&type=recovery`. The marketing root
 * route cannot complete an auth flow, so the recipient is stranded on a page
 * that ignores the token.
 *
 * This guard inspects the root URL once at startup and, when it carries a
 * Supabase auth token, forwards the browser to the correct route while
 * preserving the FULL original hash so the token reaches its destination
 * untouched. It is a frontend safety net that complements — but does not
 * replace — fixing the Supabase dashboard redirect allow-list.
 *
 * It is intentionally scoped to the Super Admin / Company Admin invite and
 * recovery flows. It never creates a session, never talks to Supabase, and
 * leaves Employee and Customer auth paths entirely untouched.
 */

/** Hash `type` values we know how to route, mapped to their target route. */
const AUTH_HASH_TYPE_ROUTES = {
  recovery: "/reset-password",
  invite: "/accept-invite",
  signup: "/accept-invite",
} as const;

type KnownAuthHashType = keyof typeof AUTH_HASH_TYPE_ROUTES;

function isKnownAuthHashType(value: string | null): value is KnownAuthHashType {
  return value === "recovery" || value === "invite" || value === "signup";
}

/** Minimal slice of `window.location` this guard reads. */
export interface RootAuthHashLocation {
  pathname: string;
  hash: string;
}

/**
 * Pure decision helper: given the current location, returns the path+hash the
 * browser should be redirected to, or `null` to leave the page untouched.
 *
 * Conservative by design — only returns a target when ALL of these hold:
 *   - the path is exactly the site root (`/`)
 *   - the hash carries a Supabase token (`access_token` or `refresh_token`)
 *   - the hash `type` is one we route (recovery → reset, invite/signup → invite)
 *
 * The returned value keeps the original hash params verbatim so the Supabase
 * token survives the redirect.
 */
export function getRootAuthHashRedirect(
  location: RootAuthHashLocation,
): string | null {
  // Only guard the exact root. The dedicated auth routes already handle their
  // own hash, and every other route is left alone.
  if (location.pathname !== "/") return null;

  const rawHash = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;
  if (!rawHash) return null;

  const params = new URLSearchParams(rawHash);

  // Require an actual Supabase token so a bare `#type=...` or any unrelated
  // fragment (anchor links, analytics hashes, etc.) never triggers a redirect.
  const carriesToken =
    params.has("access_token") || params.has("refresh_token");
  if (!carriesToken) return null;

  const type = params.get("type");
  if (!isKnownAuthHashType(type)) return null;

  // Re-prefix a single `#` so the original hash params are preserved exactly,
  // regardless of whether the caller passed the leading `#`.
  return `${AUTH_HASH_TYPE_ROUTES[type]}#${rawHash}`;
}

/**
 * Runtime guard wired into the app entry point. Reads `window.location`, and if
 * a misrouted Supabase auth link is detected on the root, performs a
 * full-document `location.replace` to the correct route (preserving the hash)
 * and returns `true` so the caller can skip mounting the app.
 *
 * Runs BEFORE the Supabase client is created, so the token-bearing hash is
 * still present (the client strips it asynchronously once it parses the
 * session). Returns `false` (a no-op) on every normal load, including a clean
 * root visit, so it never interferes with home/marketing rendering.
 */
export function redirectRootAuthHashIfPresent(): boolean {
  if (typeof window === "undefined") return false;

  const target = getRootAuthHashRedirect({
    pathname: window.location.pathname,
    hash: window.location.hash,
  });
  if (!target) return false;

  // `replace` (not `assign`) so the misrouted root URL never enters history.
  // Changing the path forces a fresh load where Supabase parses the preserved
  // hash into a recovery/invite session on the correct route.
  window.location.replace(target);
  return true;
}
