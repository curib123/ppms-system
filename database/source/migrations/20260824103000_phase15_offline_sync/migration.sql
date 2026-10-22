-- Phase 15 strengthens device/audit evidence and cursor-pull performance.
-- Sync/device/receipt/conflict tables were intentionally created in the
-- canonical initial migration so upgrades never need to recreate them.

CREATE INDEX IF NOT EXISTS "PpmRecord_updatedAt_id_idx"
  ON "PpmRecord"("updatedAt", "id");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_clientDeviceId_fkey"
  FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
