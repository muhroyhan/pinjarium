import { uuid } from 'drizzle-orm/pg-core/columns/uuid'
import { pgSchema } from 'drizzle-orm/pg-core/schema'
import { text } from 'drizzle-orm/pg-core/columns/text'
import { jsonb } from 'drizzle-orm/pg-core/columns/jsonb'
import { timestamp } from 'drizzle-orm/pg-core/columns'
import { index } from 'drizzle-orm/pg-core/indexes'
import { primaryKey } from 'drizzle-orm/pg-core/primary-keys'
import { customType } from 'drizzle-orm/pg-core/columns/custom'
import { integer } from 'drizzle-orm/pg-core'
import { uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm/sql/sql'
import { boolean } from 'drizzle-orm/pg-core'

export const platformSchema = pgSchema('platform')

export const actorTypeEnum = platformSchema.enum('actor_type', [
  'USER',
  'VENDOR',
  'ADMIN',
  'SYSTEM_SCHEDULER',
  'SYSTEM_WEBHOOK',
  'SYSTEM_EVENT',
])

export const auditRetentionClassEnum = platformSchema.enum(
  'audit_retention_class',
  ['FINANCIAL', 'NON_FINANCIAL'],
)

export const auditLog = platformSchema.table(
  'audit_log',
  {
    actor_id: uuid('actor_id').notNull(),
    actor_type: actorTypeEnum('actor_type').notNull(),
    after_value: jsonb('after_value'),
    before_value: jsonb('before_value'),
    correlation_id: uuid('correlation_id').notNull(),
    entity_id: uuid('entity_id').notNull(),
    entity_schema: text('entity_schema').notNull(),
    entity_table: text('entity_table').notNull(),
    id: uuid('id').notNull().defaultRandom(),
    occurred_at: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    operation: text('operation').notNull(),
    retention_class: auditRetentionClassEnum('retention_class').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.occurred_at] }),
    index('ix_audit_entity').on(
      table.entity_table,
      table.entity_id,
      table.occurred_at.desc(),
    ),
    index('ix_audit_actor').on(table.actor_id, table.occurred_at.desc()),
    index('ix_audit_corr').on(table.correlation_id),
  ],
)

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

export const idempotencyKey = platformSchema.table(
  'idempotency_key',
  {
    key: text('key').primaryKey(),
    scope: text('scope').notNull(),
    requester_id: uuid('requester_id').notNull(),
    request_digest: bytea('request_digest').notNull(),
    status: text('status').notNull(),
    response_status: integer('response_status'),
    response_body: jsonb('response_body'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('ix_idem_expiry').on(table.expires_at)],
)

export const outboxStatusEnum = platformSchema.enum('outbox_status', [
  'PENDING',
  'ENQUEUED',
  'DONE',
  'FAILED',
])

export const outboxMessage = platformSchema.table(
  'outbox_message',
  {
    attempt_count: integer('attempt_count').notNull().default(0),
    available_at: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    correlation_id: uuid('correlation_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    dedup_key: text('dedup_key'),
    done_at: timestamp('done_at', { withTimezone: true }),
    enqueued_at: timestamp('enqueued_at', { withTimezone: true }),
    handler: text('handler').notNull(),
    id: uuid('id').primaryKey(),
    last_error_key: text('last_error_key'),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').default('PENDING'),
  },
  (table) => [
    uniqueIndex('ux_outbox_dedup')
      .on(table.dedup_key)
      .where(sql`${table.dedup_key} is not null`),
    index('ix_outbox_sweep')
      .on(table.status, table.available_at)
      .where(sql`${table.status} IN ('PENDING','FAILED')`),
  ],
)

export const jobRunStatusEnum = platformSchema.enum('job_run_status', [
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED_LOCKED',
])

export const jobExecutionLog = platformSchema.table(
  'job_execution_log',
  {
    id: uuid('id').primaryKey(),
    job_id: text('job_id').notNull(),
    correlation_id: uuid('correlation_id').notNull(),
    trigger_actor_type: actorTypeEnum('trigger_actor_type'),
    trigger_actor_id: uuid('trigger_actor_id').notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull(),
    finished_at: timestamp('finished_at', { withTimezone: true }),
    status: jobRunStatusEnum('status').notNull(),
    processed_count: integer('processed_count').notNull().default(0),
    failed_count: integer('failed_count').notNull().default(0),
    checkpoint: jsonb('checkpoint'),
    failure_detail: jsonb('failure_detail'),
  },
  (table) => [index('ix_job_log').on(table.job_id, table.started_at.desc())],
)

export const webhookSourceEnum = platformSchema.enum('webhook_source', [
  'PAYMENT',
  'INSTANT_COURIER',
  'FLEET_COURIER',
])

export const webhookProcessStatusEnum = platformSchema.enum(
  'webhook_process_status',
  ['RECEIVED', 'PROCESSING', 'PROCESSED', 'UNKNOWN_PAYLOAD', 'FAILED'],
)

export const webhookEvent = platformSchema.table(
  'webhook_event',
  {
    attempt_count: integer('attempt_count').notNull().default(0),
    correlation_id: uuid('correlation_id').notNull(),
    failure_detail: jsonb('failure_detail'),
    headers: jsonb('headers').notNull(),
    id: uuid('id').primaryKey(),
    process_status:
      webhookProcessStatusEnum('process_status').default('RECEIVED'),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    raw_body: bytea('raw_body').notNull(),
    raw_body_json: jsonb('raw_body_json'),
    received_at: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    signature_valid: boolean('signature_valid').notNull(),
    source: webhookSourceEnum('source').notNull(),
    webhook_id: text('webhook_id').notNull(),
    webhook_timestamp: timestamp('webhook_timestamp', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex('ux_webhook_id').on(table.source, table.webhook_id),
    index('ix_webhook_pending').on(table.process_status, table.received_at),
  ],
)
