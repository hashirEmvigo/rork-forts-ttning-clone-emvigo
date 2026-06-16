-- ============================================================================
-- CleanOps — ASSET CENTER (Phase 1): Supabase Storage buckets + storage RLS.
-- ============================================================================
--
-- PURPOSE
--   Provision the two storage buckets the future Asset Center uses and lock down
--   storage.objects so that:
--     • public-assets  — website/public/global-public media (videos, posters,
--                        hero images, icons, SEO/social images, public PDFs).
--                        Publicly readable; only Super Admin may write.
--     • private-assets — company-internal, customer files, protocol/work-order
--                        media, future case files. NEVER public. Read/write
--                        scoped to the owning company's STAFF (company_admin /
--                        employee) by path, plus full Super-Admin access.
--
-- PATH CONVENTIONS (the company segment is the company UUID so storage RLS can
-- match it against current_company_id()):
--   PUBLIC (public-assets):
--     website/login/{assetId}/original.ext        website/login/{assetId}/poster.webp
--     website/homepage/{assetId}/hero.webp        website/features/{assetId}/hero.webp
--     global/public/{category}/{assetId}/...
--   PRIVATE (private-assets):
--     global/internal/{assetId}/...               (Super-Admin only)
--     companies/{companyUuid}/library/{assetId}/original.ext
--     companies/{companyUuid}/customers/{customerId}/{assetId}/original.ext
--     companies/{companyUuid}/protocols/{protocolId}/{assetId}/...
--     companies/{companyUuid}/work-orders/{workOrderId}/{assetId}/...
--
-- NOTES
--   • file_size_limit = 50 MB per object. allowed_mime_types is left NULL (no
--     hard DB restriction) on purpose — type/size validation lives in
--     src/lib/assets/assetStorage.ts so adding a new type never needs a DB change.
--   • Customers get NO direct storage access in Phase 1 (their reads come later
--     via server-minted signed URLs / the Customer Media Center migration). This
--     is a deliberately safe default.
--   • Idempotent: bucket upsert via on-conflict; every policy is drop-then-create.
-- ============================================================================

-- ── 1. Buckets ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('public-assets',  'public-assets',  true,  52428800),
  ('private-assets', 'private-assets', false, 52428800)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── 2. public-assets policies ────────────────────────────────────────────────
-- READ: anyone (anon + authenticated). The bucket is also flagged public so
-- object public URLs resolve without a session; this policy covers API reads.
drop policy if exists "public_assets_read" on storage.objects;
create policy "public_assets_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'public-assets');

-- WRITE: Super Admin only (website/public/global-public media is Super-Admin
-- governed in Phase 1; company publishing to public is a later, gated slice).
drop policy if exists "public_assets_super_admin_write" on storage.objects;
create policy "public_assets_super_admin_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-assets' and public.is_super_admin())
  with check (bucket_id = 'public-assets' and public.is_super_admin());

-- ── 3. private-assets policies ───────────────────────────────────────────────
-- Super Admin: full access (covers global/internal/... and any company path).
drop policy if exists "private_assets_super_admin_all" on storage.objects;
create policy "private_assets_super_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'private-assets' and public.is_super_admin())
  with check (bucket_id = 'private-assets' and public.is_super_admin());

-- Company STAFF (company_admin / employee): access ONLY objects under their own
-- company's folder — companies/{theirCompanyUuid}/... . The path's 1st segment
-- must be 'companies' and the 2nd segment must equal current_company_id().
-- Customers are intentionally excluded (no direct storage access in Phase 1).
drop policy if exists "private_assets_company_staff_all" on storage.objects;
create policy "private_assets_company_staff_all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'private-assets'
    and public.current_base_role() in ('company_admin', 'employee')
    and (storage.foldername(name))[1] = 'companies'
    and (storage.foldername(name))[2] = public.current_company_id()::text
  )
  with check (
    bucket_id = 'private-assets'
    and public.current_base_role() in ('company_admin', 'employee')
    and (storage.foldername(name))[1] = 'companies'
    and (storage.foldername(name))[2] = public.current_company_id()::text
  );
