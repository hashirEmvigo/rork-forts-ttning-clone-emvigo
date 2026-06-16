# Repository Handoff

This directory documents the repository migration and the current RORK + GitHub working process for CleanOps / Städportalen.

## Active repository

- **Active working/master repository:** `RiosBioz/Keymaster`
- **Historical/archive repository:** `RiosBioz/Stadportalen`

`RiosBioz/Keymaster` is the active source of truth for future work. All future RORK waves, tickets, handoffs, and external review should target Keymaster unless the user explicitly overrides this instruction.

## Why the repository changed

Rork Support confirmed that an existing Rork project cannot be reconnected to an existing GitHub repository. When reconnecting GitHub, Rork creates a new repository instead of attaching to the old one.

Because of that platform behavior, `RiosBioz/Keymaster` is now the official active Rork/GitHub repository. `RiosBioz/Stadportalen` must be treated as historical, archived, and frozen unless the user explicitly instructs otherwise.

## Working rule

Before any new product wave or ticket starts, contributors and RORK sessions must verify that they are working from `RiosBioz/Keymaster` as the active repository. Do not use `RiosBioz/Stadportalen` for implementation work unless explicitly instructed by the user.
