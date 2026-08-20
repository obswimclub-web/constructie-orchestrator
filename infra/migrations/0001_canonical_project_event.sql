CREATE TABLE projects (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT projects_lifecycle_state_check CHECK (lifecycle_state IN ('ACTIVE', 'PAUSED', 'ARCHIVED'))
);

CREATE TABLE project_events (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 1),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_events_identity_revision_unique UNIQUE (aggregate_id, aggregate_revision, event_type)
);
CREATE INDEX project_events_project_persisted_idx ON project_events(project_id, persisted_at);
CREATE INDEX project_events_correlation_idx ON project_events(correlation_id);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  CONSTRAINT outbox_status_check CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))
);
CREATE INDEX outbox_events_dispatch_idx ON outbox_events(status, available_at);
CREATE INDEX outbox_events_project_idx ON outbox_events(project_id);
