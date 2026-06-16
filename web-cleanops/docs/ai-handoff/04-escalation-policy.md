# Escalation Policy

## Purpose
This policy defines when RORK may continue independently and when RORK must stop for a product or architecture decision.

## RORK may continue without asking when

- The decision is a normal implementation detail inside the active ticket scope.
- A small TypeScript fix is needed inside the same touched area.
- A test needs to be adjusted to match the intended behavior of the ticket.
- Documentation needs to be updated to reflect the completed ticket.
- A minor fallback, guard, or log message is needed and does not change product behavior.
- Existing architecture clearly implies the correct implementation path.

## RORK must stop and mark the ticket BLOCKED when

- A destructive database migration or data deletion is required.
- Security, authorization, customer data, payroll, invoicing, or protected admin behavior is unclear.
- The ticket conflicts with existing architecture documentation.
- Implementation requires changing product behavior outside the ticket scope.
- Tests reveal a broad regression outside the active wave.
- RORK must choose between two materially different business/product flows.
- Required files or modules are missing and the correct replacement cannot be inferred safely.

## Escalation report requirement
When blocked, RORK must write in `03-rork-outbox.md`:

- Which ticket is blocked.
- Exact blocker.
- Files inspected.
- Options considered.
- Recommended path.
- What decision is needed from Sebastian/ChatGPT.

## Default behavior
If unsure whether a decision is technical or product/architecture-level, RORK should treat it as architecture-level and stop.
