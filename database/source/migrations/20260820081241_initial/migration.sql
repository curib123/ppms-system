-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PERSONNEL', 'FSQA', 'SUPERVISOR', 'PLANT_MANAGER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "AreaStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PpmStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RESERVED');

-- CreateEnum
CREATE TYPE "PpmRecordStatus" AS ENUM ('ACTIVE', 'SUBMITTED', 'FSQA_APPROVED', 'SUPERVISOR_APPROVED', 'RETURNED_TO_FSQA', 'CLOSED');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CORRECTED', 'APPROVED', 'SUPERSEDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewStep" AS ENUM ('FSQA_REVIEW', 'SUPERVISOR_REVIEW', 'PLANT_MANAGER_REVIEW');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('CREATE_RECORD', 'SUBMIT', 'CORRECT', 'APPROVE', 'RETURN', 'CLOSE');

-- CreateEnum
CREATE TYPE "ActivationStatus" AS ENUM ('ACTIVE', 'RESERVED', 'PENDING_VALIDATION', 'DISABLED');

-- CreateEnum
CREATE TYPE "TraceCodeSourceType" AS ENUM ('SYSTEM_GENERATED', 'UPSTREAM_LOOKUP', 'MANUAL_EXTERNAL', 'SCAN_EXTERNAL', 'PENDING_RULE');

