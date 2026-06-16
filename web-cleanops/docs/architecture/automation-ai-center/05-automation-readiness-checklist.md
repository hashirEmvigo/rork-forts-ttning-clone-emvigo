# Automation Readiness Checklist

Use this checklist before closing any major feature implementation.

## Feature-level checklist

Answer every item.

1. Does the feature create events that the system may need to react to?
2. Does the feature create state changes that may trigger automation?
3. Does the feature create customer impact?
4. Does the feature create employee impact?
5. Does the feature create admin review needs?
6. Does the feature create notification candidates?
7. Does the feature create approval candidates?
8. Does the feature create risk conditions?
9. Does the feature require audit history?
10. Could AI later summarize, suggest, classify, or draft something based on this feature?
11. Does the feature require a module-level quick review component later?
12. What data must Automation & AI Center be able to read?
13. What data must Automation & AI Center never mutate directly?
14. Are planned time, estimated time, actual time, and confirmed changed time separated where relevant?
15. Is any automation hidden inside a component, hook, or service without central representation?

## Required output block

Add this to the implementation result or PR:

```text
Automation & AI Center readiness:
- Domain events:
- Automation candidates:
- AI-extension candidates:
- Risk levels:
- Approval requirements:
- Quick review requirement:
- Central discoverability path:
- Hidden automation logic: none
```

## Blocking issues

A feature is not ready if:

- it sends customer communication from hidden logic
- it changes schedule state without traceable metadata
- it creates admin notifications without a central automation candidate
- it creates special-case automation only for one field or one UI action
- it mixes AI output with confirmed domain state
- it directly mutates financial, salary, booking, or access-sensitive records without policy/approval modeling
- it has no audit path for automation-relevant behavior

## Safe early pattern

If the real Automation & AI Center engine does not exist yet, still do this:

- define domain events
- keep domain logic in service layer
- log important state changes
- identify future automation keys
- expose data through stable module functions/selectors
- document automation candidates
- avoid hidden special cases

## Runtime safety readiness checklist

Add these questions before closing any major feature:

16. Can this feature make repeated API calls from one session?
17. Can this feature poll or subscribe to realtime data?
18. Can this feature retry after failure?
19. Can this feature load a large list/table/export/report?
20. Can this feature call AI or another expensive provider?
21. What per-session, per-user, per-company, per-module, or per-endpoint limits apply?
22. What happens if the feature starts looping?
23. What controlled error state is shown when it is throttled?
24. What runtime incident will be created?
25. What feature flag, kill switch, read-only mode, or limited mode exists?
26. What performance budget applies?

## Required safety output block

Add this to the implementation result or PR:

```text
Runtime Safety readiness:
- Heavy routes/endpoints:
- Rate limits/quotas:
- Data bounds/pagination:
- Timeout policy:
- Retry policy:
- Polling/realtime cleanup:
- Frontend loop protection:
- Kill switch / limited mode:
- Incident/logging path:
- Performance budget:
- Hidden unbounded behavior: none
```
