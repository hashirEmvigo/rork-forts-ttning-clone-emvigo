# Paused Workstreams & Handoff Status

**Audience:** RORK / next operator picking the project back up
**Project:** CleanOps / Städportalen
**Status:** ALL THREE TRACKS BELOW ARE PAUSED — documentation/status-log only.
**Last updated:** 2026-06-12

> This is a controlled pause + handoff record. It changes no runtime code, no tests,
> no schema, no RLS, no migrations and no Edge Functions. It exists so the team can
> return later and immediately understand what happened, what is paused, what is safe
> to continue, and what must not be touched without a new explicit instruction.
>
> **Nothing in this file authorises resuming work.** Each track has explicit
> "must NOT resume automatically" rules and separate resume instructions below.

**In-app surface:** This handoff state is also surfaced in the **Development Center UI**
(Super Admin → Development Center → **Paused Workstreams**), backed by
`src/lib/pausedWorkstreams.ts` and rendered as a read-only panel on
`src/pages/superadmin/DevelopmentCenter.tsx`, with matching entries in the System
Timeline (`src/lib/developmentTimeline.ts`). So the paused tracks are discoverable in
the app, not only here in markdown. Keep the two in sync: when a track's status
changes, update both this file and `src/lib/pausedWorkstreams.ts`.

---

## 0. Quick summary

| Workstream | State | Latest safe checkpoint | Resume needs explicit instruction? |
| --- | --- | --- | --- |
| A. TypeScript cleanup / strict TS debt | **Paused** | Strict TS count ~170; last mini-wave reduced strict errors by 5 (test-only) | Yes |
| B. Calculator V2 | **Paused** | Future project; not started; do not infer from background context | Yes |
| C. Auth / Invite / Admin User Lifecycle | **Paused** | Password recovery works; `admin-user-lifecycle` deploy paused on a local repo/sync issue | Yes |

No runtime behavior was changed to reach this paused state. The two previously
completed TS slices and the latest TS mini-wave were **test-file-only** changes.

---

## A. TypeScript cleanup / strict TS debt — PAUSED

### Current status
- Track is **paused**. No new cleanup slices, no further strict-mode reduction, no
  broad TS-DEBT edits, and **no "Fix errors"** usage.
- Latest known strict TypeScript count is **~170**.

### Latest known completed work
- The latest completed mini-wave **reduced strict errors by 5** and changed **only
  test files**:
  - `src/hooks/use-work-order-mutations.test.tsx`
  - `src/hooks/use-time-bank-panel.test.tsx`
  - `src/components/workorder/ServiceProtocolLink.test.tsx`
- Previously completed safe slices:
  - Entitlements synthetic limit-key test drift.
  - `scheduleConvergence.test.ts`.
- Runtime behavior was **unchanged** across all of the above (test fixtures / test-local
  typing only).

### Blockers / deferred items
- Remaining strict TS debt is intentionally deferred and includes:
  - production / data-layer / Supabase cast debt (broad `src/lib/data/*` cast debt),
  - Calculator V2-related debt,
  - other deferred strict-mode issues.
- `runChecks` may still fail on known pre-existing TS-DEBT outside the test-only scope.
  Those known errors must **not** be fixed under this track.

### What to do next when resumed
- See "TypeScript cleanup resume instructions" in §D.
- Continue the established pattern: one small, clearly-safe, test-only fixture/typing
  slice at a time, with before/after strict counts.

### What must NOT resume automatically
- Do not start new cleanup slices automatically.
- Do not touch broad `src/lib/data/*` / Supabase cast debt.
- Do not use "Fix errors".
- Do not pull Calculator V2 or Auth/Admin-lifecycle debt into this track.

---

## B. Calculator V2 — PAUSED

### Current status
- Calculator V2 is **paused completely** and remains a **future project**.
- It is **not started**. There is an approved strategy plan on file
  (`.rork/plans/calculator-v2-rebuild-strategy_*.plan.md`), but no V2 implementation
  slice has been executed.

### Latest known completed work
- None for V2 implementation. The relevant adjacent, already-completed baseline is the
  **Home-only calculator baseline** documented in
  `docs/dev-center/price-calculator/04-home-only-baseline-status.md` (separate from V2
  rebuild work).

### Blockers / deferred items
- V2 must wait for a new explicit instruction. It should not be picked up because it
  appears in background context, plan reminders, or chat history.

### What to do next when resumed
- See "Calculator V2 resume instructions" in §D.

### What must NOT resume automatically
- Do not work on Calculator V2.
- Do not update Calculator V2 plan checkboxes.
- Do not modify calculator runtime behavior.
- Do not modify calculator tests.
- Do not infer Calculator V2 work from background context or plan reminders.

---

## C. Auth / Invite / Admin User Lifecycle — PAUSED

### Current status
- Track is **paused**, including deployment/debugging for `admin-user-lifecycle`.

