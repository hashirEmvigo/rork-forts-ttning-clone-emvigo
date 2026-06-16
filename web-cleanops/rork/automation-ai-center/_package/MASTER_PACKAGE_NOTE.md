# Master Package Note

Package: Automation & AI Center Runtime Safety v3
Version label: `v3-runtime-safety-master-review`
Purpose: canonical architecture package for Automation & AI Center, including Runtime Safety & Performance Guard.

This package must be saved into the repository as a standalone Automation & AI Center architecture package. It is separate from, but required by, REQUEST/CRM and other domain packages.

REQUEST/CRM may reference this package, but REQUEST/CRM is not the source of truth for automation, AI policy, runtime guards, kill switches, circuit breaker visibility, execution logs, incident logs or performance/resilience gates.

Use `rork/06_SAVE_AND_SORT_IN_GITHUB_FIRST.md` as the first prompt when adding this package to GitHub.
