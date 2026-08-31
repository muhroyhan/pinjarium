
import { uuid } from "drizzle-orm/pg-core/columns/uuid";
import { pgSchema } from "drizzle-orm/pg-core/schema";
import { sql } from "drizzle-orm/sql/sql";
import { text } from "drizzle-orm/pg-core/columns/text";
import { jsonb } from "drizzle-orm/pg-core/columns/jsonb";
import { timestamp } from "drizzle-orm/pg-core/columns";
import { index } from "drizzle-orm/pg-core/indexes";
import { primaryKey } from "drizzle-orm/pg-core/primary-keys";
import { customType } from "drizzle-orm/pg-core/columns/custom";
import { integer } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform")

export const actorTypeEnum = platformSchema.enum("actor_type", [
  "USER",
  "VENDOR",
  "ADMIN",
  "SYSTEM_SCHEDULER",
  "SYSTEM_WEBHOOK",
  "SYSTEM_EVENT",
]);

export const auditRetentionClassEnum  = platformSchema.enum("audit_retention_class", [
  "FINANCIAL", "NON_FINANCIAL"
]);

export const auditLog = platformSchema.table("audit_log", {
  actor_id: uuid("actor_id").notNull(),
  actor_type: actorTypeEnum("actor_type").notNull(),
  after_value: jsonb("after_value"), 
  before_value: jsonb("before_value"), 
  correlation_id: uuid("correlation_id").notNull(),
  entity_id: uuid("entity_id").notNull(),
  entity_schema: text("entity_schema").notNull(),
  entity_table: text("entity_table").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  operation: text("operation").notNull(),
  retention_class: auditRetentionClassEnum("retention_class").notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.occurred_at] }),
  index("ix_audit_entity").on(table.entity_table, table.entity_id, table.occurred_at.desc()),
  index("ix_audit_actor").on(table.actor_id, table.occurred_at.desc()),
  index("ix_audit_corr").on(table.correlation_id)
]);

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const idempotencyKey = platformSchema.table("idempotency_key", {
  key: text('key').primaryKey(),
  scope: text('scope').notNull(),
  requester_id: uuid("requester_id").notNull(),
  request_digest: bytea('request_digest').notNull(),
  status: text('status').notNull(),
  response_status: integer('response_status'),
  response_body: jsonb('response_body'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  index("ix_idem_expiry").on(table.expires_at)
]);