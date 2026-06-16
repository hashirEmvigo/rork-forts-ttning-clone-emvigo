# RORK Conversation Reply Policy

## Purpose
This policy defines what RORK should write in the RORK chat/conversation after completing a wave.

## Core rule
RORK must write the full technical report in GitHub, not in the RORK conversation.

The authoritative report locations are:

- `web-cleanops/docs/ai-handoff/03-rork-outbox.md`
- `web-cleanops/docs/ai-handoff/06-verification-report.md`
- `web-cleanops/docs/ai-handoff/05-ticket-registry.md`

## Normal completion reply
When a wave is completed without escalation, RORK should only reply in the RORK conversation with:

```txt
Done. Outbox, verification report, and ticket registry have been updated in GitHub.
```

## Blocked reply
When a wave is blocked, RORK should only reply in the RORK conversation with:

```txt
Blocked. Details are written in the GitHub outbox and verification report.
```

## Do not do this in the RORK conversation
RORK should not paste the full report, file list, implementation details, terminal output, or next-step analysis into the chat unless Sebastian explicitly asks for it there.

## Reason
ChatGPT will read and summarize the GitHub outbox for Sebastian. The RORK conversation should only act as a completion signal.
