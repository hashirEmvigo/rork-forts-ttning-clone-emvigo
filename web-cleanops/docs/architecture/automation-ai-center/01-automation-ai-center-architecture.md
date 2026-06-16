# Automation & AI Center Architecture

## Status

Architecture standard. Front-end shell target for first implementation. Production engine and production runtime enforcement deferred.

## Problem

The product will contain many operational events and rules:

- employee late arrival
- ETA changes
- customer-impacting delays
- customer messages
- complaints
- case SLA risk
- missing key information
- missing alarm code
- missing cleaning protocol
- invoice/payment risks
- work order data gaps
- media/protocol missing events
- schedule conflicts
- notification opt-in/out behavior
- abnormal frontend request loops
- runaway polling or retry behavior
- heavy exports or slow reports
- AI usage spikes
- media upload spikes
- realtime subscription storms
- slow or failing external dependencies

These cannot be scattered across modules as hidden special-case logic.

If each module implements its own automation rules and its own safety exceptions independently, the system becomes untraceable, fragile, expensive to run, and hard to extend with AI.

## Solution

Create a central `Automation & AI Center` that is the control plane for:

- auto-action registry
- auto-action metadata
- risk levels
- execution modes
- approval policies
- AI extension status
- execution history
- audit trail
- module coverage
- review queues
- testing/simulation visibility
- runtime safety limits
- runtime guard policies
- rate limiting and quota policy visibility
- circuit breaker state visibility
- feature runtime flags and kill switches
- user/session/company/module throttling visibility
- runtime incident history
- module health status
- performance budget status

## Source-of-truth rule

Automation & AI Center is the single source of truth for automation visibility, governance, and runtime safety visibility.

Feature modules may show local quick reviews and local indicators, but those views must be downstream of, or link back to, Automation & AI Center.

A feature module may enforce a local technical guard, but the existence, policy, and incident trail of that guard must be centrally discoverable.

## Boundary rule

Automation & AI Center owns:

- registry
- metadata
- visibility
- operational overview
- execution/audit log display
- risk policy display
- approval queue display
- AI extension configuration/display
- module coverage
- test-mode UI
- runtime safety policy visibility
- runtime guard policy display
- safety limit registry display
- feature runtime flag display
- runtime incident display
- module health display
- performance budget display

Domain modules own:

- domain data model
- business calculations
- validation
- domain state transitions
- domain mutations
- domain-specific UI
- local technical guard implementation when required by repository architecture

Examples:

- Schedule Engine owns ETA calculation.
- Case Module owns case creation and status changes.
- Chat Module owns chat message persistence and conversation state.
- Keys/Alarm Module owns access instructions and security-sensitive fields.
- Finance Module owns invoices and payment state.
- Runtime Safety Guard owns the central policy model for rate limits, quotas, flags, incidents, and health visibility.

Automation & AI Center may orchestrate and display. It must not become a giant domain logic module.

## Runtime safety principle

One failure must not take down the platform.

Allowed failure behavior:

- one session is throttled
- one user is temporarily limited
- one company is rate-limited on a heavy endpoint
- one function enters limited mode
- one module becomes read-only
- one provider/integration is circuit-broken
- one incident is created and escalated

Not allowed:

- one looping page overloads the database
- one retry storm saturates the API layer
- one user session consumes shared resources unboundedly
- one background job blocks normal user traffic
- one AI feature consumes unlimited token/request budget
- one module-specific bug degrades the entire system

## First implementation target

The first implementation is a Super Admin front-end shell.

It must create a clear visual and architectural target, using mock data.

The real execution engine and real runtime enforcement come later.

## Recommended route

Preferred:

`/super-admin/automation-ai-center`

Optional alias if supported:

`/auto-ai-center`

## Top-level UI sections

1. Overview
2. Auto Actions
3. AI Extensions
4. Approval Queue
5. Execution Log
6. Risk & Policies
7. Test Mode
8. Module Coverage
9. Runtime Safety
10. Runtime Guard Policies
11. Limits & Quotas
12. Incidents
13. Feature Flags
14. Module Health
15. Performance Budgets
16. Settings

For Slice 1, runtime safety sections may be implemented as read-only mock-data tabs/cards. If the UI would otherwise become too large, group them under a Runtime Safety parent section, but do not omit the concepts.

## Module coverage

The center must be able to represent automation and runtime safety readiness for at least:

- Schedule
- Cases
- Chat
- Notifications
- Keys & Alarm
- Customer Card
- Work Orders
- Invoices
- Media
- Time Bank
- Agreements
- Employees
- System

## Data flow concept

```text
Domain Event / User Action / API Request / Frontend Signal / Background Job
  -> Identify actor, session, company, module, route, endpoint, action key, correlation id
  -> Runtime Safety Guard lookup
  -> Runtime Guard Policy lookup
  -> Feature flag / kill switch check
  -> Rate limit / quota / timeout / circuit breaker check
  -> Automation Registry lookup if automation-relevant
  -> Trigger matching
  -> Condition evaluation
  -> Policy/risk check
  -> Execute / skip / require approval / create AI proposal / throttle / limit / block
  -> Log execution or runtime incident
  -> Display in Automation & AI Center
  -> Optional quick review in source module
```

## AI concept

AI does not replace deterministic automation.

AI attaches to an existing auto-action only when:

- deterministic rules cannot fully solve the situation
- summarization is useful
- decision support is useful
- message drafting is useful
- admin review needs context
- escalation choices are ambiguous

AI also requires runtime safety controls:

- request budget
- token budget
- timeout
- retry limit
- approval policy
- provider circuit breaker
- incident logging

## Example: automation and safety together

Auto-action:

`schedule.delay.impact_detected`

Deterministic system behavior:

- detect delay
- ask employees yes/no impact question
- update ETA if confirmed
- send customer app notification if opted in
- create log

Runtime safety behavior:

- prevent repeated confirmation prompts for the same event
- suppress duplicate customer notifications
- prevent frontend retry loops
- rate-limit repeated schedule reloads
- log abnormal repeated requests as runtime incident
- allow Schedule module to enter limited/read-only mode if severe errors occur

AI extension later:

- summarize customer impact
- suggest schedule solution
- draft customer message
- prepare admin approval item

## Production implementation warning

Do not build a generic no-code rules engine at the start.

Do not build a generic unrestricted runtime-control console that can change production behavior without audit.

Build developer-defined auto-actions and developer-defined safety policies that follow universal registry, metadata, approval, and audit models.
