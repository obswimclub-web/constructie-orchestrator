CREATE TABLE artifact_records (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  attempt_id uuid NULL,
  kind text NOT NULL,
  uri text NOT NULL,
  hash text NULL,
  produced_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifact_records_project_work_idx ON artifact_records(project_id, work_item_id);

CREATE TABLE evidence_records (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  artifact_id uuid NULL,
  claim text NOT NULL,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  currentness text NOT NULL DEFAULT 'CURRENT',
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_records_project_work_current_idx ON evidence_records(project_id, work_item_id, currentness);
CREATE INDEX evidence_records_artifact_idx ON evidence_records(artifact_id);

CREATE TABLE verification_records (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  verification_type text NOT NULL,
  status text NOT NULL,
  evidence_ids jsonb NOT NULL,
  verifier_ref text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_records_project_work_status_idx ON verification_records(project_id, work_item_id, status);
