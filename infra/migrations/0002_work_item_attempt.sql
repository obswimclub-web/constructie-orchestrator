CREATE TABLE "work_items" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "parent_id" UUID NULL,
  "type" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "current_attempt_id" UUID NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "work_items_project_state_idx" ON "work_items"("project_id", "lifecycle_state");
CREATE INDEX "work_items_parent_idx" ON "work_items"("parent_id");

CREATE TABLE "attempts" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "work_item_id" UUID NOT NULL REFERENCES "work_items"("id") ON DELETE CASCADE,
  "attempt_number" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "work_package_version" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ NULL,
  "ended_at" TIMESTAMPTZ NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "attempts_work_item_number_key" UNIQUE ("work_item_id", "attempt_number")
);
CREATE INDEX "attempts_project_state_idx" ON "attempts"("project_id", "state");
CREATE INDEX "attempts_work_item_active_idx" ON "attempts"("work_item_id", "active");
CREATE UNIQUE INDEX "attempts_one_active_per_work_item" ON "attempts"("work_item_id") WHERE "active" = TRUE;
