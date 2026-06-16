# CleanOps — Tenant Deletion & Schema-Hardening Proposal (architecture note)

> **Status:** PROPOSAL / ARCHITECTURE NOTE. **No schema changes are implemented
> by this document and none are authorised by it.** This is an analysis and a set
> of options for review. A migration may follow only after an explicit decision.
>
> **Trigger for this note:** the Städalliansen Sverige AB reset (see
> `42-tenant-test-data-reset-runbook.md`) exposed that tenant deletion currently
> depends on a mix of FK behaviours that do **not** combine into a clean,
> single-step "delete a company" operation.

---

## 1. Problem statement

Deleting a company today is **not** a safe single action, because the schema
mixes two incompatible FK behaviours under one parent (`companies`):

- **Company-scoped operational tables cascade.** `customers` (`0007`),
  `mission_log_*` (`0031`), time-reporting tables (`0032`), and others use
  `company_id ... references companies(id) on delete cascade`. Deleting the
  company row removes them automatically.
- **`profiles` does the opposite.** `profiles.company_id references companies(id)
  on delete set null` (`0003`, line 34). Deleting the company row does **not**
  delete the profiles — it tries to set their `company_id = NULL`.
- **A CHECK then fights that NULL-ing.** `profiles_company_required_check`
  (`0003`) requires every non-super_admin to have a non-null `company_id`. So the
  `SET NULL` either (a) is blocked by the CHECK, or (b) succeeds and leaves
  detached, role-violating profiles.

The net effect observed in production: a naive company delete leaves orphaned (or
constraint-violating) `profiles`, while their `auth.users` rows persist
untouched (because `auth.users` → `profiles` cascade only runs in the
auth→profile direction). Cleanup currently requires a carefully ordered manual
runbook instead of one intentional operation.

> This proposal is about removing that ambiguity — making tenant deletion an
> **explicit, intentional routine** rather than an emergent property of mismatched
> FK rules.

---

## 2. Why the current `ON DELETE SET NULL` exists (and why it's risky)

The `SET NULL` choice was reasonable at the time of `0003`: it avoided
accidentally destroying user/profile rows if a company row was ever removed
during early migration work. But combined with the later CHECK constraint and the
cascade behaviour of every *other* company-scoped table, it now produces an
inconsistent and surprising deletion model:

- It is the **only** company-scoped relationship that does not cascade.
- It is directly contradicted by a CHECK on the same table.
- It silently converts "delete tenant" into "detach users from tenant", which is
  almost never what an operator intends.

---

## 3. Options for `profiles.company_id` deletion behaviour

Four options, with trade-offs. **No option is selected here.**

### Option A — Keep `ON DELETE SET NULL`, delete profiles explicitly (status quo + runbook)

- **What:** No schema change. Tenant deletion always goes through the runbook,
  which deletes `profiles` (and children) explicitly **before** the company row.
- **Pros:** Zero migration risk; already validated; keeps a deliberate human step
  in front of a destructive action.
- **Cons:** Deletion correctness lives in a runbook, not the schema. A future
  ad-hoc `DELETE FROM companies` (outside the runbook) still produces detached or
  CHECK-violating profiles. Fragile against new operators.

### Option B — Change to `ON DELETE CASCADE`

- **What:** `profiles.company_id references companies(id) on delete cascade`.
  Deleting a company deletes its profiles automatically, matching every other
  company-scoped table.
- **Pros:** Consistent with the rest of the schema; "delete company" becomes one
  clean operation; no detached profiles possible.
- **Cons:** Most dangerous default — a single `DELETE FROM companies` now silently
  removes user/profile rows. Does **not** touch `auth.users`, so it still leaves
  orphaned auth rows (auth cleanup remains a separate step). The super_admin is
  safe (his `company_id` is NULL), but company_admin/employee profiles vanish
  with no second checkpoint. Cascade deletes are exactly the kind of "quiet
  destruction" that hid the earlier non-persisted-commit confusion.

### Option C — Change to `ON DELETE RESTRICT` (or `NO ACTION`)

- **What:** Block deletion of a company while any profile still references it.
  Forces the operator to delete profiles first (which the runbook already does).
- **Pros:** Fail-closed and loud — you physically cannot delete a tenant with
  live users still attached. Makes the runbook's ordering a hard schema
  requirement rather than a convention. Strongest guard against accidental tenant
  loss.
- **Cons:** Requires the explicit deletion routine to exist and be used (it does,
  via the runbook). Slightly more friction for legitimate deletions. Needs the
  CHECK to remain compatible (it does — profiles are deleted, never NULL-ed).

### Option D — Explicit deletion routine (recommended direction), FK as backstop

- **What:** Introduce a single, audited, SECURITY DEFINER routine —
  `delete_company_tenant(target_company_id uuid)` — that performs the ordered
  deletion (children → profiles → company) in one place, with built-in guards
  (refuses if `target` is NULL; never touches `company_id IS NULL` super_admins;
  returns per-table counts). Pair it with **Option C (`RESTRICT`)** on
  `profiles.company_id` so the schema *enforces* that profiles are gone before the
  company row can be removed.
- **Pros:** Tenant deletion becomes one intentional, testable, logged operation.
  The FK (`RESTRICT`) is a backstop that makes the "wrong" order impossible.
  Removes reliance on a human following a runbook perfectly. Centralises the
  super_admin protection and ordering logic.
- **Cons:** Most work; needs careful design of the routine's guards, transaction
  handling, and `auth.users` interaction (see §5). Should still be paired with
  the runbook for the privileged-execution context.

