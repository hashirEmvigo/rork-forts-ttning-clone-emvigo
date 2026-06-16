import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for the staging migration.
 *
 * Step 1 of the localStorage → Supabase migration: this module only
 * *connects* to Supabase. Nothing in the app reads or writes through it yet —
 * `src/lib/store.ts` (localStorage) remains the single source of truth.
 *
 * Public env vars are exposed to the browser via Vite's `envPrefix`
 * (`VITE_*` and `EXPO_PUBLIC_*`, see vite.config.ts).
 */
const supabaseUrl: string | undefined = import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey: string | undefined = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True when both Supabase env vars are present and the client can be used. */
export const isSupabaseConfigured: boolean = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Shared Supabase client instance, or `null` when env vars are missing.
 *
 * Returning `null` (instead of throwing) keeps the prototype working in
 * environments where Supabase isn't configured yet. Callers should guard with
 * `if (!supabase) { ... }` or check `isSupabaseConfigured` before use.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Parse recovery/invite tokens from the URL on load so auth email
        // links land in a valid session on their dedicated app routes.
        // Recovery/invite links use a direct token exchange (bypassing
        // PKCE) via `detectSessionInUrl`, so cross-device flows still work.
        detectSessionInUrl: true,
        // PKCE exchanges an authorization code via POST instead of
        // exposing tokens in the URL hash, which is more secure for SPA auth.
        flowType: "pkce",
      },
    })
  : null;

/**
 * Returns the configured Supabase client or throws a clear error.
 * Use this in code paths that require Supabase (none yet in Step 1).
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}
