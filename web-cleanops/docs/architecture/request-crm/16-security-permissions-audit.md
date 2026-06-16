# 16 - Security, Permissions and Audit

## Access model

Use RBAC for coarse roles and ABAC for request-specific access.

Inputs:

- tenant/company
- role
- request owner
- support membership
- category assignment
- participant relationship
- locked state
- handled-by-owner-only state
- sensitivity
- related area/employee/customer
- override policy

## Access resolver candidate

```text
can_read_request(user, request):
  if user.is_superadmin and policy.allow_superadmin_override:
    return true with audit
  if request.is_locked and no explicit access:
    return metadata_only
  if user is request.owner:
    return true
  if user in request.support_admins:
    return true
  if request.category in user.assigned_categories and not request.handled_by_owner_only:
    return true
  if user assigned to related area and policy allows:
    return true
  return false
```

## Audit events

- request created/updated/closed/reopened
- owner/support/category changed
- status/priority/severity/SLA changed
- message created
- email sent/paused/disabled/retry/failed
- internal task created/assigned/acknowledged/completed
- snooze created/removed/expired/auto-unsnoozed
- handle-self enabled/disabled
- request locked/unlocked
- access requested/approved/denied/overridden
- notification created/acknowledged/handled/dismissed
- AI proposal created/accepted/rejected/executed/failed
- test data created/deleted
- runtime incidents linked from Automation & AI Center when relevant
