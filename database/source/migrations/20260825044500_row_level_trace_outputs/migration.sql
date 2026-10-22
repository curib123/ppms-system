ALTER TABLE "PpmTraceOutput" ADD COLUMN "sourcePath" TEXT NOT NULL DEFAULT '$';

DROP INDEX "PpmTraceOutput_revisionId_outputKey_key";
CREATE UNIQUE INDEX "PpmTraceOutput_revisionId_outputKey_sourcePath_key"
  ON "PpmTraceOutput"("revisionId", "outputKey", "sourcePath");
