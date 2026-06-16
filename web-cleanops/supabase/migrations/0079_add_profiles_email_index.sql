-- ============================================================================
-- CleanOps — 0079: Add DB index on profiles(email) for auth/admin lookups
-- ============================================================================
--
-- Problem:
--   The profiles table has no index on email, yet the admin-create-user
--   Edge Function performs an `.ilike("email", ...)` existence check before
--   every user creation. Similarly, admin-delete-user can fall back to an
--   email lookup. On larger installations, a full sequential scan on
--   profiles.email for every user-creation request becomes expensive.
--
-- What this migration does:
--   Adds a single case-insensitive functional index on LOWER(email),
--   matching the established pattern already used by app_users
--   (idx_app_users_email_lower) and employees
--   (idx_employees_company_email).
--
--   This index supports:
--     • WHERE lower(email) = lower($1)          — exact case-insensitive match
--     • WHERE email ILIKE $1                     — the actual query pattern used
--       by admin-create-user (ILIKE can use a LOWER index in PostgreSQL)
--
-- Idempotent: uses CREATE INDEX IF NOT EXISTS.
-- ============================================================================

create index if not exists idx_profiles_email_lower
  on profiles (lower(email));
