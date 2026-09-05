-- Migration 0007: P9 Evidence Lineage & Tamper-Evident Persistence

-- 1. Artifact records lineage & integrity metadata
ALTER TABLE artifact_records ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT '';
ALTER TABLE artifact_records ADD COLUMN IF NOT EXISTS digest text NULL;
CREATE INDEX IF NOT EXISTS artifact_records_project_run_idx ON artifact_records(project_id, run_id);

-- 2. Evidence records lineage & integrity metadata
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT '';
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS attempt_id uuid NULL;
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS approval_id uuid NULL;
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS agent_id text NULL;
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS scm_commit_sha text NULL;
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS deployment_uri text NULL;
ALTER TABLE evidence_records ADD COLUMN IF NOT EXISTS digest text NULL;

CREATE INDEX IF NOT EXISTS evidence_records_project_run_idx ON evidence_records(project_id, run_id);
CREATE INDEX IF NOT EXISTS evidence_records_project_attempt_idx ON evidence_records(project_id, attempt_id);
CREATE INDEX IF NOT EXISTS evidence_records_approval_idx ON evidence_records(approval_id);

-- 3. Verification records lineage & integrity metadata
ALTER TABLE verification_records ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT '';
ALTER TABLE verification_records ADD COLUMN IF NOT EXISTS attempt_id uuid NULL;
ALTER TABLE verification_records ADD COLUMN IF NOT EXISTS completion_decision_id uuid NULL;
ALTER TABLE verification_records ADD COLUMN IF NOT EXISTS digest text NULL;

CREATE INDEX IF NOT EXISTS verification_records_project_run_idx ON verification_records(project_id, run_id);
CREATE INDEX IF NOT EXISTS verification_records_completion_decision_idx ON verification_records(completion_decision_id);
