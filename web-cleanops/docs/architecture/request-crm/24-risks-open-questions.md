# 24 - Risks and Open Questions

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Big-bang complexity | Hard to debug | Phases, flags, mock AI, E2E test scenarios |
| Snooze/handle-self/lock confusion | Hidden wrong requests | Separate concepts and state machines |
| Access model too weak | Wrong visibility | RBAC+ABAC, preview, audit, override |
| AI creates noise | Too many requests/tasks/notices | AI levels, approval, central policy |
| Notification Center becomes local rule engine | Architecture drift | Central automation registry and quick-review only |
| Email creates garbage | wrong thread/autoreplies/spam | Outbox/inbox design and parser gates |
| Test data leaks | Release quality risk | test tenant, batch tags, cleanup scripts |
| Runtime safety implemented locally only | fragmented kill switches/incidents | Automation & AI Center v3 central model |

## RORK questions

- Final physical data model and migrations?
- Generic communication tables or request-specific tables?
- Multi-tenant isolation approach?
- Central access resolver location?
- Queue/outbox technology?
- Inbound email implementation strategy?
- Test data cleanup strategy?
- Component sharing between admin/customer/employee portals?
- Internal AI adapter implementation?
- Transaction vs async boundaries?
- How to reference Automation & AI Center v3 models in the current repo without building live enforcement in Slice 0?
