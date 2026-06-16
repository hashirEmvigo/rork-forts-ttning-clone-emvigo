# First Implementation Slices

## Strategy

Build the architectural target and readiness standard now.

Build the real execution engine later.

## Phase 0 - Documentation and planning

Status: this package.

Deliverables:

- architecture docs
- schemas
- mock data
- RORK plan request
- Slice 1 prompt

## Phase 1 / Slice 1 - Front-end shell only

Goal:

Create a Super Admin UI shell that shows the future Automation & AI Center with mock data.

Build:

- route
- nav entry
- overview dashboard
- auto-actions table
- filters
- action detail layout
- AI extensions view
- approval queue placeholder
- execution log placeholder
- risk/policy view placeholder
- test mode placeholder
- module coverage view
- runtime safety mock visibility
- runtime guard policies mock table
- limits/quotas mock table
- feature flags / kill switches mock table
- runtime incidents mock table
- module health mock table
- performance budgets mock table
- mock data/constants
- TypeScript types

Do not build:

- live engine
- DB migrations for execution engine
- AI provider integration
- approval mutations
- customer/employee notification sending
- domain mutations
- live runtime guard enforcement
- live rate limiting
- live kill switch/circuit breaker mutations

## Phase 2 / Slice 2 - Registry-ready constants or static config

Goal:

Move mock data into a repo-consistent static configuration shape that can later become DB/API-backed.

Build:

- typed action registry constants
- typed module coverage constants
- typed AI extension constants
- reusable status/risk badges
- import-safe schemas/types

Still do not build live engine.

## Phase 3 / Slice 3 - First module quick review pattern

Goal:

Add local quick review placeholder in one module only, probably Schedule or Keys/Alarm.

Build:

- local quick review component reads central mock/config data
- link from source module to Automation & AI Center action detail
- no local source-of-truth duplication

## Phase 4 / Slice 4 - First real deterministic event integration in dev/test

Candidate:

`schedule.delay.impact_detected`

Build only after Schedule logic is stable enough.

Build:

- domain event emission or equivalent state transition capture
- execution log record in dev/test or safe backend model
- deterministic conditions
- no AI
- no customer-facing mutation unless existing policy approved

## Phase 5 / Slice 5 - Approval queue real foundation

Build:

- approval queue data model
- read-only view
- create approval request from deterministic automation
- approve/reject UI if approved

## Phase 6 / Slice 6 - First AI extension

Candidate:

AI summarize/draft for schedule delay admin review or case reply draft.

Build:

- AI extension attached to parent auto-action
- structured AI output
- approval required
- audit log

Do not auto-send customer AI messages initially.

## Preferred first real automation candidates

1. `schedule.delay.impact_detected`
2. `keys.access.missing_alarm_code`
3. `cases.sla.unhandled_case_risk`
4. `chat.message.complaint_detected`
5. `customer.profile.missing_cleaning_protocol`

## Reasoning

These are high-value and easy to explain.

Start with deterministic behavior.

Attach AI only when standard rules cannot fully solve the situation.

## Safety and performance slice additions

### Phase 1A - Runtime Safety mock visibility

This is included in Slice 1 as read-only mock visibility. If the UI becomes large, group the tables under a Runtime Safety tab, but do not remove the concepts.

Build:

- Runtime Safety overview card/section
- Runtime Guard Policies mock table
- Limits & Quotas mock table
- Feature Flags mock table
- Runtime Incidents mock table
- Module Health mock table
- Performance Budgets mock table
- non-live warnings

Do not build:

- live throttling
- live kill switch toggles
- live circuit breaker enforcement
- production alert routing

### Phase 2A - Safety config constants

Move mock safety data into typed static config that can later become API/DB-backed.

Build:

- typed safety limit constants
- typed feature flag constants
- typed module health constants
- typed performance budget constants
- shared status badges

### Phase 4A - First real safety guard in dev/test

Candidate:

- Booking List repeated-read throttle in dev/test
- Schedule Grid limited data window
- AI request budget if AI exists

Required:

- no production enforcement without approval
- incident/log visibility
- controlled error message
- rollback path

## Preferred first safety candidates

1. Booking List request loop protection
2. Schedule Grid bounded reads and limited mode
3. Invoice export concurrency limit
4. Media upload size/concurrency limit
5. AI request/token budget
6. Public pricing calculator request limit
