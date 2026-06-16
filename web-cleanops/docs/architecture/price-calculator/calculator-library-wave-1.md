# Calculator Library Wave 1 — Questions + Add-ons

**Project:** CleanOps / Städportalen — Admin Calculator  
**Document type:** GitHub-ready architecture wave and ticket backlog  
**Purpose:** Give RORK a stable, ordered ticket plan so future work can be executed one ticket at a time without drifting into broad refactors.  
**Status:** Planning document. No implementation should happen just because this document exists.

---

## 1. Executive summary

The calculator now supports a working generic `sqm_fixed` service flow, including public selection, m² input, RUT, and customer add-ons. The next architectural step is to stop manually recreating common questions and add-ons for every service.

We want a shared calculator library architecture for:

1. **Reusable Questions / Inputs**
2. **Reusable Add-ons / Extras**

The selected service should still have service-specific activation and overrides. The library should define reusable defaults; the service-level row should decide whether the item is active for that service and what overrides apply.

---

## 2. Approved architecture decisions

These decisions are approved direction for this wave unless explicitly changed later.

| Decision | Approved direction |
|---|---|
| Library model | Use **separate libraries**: one for Questions, one for Add-ons. Do not build one over-generalized unified table. |
| Activation layer | Keep existing service-scoped tables as the activation/override layer: `calculator_questions` and `calculator_addons`. |
| New linkage | Add nullable `library_item_id` references to existing service-scoped tables. Existing rows with `library_item_id = null` continue to behave exactly as today. |
| Scope | Company-scoped libraries first. Do not build a global/superadmin cross-company library yet. |
| Runtime | Prefer public/runtime backward compatibility. Public config should continue to resolve to today’s `questions[]` and `addons[]` shapes. |
| Existing data | Do not silently migrate or rewrite existing questions/add-ons. Backfill must be separate and approved. |
| “Vi har husdjur” | Keep as a question for now. Do not convert it to an add-on automatically. |

---

## 3. Core domain model

### 3.1 Question / Input

A question is a customer input field.

Examples:

- `sqm` / Boyta m²
- `frequency` / Intervall
- `postal_code` / Postnummer
- `has_pets` / Vi har husdjur
- `bathrooms` / Antal badrum

A question may be required, optional, pricing-affecting, routing-related, or quote-context-only.

### 3.2 Add-on / Extra

An add-on is an optional extra choice that can affect time, fixed price, or percent adjustment.

Examples:

- Ugnsrengöring
- Rengöring kylskåp
- Insida fönster
- Plocka undan leksaker
- Extra badrum
- Husdjur, if we later decide to model it as an add-on instead of a pricing-affecting question

### 3.3 Ambiguous items

Some product concepts can be either a question or an add-on. `Vi har husdjur` is the current example. Today it is a question. Do not migrate ambiguous items automatically.

---

## 4. Current-state assumptions to preserve

These assumptions come from the prior RORK architecture report and must be verified before implementation.

| Area | Current state |
|---|---|
| `calculator_questions` | Service-scoped table. Unique by service + question key. Has active/deleted state, required, affects_pricing, sort order, input type, options, validation. |
| `calculator_addons` | Service-scoped table. Unique by service + add-on key. Has active/public-visible state, answer type, customer copy, and effect channels: time/fixed/percent. |
| Public config | Edge config currently resolves active service-level questions/add-ons into public `PublicService.questions[]` and `PublicService.addons[]`. |
| Runtime | Runtime should not need to know about library tables if service-level rows remain the public read model. |
| Admin | Admin currently edits service-scoped rows directly. Library should add reusable source items and activation flow, not break direct custom rows. |

---

## 5. Global execution rules for RORK

These rules apply to every ticket in this wave.

1. Execute **one ticket at a time**.
2. Stop after each ticket and report.
3. Do not start the next ticket unless explicitly instructed.
4. Do not click “Fix errors”.
5. Do not do broad unrelated TypeScript cleanup.
6. Do not change pricing engine behavior unless the ticket explicitly allows it.
7. Do not change public calculator runtime unless the ticket explicitly allows it.
8. Do not change Edge Functions unless the ticket explicitly allows it.
9. Do not run SQL against production.
10. Do not silently migrate existing data.
11. Preserve Home Cleaning behavior.
12. Preserve generic `sqm_fixed` behavior.
13. Keep TypeScript clean.
14. Run targeted tests and `runChecks` when code changes.

---

## 6. Ticket sequence

### Ticket 0 — GPM-CALC-LIBRARY-0: Upload wave documentation only

