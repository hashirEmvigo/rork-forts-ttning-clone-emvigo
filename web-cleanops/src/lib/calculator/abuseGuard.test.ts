import { describe, expect, it } from "vitest";

/**
 * Tests the EXACT pure abuse-guard module the `public-calculator` Edge Function
 * runs (`supabase/functions/_shared/calculator/abuseGuard.ts`). It lives outside
 * `src`, but the app tsconfig enables `allowImportingTsExtensions`, so we import
 * it by its explicit `.ts` path (mirroring publicCalculator.test.ts). These pin
 * the rate-limit plans, honeypot detection, IP extraction, window bucketing, the
 * canonical (PII-free) key source, and the friendly 429 body.
 */
import {
  DEFAULT_IP_RATE_LIMIT,
  EMAIL_SUBMIT_CAP,
  extractClientIp,
  HONEYPOT_FIELD,
  IP_RATE_LIMITS,
  isHoneypotFilled,
  isWithinLimit,
  rateLimitedResponseBody,
  resolveIpRateLimit,
  throttleKeySource,
  windowBucket,
} from "../../../supabase/functions/_shared/calculator/abuseGuard.ts";

describe("rate-limit plans", () => {
  it("makes submit the strictest action (it is the write path)", () => {
    expect(IP_RATE_LIMITS.submit.limit).toBeLessThan(IP_RATE_LIMITS.calculate.limit);
    expect(IP_RATE_LIMITS.submit.limit).toBeLessThan(IP_RATE_LIMITS.config.limit);
    // Every plan has a positive limit + window.
    for (const plan of [IP_RATE_LIMITS.config, IP_RATE_LIMITS.calculate, IP_RATE_LIMITS.submit]) {
      expect(plan.limit).toBeGreaterThan(0);
      expect(plan.windowSeconds).toBeGreaterThan(0);
    }
  });

  it("resolves the per-action plan, falling back for an unknown action", () => {
    expect(resolveIpRateLimit("submit")).toEqual(IP_RATE_LIMITS.submit);
    expect(resolveIpRateLimit("calculate")).toEqual(IP_RATE_LIMITS.calculate);
    expect(resolveIpRateLimit("config")).toEqual(IP_RATE_LIMITS.config);
    expect(resolveIpRateLimit("totally-unknown")).toEqual(DEFAULT_IP_RATE_LIMIT);
    expect(resolveIpRateLimit("")).toEqual(DEFAULT_IP_RATE_LIMIT);
  });

  it("caps submissions per email over a long (daily) window", () => {
    expect(EMAIL_SUBMIT_CAP.limit).toBeGreaterThan(0);
    expect(EMAIL_SUBMIT_CAP.windowSeconds).toBe(86_400);
  });
});

describe("isHoneypotFilled", () => {
  it("is true only when the honeypot field carries non-whitespace content", () => {
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "http://spam.example" })).toBe(true);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "   x   " })).toBe(true);
  });

  it("is false for an absent, empty, whitespace, or non-string value (a real person)", () => {
    expect(isHoneypotFilled({})).toBe(false);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "" })).toBe(false);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "   " })).toBe(false);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: 123 as unknown as string })).toBe(false);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: null as unknown as string })).toBe(false);
    expect(isHoneypotFilled({ other: "value" })).toBe(false);
  });
});

describe("windowBucket", () => {
  it("is stable within a window and advances to the next bucket after it", () => {
    const w = 60;
    const windowMs = w * 1000;
    // Align the base to a window boundary so the assertions are exact.
    const t0 = Math.floor(1_000_000_000_000 / windowMs) * windowMs;
    const b0 = windowBucket(t0, w);
    expect(windowBucket(t0 + 59_000, w)).toBe(b0); // same window
    expect(windowBucket(t0 + 60_000, w)).toBe(b0 + 1); // next window
  });

  it("never divides by zero (guards a non-positive window)", () => {
    expect(Number.isFinite(windowBucket(1_000_000, 0))).toBe(true);
    expect(Number.isFinite(windowBucket(1_000_000, -10))).toBe(true);
  });
});

describe("extractClientIp", () => {
  function getterFrom(headers: Record<string, string>): (name: string) => string | null {
    return (name) => headers[name.toLowerCase()] ?? null;
  }

  it("prefers single-value trusted headers (cf-connecting-ip, then x-real-ip)", () => {
    expect(extractClientIp(getterFrom({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(extractClientIp(getterFrom({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to the FIRST hop of x-forwarded-for", () => {
    expect(
      extractClientIp(getterFrom({ "x-forwarded-for": "198.51.100.5, 10.0.0.1, 10.0.0.2" })),
    ).toBe("198.51.100.5");
  });

  it("returns null when no IP header is present (caller then fails open)", () => {
    expect(extractClientIp(getterFrom({}))).toBeNull();
    expect(extractClientIp(getterFrom({ "x-forwarded-for": "   " }))).toBeNull();
  });
});

describe("throttleKeySource", () => {
  it("builds a canonical, PII-free source string (hashed by the caller before storage)", () => {
    const src = throttleKeySource({ scope: "ip:submit", identifier: "203.0.113.7", bucket: 42 });
    expect(src).toBe("ip:submit|203.0.113.7|42");
  });

  it("changes per scope, identifier, and window bucket (so windows/keys are distinct)", () => {
    const base = { scope: "ip:submit", identifier: "203.0.113.7", bucket: 42 };
    expect(throttleKeySource({ ...base, bucket: 43 })).not.toBe(throttleKeySource(base));
    expect(throttleKeySource({ ...base, identifier: "203.0.113.8" })).not.toBe(throttleKeySource(base));
    expect(throttleKeySource({ ...base, scope: "email:submit" })).not.toBe(throttleKeySource(base));
  });
});

describe("isWithinLimit", () => {
  it("allows counts up to and including the limit, then blocks", () => {
    const plan = { limit: 3, windowSeconds: 60 };
    expect(isWithinLimit(1, plan)).toBe(true);
    expect(isWithinLimit(3, plan)).toBe(true);
    expect(isWithinLimit(4, plan)).toBe(false);
  });
});

describe("rateLimitedResponseBody", () => {
  it("is a friendly, internals-free body with the stable machine code + retry hint", () => {
    const body = rateLimitedResponseBody(30);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("rate_limited");
    expect(typeof body.message).toBe("string");
    expect((body.message as string).length).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBe(30);
    // No internal/throttle detail leaks (no key, count, limit, window).
    for (const k of ["keyHash", "key_hash", "count", "limit", "windowSeconds", "ip", "email"]) {
      expect(k in body).toBe(false);
    }
  });

  it("floors a fractional retry and never goes negative", () => {
    expect(rateLimitedResponseBody(12.9).retryAfterSeconds).toBe(12);
    expect(rateLimitedResponseBody(-5).retryAfterSeconds).toBe(0);
  });
});
