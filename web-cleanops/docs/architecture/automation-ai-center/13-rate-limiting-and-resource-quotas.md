# Rate Limiting and Resource Quotas

## Status

Architecture standard. Initial values are seed examples and must be calibrated against production-like testing.

## Purpose

Prevent one actor, module, route, endpoint, job, or feature from consuming unbounded shared resources.

## Required limit dimensions

Every heavy or loop-prone feature must declare limits for relevant dimensions and link those limits to a central `RuntimeGuardPolicy` when a guard action, incident, runtime flag, alert, or resolution path is required:

- requests per time window
- concurrent requests
- retry count
- polling interval
- realtime subscriptions
- payload size
- upload size
- export/job count
- database row limit
- query timeout
- AI request count
- AI token budget
- background job concurrency

## Scope hierarchy

Limits should be layered.

Recommended hierarchy:

1. per session
2. per user
3. per company
4. per role
5. per endpoint
6. per module
7. per automation action
8. per public surface
9. system-wide emergency cap

Example:

```text
A company admin may open Booking List normally.
If one browser session loops, throttle the session first.
If all sessions for one company create abnormal load, limit the company on that endpoint.
If the endpoint itself is degraded globally, open a circuit or limited mode for that module.
```

## Initial quota examples

These are starting examples, not final production values.

| Feature/module | Example guard | Failure behavior |
|---|---|---|
| Booking List | max page reload/fetch count per session window | throttle session and show incident id |
| Schedule Grid | max heavy schedule reads per user/company window | limited data window or read-only mode |
| Customer Card | max repeated detail reloads per session | throttle and stop refetch loop |
| Invoice export | max concurrent export jobs per company | queue or reject with controlled message |
| Media upload | max file size and concurrent uploads | pause/reject upload safely |
| AI chat | max requests and token budget per user/company | show quota message and log event |
| Automation jobs | max concurrent executions per action/company | skip/queue and log execution result |
| Public pricing calculator | per-IP/per-session request cap | throttle public client only |

## Backend enforcement rule

Frontend limits improve user experience, but backend enforcement is mandatory.

Never rely only on:

- disabled buttons
- client-side debounce
- local component state
- browser-only request counters

Backend or edge enforcement must protect shared resources.

## Data access safety

Every list/read-heavy module must use:

- pagination or cursor-based paging
- explicit selected columns
- maximum row limits
- server-side filtering
- indexed filter/sort columns
- no unbounded relation expansion
- no unbounded search over large tables
- no accidental full-table reads
- query timing review for heavy paths

## Retry policy

Retries must be bounded.

Required:

- maximum retry count
- exponential backoff or equivalent
- jitter where appropriate
- stop condition on 4xx errors
- stop condition when circuit is open
- incident creation on repeated failure

Invalid:

```text
retry forever until success
```

## Polling policy

Polling must be explicit and bounded.

Required:

- minimum interval
- maximum active duration
- pause on hidden tab where appropriate
- cleanup on unmount
- no duplicate polling per component instance
- no polling for data that can be requested on demand

## Realtime subscription policy

Realtime subscriptions must have:

- stable subscription keys
- cleanup on unmount/logout/company switch
- duplicate subscription prevention
- per-session subscription cap
- reconnect limit
- incident logging on reconnect storm

## Failure behavior

When a limit is exceeded, the linked `RuntimeGuardPolicy` chooses the least disruptive guard action:

1. throttle session
2. limit data returned
3. temporarily block specific endpoint/action for actor
4. set feature to read-only or limited mode
5. open circuit for dependency/module
6. disable feature with kill switch

Do not allow uncontrolled retries to continue after the guard has triggered.
