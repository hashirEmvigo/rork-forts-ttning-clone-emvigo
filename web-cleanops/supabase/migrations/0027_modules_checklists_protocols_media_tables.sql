-- ============================================================================
-- CleanOps — MCPM: Modules · Checklists · Protocols · Media (final localStorage
--   retirement wave). Four domains, six tables:
--     modules · module_categories · company_modules   (Modules)
--     checklist_templates                              (Checklists, aggregate)
--     customer_protocols                               (Protocols, aggregate)
--     media_assets                                     (Media)
-- ============================================================================
--
-- DESIGN
--   • Modules / Module Categories are GLOBAL master data (the catalogue carries
--     no companyId), so they reuse the settings_templates / service_packages
--     model: world-readable by every authenticated user, Super-Admin governed
--     writes. company_modules is the COMPANY-scoped per-company configuration.
--   • Checklist templates and customer protocols are HIERARCHIES
--     (template → sections → items). With no production data to preserve we take
--     the cleanest model: one row PER top-level aggregate, with the full nested
--     structure carried losslessly in `data jsonb`. Flat columns carry only what
--     list / RLS / id-resolution need. Checklist templates can be GLOBAL
--     (scope = 'global', company_id null) or company-owned (reuse the roles
--     model); customer protocols are always company + customer scoped.
--   • Media assets are flat, company-scoped (reuse the Areas model).
--
-- All tables: legacy_id unique key (the app-facing id), WO-5.6 `deleted_at`
-- soft-delete (an upsert UNDELETES), updated_at trigger. No DELETE policy on any
-- table — removal is a soft-delete UPDATE.
-- ============================================================================

