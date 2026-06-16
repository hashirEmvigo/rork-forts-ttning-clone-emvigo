# CleanOps — Public Price Calculator Pre-Launch & Manual QA Runbook

> **Status:** PRE-LAUNCH PREPARATION. This runbook captures the verified state of
> the public price calculator and the exact manual QA sequence to follow before
> the calculator is enabled publicly. It is read-only/operational: nothing here
> changes feature code or schema.
>
> **Feature:** Public price calculator at `/rakna-ut-ditt-pris`
> (company `cmp_o2f6orw29m`, public slug `rakna-ut-ditt-pris`).
>
> **Critical safety rule:** the calculator stays **dark** (`calculator_settings.enabled = false`)
> until an explicit go-live decision. While dark there is no active form, no submit,
> and no writes are possible.
>
> **Test-data policy:** see `docs/00-project-operating-mode-and-test-data-policy.md`.
> Any submitted QA data must use a clearly identifiable `*.test` email and be
> cleaned up afterwards.

---

## 0. When to use this

Use this before deciding whether to soft-launch the public calculator, and as the
repeatable manual QA script each time the calculator is toggled on for testing.

---

## 1. Verified system status (DB state last verified: Slice 12F — migration 0067 applied)

> **SUPERSEDED (Home-only baseline, GPM-CLOSEOUT-1).** The service roster below describes
> the pre-cleanup state (3 public-ready + 4 hidden drafts). After the GPM-DATA-CLEAN-1 /
> GPM-ADMIN-FILTER-1 chain the active calculator is **Hemstädning only**: `move_out_cleaning`
> and `office_cleaning` are disabled legacy, and `window_cleaning` / `deep_cleaning` /
> `stairwell_cleaning` / `procurement` are soft-deleted. The current baseline, data delta,
> Admin filtering, and public-config guarantees are documented in
> `docs/dev-center/price-calculator/04-home-only-baseline-status.md`. The table below is
> retained as a historical record.

| Area | Expected | Verified |
| --- | --- | --- |
| `calculator_settings.enabled` | `false` (dark) | ✅ false |
| company | `cmp_o2f6orw29m` | ✅ |
| public slug | `rakna-ut-ditt-pris` | ✅ |
| `default_quote_status` | `submitted` | ✅ |
| services (live) | 7 (3 public-ready + 4 hidden drafts) | ✅ |
| public-ready services | Hemstädning, Flyttstädning, Kontorsstädning | ✅ |
| cleaning plans (live) | 3 | ✅ |
| questions (active) | 25 | ✅ |
| pricing rules (active) | 30 | ✅ |
| prospects | 0 | ✅ |
| quote_requests | 0 | ✅ |
| quote_request_answers | 0 | ✅ |

> The Slice 8A baseline was 2 services / 12 questions / 18 rules. Slices 12C–12F
> added the office service, its questions/rules, and 4 hidden draft templates. See
> **§2.6** for the office (12E/12F) detail and the migration-0067 verification.

### Routes

- `/rakna-ut-ditt-pris` → renders the public calculator. Public, no auth guard, no
  auth redirect. Dark (coming-soon) while `enabled = false`; no submit UI; `noindex`.
- `/rakna-ut-pris` → permanent redirect to `/rakna-ut-ditt-pris`.

### Super Admin control (`/calculator`)

- Super Admin only, gated by the `calculator.manage` permission (role alone is not
  enough — a Super Admin missing the permission is redirected).
- Shows current status (`enabled = false`), services/plans/counts, the enable/disable
  toggle (confirms before writing, and writes **only** the `enabled` column), and the
  read-only **Quote Requests** inbox with its empty state.

### Edge Function (`public-calculator`, `verify_jwt = false`)

- `action: "config"` → public-safe config (no internal fields).
- `action: "calculate"` → server-side price, public-safe fields only.
- `action: "submit"` → write path. While dark it returns `available: false` /
  `status: "not_available"` and writes **nothing**. Writes occur only when
  `enabled = true` **and** the server recompute is valid. The client price is never
  trusted.
- Calculator/prospect/quote tables have **no anon RLS policy**: anon reads return
  `[]` and anon writes are denied (`42501`). All public access flows through this
  function (service role, server-only).
- Deployed build is identifiable by `functionVersion` in every response
  (current: `2026-public-calculator-3-abuse-guard`).

### Abuse protection (Slice 12B — migration 0064)

