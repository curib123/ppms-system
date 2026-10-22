--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AccountStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccountStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'LOCKED'
);


--
-- Name: ActivationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ActivationStatus" AS ENUM (
    'ACTIVE',
    'RESERVED',
    'PENDING_VALIDATION',
    'DISABLED'
);


--
-- Name: AppearanceMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AppearanceMode" AS ENUM (
    'SYSTEM',
    'LIGHT',
    'DARK'
);


--
-- Name: AreaStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AreaStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


--
-- Name: AuditAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuditAction" AS ENUM (
    'LOGIN',
    'LOGIN_FAILED',
    'LOGOUT',
    'SESSION_REVOKED',
    'CREATE',
    'UPDATE',
    'ARCHIVE',
    'SUBMIT',
    'PUBLISH_CODE',
    'SELECT_UPSTREAM_CODE',
    'CREATE_TRACE_LINK',
    'CORRECT_REVISION',
    'APPROVE',
    'RETURN',
    'CLOSE',
    'CONFIG_CHANGE',
    'SETTINGS_CHANGE',
    'THEME_CHANGE',
    'RETENTION_RUN',
    'BACKUP_CREATED',
    'RESTORE_STARTED',
    'RESTORE_COMPLETED',
    'RESTORE_FAILED',
    'PERMISSION_CHANGE',
    'REVALIDATION_CREATED',
    'REVALIDATION_RESOLVED',
    'DEVICE_REGISTERED',
    'DEVICE_REVOKED',
    'SYNC_APPLIED',
    'SYNC_REJECTED',
    'SYNC_CONFLICT_CREATED',
    'SYNC_CONFLICT_RESOLVED',
    'LOGIN_LOCKED',
    'PASSWORD_CHANGED',
    'SESSION_ROTATED',
    'BACKUP_FAILED'
);


--
-- Name: CodeResetPeriod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CodeResetPeriod" AS ENUM (
    'NONE',
    'DAILY',
    'MONTHLY',
    'YEARLY'
);


--
-- Name: NotificationSeverity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationSeverity" AS ENUM (
    'INFO',
    'SUCCESS',
    'WARNING',
    'ERROR',
    'CRITICAL'
);


--
-- Name: NotificationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationType" AS ENUM (
    'WORKFLOW',
    'CORRECTION',
    'REVALIDATION',
    'SYSTEM',
    'SECURITY',
    'BACKUP',
    'SYNC'
);


--
-- Name: PpmRecordStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PpmRecordStatus" AS ENUM (
    'ACTIVE',
    'SUBMITTED',
    'FSQA_APPROVED',
    'SUPERVISOR_APPROVED',
    'RETURNED_TO_FSQA',
    'CLOSED'
);


--
-- Name: PpmStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PpmStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'RESERVED'
);


--
-- Name: RevalidationItemStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RevalidationItemStatus" AS ENUM (
    'OPEN',
    'REVIEWED',
    'RESOLVED'
);


--
-- Name: RevalidationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RevalidationStatus" AS ENUM (
    'OPEN',
    'RESOLVED'
);


--
-- Name: ReviewStep; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ReviewStep" AS ENUM (
    'FSQA_REVIEW',
    'SUPERVISOR_REVIEW',
    'PLANT_MANAGER_REVIEW'
);


--
-- Name: RevisionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RevisionStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'CORRECTED',
    'APPROVED',
    'SUPERSEDED',
    'CLOSED'
);


--
-- Name: SyncConflictStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncConflictStatus" AS ENUM (
    'OPEN',
    'RESOLVED',
    'DISMISSED'
);


--
-- Name: SyncMutationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncMutationStatus" AS ENUM (
    'APPLIED',
    'DUPLICATE',
    'CONFLICT',
    'REJECTED'
);


--
-- Name: SyncOperationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncOperationType" AS ENUM (
    'CREATE_DRAFT',
    'UPDATE_DRAFT',
    'QUEUE_SUBMIT',
    'LOCAL_TOMBSTONE',
    'ATTACHMENT_UPLOAD_COMPLETE',
    'CONFLICT_RESOLUTION'
);


--
-- Name: SyncResolutionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncResolutionType" AS ENUM (
    'KEEP_SERVER',
    'APPLY_LOCAL_AS_NEW_REVISION',
    'MANUAL_MERGE'
);


--
-- Name: SystemJobStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SystemJobStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: SystemJobType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SystemJobType" AS ENUM (
    'BACKUP',
    'RESTORE',
    'RETENTION_ARCHIVE',
    'CACHE_MAINTENANCE'
);


--
-- Name: TraceCodeSourceType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TraceCodeSourceType" AS ENUM (
    'SYSTEM_GENERATED',
    'UPSTREAM_LOOKUP',
    'MANUAL_EXTERNAL',
    'SCAN_EXTERNAL',
    'PENDING_RULE'
);


--
-- Name: TraceOutputStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TraceOutputStatus" AS ENUM (
    'PUBLISHED',
    'LINKED_DOWNSTREAM',
    'SUPERSEDED',
    'DISABLED'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'ADMIN',
    'PERSONNEL',
    'FSQA',
    'SUPERVISOR',
    'PLANT_MANAGER'
);


--
-- Name: WorkflowActionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."WorkflowActionType" AS ENUM (
    'CREATE_RECORD',
    'SUBMIT',
    'CORRECT',
    'APPROVE',
    'RETURN',
    'CLOSE'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AreaPpmAssignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AreaPpmAssignment" (
    id text NOT NULL,
    "areaId" text NOT NULL,
    "ppmFormId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "effectiveFrom" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "effectiveTo" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "actorId" text,
    "recordId" text,
    action public."AuditAction" NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text,
    message text NOT NULL,
    "beforeJson" jsonb,
    "afterJson" jsonb,
    "ipAddress" text,
    "userAgent" text,
    "correlationId" text,
    "clientDeviceId" text,
    "clientMutationId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AuthLoginDefense; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuthLoginDefense" (
    id text NOT NULL,
    "identifierHash" text NOT NULL,
    "failureCount" integer DEFAULT 0 NOT NULL,
    "lastFailedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lockedUntil" timestamp(3) without time zone
);


--
-- Name: AuthSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuthSession" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "refreshTokenHash" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "idleExpiresAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone,
    "ipAddress" text,
    "userAgent" text,
    "rotatedAt" timestamp(3) without time zone
);


