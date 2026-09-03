-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "work_item_id" UUID,
    "attempt_id" UUID,
    "gate_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scope" JSONB NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "requested_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "rationale" TEXT,
    "consumed_at" TIMESTAMP(3),
    "post_action_verification" JSONB,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_audit_events" (
    "id" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approvals_project_id_status_idx" ON "approvals"("project_id", "status");

-- CreateIndex
CREATE INDEX "approvals_work_item_id_idx" ON "approvals"("work_item_id");

-- CreateIndex
CREATE INDEX "approval_audit_events_approval_id_idx" ON "approval_audit_events"("approval_id");

-- AddForeignKey
ALTER TABLE "approval_audit_events" ADD CONSTRAINT "approval_audit_events_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
