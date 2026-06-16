-- ============================================================================
-- CleanOps — ASSET CENTER (Phase 1): unified Media & Documents foundation.
-- ============================================================================
--
-- PURPOSE
--   Lay the Supabase-authoritative DATA foundation for the future unified Asset
--   Center (global / company / customer / website-public assets covering images,
--   videos, icons, PDFs, documents and future attachments) WITHOUT building any
--   UI, without migrating the existing Customer Media Center, and without
--   touching the legacy localStorage media path (src/lib/mediaStore.ts +
--   media_assets 0027). This migration is purely additive.
--
-- WHAT THIS MIGRATION CREATES (idempotent, additive — never drops/edits 0027)
--   • current_customer_id()           — forward-compatible (NULL-today) helper.
--   • asset_is_readable() / asset_is_manageable() — shared RLS predicates.
--   • asset_categories                — GLOBAL or company top-level taxonomy.
--   • asset_folders                   — GLOBAL or company hierarchical containers.
--   • assets                          — the core asset/file record.
--   • asset_variants                  — derived renditions (thumb/preview/poster…).
--   • asset_links                     — polymorphic placements/usages.
--   • asset_copy_history              — independent global→company copy audit.
--   • asset_activity_events           — append-only lifecycle/audit trail.
--   Plus indexes, an updated_at trigger, the FULL explicit RLS policy set, and a
--   seed of the 4 default GLOBAL categories + the Website/Public-Pages folders.
--
-- KEY ARCHITECTURAL RULES ENCODED HERE
--   1. An asset/file is NOT the same as where it is used → asset_links.
--   2. A company copy of a global asset is INDEPENDENT: copied_from_asset_id /
--      source_asset_id are PLAIN uuids (NO foreign key) so the audit reference
--      survives even if the global original is later deleted.
--   3. visibility = 'public' (website_public / global_public) is the ONLY thing
--      anon/unauthenticated visitors can read. Everything else is default-deny.
--   4. Signed URLs are NEVER stored — only storage_bucket + storage_path are.
--   5. Removal is archive (archived_at) / soft-delete (deleted_at); there is NO
--      DELETE policy on any table.
--
-- COMPATIBILITY
--   New tables/functions only. Nothing here reads or changes media_assets,
--   modules, time_codes, services, customers, work orders, or any other domain.
-- ============================================================================

-- ── 0. Shared updated_at trigger fn (Asset Center) ──────────────────────────
create or replace function set_asset_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 0b. current_customer_id() — forward-compatible customer scope helper ─────
-- The customer ↔ profile mapping does not exist yet (profiles has no
-- customer_id), so this SAFELY resolves to NULL today. Customer-scoped read
-- policies compare a row's customer_id against it; since `x = NULL` is NULL
-- (never true), a customer therefore reads NOTHING via that branch until real
-- customer auth wires this up — a deliberately safe default. Centralised here so
-- enabling customer access later is a single-function change, not an RLS rewrite.
create or replace function current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid;
$$;

