# 19 - Test Strategy, Test Data and Cleanup

## Environments

- Development: fast iteration, reset often.
- Staging/Test: realistic end-to-end data in test tenant with batch tags.
- Production: no test data, external feature flags off until approved.

## Test data tagging

Required fields where applicable:

- is_test_data
- test_batch_id
- test_tenant_id
- created_by_environment
- created_by_test_scenario

## Cleanup scope

Cleanup scripts must remove batch-linked:

- requests
- messages
- internal posts/tasks
- notifications
- chats
- AI logs
- email deliveries
- attachments
- read receipts
- access requests
- snooze records
- audit events

Do not delete production settings/categories/templates unless explicitly test-scoped.

## Test scenarios

- create test customer
- create test employee
- create test booking
- create test invoice
- simulate customer message
- simulate employee response
- simulate late check-in
- simulate emergency request
- simulate AI unable to resolve
- simulate access request
- cleanup test batch