The public endpoint is now rate-limited and spam-guarded. All counters are stored
as **opaque HMAC digests** — **no raw IP, email, or PII is ever persisted**.

- **Per-IP rate limit (all actions; submit strictest):** config 60/min,
  calculate 40/min, submit 5/min. Over the limit → HTTP **429** with a friendly
  body (`error:"rate_limited"`, Swedish `message`, `retryAfterSeconds`) + a
  `Retry-After` header. Writes nothing.
- **Per-email submit cap:** 10 submissions per email per day (layered on top of
  the per-IP submit limit so rotating IPs cannot flood one inbox). The email is
  hashed before storage. Over the cap → 429, writes nothing.
- **Honeypot:** a hidden, non-tabbable, autocomplete-off `company_website` field.
  A bot that fills it gets a benign accepted-looking 200 and **nothing is
  written** (returned before any recompute/write). A real person never fills it.
- **Storage + access:** `public_request_throttle` has RLS enabled with **no
  client policy** (service-role only); the atomic `record_public_request` /
  `purge_expired_public_request_throttle` RPCs are `SECURITY DEFINER`, execute
  revoked from anon/authenticated and granted only to `service_role`. Bounded
  retention via `expires_at` (opportunistic self-prune + explicit purge RPC).
- **Fail-open:** any throttle error lets the request through (a counter outage can
  never take the public calculator down). The throttle counter is the **only**
  thing written for a blocked request — never business data, so the dark calculator
  still writes no prospect/quote/answer.
- **Pricing untouched:** the engine and the never-trust-client-price contract are
  unchanged; throttling sits in front of, and around, the existing logic.

### SEO

- Dark/disabled state: `noindex, follow`.
- Canonical: `/rakna-ut-ditt-pris`.
- No FAQ JSON-LD emitted while dark.
- Indexable (no `noindex`) when enabled — covered by tests.

### Automated tests

- Full calculator suite: **196 tests across 12 files, all passing.**
- Static checks + production build: **passing.**

---

## 2. Pre-launch readiness checklist

- [x] Public route reachable logged-out, no auth redirect.
- [x] Dark state shows coming-soon, no submit UI, `noindex`.
- [x] `/rakna-ut-pris` alias redirects to the canonical path.
- [x] Super Admin `/calculator` gated by `calculator.manage`; enable/disable toggle present.
- [x] Quote Requests inbox renders empty state with no data.
- [x] Edge Function deployed; `config`/`calculate` work; `submit` blocked while dark.
- [x] Live dark submit returns `not_available` and writes nothing (counts stay 0).
- [x] Anonymous direct table reads return `[]`; anonymous writes denied.
- [x] DB baseline confirmed (services 2 / plans 3 / questions 12 / rules 18; leads 0).
- [x] SEO noindex-while-dark and canonical confirmed.
- [x] Full calculator suite + build green.

### Remaining blockers / risks before public go-live

These are intentionally **out of scope** so far and should be weighed before a real
public launch (not just a controlled soft-launch test):

1. **No customer-facing notification.** A submitted quote currently only lands in the
   DB + Super Admin inbox — there is no confirmation email/SMS to the customer or
   alert to staff. Acceptable for a controlled soft-launch; needed before broad public use.
2. **No quote review workflow.** The inbox is read-only (no accept/reject, status
   change, assignment, or prospect→customer conversion yet).
3. **No Company Admin visibility.** Only Super Admin can see leads today (Phase 2 RLS
   is drafted but not enabled).
4. ~~**No rate limiting / spam protection** on the public submit endpoint.~~
   **RESOLVED (Slice 12B):** per-IP rate limits, a per-email submit cap, and a
   honeypot now protect the endpoint; all counters are PII-free HMAC digests. See
   *Abuse protection* above.
5. **Shared live environment.** There is no separate staging project; toggling
   `enabled = true` exposes the live page. Keep enablement windows short and controlled.

### Recommendation

**Safe for a controlled soft-launch / manual QA** (short, supervised enablement
windows with `*.test` data and cleanup). Abuse protection (item 4) is now in place;
the main remaining gap before an unsupervised public launch is item 1 (customer/
staff notification), which is deferred to the platform-wide Notification System.

---

## 2.5 Slice 12C — SaaS configuration management (admin) + public service display