--
-- Name: ClientDevice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ClientDevice" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "deviceUuid" text NOT NULL,
    "displayName" text,
    platform text,
    "registeredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "offlineAccessIssuedAt" timestamp(3) without time zone,
    "offlineAccessExpiresAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone
);


--
-- Name: CodeSequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CodeSequence" (
    id text NOT NULL,
    "codeRuleId" text NOT NULL,
    "periodKey" text NOT NULL,
    "currentValue" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Notification" (
    id text NOT NULL,
    "recipientId" text NOT NULL,
    type public."NotificationType" NOT NULL,
    severity public."NotificationSeverity" DEFAULT 'INFO'::public."NotificationSeverity" NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    "entityType" text,
    "entityId" text,
    "dedupeKey" text,
    "readAt" timestamp(3) without time zone,
    "archivedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Notification_message_not_blank_check" CHECK ((length(btrim(message)) > 0)),
    CONSTRAINT "Notification_title_not_blank_check" CHECK ((length(btrim(title)) > 0))
);


--
-- Name: PersonnelPpmAssignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PersonnelPpmAssignment" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "ppmFormId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PpmForm; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmForm" (
    id text NOT NULL,
    "ppmCode" text NOT NULL,
    title text NOT NULL,
    status public."PpmStatus" DEFAULT 'ACTIVE'::public."PpmStatus" NOT NULL,
    "sortOrder" integer,
    description text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PpmRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmRecord" (
    id text NOT NULL,
    "areaPpmAssignmentId" text NOT NULL,
    "templateVersionId" text NOT NULL,
    "recordCode" text,
    "productionDate" timestamp(3) without time zone NOT NULL,
    "shiftCode" text,
    "batchNo" text,
    "lotNo" text,
    status public."PpmRecordStatus" DEFAULT 'ACTIVE'::public."PpmRecordStatus" NOT NULL,
    "currentRevisionNo" integer DEFAULT 1 NOT NULL,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "submittedAt" timestamp(3) without time zone,
    "closedAt" timestamp(3) without time zone,
    "archivedAt" timestamp(3) without time zone,
    "dailyKey" text
);


--
-- Name: PpmRecordRevision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmRecordRevision" (
    id text NOT NULL,
    "recordId" text NOT NULL,
    "revisionNo" integer NOT NULL,
    status public."RevisionStatus" DEFAULT 'DRAFT'::public."RevisionStatus" NOT NULL,
    "dataJson" jsonb NOT NULL,
    "dataHash" text,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "submittedAt" timestamp(3) without time zone,
    "approvedAt" timestamp(3) without time zone,
    "correctionReason" text,
    "impactCheckJson" jsonb,
    "isTraceCritical" boolean DEFAULT false NOT NULL
);


--
-- Name: PpmTemplateVersion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmTemplateVersion" (
    id text NOT NULL,
    "ppmFormId" text NOT NULL,
    "versionNo" integer NOT NULL,
    "versionLabel" text,
    "effectiveFrom" timestamp(3) without time zone,
    "effectiveTo" timestamp(3) without time zone,
    "isActive" boolean DEFAULT false NOT NULL,
    "publishedAt" timestamp(3) without time zone,
    "sourceFileName" text,
    "sourceFileHash" text,
    "definitionJson" jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "documentNumber" text,
    "revisionNumber" text,
    "seriesNumber" text,
    "pageNumber" text
);


--
-- Name: PpmTraceConnection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmTraceConnection" (
    id text NOT NULL,
    "sourcePpmFormId" text NOT NULL,
    "sourceOutputKey" text NOT NULL,
    "targetPpmFormId" text NOT NULL,
    "targetInputKey" text NOT NULL,
    "connectionName" text NOT NULL,
    status public."ActivationStatus" DEFAULT 'PENDING_VALIDATION'::public."ActivationStatus" NOT NULL,
    "requiresApprovalBeforeUse" boolean DEFAULT false NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PpmTraceLink; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmTraceLink" (
    id text NOT NULL,
    "connectionId" text NOT NULL,
    "sourceTraceOutputId" text NOT NULL,
    "downstreamRevisionId" text NOT NULL,
    "downstreamInputKey" text NOT NULL,
    "selectedById" text NOT NULL,
    "selectedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    notes text
);


--
-- Name: PpmTraceOutput; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PpmTraceOutput" (
    id text NOT NULL,
    "recordId" text NOT NULL,
    "revisionId" text NOT NULL,
    "codeRuleId" text,
    "outputKey" text NOT NULL,
    "outputCode" text NOT NULL,
    "outputType" text,
    quantity numeric(18,6),
    unit text,
    status public."TraceOutputStatus" DEFAULT 'PUBLISHED'::public."TraceOutputStatus" NOT NULL,
    "createdById" text NOT NULL,
    "publishedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "sourceSnapshotJson" jsonb,
    "sourcePath" text DEFAULT '$'::text NOT NULL
);


