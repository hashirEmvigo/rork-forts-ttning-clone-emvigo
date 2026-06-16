-- ============================================================================
-- CleanOps — Tighten companies_read_placeholder RLS policy
-- ============================================================================
--
-- Context:
--   0002_companies_table.sql created a permissive USING (true) placeholder
--   so the anon role could read companies before Supabase Auth existed.
--   Now that Auth is live (0003) and write policies are already scoped to
--   authenticated + is_super_admin() (0005), the read policy must be
--   tightened to least-privilege.
--
-- What changes:
--   - Anonymous users can no longer list companies.
--   - Authenticated users can read only their own company (the company
--     linked via current_company_id() from their profile).
--   - Super admins retain full read access to all companies.
--
-- app-level impact:
--   - getCompaniesFromSupabase() already falls back to localStorage when
--     Supabase returns zero rows (RLS-filtered), so the public calculator
--     and unauthenticated pages are safe.
--   - resolveCompanyAppId() looks up a single company by UUID — an
--     authenticated user resolving their own company_id will match
--     id = current_company_id(), so identity resolution still works.
--   - Admin pages that list all companies require a super_admin session,
--     which passes the is_super_admin() check.
--
-- Idempotent — safe to run multiple times.
-- ============================================================================

drop policy if exists "companies_read_placeholder" on companies;
create policy "companies_read_placeholder" on companies
  for select
  to authenticated
  using (is_super_admin() or id = current_company_id());
