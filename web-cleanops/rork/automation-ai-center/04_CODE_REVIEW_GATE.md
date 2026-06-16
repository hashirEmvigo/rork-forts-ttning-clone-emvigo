# Automation & AI Code Review Gate

Use this for any PR that touches automation-relevant, AI-relevant, runtime-safety-relevant, customer-impacting, employee-impacting, or heavy data behavior.

## Block PR if any answer is no

- Is domain logic owned by the domain module?
- Is automation metadata centrally discoverable?
- Is AI attached to a registered auto-action if AI is involved?
- Is risk level explicit?
- Is approval behavior explicit?
- Is execution/audit history considered?
- Is there no hidden customer-facing automation?
- Is there no hidden AI execution?
- Is there no direct domain mutation from Automation & AI Center UI?
- Are relevant domain events/state transitions documented?
- Are heavy data reads paginated or bounded?
- Are retries bounded?
- Is polling bounded and cleaned up?
- Are realtime subscriptions cleaned up and duplicate-safe?
- Are mutations protected against duplicate submit?
- Are timeouts defined for heavy operations?
- Are rate limits/quotas defined where needed?
- Are runtime guard policies centrally discoverable where needed?
- Is there a kill switch or limited-mode plan for heavy/high-risk features?
- Is incident/logging path defined for abnormal behavior?
- Is alert/follow-up and resolution/rollback behavior defined for guard incidents?
- Is performance budget/test evidence included where needed?
- Is there no hidden unbounded behavior?

## Required PR note

```text
Automation/AI/Safety review completed:
- central model preserved: yes/no
- hidden automation added: no
- hidden AI added: no
- hidden unbounded runtime behavior added: no
- rate limits/quotas considered: yes/no/not applicable
- runtime guard policy considered: yes/no/not applicable
- incident path considered: yes/no/not applicable
- performance budget considered: yes/no/not applicable
- tests included: yes/no
```
