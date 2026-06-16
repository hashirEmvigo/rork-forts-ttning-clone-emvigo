/**
 * Runtime guardrails for legacy browser-persistent domain infrastructure.
 *
 * CleanOps domain data must be sourced from Supabase-backed reads, not from
 * app-owned localStorage/sessionStorage. These flags keep the remaining legacy
 * migration/backout/dual-write tooling quarantined from normal browser runtime
 * while the old store layer is retired incrementally in Phase 2C+.
 */

/** Browser-origin localStorage/domain-store → Supabase mirrors are fail-closed. */
export const BROWSER_DOMAIN_MIRRORS_DISABLED = true;

/** Browser-origin migration/backfill execution is not operational in normal runtime. */
export const BROWSER_DOMAIN_MIGRATIONS_DISABLED = true;

/** Browser-origin backout snapshot execution is not operational in normal runtime. */
export const BROWSER_DOMAIN_BACKOUT_TOOLS_DISABLED = true;

/** Browser-origin soak harness execution is not operational in normal runtime. */
export const BROWSER_DOMAIN_SOAK_TOOLS_DISABLED = true;

/** DevTools migration/backout handles must not be exposed by imported modules. */
export const LEGACY_BROWSER_DOMAIN_DEVTOOLS_DISABLED = true;

/** Returns true only when a browser-origin mirror may run. Currently always false. */
export function shouldRunBrowserDomainMirror(enabled: boolean): boolean {
  return !BROWSER_DOMAIN_MIRRORS_DISABLED && enabled;
}

/** Returns true only when browser-origin migration/backfill tools may execute. */
export function canRunBrowserDomainMigrationTool(): boolean {
  return !BROWSER_DOMAIN_MIGRATIONS_DISABLED;
}

/** Returns true only when browser-origin backout tools may execute. */
export function canRunBrowserDomainBackoutTool(): boolean {
  return !BROWSER_DOMAIN_BACKOUT_TOOLS_DISABLED;
}

/** Returns true only when browser-origin soak tools may execute. */
export function canRunBrowserDomainSoakTool(): boolean {
  return !BROWSER_DOMAIN_SOAK_TOOLS_DISABLED;
}

/** Standard operator-facing reason for disabled browser-origin domain tools. */
export const BROWSER_DOMAIN_TOOL_DISABLED_REASON =
  "Legacy browser-domain tooling is quarantined in normal app runtime. Use a reviewed server-side or controlled validation plan instead.";

/**
 * Locks down legacy `window.__cleanopsData` handles after module import.
 *
 * Many older migration modules attach dev-only helpers to this object as a
 * convenience. In a shared dev/demo environment, browser-origin handles are not
 * an acceptable operational path because they can read persistent local domain
 * stores or push local records into Supabase. This installer removes any handles
 * already attached and ignores future module attempts to reattach them.
 */
export function installLegacyBrowserDomainToolQuarantine(): void {
  if (!LEGACY_BROWSER_DOMAIN_DEVTOOLS_DISABLED || typeof window === "undefined") return;

  const target = window as unknown as {
    __cleanopsData?: Record<string, unknown>;
  };

  try {
    delete target.__cleanopsData;
    Object.defineProperty(target, "__cleanopsData", {
      configurable: false,
      enumerable: false,
      get: () => undefined,
      set: () => {
        // Intentionally ignored: legacy browser-domain tooling is quarantined.
      },
    });
  } catch {
    // If another script has already made the property non-configurable, fail
    // closed by leaving no app code path that relies on this handle.
  }
}
