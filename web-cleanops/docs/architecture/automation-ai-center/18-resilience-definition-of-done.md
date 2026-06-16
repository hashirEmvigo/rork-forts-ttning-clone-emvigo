# Resilience Definition of Done

## Status

Required release gate for every heavy, automation-relevant, customer-impacting, AI-enabled, or data-intensive feature.

## Purpose

Make performance, safety, and incident follow-up part of delivery quality, not an afterthought.

## Feature-level release checklist

A feature is not done until these questions are answered:

1. What user roles use this feature?
2. What module owns the domain logic?
3. What routes/endpoints does it call?
4. What database tables/views/functions does it depend on?
5. What is the maximum data volume returned by default?
6. Is the list/search/filter behavior paginated or bounded?
7. What request limits apply per session/user/company/module?
8. What timeout applies?
9. What retry policy applies?
10. Can a user double-submit or spam the mutation?
11. Can a frontend loop occur?
12. Can duplicate realtime subscriptions occur?
13. What happens if the dependency is slow or down?
14. What controlled error message is shown?
15. What incident/logging path exists?
16. What runtime guard policy applies?
17. What alert/follow-up and resolution path exists?
18. What kill switch or limited-mode behavior exists?
19. What performance budget applies?
20. What test evidence exists?
21. What must be visible in Automation & AI Center?
22. What must never be hidden inside the module?

## Required PR output block

```text
Performance & Runtime Safety:
- Feature/module:
- Owner domain:
- Routes/endpoints:
- Data volume limits:
- Pagination/bounding:
- Rate limits/quotas:
- Runtime guard policy:
- Timeout policy:
- Retry policy:
- Frontend loop protection:
- Realtime subscription cleanup:
- Kill switch / limited mode:
- Incident/logging path:
- Alert/follow-up and resolution path:
- Performance budget:
- Test evidence:
- Hidden unbounded behavior: none
```

## Blocking issues

Block release if any of these are true:

- unbounded database read
- unbounded export
- unbounded AI usage
- unbounded media upload
- unbounded polling
- unbounded retry
- duplicate realtime subscription risk
- mutation can be double-submitted
- no timeout for heavy operation
- no controlled error state
- no incident/logging path for abnormal behavior
- no runtime guard policy for heavy/loop-prone/high-risk feature
- no kill switch or limited-mode plan for heavy/high-risk feature
- performance regression is known and accepted without explicit decision

## Definition of safe failure

A feature fails safely when:

- the user gets a controlled message
- the operation stops consuming resources
- the incident is logged
- the team can see what happened
- the rest of the platform continues running
- recovery or rollback path is clear

## Minimum evidence by feature type

| Feature type | Minimum evidence |
|---|---|
| Small read-only page | route load check, bounded data, no duplicate requests |
| Heavy list/table | pagination, API budget, frontend request check, query/index review |
| Mutation flow | idempotency/duplicate prevention, error handling, audit/log path |
| Export/report | queued or concurrency-limited job, timeout, incident path |
| Realtime view | subscription cleanup and reconnect cap |
| AI-enabled feature | token/request budget, timeout, approval policy, provider circuit breaker |
| Customer-impacting automation | risk/approval policy, duplicate suppression, audit log |
| Public surface | per-IP/session limit, abuse guard, controlled error/fallback |
