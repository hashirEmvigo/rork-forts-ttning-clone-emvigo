// ============================================================================
// Price Calculator — PURE public-endpoint abuse guard (Deno + vitest).
// ============================================================================
//
// I/O-free helpers the `public-calculator` Edge Function uses to protect its
// anonymous surface. Keeping the DECISIONS pure (rate-limit plans, honeypot
// detection, IP extraction, window bucketing, the canonical key source, and the
// 429 body) makes them unit-testable with vitest, exactly like the pricing/
// submit layer in `publicCalculator.ts`. The actual side effects — hashing the
// key with a server-only secret and the atomic counter RPC — live in the Edge
// Function, never here.
//
// PRIVACY CONTRACT
//   Nothing here persists anything. The function turns the canonical key source
//   (scope|identifier|window-bucket) into an irreversible HMAC digest BEFORE it
//   reaches the database, so a raw IP / email never leaves the function. These
//   helpers only shape the inputs and the public response.
// ============================================================================

/** The public actions the Edge Function routes (mirrors index.ts). */
export type PublicAction = "config" | "calculate" | "submit";

/** A fixed-window rate-limit plan: at most `limit` hits per `windowSeconds`. */
export interface RateLimitPlan {
  limit: number;
  windowSeconds: number;
}

/**
 * Per-IP limits per action. `submit` is deliberately the STRICTEST because it is
 * the write path; `config`/`calculate` are read-only and looser so a normal
 * session (page load + a few debounced price updates) is never throttled.
 */
export const IP_RATE_LIMITS: Readonly<Record<PublicAction, RateLimitPlan>> = {
  config: { limit: 60, windowSeconds: 60 },
  calculate: { limit: 40, windowSeconds: 60 },
  submit: { limit: 5, windowSeconds: 60 },
};

/** Fallback plan for an unknown/missing action (the function rejects those anyway). */
export const DEFAULT_IP_RATE_LIMIT: RateLimitPlan = { limit: 30, windowSeconds: 60 };

/**
 * Per-EMAIL cap for `submit` only: at most 10 submissions per email per day. This
 * is layered ON TOP of the per-IP submit limit so a single inbox cannot be used
 * to flood the leads table from rotating IPs. The email is hashed (never stored).
 */
export const EMAIL_SUBMIT_CAP: RateLimitPlan = { limit: 10, windowSeconds: 86_400 };

/**
 * The hidden honeypot field name. A real person never sees or fills it (it is
 * visually hidden, non-tabbable, and autocomplete-off on the client); an
 * automated bot that fills every field will populate it and reveal itself.
 */
export const HONEYPOT_FIELD = "company_website";

/** Resolves the per-IP plan for an action, falling back for anything unknown. */
export function resolveIpRateLimit(action: string): RateLimitPlan {
  return (IP_RATE_LIMITS as Record<string, RateLimitPlan>)[action] ?? DEFAULT_IP_RATE_LIMIT;
}

/** True when the honeypot field carries any non-whitespace content (a bot signal). */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const value = body[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Floors a wall-clock instant (ms) into a stable fixed-window bucket index. The
 * bucket is baked into the throttle key so each window naturally gets its own
 * counter row and old windows fall away.
 */
export function windowBucket(nowMs: number, windowSeconds: number): number {
  const w = Math.max(1, Math.floor(windowSeconds));
  return Math.floor(Math.floor(nowMs / 1000) / w);
}

/**
 * Best-effort client IP from the forwarding headers Supabase/Cloudflare set,
 * preferring the most trustworthy single-value headers before falling back to
 * the first hop of `x-forwarded-for`. Returns null when none is present (the
 * caller then fails OPEN for IP limiting rather than block legitimate traffic).
 */
export function extractClientIp(getHeader: (name: string) => string | null | undefined): string | null {
  const direct = getHeader("cf-connecting-ip") ?? getHeader("x-real-ip");
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();

  const forwarded = getHeader("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

/**
 * Canonical, opaque source string for a throttle key. The caller HMACs this with
 * a server-only secret to produce the stored digest, so the raw identifier (IP /
 * email) is never persisted or derivable from the table.
 */
export function throttleKeySource(parts: { scope: string; identifier: string; bucket: number }): string {
  return `${parts.scope}|${parts.identifier}|${parts.bucket}`;
}

/** A counter result is within budget when the post-increment count is at/below the limit. */
export function isWithinLimit(currentCount: number, plan: RateLimitPlan): boolean {
  return currentCount <= plan.limit;
}

/**
 * The friendly, internals-free 429 body. `error: "rate_limited"` is the stable
 * machine code the client switches on; `message` is the human-facing Swedish copy.
 */
export function rateLimitedResponseBody(retryAfterSeconds: number): Record<string, unknown> {
  return {
    ok: false,
    error: "rate_limited",
    message: "För många förfrågningar just nu. Vänta en liten stund och försök igen.",
    retryAfterSeconds: Math.max(0, Math.floor(retryAfterSeconds)),
  };
}
