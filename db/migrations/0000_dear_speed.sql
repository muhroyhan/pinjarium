CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TYPE "platform"."actor_type" AS ENUM('USER', 'VENDOR', 'ADMIN', 'SYSTEM_SCHEDULER', 'SYSTEM_WEBHOOK', 'SYSTEM_EVENT');--> statement-breakpoint
CREATE TYPE "platform"."audit_retention_class" AS ENUM('FINANCIAL', 'NON_FINANCIAL');--> statement-breakpoint
CREATE TYPE "platform"."job_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED_LOCKED');--> statement-breakpoint
CREATE TYPE "platform"."outbox_status" AS ENUM('PENDING', 'ENQUEUED', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "platform"."webhook_process_status" AS ENUM('RECEIVED', 'PROCESSING', 'PROCESSED', 'UNKNOWN_PAYLOAD', 'FAILED');--> statement-breakpoint
CREATE TYPE "platform"."webhook_source" AS ENUM('PAYMENT', 'INSTANT_COURIER', 'FLEET_COURIER');--> statement-breakpoint
CREATE TABLE "platform"."audit_log" (
	"actor_id" uuid NOT NULL,
	"actor_type" "platform"."actor_type" NOT NULL,
	"after_value" jsonb,
	"before_value" jsonb,
	"correlation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_schema" text NOT NULL,
	"entity_table" text NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" text NOT NULL,
	"retention_class" "platform"."audit_retention_class" NOT NULL,
	CONSTRAINT "audit_log_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE TABLE platform.audit_log_default PARTITION OF platform.audit_log DEFAULT;
--> statement-breakpoint
CREATE TABLE "platform"."idempotency_key" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"request_digest" "bytea" NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."job_execution_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"trigger_actor_type" "platform"."actor_type",
	"trigger_actor_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "platform"."job_run_status" NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"failure_detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "platform"."outbox_message" (
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedup_key" text,
	"done_at" timestamp with time zone,
	"enqueued_at" timestamp with time zone,
	"handler" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"last_error_key" text,
	"payload" jsonb NOT NULL,
	"status" "platform"."outbox_status" DEFAULT 'PENDING'
);
--> statement-breakpoint
CREATE TABLE "platform"."webhook_event" (
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"correlation_id" uuid NOT NULL,
	"failure_detail" jsonb,
	"headers" jsonb NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"process_status" "platform"."webhook_process_status" DEFAULT 'RECEIVED',
	"processed_at" timestamp with time zone,
	"raw_body" "bytea" NOT NULL,
	"raw_body_json" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_valid" boolean NOT NULL,
	"source" "platform"."webhook_source" NOT NULL,
	"webhook_id" text NOT NULL,
	"webhook_timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_audit_entity" ON "platform"."audit_log" USING btree ("entity_table","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_audit_actor" ON "platform"."audit_log" USING btree ("actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_audit_corr" ON "platform"."audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "ix_idem_expiry" ON "platform"."idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_job_log" ON "platform"."job_execution_log" USING btree ("job_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_outbox_dedup" ON "platform"."outbox_message" USING btree ("dedup_key") WHERE "platform"."outbox_message"."dedup_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_outbox_sweep" ON "platform"."outbox_message" USING btree ("status","available_at") WHERE "platform"."outbox_message"."status" IN ('PENDING','FAILED');--> statement-breakpoint
CREATE UNIQUE INDEX "ux_webhook_id" ON "platform"."webhook_event" USING btree ("source","webhook_id");--> statement-breakpoint
CREATE INDEX "ix_webhook_pending" ON "platform"."webhook_event" USING btree ("process_status","received_at");
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO app_rw, app_append, app_migrate;
GRANT SELECT, INSERT ON platform.audit_log TO app_append;
GRANT SELECT, INSERT ON platform.idempotency_key TO app_rw;
GRANT UPDATE ON platform.idempotency_key TO app_rw; -- status IN_PROGRESS -> COMPLETED
GRANT SELECT, INSERT, UPDATE ON platform.outbox_message, platform.job_execution_log, platform.webhook_event TO app_rw;