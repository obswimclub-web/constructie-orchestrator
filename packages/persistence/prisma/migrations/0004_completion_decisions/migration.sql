CREATE TABLE "completion_decisions" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "completion_object_ref" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "evaluated_project_revision" INTEGER NOT NULL,
  "evaluated_work_item_id" UUID NOT NULL,
  "evaluated_work_item_revision" INTEGER NOT NULL,
  "verification_ids" JSONB NOT NULL,
  "evidence_ids" JSONB NOT NULL,
  "reconciliation_ref" TEXT NOT NULL,
  "rationale_codes" JSONB NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "completion_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "completion_decisions_project_id_completion_object_ref_decided_at_idx"
  ON "completion_decisions"("project_id", "completion_object_ref", "decided_at");
CREATE INDEX "completion_decisions_project_id_state_idx"
  ON "completion_decisions"("project_id", "state");
