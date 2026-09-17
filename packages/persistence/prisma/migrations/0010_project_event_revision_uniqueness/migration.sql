-- F-016: Enforce single ProjectEvent per aggregate revision.
--
-- Root cause: the prior uniqueness key included event_type, allowing two
-- events with different event_types to share the same aggregate revision.
-- This violates the optimistic-concurrency invariant that one revision
-- represents one committed position in the event stream.
--
-- FAIL-CLOSED: if any existing rows already share (aggregate_id,
-- aggregate_revision) with different event_types, this migration will fail
-- with a duplicate-key violation before creating the new constraint.
-- No data is silently deleted or merged.
--
-- This migration does NOT touch historical migration files.

-- Step 1: Remove the old tripartite uniqueness constraint (SQL-migration form).
ALTER TABLE project_events
  DROP CONSTRAINT IF EXISTS project_events_identity_revision_unique;

-- Step 2: Remove the Prisma-generated tripartite unique index (if present).
DROP INDEX IF EXISTS project_events_aggregate_id_aggregate_revision_event_type_key;

-- Step 3: Create the stricter bipartite uniqueness constraint.
-- Will fail closed if duplicate (aggregate_id, aggregate_revision) rows exist.
ALTER TABLE project_events
  ADD CONSTRAINT project_events_aggregate_revision_unique
  UNIQUE (aggregate_id, aggregate_revision);
