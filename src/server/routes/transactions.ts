import type { FastifyInstance } from 'fastify'
import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import { currentUser } from '../auth.ts'
import { exec, many, one } from '../db.ts'
import { storeUpload } from '../files.ts'
import { HttpError, likeTerm, round2 } from '../http.ts'
import { parseUpload } from '../import/parseUpload.ts'
import { saveTransactions } from '../import/saveMoney.ts'
import { recalcLine } from '../match.ts'
import { suggestCategory } from '../seed.ts'

const SORTS: Record<string, string> = {
  bookingDate: 'booking_date',
  valueDate: 'value_date',
  description: 'description',
  provider: 'provider',
  sourceKind: 'source_kind',
  category: 'category',
  amount: 'amount',
  chfAmount: 'chf_amount',
  currency: 'currency',
  accountRef: 'account_ref',
  importFile: 'import_file',
}

type TxRow = {
  id: string
  source_kind: string
  provider: string
  account_ref: string | null
  card_ref: string | null
  booking_date: string
  value_date: string | null
  description: string
  details: string | null
  merchant: string | null
  currency: string
  amount: number
  chf_amount: number | null
  exchange_rate: number | null
  direction: string
  balance: number | null
  external_id: string | null
  category: string | null
  import_file: string | null
}

function present(row: TxRow) {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    provider: row.provider,
    accountRef: row.account_ref,
    cardRef: row.card_ref,
    bookingDate: String(row.booking_date).slice(0, 10),
    valueDate: row.value_date ? String(row.value_date).slice(0, 10) : null,
    description: row.description,
    details: row.details,
    merchant: row.merchant,
    currency: row.currency,
    amount: Number(row.amount),
    chfAmount: row.chf_amount == null ? null : Number(row.chf_amount),
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    direction: row.direction,
    balance: row.balance == null ? null : Number(row.balance),
    externalId: row.external_id,
    category: row.category,
    importFile: row.import_file,
  }
}

function filters(userId: string, query: Record<string, string | undefined>) {
  const where = ['user_id = ?']
  const params: unknown[] = [userId]
  if (query.source === 'bank' || query.source === 'creditcard' || query.source === 'debitcard') {
    where.push('source_kind = ?')
    params.push(query.source)
  }
  if (query.provider) {
    where.push('provider = ?')
    params.push(query.provider)
  }
  if (query.category === '__none__') where.push('category IS NULL')
  else if (query.category) {
    where.push('category = ?')
    params.push(query.category)
  }
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) {
    where.push('booking_date >= ?')
    params.push(query.from)
  }
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
    where.push('booking_date <= ?')
    params.push(query.to)
  }
  const term = String(query.q || '').trim()
  if (term) {
    where.push('(description LIKE ? OR details LIKE ? OR merchant LIKE ? OR account_ref LIKE ? OR card_ref LIKE ? OR import_file LIKE ? OR category LIKE ?)')
    const like = likeTerm(term)
    params.push(like, like, like, like, like, like, like)
  }
  return { where: where.join(' AND '), params }
}

