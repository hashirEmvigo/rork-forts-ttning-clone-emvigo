# Per-feature Automation Readiness Instruction

Use this instruction in every future REQUEST/CRM feature prompt.

```text
Automation & AI Center readiness is required.

While implementing this feature, identify all domain events, state changes, logs, risk conditions, notification candidates, approval candidates, runtime safety candidates and future AI extension points.

Do not build hidden one-off automation logic inside REQUEST/CRM.

REQUEST may own domain logic and domain mutations, but automation visibility, policy, execution history, AI extensions, runtime guard state, kill switches, incident logs and approval policy must remain compatible with the central Automation & AI Center model.

For every feature, document:
- emitted domain events
- automation candidates
- risk level candidates
- feature flags
- audit events
- data required by Automation & AI Center
- data REQUEST may mutate
- data REQUEST must not mutate directly
- Slice-specific non-goals
```
