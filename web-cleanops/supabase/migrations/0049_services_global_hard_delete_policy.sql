-- ============================================================================
-- CleanOps — SVCCAT: GLOBAL service hard-delete policy
-- ============================================================================
--
-- Migration 0018 deliberately shipped NO delete policy on `services`, so DELETE
-- was blocked for everyone and removal was a soft-delete UPDATE (deleted_at).
-- The Super Admin master catalog now needs a TRUE permanent delete for GLOBAL
-- template services (the library rows where company_id is null).
--
-- ISOLATION GUARANTEE (why this is safe):
--   Company-owned services (company_id is not null) are INDEPENDENT deep copies a
--   tenant created when it copied a package/service into its own catalog — they
--   share no id and no live FK with the global template. Permanently removing a
--   global template must therefore never be able to reach a company's copy. This
--   policy encodes that guarantee at the database level:
--
--     * DELETE is allowed ONLY for an authenticated super_admin
--       (is_super_admin(), the SECURITY DEFINER helper from
--       0003_profiles_auth_foundation.sql), AND
--     * ONLY for GLOBAL rows (company_id is null).
--
--   A DELETE that targets a company-owned row matches NO policy row and removes
--   nothing. The app treats a 0-row delete as a failure and keeps the service
--   visible, so a tenant's catalog, work orders, schedules and customers are
--   never affected.
--
-- Soft-delete (deleted_at) remains the removal path for COMPANY services via the
-- existing UPDATE policies; this migration only adds the global hard-delete seam.
-- ============================================================================

drop policy if exists "services_delete_super_admin_global" on services;
create policy "services_delete_super_admin_global" on services
  for delete
  to authenticated
  using (is_super_admin() and company_id is null);
