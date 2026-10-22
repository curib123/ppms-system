












-- A daily key is written as "<ppmFormId>:<YYYY-MM-DD>" by every online and
-- offline create path. It is nullable only so existing legacy/test duplicates
-- remain readable until they are consolidated into repeatable entry rows.
ALTER TABLE "PpmRecord" ADD COLUMN "dailyKey" TEXT;

CREATE UNIQUE INDEX "PpmRecord_dailyKey_key" ON "PpmRecord"("dailyKey");