--
-- Name: ProductionArea; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProductionArea" (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    status public."AreaStatus" DEFAULT 'ACTIVE'::public."AreaStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: RevisionChange; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RevisionChange" (
    id text NOT NULL,
    "oldRevisionId" text,
    "newRevisionId" text NOT NULL,
    "fieldPath" text NOT NULL,
    "beforeValueJson" jsonb,
    "afterValueJson" jsonb,
    reason text NOT NULL,
    "isTraceCritical" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SyncConflict; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SyncConflict" (
    id text NOT NULL,
    "mutationReceiptId" text NOT NULL,
    "recordId" text NOT NULL,
    "baseRevisionNo" integer NOT NULL,
    "serverRevisionNo" integer NOT NULL,
    "localPatchJson" jsonb NOT NULL,
    "localPayloadHash" text,
    "changedPathsJson" jsonb,
    "isTraceCritical" boolean DEFAULT false NOT NULL,
    status public."SyncConflictStatus" DEFAULT 'OPEN'::public."SyncConflictStatus" NOT NULL,
    "resolutionType" public."SyncResolutionType",
    "resolutionJson" jsonb,
    "resolvedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone
);


--
-- Name: SyncMutationReceipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SyncMutationReceipt" (
    id text NOT NULL,
    "clientMutationId" text NOT NULL,
    "deviceId" text NOT NULL,
    "userId" text NOT NULL,
    "recordId" text,
    "operationType" public."SyncOperationType" NOT NULL,
    "baseRevisionNo" integer,
    "resultRevisionNo" integer,
    status public."SyncMutationStatus" NOT NULL,
    "payloadHash" text,
    "resultJson" jsonb,
    "correlationId" text,
    "receivedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "appliedAt" timestamp(3) without time zone
);


--
-- Name: SystemJobRun; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SystemJobRun" (
    id text NOT NULL,
    "jobType" public."SystemJobType" NOT NULL,
    status public."SystemJobStatus" DEFAULT 'QUEUED'::public."SystemJobStatus" NOT NULL,
    "requestedById" text,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "artifactName" text,
    "artifactChecksum" text,
    "correlationId" text,
    "detailsJson" jsonb,
    "errorCode" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "SystemJobRun_checksum_format_check" CHECK ((("artifactChecksum" IS NULL) OR ("artifactChecksum" ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT "SystemJobRun_completion_order_check" CHECK ((("completedAt" IS NULL) OR ("startedAt" IS NULL) OR ("completedAt" >= "startedAt")))
);


--
-- Name: SystemSetting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SystemSetting" (
    id text NOT NULL,
    key text NOT NULL,
    "valueJson" jsonb NOT NULL,
    "valueType" text NOT NULL,
    description text,
    "isSensitive" boolean DEFAULT false NOT NULL,
    "updatedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "SystemSetting_key_not_blank_check" CHECK ((length(btrim(key)) > 0)),
    CONSTRAINT "SystemSetting_valueType_check" CHECK (("valueType" = ANY (ARRAY['BOOLEAN'::text, 'INTEGER'::text, 'STRING'::text, 'JSON'::text])))
);


--
-- Name: TraceCodeRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TraceCodeRule" (
    id text NOT NULL,
    "templateVersionId" text NOT NULL,
    "outputKey" text NOT NULL,
    "outputLabel" text NOT NULL,
    status public."ActivationStatus" DEFAULT 'PENDING_VALIDATION'::public."ActivationStatus" NOT NULL,
    "sourceType" public."TraceCodeSourceType" NOT NULL,
    "formulaTemplate" text,
    "resetPeriod" public."CodeResetPeriod" DEFAULT 'NONE'::public."CodeResetPeriod" NOT NULL,
    "sequencePadding" integer,
    "requiresUniqueBusinessCode" boolean DEFAULT false NOT NULL,
    "configurationJson" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TraceRevalidation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TraceRevalidation" (
    id text NOT NULL,
    "triggerRevisionId" text NOT NULL,
    reason text NOT NULL,
    status public."RevalidationStatus" DEFAULT 'OPEN'::public."RevalidationStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    "resolvedById" text,
    "resolutionNotes" text
);


--
-- Name: TraceRevalidationItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TraceRevalidationItem" (
    id text NOT NULL,
    "revalidationId" text NOT NULL,
    "traceLinkId" text NOT NULL,
    status public."RevalidationItemStatus" DEFAULT 'OPEN'::public."RevalidationItemStatus" NOT NULL,
    notes text,
    "resolvedAt" timestamp(3) without time zone
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    "employeeNo" text,
    email text NOT NULL,
    username text NOT NULL,
    "displayName" text NOT NULL,
    "passwordHash" text NOT NULL,
    role public."UserRole" NOT NULL,
    "accountStatus" public."AccountStatus" DEFAULT 'ACTIVE'::public."AccountStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: UserAreaAssignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserAreaAssignment" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "areaId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: UserPreference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserPreference" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "appearanceMode" public."AppearanceMode" DEFAULT 'SYSTEM'::public."AppearanceMode" NOT NULL,
    "listViewMode" text DEFAULT 'TABLE'::text NOT NULL,
    "preferencesJson" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "UserPreference_listViewMode_check" CHECK (("listViewMode" = ANY (ARRAY['TABLE'::text, 'CARDS'::text])))
);


--
-- Name: WorkflowEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WorkflowEvent" (
    id text NOT NULL,
    "recordId" text NOT NULL,
    "revisionId" text,
    step public."ReviewStep",
    action public."WorkflowActionType" NOT NULL,
    "actorId" text NOT NULL,
    reason text,
    comments text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AreaPpmAssignment AreaPpmAssignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AreaPpmAssignment"
    ADD CONSTRAINT "AreaPpmAssignment_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: AuthLoginDefense AuthLoginDefense_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuthLoginDefense"
    ADD CONSTRAINT "AuthLoginDefense_pkey" PRIMARY KEY (id);


--
-- Name: AuthSession AuthSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuthSession"
    ADD CONSTRAINT "AuthSession_pkey" PRIMARY KEY (id);


