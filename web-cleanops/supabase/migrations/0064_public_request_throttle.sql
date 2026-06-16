-- ============================================================================
-- CleanOps — PUBLIC PRICE CALCULATOR (Slice 12B): PUBLIC REQUEST THROTTLE
-- ============================================================================
--
-- PURPOSE
--   The public calculator's only entry point is the `public-calculator` Edge
--   Function (service role, verify_jwt=false). Before this slice it had no abuse
--   protection (documented blocker #4 in the pre-launch runbook). This migration
--   adds the storage + the single atomic primitive the function uses to rate-limit
--   anonymous traffic per IP (config/calculate/submit) and to cap submissions per
--   email — WITHOUT ever storing a raw IP, a raw email, or any PII.
--
-- WHAT IS STORED (presentation-free, PII-free counters only)
--   • key_hash          — an OPAQUE HMAC-SHA256 hex digest (64 lowercase hex
--                          chars) the Edge Function derives from a server-only
--                          secret + a canonical "scope|identifier|window-bucket"
--                          string. The raw IP / email NEVER reach the database —
--                          only this irreversible, non-enumerable digest does.
--   • request_count     — the number of hits seen in the current fixed window.
--   • window_started_at — when this window opened (the bucket is baked into the
--                          key_hash, so a new window naturally starts a new row).
--   • expires_at        — when the row may be purged (bounded retention).
--   There are NO contact, IP, email, address, or free-text columns — a CHECK on
--   the hash format additionally guarantees the key is a digest, never a value.
--
-- SECURITY POSTURE (service-role only; no anon/authenticated surface at all)
--   • RLS is ENABLED with NO client policies, so anon/authenticated callers can
--     neither read nor write the table (every public access already flows through
--     the service-role Edge Function — same boundary as the calculator tables in
--     0058/0059). The service role bypasses RLS for the function's own use.
--   • The ONLY way to mutate a counter is the SECURITY DEFINER
--     `record_public_request` RPC below — an atomic INSERT … ON CONFLICT … that
--     can never be raced, mirroring the `allocate_number` (0043) precedent.
--   • EXECUTE on both RPCs is REVOKED from public/anon/authenticated and GRANTED
--     ONLY to `service_role`, so even the RPC surface is closed to the browser.
--
-- COMPATIBILITY
--   Purely additive. Touches no existing table, policy, RPC, or app behaviour and
--   stores nothing about a person. Does NOT enable the calculator
--   (calculator_settings.enabled stays false) and does NOT change pricing, the
--   write path, or any business data.
--
-- IDEMPOTENT: create-if-not-exists + create-or-replace + drop-if-exists policies,
-- so re-running is a safe no-op.
-- ============================================================================

-- ===========================================================================
-- 1. public_request_throttle  (PII-free fixed-window counters, keyed by digest)
-- ===========================================================================
create table if not exists public_request_throttle (
  -- Opaque HMAC-SHA256 hex digest of "scope|identifier|window-bucket". NOT a raw
  -- IP/email — the function hashes those with a server-only secret before this.
  key_hash           text primary key,
  request_count      integer not null default 0,
  window_started_at  timestamptz not null default now(),
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),

  -- Defence-in-depth: the key MUST be a 64-char lowercase hex digest. This makes
  -- it structurally impossible to persist a raw IP/email/identifier in this column.
  constraint public_request_throttle_key_is_digest
    check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint public_request_throttle_count_nonneg
    check (request_count >= 0)
);

-- Supports the bounded retention sweep (purge rows whose window has expired).
create index if not exists idx_public_request_throttle_expires
  on public_request_throttle(expires_at);

-- ── RLS: enabled, NO client policies (service-role only) ────────────────────
-- No SELECT/INSERT/UPDATE/DELETE policy is defined on purpose: anon and
-- authenticated callers get ZERO access. The service-role Edge Function reaches
-- the table only through the SECURITY DEFINER RPCs below.
alter table public_request_throttle enable row level security;

