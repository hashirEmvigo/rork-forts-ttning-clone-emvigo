-- ============================================================================
-- CleanOps — Step 2B (provisioning): AUTOMATIC PROFILE PROVISIONING
-- ============================================================================
--
-- Goal:
--   Guarantee that EVERY auth.users row always has EXACTLY ONE matching
--   profiles row, created AUTOMATICALLY, FAIL-CLOSED, at user-creation time.
--
-- Assumptions for this simplified first implementation:
--   * All users are ADMIN-CREATED (by Super Admin or Company Admin).
--   * No public signup / no self-registration / no customer self-signup.
--   * company_id and base_role are SUPPLIED at creation time via the new
--     auth user's metadata (raw_user_meta_data).
--   * No "pending / unassigned" workflow.
--
-- FAIL-CLOSED contract:
--   If the required provisioning data (base_role, and company_id when the role
--   requires it) is missing or invalid, the trigger RAISES an exception. Because
--   the trigger fires inside the SAME transaction as the auth.users INSERT, the
--   exception ROLLS BACK the auth user creation as well. Result: you can NEVER
--   end up with an auth user that has no profile, or a profile that violates the
--   role/company rules from migration 0003.
--
-- IMPORTANT — what this does NOT do (still deferred):
--   * No custom JWT claims, no auth hooks.
--   * No change to the existing localStorage login.
--   * No migration of existing demo users.
--   * No new login UI.
--   * No write access to other modules.
--
-- HOW ADMINS SUPPLY company_id / base_role:
--   When creating a user (Dashboard "Add user", or later an admin API call using
--   the service role), pass user metadata, e.g.:
--
--     {
--       "base_role":  "company_admin",
--       "company_id": "<companies.id uuid>",
--       "full_name":  "Nordlys Admin"
--     }
--
--   In the Supabase Dashboard "Add user" form this is the "User Metadata" /
--   raw_user_meta_data field. Via the Admin API it is the `user_metadata` arg.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. PROVISIONING FUNCTION (SECURITY DEFINER, fail-closed)
--
--    Runs as the function OWNER so it can INSERT into public.profiles even
--    though there is no INSERT policy for authenticated/anon roles (0003 left
--    INSERT intentionally policy-less = denied). `set search_path = ''` with
--    fully-qualified names hardens against search_path hijacking.
--
--    Reads provisioning data from NEW.raw_user_meta_data:
--      * base_role  (required)        — must be one of the 4 allowed roles.
--      * company_id (conditionally    — required for every role EXCEPT
--                    required)          super_admin; must be NULL for super_admin
--                                       is allowed, must reference companies(id).
--      * full_name  (optional)
--
--    Email is taken from NEW.email so it always matches the auth user.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_role  text;
  v_company_id uuid;
  v_full_name  text;
  v_company_raw text;
begin
  -- Pull provisioning data from the new auth user's metadata.
  v_base_role   := nullif(trim(new.raw_user_meta_data ->> 'base_role'), '');
  v_company_raw := nullif(trim(new.raw_user_meta_data ->> 'company_id'), '');
  v_full_name   := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');

  -- ── FAIL-CLOSED: base_role is mandatory and must be valid. ──────────────
  if v_base_role is null then
    raise exception
      'Profile provisioning failed: base_role is required in user metadata for %',
      new.email
      using errcode = 'check_violation';
  end if;

  if v_base_role not in ('super_admin', 'company_admin', 'employee', 'customer') then
    raise exception
      'Profile provisioning failed: invalid base_role "%" for %',
      v_base_role, new.email
      using errcode = 'check_violation';
  end if;

  -- ── Parse company_id (if supplied) and FAIL-CLOSED on a malformed uuid. ─
  if v_company_raw is not null then
    begin
      v_company_id := v_company_raw::uuid;
    exception when others then
      raise exception
        'Profile provisioning failed: company_id "%" is not a valid uuid for %',
        v_company_raw, new.email
        using errcode = 'check_violation';
    end;
  else
    v_company_id := null;
  end if;

  -- ── FAIL-CLOSED: company_id rules mirror migration 0003. ────────────────
  --    super_admin  → company_id MUST be NULL (a super admin is platform-wide).
  --    everyone else→ company_id is REQUIRED and must reference a real company.
  if v_base_role = 'super_admin' then
    if v_company_id is not null then
      raise exception
        'Profile provisioning failed: super_admin must NOT have a company_id (%)',
        new.email
        using errcode = 'check_violation';
    end if;
  else
    if v_company_id is null then
      raise exception
        'Profile provisioning failed: company_id is required for role "%" (%)',
        v_base_role, new.email
        using errcode = 'check_violation';
    end if;

    if not exists (select 1 from public.companies where id = v_company_id) then
      raise exception
        'Profile provisioning failed: company_id "%" does not exist (%)',
        v_company_id, new.email
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- ── Create the matching profile row (exactly one, id == auth.users.id). ─
  --    `status` defaults to 'active' (no pending workflow for now).
  insert into public.profiles (id, company_id, base_role, full_name, email, status)
  values (new.id, v_company_id, v_base_role, v_full_name, new.email, 'active');

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. TRIGGER ON auth.users
--
--    AFTER INSERT, FOR EACH ROW. Fires in the same transaction as the auth
--    user creation, so a RAISE above rolls the whole creation back (fail-closed).
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_auth_user();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ONE-PROFILE-PER-USER GUARANTEE (defense in depth)
--
--    profiles.id is already a PRIMARY KEY referencing auth.users(id), so a
--    second profile for the same auth user is impossible at the DB level.
--    The ON DELETE CASCADE from 0003 means deleting an auth user removes its
--    profile too. Together with the fail-closed trigger this gives the exact
--    invariant: every auth.users row has EXACTLY ONE profiles row.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ROLLBACK (safe, reversible)
--
--    This migration is additive and easy to undo. To fully roll back, run:
--
--      drop trigger if exists trg_on_auth_user_created on auth.users;
--      drop function if exists handle_new_auth_user();
--
--    After rollback, new auth users would again be created WITHOUT a profile
--    (the pre-0004 behaviour), so only roll back if you intend to provision
--    profiles by another means. Existing profiles are left untouched.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 5. HOW TO TEST (reference only — run manually as service role)
--
--    Success (company_admin with valid company):
--      Dashboard → Authentication → Add user
--        email: admin2@nordlys.example   (Auto Confirm)
--        User Metadata:
--          { "base_role": "company_admin",
--            "company_id": "<a real companies.id>",
--            "full_name": "Second Nordlys Admin" }
--      → auth user is created AND a matching profile appears automatically.
--
--    Fail-closed (missing base_role):
--      Add user with empty/!no metadata → creation is REJECTED, no auth user,
--      no profile. (You'll see the provisioning exception message.)
--
--    Fail-closed (employee without company_id):
--      metadata { "base_role": "employee" } → REJECTED.
--
--    Super admin (company_id must be NULL):
--      metadata { "base_role": "super_admin", "full_name": "Owner" } → OK.
-- ─────────────────────────────────────────────────────────────────────────