--
-- Name: ClientDevice ClientDevice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ClientDevice"
    ADD CONSTRAINT "ClientDevice_pkey" PRIMARY KEY (id);


--
-- Name: CodeSequence CodeSequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CodeSequence"
    ADD CONSTRAINT "CodeSequence_pkey" PRIMARY KEY (id);


--
-- Name: Notification Notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id);


--
-- Name: PersonnelPpmAssignment PersonnelPpmAssignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PersonnelPpmAssignment"
    ADD CONSTRAINT "PersonnelPpmAssignment_pkey" PRIMARY KEY (id);


--
-- Name: PpmForm PpmForm_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmForm"
    ADD CONSTRAINT "PpmForm_pkey" PRIMARY KEY (id);


--
-- Name: PpmRecordRevision PpmRecordRevision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecordRevision"
    ADD CONSTRAINT "PpmRecordRevision_pkey" PRIMARY KEY (id);


--
-- Name: PpmRecord PpmRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecord"
    ADD CONSTRAINT "PpmRecord_pkey" PRIMARY KEY (id);


--
-- Name: PpmTemplateVersion PpmTemplateVersion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTemplateVersion"
    ADD CONSTRAINT "PpmTemplateVersion_pkey" PRIMARY KEY (id);


--
-- Name: PpmTraceConnection PpmTraceConnection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceConnection"
    ADD CONSTRAINT "PpmTraceConnection_pkey" PRIMARY KEY (id);


--
-- Name: PpmTraceLink PpmTraceLink_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceLink"
    ADD CONSTRAINT "PpmTraceLink_pkey" PRIMARY KEY (id);


--
-- Name: PpmTraceOutput PpmTraceOutput_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceOutput"
    ADD CONSTRAINT "PpmTraceOutput_pkey" PRIMARY KEY (id);


--
-- Name: ProductionArea ProductionArea_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductionArea"
    ADD CONSTRAINT "ProductionArea_pkey" PRIMARY KEY (id);


--
-- Name: RevisionChange RevisionChange_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RevisionChange"
    ADD CONSTRAINT "RevisionChange_pkey" PRIMARY KEY (id);


--
-- Name: SyncConflict SyncConflict_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncConflict"
    ADD CONSTRAINT "SyncConflict_pkey" PRIMARY KEY (id);


--
-- Name: SyncMutationReceipt SyncMutationReceipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncMutationReceipt"
    ADD CONSTRAINT "SyncMutationReceipt_pkey" PRIMARY KEY (id);


--
-- Name: SystemJobRun SystemJobRun_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemJobRun"
    ADD CONSTRAINT "SystemJobRun_pkey" PRIMARY KEY (id);


--
-- Name: SystemSetting SystemSetting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemSetting"
    ADD CONSTRAINT "SystemSetting_pkey" PRIMARY KEY (id);


--
-- Name: TraceCodeRule TraceCodeRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceCodeRule"
    ADD CONSTRAINT "TraceCodeRule_pkey" PRIMARY KEY (id);


--
-- Name: TraceRevalidationItem TraceRevalidationItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceRevalidationItem"
    ADD CONSTRAINT "TraceRevalidationItem_pkey" PRIMARY KEY (id);


--
-- Name: TraceRevalidation TraceRevalidation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceRevalidation"
    ADD CONSTRAINT "TraceRevalidation_pkey" PRIMARY KEY (id);


--
-- Name: UserAreaAssignment UserAreaAssignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserAreaAssignment"
    ADD CONSTRAINT "UserAreaAssignment_pkey" PRIMARY KEY (id);


--
-- Name: UserPreference UserPreference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserPreference"
    ADD CONSTRAINT "UserPreference_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: WorkflowEvent WorkflowEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkflowEvent"
    ADD CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY (id);


--
-- Name: AreaPpmAssignment_areaId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AreaPpmAssignment_areaId_isActive_idx" ON public."AreaPpmAssignment" USING btree ("areaId", "isActive");


--
-- Name: AreaPpmAssignment_ppmFormId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AreaPpmAssignment_ppmFormId_isActive_idx" ON public."AreaPpmAssignment" USING btree ("ppmFormId", "isActive");


--
-- Name: AuditLog_action_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_action_createdAt_id_idx" ON public."AuditLog" USING btree (action, "createdAt", id);


--
-- Name: AuditLog_actorId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_actorId_createdAt_id_idx" ON public."AuditLog" USING btree ("actorId", "createdAt", id);


--
-- Name: AuditLog_clientDeviceId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_clientDeviceId_createdAt_id_idx" ON public."AuditLog" USING btree ("clientDeviceId", "createdAt", id);


--
-- Name: AuditLog_clientMutationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_clientMutationId_idx" ON public."AuditLog" USING btree ("clientMutationId");


--
-- Name: AuditLog_correlationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_correlationId_idx" ON public."AuditLog" USING btree ("correlationId");


--
-- Name: AuditLog_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_createdAt_id_idx" ON public."AuditLog" USING btree ("createdAt", id);


--
-- Name: AuditLog_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_entityType_entityId_idx" ON public."AuditLog" USING btree ("entityType", "entityId");


--
-- Name: AuditLog_recordId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_recordId_createdAt_id_idx" ON public."AuditLog" USING btree ("recordId", "createdAt", id);


--
-- Name: AuthLoginDefense_identifierHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuthLoginDefense_identifierHash_key" ON public."AuthLoginDefense" USING btree ("identifierHash");


--
-- Name: AuthLoginDefense_lastFailedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuthLoginDefense_lastFailedAt_idx" ON public."AuthLoginDefense" USING btree ("lastFailedAt");


--
-- Name: AuthLoginDefense_lockedUntil_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuthLoginDefense_lockedUntil_idx" ON public."AuthLoginDefense" USING btree ("lockedUntil");


--
-- Name: AuthSession_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuthSession_expiresAt_idx" ON public."AuthSession" USING btree ("expiresAt");


