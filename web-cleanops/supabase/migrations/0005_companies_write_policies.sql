-- ============================================================================
-- CleanOps — Companies WRITE policies (super_admin only)
-- ============================================================================
--
-- Context:
--   0002_companies_table.sql created the `companies` table with a permissive
--   read-only placeholder policy and NO write policies, so every INSERT/UPDATE
--   was blocked by RLS. Now that Supabase Auth is live and a `profiles` row
--   identifies super admins (see 0003_profiles_auth_foundation.sql), we can let
--   a signed-in super_admin create and update companies directly.
--
-- Why this is safe:
--   * `is_super_admin()` is a SECURITY DEFINER helper that resolves the caller's
--     role from `profiles` using auth.uid() — no recursion, no client trust.
--   * Only the `authenticated` role is granted; anon stays read-only.
--   * No DELETE policy is added, so company deletion remains blocked.
--
-- Apply this in the Supabase SQL editor (or via your migration tooling).
-- ============================================================================

-- INSERT: only a signed-in super_admin may create companies.
drop policy if exists "companies_insert_super_admin" on companies;
create policy "companies_insert_super_admin" on companies
  for insert
  to authenticated
  with check (is_super_admin());

-- UPDATE: only a signed-in super_admin may modify companies.
drop policy if exists "companies_update_super_admin" on companies;
create policy "companies_update_super_admin" on companies
  for update
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());
