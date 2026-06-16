-- ============================================================================
-- CleanOps — Supabase Schema Plan (Step 1: PLAN ONLY, not yet applied)
-- ============================================================================
--
-- This file is the proposed staging database schema derived from the current
-- TypeScript types (src/types/index.ts) and localStorage keys (src/lib/store.ts).
--
-- IMPORTANT — Step 1 status:
--   * The app still runs entirely on localStorage. NOTHING reads/writes Supabase.
--   * This SQL is a PLAN. Do NOT run it as part of normal app usage.
--   * Tables/columns will be refined per-module as each entity is migrated.
--
-- Conventions:
--   * Every company-scoped table has `company_id uuid` referencing companies(id).
--     The Super Admin operates across companies (company_id IS NULL for global
--     templates such as platform roles, service catalog, checklist templates).
--   * Row Level Security (RLS) is enabled on every table. Policies will scope
--     reads/writes to the caller's company; Super Admin bypasses via a claim.
--   * `created_at` / `updated_at` are timestamptz, default now().
--   * JSONB is used for nested structures that aren't queried relationally yet
--     (e.g. checklist floors/rooms/tasks, settings data, work-order activity).
--     These can be normalised into child tables later if querying needs grow.
--
-- Migration order (safe dependency order — see also the chat summary):
--   1. companies
--   2. users/profiles, roles, role_permissions
--   3. customers, employees, teams (+ customer child tables)
--   4. settings, service_categories, services, service_packages
--   5. work_orders, work_order_service_rows, service_variations
--   6. checklist_templates, customer_protocols, libraries
--   7. activity_logs / audit_events  (foundation for the Master Activity Log)
--   8. files / storage (Supabase Storage buckets)
-- ============================================================================

-- Helpful enums (kept as text + CHECK in practice for easy evolution; shown as
-- comments here). entity_status: 'active' | 'inactive' | 'archived'.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. COMPANIES
-- Purpose: tenant root. Every other company-scoped row points here.
-- RLS: yes — users only see their own company; Super Admin sees all.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'active',  -- active | inactive
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2a. PROFILES (users)
-- Purpose: app user accounts. In full migration this links 1:1 to auth.users
--   via id = auth.uid(). company_id NULL for Super Admin.
-- Key fields: name, email, role (base role), role_id (-> roles), status.
-- Relationships: company_id -> companies; role_id -> roles.
-- RLS: yes — self + same-company admins; Super Admin all.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        text not null,   -- super_admin | company_admin | employee | customer
  role_id     uuid,            -- -> roles(id)
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);
create index if not exists idx_profiles_company on profiles(company_id);

-- 2b. ROLES
-- Purpose: assignable roles. Global templates (company_id NULL) + per-company.
-- Key fields: name, base_role, is_system, permissions (text[]).
-- RLS: yes — company-scoped; templates readable by all, editable by Super Admin.
create table if not exists roles (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id) on delete cascade,
  name         text not null,
  description  text,
  base_role    text not null,  -- super_admin | company_admin | employee | customer
  is_system    boolean not null default false,
  permissions  text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- 2c. PERMISSIONS / MODULES (catalog — mostly static, code-defined today)
-- Purpose: reference catalog of permission keys and platform modules.
--   Currently defined in code (lib/permissions, lib/modules). Tables let the
--   Super Admin manage them at runtime later.
create table if not exists modules (
  id                 text primary key,           -- slug e.g. 'checklist-manager'
  name               text not null,
  description        text,
  status             text not null default 'active',
  allowed_user_types text[] not null default '{}',
  created_at         timestamptz not null default now()
);

create table if not exists module_categories (
  id                 text primary key,
  name               text not null,
  description        text,
  icon               text,
  sort_order         int not null default 0,
  status             text not null default 'active',
  visible_user_types text[] not null default '{}',
  module_ids         text[] not null default '{}',
  created_at         timestamptz not null default now()
);