Slice 12C extended the calculator into a reusable, admin-manageable SaaS module.
All additions are **Super-Admin-only** and the calculator remains **dark**
(`calculator_settings.enabled = false`). No pricing math, Edge Function behaviour,
RLS policy, or the never-trust-client-price contract was changed.

### Quote Requests inbox (finished)

The read-only inbox now has a search + filter + sort toolbar, summary tiles, a
per-request **Copy summary** action and a **CSV export** of the currently-visible
rows. Search/filter/sort/export are all **pure** (`quoteRequestInbox.ts`) and use
ONLY public-safe `QuoteRequestView` fields — no uuids, rule values or trace can
leak. Still visibility-only: no status changes, assignment, conversion, or any
write. (CRM workflow + notifications remain deferred.)

### Cleaning Plans — admin CRUD

`/calculator → Plans` can now **add** a plan and **archive** (soft-delete) a plan,
in addition to editing. The plan key is locked after creation; the **default**
plan and the **last active plan a public service requires** are protected from
archiving. No hard delete — archiving keeps quote history intact.

### Services & Fields — admin CRUD + readiness

`/calculator → Services` can now **add** a service (created as a hidden draft) and
**archive** one. Each service shows a **readiness badge** computed by the pure
`computeServiceReadiness`:

| Badge | Meaning |
| --- | --- |
| **Ready** | engine-backed model + active questions + active rules (+ active plan if required) **and** currently enabled |
| **Draft** | structurally complete but not enabled (safe to publish) |
| **Missing fields** | no active questions |
| **Missing pricing** | no active pricing rules, or requires a plan but none active |
| **Unsupported pricing** | pricing model the engine does not implement (never public) |

A service whose model is **unsupported** has its *Enabled* switch locked, so it can
never reach the public calculator.

### Service templates (migration 0065) — seeded as HIDDEN DRAFTS

Migration 0065 widens the `calculator_services_pricing_model_check` whitelist (a
pure superset — existing rows unaffected) and seeds 5 new services as hidden
drafts (`enabled=false, coming_soon=false`) for the MVP company:

| Service | Key | Model (template) | Status |
| --- | --- | --- | --- |
| Kontorsstädning | `office_cleaning` | `office_cleaning_recurring_area_frequency` | Draft (5 starter questions, no rules) |
| Fönsterputs | `window_cleaning` | `window_cleaning_count_based` | Draft (no questions/rules) |
| Storstädning | `deep_cleaning` | `deep_cleaning_area_addons` | Draft |
| Trappstädning | `stairwell_cleaning` | `stairwell_cleaning_floors_frequency` | Draft |
| Upphandling | `procurement` | `inquiry_only_no_price` | Draft (inquiry-only) |

After 0065 the company has **7 services (2 public-ready + 5 hidden drafts)** and
**17 questions** (12 + 5 office). The 5 drafts are admin-only and never returned
by the public config (they are neither enabled nor coming-soon), so the public
calculator still shows only **Hemstädning + Flyttstädning**.

### Public service display — featured first-3 + “Visa fler”

The public selector (`partitionFeaturedServices`) shows the first 3 public-ready
services (ordered by the admin-configurable `sort_order`) and reveals any
remaining ones behind a **“Visa fler”** toggle. With ≤ 3 services no toggle is
shown; if the already-selected service is in the hidden group it starts expanded.

### Deferred: new pricing-model engines (the reason templates stay non-public)

The pure engine implements only `home_cleaning_recommended_hours` and
`move_out_fixed_plus_addons` (mirrored byte-for-byte across
`src/lib/calculator/pricingEngine.ts` + the Deno copy, parity-locked by
`pricingEngineParity.test.ts`). Making a template service public requires, **per
service**, a dedicated follow-up slice:

1. Implement `calculate<Model>Price` in **both** engine copies + a new `switch`
   case; keep `pricingEngineParity.test.ts` green.
2. Add the model to `SUPPORTED_PRICING_MODELS` + `PRICING_SUPPORTED_QUESTION_KEYS`
   and to the engine `PricingModel` union/`PRICING_MODELS` arrays.
3. Seed `pricing_rules` for the service (the numbers).
4. Cover with engine + parity + public-calculator tests.
5. Then the admin readiness flips to **Ready/Draft** and the *Enabled* switch unlocks.

Suggested order: **office** (the intended 3rd public service: area × frequency,
+ toilets/workstations), then deep → stairwell → window; **procurement** stays an
inquiry-only flow (no auto price) until a no-price submit path is designed.

