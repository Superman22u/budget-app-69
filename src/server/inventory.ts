import { randomUUID } from 'node:crypto'
import { exec } from './db.ts'
import { round2 } from './http.ts'

export type StockSource = {
  id: string
  description: string
  quantity: number | null
  weight: number | null
  unitPrice: number | null
  lineTotal: number | null
  expiryDate: string | null
  storeName: string | null
  storeChain: string | null
  purchasedAt: string | null
  currency: string
}

export function pricePerKg(weight: number | null, lineTotal: number | null): number | null {
  if (weight == null || weight <= 0 || lineTotal == null) return null
  return round2(lineTotal / weight)
}

export async function stockReceiptItem(userId: string, item: StockSource): Promise<void> {
  const perKg = pricePerKg(item.weight, item.lineTotal)
  await exec(`INSERT IGNORE INTO inventory_items (
      id, user_id, receipt_item_id, description, store_name, store_chain, purchased_at,
      quantity, weight, unit_price, price_per_kg, line_total, currency, expiry_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    randomUUID(), userId, item.id, item.description.slice(0, 300), item.storeName, item.storeChain, item.purchasedAt,
    item.quantity, item.weight, item.unitPrice, perKg, item.lineTotal, (item.currency || 'CHF').slice(0, 3), item.expiryDate,
  ])
  await exec(`UPDATE inventory_items SET
      description = ?, store_name = ?, store_chain = ?, purchased_at = ?, quantity = ?,
      unit_price = ?, line_total = ?, currency = ?,
      weight = COALESCE(weight, ?),
      expiry_date = COALESCE(expiry_date, ?),
      price_per_kg = COALESCE(price_per_kg, ?)
    WHERE receipt_item_id = ?`, [
    item.description.slice(0, 300), item.storeName, item.storeChain, item.purchasedAt, item.quantity,
    item.unitPrice, item.lineTotal, (item.currency || 'CHF').slice(0, 3),
    item.weight, item.expiryDate, perKg, item.id,
  ])
}

export async function backfillInventory(): Promise<void> {
  await exec(`INSERT INTO inventory_items (
      id, user_id, receipt_item_id, description, store_name, store_chain, purchased_at,
      quantity, weight, unit_price, price_per_kg, line_total, currency, expiry_date
    )
    SELECT UUID(), r.user_id, i.id, i.description, r.store_name, r.store_chain, r.purchased_at,
      i.quantity, i.weight, i.unit_price,
      CASE WHEN i.weight > 0 AND i.line_total IS NOT NULL THEN ROUND(i.line_total / i.weight, 2) ELSE NULL END,
      i.line_total, r.currency, i.expiry_date
    FROM receipt_items i
    JOIN receipts r ON r.id = i.receipt_id
    LEFT JOIN inventory_items existing ON existing.receipt_item_id = i.id
    WHERE existing.id IS NULL`)
}