-- CreateEnum
CREATE TYPE "TraceOutputStatus" AS ENUM ('PUBLISHED', 'LINKED_DOWNSTREAM', 'SUPERSEDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CodeResetPeriod" AS ENUM ('NONE', 'DAILY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RevalidationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RevalidationItemStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AppearanceMode" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WORKFLOW', 'CORRECTION', 'REVALIDATION', 'SYSTEM', 'SECURITY', 'BACKUP', 'SYNC');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SystemJobType" AS ENUM ('BACKUP', 'RESTORE', 'RETENTION_ARCHIVE', 'CACHE_MAINTENANCE');

-- CreateEnum
CREATE TYPE "SystemJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('CREATE_DRAFT', 'UPDATE_DRAFT', 'QUEUE_SUBMIT', 'LOCAL_TOMBSTONE', 'ATTACHMENT_UPLOAD_COMPLETE', 'CONFLICT_RESOLUTION');

-- CreateEnum
CREATE TYPE "SyncMutationStatus" AS ENUM ('APPLIED', 'DUPLICATE', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SyncResolutionType" AS ENUM ('KEEP_SERVER', 'APPLY_LOCAL_AS_NEW_REVISION', 'MANUAL_MERGE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_REVOKED', 'CREATE', 'UPDATE', 'ARCHIVE', 'SUBMIT', 'PUBLISH_CODE', 'SELECT_UPSTREAM_CODE', 'CREATE_TRACE_LINK', 'CORRECT_REVISION', 'APPROVE', 'RETURN', 'CLOSE', 'CONFIG_CHANGE', 'SETTINGS_CHANGE', 'THEME_CHANGE', 'RETENTION_RUN', 'BACKUP_CREATED', 'RESTORE_STARTED', 'RESTORE_COMPLETED', 'RESTORE_FAILED', 'PERMISSION_CHANGE', 'REVALIDATION_CREATED', 'REVALIDATION_RESOLVED', 'DEVICE_REGISTERED', 'DEVICE_REVOKED', 'SYNC_APPLIED', 'SYNC_REJECTED', 'SYNC_CONFLICT_CREATED', 'SYNC_CONFLICT_RESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionArea" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AreaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmForm" (
    "id" TEXT NOT NULL,
    "ppmCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PpmStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpmForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaPpmAssignment" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "ppmFormId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaPpmAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAreaAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAreaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonnelPpmAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ppmFormId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonnelPpmAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmTemplateVersion" (
    "id" TEXT NOT NULL,
    "ppmFormId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "versionLabel" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "sourceFileName" TEXT,
    "sourceFileHash" TEXT,
    "definitionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpmTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmRecord" (
    "id" TEXT NOT NULL,
    "areaPpmAssignmentId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "recordCode" TEXT,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "shiftCode" TEXT,
    "batchNo" TEXT,
    "lotNo" TEXT,
    "status" "PpmRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentRevisionNo" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PpmRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmRecordRevision" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "dataJson" JSONB NOT NULL,
    "dataHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "impactCheckJson" JSONB,
    "isTraceCritical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PpmRecordRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionChange" (
    "id" TEXT NOT NULL,
    "oldRevisionId" TEXT,
    "newRevisionId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "beforeValueJson" JSONB,
    "afterValueJson" JSONB,
    "reason" TEXT NOT NULL,
    "isTraceCritical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceCodeRule" (
    "id" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "outputKey" TEXT NOT NULL,
    "outputLabel" TEXT NOT NULL,
    "status" "ActivationStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "sourceType" "TraceCodeSourceType" NOT NULL,
    "formulaTemplate" TEXT,
    "resetPeriod" "CodeResetPeriod" NOT NULL DEFAULT 'NONE',
    "sequencePadding" INTEGER,
    "requiresUniqueBusinessCode" BOOLEAN NOT NULL DEFAULT false,
    "configurationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraceCodeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeSequence" (
    "id" TEXT NOT NULL,
    "codeRuleId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmTraceConnection" (
    "id" TEXT NOT NULL,
    "sourcePpmFormId" TEXT NOT NULL,
    "sourceOutputKey" TEXT NOT NULL,
    "targetPpmFormId" TEXT NOT NULL,
    "targetInputKey" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL,
    "status" "ActivationStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "requiresApprovalBeforeUse" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpmTraceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmTraceOutput" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "codeRuleId" TEXT,
    "outputKey" TEXT NOT NULL,
    "outputCode" TEXT NOT NULL,
    "outputType" TEXT,
    "quantity" DECIMAL(18,6),
    "unit" TEXT,
    "status" "TraceOutputStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSnapshotJson" JSONB,

    CONSTRAINT "PpmTraceOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpmTraceLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "sourceTraceOutputId" TEXT NOT NULL,
    "downstreamRevisionId" TEXT NOT NULL,
    "downstreamInputKey" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "PpmTraceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "revisionId" TEXT,
    "step" "ReviewStep",
    "action" "WorkflowActionType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceRevalidation" (
    "id" TEXT NOT NULL,
    "triggerRevisionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RevalidationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNotes" TEXT,

    CONSTRAINT "TraceRevalidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceRevalidationItem" (
    "id" TEXT NOT NULL,
    "revalidationId" TEXT NOT NULL,
    "traceLinkId" TEXT NOT NULL,
    "status" "RevalidationItemStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TraceRevalidationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "recordId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "clientDeviceId" TEXT,
    "clientMutationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceUuid" TEXT NOT NULL,
    "displayName" TEXT,
    "platform" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offlineAccessIssuedAt" TIMESTAMP(3),
    "offlineAccessExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ClientDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncMutationReceipt" (
    "id" TEXT NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordId" TEXT,
    "operationType" "SyncOperationType" NOT NULL,
    "baseRevisionNo" INTEGER,
    "resultRevisionNo" INTEGER,
    "status" "SyncMutationStatus" NOT NULL,
    "payloadHash" TEXT,
    "resultJson" JSONB,
    "correlationId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "SyncMutationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "mutationReceiptId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "baseRevisionNo" INTEGER NOT NULL,
    "serverRevisionNo" INTEGER NOT NULL,
    "localPatchJson" JSONB NOT NULL,
    "localPayloadHash" TEXT,
    "changedPathsJson" JSONB,
    "isTraceCritical" BOOLEAN NOT NULL DEFAULT false,
    "status" "SyncConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionType" "SyncResolutionType",
    "resolutionJson" JSONB,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appearanceMode" "AppearanceMode" NOT NULL DEFAULT 'SYSTEM',
    "listViewMode" TEXT NOT NULL DEFAULT 'TABLE',
    "preferencesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "valueType" TEXT NOT NULL,
    "description" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemJobRun" (
    "id" TEXT NOT NULL,
    "jobType" "SystemJobType" NOT NULL,
    "status" "SystemJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "artifactName" TEXT,
    "artifactChecksum" TEXT,
    "correlationId" TEXT,
    "detailsJson" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeNo_key" ON "User"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionArea_code_key" ON "ProductionArea"("code");

-- CreateIndex
CREATE INDEX "ProductionArea_status_idx" ON "ProductionArea"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PpmForm_ppmCode_key" ON "PpmForm"("ppmCode");

-- CreateIndex
CREATE INDEX "PpmForm_status_idx" ON "PpmForm"("status");

-- CreateIndex
CREATE INDEX "AreaPpmAssignment_areaId_isActive_idx" ON "AreaPpmAssignment"("areaId", "isActive");

-- CreateIndex
CREATE INDEX "AreaPpmAssignment_ppmFormId_isActive_idx" ON "AreaPpmAssignment"("ppmFormId", "isActive");

-- CreateIndex
CREATE INDEX "UserAreaAssignment_areaId_isActive_idx" ON "UserAreaAssignment"("areaId", "isActive");

-- CreateIndex
CREATE INDEX "UserAreaAssignment_userId_isActive_idx" ON "UserAreaAssignment"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserAreaAssignment_userId_areaId_key" ON "UserAreaAssignment"("userId", "areaId");

-- CreateIndex
CREATE INDEX "PersonnelPpmAssignment_ppmFormId_isActive_idx" ON "PersonnelPpmAssignment"("ppmFormId", "isActive");

-- CreateIndex
CREATE INDEX "PersonnelPpmAssignment_userId_isActive_idx" ON "PersonnelPpmAssignment"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelPpmAssignment_userId_ppmFormId_key" ON "PersonnelPpmAssignment"("userId", "ppmFormId");

-- CreateIndex
CREATE INDEX "PpmTemplateVersion_ppmFormId_isActive_idx" ON "PpmTemplateVersion"("ppmFormId", "isActive");

-- CreateIndex
CREATE INDEX "PpmTemplateVersion_effectiveFrom_effectiveTo_idx" ON "PpmTemplateVersion"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "PpmTemplateVersion_ppmFormId_versionNo_key" ON "PpmTemplateVersion"("ppmFormId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "PpmRecord_recordCode_key" ON "PpmRecord"("recordCode");

-- CreateIndex
CREATE INDEX "PpmRecord_areaPpmAssignmentId_productionDate_idx" ON "PpmRecord"("areaPpmAssignmentId", "productionDate");

-- CreateIndex
CREATE INDEX "PpmRecord_areaPpmAssignmentId_status_productionDate_id_idx" ON "PpmRecord"("areaPpmAssignmentId", "status", "productionDate", "id");

-- CreateIndex
CREATE INDEX "PpmRecord_templateVersionId_idx" ON "PpmRecord"("templateVersionId");

-- CreateIndex
CREATE INDEX "PpmRecord_status_productionDate_id_idx" ON "PpmRecord"("status", "productionDate", "id");

-- CreateIndex
CREATE INDEX "PpmRecord_createdById_status_createdAt_id_idx" ON "PpmRecord"("createdById", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PpmRecord_productionDate_id_idx" ON "PpmRecord"("productionDate", "id");

-- CreateIndex
CREATE INDEX "PpmRecord_archivedAt_closedAt_id_idx" ON "PpmRecord"("archivedAt", "closedAt", "id");

-- CreateIndex
CREATE INDEX "PpmRecord_batchNo_idx" ON "PpmRecord"("batchNo");

-- CreateIndex
CREATE INDEX "PpmRecord_lotNo_idx" ON "PpmRecord"("lotNo");

-- CreateIndex
CREATE INDEX "PpmRecordRevision_recordId_status_idx" ON "PpmRecordRevision"("recordId", "status");

-- CreateIndex
CREATE INDEX "PpmRecordRevision_createdById_idx" ON "PpmRecordRevision"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "PpmRecordRevision_recordId_revisionNo_key" ON "PpmRecordRevision"("recordId", "revisionNo");

-- CreateIndex
CREATE INDEX "RevisionChange_newRevisionId_idx" ON "RevisionChange"("newRevisionId");

-- CreateIndex
CREATE INDEX "RevisionChange_isTraceCritical_idx" ON "RevisionChange"("isTraceCritical");

-- CreateIndex
CREATE INDEX "TraceCodeRule_status_idx" ON "TraceCodeRule"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TraceCodeRule_templateVersionId_outputKey_key" ON "TraceCodeRule"("templateVersionId", "outputKey");

-- CreateIndex
CREATE UNIQUE INDEX "CodeSequence_codeRuleId_periodKey_key" ON "CodeSequence"("codeRuleId", "periodKey");

-- CreateIndex
CREATE INDEX "PpmTraceConnection_sourcePpmFormId_status_idx" ON "PpmTraceConnection"("sourcePpmFormId", "status");

-- CreateIndex
CREATE INDEX "PpmTraceConnection_targetPpmFormId_status_idx" ON "PpmTraceConnection"("targetPpmFormId", "status");

-- CreateIndex
CREATE INDEX "PpmTraceConnection_targetPpmFormId_targetInputKey_status_idx" ON "PpmTraceConnection"("targetPpmFormId", "targetInputKey", "status");

-- CreateIndex
CREATE INDEX "PpmTraceConnection_status_updatedAt_id_idx" ON "PpmTraceConnection"("status", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PpmTraceConnection_sourcePpmFormId_sourceOutputKey_targetPp_key" ON "PpmTraceConnection"("sourcePpmFormId", "sourceOutputKey", "targetPpmFormId", "targetInputKey");

-- CreateIndex
CREATE INDEX "PpmTraceOutput_recordId_publishedAt_id_idx" ON "PpmTraceOutput"("recordId", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "PpmTraceOutput_outputCode_idx" ON "PpmTraceOutput"("outputCode");

-- CreateIndex
CREATE INDEX "PpmTraceOutput_outputKey_outputCode_status_idx" ON "PpmTraceOutput"("outputKey", "outputCode", "status");

-- CreateIndex
CREATE INDEX "PpmTraceOutput_status_publishedAt_id_idx" ON "PpmTraceOutput"("status", "publishedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PpmTraceOutput_revisionId_outputKey_key" ON "PpmTraceOutput"("revisionId", "outputKey");

-- CreateIndex
CREATE INDEX "PpmTraceLink_sourceTraceOutputId_selectedAt_id_idx" ON "PpmTraceLink"("sourceTraceOutputId", "selectedAt", "id");

-- CreateIndex
CREATE INDEX "PpmTraceLink_downstreamRevisionId_selectedAt_id_idx" ON "PpmTraceLink"("downstreamRevisionId", "selectedAt", "id");

-- CreateIndex
CREATE INDEX "PpmTraceLink_connectionId_isActive_selectedAt_id_idx" ON "PpmTraceLink"("connectionId", "isActive", "selectedAt", "id");

-- CreateIndex
CREATE INDEX "PpmTraceLink_isActive_idx" ON "PpmTraceLink"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PpmTraceLink_connectionId_sourceTraceOutputId_downstreamRev_key" ON "PpmTraceLink"("connectionId", "sourceTraceOutputId", "downstreamRevisionId", "downstreamInputKey");

-- CreateIndex
CREATE INDEX "WorkflowEvent_recordId_createdAt_id_idx" ON "WorkflowEvent"("recordId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WorkflowEvent_revisionId_idx" ON "WorkflowEvent"("revisionId");

-- CreateIndex
CREATE INDEX "WorkflowEvent_step_action_createdAt_id_idx" ON "WorkflowEvent"("step", "action", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WorkflowEvent_actorId_createdAt_id_idx" ON "WorkflowEvent"("actorId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TraceRevalidation_triggerRevisionId_idx" ON "TraceRevalidation"("triggerRevisionId");

-- CreateIndex
CREATE INDEX "TraceRevalidation_status_idx" ON "TraceRevalidation"("status");

-- CreateIndex
CREATE INDEX "TraceRevalidationItem_status_idx" ON "TraceRevalidationItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TraceRevalidationItem_revalidationId_traceLinkId_key" ON "TraceRevalidationItem"("revalidationId", "traceLinkId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_id_idx" ON "AuditLog"("actorId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_recordId_createdAt_id_idx" ON "AuditLog"("recordId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_id_idx" ON "AuditLog"("action", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_clientMutationId_idx" ON "AuditLog"("clientMutationId");

-- CreateIndex
CREATE INDEX "AuditLog_clientDeviceId_createdAt_id_idx" ON "AuditLog"("clientDeviceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");

-- CreateIndex
CREATE INDEX "ClientDevice_userId_revokedAt_lastSeenAt_idx" ON "ClientDevice"("userId", "revokedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ClientDevice_offlineAccessExpiresAt_idx" ON "ClientDevice"("offlineAccessExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDevice_userId_deviceUuid_key" ON "ClientDevice"("userId", "deviceUuid");

-- CreateIndex
CREATE UNIQUE INDEX "SyncMutationReceipt_clientMutationId_key" ON "SyncMutationReceipt"("clientMutationId");

-- CreateIndex
CREATE INDEX "SyncMutationReceipt_deviceId_receivedAt_id_idx" ON "SyncMutationReceipt"("deviceId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "SyncMutationReceipt_userId_receivedAt_id_idx" ON "SyncMutationReceipt"("userId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "SyncMutationReceipt_recordId_receivedAt_id_idx" ON "SyncMutationReceipt"("recordId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "SyncMutationReceipt_status_receivedAt_id_idx" ON "SyncMutationReceipt"("status", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "SyncMutationReceipt_correlationId_idx" ON "SyncMutationReceipt"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConflict_mutationReceiptId_key" ON "SyncConflict"("mutationReceiptId");

-- CreateIndex
CREATE INDEX "SyncConflict_recordId_status_createdAt_id_idx" ON "SyncConflict"("recordId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SyncConflict_status_createdAt_id_idx" ON "SyncConflict"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SyncConflict_resolvedById_resolvedAt_idx" ON "SyncConflict"("resolvedById", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "SystemSetting_updatedAt_idx" ON "SystemSetting"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_id_idx" ON "Notification"("recipientId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_recipientId_archivedAt_createdAt_id_idx" ON "Notification"("recipientId", "archivedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_id_idx" ON "Notification"("type", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SystemJobRun_jobType_status_createdAt_id_idx" ON "SystemJobRun"("jobType", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SystemJobRun_status_createdAt_id_idx" ON "SystemJobRun"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SystemJobRun_correlationId_idx" ON "SystemJobRun"("correlationId");

-- AddForeignKey
ALTER TABLE "AreaPpmAssignment" ADD CONSTRAINT "AreaPpmAssignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "ProductionArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaPpmAssignment" ADD CONSTRAINT "AreaPpmAssignment_ppmFormId_fkey" FOREIGN KEY ("ppmFormId") REFERENCES "PpmForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAreaAssignment" ADD CONSTRAINT "UserAreaAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAreaAssignment" ADD CONSTRAINT "UserAreaAssignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "ProductionArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelPpmAssignment" ADD CONSTRAINT "PersonnelPpmAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelPpmAssignment" ADD CONSTRAINT "PersonnelPpmAssignment_ppmFormId_fkey" FOREIGN KEY ("ppmFormId") REFERENCES "PpmForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTemplateVersion" ADD CONSTRAINT "PpmTemplateVersion_ppmFormId_fkey" FOREIGN KEY ("ppmFormId") REFERENCES "PpmForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmRecord" ADD CONSTRAINT "PpmRecord_areaPpmAssignmentId_fkey" FOREIGN KEY ("areaPpmAssignmentId") REFERENCES "AreaPpmAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmRecord" ADD CONSTRAINT "PpmRecord_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "PpmTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmRecord" ADD CONSTRAINT "PpmRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmRecordRevision" ADD CONSTRAINT "PpmRecordRevision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PpmRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmRecordRevision" ADD CONSTRAINT "PpmRecordRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionChange" ADD CONSTRAINT "RevisionChange_oldRevisionId_fkey" FOREIGN KEY ("oldRevisionId") REFERENCES "PpmRecordRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionChange" ADD CONSTRAINT "RevisionChange_newRevisionId_fkey" FOREIGN KEY ("newRevisionId") REFERENCES "PpmRecordRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceCodeRule" ADD CONSTRAINT "TraceCodeRule_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "PpmTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSequence" ADD CONSTRAINT "CodeSequence_codeRuleId_fkey" FOREIGN KEY ("codeRuleId") REFERENCES "TraceCodeRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceConnection" ADD CONSTRAINT "PpmTraceConnection_sourcePpmFormId_fkey" FOREIGN KEY ("sourcePpmFormId") REFERENCES "PpmForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceConnection" ADD CONSTRAINT "PpmTraceConnection_targetPpmFormId_fkey" FOREIGN KEY ("targetPpmFormId") REFERENCES "PpmForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceOutput" ADD CONSTRAINT "PpmTraceOutput_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PpmRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceOutput" ADD CONSTRAINT "PpmTraceOutput_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PpmRecordRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceOutput" ADD CONSTRAINT "PpmTraceOutput_codeRuleId_fkey" FOREIGN KEY ("codeRuleId") REFERENCES "TraceCodeRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceOutput" ADD CONSTRAINT "PpmTraceOutput_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceLink" ADD CONSTRAINT "PpmTraceLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PpmTraceConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceLink" ADD CONSTRAINT "PpmTraceLink_sourceTraceOutputId_fkey" FOREIGN KEY ("sourceTraceOutputId") REFERENCES "PpmTraceOutput"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceLink" ADD CONSTRAINT "PpmTraceLink_downstreamRevisionId_fkey" FOREIGN KEY ("downstreamRevisionId") REFERENCES "PpmRecordRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpmTraceLink" ADD CONSTRAINT "PpmTraceLink_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PpmRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PpmRecordRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceRevalidation" ADD CONSTRAINT "TraceRevalidation_triggerRevisionId_fkey" FOREIGN KEY ("triggerRevisionId") REFERENCES "PpmRecordRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceRevalidation" ADD CONSTRAINT "TraceRevalidation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceRevalidationItem" ADD CONSTRAINT "TraceRevalidationItem_revalidationId_fkey" FOREIGN KEY ("revalidationId") REFERENCES "TraceRevalidation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceRevalidationItem" ADD CONSTRAINT "TraceRevalidationItem_traceLinkId_fkey" FOREIGN KEY ("traceLinkId") REFERENCES "PpmTraceLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PpmRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDevice" ADD CONSTRAINT "ClientDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncMutationReceipt" ADD CONSTRAINT "SyncMutationReceipt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncMutationReceipt" ADD CONSTRAINT "SyncMutationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncMutationReceipt" ADD CONSTRAINT "SyncMutationReceipt_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PpmRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_mutationReceiptId_fkey" FOREIGN KEY ("mutationReceiptId") REFERENCES "SyncMutationReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PpmRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemJobRun" ADD CONSTRAINT "SystemJobRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
