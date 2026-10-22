-- Phase 14 lifecycle safety and query support.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_FAILED';

CREATE INDEX "PpmRecord_retention_eligible_idx"
ON "PpmRecord"("closedAt", "id")
WHERE "status" = 'CLOSED' AND "archivedAt" IS NULL;

CREATE INDEX "SystemJobRun_history_idx"
ON "SystemJobRun"("createdAt" DESC, "id" DESC);

ALTER TABLE "SystemJobRun"
  ADD CONSTRAINT "SystemJobRun_checksum_format_check"
  CHECK ("artifactChecksum" IS NULL OR "artifactChecksum" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "SystemJobRun_completion_order_check"
  CHECK ("completedAt" IS NULL OR "startedAt" IS NULL OR "completedAt" >= "startedAt");
