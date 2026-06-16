# 04 - System Overview

```text
External actors
  Customer Portal       Employee Portal       Admin UI
       |                     |                  |
       +----------+----------+----------+-------+
                  |                     |
          REQUEST Platform Application Layer
                  |
  +---------------+---------------+---------------+
  | Request Manager | Chat Service | Notification Center |
  +---------------+---------------+---------------+
                  |
        Communication / Event / Access Core
                  |
  +-------+--------+---------+----------+---------+----------+
  | CRM   | Staff  | Booking | WorkOrder| Invoice | Schedule |
  +-------+--------+---------+----------+---------+----------+
                  |
  Internal AI Service + Email Outbox + Audit + Domain Events
                  |
       Automation & AI Center integration surface
```

## Request Manager

Long-lived communication and responsibility layer. Handles requests, internal tasks, external threads, owner/support, category, SLA, status and history.

## Notification Center

Operational signal UI and domain object. It does not own global automation policy. Automated notification creation rules are registered through Automation & AI Center.

## Chat

AI-first intake that can be admin-taken-over or converted to a request.

## Dashboard

Shows operational exceptions that may not be requests.

## Automation & AI Center integration surface

REQUEST emits domain events and exposes metadata required for central automation registry, execution logs, risk policies, AI extensions, runtime flags and incidents.
