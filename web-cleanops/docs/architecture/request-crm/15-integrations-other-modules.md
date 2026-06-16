# 15 - Integrations With Other Modules

## Customer Card

Show customer requests, create request, preview locked requests and customer-visible threads according to access.

## Employee Card

Show employee requests, emergency, schedule/payroll questions and employee-visible threads.

## Booking

Link requests to bookings and allow AI/tool to fetch upcoming bookings later.

## Work Orders

Link work orders. Internal tasks can point to updating work order notes or cleaning protocol.

## Invoices

Invoice questions, unpaid invoice events and customer communication. Unpaid invoice automation belongs centrally.

## Schedule

Schedule requests, late check-ins, rescheduling and customer impact. Late check-in starts as notification/domain event, not automatic request.

## Payroll

Payroll questions require strong access control and may be portal_only.

## Media Center

Attachments, pictures and documents must inherit correct visibility scope.

## Activity Log

Mandatory audit sink for actions, state changes, access, AI and email.