-- ── 0c. Shared RLS predicates (keep assets / variants / links consistent) ────
-- Read decision for a (company, scope, visibility, customer) tuple. Plain SQL
-- (delegates the privileged lookups to the existing SECURITY DEFINER helpers
-- is_super_admin()/current_company_id()/current_base_role()/current_customer_id()).
create or replace function asset_is_readable(
  p_company_id  uuid,
  p_scope       text,
  p_visibility  text,
  p_customer_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    -- Super admin sees everything.
    public.is_super_admin()
    -- Anything explicitly public is world-readable (website/global public).
    or (p_visibility = 'public')
    -- The GLOBAL library is template/source material every signed-in user may
    -- browse (mirrors the world-readable modules / settings_templates model);
    -- 'restricted' global assets stay super-admin-only.
    or (p_scope in ('global_internal', 'global_public') and p_visibility <> 'restricted')
    or (p_scope = 'website_public')
    -- Company staff read their own company's assets.
    or (
      p_company_id is not null
      and p_company_id = public.current_company_id()
      and public.current_base_role() in ('company_admin', 'employee')
    )
    -- A customer reads ONLY their own customer-visible assets. NULL-safe: off
    -- until current_customer_id() is wired (see helper above).
    or (
      p_visibility = 'customer_visible'
      and p_company_id is not null
      and p_company_id = public.current_company_id()
      and p_customer_id is not null
      and p_customer_id = public.current_customer_id()
    );
$$;

-- Manage (insert/update) decision. Super admin manages anything; a company admin
-- manages ONLY their own company's company/customer-scoped assets and may NOT
-- publish public assets (no website_public/global authoring from a company yet).
create or replace function asset_is_manageable(
  p_company_id uuid,
  p_scope      text,
  p_visibility text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    public.is_super_admin()
    or (
      public.current_base_role() = 'company_admin'
      and p_company_id is not null
      and p_company_id = public.current_company_id()
      and p_scope in (
        'company_internal', 'company_public', 'customer_internal', 'customer_visible'
      )
      and p_visibility <> 'public'
    );
$$;

-- ===========================================================================
-- 1. asset_categories  (top-level taxonomy — GLOBAL when company_id is null)
-- ===========================================================================
create table if not exists asset_categories (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  name               text not null,
  slug               text not null,
  description        text,
  icon               text,
  sort_order         integer not null default 0,
  is_system          boolean not null default false,
  metadata           jsonb not null default '{}'::jsonb,
  archived_at        timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_asset_categories_company
  on asset_categories(company_id);
create index if not exists idx_asset_categories_company_active
  on asset_categories(company_id) where deleted_at is null;
create index if not exists idx_asset_categories_sort
  on asset_categories(sort_order);
create index if not exists idx_asset_categories_slug
  on asset_categories(slug);

drop trigger if exists trg_asset_categories_updated_at on asset_categories;
create trigger trg_asset_categories_updated_at
  before update on asset_categories
  for each row execute function set_asset_updated_at();

alter table asset_categories enable row level security;

-- READ: global taxonomy is readable by every authenticated user; company
-- categories by that company's members.
drop policy if exists "asset_categories_select_global" on asset_categories;
create policy "asset_categories_select_global" on asset_categories
  for select to authenticated
  using (company_id is null);

drop policy if exists "asset_categories_select_own_company" on asset_categories;
create policy "asset_categories_select_own_company" on asset_categories
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "asset_categories_select_super_admin" on asset_categories;
create policy "asset_categories_select_super_admin" on asset_categories
  for select to authenticated using (is_super_admin());

-- WRITE: global categories super-admin only; company categories by company admin.
drop policy if exists "asset_categories_insert_super_admin" on asset_categories;
create policy "asset_categories_insert_super_admin" on asset_categories
  for insert to authenticated with check (is_super_admin());

drop policy if exists "asset_categories_insert_own_company" on asset_categories;
create policy "asset_categories_insert_own_company" on asset_categories
  for insert to authenticated
  with check (
    company_id is not null
    and company_id = current_company_id()
    and current_base_role() = 'company_admin'
  );

drop policy if exists "asset_categories_update_super_admin" on asset_categories;
create policy "asset_categories_update_super_admin" on asset_categories
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

drop policy if exists "asset_categories_update_own_company" on asset_categories;
create policy "asset_categories_update_own_company" on asset_categories
  for update to authenticated
  using (
    company_id is not null
    and company_id = current_company_id()
    and current_base_role() = 'company_admin'
  )
  with check (
    company_id is not null
    and company_id = current_company_id()
    and current_base_role() = 'company_admin'
  );

-- ===========================================================================
-- 2. asset_folders  (hierarchical containers — GLOBAL when company_id is null)
-- ===========================================================================
create table if not exists asset_folders (
  id                       uuid primary key default gen_random_uuid(),
  legacy_id                text unique not null,
  company_id               uuid references companies(id) on delete cascade,
  company_legacy_id        text,
  category_id              uuid references asset_categories(id) on delete set null,
  category_legacy_id       text,
  parent_folder_id         uuid references asset_folders(id) on delete set null,
  parent_folder_legacy_id  text,
  name                     text not null,
  slug                     text,
  description              text,
  scope                    text not null default 'company_internal',
  sort_order               integer not null default 0,
  is_system                boolean not null default false,
  metadata                 jsonb not null default '{}'::jsonb,
  created_by               text,
  updated_by               text,
  archived_at              timestamptz,
  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint asset_folders_scope_check check (scope in (
    'global_internal', 'global_public', 'company_internal', 'company_public',
    'customer_internal', 'customer_visible', 'website_public',
    'protocol_internal', 'work_order_internal', 'case_internal'
  ))
);

create index if not exists idx_asset_folders_company
  on asset_folders(company_id) where deleted_at is null;
create index if not exists idx_asset_folders_company_legacy
  on asset_folders(company_legacy_id);
create index if not exists idx_asset_folders_category
  on asset_folders(category_id);
create index if not exists idx_asset_folders_parent
  on asset_folders(parent_folder_id);

drop trigger if exists trg_asset_folders_updated_at on asset_folders;
create trigger trg_asset_folders_updated_at
  before update on asset_folders
  for each row execute function set_asset_updated_at();

alter table asset_folders enable row level security;

drop policy if exists "asset_folders_select_global" on asset_folders;
create policy "asset_folders_select_global" on asset_folders
  for select to authenticated
  using (company_id is null);

drop policy if exists "asset_folders_select_own_company" on asset_folders;
create policy "asset_folders_select_own_company" on asset_folders
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "asset_folders_select_super_admin" on asset_folders;
create policy "asset_folders_select_super_admin" on asset_folders
  for select to authenticated using (is_super_admin());

drop policy if exists "asset_folders_insert_super_admin" on asset_folders;
create policy "asset_folders_insert_super_admin" on asset_folders
  for insert to authenticated with check (is_super_admin());

drop policy if exists "asset_folders_insert_own_company" on asset_folders;
create policy "asset_folders_insert_own_company" on asset_folders
  for insert to authenticated
  with check (
    company_id is not null
    and company_id = current_company_id()
    and current_base_role() = 'company_admin'
  );

drop policy if exists "asset_folders_update_super_admin" on asset_folders;
create policy "asset_folders_update_super_admin" on asset_folders
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

drop policy if exists "asset_folders_update_own_company" on asset_folders;
create policy "asset_folders_update_own_company" on asset_folders
  for update to authenticated
  using (
    company_id is not null
    and company_id = current_company_id()
    and current_base_role() = 'company_admin'
  )
  with check (
    company_id is not null
    and company_id = current_company_id()
    and current_base_role() = 'company_admin'
  );

-- ===========================================================================
-- 3. assets  (the core asset/file record)
--    legacy_id == the app-facing id (Asset.id). company_id null = global/website.
-- ===========================================================================
create table if not exists assets (
  id                          uuid primary key default gen_random_uuid(),
  legacy_id                   text unique not null,
  company_id                  uuid references companies(id) on delete cascade,
  company_legacy_id           text,
  customer_id                 uuid references customers(id) on delete set null,
  customer_legacy_id          text,
  folder_id                   uuid references asset_folders(id) on delete set null,
  folder_legacy_id            text,
  category_id                 uuid references asset_categories(id) on delete set null,
  category_legacy_id          text,
  scope                       text not null,
  visibility                  text not null default 'internal',
  asset_type                  text not null,
  mime_type                   text,
  name                        text not null,
  title                       text,
  description                 text,
  alt_text                    text,
  tags                        text[] not null default '{}',
  storage_bucket              text,
  storage_path                text,
  -- Only populated for assets in the PUBLIC bucket. Signed URLs for private
  -- assets are minted on read and NEVER persisted here.
  public_url                  text,
  thumbnail_bucket            text,
  thumbnail_path              text,
  preview_bucket              text,
  preview_path                text,
  poster_asset_id             uuid references assets(id) on delete set null,
  width                       integer,
  height                      integer,
  duration_seconds            numeric,
  file_size                   bigint,
  checksum                    text,
  -- Independence audit: PLAIN uuids (NO FK) so the reference survives even if the
  -- source/global original is later deleted. legacy mirrors kept for app joins.
  copied_from_asset_id        uuid,
  copied_from_asset_legacy_id text,
  source_asset_id             uuid,
  source_asset_legacy_id      text,
  metadata                    jsonb not null default '{}'::jsonb,
  created_by                  text,
  updated_by                  text,
  archived_at                 timestamptz,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint assets_scope_check check (scope in (
    'global_internal', 'global_public', 'company_internal', 'company_public',
    'customer_internal', 'customer_visible', 'website_public',
    'protocol_internal', 'work_order_internal', 'case_internal'
  )),
  constraint assets_visibility_check check (visibility in (
    'internal', 'customer_visible', 'public', 'restricted'
  )),
  constraint assets_type_check check (asset_type in (
    'image', 'video', 'icon', 'pdf', 'document', 'attachment', 'other'
  ))
);

create index if not exists idx_assets_company
  on assets(company_id) where deleted_at is null;
create index if not exists idx_assets_company_legacy
  on assets(company_legacy_id);
create index if not exists idx_assets_customer
  on assets(customer_id) where deleted_at is null;
create index if not exists idx_assets_scope
  on assets(scope) where deleted_at is null;
create index if not exists idx_assets_visibility
  on assets(visibility) where deleted_at is null;
create index if not exists idx_assets_category
  on assets(category_id);
create index if not exists idx_assets_folder
  on assets(folder_id);
create index if not exists idx_assets_type
  on assets(asset_type);
create index if not exists idx_assets_copied_from
  on assets(copied_from_asset_id) where copied_from_asset_id is not null;

drop trigger if exists trg_assets_updated_at on assets;
create trigger trg_assets_updated_at
  before update on assets
  for each row execute function set_asset_updated_at();

alter table assets enable row level security;

-- READ: public (anon + authenticated) sees only explicitly public, live assets.
drop policy if exists "assets_select_public" on assets;
create policy "assets_select_public" on assets
  for select to anon, authenticated
  using (deleted_at is null and visibility = 'public');

-- READ: authenticated read decision via the shared predicate.
drop policy if exists "assets_select_authenticated" on assets;
create policy "assets_select_authenticated" on assets
  for select to authenticated
  using (
    deleted_at is null
    and asset_is_readable(company_id, scope, visibility, customer_id)
  );

-- WRITE: insert/update gated by the shared manage predicate (no DELETE policy).
drop policy if exists "assets_insert" on assets;
create policy "assets_insert" on assets
  for insert to authenticated
  with check (asset_is_manageable(company_id, scope, visibility));

drop policy if exists "assets_update" on assets;
create policy "assets_update" on assets
  for update to authenticated
  using (asset_is_manageable(company_id, scope, visibility))
  with check (asset_is_manageable(company_id, scope, visibility));

-- ===========================================================================
-- 4. asset_variants  (derived renditions; scope/visibility/company denormalised
--    from the parent so they reuse the exact same RLS predicates).
-- ===========================================================================
create table if not exists asset_variants (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  asset_id           uuid not null references assets(id) on delete cascade,
  asset_legacy_id    text not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  customer_id        uuid,
  scope              text not null,
  visibility         text not null default 'internal',
  variant_type       text not null,
  storage_bucket     text,
  storage_path       text,
  public_url         text,
  mime_type          text,
  width              integer,
  height             integer,
  duration_seconds   numeric,
  file_size          bigint,
  checksum           text,
  metadata           jsonb not null default '{}'::jsonb,
  archived_at        timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint asset_variants_type_check check (variant_type in (
    'micro', 'thumbnail', 'preview', 'poster', 'mobile', 'web_optimized',
    'transcoded_720p', 'transcoded_1080p', 'pdf_preview_image', 'original', 'other'
  ))
);

create index if not exists idx_asset_variants_asset
  on asset_variants(asset_id);
create index if not exists idx_asset_variants_asset_legacy
  on asset_variants(asset_legacy_id);
create index if not exists idx_asset_variants_type
  on asset_variants(variant_type);

drop trigger if exists trg_asset_variants_updated_at on asset_variants;
create trigger trg_asset_variants_updated_at
  before update on asset_variants
  for each row execute function set_asset_updated_at();

alter table asset_variants enable row level security;

drop policy if exists "asset_variants_select_public" on asset_variants;
create policy "asset_variants_select_public" on asset_variants
  for select to anon, authenticated
  using (deleted_at is null and visibility = 'public');

drop policy if exists "asset_variants_select_authenticated" on asset_variants;
create policy "asset_variants_select_authenticated" on asset_variants
  for select to authenticated
  using (
    deleted_at is null
    and asset_is_readable(company_id, scope, visibility, customer_id)
  );

drop policy if exists "asset_variants_insert" on asset_variants;
create policy "asset_variants_insert" on asset_variants
  for insert to authenticated
  with check (asset_is_manageable(company_id, scope, visibility));

drop policy if exists "asset_variants_update" on asset_variants;
create policy "asset_variants_update" on asset_variants
  for update to authenticated
  using (asset_is_manageable(company_id, scope, visibility))
  with check (asset_is_manageable(company_id, scope, visibility));

-- ===========================================================================
-- 5. asset_links  (polymorphic placements/usages — connects an asset to an
--    entity + placement_key, e.g. login_page / login_left_panel_video).
--    scope/visibility/company denormalised so the same RLS predicates apply and
--    public pages can resolve public placements without auth.
-- ===========================================================================
create table if not exists asset_links (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  asset_id           uuid not null references assets(id) on delete cascade,
  asset_legacy_id    text not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  customer_id        uuid,
  -- Polymorphic target. NO check constraint on entity_type/placement_key so new
  -- placements need no migration. Known examples documented in assetTypes.ts.
  entity_type        text not null,
  entity_id          text,
  placement_key      text not null,
  scope              text not null,
  visibility         text not null default 'internal',
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  metadata           jsonb not null default '{}'::jsonb,
  created_by         text,
  archived_at        timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_asset_links_asset
  on asset_links(asset_id);
create index if not exists idx_asset_links_asset_legacy
  on asset_links(asset_legacy_id);
create index if not exists idx_asset_links_entity
  on asset_links(entity_type, entity_id);
create index if not exists idx_asset_links_placement
  on asset_links(entity_type, placement_key);
create index if not exists idx_asset_links_company
  on asset_links(company_id) where deleted_at is null;

drop trigger if exists trg_asset_links_updated_at on asset_links;
create trigger trg_asset_links_updated_at
  before update on asset_links
  for each row execute function set_asset_updated_at();

alter table asset_links enable row level security;

drop policy if exists "asset_links_select_public" on asset_links;
create policy "asset_links_select_public" on asset_links
  for select to anon, authenticated
  using (deleted_at is null and visibility = 'public');

drop policy if exists "asset_links_select_authenticated" on asset_links;
create policy "asset_links_select_authenticated" on asset_links
  for select to authenticated
  using (
    deleted_at is null
    and asset_is_readable(company_id, scope, visibility, customer_id)
  );

drop policy if exists "asset_links_insert" on asset_links;
create policy "asset_links_insert" on asset_links
  for insert to authenticated
  with check (asset_is_manageable(company_id, scope, visibility));

drop policy if exists "asset_links_update" on asset_links;
create policy "asset_links_update" on asset_links
  for update to authenticated
  using (asset_is_manageable(company_id, scope, visibility))
  with check (asset_is_manageable(company_id, scope, visibility));

-- ===========================================================================
-- 6. asset_copy_history  (independent global→company copy audit; append-only)
--    source ids are PLAIN uuids (NO FK) so the trail survives source deletion.
-- ===========================================================================
create table if not exists asset_copy_history (
  id                      uuid primary key default gen_random_uuid(),
  legacy_id               text unique not null,
  source_asset_id         uuid,
  source_asset_legacy_id  text,
  source_scope            text,
  copied_asset_id         uuid references assets(id) on delete set null,
  copied_asset_legacy_id  text,
  target_company_id       uuid references companies(id) on delete cascade,
  target_company_legacy_id text,
  copied_by               text,
  note                    text,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now()
);

create index if not exists idx_asset_copy_history_source
  on asset_copy_history(source_asset_id);
create index if not exists idx_asset_copy_history_copied
  on asset_copy_history(copied_asset_id);
create index if not exists idx_asset_copy_history_company
  on asset_copy_history(target_company_id);

alter table asset_copy_history enable row level security;

drop policy if exists "asset_copy_history_select_super_admin" on asset_copy_history;
create policy "asset_copy_history_select_super_admin" on asset_copy_history
  for select to authenticated using (is_super_admin());

drop policy if exists "asset_copy_history_select_own_company" on asset_copy_history;
create policy "asset_copy_history_select_own_company" on asset_copy_history
  for select to authenticated
  using (target_company_id is not null and target_company_id = current_company_id());

drop policy if exists "asset_copy_history_insert_super_admin" on asset_copy_history;
create policy "asset_copy_history_insert_super_admin" on asset_copy_history
  for insert to authenticated with check (is_super_admin());

drop policy if exists "asset_copy_history_insert_own_company" on asset_copy_history;
create policy "asset_copy_history_insert_own_company" on asset_copy_history
  for insert to authenticated
  with check (
    target_company_id is not null
    and target_company_id = current_company_id()
    and current_base_role() = 'company_admin'
  );

-- ===========================================================================
-- 7. asset_activity_events  (append-only lifecycle/audit trail)
--    asset_id is a PLAIN uuid (NO FK) so the event survives asset deletion.
-- ===========================================================================
create table if not exists asset_activity_events (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  event_type         text not null,
  asset_id           uuid,
  asset_legacy_id    text,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  customer_id        uuid,
  customer_legacy_id text,
  actor_user_id      text,
  actor_role         text,
  scope              text,
  visibility         text,
  summary            text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  constraint asset_activity_events_type_check check (event_type in (
    'asset_uploaded', 'asset_updated', 'asset_archived', 'asset_restored',
    'asset_deleted', 'asset_copied_from_global', 'asset_linked', 'asset_unlinked',
    'asset_replaced', 'asset_visibility_changed', 'public_website_asset_changed',
    'login_page_video_changed', 'customer_file_uploaded',
    'customer_file_visibility_changed'
  ))
);

create index if not exists idx_asset_activity_asset
  on asset_activity_events(asset_id);
create index if not exists idx_asset_activity_asset_legacy
  on asset_activity_events(asset_legacy_id);
create index if not exists idx_asset_activity_company
  on asset_activity_events(company_id);
create index if not exists idx_asset_activity_type
  on asset_activity_events(event_type);
create index if not exists idx_asset_activity_created
  on asset_activity_events(created_at);

alter table asset_activity_events enable row level security;

drop policy if exists "asset_activity_select_super_admin" on asset_activity_events;
create policy "asset_activity_select_super_admin" on asset_activity_events
  for select to authenticated using (is_super_admin());

drop policy if exists "asset_activity_select_own_company" on asset_activity_events;
create policy "asset_activity_select_own_company" on asset_activity_events
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "asset_activity_insert_super_admin" on asset_activity_events;
create policy "asset_activity_insert_super_admin" on asset_activity_events
  for insert to authenticated with check (is_super_admin());

drop policy if exists "asset_activity_insert_own_company" on asset_activity_events;
create policy "asset_activity_insert_own_company" on asset_activity_events
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

-- ===========================================================================
-- 8. Seed the 4 default GLOBAL asset categories (idempotent on legacy_id)
-- ===========================================================================
insert into asset_categories (legacy_id, company_id, name, slug, description, icon, sort_order, is_system)
select s.legacy_id, null, s.name, s.slug, s.description, s.icon, s.sort_order, true
from (values
  ('asset_cat_cleaning_protocols', 'Cleaning Protocols', 'cleaning_protocols', 'Default and master media for cleaning protocols, rooms, sections and tasks.', 'clipboard-list', 0),
  ('asset_cat_services',           'Services',           'services',           'Default and master media for services and service categories.',               'sparkles',      1),
  ('asset_cat_website_public',     'Website / Public Pages', 'website_public_pages', 'Public website and marketing media: login, homepage, features, hero media, icons, SEO/social and downloadable files.', 'globe', 2),
  ('asset_cat_general',            'General Folder',     'general',            'General-purpose library. Supports custom subfolders.',                          'folder',        3)
) as s(legacy_id, name, slug, description, icon, sort_order)
where not exists (
  select 1 from asset_categories c where c.legacy_id = s.legacy_id
);

-- ===========================================================================
-- 9. Seed the GLOBAL Website / Public-Pages folders (idempotent on legacy_id)
--    These give login/homepage/getting-started/features media a home in a later
--    phase. They live under the Website / Public Pages category, scope
--    website_public. A "General" root folder anchors future custom subfolders.
-- ===========================================================================
insert into asset_folders (legacy_id, company_id, category_id, category_legacy_id, name, slug, description, scope, sort_order, is_system)
select
  s.legacy_id, null,
  (select id from asset_categories where legacy_id = s.category_legacy_id),
  s.category_legacy_id, s.name, s.slug, s.description, s.scope, s.sort_order, true
from (values
  ('asset_folder_website_login',           'asset_cat_website_public', 'Login Page',       'login',           'Login page brand panel media (video + poster/fallback image).', 'website_public', 0),
  ('asset_folder_website_homepage',        'asset_cat_website_public', 'Homepage',         'homepage',        'Homepage hero media and marketing assets.',                     'website_public', 1),
  ('asset_folder_website_getting_started', 'asset_cat_website_public', 'Getting Started',  'getting_started', 'Getting Started page media.',                                   'website_public', 2),
  ('asset_folder_website_features',        'asset_cat_website_public', 'Features',         'features',        'Features page media.',                                          'website_public', 3),
  ('asset_folder_general_root',            'asset_cat_general',        'General',          'general',         'Root general-purpose folder. Custom subfolders attach here.',   'global_internal', 0)
) as s(legacy_id, category_legacy_id, name, slug, description, scope, sort_order)
where not exists (
  select 1 from asset_folders f where f.legacy_id = s.legacy_id
);
