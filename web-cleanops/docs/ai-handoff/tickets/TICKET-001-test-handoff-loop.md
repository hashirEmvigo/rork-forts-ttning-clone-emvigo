# TICKET-001 - Test AI Handoff Loop

## Goal
Verify that RORK can use the AI handoff workflow without changing application code.

## Scope
RORK may only modify these files:

- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

## Non-goals
RORK must not modify application source code, database migrations, package files, tests, routing, UI, Supabase config, or production behavior.

## Architecture rules
- This is a workflow smoke test only.
- RORK must follow `web-cleanops/docs/ai-handoff/04-escalation-policy.md`.
- RORK must not infer broader project work from chat history.
- RORK must only execute this single READY ticket.

## Implementation steps
1. Read `web-cleanops/docs/ai-handoff/01-current-objective.md`.
2. Read `web-cleanops/docs/ai-handoff/02-rork-inbox.md`.
3. Read `web-cleanops/docs/ai-handoff/04-escalation-policy.md`.
4. Read `web-cleanops/docs/ai-handoff/05-ticket-registry.md`.
5. Update this ticket status from READY to DONE in `05-ticket-registry.md` after completing the smoke test.
6. Write a concise wave report in `03-rork-outbox.md` using the required format.
7. Write a concise verification report in `06-verification-report.md`.

## Acceptance criteria
- No application code is changed.
- `03-rork-outbox.md` contains a completed wave report.
- `06-verification-report.md` states that this was documentation-only and no build/test was required.
- `05-ticket-registry.md` marks `TICKET-001` as DONE.
- RORK stops after this ticket and does not continue into other work.

## Verification
Manual verification only:

- Confirm that only the allowed AI handoff docs were changed.
- Confirm that no source code or package files were changed.

## Escalation
RORK must stop and mark this ticket BLOCKED if it cannot write to the required AI handoff files or if RORK believes application code changes are required.
