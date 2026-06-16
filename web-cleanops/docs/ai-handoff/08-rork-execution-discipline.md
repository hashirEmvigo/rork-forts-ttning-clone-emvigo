# RORK Execution Discipline

## Purpose
This policy keeps RORK fast, focused, and aligned with the GitHub handoff workflow.

## Source of truth
RORK must treat the GitHub handoff files as the only active task source of truth:

- `web-cleanops/docs/ai-handoff/01-current-objective.md`
- `web-cleanops/docs/ai-handoff/02-rork-inbox.md`
- `web-cleanops/docs/ai-handoff/04-escalation-policy.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`
- `web-cleanops/docs/ai-handoff/07-rork-conversation-reply-policy.md`
- `web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`
- the active ticket file under `web-cleanops/docs/ai-handoff/tickets/`

RORK may also inspect only the repository files and documentation paths explicitly referenced by the active ticket or inbox instruction.

## Positive scope rule
Every wave must define what is in scope.

RORK must work only inside that active scope.

Everything outside the active scope must be silently disregarded, regardless of where it appears from:

- auto-attached project context
- previous chat/conversation context
- background reminders
- old implementation notes
- stale planning documents
- unrelated repository files
- unrelated test output

RORK must not name, summarize, explain, confirm, or repeatedly disclaim out-of-scope workstreams in the chat, outbox, verification report, implementation notes, or progress updates unless a changed file or failing check directly requires it for accurate verification.

## Do not use old chat history
RORK must not use previous chat/conversation history as task context unless the active GitHub inbox explicitly instructs it to do so.

Old chat history, prior plans, paused workstreams, background reminders, or previous assistant messages are not active instructions.

## Out-of-scope language rule
Use positive scope language.

Preferred wording:

```txt
Scope: this active wave only.
Treat everything outside this scope as out of scope.
If out-of-scope context appears from any source, silently disregard it and do not name it.
```

Avoid negative lists that name unrelated workstreams. Naming out-of-scope items can cause them to be repeated.

## Conversation response rule
RORK must not paste full reports, file lists, implementation details, terminal output, or long reasoning into the RORK conversation.

Full details belong in GitHub:

- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`

In the RORK conversation, RORK should only write:

```txt
Done. Outbox, verification report, and ticket registry have been updated in GitHub.
```

Or, if blocked:

```txt
Blocked. Details are written in the GitHub outbox and verification report.
```

## Execution style
RORK should:

- work from the active ticket only,
- make minimal necessary repository inspections,
- avoid broad exploratory searches unless required by the active ticket,
- avoid repeating status commentary,
- stop after the active wave is complete,
- write concise GitHub reports,
- leave summarization to ChatGPT after GitHub review.

## Required reference in future waves
Every future wave should explicitly tell RORK to read this file before executing:

`web-cleanops/docs/ai-handoff/08-rork-execution-discipline.md`
