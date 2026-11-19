import { createPool, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const pool: Pool = createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10,
  dateStrings: true,
  decimalNumbers: true,
  charset: 'utf8mb4',
  timezone: 'Z',
})

export async function many<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}

export async function one<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await many<T>(sql, params)
  return rows[0] ?? null
}

export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query(sql, params)
  return result as ResultSetHeader
}

export async function withTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

export async function waitForDatabase(): Promise<void> {
  let last = 'Database is not reachable'
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  throw new Error(last)
}

export async function migrate(): Promise<void> {
  const schemaPath = fileURLToPath(new URL('../../sql/schema.sql', import.meta.url))
  const sql = await readFile(schemaPath, 'utf8')
  const statements = sql
    .replace(/--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
  for (const statement of statements) {
    await pool.query(statement)
  }
}
