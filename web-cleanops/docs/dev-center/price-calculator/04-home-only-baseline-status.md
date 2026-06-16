# Home-Only Calculator Baseline — Development Center Status

**Audience:** RORK / GPT-5.5 High
**Project:** CleanOps / Städportalen / Price Calculator
**Company:** Städalliansen (`cmp_o2f6orw29m`), public slug `rakna-ut-ditt-pris`
**Status:** ESTABLISHED — the active calculator workspace is **Hemstädning only**.
**Closeout ticket:** GPM-CLOSEOUT-1 (verification + documentation only; no code/data/migration change).

> This document supersedes the service-roster numbers in
> `docs/runbooks/03-price-calculator-prelaunch-and-qa-runbook.md` §1 (which described
> the pre-cleanup 3-public-ready + 4-draft state). The live Admin UI shows the
> calculator as **Enabled / Public** — treat the Admin UI (and the read-only SQL check
> in §5) as the authoritative enable-state, not a hardcoded flag value in this document.

---

## 1. What "Home-only baseline" means

The active calculator (Admin default workspace **and** public config) is reduced to a
single service — **Hemstädning / `home_cleaning`** — so the team can build and bug-test
the V2 / generic flow against one clean service. Every other previously-seeded service is
now either disabled-legacy or soft-deleted, and is filtered out of the default Admin
workspace and out of public config.

---

## 2. Data changes that were applied (GPM-DATA-CLEAN-1)

These were first executed as **live SQL** against Supabase by the operator, and are now
also persisted as an idempotent, company-scoped migration —
`supabase/migrations/0076_calculator_home_only_baseline.sql` (GPM-DATA-MIGRATION-1) — so
the baseline reproduces on a fresh reseed (see §7). All scoping was company-scoped to
`cmp_o2f6orw29m`; `home_cleaning` was never touched.

| Service | `service_key` | Seeded state (migrations) | Action | Live state now |
| --- | --- | --- | --- | --- |
| Hemstädning | `home_cleaning` | enabled (0060) | none | **enabled = true** (only active service) |
| Flyttstädning | `move_out_cleaning` | enabled (0060) | Group B — disable | enabled = false, hidden |
| Kontorsstädning | `office_cleaning` | enabled (0066) | Group B — disable | enabled = false, hidden |
| Fönsterputs | `window_cleaning` | hidden draft (0065) | Group A — soft-delete | `deleted_at` set |
| Storstädning | `deep_cleaning` | hidden draft (0065) | Group A — soft-delete | `deleted_at` set |
| Trappstädning | `stairwell_cleaning` | hidden draft (0065) | Group A — soft-delete | `deleted_at` set |
| Upphandling | `procurement` | hidden draft (0065) | Group A — soft-delete | `deleted_at` set |

Related rows:

- **Cleaning plans:** `home_cleaning` plans remain `active = true`; `move_out_cleaning`
  and `office_cleaning` plans were set `active = false`.
- **History preserved:** questions, pricing rules and any quote/prospect snapshots for
  the disabled services were **kept** (disable/soft-delete, never hard-deleted).

---

## 3. Admin Calculator — how default workspace is filtered (GPM-ADMIN-FILTER-1)

Pure presentation filter — no data change. Source of truth:
`src/components/calculator/serviceListPresentation.ts`.

- `isDefaultWorkspaceService(s) = s.enabled === true && isPilotService(s)`
  - `isPilotService` = `home_cleaning`, or any non-legacy-pricing-model (future
    builder/generic service). Seeded legacy-model services are never pilots.
- `partitionWorkspaceServices()` splits live rows into `defaultServices` vs
  `legacyServices`; `summarizeWorkspaceConfigCounts()` derives default-vs-legacy counts.
- Soft-deleted rows never reach this layer — Admin loaders already filter
  `deleted_at is null`.

Wired in `src/pages/superadmin/CalculatorControl.tsx` behind a single
`showLegacyWorkspace` toggle (default **false** → "Show legacy / default services"):

| Surface | Default view | With legacy toggle ON |
| --- | --- | --- |
| Overview counts | default (Home) counts; legacy counts reported separately | legacy included |
| Overview service list | Home only | + disabled legacy |
| Services tab | Home only | + disabled legacy |
| Plans tab | Home plans only | + Office/Move-out plans |
| Pricing tab | Home pricing only | + legacy pricing |
| Add-ons tab | Home add-ons only | + legacy add-ons |

With current data this resolves to **Hemstädning only** in the default workspace.

---

## 4. Public Calculator — how Home-only is guaranteed

`supabase/functions/public-calculator/index.ts` (`handleConfig`) + pure mapper
`supabase/functions/_shared/calculator/publicCalculator.ts` (`buildPublicConfig`):