export function registerTransactions(app: FastifyInstance): void {
  app.post('/api/import', async (request) => {
    const user = await currentUser(request)
    const file = await request.file()
    if (!file) throw new HttpError(400, 'Choose a file to import')
    const expect = String((request.query as { expect?: string }).expect || '')
    const buffer = await file.toBuffer()
    const parsed = await parseUpload(file.filename, buffer, expect)
    if (expect === 'money' && parsed.kind !== 'money') throw new HttpError(400, 'This file is not a bank or card export. Use Healthcare or Receipts for those documents.')
    if (expect === 'healthcare' && parsed.kind !== 'healthcare') throw new HttpError(400, 'This file is not a healthcare document.')
    if (expect === 'receipt' && parsed.kind !== 'receipts') throw new HttpError(400, 'This file is not a receipt.')
    if (parsed.kind === 'money') {
      if (!parsed.transactions.length) throw new HttpError(400, 'No transactions were found in that file.')
      const saved = await saveTransactions(user.id, file.filename, parsed.transactions)
      return { kind: 'money', provider: parsed.provider, accountRef: parsed.accountRef, ...saved }
    }
    if (parsed.kind === 'healthcare') return saveHealthcare(user.id, file.filename, buffer, parsed.documents)
    return saveReceipts(user.id, file.filename, buffer, parsed.receipts)
  })

  app.get('/api/transactions/meta', async (request) => {
    const user = await currentUser(request)
    const providers = await many<{ provider: string }>('SELECT DISTINCT provider FROM transactions WHERE user_id = ? ORDER BY provider', [user.id])
    const categories = await many<{ name: string }>('SELECT name FROM categories WHERE user_id = ? AND kind = ? ORDER BY name', [user.id, 'spending'])
    return { providers: providers.map((row) => row.provider), categories: categories.map((row) => row.name) }
  })

  app.get('/api/transactions', async (request) => {
    const user = await currentUser(request)
    const query = request.query as Record<string, string | undefined>
    const { where, params } = filters(user.id, query)
    const sort = SORTS[query.sort || 'bookingDate'] || 'booking_date'
    const direction = query.dir === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 80))
    const offset = Math.max(0, Number(query.offset) || 0)
    const totalRow = await one<{ total: number }>(`SELECT COUNT(*) AS total FROM transactions WHERE ${where}`, params)
    const rows = await many<TxRow>(`SELECT id, source_kind, provider, account_ref, card_ref, booking_date, value_date, description, details, merchant, currency, amount, chf_amount, exchange_rate, direction, balance, external_id, category, import_file FROM transactions WHERE ${where} ORDER BY ${sort} ${direction}, id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
    return { total: Number(totalRow?.total || 0), rows: rows.map(present) }
  })

  app.get('/api/transactions/export', async (request, reply) => {
    const user = await currentUser(request)
    const query = request.query as Record<string, string | undefined>
    const { where, params } = filters(user.id, query)
    const rows = await many<TxRow>(`SELECT id, source_kind, provider, account_ref, card_ref, booking_date, value_date, description, details, merchant, currency, amount, chf_amount, exchange_rate, direction, balance, external_id, category, import_file FROM transactions WHERE ${where} ORDER BY booking_date DESC, id DESC`, params)
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Transactions')
    sheet.columns = [
      { header: 'Booking date', key: 'bookingDate', width: 16 },
      { header: 'Value date', key: 'valueDate', width: 14 },
      { header: 'Description', key: 'description', width: 42 },
      { header: 'Details', key: 'details', width: 40 },
      { header: 'Provider', key: 'provider', width: 16 },
      { header: 'Source', key: 'sourceKind', width: 14 },
      { header: 'Account', key: 'accountRef', width: 24 },
      { header: 'Card', key: 'cardRef', width: 18 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Currency', key: 'currency', width: 12 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'CHF', key: 'chfAmount', width: 14 },
      { header: 'Exchange rate', key: 'exchangeRate', width: 14 },
      { header: 'File', key: 'importFile', width: 28 },
    ]
    for (const row of rows) sheet.addRow(present(row))
    sheet.getRow(1).font = { bold: true }
    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', 'attachment; filename="transactions.xlsx"')
    return reply.send(Buffer.from(buffer))
  })

  app.patch('/api/transactions/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const row = await one<TxRow>('SELECT id, source_kind, provider, account_ref, card_ref, booking_date, value_date, description, details, merchant, currency, amount, chf_amount, exchange_rate, direction, balance, external_id, category, import_file FROM transactions WHERE id = ? AND user_id = ?', [id, user.id])
    if (!row) throw new HttpError(404, 'Transaction not found')
    const body = request.body as { category?: string | null; remember?: boolean; exchangeRate?: number | null }
    let category = row.category
    if ('category' in body) category = body.category ? String(body.category).slice(0, 80) : null
    let exchangeRate = row.exchange_rate == null ? null : Number(row.exchange_rate)
    let chfAmount = row.chf_amount == null ? null : Number(row.chf_amount)
    if (body.exchangeRate != null && body.exchangeRate !== ('' as unknown)) {
      const rate = Number(body.exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) throw new HttpError(400, 'Exchange rate must be greater than zero')
      exchangeRate = rate
      chfAmount = round2(Number(row.amount) * rate)
    }
    await exec('UPDATE transactions SET category = ?, exchange_rate = ?, chf_amount = ? WHERE id = ?', [category, exchangeRate, chfAmount, id])
    if (body.remember && category) {
      const pattern = (row.merchant || row.description).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
      if (pattern.length >= 3) {
        await exec('INSERT INTO category_rules (id, user_id, pattern, category, priority) VALUES (?, ?, ?, ?, 50) ON DUPLICATE KEY UPDATE category = VALUES(category), priority = 50', [randomUUID(), user.id, pattern, category])
      }
    }
    const linked = await many<{ plan_line_id: string }>('SELECT plan_line_id FROM budget_links WHERE transaction_id = ?', [id])
    for (const link of linked) await recalcLine(link.plan_line_id)
    return { ok: true }
  })

  app.post('/api/transactions/categorize', async (request) => {
    const user = await currentUser(request)
    const rules = await many<{ pattern: string; category: string; priority: number }>('SELECT pattern, category, priority FROM category_rules WHERE user_id = ?', [user.id])
    const rows = await many<{ id: string; description: string; merchant: string | null; details: string | null }>('SELECT id, description, merchant, details FROM transactions WHERE user_id = ? AND category IS NULL', [user.id])
    let updated = 0
    for (const row of rows) {
      const category = suggestCategory([row.description, row.merchant, row.details].filter(Boolean).join(' '), rules)
      if (!category) continue
      await exec('UPDATE transactions SET category = ? WHERE id = ?', [category, row.id])
      updated += 1
    }
    return { updated }
  })

  app.delete('/api/transactions/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const links = await many<{ plan_line_id: string }>('SELECT plan_line_id FROM budget_links WHERE transaction_id = ?', [id])
    const result = await exec('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Transaction not found')
    for (const link of links) await recalcLine(link.plan_line_id)
    return { ok: true }
  })
}

async function saveHealthcare(userId: string, fileName: string, buffer: Buffer, documents: import('../import/types.ts').ParsedHealth[]) {
  const storedPath = await storeUpload(userId, fileName, buffer)
  let linked = 0
  for (const document of documents) {
    const id = randomUUID()
    await exec(`INSERT INTO healthcare_documents (id, user_id, doc_type, reference_no, insured_name, insured_number, document_date, service_date, provider_name, description, invoice_amount, patient_share, insurer_share, payout_iban, file_name, stored_path, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, userId, document.docType, document.referenceNo, document.insuredName, document.insuredNumber, document.documentDate, document.serviceDate, document.providerName, document.description, document.invoiceAmount, document.patientShare, document.insurerShare, document.payoutIban, fileName, storedPath, document.notes,
    ])
    if (document.insurerShare != null && document.documentDate) {
      const matches = await many<{ id: string }>(`SELECT id FROM transactions WHERE user_id = ? AND amount > 0
        AND ABS(COALESCE(chf_amount, IF(currency = 'CHF', amount, NULL)) - ?) < 0.05
        AND booking_date BETWEEN ? AND DATE_ADD(?, INTERVAL 60 DAY)
        AND (LOWER(description) LIKE '%swica%' OR LOWER(IFNULL(merchant, '')) LIKE '%swica%' OR LOWER(IFNULL(details, '')) LIKE '%swica%')
        LIMIT 2`, [userId, document.insurerShare, document.serviceDate || document.documentDate, document.documentDate])
      if (matches.length === 1) {
        await exec('UPDATE healthcare_documents SET transaction_id = ? WHERE id = ?', [matches[0].id, id])
        linked += 1
      }
    }
  }
  return { kind: 'healthcare', imported: documents.length, linked }
}

