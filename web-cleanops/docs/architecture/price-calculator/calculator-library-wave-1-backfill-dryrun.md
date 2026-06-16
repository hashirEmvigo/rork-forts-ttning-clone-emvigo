# Calculator Library Wave 1 — Backfill / Dedupe Proposal & Dry-Run Report

**Ticket:** GPM-CALC-LIBRARY-6
**Status:** Proposal + dry-run report ONLY. No production data was changed. No backfill was applied. No SQL was executed against any environment.
**Depends on:** GPM-CALC-LIBRARY-2A (migration `0077_calculator_library_foundation.sql`) — the library tables + nullable `library_item_id` columns must exist before any linking.
**Blocks:** GPM-CALC-LIBRARY-7 (the actual, separately-approved backfill).

---

## 1. Purpose & scope

Prepare the existing service-scoped `calculator_questions` / `calculator_addons` rows for linking to reusable library items, **without applying any data migration**. This document delivers:

- The dedupe methodology and the conflict taxonomy.
- A **read-only dry-run SQL script** (Section 8) the team can run to get authoritative counts/conflicts from the live database.
- An **illustrative dry-run** (Sections 4–5) derived from the repository seed migrations, since the agent cannot execute live SQL.
- Deterministic default-selection + conflict-resolution rules (Section 6).
- The proposed (not-yet-written) backfill design, idempotency, rollback, and the approval gate (Sections 7, 9–11).

### Hard boundaries honoured by this ticket

- No production data changes.
- No silent update of existing rows.
- No actual backfill (that is GPM-CALC-LIBRARY-7, and requires explicit approval).
- No schema change beyond the already-approved `0077` foundation.
- No public runtime / Edge / pricing-engine change.

---

## 2. Why the authoritative numbers must come from a live dry-run

Two facts shape this report:

1. **Add-ons are admin-authored, not seeded.** Migration `0074_calculator_addons_generic_engine.sql` creates `calculator_addons` as an **empty** table ("NO seed rows. Admin authors every add-on by hand"). Therefore the repository contains **zero** seeded add-on rows, and the real `calculator_addons` population exists **only in the live database**. The add-on backfill counts/conflicts can only be produced by running the Section 8 SQL on the live environment.
2. **Questions are seeded but may have been edited live.** The seed migrations (`0060`, `0061`, `0065`–`0070`) define an initial question set, but Admin can edit labels/help/required/sort order and add/retire questions. The seed gives a faithful **illustrative** picture; the live dry-run gives the **authoritative** one.

The agent is not permitted to run live SQL, so Sections 4–5 are the seed-grounded illustration and Section 8 is the script to obtain the real figures before GPM-CALC-LIBRARY-7.

---

## 3. Dedupe model (what becomes a library item, what links to it)

- A **library item** is one reusable definition per `(company_id, <key>)`. The candidate set is the **distinct** `question_key` (resp. `addon_key`) values used across a company's live service rows.
- Each existing service row would set its new `library_item_id` to the matching library item (same company, same key). The service row keeps ALL of its own columns — it stays the activation/override layer. The library item only stores the chosen **defaults**.
- A `question_key`/`addon_key` used by **only one** service still becomes a library item (so it can be reused later); linking is trivial (no conflict possible).
- A key used by **multiple** services is where conflicts can arise (different label/help/required/validation/effects). The library item gets ONE deterministic default (Section 6); each service row keeps its own values via the columns it already has.

---

## 4. Illustrative QUESTION dry-run (from repository seed migrations)

Distinct `question_key`s seeded across services (Home `home_cleaning`, Move-out `move_out_cleaning`, Office `office_cleaning_recurring_area_frequency`). "Services" lists where the key is seeded; "Conflict?" flags cross-service differences in copyable defaults.

| question_key | Services | input_type | Cross-service differences | Conflict? |
|---|---|---|---|---|
| `sqm` | Home, Move-out, Office | number | Same label "Boyta (m²)"; **help_text differs** ("…som ska städas" vs "…som ska flyttstädas") | help_text |
| `bathrooms` | Home, Move-out | integer | Same label "Antal badrum"; **help_text differs** (null vs "Första badrummet ingår…"); **validation differs** (min 0 vs min 1) | help_text, validation |
| `frequency` | Home, (Office) | select | Same label "Hur ofta?"; **options may differ** per service | options (verify live) |
| `postal_code` | Home, Move-out | postal_code | Same label "Postnummer"; same help; same `affects_pricing=false`; same pattern | **none (identical)** |
| `property_type` | Move-out, (Home 0061) | select | Options may differ per service | options (verify live) |
| `has_pets` | Home (0068) | boolean | Single service today (`affects_pricing=true`) — see GPM-CALC-LIBRARY-8 | n/a (single service) |
| `addons` | Home | multiselect | Single service; legacy multiselect — NOT a generic add-on | n/a (single service) |
| `glazed_balcony` / `divisible_windows` / `desired_date` | Move-out | boolean / date | Single service each | n/a |
| office-only keys (`toilets`, `workstations`, `meeting_rooms`, `has_kitchen`, `supervision_*`) | Office | various | Single service each | n/a |