create or replace function set_mcpm_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. modules  (GLOBAL master data — company_id always null)
-- ===========================================================================
create table if not exists modules (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique not null,
  name          text not null,
  -- 'active' | 'inactive' | 'archived' (mirrors EntityStatus).
  status        text not null default 'active',
  data          jsonb not null default '{}'::jsonb,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_modules_name on modules(name);
create index if not exists idx_modules_active
  on modules(name) where deleted_at is null;

drop trigger if exists trg_modules_updated_at on modules;
create trigger trg_modules_updated_at
  before update on modules
  for each row execute function set_mcpm_updated_at();

alter table modules enable row level security;

drop policy if exists "modules_select_global" on modules;
create policy "modules_select_global" on modules
  for select to authenticated using (true);

drop policy if exists "modules_insert_super_admin" on modules;
create policy "modules_insert_super_admin" on modules
  for insert to authenticated with check (is_super_admin());

drop policy if exists "modules_update_super_admin" on modules;
create policy "modules_update_super_admin" on modules
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 2. module_categories  (GLOBAL master data — company_id always null)
-- ===========================================================================
create table if not exists module_categories (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique not null,
  name          text not null,
  status        text not null default 'active',
  sort_order    integer not null default 0,
  data          jsonb not null default '{}'::jsonb,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_module_categories_sort on module_categories(sort_order);
create index if not exists idx_module_categories_active
  on module_categories(sort_order) where deleted_at is null;

drop trigger if exists trg_module_categories_updated_at on module_categories;
create trigger trg_module_categories_updated_at
  before update on module_categories
  for each row execute function set_mcpm_updated_at();

alter table module_categories enable row level security;

drop policy if exists "module_categories_select_global" on module_categories;
create policy "module_categories_select_global" on module_categories
  for select to authenticated using (true);

drop policy if exists "module_categories_insert_super_admin" on module_categories;
create policy "module_categories_insert_super_admin" on module_categories
  for insert to authenticated with check (is_super_admin());

drop policy if exists "module_categories_update_super_admin" on module_categories;
create policy "module_categories_update_super_admin" on module_categories
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 3. company_modules  (COMPANY-scoped per-company configuration)
--    legacy_id == "<companyId>:<moduleId>" (the 1:1 config record identity).
-- ===========================================================================
create table if not exists company_modules (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  module_legacy_id   text not null,
  available          boolean not null default false,
  enabled            boolean not null default false,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_company_modules_company
  on company_modules(company_id) where deleted_at is null;
create index if not exists idx_company_modules_companylegacy
  on company_modules(company_legacy_id);
create index if not exists idx_company_modules_module
  on company_modules(module_legacy_id);

drop trigger if exists trg_company_modules_updated_at on company_modules;
create trigger trg_company_modules_updated_at
  before update on company_modules
  for each row execute function set_mcpm_updated_at();

alter table company_modules enable row level security;

drop policy if exists "company_modules_select_own_company" on company_modules;
create policy "company_modules_select_own_company" on company_modules
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "company_modules_select_super_admin" on company_modules;
create policy "company_modules_select_super_admin" on company_modules
  for select to authenticated using (is_super_admin());

drop policy if exists "company_modules_insert_own_company" on company_modules;
create policy "company_modules_insert_own_company" on company_modules
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "company_modules_insert_super_admin" on company_modules;
create policy "company_modules_insert_super_admin" on company_modules
  for insert to authenticated with check (is_super_admin());

drop policy if exists "company_modules_update_own_company" on company_modules;
create policy "company_modules_update_own_company" on company_modules
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "company_modules_update_super_admin" on company_modules;
create policy "company_modules_update_super_admin" on company_modules
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 4. checklist_templates  (GLOBAL or COMPANY — aggregate: template+sections+items)
-- ===========================================================================
create table if not exists checklist_templates (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  -- Null for a global template (scope = 'global'); set for company templates.
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text,
  scope              text not null default 'company',
  name               text not null,
  is_archived        boolean not null default false,
  -- Lossless aggregate: { template, sections[], items[] }.
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_checklist_templates_company
  on checklist_templates(company_legacy_id);
create index if not exists idx_checklist_templates_company_active
  on checklist_templates(company_legacy_id) where deleted_at is null;
create index if not exists idx_checklist_templates_global_active
  on checklist_templates(name) where company_id is null and deleted_at is null;

drop trigger if exists trg_checklist_templates_updated_at on checklist_templates;
create trigger trg_checklist_templates_updated_at
  before update on checklist_templates
  for each row execute function set_mcpm_updated_at();

alter table checklist_templates enable row level security;

-- Global templates (company_id null) are a shared best-practice library:
-- readable by every authenticated user; company templates by their company.
drop policy if exists "checklist_templates_select_global" on checklist_templates;
create policy "checklist_templates_select_global" on checklist_templates
  for select to authenticated using (company_id is null);

drop policy if exists "checklist_templates_select_own_company" on checklist_templates;
create policy "checklist_templates_select_own_company" on checklist_templates
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "checklist_templates_select_super_admin" on checklist_templates;
create policy "checklist_templates_select_super_admin" on checklist_templates
  for select to authenticated using (is_super_admin());

-- Global writes: super-admin only. Company writes: own company.
drop policy if exists "checklist_templates_insert_own_company" on checklist_templates;
create policy "checklist_templates_insert_own_company" on checklist_templates
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "checklist_templates_insert_super_admin" on checklist_templates;
create policy "checklist_templates_insert_super_admin" on checklist_templates
  for insert to authenticated with check (is_super_admin());

drop policy if exists "checklist_templates_update_own_company" on checklist_templates;
create policy "checklist_templates_update_own_company" on checklist_templates
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "checklist_templates_update_super_admin" on checklist_templates;
create policy "checklist_templates_update_super_admin" on checklist_templates
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 5. customer_protocols  (COMPANY + CUSTOMER scoped — aggregate)
-- ===========================================================================
create table if not exists customer_protocols (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  customer_legacy_id text not null,
  name               text not null,
  is_archived        boolean not null default false,
  -- Lossless aggregate: { protocol, sections[], items[] }.
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_customer_protocols_company
  on customer_protocols(company_legacy_id) where deleted_at is null;
create index if not exists idx_customer_protocols_customer
  on customer_protocols(customer_legacy_id);

drop trigger if exists trg_customer_protocols_updated_at on customer_protocols;
create trigger trg_customer_protocols_updated_at
  before update on customer_protocols
  for each row execute function set_mcpm_updated_at();

alter table customer_protocols enable row level security;

drop policy if exists "customer_protocols_select_own_company" on customer_protocols;
create policy "customer_protocols_select_own_company" on customer_protocols
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "customer_protocols_select_super_admin" on customer_protocols;
create policy "customer_protocols_select_super_admin" on customer_protocols
  for select to authenticated using (is_super_admin());

drop policy if exists "customer_protocols_insert_own_company" on customer_protocols;
create policy "customer_protocols_insert_own_company" on customer_protocols
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "customer_protocols_insert_super_admin" on customer_protocols;
create policy "customer_protocols_insert_super_admin" on customer_protocols
  for insert to authenticated with check (is_super_admin());

drop policy if exists "customer_protocols_update_own_company" on customer_protocols;
create policy "customer_protocols_update_own_company" on customer_protocols
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "customer_protocols_update_super_admin" on customer_protocols;
create policy "customer_protocols_update_super_admin" on customer_protocols
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- ===========================================================================
-- 6. media_assets  (COMPANY-scoped)
-- ===========================================================================
create table if not exists media_assets (
  id                 uuid primary key default gen_random_uuid(),
  legacy_id          text unique not null,
  company_id         uuid references companies(id) on delete cascade,
  company_legacy_id  text not null,
  category           text not null,
  entity_type        text not null,
  entity_id          text not null,
  data               jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_media_assets_company
  on media_assets(company_legacy_id) where deleted_at is null;
create index if not exists idx_media_assets_entity
  on media_assets(entity_type, entity_id);

drop trigger if exists trg_media_assets_updated_at on media_assets;
create trigger trg_media_assets_updated_at
  before update on media_assets
  for each row execute function set_mcpm_updated_at();

alter table media_assets enable row level security;

drop policy if exists "media_assets_select_own_company" on media_assets;
create policy "media_assets_select_own_company" on media_assets
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "media_assets_select_super_admin" on media_assets;
create policy "media_assets_select_super_admin" on media_assets
  for select to authenticated using (is_super_admin());

drop policy if exists "media_assets_insert_own_company" on media_assets;
create policy "media_assets_insert_own_company" on media_assets
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "media_assets_insert_super_admin" on media_assets;
create policy "media_assets_insert_super_admin" on media_assets
  for insert to authenticated with check (is_super_admin());

drop policy if exists "media_assets_update_own_company" on media_assets;
create policy "media_assets_update_own_company" on media_assets
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "media_assets_update_super_admin" on media_assets;
create policy "media_assets_update_super_admin" on media_assets
  for update to authenticated using (is_super_admin()) with check (is_super_admin());