--
-- Name: AuthSession_refreshTokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON public."AuthSession" USING btree ("refreshTokenHash");


--
-- Name: AuthSession_userId_revokedAt_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON public."AuthSession" USING btree ("userId", "revokedAt", "expiresAt");


--
-- Name: ClientDevice_offlineAccessExpiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ClientDevice_offlineAccessExpiresAt_idx" ON public."ClientDevice" USING btree ("offlineAccessExpiresAt");


--
-- Name: ClientDevice_userId_deviceUuid_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ClientDevice_userId_deviceUuid_key" ON public."ClientDevice" USING btree ("userId", "deviceUuid");


--
-- Name: ClientDevice_userId_revokedAt_lastSeenAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ClientDevice_userId_revokedAt_lastSeenAt_idx" ON public."ClientDevice" USING btree ("userId", "revokedAt", "lastSeenAt");


--
-- Name: CodeSequence_codeRuleId_periodKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CodeSequence_codeRuleId_periodKey_key" ON public."CodeSequence" USING btree ("codeRuleId", "periodKey");


--
-- Name: Notification_dedupeKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON public."Notification" USING btree ("dedupeKey");


--
-- Name: Notification_recipientId_archivedAt_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_recipientId_archivedAt_createdAt_id_idx" ON public."Notification" USING btree ("recipientId", "archivedAt", "createdAt", id);


--
-- Name: Notification_recipientId_readAt_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_recipientId_readAt_createdAt_id_idx" ON public."Notification" USING btree ("recipientId", "readAt", "createdAt", id);


--
-- Name: Notification_type_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_type_createdAt_id_idx" ON public."Notification" USING btree (type, "createdAt", id);


--
-- Name: PersonnelPpmAssignment_ppmFormId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PersonnelPpmAssignment_ppmFormId_isActive_idx" ON public."PersonnelPpmAssignment" USING btree ("ppmFormId", "isActive");


--
-- Name: PersonnelPpmAssignment_userId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PersonnelPpmAssignment_userId_isActive_idx" ON public."PersonnelPpmAssignment" USING btree ("userId", "isActive");


--
-- Name: PersonnelPpmAssignment_userId_ppmFormId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PersonnelPpmAssignment_userId_ppmFormId_key" ON public."PersonnelPpmAssignment" USING btree ("userId", "ppmFormId");


--
-- Name: PpmForm_ppmCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmForm_ppmCode_key" ON public."PpmForm" USING btree ("ppmCode");


--
-- Name: PpmForm_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmForm_status_idx" ON public."PpmForm" USING btree (status);


--
-- Name: PpmRecordRevision_createdById_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecordRevision_createdById_idx" ON public."PpmRecordRevision" USING btree ("createdById");


--
-- Name: PpmRecordRevision_recordId_revisionNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmRecordRevision_recordId_revisionNo_key" ON public."PpmRecordRevision" USING btree ("recordId", "revisionNo");


--
-- Name: PpmRecordRevision_recordId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecordRevision_recordId_status_idx" ON public."PpmRecordRevision" USING btree ("recordId", status);


--
-- Name: PpmRecord_archivedAt_closedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_archivedAt_closedAt_id_idx" ON public."PpmRecord" USING btree ("archivedAt", "closedAt", id);


--
-- Name: PpmRecord_areaPpmAssignmentId_productionDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_areaPpmAssignmentId_productionDate_idx" ON public."PpmRecord" USING btree ("areaPpmAssignmentId", "productionDate");


--
-- Name: PpmRecord_areaPpmAssignmentId_status_productionDate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_areaPpmAssignmentId_status_productionDate_id_idx" ON public."PpmRecord" USING btree ("areaPpmAssignmentId", status, "productionDate", id);


--
-- Name: PpmRecord_batchNo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_batchNo_idx" ON public."PpmRecord" USING btree ("batchNo");


--
-- Name: PpmRecord_createdById_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_createdById_status_createdAt_id_idx" ON public."PpmRecord" USING btree ("createdById", status, "createdAt", id);


--
-- Name: PpmRecord_dailyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmRecord_dailyKey_key" ON public."PpmRecord" USING btree ("dailyKey");


--
-- Name: PpmRecord_lotNo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_lotNo_idx" ON public."PpmRecord" USING btree ("lotNo");


--
-- Name: PpmRecord_productionDate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_productionDate_id_idx" ON public."PpmRecord" USING btree ("productionDate", id);


--
-- Name: PpmRecord_recordCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmRecord_recordCode_key" ON public."PpmRecord" USING btree ("recordCode");


--
-- Name: PpmRecord_retention_eligible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_retention_eligible_idx" ON public."PpmRecord" USING btree ("closedAt", id) WHERE ((status = 'CLOSED'::public."PpmRecordStatus") AND ("archivedAt" IS NULL));


--
-- Name: PpmRecord_status_productionDate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_status_productionDate_id_idx" ON public."PpmRecord" USING btree (status, "productionDate", id);


--
-- Name: PpmRecord_templateVersionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_templateVersionId_idx" ON public."PpmRecord" USING btree ("templateVersionId");


--
-- Name: PpmRecord_updatedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmRecord_updatedAt_id_idx" ON public."PpmRecord" USING btree ("updatedAt", id);


--
-- Name: PpmTemplateVersion_effectiveFrom_effectiveTo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTemplateVersion_effectiveFrom_effectiveTo_idx" ON public."PpmTemplateVersion" USING btree ("effectiveFrom", "effectiveTo");


--
-- Name: PpmTemplateVersion_ppmFormId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTemplateVersion_ppmFormId_isActive_idx" ON public."PpmTemplateVersion" USING btree ("ppmFormId", "isActive");


