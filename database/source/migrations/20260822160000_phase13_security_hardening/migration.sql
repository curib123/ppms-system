-- Phase 13 security hardening: durable abuse defense and session rotation evidence.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN_LOCKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_ROTATED';

ALTER TABLE "AuthSession" ADD COLUMN "rotatedAt" TIMESTAMP(3);

CREATE TABLE "AuthLoginDefense" (
    "id" TEXT NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    CONSTRAINT "AuthLoginDefense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthLoginDefense_identifierHash_key"
ON "AuthLoginDefense"("identifierHash");

CREATE INDEX "AuthLoginDefense_lockedUntil_idx"
ON "AuthLoginDefense"("lockedUntil");

CREATE INDEX "AuthLoginDefense_lastFailedAt_idx"
ON "AuthLoginDefense"("lastFailedAt");