-- ===========================================================================
-- 2. record_public_request  (atomic fixed-window check-and-increment)
-- ===========================================================================
--   Returns one row: (allowed, current_count, retry_after_seconds).
--     • allowed             → current_count <= p_limit for this window.
--     • current_count       → the hit count AFTER this call (this call counts).
--     • retry_after_seconds → whole seconds until the current window expires.
--
--   Atomicity: a single INSERT … ON CONFLICT DO UPDATE … RETURNING. The window
--   bucket is encoded in p_key_hash (computed by the function), so a new window
--   inserts a fresh row and an in-window hit locks the existing row and bumps the
--   counter by exactly 1 — concurrent callers serialise, no read-then-write race.
--
--   Self-pruning: ~5% of calls purge a small bounded batch of globally-expired
--   rows, so the table stays small without any scheduler. The dedicated
--   purge_expired_public_request_throttle() RPC below allows an explicit sweep.
--
--   The function validates that p_key_hash is a 64-char hex digest, so a caller
--   can never smuggle a raw identifier into storage through this path.
-- ===========================================================================
create or replace function public.record_public_request(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, current_count integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_limit integer := greatest(coalesce(p_limit, 1), 1);
  v_now timestamptz := now();
  v_count integer;
  v_expires timestamptz;
begin
  if p_key_hash is null or btrim(p_key_hash) = '' then
    raise exception 'A key hash is required.';
  end if;
  -- The key MUST already be a digest; reject anything that could be a raw value.
  if p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid key hash format (expected a 64-char hex digest).';
  end if;

  -- Opportunistic, bounded self-pruning (no scheduler needed). Kept cheap: a
  -- small batch, only ~5% of calls, indexed by expires_at.
  if random() < 0.05 then
    delete from public.public_request_throttle
     where ctid in (
       select ctid
         from public.public_request_throttle
        where expires_at < v_now
        limit 100
     );
  end if;

  -- Atomic check-and-increment for THIS window (bucket baked into the key hash).
  insert into public.public_request_throttle as t (
    key_hash, request_count, window_started_at, expires_at
  )
  values (
    p_key_hash, 1, v_now, v_now + make_interval(secs => v_window_seconds)
  )
  on conflict (key_hash) do update
    set request_count = t.request_count + 1
  returning t.request_count, t.expires_at into v_count, v_expires;

  return query
    select
      (v_count <= v_limit) as allowed,
      v_count as current_count,
      greatest(ceil(extract(epoch from (v_expires - v_now)))::integer, 0)
        as retry_after_seconds;
end;
$$;

-- ===========================================================================
-- 3. purge_expired_public_request_throttle  (explicit bounded retention sweep)
-- ===========================================================================
--   Deletes all rows whose window has expired and returns how many were removed.
--   Safe to call from an operational/scheduled job; the per-call opportunistic
--   sweep above already keeps the table small in normal operation.
-- ===========================================================================
create or replace function public.purge_expired_public_request_throttle()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.public_request_throttle
   where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ── EXECUTE lockdown: service-role only ─────────────────────────────────────
-- Strip the default PUBLIC execute grant and any anon/authenticated access, then
-- grant ONLY to service_role (the Edge Function's role). The browser can never
-- call these — there is no anon/authenticated path to the throttle at all.
revoke all on function public.record_public_request(text, integer, integer) from public;
revoke all on function public.record_public_request(text, integer, integer) from anon, authenticated;
grant execute on function public.record_public_request(text, integer, integer) to service_role;

revoke all on function public.purge_expired_public_request_throttle() from public;
revoke all on function public.purge_expired_public_request_throttle() from anon, authenticated;
grant execute on function public.purge_expired_public_request_throttle() to service_role;

-- ============================================================================
-- INTENTIONALLY NOT INCLUDED (scope guard for this slice)
--   • No anon/authenticated RLS policy and no client RPC grant — the throttle is
--     a server-only concern reached solely by the service-role Edge Function.
--   • No raw IP / email / contact / address column — only an irreversible digest.
--   • No change to calculator_settings.enabled (the calculator stays dark) and no
--     change to pricing, the submit write path, or any business table.
-- ============================================================================
