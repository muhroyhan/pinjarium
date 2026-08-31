import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

export function createDbPool(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5 })
  return drizzle(pool)
}