-- Per-company module availability/enablement (composite key).
create table if not exists company_modules (
  company_id  uuid not null references companies(id) on delete cascade,
  module_id   text not null references modules(id) on delete cascade,
  available   boolean not null default true,
  enabled     boolean not null default true,
  primary key (company_id, module_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. DIRECTORY: customers, employees, teams
-- ─────────────────────────────────────────────────────────────────────────

-- 3a. CUSTOMERS
-- Purpose: client records (customer cards). Heavily nested today.
-- Key fields: customer_number, name, email, status, type, area, tags,
--   scheduling prefs (cleaning days/times, absence handling). Child collections
--   (addresses, contacts, notes) are split into tables below; remaining nested
--   blobs (scheduling, card notes) kept in JSONB until queried relationally.
-- Relationships: company_id -> companies; user_ids -> profiles (portal logins).
-- RLS: yes — same-company; customers see only their own row.
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  customer_number text,
  name            text not null,
  email           text,
  phone           text,
  status          text not null default 'active',
  customer_type   text,
  area            text,
  tags            text[] not null default '{}',
  main_contact    text,
  scheduling      jsonb,            -- cleaning days/times, absence handling, notes
  card_notes      jsonb,            -- typed card notes (admin/finance/assignment)
  internal_notes  jsonb,
  user_ids        uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_customers_company on customers(company_id);

-- 3b. CUSTOMER_ADDRESSES (1 customer -> N addresses)
create table if not exists customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  label        text,
  street       text,
  postal_code  text,
  city         text,
  country      text,
  is_invoice   boolean not null default false,
  is_delivery  boolean not null default false
);

-- 3c. CUSTOMER_CONTACTS (1 customer -> N contact persons)
create table if not exists customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null,
  title        text,
  email        text,
  phone        text,
  is_primary   boolean not null default false
);

-- 3d. EMPLOYEES
-- Purpose: internal staff. team_ids many-to-many via array (or join table later).
-- Relationships: company_id -> companies; user_id -> profiles (optional login).
create table if not exists employees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  email       text,
  title       text,
  status      text not null default 'active',
  team_ids    uuid[] not null default '{}',
  user_id     uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 3e. TEAMS
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. SETTINGS & SERVICES
-- ─────────────────────────────────────────────────────────────────────────

