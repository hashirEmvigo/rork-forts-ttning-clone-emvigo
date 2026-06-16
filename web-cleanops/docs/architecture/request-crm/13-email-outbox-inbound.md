# 13 - Email Outbox and Inbound Reply

## Outbound email

Customer-visible admin message should create an EmailOutboxJob with a short delay, e.g. 10 seconds.

The request message is stored immediately. Email delivery happens through outbox/queue.

UI actions:

- send now
- pause
- disable delivery for request/thread
- resend later

All email events must be logged and audited.

## Inbound reply later

Inbound email is not first slice. Later design should use unique reply token/address per request or thread.

Handle:

- sender verification
- autoresponder detection
- quoted content parsing
- attachment scanning and limits
- bounce handling
- portal_only sensitive cases

## Automation boundary

Persistent email failures may create notification or incident candidates. Central policy belongs in Automation & AI Center.
