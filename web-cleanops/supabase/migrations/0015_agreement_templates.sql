-- ============================================================================
-- CleanOps — Agreement Templates Phase 9: TEMPLATES + TEMPLATE LINES
-- ============================================================================
--
-- Adds the persistence foundation for reusable Agreement Templates — the
-- BLUEPRINTS that suggest default values for Customer Agreements:
--   AgreementTemplate (global | company) → AgreementTemplateLine[]
--   → createAgreementFromTemplate() → CustomerAgreement (independent snapshot)
--
-- The Agreement Template LOGIC layer (src/lib/data/agreementTemplates.ts +
-- timeBankTemplateBinding.ts) is already built and harness-validated. This
-- migration is the missing PERSISTENCE half — the durable Supabase tables the
-- repository write path targets. It mirrors the proven customers (0007) /
-- work_orders (0008) / customer_agreements (0013) / time_bank (0014)
-- conventions: flat indexed columns for list / scope / version, plus a lossless
-- `data jsonb` carrying the COMPLETE domain record for detail reconstruction.
--
-- IMPORTANT — FOUNDATION ONLY (no activation):
--   * The app STILL runs on localStorage; templates are NOT wired into any UI,
--     billing, payroll or customer flow. These tables are a SECONDARY shadow
--     copy the future write path / management UI will populate and verify,
--     exactly like the 0013 / 0014 waves.
--   * No feature flag, no production-authoritative flip, no customer rollout,
--     no live migration is performed by adding this file.
--   * Templates SUGGEST Time Bank rules; entitlement still gates activation.
--     Persisting a template never creates a wallet.
--
-- LOCKED DECISIONS honoured by this schema:
--   (1) Templates are blueprints, agreements are operational records — there is
--       NO foreign key from agreements to templates; the agreement stores only
--       sourceType='template' + sourceReferenceId for traceability.
--   (2) ONE entity, two ownership tiers, discriminated by owner_type +
--       company_id: GLOBAL templates have company_id = NULL (Super Admin owned);
--       COMPANY templates have a non-null company_id (Company Admin owned).
--   (3) Versioning: template_group_id is the stable version-chain key; a new
--       version is a NEW row (new legacy_id) — old versions are NEVER mutated,
--       so agreements created from an old version remain reproducible.
--   (4) Archive via status (draft|active|inactive|superseded), NOT a destructive
--       delete — consistent with customer_agreements (no deleted_at column,
--       status-based soft-delete). There is deliberately NO delete policy.
--
-- legacy_id / company_legacy_id:
--   Mirrors the established convention. `legacy_id` is the app-facing id
--   (template id / line id) and the idempotency key for upserts.
--   `company_legacy_id` is the app-facing company id used by the query layer
--   scope; it is NULL for global templates. The real `company_id uuid` FK is
--   what RLS enforces tenancy against (also NULL for global).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE 1 — agreement_templates (global or company-owned blueprints)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists agreement_templates (
  id                       uuid primary key default gen_random_uuid(),
  -- App-facing template id; migration + idempotency key.
  legacy_id                text unique not null,
  -- Stable version-chain key (LOCKED decision 3).
  template_group_id        text not null,
  -- Ownership tier (LOCKED decision 2).
  owner_type               text not null,
  -- Real tenant FK used by RLS. NULL for GLOBAL templates (Super Admin owned).
  company_id               uuid references companies(id) on delete cascade,
  -- App-facing company id; NULL for global templates.
  company_legacy_id        text,
  name                     text not null,
  description              text,
  -- 1-based version within the template group.
  version                  integer not null default 1,
  -- Lifecycle status (archive = inactive/superseded; no destructive delete).
  status                   text not null default 'draft',
  -- Suggested header defaults copied into agreements at creation.
  billing_model            text not null default 'per_visit',
  invoice_interval         text not null default 'monthly',
  -- SUGGESTION only — entitlement still gates wallet creation.
  time_bank_eligible       boolean not null default false,
  -- Source GLOBAL template legacy_id when this row was copied to a company.
  copied_from_template_id  text,
  -- Version-chain links within the template group.
  supersedes_version_id    text,
  superseded_by_id         text,
  valid_from               timestamptz,
  valid_to                 timestamptz,
  -- Lossless full AgreementTemplate record for detail reconstruction.
  data                     jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint agreement_templates_owner_type_check
    check (owner_type in ('global', 'company')),
  constraint agreement_templates_status_check
    check (status in ('draft', 'active', 'inactive', 'superseded')),
  -- Ownership integrity: global → no company; company → must have a company.
  constraint agreement_templates_owner_company_check
    check (
      (owner_type = 'global'  and company_id is null     and company_legacy_id is null) or
      (owner_type = 'company' and company_id is not null  and company_legacy_id is not null)
    )
);

-- List / scope / lookup indexes.
create index if not exists idx_agt_group_version
  on agreement_templates(template_group_id, version);
create index if not exists idx_agt_company_status
  on agreement_templates(company_id, status);
create index if not exists idx_agt_companylegacy_status
  on agreement_templates(company_legacy_id, status);
