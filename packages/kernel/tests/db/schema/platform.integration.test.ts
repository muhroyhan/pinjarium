import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDbPool } from '../../../src/db/connection'
import {
  auditLog,
  idempotencyKey,
  outboxMessage,
  webhookEvent,
} from '../../../src/db/schema/platform'

const migrateUrl = process.env.DATABASE_MIGRATE_URL!
const appAppendUrl = process.env.DATABASE_APP_APPEND_URL!
const appRwUrl = process.env.DATABASE_APP_RW_URL!

const migrateDb = createDbPool(migrateUrl)
const appAppendDb = createDbPool(appAppendUrl)
const appRwDb = createDbPool(appRwUrl)

const insertedWebhookEventIds: string[] = []
const insertedOutboxMessageIds: string[] = []

function auditLogRow(overrides: Partial<typeof auditLog.$inferInsert> = {}) {
  return {
    actor_id: randomUUID(),
    actor_type: 'SYSTEM_SCHEDULER' as const,
    correlation_id: randomUUID(),
    entity_id: randomUUID(),
    entity_schema: 'platform',
    entity_table: 'audit_log',
    operation: 'TEST_OPERATION',
    retention_class: 'NON_FINANCIAL' as const,
    ...overrides,
  }
}

function idempotencyKeyRow(
  overrides: Partial<typeof idempotencyKey.$inferInsert> = {},
) {
  return {
    key: randomUUID(),
    scope: 'test.scope',
    requester_id: randomUUID(),
    request_digest: Buffer.from('test-digest'),
    status: 'IN_PROGRESS',
    expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

async function causeMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error
    return cause instanceof Error ? cause.message : String(cause)
  }
  throw new Error('expected promise to reject')
}

afterAll(async () => {
  await migrateDb.execute(
    sql`DELETE FROM platform.audit_log WHERE entity_schema = 'platform' AND entity_table = 'audit_log'`,
  )
  await migrateDb.execute(
    sql`DELETE FROM platform.idempotency_key WHERE scope = 'test.scope'`,
  )

  if (insertedWebhookEventIds.length > 0) {
    await migrateDb.execute(
      sql`DELETE FROM platform.webhook_event WHERE id IN (${sql.join(
        insertedWebhookEventIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
  }
  if (insertedOutboxMessageIds.length > 0) {
    await migrateDb.execute(
      sql`DELETE FROM platform.outbox_message WHERE id IN (${sql.join(
        insertedOutboxMessageIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
  }
})

describe('platform.audit_log', () => {
  it('accepts a valid insert via app_append', async () => {
    const row = auditLogRow()

    await expect(
      appAppendDb.insert(auditLog).values(row),
    ).resolves.not.toThrow()

    const rows = await migrateDb
      .select()
      .from(auditLog)
      .where(sql`${auditLog.correlation_id} = ${row.correlation_id}`)
    expect(rows).toHaveLength(1)
  })

  it('rejects UPDATE via app_append (append-only enforcement)', async () => {
    const row = auditLogRow()
    await appAppendDb.insert(auditLog).values(row)

    const message = await causeMessage(
      appAppendDb
        .update(auditLog)
        .set({ operation: 'MUTATED' })
        .where(sql`${auditLog.correlation_id} = ${row.correlation_id}`),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('rejects DELETE via app_append (append-only enforcement)', async () => {
    const row = auditLogRow()
    await appAppendDb.insert(auditLog).values(row)

    const message = await causeMessage(
      appAppendDb
        .delete(auditLog)
        .where(sql`${auditLog.correlation_id} = ${row.correlation_id}`),
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('platform.idempotency_key', () => {
  it('rejects a duplicate key with a primary key violation', async () => {
    const row = idempotencyKeyRow()

    await appRwDb.insert(idempotencyKey).values(row)

    const message = await causeMessage(
      appRwDb
        .insert(idempotencyKey)
        .values(idempotencyKeyRow({ key: row.key })),
    )
    expect(message).toMatch(/duplicate key value/i)
  })
})

function webhookEventRow(
  overrides: Partial<typeof webhookEvent.$inferInsert> = {},
) {
  const row = {
    id: randomUUID(),
    source: 'PAYMENT' as const,
    webhook_id: randomUUID(),
    webhook_timestamp: new Date(),
    headers: {},
    raw_body: Buffer.from('test-webhook-body'),
    signature_valid: true,
    correlation_id: randomUUID(),
    ...overrides,
  }
  insertedWebhookEventIds.push(row.id)
  return row
}

function outboxMessageRow(
  overrides: Partial<typeof outboxMessage.$inferInsert> = {},
) {
  const row = {
    id: randomUUID(),
    correlation_id: randomUUID(),
    handler: 'test.handler',
    payload: {},
    ...overrides,
  }
  insertedOutboxMessageIds.push(row.id)
  return row
}

describe('platform.webhook_event', () => {
  it('rejects a duplicate (source, webhook_id) pair', async () => {
    const row = webhookEventRow()

    await appRwDb.insert(webhookEvent).values(row)

    const message = await causeMessage(
      appRwDb
        .insert(webhookEvent)
        .values(
          webhookEventRow({ source: row.source, webhook_id: row.webhook_id }),
        ),
    )
    expect(message).toMatch(/duplicate key value/i)
  })
})

describe('platform.outbox_message', () => {
  it('rejects a duplicate non-null dedup_key', async () => {
    const dedupKey = randomUUID()
    await appRwDb
      .insert(outboxMessage)
      .values(outboxMessageRow({ dedup_key: dedupKey }))

    const message = await causeMessage(
      appRwDb
        .insert(outboxMessage)
        .values(outboxMessageRow({ dedup_key: dedupKey })),
    )
    expect(message).toMatch(/duplicate key value/i)
  })

  it('allows two rows with a null dedup_key (partial index does not apply to NULL)', async () => {
    await expect(
      appRwDb
        .insert(outboxMessage)
        .values(outboxMessageRow({ dedup_key: null })),
    ).resolves.not.toThrow()

    await expect(
      appRwDb
        .insert(outboxMessage)
        .values(outboxMessageRow({ dedup_key: null })),
    ).resolves.not.toThrow()
  })
})