--
-- Name: PpmTemplateVersion_ppmFormId_versionNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmTemplateVersion_ppmFormId_versionNo_key" ON public."PpmTemplateVersion" USING btree ("ppmFormId", "versionNo");


--
-- Name: PpmTraceConnection_sourcePpmFormId_sourceOutputKey_targetPp_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmTraceConnection_sourcePpmFormId_sourceOutputKey_targetPp_key" ON public."PpmTraceConnection" USING btree ("sourcePpmFormId", "sourceOutputKey", "targetPpmFormId", "targetInputKey");


--
-- Name: PpmTraceConnection_sourcePpmFormId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceConnection_sourcePpmFormId_status_idx" ON public."PpmTraceConnection" USING btree ("sourcePpmFormId", status);


--
-- Name: PpmTraceConnection_status_updatedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceConnection_status_updatedAt_id_idx" ON public."PpmTraceConnection" USING btree (status, "updatedAt", id);


--
-- Name: PpmTraceConnection_targetPpmFormId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceConnection_targetPpmFormId_status_idx" ON public."PpmTraceConnection" USING btree ("targetPpmFormId", status);


--
-- Name: PpmTraceConnection_targetPpmFormId_targetInputKey_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceConnection_targetPpmFormId_targetInputKey_status_idx" ON public."PpmTraceConnection" USING btree ("targetPpmFormId", "targetInputKey", status);


--
-- Name: PpmTraceLink_connectionId_isActive_selectedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceLink_connectionId_isActive_selectedAt_id_idx" ON public."PpmTraceLink" USING btree ("connectionId", "isActive", "selectedAt", id);


--
-- Name: PpmTraceLink_connectionId_sourceTraceOutputId_downstreamRev_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmTraceLink_connectionId_sourceTraceOutputId_downstreamRev_key" ON public."PpmTraceLink" USING btree ("connectionId", "sourceTraceOutputId", "downstreamRevisionId", "downstreamInputKey");


--
-- Name: PpmTraceLink_downstreamRevisionId_selectedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceLink_downstreamRevisionId_selectedAt_id_idx" ON public."PpmTraceLink" USING btree ("downstreamRevisionId", "selectedAt", id);


--
-- Name: PpmTraceLink_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceLink_isActive_idx" ON public."PpmTraceLink" USING btree ("isActive");


--
-- Name: PpmTraceLink_sourceTraceOutputId_selectedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceLink_sourceTraceOutputId_selectedAt_id_idx" ON public."PpmTraceLink" USING btree ("sourceTraceOutputId", "selectedAt", id);


--
-- Name: PpmTraceOutput_outputCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceOutput_outputCode_idx" ON public."PpmTraceOutput" USING btree ("outputCode");


--
-- Name: PpmTraceOutput_outputKey_outputCode_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceOutput_outputKey_outputCode_status_idx" ON public."PpmTraceOutput" USING btree ("outputKey", "outputCode", status);


--
-- Name: PpmTraceOutput_recordId_publishedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceOutput_recordId_publishedAt_id_idx" ON public."PpmTraceOutput" USING btree ("recordId", "publishedAt", id);


--
-- Name: PpmTraceOutput_revisionId_outputKey_sourcePath_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PpmTraceOutput_revisionId_outputKey_sourcePath_key" ON public."PpmTraceOutput" USING btree ("revisionId", "outputKey", "sourcePath");


--
-- Name: PpmTraceOutput_status_publishedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PpmTraceOutput_status_publishedAt_id_idx" ON public."PpmTraceOutput" USING btree (status, "publishedAt", id);


--
-- Name: ProductionArea_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ProductionArea_code_key" ON public."ProductionArea" USING btree (code);


--
-- Name: ProductionArea_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductionArea_status_idx" ON public."ProductionArea" USING btree (status);


--
-- Name: RevisionChange_isTraceCritical_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RevisionChange_isTraceCritical_idx" ON public."RevisionChange" USING btree ("isTraceCritical");


--
-- Name: RevisionChange_newRevisionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RevisionChange_newRevisionId_idx" ON public."RevisionChange" USING btree ("newRevisionId");


--
-- Name: SyncConflict_mutationReceiptId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SyncConflict_mutationReceiptId_key" ON public."SyncConflict" USING btree ("mutationReceiptId");


--
-- Name: SyncConflict_recordId_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncConflict_recordId_status_createdAt_id_idx" ON public."SyncConflict" USING btree ("recordId", status, "createdAt", id);


--
-- Name: SyncConflict_resolvedById_resolvedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncConflict_resolvedById_resolvedAt_idx" ON public."SyncConflict" USING btree ("resolvedById", "resolvedAt");


--
-- Name: SyncConflict_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncConflict_status_createdAt_id_idx" ON public."SyncConflict" USING btree (status, "createdAt", id);


--
-- Name: SyncMutationReceipt_clientMutationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SyncMutationReceipt_clientMutationId_key" ON public."SyncMutationReceipt" USING btree ("clientMutationId");


--
-- Name: SyncMutationReceipt_correlationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncMutationReceipt_correlationId_idx" ON public."SyncMutationReceipt" USING btree ("correlationId");


--
-- Name: SyncMutationReceipt_deviceId_receivedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncMutationReceipt_deviceId_receivedAt_id_idx" ON public."SyncMutationReceipt" USING btree ("deviceId", "receivedAt", id);


--
-- Name: SyncMutationReceipt_recordId_receivedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncMutationReceipt_recordId_receivedAt_id_idx" ON public."SyncMutationReceipt" USING btree ("recordId", "receivedAt", id);


--
-- Name: SyncMutationReceipt_status_receivedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncMutationReceipt_status_receivedAt_id_idx" ON public."SyncMutationReceipt" USING btree (status, "receivedAt", id);


--
-- Name: SyncMutationReceipt_userId_receivedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncMutationReceipt_userId_receivedAt_id_idx" ON public."SyncMutationReceipt" USING btree ("userId", "receivedAt", id);


