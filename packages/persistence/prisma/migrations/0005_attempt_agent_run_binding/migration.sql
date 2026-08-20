ALTER TABLE "attempts"
  ADD COLUMN "agent_run_id" TEXT,
  ADD COLUMN "agent_adapter_id" TEXT;

CREATE INDEX "attempts_agent_run_id_idx" ON "attempts"("agent_run_id");