### Company-admin future-readiness

Every calculator table already carries `company_id` + `company_legacy_id`, and
0058/0059 ship commented Phase-2 “own company” policies. Today everything is
Super-Admin-only (write + manage). A future Company-Admin calculator phase is a
pure RLS + UI scoping change (no schema change): enable the drafted own-company
SELECT/write policies, replace the slug-resolved MVP target with the signed-in
admin’s company, and seed defaults (Hemstädning/Flyttstädning/Kontorsstädning) per
new company. Not enabled in this slice.

---

## 2.6 Slice 12E + 12F — Office cleaning public-ready + refinement (migrations 0066, 0067)

Office cleaning (`office_cleaning` / **Kontorsstädning**) is now the **third
public-ready service**, joining Hemstädning and Flyttstädning. The calculator stays
**dark** (`calculator_settings.enabled = false`); no pricing math for any other
service, no RLS, no Edge Function behaviour, and no never-trust-client-price
contract was changed.

### What shipped

- **12E (migration 0066):** office becomes engine-backed via the pure
  `office_cleaning_recurring_area_frequency` model (area × frequency, plus
  toilets / meeting-rooms / kitchen / workstations), mirrored byte-for-byte across
  `src/lib/calculator/pricingEngine.ts` + the Deno copy and parity-locked. The
  recurring estimate displays as **“Uppskattat månadspris … /mån”**.
- **12F (migration 0067):** office refinement —
  - Frequency reworked to **ordinary-cleaning intervals**: `weekday_daily`
    (5 visits/wk), `weekly` (1), `biweekly` (0.5), `every_four_weeks` (0.25), plus
    **`custom_interval`** (“Annat intervall”) which the engine routes to
    **manual review** — no misleading auto price, but the customer can still submit.
  - **Supervision (tillsynsstädning)** added as a price-affecting recurring add-on
    (toggle + visits/week + minutes/visit). Effective minutes = entered minutes +
    `supervision_start_minutes` (seeded **15**, editable in Pricing Rules, never
    hardcoded). Effective minutes → monthly hours (× visits/wk × 4.33) → × hourly
    rate, added **before** margin/rounding. Example: 30 + 15 = **45 effective min**.
  - Three **information-only** office fields (consumables / other add-ons /
    after-hours) that never affect the price.
  - Toilet help text clarified: *“Räkna varje enskild toalett, inte toalettstationer.”*
  - Public video relocated **below** the blue price/info box (fade-in → play once →
    fade-out, muted, non-blocking).

### Migration 0067 — applied + verified in the dev/test DB

Applied against the linked dev/test project with the documented read-only/SQL
runner (idempotent: 1 pricing rule + 6 questions via `on conflict do nothing`,
plus idempotent option/help-text updates):

```bash
node scripts/mgmt-db-query.mjs supabase/migrations/0067_office_cleaning_supervision_and_intervals.sql
```

Read-only verification (via the same runner) confirmed the post-apply state:

| Check | Expected | Verified |
| --- | --- | --- |
| `calculator_settings.enabled` | `false` (dark) | ✅ false |
| `supervision_start_minutes` office rule | present + active, value 15 | ✅ 1 active = 15 |
| office frequency options | weekday_daily / weekly / biweekly / every_four_weeks / custom_interval | ✅ |
| new office questions | 6 (supervision ×3 + 3 info-only) | ✅ 6 present |
| office required rules | `hourly_rate` + `supervision_start_minutes` active | ✅ both active |
| office readiness | **Ready** (supported model + active questions + required rules + enabled) | ✅ Ready |
| public-ready services | Hemstädning, Flyttstädning, Kontorsstädning (exactly 3) | ✅ 3 |
| draft services hidden | window / deep / stairwell / procurement (`enabled=false`) | ✅ hidden |
| leads baseline | prospects 0 / quote_requests 0 | ✅ 0 / 0 |

Because exactly **3** services are public-ready, the public selector shows all
three and **no “Visa fler”** toggle appears (it returns only once a 4th service
becomes public-ready). The 4 remaining templates stay admin-only hidden drafts and
are never returned by the public config.

> **Applying/verifying migrations in this sandbox:** there is no separate CI step —
> migrations are run against the linked project with
> `node scripts/mgmt-db-query.mjs <file.sql>` (Management-API SQL via
> `SUPABASE_ACCESS_TOKEN`). 0067 is additive + idempotent, so re-running it is safe.

