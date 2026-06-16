# VERSION

Package: REQUEST CRM Communications Platform - RORK Package
Version: v0.2-automation-ai-center-aligned
Status: implementation-planning-ready
Date: 2026-06-11

Source input: `source/REQUEST_CRM_Arkitektur_RORK_v0.1_source.docx`

Alignment dependency:
- Automation & AI Center Runtime Safety v3 is the global source of truth for automation, AI decisions, risk levels, runtime guards, kill switches, circuit breaker visibility, performance/resilience gates, execution logs, incident logs and follow-up/resolution state.

Hard boundary:
- REQUEST owns communication-domain data and behavior.
- Automation & AI Center owns automation policy, AI extension policy, runtime safety policy, execution/incident history and approval policy.

First implementation gate:
- RORK/Claude must return an implementation plan first.
- Do not implement code from this package until the implementation plan has been reviewed and approved.
- First approved build slice is Slice 0: frontend shell with mock/static data only.
