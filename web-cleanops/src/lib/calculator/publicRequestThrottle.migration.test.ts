import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Slice 12B — public request throttle (abuse protection) for the
 * `public-calculator` Edge Function.
 *
 * Migration 0064 adds a PII-free fixed-window counter table + the atomic
 * `record_public_request` RPC the function uses to rate-limit anonymous traffic
 * (per IP, plus a per-email submit cap) and a bounded-retention purge. These
 * tests lock in the security model from the migration TEXT (no DB needed):
 *   • RLS enabled with NO client policies (service-role only).
 *   • Only an opaque hashed key is stored — no raw IP / email / PII column.
 *   • The RPCs are SECURITY DEFINER with a pinned search_path, execute revoked
 *     from anon/authenticated and granted ONLY to service_role.
 *   • The migration is idempotent and changes no adjacent table.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readMigration(file: string): string {
  return readFileSync(path.resolve(__dirname, "../../../supabase/migrations", file), "utf8");
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .toLowerCase();
}

const rawSql = readMigration("0064_public_request_throttle.sql");
const sql = stripSqlComments(rawSql);

describe("0064 — public_request_throttle table", () => {
  it("creates the table idempotently", () => {
    expect(sql).toContain("create table if not exists public_request_throttle");
  });

  it("enables RLS and defines NO client policy (service-role only)", () => {
    expect(sql).toContain("alter table public_request_throttle enable row level security");
    // The whole point: there is NO policy on this table — anon/authenticated get
    // zero access; the service role reaches it only via the RPCs.
    expect(sql).not.toMatch(/create\s+policy[\s\S]*on\s+public_request_throttle/);
  });

  it("stores ONLY an opaque hashed key + counters (no raw IP / email / PII column)", () => {
    for (const column of ["key_hash", "request_count", "window_started_at", "expires_at"]) {
      expect(sql).toContain(column);
    }
    // A CHECK forces the key to be a hex digest, so a raw value cannot be stored.
    expect(sql).toMatch(/check\s*\(\s*key_hash\s*~\s*'\^\[a-f0-9\]\{64\}\$'/);
    // No identifier/PII columns exist on the table.
    for (const banned of ["ip ", "ip_address", "email", "phone", "address", "postal", "raw_ip", "identifier"]) {
      expect(sql).not.toContain(banned);
    }
  });

  it("indexes expires_at for bounded retention", () => {
    expect(sql).toContain("idx_public_request_throttle_expires");
  });
});

describe("0064 — record_public_request RPC (atomic counter)", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(sql).toContain("create or replace function public.record_public_request");
    expect(sql).toMatch(/record_public_request[\s\S]*security definer/);
    expect(sql).toMatch(/record_public_request[\s\S]*set search_path = public/);
  });

  it("does the atomic check-and-increment in a single upsert (no read-then-write race)", () => {
    expect(sql).toMatch(/insert into public\.public_request_throttle[\s\S]*on conflict \(key_hash\) do update[\s\S]*request_count = t\.request_count \+ 1/);
  });

  it("validates the key is a digest (cannot smuggle a raw identifier into storage)", () => {
    expect(sql).toMatch(/p_key_hash\s*!~\s*'\^\[a-f0-9\]\{64\}\$'/);
  });

  it("self-prunes expired rows so the table stays bounded without a scheduler", () => {
    expect(sql).toMatch(/delete from public\.public_request_throttle[\s\S]*expires_at < /);
  });
});

describe("0064 — execute lockdown (service-role only)", () => {
  it("revokes execute from anon/authenticated and grants ONLY service_role", () => {
    for (const fn of [
      "public.record_public_request(text, integer, integer)",
      "public.purge_expired_public_request_throttle()",
    ]) {
      expect(sql).toContain(`revoke all on function ${fn} from anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${fn} to service_role`);
    }
    // Never granted to the browser roles.
    expect(sql).not.toMatch(/grant execute on function public\.record_public_request[\s\S]*to (anon|authenticated)/);
  });
});

describe("0064 — scope guard (additive, no enable, no adjacent table)", () => {
  it("never flips the calculator on or touches calculator/lead tables", () => {
    expect(sql).not.toContain("calculator_settings");
    expect(sql).not.toContain("enabled = true");
    for (const table of ["prospects", "quote_requests", "quote_request_answers", "pricing_rules", "calculator_services"]) {
      expect(sql).not.toMatch(
        new RegExp(`\\b(insert\\s+into|update|delete\\s+from|alter\\s+table|create\\s+policy[\\s\\S]*on)\\s+${table}\\b`),
      );
    }
  });

  it("is idempotent (safe to re-run)", () => {
    expect(sql).toContain("create table if not exists public_request_throttle");
    expect(sql).toContain("create or replace function public.record_public_request");
    expect(sql).toContain("create or replace function public.purge_expired_public_request_throttle");
    expect(sql).toContain("create index if not exists idx_public_request_throttle_expires");
  });
});
