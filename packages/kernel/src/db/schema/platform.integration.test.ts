import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDbPool } from "../connection";
import { auditLog, idempotencyKey } from "./platform";

const migrateUrl = process.env.DATABASE_MIGRATE_URL!;
const appAppendUrl = process.env.DATABASE_APP_APPEND_URL!;
const appRwUrl = process.env.DATABASE_APP_RW_URL!;

const migrateDb = createDbPool(migrateUrl);
const appAppendDb = createDbPool(appAppendUrl);
const appRwDb = createDbPool(appRwUrl);

function auditLogRow(overrides: Partial<typeof auditLog.$inferInsert> = {}) {
  return {
    actor_id: randomUUID(),
    actor_type: "SYSTEM_SCHEDULER" as const,
    correlation_id: randomUUID(),
    entity_id: randomUUID(),
    entity_schema: "platform",
    entity_table: "audit_log",
    operation: "TEST_OPERATION",
    retention_class: "NON_FINANCIAL" as const,
    ...overrides,
  };
}

function idempotencyKeyRow(
  overrides: Partial<typeof idempotencyKey.$inferInsert> = {},
) {
  return {
    key: randomUUID(),
    scope: "test.scope",
    requester_id: randomUUID(),
    request_digest: Buffer.from("test-digest"),
    status: "IN_PROGRESS",
    expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

async function causeMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error("expected promise to reject");
}

afterAll(async () => {
  await migrateDb.execute(
    sql`DELETE FROM platform.audit_log WHERE entity_schema = 'platform' AND entity_table = 'audit_log'`,
  );
  await migrateDb.execute(
    sql`DELETE FROM platform.idempotency_key WHERE scope = 'test.scope'`,
  );
});

describe("platform.audit_log", () => {
  it("accepts a valid insert via app_append", async () => {
    const row = auditLogRow();

    await expect(
      appAppendDb.insert(auditLog).values(row),
    ).resolves.not.toThrow();

    const rows = await migrateDb
      .select()
      .from(auditLog)
      .where(sql`${auditLog.correlation_id} = ${row.correlation_id}`);
    expect(rows).toHaveLength(1);
  });

  it("rejects UPDATE via app_append (append-only enforcement)", async () => {
    const row = auditLogRow();
    await appAppendDb.insert(auditLog).values(row);

    const message = await causeMessage(
      appAppendDb
        .update(auditLog)
        .set({ operation: "MUTATED" })
        .where(sql`${auditLog.correlation_id} = ${row.correlation_id}`),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("rejects DELETE via app_append (append-only enforcement)", async () => {
    const row = auditLogRow();
    await appAppendDb.insert(auditLog).values(row);

    const message = await causeMessage(
      appAppendDb
        .delete(auditLog)
        .where(sql`${auditLog.correlation_id} = ${row.correlation_id}`),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe("platform.idempotency_key", () => {
  it("rejects a duplicate key with a primary key violation", async () => {
    const row = idempotencyKeyRow();

    await appRwDb.insert(idempotencyKey).values(row);

    const message = await causeMessage(
      appRwDb
        .insert(idempotencyKey)
        .values(idempotencyKeyRow({ key: row.key })),
    );
    expect(message).toMatch(/duplicate key value/i);
  });
});
