# 12 - AI Layer and Internal AI Service

## Rule

REQUEST modules must never call external AI providers directly. Use Internal AI Service.

## Internal AI Service responsibilities

- AI policy enforcement
- prompt/context building
- tool permission resolving
- provider adapter: mock | OpenAI | other
- local AIActionLog writer
- central Automation & AI Center reference writer when applicable
- fallback/error metadata

## AI autonomy levels

| Level | Name | Allowed scope |
|---|---|---|
| L0 | Mock AI | Deterministic test outputs |
| L1 | Suggestion mode | classify, summarize, suggest reply; no external action |
| L2 | Draft mode | creates draft request/task/reply/notification; admin approval |
| L3 | Internal object creation | internal summaries/tasks within explicit policy |
| L4 | Limited automation | restricted actions through approved central policy |
| L5 | Closure automation | not from start; approval required initially |

## Cross-reference requirement

AIActionLog is local/request-domain trace. Every AI output that corresponds to an automation/AI action must also be linkable to the central Automation & AI Center AI extension/proposal/execution records.

## Slice 0

No live provider. Mock UI only.
