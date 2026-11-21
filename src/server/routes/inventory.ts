import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { currentUser } from '../auth.ts'
import { exec, many, one } from '../db.ts'
import { HttpError, likeTerm } from '../http.ts'
import { pricePerKg } from '../inventory.ts'

const SORTS: Record<string, string> = {
  description: 'i.description',
  store: 'i.store_name',
  purchased: 'i.purchased_at',
  weight: 'i.weight',
  pricePerKg: 'i.price_per_kg',
  expiry: 'i.expiry_date',
}

type InventoryRow = {
  id: string
  description: string
  storeName: string | null
  storeChain: string | null
  purchasedAt: string | null
  quantity: number | null
  weight: number | null
  unitPrice: number | null
  pricePerKg: number | null
  lineTotal: number | null
  currency: string
  expiryDate: string | null
  location: string | null
  notes: string | null
  consumedAt: string | null
  receiptId: string | null
}

function present(row: InventoryRow) {
  return {
    ...row,
    purchasedAt: row.purchasedAt ? String(row.purchasedAt).slice(0, 10) : null,
    expiryDate: row.expiryDate ? String(row.expiryDate).slice(0, 10) : null,
    consumedAt: row.consumedAt ? String(row.consumedAt).slice(0, 19) : null,
    quantity: row.quantity == null ? null : Number(row.quantity),
    weight: row.weight == null ? null : Number(row.weight),
    unitPrice: row.unitPrice == null ? null : Number(row.unitPrice),
    pricePerKg: row.pricePerKg == null ? null : Number(row.pricePerKg),
    lineTotal: row.lineTotal == null ? null : Number(row.lineTotal),
  }
}