async function saveReceipts(userId: string, fileName: string, buffer: Buffer, receipts: import('../import/types.ts').ParsedReceipt[]) {
  const storedPath = await storeUpload(userId, fileName, buffer)
  let items = 0
  let linked = 0
  for (const receipt of receipts) {
    const id = randomUUID()
    let transactionId: string | null = null
    if (receipt.totalAmount != null && receipt.purchasedAt) {
      const day = receipt.purchasedAt.slice(0, 10)
      const needle = (receipt.storeChain || receipt.storeName || '').slice(0, 40)
      const matches = await many<{ id: string }>(`SELECT id FROM transactions WHERE user_id = ? AND amount < 0
        AND ABS(COALESCE(chf_amount, IF(currency = 'CHF', amount, NULL)) + ?) < 0.05
        AND booking_date BETWEEN DATE_SUB(?, INTERVAL 3 DAY) AND DATE_ADD(?, INTERVAL 3 DAY)
        AND (? = '' OR LOWER(description) LIKE ? OR LOWER(IFNULL(merchant, '')) LIKE ?)
        LIMIT 2`, [userId, receipt.totalAmount, day, day, needle, needle ? likeTerm(needle) : '%', needle ? likeTerm(needle) : '%'])
      if (matches.length === 1) {
        transactionId = matches[0].id
        linked += 1
      }
    }
    await exec(`INSERT INTO receipts (id, user_id, store_name, store_chain, purchased_at, total_amount, currency, payment_method, card_hint, file_name, stored_path, transaction_id, raw_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, userId, receipt.storeName, receipt.storeChain, receipt.purchasedAt, receipt.totalAmount, receipt.currency || 'CHF', receipt.paymentMethod, receipt.cardHint, fileName, storedPath, transactionId, receipt.notes ? `${receipt.notes}\n${receipt.rawText}` : receipt.rawText,
    ])
    for (const [index, item] of receipt.items.entries()) {
      await exec('INSERT INTO receipt_items (id, receipt_id, description, quantity, weight, unit_price, line_total, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        randomUUID(), id, item.description, item.quantity, item.weight, item.unitPrice, item.lineTotal, index,
      ])
      items += 1
    }
  }
  return { kind: 'receipts', receipts: receipts.length, items, linked }
}