---

## 3. Verification commands (read-only)

Run from `web-cleanops/`. These never print secrets.

**DB state (Management API, read-only SQL):**

```bash
node scripts/mgmt-db-query.mjs path/to/your-readonly.sql
```

A read-only state query resolves the company via the public slug and counts
config + leads:

```sql
with cs as (
  select company_id, company_legacy_id, enabled
  from calculator_settings
  where public_slug = 'rakna-ut-ditt-pris' and deleted_at is null
)
select
  (select enabled from cs) as enabled,
  (select count(*) from calculator_services  s where s.company_id = (select company_id from cs) and s.deleted_at is null) as services,
  (select count(*) from cleaning_plans       p where p.company_id = (select company_id from cs) and p.deleted_at is null) as plans,
  (select count(*) from calculator_questions q where q.company_id = (select company_id from cs) and q.deleted_at is null) as questions,
  (select count(*) from pricing_rules        r where r.company_id = (select company_id from cs) and r.deleted_at is null) as pricing_rules,
  (select count(*) from prospects           pr where pr.company_legacy_id = (select company_legacy_id from cs) and pr.deleted_at is null) as prospects,
  (select count(*) from quote_requests      qr where qr.company_legacy_id = (select company_legacy_id from cs) and qr.deleted_at is null) as quote_requests;
```

**Dark-state submit probe** (expect `available:false` / `status:"not_available"`,
then re-run the state query and confirm counts are unchanged): POST
`action:"submit"` to `<EXPO_PUBLIC_SUPABASE_URL>/functions/v1/public-calculator`
with the anon key as both `apikey` and bearer.

**Anonymous table probe** (expect `[]` on reads, `42501` on writes): GET/POST
`<EXPO_PUBLIC_SUPABASE_URL>/rest/v1/<table>` with the anon key for
`calculator_settings`, `calculator_services`, `cleaning_plans`, `prospects`,
`quote_requests`, `quote_request_answers`.

**Automated tests + build:**

```bash
bunx vitest run calculator seo   # full calculator-facing suite
# then run the project build/static checks
```

---

## 4. Manual QA checklist (controlled soft-launch test)

Use a clearly identifiable test customer (per the test-data policy), e.g.
`calculator.qa+e2e@stadportalen.test`. Keep the enablement window short.

1. **Open the public page while dark.** Visit `/rakna-ut-ditt-pris`. Confirm:
   coming-soon/dark state, no submit form, no console errors. (Optional: view source
   → `robots` is `noindex`.)
2. **Open `/calculator`** as a Super Admin with `calculator.manage`. Confirm status
   shows `enabled = false`, the service/plan/question counts look right, and the
   Quote Requests inbox shows its empty state.
3. **Enable the calculator** from `/calculator` (confirm the dialog). Status flips to
   `enabled = true`.
4. **Reopen the public page.** Confirm the live calculator renders (services,
   questions, plan selector) and the page is no longer dark.
5. **Fill the home-cleaning example:** service `Hemstädning`, ~70 m², 1 bathroom,
   add-on "oven", plan `Flexibelt`. Confirm a price/range and estimated hours appear.
6. **Fill the move-out example:** service `Flyttstädning`. Confirm it prices without
   requiring a cleaning plan.
7. **Submit one test quote.** Enter the `*.test` contact (valid email required; name/
   phone/postal optional) and submit.
8. **Check the confirmation.** Confirm the "offertförfrågan skickad" confirmation,
   the price/range, and that no internal IDs/trace are shown.
9. **Check `/calculator` inbox.** The new quote appears with contact, service, plan,
   price/range, status, and created date.
10. **Open the quote detail.** Confirm contact/prospect info, request info, submitted
    answers, and the safe snapshot summary — and that **no** raw trace / ruleValues /
    UUIDs are rendered.
11. **Disable the calculator** from `/calculator`. Status returns to `enabled = false`.
12. **Confirm the public page is dark again** and submit is unavailable.
13. **Clean up the test data.** Remove the synthetic `*.test` prospect / quote /
    answers and confirm counts return to baseline (prospects 0 / quote_requests 0 /
    quote_request_answers 0). Record exactly what was removed.

### Post-QA safety

- `calculator_settings.enabled` must be `false`.
- Lead counts back to baseline (0/0/0) if test rows were cleaned.
- No unexpected prospects/quotes remain.