### Latest known completed work
- Password recovery **works**; its UX / error handling was improved.
- Admin User Lifecycle UI / function work **exists** in the repo (the
  `supabase/functions/admin-user-lifecycle/index.ts` Edge Function and supporting UI).

### Blockers / deferred items
- `admin-user-lifecycle` **deployment is paused**.
- A local repo/sync issue blocked the operator's **local** deploy because the operator's
  local folder did not contain `supabase/functions/admin-user-lifecycle/index.ts`.
  - Note for resume: in the Rork-synced repo the file **is present** at
    `web-cleanops/supabase/functions/admin-user-lifecycle/index.ts`. The blocker was a
    local working-copy / sync gap, not a missing-in-repo gap. Resolve the local
    repo/sync first so the local folder matches the synced repo before deploying.
- This is **not blocking current work**.

### What to do next when resumed
- See "Auth / Admin User Lifecycle resume instructions" in §D.

### What must NOT resume automatically
- Do not continue deployment/debugging for `admin-user-lifecycle`.
- Do not touch the invite flow.
- Do not touch password recovery.
- Do not touch user lifecycle actions.
- Do not touch Edge Functions.

---

## D. Resume instructions

These run **only after a new explicit instruction** to resume the specific track.

### TypeScript cleanup resume instructions
When resumed:
- Re-run `runChecks` (`appPath: "web-cleanops"`).
- Re-run the strict TypeScript baseline.
- Report the current total strict error count.
- Propose **one safe slice at a time**.
- Prefer **test-only fixture drift**.
- Avoid broad `src/lib/data/*` cast debt unless explicitly approved.
- Avoid Calculator V2 unless explicitly approved.
- Avoid Auth / Admin lifecycle unless explicitly approved.

### Calculator V2 resume instructions
When resumed:
- Start from a **fresh Calculator V2 plan confirmation**.
- Do **not** infer from background context.
- Do **not** update checkboxes unless actually implementing a confirmed slice.
- Keep Calculator V2 **separate** from general TS cleanup.

### Auth / Admin User Lifecycle resume instructions
When resumed:
- First **resolve the repo/sync issue**.
- Confirm `supabase/functions/admin-user-lifecycle/index.ts` exists **locally**.
- Then deploy:
  ```bash
  supabase functions deploy admin-user-lifecycle --project-ref swqcdcpwofdnmoureifu
  ```
- Then test:
  - Last Login / Invite Status
  - Resend Invite
  - Disable User
  - blocked login after disable
  - Enable User
  - successful login after enable

---

## E. Development log

### 2026-06-12 — Pause current tracks + record handoff state
- **What was paused:** (A) TypeScript cleanup / strict TS debt, (B) Calculator V2,
  (C) Auth / Invite / Admin User Lifecycle.
- **Why paused:** explicit instruction to stop active implementation, freeze the current
  tracks, and document a clean, resumable handoff state. No technical blocker forced the
  pause for (A) or (B); (C) additionally had a local repo/sync deploy blocker.
- **Latest safe TypeScript count:** ~170 strict errors. Reaching it changed runtime
  behavior: **none**.
- **Latest TS mini-wave summary:** reduced strict errors by 5, **test-files only** —
  `src/hooks/use-work-order-mutations.test.tsx`,
  `src/hooks/use-time-bank-panel.test.tsx`,
  `src/components/workorder/ServiceProtocolLink.test.tsx`. Earlier safe slices:
  Entitlements synthetic limit-key test drift and `scheduleConvergence.test.ts`.
- **Auth / Admin lifecycle deployment status:** `admin-user-lifecycle` deploy **paused**.
  Local deploy was blocked because the operator's local folder was missing
  `supabase/functions/admin-user-lifecycle/index.ts`; the file is present in the synced
  repo. Password recovery works (UX/error handling improved). Not blocking other work.
- **Calculator V2 pause status:** paused completely; future project; not started; must not
  be auto-resumed or inferred from context.
- **Next recommended action when we return:** pick exactly one track, give an explicit
  resume instruction, and follow that track's resume steps in §D. For TS cleanup, re-run
  `runChecks` + strict baseline and propose one test-only slice. For Auth/Admin lifecycle,
  fix the local repo/sync gap first, then deploy and run the test checklist.

---

## Related documentation
- **In-app:** Super Admin → Development Center → Paused Workstreams panel
  (`src/pages/superadmin/DevelopmentCenter.tsx`, data in `src/lib/pausedWorkstreams.ts`,
  governance entries in `src/lib/developmentTimeline.ts`).
- `docs/dev-center/00-dev-center-index.md`
- `docs/dev-center/price-calculator/04-home-only-baseline-status.md`
- `docs/backlog/20-build-backlog.md`
- `.rork/plans/calculator-v2-rebuild-strategy_*.plan.md` (reference only — do not action)