**Goal:** Add this wave document to the repository documentation. Do not implement any product code.

**Suggested path:**

```text
web-cleanops/docs/architecture/price-calculator/calculator-library-wave-1.md
```

**Allowed:**

- Create documentation file(s)
- Link from an existing price-calculator docs index if appropriate

**Not allowed:**

- No source code changes
- No schema changes
- No migration
- No tests required unless docs tooling requires it

**Done when:**

- The document is saved in the repo
- RORK reports exact file path(s)
- RORK stops

---

### Ticket 1 — GPM-CALC-LIBRARY-2A: Additive schema foundation, no backfill

**Goal:** Create the schema foundation for reusable Question and Add-on library items, without changing existing public/runtime behavior and without backfilling existing data.

**Scope:**

- Add new master/library tables:
  - `calculator_question_library_items`
  - `calculator_addon_library_items`
- Add nullable FK/reference columns:
  - `calculator_questions.library_item_id`
  - `calculator_addons.library_item_id`
- Add RLS policies matching existing calculator admin patterns
- Add TypeScript/database types if the project has generated or manual DB types
- Add minimal read helpers only if needed to compile and test

**Important:**

Existing rows must keep working with `library_item_id = null`.

**Not allowed:**

- No backfill
- No dedupe
- No migration of existing questions/add-ons into library items
- No Admin UI changes
- No public config changes
- No runtime/Edge changes
- No serviceKey hardcoding

**Validation:**

- Migration is additive and idempotent where possible
- Existing tests still pass
- `tsc -p tsconfig.app.json --noEmit`
- `runChecks`

**Report:**

- Exact migration file(s)
- Exact tables/columns created
- RLS policies added
- Confirmation that no existing data is modified except nullable columns existing on table definitions
- Confirmation public/runtime untouched

---

### Ticket 2 — GPM-CALC-LIBRARY-2B: Library read/write adapters, no UI rewrite

**Goal:** Add safe admin/data helpers for library items without changing the current UI or public behavior.

**Scope:**

- Add read helpers for question library items
- Add read helpers for add-on library items
- Add create/update/archive helpers for library items if safe
- Add activation helper prototypes only if they use existing service-scoped insert/update paths
- Add tests for helper behavior

**Not allowed:**

- No UI rewrite
- No public config changes
- No runtime/Edge changes
- No data backfill
- No automatic activation

**Done when:**

- Admin/data layer can list library items
- Library item helpers are tested
- Existing service-scoped question/add-on behavior unchanged

---

### Ticket 3 — GPM-CALC-LIBRARY-3: Question Library Admin UX

**Goal:** Let admins activate/deactivate reusable library questions per service while preserving the existing service-scoped question rows as the activation/override layer.

**Desired UX:**

In the selected service’s Questions section:

- Active questions are visible by default
- A toggle shows inactive/library questions
- Admin can activate a library question for this service
- Admin can deactivate a question for this service
- Admin can override per-service:
  - label
  - help text
  - required
  - affects pricing
  - sort order
- Admin can still create a custom question if needed

**Implementation direction:**

Activation should create or reactivate a `calculator_questions` row with:

- selected service id
- copied library defaults
- `library_item_id`
- per-service override columns as today

**Not allowed:**

- No public runtime changes
- No Edge changes
- No data migration
- No automatic conversion of existing questions
- No changes to `sqm` readiness rules unless explicitly required and tested
- Do not convert `Vi har husdjur`

**Validation:**

- Existing questions still render
- Library questions can be shown and activated
- Deactivated questions are hidden by default
- `sqm` readiness is preserved
- Home and generic `sqm_fixed` unchanged

---

### Ticket 4 — GPM-CALC-LIBRARY-4: Add-on Library Admin UX

**Goal:** Let admins activate/deactivate reusable library add-ons per service while preserving existing `calculator_addons` rows as the activation/override layer.

**Desired UX:**

Inside Pricing → Add-ons:

- Active add-ons are visible by default
- A toggle shows inactive/library add-ons
- Admin can activate a library add-on for this service
- Admin can deactivate it for this service
- Admin can override per-service:
  - customer question/text
  - help text
  - answer type where safe
  - effect values
  - sort order
- Admin can still create a custom add-on if needed

**Implementation direction:**

Activation should create or reactivate a `calculator_addons` row with:

- selected service id
- copied library defaults
- `library_item_id`
- per-service effect config as today

**Not allowed:**

