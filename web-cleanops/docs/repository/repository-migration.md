# Repository Migration Decision

## Date and context

Date: 2026-06-15

Rork Support confirmed that an existing Rork project cannot be reconnected to an existing GitHub repository. When GitHub is reconnected from Rork, Rork creates a new repository instead of attaching the existing project to an existing GitHub repository.

Because of this platform behavior, the official active working repository has changed.

## Repository roles

- **New active repository:** `RiosBioz/Keymaster`
- **Old repository:** `RiosBioz/Stadportalen`

`RiosBioz/Keymaster` is the active source of truth for the current CleanOps / Städportalen app state and future development.

`RiosBioz/Stadportalen` is historical, archived, and frozen unless the user explicitly instructs otherwise.

## Known issue with the old GitHub sync

The old GitHub repository had repository-sync confusion between Rork and GitHub. Work that existed inside the Rork-managed project state was not reliably visible in the old GitHub repository, including the WAVE-003K-R handoff period.

WAVE-003K-R has since been verified in `RiosBioz/Keymaster`, including the Admin Requests detail sheet files.

## Decision rules

- `RiosBioz/Keymaster` is the active source of truth.
- `RiosBioz/Stadportalen` is archive/historical only.
- No new implementation work should target `RiosBioz/Stadportalen`.
- Do not manually reconnect Rork to the old `RiosBioz/Stadportalen` repository.
- Future RORK waves and tickets must assume Keymaster is the active repo unless the user explicitly overrides it.
- If repository confusion occurs, stop and verify the repository state before coding.
- If Rork and GitHub appear mismatched, report the mismatch before starting or continuing implementation.