--
-- Name: SystemJobRun_correlationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SystemJobRun_correlationId_idx" ON public."SystemJobRun" USING btree ("correlationId");


--
-- Name: SystemJobRun_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SystemJobRun_history_idx" ON public."SystemJobRun" USING btree ("createdAt" DESC, id DESC);


--
-- Name: SystemJobRun_jobType_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SystemJobRun_jobType_status_createdAt_id_idx" ON public."SystemJobRun" USING btree ("jobType", status, "createdAt", id);


--
-- Name: SystemJobRun_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SystemJobRun_status_createdAt_id_idx" ON public."SystemJobRun" USING btree (status, "createdAt", id);


--
-- Name: SystemSetting_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SystemSetting_key_key" ON public."SystemSetting" USING btree (key);


--
-- Name: SystemSetting_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SystemSetting_updatedAt_idx" ON public."SystemSetting" USING btree ("updatedAt");


--
-- Name: TraceCodeRule_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TraceCodeRule_status_idx" ON public."TraceCodeRule" USING btree (status);


--
-- Name: TraceCodeRule_templateVersionId_outputKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TraceCodeRule_templateVersionId_outputKey_key" ON public."TraceCodeRule" USING btree ("templateVersionId", "outputKey");


--
-- Name: TraceRevalidationItem_revalidationId_traceLinkId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TraceRevalidationItem_revalidationId_traceLinkId_key" ON public."TraceRevalidationItem" USING btree ("revalidationId", "traceLinkId");


--
-- Name: TraceRevalidationItem_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TraceRevalidationItem_status_idx" ON public."TraceRevalidationItem" USING btree (status);


--
-- Name: TraceRevalidation_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TraceRevalidation_status_createdAt_id_idx" ON public."TraceRevalidation" USING btree (status, "createdAt", id);


--
-- Name: TraceRevalidation_triggerRevisionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TraceRevalidation_triggerRevisionId_idx" ON public."TraceRevalidation" USING btree ("triggerRevisionId");


--
-- Name: UserAreaAssignment_areaId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserAreaAssignment_areaId_isActive_idx" ON public."UserAreaAssignment" USING btree ("areaId", "isActive");


--
-- Name: UserAreaAssignment_userId_areaId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserAreaAssignment_userId_areaId_key" ON public."UserAreaAssignment" USING btree ("userId", "areaId");


--
-- Name: UserAreaAssignment_userId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserAreaAssignment_userId_isActive_idx" ON public."UserAreaAssignment" USING btree ("userId", "isActive");


--
-- Name: UserPreference_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserPreference_userId_key" ON public."UserPreference" USING btree ("userId");


--
-- Name: User_accountStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_accountStatus_idx" ON public."User" USING btree ("accountStatus");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_employeeNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_employeeNo_key" ON public."User" USING btree ("employeeNo");


--
-- Name: User_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_role_idx" ON public."User" USING btree (role);


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: WorkflowEvent_actorId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkflowEvent_actorId_createdAt_id_idx" ON public."WorkflowEvent" USING btree ("actorId", "createdAt", id);


--
-- Name: WorkflowEvent_recordId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkflowEvent_recordId_createdAt_id_idx" ON public."WorkflowEvent" USING btree ("recordId", "createdAt", id);


--
-- Name: WorkflowEvent_revisionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkflowEvent_revisionId_idx" ON public."WorkflowEvent" USING btree ("revisionId");


--
-- Name: WorkflowEvent_step_action_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkflowEvent_step_action_createdAt_id_idx" ON public."WorkflowEvent" USING btree (step, action, "createdAt", id);