- Services query: `.is("deleted_at", null).or("enabled.eq.true,coming_soon.eq.true")`
  → Group A (soft-deleted) never loads; a plain disabled service
  (`enabled=false, coming_soon=false`) never loads.
- Questions + add-ons are scoped to **enabled** service ids only; add-ons re-check
  `active && public_visible && deleted_at is null` defensively in the pure mapper.
- Plans load `active = true` only and attach per `service_key`.
- `calculate` / `submit` reject any non-enabled service with `service_unavailable`
  (`computeQuote`), so a stray row can never be priced.
- The whole config is gated by `calculator_settings.enabled`; the live Admin UI shows
  this as **Enabled / Public** (verify the stored value with the read-only SQL in §5).

Net effect with the calculator enabled: **only `home_cleaning` is returned** as an
active public service; legacy/soft-deleted services cannot leak. The Home V2 flow
(`publicCalculatorV2.ts`) is unchanged.

---

## 5. Verification performed (GPM-CLOSEOUT-1)

Code-level + test-level (no live data mutation):

- **Code paths** reviewed: Admin filter helper + wiring, public-config service/question/
  add-on/plan selection, `buildPublicConfig` defensive re-checks, `computeQuote` guard.
- **Targeted tests — 113 passed (6 files):**
  `bunx vitest run src/components/calculator/serviceListPresentation.test.ts src/pages/superadmin/CalculatorControl.tabs.test.tsx src/pages/superadmin/CalculatorControl.access.test.tsx src/lib/calculator/genericServiceReadiness.test.ts src/lib/calculator/publicCalculatorClient.test.ts src/pages/public/PriceCalculator.genericpreview.test.tsx`
  - Includes the GPM-ADMIN-FILTER-1 "default workspace hides disabled legacy services"
    suite (Pricing tab hidden until toggle, legacy reported separately).

**Operator-run live checks** (read-only SQL — run against the live DB to confirm state):

- Calculator enable-state (read-only): `SELECT enabled, public_slug, deleted_at FROM calculator_settings WHERE company_id = (SELECT id FROM companies WHERE legacy_id = 'cmp_o2f6orw29m') AND deleted_at is null;` — the live Admin UI shows this as **Enabled / Public**.
- Row state (read-only): `SELECT service_key, enabled, coming_soon, deleted_at FROM calculator_services WHERE company_id = (SELECT id FROM companies WHERE legacy_id = 'cmp_o2f6orw29m');`
- Public config: `POST .../functions/v1/public-calculator` with
  `{ "action": "config", "slug": "rakna-ut-ditt-pris" }` → expect `services` = `home_cleaning` only.

---

## 6. Known remaining items

- **Pre-existing TypeScript debt:** 25 errors, unrelated to the calculator cleanup.
  Untouched by this chain and to be handled separately. ("Fix errors" not used.)
- **Legacy services still exist** as disabled (`move_out_cleaning`, `office_cleaning`)
  or soft-deleted (Group A) rows, reachable only behind the Admin legacy toggle.
- **Generic V2 preview** (GPM-5d-1) renders renderable `sqm_fixed` services in a
  separate read-only "Förhandsvisning av nya tjänster" section — no selection/calculate
  wired yet.
- **Calculator enable-state:** the live Admin UI shows the calculator as **Enabled /
  Public**. Confirm the authoritative `calculator_settings.enabled` value with the
  read-only SQL in §5 rather than relying on a flag value documented here.
- **Next feature slice starts from this Home-only baseline.**

---

## 7. Risks

- **Migration ↔ live-data drift (resolved).** The cleanup was first applied as live SQL,
  then encoded as `0076_calculator_home_only_baseline.sql` (GPM-DATA-MIGRATION-1): a
  guarded, idempotent migration that disables Group B (+ deactivates their plans) and
  soft-deletes Group A for `cmp_o2f6orw29m`. A fresh rebuild/reseed from
  `supabase/migrations` now reproduces the Home-only state instead of restoring
  `move_out_cleaning` + `office_cleaning` as enabled. Applying 0076 to the already-clean
  live DB is a guarded no-op (every UPDATE is guarded to match only not-yet-converted rows).
- **Public exposure depends on `enabled` flags**, not deletion. If `move_out_cleaning` or
  `office_cleaning` were re-enabled (or given `coming_soon=true`), they would re-enter
  public config. Admin filtering is presentation-only and does not prevent that.
- **Soft-deletes are reversible** (an upsert by `legacy_id` can undelete) — acceptable
  for history retention, but worth noting before any reseed.

---

## 8. Recommended next step

The Home-only intent is now encoded as the idempotent, company-scoped migration
`0076_calculator_home_only_baseline.sql` (GPM-DATA-MIGRATION-1), so the baseline survives
a reseed. Next: resume the V2 / generic slice work (e.g. GPM-5d-2: wire a selectable
generic `sqm_fixed` service) from this clean baseline.