**Illustrative proposed question library items (seed view):** one per distinct key above — roughly **13–15** items for the MVP company, of which the **multi-service** keys with differences are `sqm`, `bathrooms`, `frequency`, `property_type`; the only **clean identical** multi-service key is `postal_code`.

> These are illustrative. Run Section 8 for the authoritative live list.

---

## 5. Illustrative ADD-ON dry-run

- **Repository seed:** `calculator_addons` is seeded empty (`0074`). There are **0** add-on rows in the repo.
- **Live database:** the real population (e.g. pets, oven, fridge, inside windows, extra bathroom) exists only live. Likely conflict axes when the SAME `addon_key` is reused across services:
  - different `public_label` / `name` / `description` (copy)
  - different `input_type` (`boolean` vs `quantity`)
  - different effect values (`effect_time_minutes` / `effect_fixed_excl_vat` / `effect_percent`)
  - different `required` / `public_visible`

Authoritative add-on counts/conflicts **require** the Section 8 add-on queries against live data.

---

## 6. Conflict taxonomy & deterministic resolution rules

When one key appears on multiple services with differing copyable defaults, the library item needs ONE default. Proposed **deterministic** rules (so the backfill is reproducible and review-friendly):

1. **Service priority order** (most-canonical first): `home_cleaning` → `move_out_cleaning` → `office_cleaning_recurring_area_frequency` → any other by `calculator_services.sort_order`, then `service_key` ascending. The library default is taken from the **highest-priority service** that uses the key.
2. **Within a service**, prefer the **live** row (`deleted_at is null`); if multiple, the **active** one; then lowest `sort_order`; then lowest `created_at`.
3. The chosen row's copyable fields populate the library default:
   - Questions: `label`, `help_text`, `input_type`, `default_required ← required`, `default_affects_pricing ← affects_pricing`, `default_options_json ← options_json`, `default_validation_json ← validation_json`, `default_sort_order ← sort_order`.
   - Add-ons: `name`, `public_label`, `description`, `input_type`, `boolean_default`, `quantity_*`, the three `effect_*` channels, `default_sort_order ← sort_order`.
4. **No row is changed to match the default.** Every service row keeps its own values; only `library_item_id` is set. Divergent values become explicit per-service overrides (exactly how the Admin UX already treats them).
5. **Ambiguous concepts are excluded** from automatic backfill: `has_pets` (and any pricing-affecting question that is product-ambiguous) is NOT auto-converted — see GPM-CALC-LIBRARY-8.

---

## 7. Proposed backfill design (NOT executed here — this is GPM-CALC-LIBRARY-7)

Two idempotent phases, per company:

1. **Create library items** from the distinct keys (one `INSERT … ON CONFLICT (company_id, key) DO NOTHING` per distinct live key, populated by the Section 6 rules). Library `legacy_id` deterministic, e.g. `calc_qlib_<key>_<companyLegacy>` / `calc_alib_<key>_<companyLegacy>`.
2. **Link existing rows**: `UPDATE calculator_questions SET library_item_id = <lib.id> WHERE company_id = … AND question_key = … AND library_item_id IS NULL` (and the add-on equivalent). Only the `library_item_id` column is written; the `WHERE library_item_id IS NULL` guard makes re-runs no-ops.

No rows are deleted. No public-facing column is touched. Public output is unchanged (proven structurally by GPM-CALC-LIBRARY-5: the public mapper never reads `library_item_id`).

---

## 8. Read-only dry-run SQL (run before GPM-CALC-LIBRARY-7)

> SELECT-only. Safe to run on any environment. Produces the authoritative counts, the proposed library item set, and the conflicts. Replace nothing — it writes nothing.