create index if not exists idx_agt_owner_status
  on agreement_templates(owner_type, status);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLE 2 — agreement_template_lines (suggested service lines)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists agreement_template_lines (
  id                       uuid primary key default gen_random_uuid(),
  -- App-facing line id; migration + idempotency key.
  legacy_id                text unique not null,
  -- The template VERSION (legacy_id) this line belongs to.
  template_legacy_id       text not null,
  -- Denormalised version-chain key for group-scoped reads.
  template_group_id        text not null,
  -- Denormalised ownership tier.
  owner_type               text not null,
  -- Real tenant FK used by RLS. NULL for GLOBAL template lines.
  company_id               uuid references companies(id) on delete cascade,
  company_legacy_id        text,
  sort_order               integer not null default 0,
  -- Source catalog service id (reference, not a live link).
  source_service_id        text,
  service_name_snapshot    text not null,
  category_name_snapshot   text,
  pricing_model            text not null default 'fixed',
  billing_model_override   text,
  default_price            numeric,
  default_vat              numeric,
  default_quantity         numeric,
  default_duration_minutes integer,
  active                   boolean not null default true,
  -- Lossless full AgreementTemplateLine record.
  data                     jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint agreement_template_lines_owner_type_check
    check (owner_type in ('global', 'company'))
);

-- Ordered line reads per template version, plus scope indexes.
create index if not exists idx_agtl_template_sort
  on agreement_template_lines(template_legacy_id, sort_order);
create index if not exists idx_agtl_group
  on agreement_template_lines(template_group_id);
create index if not exists idx_agtl_company
  on agreement_template_lines(company_id);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_agreement_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_agreement_templates_updated_at on agreement_templates;
create trigger trg_agreement_templates_updated_at
  before update on agreement_templates
  for each row
  execute function set_agreement_templates_updated_at();

drop trigger if exists trg_agreement_template_lines_updated_at on agreement_template_lines;
create trigger trg_agreement_template_lines_updated_at
  before update on agreement_template_lines
  for each row
  execute function set_agreement_templates_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — global + company-scoped
--   GLOBAL templates (company_id IS NULL):
--     READ   — every authenticated user (platform-standard blueprints).
--     WRITE  — super_admin only (INSERT/UPDATE). Company admins cannot edit.
--   COMPANY templates (company_id = own company):
--     READ   — own company; super_admin reads all.
--     WRITE  — INSERT/UPDATE within own company; super_admin across companies.
--   DELETE — NO policy on either table → blocked for everyone. Templates are
--            archived (status flip), never destroyed; history stays readable.
-- All checks go through the SECURITY DEFINER helpers current_company_id() /
-- is_super_admin() from 0003 — no recursive-RLS risk, client never trusted.
-- ─────────────────────────────────────────────────────────────────────────
alter table agreement_templates enable row level security;
alter table agreement_template_lines enable row level security;

-- agreement_templates — SELECT
drop policy if exists "agt_select_global" on agreement_templates;
create policy "agt_select_global" on agreement_templates
  for select to authenticated
  using (company_id is null);

drop policy if exists "agt_select_own_company" on agreement_templates;
create policy "agt_select_own_company" on agreement_templates
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "agt_select_super_admin" on agreement_templates;
create policy "agt_select_super_admin" on agreement_templates
  for select to authenticated
  using (is_super_admin());

-- agreement_templates — INSERT
drop policy if exists "agt_insert_own_company" on agreement_templates;
create policy "agt_insert_own_company" on agreement_templates
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "agt_insert_super_admin" on agreement_templates;
create policy "agt_insert_super_admin" on agreement_templates
  for insert to authenticated
  with check (is_super_admin());

-- agreement_templates — UPDATE
drop policy if exists "agt_update_own_company" on agreement_templates;
create policy "agt_update_own_company" on agreement_templates
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "agt_update_super_admin" on agreement_templates;
create policy "agt_update_super_admin" on agreement_templates
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- agreement_template_lines — SELECT
drop policy if exists "agtl_select_global" on agreement_template_lines;
create policy "agtl_select_global" on agreement_template_lines
  for select to authenticated
  using (company_id is null);

drop policy if exists "agtl_select_own_company" on agreement_template_lines;
create policy "agtl_select_own_company" on agreement_template_lines
  for select to authenticated
  using (company_id is not null and company_id = current_company_id());

drop policy if exists "agtl_select_super_admin" on agreement_template_lines;
create policy "agtl_select_super_admin" on agreement_template_lines
  for select to authenticated
  using (is_super_admin());

-- agreement_template_lines — INSERT
drop policy if exists "agtl_insert_own_company" on agreement_template_lines;
create policy "agtl_insert_own_company" on agreement_template_lines
  for insert to authenticated
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "agtl_insert_super_admin" on agreement_template_lines;
create policy "agtl_insert_super_admin" on agreement_template_lines
  for insert to authenticated
  with check (is_super_admin());

-- agreement_template_lines — UPDATE
drop policy if exists "agtl_update_own_company" on agreement_template_lines;
create policy "agtl_update_own_company" on agreement_template_lines
  for update to authenticated
  using (company_id is not null and company_id = current_company_id())
  with check (company_id is not null and company_id = current_company_id());

drop policy if exists "agtl_update_super_admin" on agreement_template_lines;
create policy "agtl_update_super_admin" on agreement_template_lines
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- NOTE: NO delete policy on either table on purpose — templates are archived
-- (status flip to inactive/superseded), never destroyed. Existing agreements
-- created from a template are snapshots and are unaffected regardless.
