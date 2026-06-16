# PR Checklist - REQUEST/CRM

## Scope

- [ ] This PR matches the approved implementation slice.
- [ ] This PR does not include out-of-scope live automation/AI/runtime enforcement.

## Automation & AI Center readiness

- [ ] Domain events are documented.
- [ ] Automation candidates are documented.
- [ ] Risk level candidates are documented.
- [ ] Runtime safety candidates are documented if relevant.
- [ ] No hidden module-specific automation policy was added.
- [ ] Local quick-review UI points to Automation & AI Center concepts.

## Slice 0 constraints if applicable

- [ ] Uses mock/static data only.
- [ ] No real notification runner.
- [ ] No real AI provider.
- [ ] No live email outbox.
- [ ] No live kill switches, rate limiting or circuit breaker enforcement.

## Tests

- [ ] Type/lint/build pass according to repo standards.
- [ ] Feature flags default safe/off.
- [ ] Mock data is isolated.
