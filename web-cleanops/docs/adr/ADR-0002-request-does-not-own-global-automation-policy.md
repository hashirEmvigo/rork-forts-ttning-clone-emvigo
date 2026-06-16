# ADR-0002 - REQUEST does not own global automation policy

Status: Accepted

## Decision

REQUEST may emit domain events and perform domain mutations, but Automation & AI Center owns automation registry, AI extension policy, runtime guard policy, execution/incident history and approval policy.

## Consequences

- No hidden notification rules inside REQUEST.
- No local AI policy engine inside chat/request screens.
- Local quick-review panels must link back to central Automation & AI Center concepts.
