# RORK and GitHub Workflow

This workflow applies after the repository migration to `RiosBioz/Keymaster`.

## Active working repository

RORK works against `RiosBioz/Keymaster` as the active working/master repository.

Do not use `RiosBioz/Stadportalen` for implementation. It is historical, archived, and frozen unless the user explicitly instructs otherwise.

## Before each wave

Before starting any wave or ticket, RORK must read the current ai-handoff documentation, including the current objective, inbox, escalation policy, ticket registry, conversation reply policy, execution discipline, and the active ticket file when one is provided.

If repository state is unclear, stop and verify before making changes.

## During each wave

- Work only on the explicitly instructed ticket or wave.
- Do not start a new wave without explicit user instruction.
- Preserve existing route, module, permission, and product boundaries unless the active ticket explicitly says otherwise.
- Do not use the old `RiosBioz/Stadportalen` repository for implementation.
- If a GitHub/Rork mismatch appears, stop and report the mismatch instead of continuing implementation.

## After each wave

After each completed wave, RORK must update the handoff reports required by the active ticket. Unless the ticket says otherwise, this includes:

- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`

RORK should report relevant verification performed. Do not claim tests or checks were rerun unless they were actually rerun.

## Repository mismatch rule

If `RiosBioz/Keymaster`, Rork local state, and GitHub visible state do not appear aligned, stop implementation and report:

- the repository being treated as active,
- the visible local state,
- the visible GitHub/Rork mismatch,
- and what needs to be verified before coding resumes.
