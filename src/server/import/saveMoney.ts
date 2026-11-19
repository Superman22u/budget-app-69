import { randomUUID } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { many, withTx } from '../db.ts'
import { normalizeKey, round2 } from '../http.ts'
import { suggestCategory } from '../seed.ts'
import type { ParsedTx } from './types.ts'

type Rule = { pattern: string; category: string; priority: number }
type Rate = { currency: string; rate: number; asOf: string }
type Existing = { id: string; description: string; external_id: string | null }

function overlaps(left: string, right: string): boolean {
  if (!left || !right || left === right) return false
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  return shorter.length >= 8 && longer.includes(shorter)
}

async function queryRows<T>(conn: PoolConnection, sql: string, params: unknown[]): Promise<T[]> {
  const [rows] = await conn.query(sql, params)
  return rows as T[]
}

function applyRate(tx: ParsedTx, rates: Rate[]): ParsedTx {
  if (tx.currency === 'CHF') {
    return { ...tx, chfAmount: round2(tx.amount), exchangeRate: tx.exchangeRate ?? 1 }
  }
  if (tx.chfAmount != null) return tx
  const matching = rates.filter((rate) => rate.currency === tx.currency)
  const onDate = matching.filter((rate) => rate.asOf <= tx.bookingDate).sort((a, b) => b.asOf.localeCompare(a.asOf))[0]
  const chosen = onDate || matching.sort((a, b) => b.asOf.localeCompare(a.asOf))[0]
  if (!chosen) return tx
  return { ...tx, exchangeRate: chosen.rate, chfAmount: round2(tx.amount * chosen.rate) }
}

export async function saveTransactions(userId: string, fileName: string, parsed: ParsedTx[]): Promise<{ imported: number; skipped: number; missingChf: number; batchId: string }> {
  const rules = await many<Rule>('SELECT pattern, category, priority FROM category_rules WHERE user_id = ?', [userId])
  const rates = await many<Rate>('SELECT currency, rate_to_chf AS rate, as_of AS asOf FROM exchange_rates WHERE user_id = ?', [userId])
  const ready = parsed.map((row) => applyRate(row, rates))
  const batchId = randomUUID()
  const seenExact = new Map<string, number>()
  const seenFuzzy = new Map<string, number>()
  const claimed = new Set<string>()
  let imported = 0
  let skipped = 0
  let missingChf = 0

  await withTx(async (conn) => {
    await queryRows(conn, 'INSERT INTO import_batches (id, user_id, file_name, source_kind, provider, imported_count, skipped_count) VALUES (?, ?, ?, ?, ?, 0, 0)', [
      batchId,
      userId,
      fileName.slice(0, 500),
      ready[0]?.sourceKind || 'bank',
      ready[0]?.provider || null,
    ])
    for (const row of ready) {
      const duplicate = await isDuplicate(conn, userId, row, seenExact, seenFuzzy, claimed)
      if (duplicate) {
        skipped += 1
        continue
      }
      if (row.chfAmount == null) missingChf += 1
      const category = suggestCategory([row.description, row.merchant, row.details, row.categoryHint].filter(Boolean).join(' '), rules)
      await queryRows(conn, `INSERT INTO transactions (
        id, user_id, source_kind, provider, account_ref, card_ref, booking_date, value_date, booked_at,
        description, details, merchant, currency, amount, chf_amount, exchange_rate, direction, balance,
        external_id, category, import_batch_id, import_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        randomUUID(),
        userId,
        row.sourceKind,
        row.provider,
        row.accountRef,
        row.cardRef,
        row.bookingDate,
        row.valueDate,
        row.bookedAt,
        row.description,
        row.details,
        row.merchant,
        row.currency,
        row.amount,
        row.chfAmount,
        row.exchangeRate,
        row.amount > 0 ? 'credit' : 'debit',
        row.balance,
        row.externalId,
        category,
        batchId,
        fileName.slice(0, 500),
      ])
      imported += 1
    }
    await queryRows(conn, 'UPDATE import_batches SET imported_count = ?, skipped_count = ? WHERE id = ?', [imported, skipped, batchId])
  })

  return { imported, skipped, missingChf, batchId }
}

async function isDuplicate(conn: PoolConnection, userId: string, row: ParsedTx, seenExact: Map<string, number>, seenFuzzy: Map<string, number>, claimed: Set<string>): Promise<boolean> {
  if (row.externalId) {
    const found = await queryRows<{ id: string }>(conn, 'SELECT id FROM transactions WHERE user_id = ? AND provider = ? AND external_id = ? LIMIT 1', [userId, row.provider, row.externalId])
    if (found.length) return true
    const taken = await claimFuzzy(conn, userId, row, claimed)
    if (taken) {
      const description = row.description.length > 8 ? row.description : null
      await queryRows(conn, 'UPDATE transactions SET external_id = ?, description = COALESCE(?, description), details = COALESCE(details, ?) WHERE id = ?', [row.externalId, description, row.details, taken])
      return true
    }
  }
  const exactKey = [row.provider, row.accountRef || '', row.bookedAt, row.amount, row.currency, normalizeKey(row.description)].join('|')
  const exact = await queryRows<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM transactions
    WHERE user_id = ? AND provider = ? AND booked_at = ? AND currency = ? AND ABS(amount - ?) < 0.009
      AND LOWER(description) = ? AND (account_ref <=> ? OR (? IS NULL AND account_ref IS NULL))`, [
    userId, row.provider, row.bookedAt, row.currency, row.amount, normalizeKey(row.description), row.accountRef, row.accountRef,
  ])
  const seen = seenExact.get(exactKey) || 0
  if (seen < Number(exact[0]?.total || 0)) {
    seenExact.set(exactKey, seen + 1)
    return true
  }
  const fuzzyKey = [row.provider, row.accountRef || '', row.bookingDate, row.amount, row.currency].join('|')
  const candidates = await queryRows<Existing>(conn, `SELECT id, description, external_id FROM transactions
    WHERE user_id = ? AND provider = ? AND booking_date = ? AND currency = ? AND ABS(amount - ?) < 0.009
      AND (account_ref = ? OR account_ref IS NULL OR ? IS NULL)`, [
    userId, row.provider, row.bookingDate, row.currency, row.amount, row.accountRef, row.accountRef,
  ])
  const fuzzy = candidates.filter((candidate) => overlaps(normalizeKey(candidate.description), normalizeKey(row.description)) && !claimed.has(candidate.id))
  const seenOverlap = seenFuzzy.get(fuzzyKey) || 0
  if (seenOverlap < fuzzy.length) {
    seenFuzzy.set(fuzzyKey, seenOverlap + 1)
    seenExact.set(exactKey, seen + 1)
    return true
  }
  seenExact.set(exactKey, seen + 1)
  return false
}

async function claimFuzzy(conn: PoolConnection, userId: string, row: ParsedTx, claimed: Set<string>): Promise<string | null> {
  const candidates = await queryRows<Existing>(conn, `SELECT id, description, external_id FROM transactions
    WHERE user_id = ? AND provider = ? AND booking_date = ? AND currency = ? AND ABS(amount - ?) < 0.009
      AND external_id IS NULL AND (account_ref = ? OR account_ref IS NULL OR ? IS NULL)`, [
    userId, row.provider, row.bookingDate, row.currency, row.amount, row.accountRef, row.accountRef,
  ])
  const match = candidates.find((candidate) => overlaps(normalizeKey(candidate.description), normalizeKey(row.description)) && !claimed.has(candidate.id))
  if (!match) return null
  claimed.add(match.id)
  return match.id
}