**Recommended direction:** **Option D, with Option C as the underlying FK
behaviour.** This converts deletion from "emergent FK behaviour + manual
discipline" into "one explicit routine + a fail-closed schema backstop." The
runbook in `42-...` then becomes the *execution wrapper* for that routine rather
than the source of correctness.

---

## 4. Should profiles cascade, restrict, or be deleted explicitly?

Summarised recommendation:

| Behaviour | Verdict | Rationale |
| --- | --- | --- |
| Cascade (B) | Not recommended as the primary guard | Quiet destruction of user rows; no checkpoint; still leaves orphaned `auth.users`. |
| Restrict (C) | Recommended as the FK behaviour | Fail-closed; enforces ordering; impossible to lose a tenant by accident. |
| Explicit routine (D) | Recommended as the mechanism | One audited place for ordering, guards, super_admin protection, and counts. |
| Set null (status quo, A) | Phase out | Contradicts the CHECK; inconsistent with all other company-scoped tables. |

---

## 5. Interactions to resolve before any migration

Each of these must be explicitly answered in the migration design — not assumed.

### Protected super_admin
- super_admin has `company_id = NULL`, so **no** company-scoped operation
  (cascade, restrict, or routine) can ever match him. Any routine must still
  assert this explicitly (`company_id IS NOT NULL` filter) as defence in depth.

### `auth.users`
- `profiles.id references auth.users(id) on delete cascade` is **one-directional**:
  deleting an auth user deletes its profile, **not** the reverse. So **none** of
  the options above remove `auth.users` rows. Tenant deletion will always leave
  orphaned auth rows unless the routine *also* deletes the matching `auth.users`
  (allowlist + `NOT EXISTS` profile guard + super_admin exclusion, per the
  runbook). Decide whether `delete_company_tenant` should optionally cascade into
  auth, or whether auth stays a deliberate separate step (current runbook stance).

### company_admin accounts
- Treated like any other company-scoped profile: deleted with the tenant. Confirm
  there is no business rule that a company_admin can belong to multiple companies
  (current schema: single `company_id`, so no).

### employee accounts
- Same as company_admin. Note employees also have an `employees` row (`0010`,
  cascade) distinct from their `profiles` row — both are company-scoped and both
  must be removed. The routine should cover both.

### Future tenant resets
- A single `delete_company_tenant` routine makes future resets a parameterised,
  repeatable call instead of a bespoke script per tenant. New company-scoped
  tables must be added to the routine in the same migration that creates them.

### RLS / multi-tenant safety
- All deletion runs as a privileged/SECURITY DEFINER context (RLS-exempt). The
  routine must therefore carry its **own** company-scoping guards, since RLS will
  not constrain it. Verify the routine cannot be invoked by non-super_admin roles
  (revoke execute from `authenticated`/`anon`; grant only to service role /
  super_admin path).

### Invitation & profile auto-provisioning flows
- `trg_on_auth_user_created` is `AFTER INSERT` only (`0004`) and fail-closed: it
  requires a valid `company_id` for non-super_admins. Deleting a tenant does not
  trigger it. **But:** if any invitation token / pending-invite record references
  the deleted `company_id`, those must be invalidated by the routine too, or a
  later sign-up could fail provisioning (company no longer exists) — confirm
  whether such invite records exist before migrating, and include them in the
  routine if so.

---

## 6. Proposed shape (for review only — not implemented)

If Option D is approved, the migration would (in one reviewed change):

1. Alter `profiles.company_id` FK from `ON DELETE SET NULL` to `ON DELETE
   RESTRICT`.
2. Create `delete_company_tenant(target_company_id uuid)` (SECURITY DEFINER,
   `search_path = ''`) that:
   - asserts `target_company_id IS NOT NULL` and that the company exists;
   - deletes company-scoped children, then profiles
     (`where company_id = target_company_id`), then the company row, in the
     runbook order;
   - never matches `company_id IS NULL` rows (super_admin safety);
   - returns a per-table deleted-row count for verification;
   - optionally (decision pending §5) deletes orphaned `auth.users` for that
     tenant via allowlist semantics, or leaves auth as a separate step.
3. Restricts execute permission to the super_admin / service-role path only.
4. Updates `42-tenant-test-data-reset-runbook.md` so the runbook calls the
   routine and keeps the SELECT-only verification phases.

No part of §6 is to be built until explicitly approved.

### 6.1 Reviewable draft (unapplied)

A concrete, **unapplied** draft of this migration now exists for review:

- `proposed-migrations/0034_tenant_deletion_routine.sql.proposed` — the FK
  swap (Part 1), the `delete_company_tenant(...)` routine (Part 2), and the
  execution lock-down (Part 3). It lives outside `supabase/migrations/` and uses
  a `.sql.proposed` extension so the migration runner cannot auto-apply it.
- `proposed-migrations/0034_tenant_deletion_routine.test-plan.md` — the staging
  test plan (guard rejections, happy path, isolation, auth-untouched, permissions).

These are drafts only. Promotion requires: approval of the open decisions in §7,
renaming to a real `0034_*.sql`, moving it into `supabase/migrations/`, and
passing the test plan on staging before any production apply.

---

## 7. Open decisions for sign-off

1. FK behaviour for `profiles.company_id`: **RESTRICT** (recommended) vs CASCADE
   vs keep SET NULL.
2. Mechanism: explicit `delete_company_tenant` routine (recommended) vs
   runbook-only.
3. Does the routine cascade into `auth.users`, or stays a separate optional step?
4. Handling of invitation / pending-invite records that reference a deleted
   company (confirm they exist first).
5. Execution-permission model for the routine (service role / super_admin only).