function text(value: unknown, max: number): string | null {
  const cleaned = String(value || '').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function dateOrNull(value: unknown): string | null {
  const date = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function amount(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, 'Amounts and weights cannot be negative')
  return number
}

function readItem(body: Record<string, unknown>) {
  const description = String(body.description || '').trim()
  if (!description) throw new HttpError(400, 'Description is required')
  const weight = amount(body.weight)
  const lineTotal = amount(body.lineTotal)
  let perKg = amount(body.pricePerKg)
  if (perKg == null) perKg = pricePerKg(weight, lineTotal)
  return {
    description: description.slice(0, 300),
    storeName: text(body.storeName, 200),
    storeChain: text(body.storeChain, 80),
    purchasedAt: dateOrNull(body.purchasedAt),
    quantity: amount(body.quantity),
    weight,
    unitPrice: amount(body.unitPrice),
    pricePerKg: perKg,
    lineTotal,
    currency: String(body.currency || 'CHF').trim().toUpperCase().slice(0, 3) || 'CHF',
    expiryDate: dateOrNull(body.expiryDate),
    location: text(body.location, 120),
    notes: text(body.notes, 2000),
  }
}

const SELECT = `SELECT i.id, i.description, i.store_name AS storeName, i.store_chain AS storeChain, i.purchased_at AS purchasedAt,
  i.quantity, i.weight, i.unit_price AS unitPrice, i.price_per_kg AS pricePerKg, i.line_total AS lineTotal, i.currency,
  i.expiry_date AS expiryDate, i.location, i.notes, i.consumed_at AS consumedAt, r.id AS receiptId
  FROM inventory_items i
  LEFT JOIN receipt_items ri ON ri.id = i.receipt_item_id
  LEFT JOIN receipts r ON r.id = ri.receipt_id`

export function registerInventory(app: FastifyInstance): void {
  app.get('/api/inventory', async (request) => {
    const user = await currentUser(request)
    const query = request.query as { q?: string; status?: string; sort?: string; dir?: string; offset?: string }
    const where = ['i.user_id = ?']
    const params: unknown[] = [user.id]
    if (query.status === 'consumed') where.push('i.consumed_at IS NOT NULL')
    else if (query.status === 'expiring') where.push('i.consumed_at IS NULL AND i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)')
    else if (query.status !== 'all') where.push('i.consumed_at IS NULL')
    const term = String(query.q || '').trim()
    if (term) {
      where.push('(i.description LIKE ? OR IFNULL(i.store_name, \'\') LIKE ? OR IFNULL(i.store_chain, \'\') LIKE ? OR IFNULL(i.location, \'\') LIKE ? OR IFNULL(i.notes, \'\') LIKE ?)')
      const like = likeTerm(term)
      params.push(like, like, like, like, like)
    }
    const sort = SORTS[query.sort || 'expiry'] || SORTS.expiry
    const dir = query.dir === 'desc' ? 'DESC' : 'ASC'
    const nulls = sort === 'i.expiry_date' || sort === 'i.purchased_at' || sort === 'i.weight' || sort === 'i.price_per_kg' ? `(${sort} IS NULL), ` : ''
    const offset = Math.max(0, Number(query.offset) || 0)
    const rows = await many<InventoryRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${nulls}${sort} ${dir}, i.description ASC LIMIT 60 OFFSET ?`, [...params, offset])
    const count = await one<{ total: number }>(`SELECT COUNT(*) AS total FROM inventory_items i WHERE ${where.join(' AND ')}`, params)
    const summary = await one<{ inStock: number; expiring: number; expired: number }>(`SELECT
        SUM(consumed_at IS NULL) AS inStock,
        SUM(consumed_at IS NULL AND expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)) AS expiring,
        SUM(consumed_at IS NULL AND expiry_date IS NOT NULL AND expiry_date < CURDATE()) AS expired
      FROM inventory_items WHERE user_id = ?`, [user.id])
    return {
      items: rows.map(present),
      total: Number(count?.total || 0),
      inStock: Number(summary?.inStock || 0),
      expiring: Number(summary?.expiring || 0),
      expired: Number(summary?.expired || 0),
    }
  })

  app.post('/api/inventory', async (request, reply) => {
    const user = await currentUser(request)
    const item = readItem(request.body as Record<string, unknown>)
    const id = randomUUID()
    await exec(`INSERT INTO inventory_items (
        id, user_id, description, store_name, store_chain, purchased_at, quantity, weight, unit_price, price_per_kg, line_total, currency, expiry_date, location, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, user.id, item.description, item.storeName, item.storeChain, item.purchasedAt, item.quantity, item.weight, item.unitPrice, item.pricePerKg, item.lineTotal, item.currency, item.expiryDate, item.location, item.notes,
    ])
    reply.code(201)
    return { id }
  })

  app.put('/api/inventory/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const owned = await one<{ receipt_item_id: string | null }>('SELECT receipt_item_id FROM inventory_items WHERE id = ? AND user_id = ?', [id, user.id])
    if (!owned) throw new HttpError(404, 'Inventory item not found')
    const item = readItem(request.body as Record<string, unknown>)
    await exec(`UPDATE inventory_items SET description=?, store_name=?, store_chain=?, purchased_at=?, quantity=?, weight=?, unit_price=?, price_per_kg=?, line_total=?, currency=?, expiry_date=?, location=?, notes=? WHERE id=?`, [
      item.description, item.storeName, item.storeChain, item.purchasedAt, item.quantity, item.weight, item.unitPrice, item.pricePerKg, item.lineTotal, item.currency, item.expiryDate, item.location, item.notes, id,
    ])
    if (owned.receipt_item_id) {
      await exec('UPDATE receipt_items SET description=?, quantity=?, weight=?, expiry_date=? WHERE id=?', [
        item.description, item.quantity, item.weight, item.expiryDate, owned.receipt_item_id,
      ])
    }
    return { ok: true }
  })

  app.post('/api/inventory/:id/consume', async (request) => {
    const user = await currentUser(request)
    const result = await exec('UPDATE inventory_items SET consumed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND consumed_at IS NULL', [(request.params as { id: string }).id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Inventory item not found')
    return { ok: true }
  })

  app.post('/api/inventory/:id/restore', async (request) => {
    const user = await currentUser(request)
    const result = await exec('UPDATE inventory_items SET consumed_at = NULL WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Inventory item not found')
    return { ok: true }
  })
}
