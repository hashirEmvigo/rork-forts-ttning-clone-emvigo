# CleanOps Project Operating Mode and Test Data Policy

## 1. Current Operating Mode

CleanOps / Städportalen is currently in pre-production / test-data-only operating mode.

This means:

- No real customer data is currently allowed.
- All development, validation, QA, runbooks and manual testing must use demo/test data only.
- Production data import and go-live require separate explicit approval.
- AI agents and developers must not assume real customer data exists unless a future approved go-live/import decision explicitly says so.

This is the current operating mode. It is not a permanent ban on real data. Real customer data may only be introduced after the full platform is functionally complete, validated, and explicitly approved for go-live/import.

## 2. Test Data Policy

The following may be created for local/test/staging validation:

- test companies
- test customers
- test employees
- test WorkOrders/AO
- test service rows
- test scheduling data
- test scheduling exceptions
- test Booking Queue scenarios
- test Mission Log scenarios
- test Time Reporting scenarios

All test entities must be clearly marked using prefixes or identifiers such as:

- `TEST`
- `DEMO`
- `QA`
- `CTSE`
- `example.test` email domains

No real customer data may be used, including:

- real customer names
- real addresses
- real emails
- real phone numbers
- real notes
- real payroll data
- real invoice data
- real operational history

## 3. Development Principle

Development should follow these principles:

- Build small, reviewable, testable slices.
- Prefer visible/manual-testable increments over large hidden implementations.
- Prioritize early bug discovery and fast iteration in local/test/staging.
- A feature does not need to be production-ready before it becomes testable in local/test/staging with demo data.
- If production requirements are not finalized, mark the feature as test/staging-only and document the production blockers separately.
- Do not block safe testability only because production rollout requirements are not finalized.

Production-grade security and authority boundaries still matter. Test-data-only mode does not permit localStorage regressions, unsafe RLS, unsafe migrations, or hidden coupling to execution/financial history.

## 4. Supabase Authority and localStorage Rule

Supabase remains the source of truth.

localStorage is legacy/cache/fallback only.

New features must not introduce local-first authority.

Forbidden unless explicitly approved:

- localStorage persistence for new domain data
- localStorage authority
- local mirrors
- local backout bridges
- dirty-browser rehydration
- offline queues
- fallback paths that can resurrect stale data

Manual QA should include refresh, cross-browser and dirty-browser regression checks where relevant.

## 5. Manual QA Rule

Every implementation phase that changes visible behavior must include a Sebastian Manual Test Checklist.

The checklist must be:

- non-technical
- click-based
- written for manual validation
- based on demo/test entities only

Checklist must include where relevant:

- what page to open
- what object/test customer to use
- what to click
- what should appear
- what should not change
- refresh behavior
- cross-browser/localStorage regression checks
- confirmation that Booking Queue is unchanged unless explicitly in scope
- confirmation that WorkOrders/service rows are unchanged unless explicitly in scope
- confirmation that Mission Log is unchanged unless explicitly in scope
- confirmation that Time Reporting is unchanged unless explicitly in scope

## 6. Environment Rules

### Local / Test / Staging

Allowed:

- demo data
- test customers
- test schedules
- test scheduling exceptions
- test runbooks
- migration validation
- RLS validation
- QA scenarios
- bug reproduction
- resets where appropriate
- destructive cleanup only when explicitly scoped

The purpose of local/test/staging is to discover bugs before production.

### Production

Production operations are out of scope until explicit go-live/import approval.

Not allowed without explicit approval:

- real customer imports
- real customer portal usage
- real payroll processing
- real invoice processing
- destructive operations
- production scheduling based on incomplete modules

## 7. Instruction for RORK / AI Agents

Always assume test-data-only mode unless the user explicitly states that go-live/import approval has been granted.

Do not repeatedly ask whether real customer data exists.

Do not design QA around real customers.

Use demo/test data in examples, runbooks, validation scripts and manual test checklists.

When evaluating risk, separate the answer into:

A. Safe for local/test/staging with demo data

B. Blocked or required before production/go-live

Do not use production-risk alone as a reason to avoid creating safe, testable implementation slices.

Continue to protect Supabase authority, migration integrity, RLS correctness and localStorage regression boundaries.

Continue to treat Booking Queue, WorkOrders/service rows, occurrence exceptions, Mission Log and Time Reporting as protected domains unless explicitly in scope.

## 8. Go-Live / Real Data Gate

Before any real customer data may be imported or used, a separate go-live/import approval process is required.

Minimum gate requirements:

- live DB migration validation
- RLS validation
- localStorage regression validation
- backup plan
- rollback plan
- production import plan
- test-to-production data separation verification
- manual acceptance checklist
- explicit owner approval

## 9. Practical Effect on Future Work

For future implementation phases, agents should default to:

- build testable slices
- use demo data
- provide manual QA steps
- report production blockers separately
- avoid unnecessary production assumptions during local/test/staging validation

But agents must still not:

- weaken RLS
- bypass Supabase authority
- add localStorage authority
- mutate Booking Queue/AO/Mission Log/Time Reporting unless explicitly approved
- assume production deployment is approved
