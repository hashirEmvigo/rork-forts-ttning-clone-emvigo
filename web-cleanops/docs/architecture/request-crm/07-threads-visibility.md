# 07 - Threads and Visibility

## Core rule

A request may contain multiple communication threads. Customer and employee must not see each other's threads by default.

## Thread types

| Type | Visible to | Use |
|---|---|---|
| customer | Admin + specific customer | Customer communication |
| employee | Admin + specific employee(s) | Employee communication |
| shared_customer_employee | Admin + customer + selected employee(s) | Explicit shared thread only |
| internal | Admin/support/owner according to access | Internal coordination |
| ai_intake | AI + customer/employee, later admin | Intake conversation |

## Send-time visibility

Admin UI must display explicit recipient confirmation before sending external messages.

Examples:

- `This will be sent to Anna Andersson.`
- `Internal only - not visible to customer/employee.`

## Immutable external visibility

External message visibility should not be changed after send. If an override is required, it must be audited and permission-gated.
