CREATE TABLE "execution_log_records" (
  "id" TEXT NOT NULL,
  "project_id" UUID NOT NULL,
  "run_id" TEXT NOT NULL,
  "attempt_id" UUID,
  "work_item_id" UUID,
  "stream" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "previous_hash" TEXT,
  "hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "execution_log_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "incident_event_records" (
  "id" TEXT NOT NULL,
  "incident_id" TEXT NOT NULL,
  "project_id" UUID NOT NULL,
  "run_id" TEXT NOT NULL,
  "attempt_id" UUID,
  "work_item_id" UUID,
  "state" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "resolution_claim" TEXT,
  "recovery_evidence_id" TEXT,
  "previous_hash" TEXT,
  "hash" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "incident_event_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "execution_log_records_project_id_run_id_sequence_idx" ON "execution_log_records"("project_id", "run_id", "sequence");
CREATE INDEX "execution_log_records_project_id_attempt_id_idx" ON "execution_log_records"("project_id", "attempt_id");

CREATE INDEX "incident_event_records_project_id_incident_id_sequence_idx" ON "incident_event_records"("project_id", "incident_id", "sequence");
CREATE INDEX "incident_event_records_project_id_run_id_idx" ON "incident_event_records"("project_id", "run_id");

CREATE INDEX "evidence_records_scm_commit_sha_idx" ON "evidence_records"("scm_commit_sha");
CREATE INDEX "evidence_records_deployment_uri_idx" ON "evidence_records"("deployment_uri");