- No pricing engine changes
- No runtime/Edge changes
- No public contract changes
- No schema change beyond previous approved foundation
- No shared-library backfill yet
- No automatic conversion of legacy pricing rules or questions

**Validation:**

- Existing add-ons still work
- Activated library add-on appears publicly only when active/public-visible
- Add-on selections still use existing `addonSelections`
- Home and generic `sqm_fixed` unchanged

---

### Ticket 5 — GPM-CALC-LIBRARY-5: Public config compatibility tests

**Goal:** Prove that library-linked service rows produce the same public config shape as existing direct service rows.

**Scope:**

- Add tests around config mapping/read adapters
- Prove public `questions[]` and `addons[]` remain the same shape
- Prove inactive library items do not leak publicly
- Prove service-level overrides are applied before public output

**Expected result:**

Ideally no production logic change. This is mostly adapter/contract hardening.

**Not allowed:**

- No Edge runtime rewrite unless test discovery proves it is required
- No public contract breaking change
- No serviceKey hardcoding

---

### Ticket 6 — GPM-CALC-LIBRARY-6: Backfill/dedupe proposal and dry-run report

**Goal:** Prepare the existing data for library linking, but do not apply actual data migration until approved.

**Scope:**

- Analyze duplicate `question_key` / `addon_key` usage across services
- Generate a dry-run report of proposed library items
- Show how existing rows would link to library items
- Identify conflicts:
  - same key with different labels
  - same key with different required state
  - same add-on key with different effect values
- Recommend deterministic default selection rules

**Not allowed:**

- No production data changes
- No silent update of existing rows
- No actual backfill unless separately approved

**Report should include:**

- Counts
- Proposed library items
- Conflicts
- Recommended resolution
- Risk level
- Approval needed before real backfill

---

### Ticket 7 — GPM-CALC-LIBRARY-7: Approved backfill and compatibility cleanup

**Goal:** Only after Ticket 6 is reviewed and approved, perform the idempotent backfill/linking.

**Scope:**

- Create library items from existing rows
- Set `library_item_id` on matching existing service-scoped rows
- Preserve all service-level overrides
- Do not remove any rows
- Do not change public output

**Not allowed:**

- No conversion of question to add-on
- No deletion of existing rows
- No public runtime change

**Validation:**

- Public config before/after equivalent
- Existing calculator still works
- Backfill is idempotent
- Rollback plan documented

---

### Ticket 8 — GPM-CALC-LIBRARY-8: “Vi har husdjur” product decision ticket

**Goal:** Decide whether `Vi har husdjur` should remain a question, become an add-on, or support both patterns.

**Current known state:**

- Today it is a `calculator_question`
- Key: `has_pets`
- Boolean input
- `affects_pricing = true`
- Historically linked to legacy `pet_time_percent`
- V2/Home may not price it live today
- It is not currently a `calculator_addon`

**Required work:**

- Confirm current live behavior
- Propose product model:
  - keep as question
  - convert to add-on
  - support both
- If conversion is recommended, propose a safe migration path

**Not allowed:**

- No automatic conversion in this ticket unless explicitly approved
- No silent data migration
- No pricing engine change without approval

---

## 7. RORK one-ticket execution prompt template

Use this prompt when asking RORK to execute a single ticket from this document.

```text
Read `web-cleanops/docs/architecture/price-calculator/calculator-library-wave-1.md`.

Execute only this ticket:

[TICKET ID HERE]

Rules:
- Execute only that ticket.
- Do not start the next ticket.
- Stop and report when done.
- Follow all boundaries in the wave document.
- Do not click “Fix errors”.
- Keep TypeScript clean.
- Run the tests/checks required by the ticket.
- Report exact files changed and confirmations.
```

---

## 8. RORK documentation-upload prompt

Use this prompt first, before any implementation ticket.

```text
Create the documentation file below in the repo:

web-cleanops/docs/architecture/price-calculator/calculator-library-wave-1.md

Paste the full Calculator Library Wave 1 document into it.

This is documentation-only.
Do not implement any schema, migration, code, UI, runtime, Edge Function, or data changes.
Do not start any ticket.
Do not click “Fix errors”.

After creating the document, report the exact file path and stop.
```

---

## 9. Final guardrail

This wave is intentionally split so the system does not drift into a large refactor.

The approved path is:

```text
Docs first
→ Schema foundation
→ Read/write adapters
→ Question Library UX
→ Add-on Library UX
→ Public compatibility tests
→ Dry-run backfill
→ Approved backfill
→ “Vi har husdjur” decision
```

No ticket should implicitly execute the next ticket.
