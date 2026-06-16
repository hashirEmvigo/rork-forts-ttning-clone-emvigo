# Anti-Patterns and Non-Negotiables

## Non-negotiables

1. Automation & AI Center is the single source of truth for automation visibility and governance.
2. Every auto-action must follow the universal model.
3. Every AI-action must attach to a registered auto-action.
4. Domain modules own domain logic.
5. Automation metadata must be centrally discoverable.
6. Execution history must be logged.
7. Risk and approval policy must be explicit.
8. No hidden customer-facing automation.
9. No hidden AI execution.
10. No special-case automation architecture.

## Anti-pattern: hidden module automation

Bad:

```text
Schedule component detects delay and directly sends customer notification.
```

Good:

```text
Schedule domain event emitted.
Automation registry identifies schedule delay action.
ETA update performed by Schedule service.
Notification action logged through automation execution.
```

## Anti-pattern: standalone AI action

Bad:

```text
AI assistant scans all cases and sends replies when it decides to.
```

Good:

```text
cases.customer_replied triggers registered auto-action.
AI extension drafts reply.
Approval queue item created.
Admin approves before send.
```

## Anti-pattern: special-case explosion

Bad:

```text
One custom implementation for oven.
One custom implementation for windows.
One custom implementation for pets.
One custom implementation for keys.
One custom implementation for delays.
```

Good:

```text
Same model for all:
trigger -> conditions -> action steps -> risk -> policy -> log -> optional AI extension
```

## Anti-pattern: no-code rule builder too early

Bad:

Build a complex admin-facing rule builder before domain modules are stable.

Good:

Developer-defined registry entries with safe admin visibility, status, filters, and selected safe configuration.

## Anti-pattern: AI owns business rules

Bad:

AI decides whether a customer should be notified, rebooked, refunded, or escalated without policy.

Good:

Deterministic rules and policies define allowed behavior. AI can summarize, suggest, or draft under policy.

## Anti-pattern: mutation through Automation Center directly

Bad:

Automation Center directly updates schedule tables or invoice state.

Good:

Automation Center calls domain-owned service or records an approval request. Domain module validates and mutates.

## Anti-pattern: estimated state replaces confirmed state

Bad:

Delay detection overwrites the customer's confirmed booking time.

Good:

Delay detection updates estimated arrival time while preserving planned/confirmed time.

## Anti-pattern: no audit

Bad:

Automation runs and no one can explain why.

Good:

Every execution records trigger, conditions, actions, result, risk, approval, and AI usage.

## Runtime safety non-negotiables

11. No unbounded request loops.
12. No unbounded polling.
13. No unbounded retries.
14. No duplicate realtime subscriptions.
15. No heavy feature without timeout policy.
16. No heavy feature without rate limit or quota plan.
17. No high-risk/heavy feature without kill switch or limited-mode plan.
18. No hidden safety exceptions that cannot be inspected centrally.
19. No AI feature without request/token budget.
20. No automation runner behavior without incident visibility.

## Anti-pattern: frontend loop can consume backend

Bad:

```text
Component state change triggers fetch, fetch triggers state change, loop continues indefinitely.
```

Good:

```text
Stable query key, bounded refetch behavior, abort on unmount, retry limit, rate limit, incident on abnormal request count.
```

## Anti-pattern: hidden kill switch

Bad:

```text
A developer hardcodes an environment flag that disables invoice export, but no one can see it in the control plane.
```

Good:

```text
Feature runtime flag is centrally visible with status, reason, changedBy, changedAt, linked incident, and audit history.
```

## Anti-pattern: no graceful degradation

Bad:

```text
AI provider fails and every page using AI hangs or retries repeatedly.
```

Good:

```text
AI circuit opens, AI feature enters limited mode, non-AI workflows continue, incident is created.
```
