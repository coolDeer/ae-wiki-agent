BEGIN;

-- v2.6.1 — cancelled status is application-level only (TEXT column, no DDL needed)
-- This migration exists to document the lifecycle expansion and keep migration
-- history aligned with runtime behavior.

COMMIT;
