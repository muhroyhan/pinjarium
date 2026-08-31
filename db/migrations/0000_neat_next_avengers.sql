CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TYPE "platform"."actor_type" AS ENUM('USER', 'VENDOR', 'ADMIN', 'SYSTEM_SCHEDULER', 'SYSTEM_WEBHOOK', 'SYSTEM_EVENT');--> statement-breakpoint
CREATE TYPE "platform"."audit_retention_class" AS ENUM('FINANCIAL', 'NON_FINANCIAL');--> statement-breakpoint
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
CREATE INDEX "ix_audit_entity" ON "platform"."audit_log" USING btree ("entity_table","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_audit_actor" ON "platform"."audit_log" USING btree ("actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_audit_corr" ON "platform"."audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "ix_idem_expiry" ON "platform"."idempotency_key" USING btree ("expires_at");
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO app_rw, app_append, app_migrate;
GRANT SELECT, INSERT ON platform.audit_log TO app_append;
GRANT SELECT, INSERT ON platform.idempotency_key TO app_rw;
GRANT UPDATE ON platform.idempotency_key TO app_rw; -- status IN_PROGRESS -> COMPLETED