--
-- Name: AreaPpmAssignment AreaPpmAssignment_areaId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AreaPpmAssignment"
    ADD CONSTRAINT "AreaPpmAssignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES public."ProductionArea"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AreaPpmAssignment AreaPpmAssignment_ppmFormId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AreaPpmAssignment"
    ADD CONSTRAINT "AreaPpmAssignment_ppmFormId_fkey" FOREIGN KEY ("ppmFormId") REFERENCES public."PpmForm"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuditLog AuditLog_actorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AuditLog AuditLog_clientDeviceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES public."ClientDevice"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AuditLog AuditLog_recordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES public."PpmRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AuthSession AuthSession_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuthSession"
    ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ClientDevice ClientDevice_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ClientDevice"
    ADD CONSTRAINT "ClientDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CodeSequence CodeSequence_codeRuleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CodeSequence"
    ADD CONSTRAINT "CodeSequence_codeRuleId_fkey" FOREIGN KEY ("codeRuleId") REFERENCES public."TraceCodeRule"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Notification Notification_recipientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PersonnelPpmAssignment PersonnelPpmAssignment_ppmFormId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PersonnelPpmAssignment"
    ADD CONSTRAINT "PersonnelPpmAssignment_ppmFormId_fkey" FOREIGN KEY ("ppmFormId") REFERENCES public."PpmForm"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PersonnelPpmAssignment PersonnelPpmAssignment_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PersonnelPpmAssignment"
    ADD CONSTRAINT "PersonnelPpmAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmRecordRevision PpmRecordRevision_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecordRevision"
    ADD CONSTRAINT "PpmRecordRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmRecordRevision PpmRecordRevision_recordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecordRevision"
    ADD CONSTRAINT "PpmRecordRevision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES public."PpmRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmRecord PpmRecord_areaPpmAssignmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecord"
    ADD CONSTRAINT "PpmRecord_areaPpmAssignmentId_fkey" FOREIGN KEY ("areaPpmAssignmentId") REFERENCES public."AreaPpmAssignment"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmRecord PpmRecord_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecord"
    ADD CONSTRAINT "PpmRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmRecord PpmRecord_templateVersionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmRecord"
    ADD CONSTRAINT "PpmRecord_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES public."PpmTemplateVersion"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTemplateVersion PpmTemplateVersion_ppmFormId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTemplateVersion"
    ADD CONSTRAINT "PpmTemplateVersion_ppmFormId_fkey" FOREIGN KEY ("ppmFormId") REFERENCES public."PpmForm"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceConnection PpmTraceConnection_sourcePpmFormId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceConnection"
    ADD CONSTRAINT "PpmTraceConnection_sourcePpmFormId_fkey" FOREIGN KEY ("sourcePpmFormId") REFERENCES public."PpmForm"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceConnection PpmTraceConnection_targetPpmFormId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceConnection"
    ADD CONSTRAINT "PpmTraceConnection_targetPpmFormId_fkey" FOREIGN KEY ("targetPpmFormId") REFERENCES public."PpmForm"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceLink PpmTraceLink_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceLink"
    ADD CONSTRAINT "PpmTraceLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."PpmTraceConnection"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceLink PpmTraceLink_downstreamRevisionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceLink"
    ADD CONSTRAINT "PpmTraceLink_downstreamRevisionId_fkey" FOREIGN KEY ("downstreamRevisionId") REFERENCES public."PpmRecordRevision"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceLink PpmTraceLink_selectedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceLink"
    ADD CONSTRAINT "PpmTraceLink_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceLink PpmTraceLink_sourceTraceOutputId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceLink"
    ADD CONSTRAINT "PpmTraceLink_sourceTraceOutputId_fkey" FOREIGN KEY ("sourceTraceOutputId") REFERENCES public."PpmTraceOutput"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceOutput PpmTraceOutput_codeRuleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceOutput"
    ADD CONSTRAINT "PpmTraceOutput_codeRuleId_fkey" FOREIGN KEY ("codeRuleId") REFERENCES public."TraceCodeRule"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PpmTraceOutput PpmTraceOutput_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceOutput"
    ADD CONSTRAINT "PpmTraceOutput_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceOutput PpmTraceOutput_recordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceOutput"
    ADD CONSTRAINT "PpmTraceOutput_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES public."PpmRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PpmTraceOutput PpmTraceOutput_revisionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PpmTraceOutput"
    ADD CONSTRAINT "PpmTraceOutput_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES public."PpmRecordRevision"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RevisionChange RevisionChange_newRevisionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RevisionChange"
    ADD CONSTRAINT "RevisionChange_newRevisionId_fkey" FOREIGN KEY ("newRevisionId") REFERENCES public."PpmRecordRevision"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RevisionChange RevisionChange_oldRevisionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RevisionChange"
    ADD CONSTRAINT "RevisionChange_oldRevisionId_fkey" FOREIGN KEY ("oldRevisionId") REFERENCES public."PpmRecordRevision"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SyncConflict SyncConflict_mutationReceiptId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncConflict"
    ADD CONSTRAINT "SyncConflict_mutationReceiptId_fkey" FOREIGN KEY ("mutationReceiptId") REFERENCES public."SyncMutationReceipt"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SyncConflict SyncConflict_recordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncConflict"
    ADD CONSTRAINT "SyncConflict_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES public."PpmRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SyncConflict SyncConflict_resolvedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncConflict"
    ADD CONSTRAINT "SyncConflict_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SyncMutationReceipt SyncMutationReceipt_deviceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncMutationReceipt"
    ADD CONSTRAINT "SyncMutationReceipt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES public."ClientDevice"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SyncMutationReceipt SyncMutationReceipt_recordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncMutationReceipt"
    ADD CONSTRAINT "SyncMutationReceipt_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES public."PpmRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SyncMutationReceipt SyncMutationReceipt_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncMutationReceipt"
    ADD CONSTRAINT "SyncMutationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SystemJobRun SystemJobRun_requestedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemJobRun"
    ADD CONSTRAINT "SystemJobRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SystemSetting SystemSetting_updatedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemSetting"
    ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TraceCodeRule TraceCodeRule_templateVersionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceCodeRule"
    ADD CONSTRAINT "TraceCodeRule_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES public."PpmTemplateVersion"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TraceRevalidationItem TraceRevalidationItem_revalidationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceRevalidationItem"
    ADD CONSTRAINT "TraceRevalidationItem_revalidationId_fkey" FOREIGN KEY ("revalidationId") REFERENCES public."TraceRevalidation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TraceRevalidationItem TraceRevalidationItem_traceLinkId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceRevalidationItem"
    ADD CONSTRAINT "TraceRevalidationItem_traceLinkId_fkey" FOREIGN KEY ("traceLinkId") REFERENCES public."PpmTraceLink"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TraceRevalidation TraceRevalidation_resolvedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceRevalidation"
    ADD CONSTRAINT "TraceRevalidation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TraceRevalidation TraceRevalidation_triggerRevisionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TraceRevalidation"
    ADD CONSTRAINT "TraceRevalidation_triggerRevisionId_fkey" FOREIGN KEY ("triggerRevisionId") REFERENCES public."PpmRecordRevision"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserAreaAssignment UserAreaAssignment_areaId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserAreaAssignment"
    ADD CONSTRAINT "UserAreaAssignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES public."ProductionArea"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserAreaAssignment UserAreaAssignment_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserAreaAssignment"
    ADD CONSTRAINT "UserAreaAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserPreference UserPreference_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserPreference"
    ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: WorkflowEvent WorkflowEvent_actorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkflowEvent"
    ADD CONSTRAINT "WorkflowEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: WorkflowEvent WorkflowEvent_recordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkflowEvent"
    ADD CONSTRAINT "WorkflowEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES public."PpmRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: WorkflowEvent WorkflowEvent_revisionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkflowEvent"
    ADD CONSTRAINT "WorkflowEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES public."PpmRecordRevision"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--


