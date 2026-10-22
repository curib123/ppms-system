-- Replace the status-only revalidation index with the stable queue keyset index.
DROP INDEX IF EXISTS "TraceRevalidation_status_idx";
CREATE INDEX "TraceRevalidation_status_createdAt_id_idx"
  ON "TraceRevalidation"("status", "createdAt", "id");