```sql
-- 8.1 Distinct question keys per company + how many services use each (candidate library items)
select company_id, question_key,
       count(distinct calculator_service_id) as service_count,
       count(*)                              as row_count
from calculator_questions
where deleted_at is null
group by company_id, question_key
order by company_id, service_count desc, question_key;

-- 8.2 QUESTION conflicts: a key whose copyable defaults differ across services
select company_id, question_key,
       count(distinct label)            as distinct_labels,
       count(distinct coalesce(help_text,''))   as distinct_help,
       count(distinct required::text)   as distinct_required,
       count(distinct affects_pricing::text)    as distinct_affects_pricing,
       count(distinct input_type)       as distinct_input_types,
       count(distinct validation_json::text)    as distinct_validation,
       count(distinct options_json::text)       as distinct_options
from calculator_questions
where deleted_at is null
group by company_id, question_key
having count(distinct label) > 1
    or count(distinct coalesce(help_text,'')) > 1
    or count(distinct required::text) > 1
    or count(distinct affects_pricing::text) > 1
    or count(distinct input_type) > 1
    or count(distinct validation_json::text) > 1
    or count(distinct options_json::text) > 1
order by company_id, question_key;

-- 8.3 Distinct add-on keys per company + service usage (candidate library items)
select company_id, addon_key,
       count(distinct calculator_service_id) as service_count,
       count(*)                              as row_count
from calculator_addons
where deleted_at is null
group by company_id, addon_key
order by company_id, service_count desc, addon_key;

-- 8.4 ADD-ON conflicts: a key whose copyable defaults/effects differ across services
select company_id, addon_key,
       count(distinct public_label)           as distinct_labels,
       count(distinct name)                   as distinct_names,
       count(distinct input_type)             as distinct_input_types,
       count(distinct effect_time_minutes::text)   as distinct_time,
       count(distinct effect_fixed_excl_vat::text) as distinct_fixed,
       count(distinct effect_percent::text)        as distinct_percent
from calculator_addons
where deleted_at is null
group by company_id, addon_key
having count(distinct public_label) > 1
    or count(distinct name) > 1
    or count(distinct input_type) > 1
    or count(distinct effect_time_minutes::text) > 1
    or count(distinct effect_fixed_excl_vat::text) > 1
    or count(distinct effect_percent::text) > 1
order by company_id, addon_key;

-- 8.5 Sanity: how many rows are already linked (should be 0 before backfill)
select 'questions' as tbl, count(*) as linked from calculator_questions where library_item_id is not null and deleted_at is null
union all
select 'addons', count(*) from calculator_addons where library_item_id is not null and deleted_at is null;
```

Capture the output of 8.1–8.5 and attach it to the GPM-CALC-LIBRARY-7 approval request.

---

## 9. Idempotency

- Library-item creation uses `ON CONFLICT (company_id, key) WHERE deleted_at is null DO NOTHING` → re-running creates nothing new.
- Linking updates are guarded by `library_item_id IS NULL` → re-running links nothing already linked.
- The whole backfill is therefore safe to re-run; a partial run can be resumed.

## 10. Rollback

- Fully reversible without data loss: `UPDATE … SET library_item_id = NULL` clears the links, and soft-deleting (`deleted_at = now()`) the created library items removes them. No service row content is ever modified, so unlinking restores the exact pre-backfill state.
- Because the public mapper ignores `library_item_id`, neither linking nor rollback changes any public output.

## 11. Risk assessment & approval gate

| Aspect | Assessment |
|---|---|
| Public calculator behaviour | **No change** (mapper never reads `library_item_id`; proven by GPM-CALC-LIBRARY-5). |
| Pricing / calculate / submit | **No change** (no pricing column touched). |
| Existing rows | Only `library_item_id` set; all other columns preserved. |
| Reversibility | High (null the column; soft-delete library items). |
| Idempotency | Yes. |
| Data ambiguity | `has_pets` and similar ambiguous keys are **excluded** (GPM-CALC-LIBRARY-8). |
| Overall risk | **Low**, conditional on reviewing the live Section 8 output first. |

**Approval needed before GPM-CALC-LIBRARY-7:**

1. Run Section 8 on the target (staging first, then production) and review counts/conflicts.
2. Confirm the Section 6 deterministic rules are acceptable for the real conflicts found.
3. Confirm the `has_pets` / ambiguous-key exclusion (pending GPM-CALC-LIBRARY-8).
4. Explicitly approve writing + applying the backfill migration. The agent will not apply live SQL.

---

## 12. Recommendation

Proceed to GPM-CALC-LIBRARY-7 **only after** the live Section 8 dry-run is reviewed and the resolution rules + `has_pets` decision are approved. The backfill is low-risk, idempotent, and reversible, but the authoritative conflict set (especially for the admin-authored add-ons, which the repo cannot show) must come from the live database first.