-- 4a. SETTINGS_TEMPLATES (global, Super Admin) + COMPANY_SETTINGS (per company)
-- Purpose: reusable settings bundles (services, customer types, areas, tags,
--   materials, time codes, holidays). Stored as JSONB `data` blob today.
create table if not exists settings_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  archived    boolean not null default false,
  created_by  uuid,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists company_settings (
  company_id  uuid primary key references companies(id) on delete cascade,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- 4b. SERVICE_CATEGORIES (company_id NULL = global catalog)
create table if not exists service_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  status      text not null default 'active',
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- 4c. SERVICES
create table if not exists services (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references companies(id) on delete cascade,
  category_id        uuid references service_categories(id) on delete set null,
  name               text not null,
  description        text,
  article_number     text,
  service_type       text,
  billing_type       text not null default 'fixed',
  price              numeric,
  vat                numeric,
  deduction_eligible boolean not null default false,
  deduction_type     text not null default 'none',
  sms_enabled        boolean not null default false,
  status             text not null default 'active',
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 4d. SERVICE_PACKAGES (bundle of service items; items kept as JSONB)
create table if not exists service_packages (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  name        text not null,
  description text,
  archived    boolean not null default false,
  created_by  uuid,
  items       jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 4e. COMPANY_SERVICE_FAVORITES (quick-select shortcuts)
create table if not exists company_service_favorites (
  company_id  uuid not null references companies(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (company_id, service_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. WORK ORDERS
-- ─────────────────────────────────────────────────────────────────────────

-- 5a. WORK_ORDERS
-- Purpose: jobs for a customer. activity[] + notes[] kept as JSONB for now
--   (will feed the future Master Activity Log).
create table if not exists work_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  number          text,
  title           text not null,
  status          text not null default 'planned',
  start_date      timestamptz,
  end_date        timestamptz,
  created_by      uuid,
  created_by_name text,
  notes           jsonb not null default '[]',
  activity        jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_work_orders_company on work_orders(company_id);
create index if not exists idx_work_orders_customer on work_orders(customer_id);

-- 5b. WORK_ORDER_SERVICE_ROWS
-- Purpose: a service line on a work order, incl. default schedule rule and
--   per-row override scheduling preferences.
create table if not exists work_order_service_rows (
  id              uuid primary key default gen_random_uuid(),
  work_order_id   uuid not null references work_orders(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  service_id      uuid references services(id) on delete set null,
  name            text not null,
  status          text not null default 'active',
  schedule_rule   jsonb,            -- default schedule rule
  override_prefs  jsonb,            -- optional per-row scheduling override
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 5c. SERVICE_VARIATIONS
-- Purpose: recurring variations of a service row (type, validity window,
--   status, ranked-priority data, structured notes).
create table if not exists service_variations (
  id              uuid primary key default gen_random_uuid(),
  service_row_id  uuid not null references work_order_service_rows(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  variation_type  text,             -- time_change | extra_staff | ...
  status          text not null default 'draft',  -- draft|active|inactive|archived
  applies_from    date,
  applies_until   date,
  pattern         jsonb,            -- recurrence (every 4th week, first Monday, ...)
  details         jsonb,            -- day/time/duration/employee overrides
  reason          text,
  internal_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 5d. WORK_ORDER_SETTINGS (per company)
create table if not exists work_order_settings (
  company_id  uuid primary key references companies(id) on delete cascade,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- 5e. INVOICES (customer-card foundation; finance module later)
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  number          text,
  status          text not null default 'unpaid',
  amount_to_pay   numeric not null default 0,
  amount_paid     numeric not null default 0,
  invoice_date    timestamptz,
  due_date        timestamptz,
  reminder_date   timestamptz,
  fully_paid_date timestamptz,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. CHECKLIST MANAGER & PROTOCOLS & LIBRARIES
-- Purpose: nested floor/room/task structures. Kept as JSONB `structure` for
--   the deep tree; relational split optional later.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists checklist_templates (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,  -- NULL = global
  name                  text not null,
  description           text,
  status                text not null default 'active',
  archived              boolean not null default false,
  available_to_companies boolean not null default false,
  template_type         text not null default 'global',
  created_by            uuid,
  notes                 text,
  images                jsonb not null default '[]',
  floors                jsonb not null default '[]',  -- nested floors/rooms/tasks
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists checklist_template_adoptions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  template_id uuid not null references checklist_templates(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists customer_protocols (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  customer_id           uuid not null references customers(id) on delete cascade,
  name                  text not null,
  description           text,
  source_template_id    uuid,
  source_template_name  text,
  created_by            uuid,
  status                text not null default 'active',
  notes                 text,
  floors                jsonb not null default '[]',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Global Room & Task libraries (company_id NULL = global).
create table if not exists library_rooms (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  name        text not null,
  description text,
  category    text,
  status      text not null default 'active',
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists library_tasks (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid references companies(id) on delete cascade,
  name                 text not null,
  description          text,
  category             text,
  default_auto_enabled boolean not null default false,
  status               text not null default 'active',
  created_by           uuid,
  created_at           timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. ACTIVITY LOGS  (foundation for the future Master Activity Log)
-- Purpose: single source of truth for activity. Shaped to match the agreed
--   future event structure so module logs become filtered VIEWS of this table.
-- RLS: yes — company-scoped; Super Admin all. Append-only (no update/delete).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists activity_logs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,
  user_id             uuid,         -- acting user (NULL = system)
  user_role           text,
  module              text,         -- 'work_orders' | 'customer_cards' | ...
  action_type         text,         -- 'created' | 'updated' | 'archived' | ...
  change_type         text,         -- 'admin_change' | 'customer_change' | 'system_change'
  section             text,         -- e.g. 'Cleaning Days & Times'
  related_record_type text,         -- 'customer' | 'work_order' | ...
  related_record_id   uuid,
  customer_id         uuid,         -- optional cross-reference
  work_order_id       uuid,         -- optional cross-reference
  description         text,
  old_value           jsonb,
  new_value           jsonb,
  source              text,         -- 'admin_portal' | 'customer_portal'
  created_at          timestamptz not null default now()
);
create index if not exists idx_activity_company on activity_logs(company_id);
create index if not exists idx_activity_customer on activity_logs(customer_id);
create index if not exists idx_activity_work_order on activity_logs(work_order_id);

-- audit_events: existing platform audit trail (kept distinct until merged into
-- the Master Activity Log during a later step).
create table if not exists audit_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  actor_id    uuid,
  actor_name  text,
  action      text,
  target      text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. FILES / STORAGE
-- Purpose: today src/lib/storage.ts uses localStorage stand-ins. In Supabase
--   use Storage buckets for binaries; this table stores metadata + bucket path.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id) on delete cascade,
  bucket       text not null,
  path         text not null,
  filename     text,
  content_type text,
  size_bytes   bigint,
  related_type text,
  related_id   uuid,
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY (to be enabled when each table is migrated)
-- ----------------------------------------------------------------------------
-- Every table above needs RLS. Pattern (illustrative, applied per table):
--
--   alter table customers enable row level security;
--
--   create policy "company members read" on customers
--     for select using (company_id = auth.jwt() ->> 'company_id'::uuid);
--
--   create policy "company admins write" on customers
--     for all using (
--       company_id = (auth.jwt() ->> 'company_id')::uuid
--       and (auth.jwt() ->> 'role') in ('company_admin','super_admin')
--     );
--
-- Super Admin bypass: a 'super_admin' role claim grants cross-company access.
-- Global catalog tables (roles templates, services where company_id IS NULL,
-- global checklist templates, libraries, modules) are readable by all
-- authenticated users; writable only by Super Admin.
-- ============================================================================
