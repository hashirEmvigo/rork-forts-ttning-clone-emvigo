# REQUEST CRM Communications Platform - RORK Package v0.2

This package converts the original REQUEST/CRM/communications architecture into a GitHub-ready technical documentation set aligned with the Automation & AI Center model.

Read order:

1. `VERSION.md`
2. `rork/00_START_HERE.md`
3. `docs/architecture/request-crm/00_index.md`
4. `docs/architecture/request-crm/25_automation_ai_center_alignment.md`
5. `docs/architecture/request-crm/27_slice_0_frontend_shell.md`
6. `rork/01_CLAUDE_XHIGH_IMPLEMENTATION_PLAN_REQUEST.md`

Implementation policy:

- Do not implement code yet.
- Use Claude 5 XHigh to inspect this package and the current repository.
- Return an implementation plan only.
- Slice 0 is frontend shell and mock data only.
- No live automation engine, no live AI provider integration, no production rate limiting, no kill-switch enforcement, no circuit breaker enforcement and no live notification runner in Slice 0.

Global architecture dependency:

- Automation & AI Center Runtime Safety v3 is the source of truth for automation registry, AI extensions, risk policy, runtime guard policy, kill switches, execution logs, incident logs, approval policy and performance/resilience gates.
- REQUEST/CRM may expose local quick-review UI, emit domain events and own communication-domain objects, but it must not own hidden module-specific automation policy.
