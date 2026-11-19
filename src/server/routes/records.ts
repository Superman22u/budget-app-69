import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { currentUser } from '../auth.ts'
import { exec, many, one } from '../db.ts'
import { readUpload } from '../files.ts'
import { HttpError, likeTerm } from '../http.ts'

export function registerHealthcare(app: FastifyInstance): void {
  app.get('/api/healthcare', async (request) => {
    const user = await currentUser(request)
    const rows = await many(`SELECT h.id, h.doc_type AS docType, h.reference_no AS referenceNo, h.insured_name AS insuredName, h.insured_number AS insuredNumber,
        h.document_date AS documentDate, h.service_date AS serviceDate, h.provider_name AS providerName, h.description, h.invoice_amount AS invoiceAmount,
        h.patient_share AS patientShare, h.insurer_share AS insurerShare, h.currency, h.payout_iban AS payoutIban, h.file_name AS fileName, h.notes,
        h.transaction_id AS transactionId, t.booking_date AS bookingDate, t.description AS transactionDescription, t.chf_amount AS transactionChf
      FROM healthcare_documents h
      LEFT JOIN transactions t ON t.id = h.transaction_id
      WHERE h.user_id = ? ORDER BY COALESCE(h.document_date, h.created_at) DESC`, [user.id])
    return { documents: rows }
  })

  app.post('/api/healthcare', async (request, reply) => {
    const user = await currentUser(request)
    const body = request.body as Record<string, unknown>
    const id = randomUUID()
    await exec(`INSERT INTO healthcare_documents (id, user_id, doc_type, reference_no, insured_name, insured_number, document_date, service_date, provider_name, description, invoice_amount, patient_share, insurer_share, payout_iban, notes)
      VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, user.id, text(body.referenceNo, 80), text(body.insuredName, 200), text(body.insuredNumber, 40), dateOrNull(body.documentDate), dateOrNull(body.serviceDate), text(body.providerName, 255), text(body.description, 1000), money(body.invoiceAmount), money(body.patientShare), money(body.insurerShare), text(body.payoutIban, 64), text(body.notes, 2000),
    ])
    reply.code(201)
    return { id }
  })

  app.put('/api/healthcare/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const owned = await one('SELECT id FROM healthcare_documents WHERE id = ? AND user_id = ?', [id, user.id])
    if (!owned) throw new HttpError(404, 'Healthcare document not found')
    const body = request.body as Record<string, unknown>
    let transactionId: string | null = body.transactionId ? String(body.transactionId) : null
    if (transactionId) {
      const tx = await one('SELECT id FROM transactions WHERE id = ? AND user_id = ?', [transactionId, user.id])
      if (!tx) throw new HttpError(400, 'Transaction not found')
    }
    await exec(`UPDATE healthcare_documents SET reference_no=?, insured_name=?, insured_number=?, document_date=?, service_date=?, provider_name=?, description=?, invoice_amount=?, patient_share=?, insurer_share=?, payout_iban=?, notes=?, transaction_id=? WHERE id=?`, [
      text(body.referenceNo, 80), text(body.insuredName, 200), text(body.insuredNumber, 40), dateOrNull(body.documentDate), dateOrNull(body.serviceDate), text(body.providerName, 255), text(body.description, 1000), money(body.invoiceAmount), money(body.patientShare), money(body.insurerShare), text(body.payoutIban, 64), text(body.notes, 2000), transactionId, id,
    ])
    return { ok: true }
  })

  app.delete('/api/healthcare/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const result = await exec('DELETE FROM healthcare_documents WHERE id = ? AND user_id = ?', [id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Healthcare document not found')
    return { ok: true }
  })

  app.get('/api/healthcare/:id/file', async (request, reply) => {
    const user = await currentUser(request)
    const row = await one<{ stored_path: string | null; file_name: string | null }>('SELECT stored_path, file_name FROM healthcare_documents WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    if (!row?.stored_path) throw new HttpError(404, 'No file stored')
    return sendStored(reply, row.stored_path, row.file_name || 'document.pdf')
  })

  app.get('/api/search/transactions', async (request) => {
    const user = await currentUser(request)
    const query = request.query as { q?: string }
    const term = String(query.q || '').trim()
    const rows = await many(`SELECT id, booking_date AS bookingDate, description, provider, currency, amount, chf_amount AS chfAmount
      FROM transactions WHERE user_id = ? AND (? = '' OR description LIKE ? OR provider LIKE ?)
      ORDER BY booking_date DESC LIMIT 30`, [user.id, term, likeTerm(term), likeTerm(term)])
    return { rows }
  })
}

export function registerReceipts(app: FastifyInstance): void {
  app.get('/api/receipts', async (request) => {
    const user = await currentUser(request)
    const query = request.query as { q?: string }
    const term = String(query.q || '').trim()
    const rows = await many(`SELECT r.id, r.store_name AS storeName, r.store_chain AS storeChain, r.purchased_at AS purchasedAt, r.total_amount AS totalAmount,
        r.currency, r.payment_method AS paymentMethod, r.card_hint AS cardHint, r.transaction_id AS transactionId,
        (SELECT COUNT(*) FROM receipt_items i WHERE i.receipt_id = r.id) AS itemCount
      FROM receipts r
      WHERE r.user_id = ? AND (? = '' OR r.store_name LIKE ? OR r.store_chain LIKE ? OR r.raw_text LIKE ?)
      ORDER BY COALESCE(r.purchased_at, r.created_at) DESC`, [user.id, term, likeTerm(term), likeTerm(term), likeTerm(term)])
    return { receipts: rows }
  })

  app.post('/api/receipts', async (request, reply) => {
    const user = await currentUser(request)
    const id = randomUUID()
    await exec('INSERT INTO receipts (id, user_id, currency) VALUES (?, ?, ?)', [id, user.id, 'CHF'])
    reply.code(201)
    return { id }
  })

  app.get('/api/receipts/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const receipt = await one(`SELECT r.id, r.store_name AS storeName, r.store_chain AS storeChain, r.purchased_at AS purchasedAt, r.total_amount AS totalAmount, r.currency,
      r.payment_method AS paymentMethod, r.card_hint AS cardHint, r.file_name AS fileName, r.transaction_id AS transactionId, r.raw_text AS rawText,
      t.booking_date AS bookingDate, t.provider AS transactionProvider, t.description AS transactionDescription,
      COALESCE(t.chf_amount, IF(t.currency = 'CHF', t.amount, NULL)) AS transactionChf
      FROM receipts r LEFT JOIN transactions t ON t.id = r.transaction_id
      WHERE r.id = ? AND r.user_id = ?`, [id, user.id])
    if (!receipt) throw new HttpError(404, 'Receipt not found')
    const items = await many('SELECT id, description, quantity, weight, unit_price AS unitPrice, line_total AS lineTotal, expiry_date AS expiryDate FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order, description', [id])
    const record = receipt as { totalAmount: number | null; purchasedAt: string | null; storeChain: string | null; storeName: string | null }
    let suggestions: unknown[] = []
    if (record.totalAmount != null) {
      const day = record.purchasedAt ? String(record.purchasedAt).slice(0, 10) : '2000-01-01'
      const needle = record.storeChain || record.storeName || ''
      suggestions = await many(`SELECT id, booking_date AS bookingDate, description, provider, currency, amount, chf_amount AS chfAmount
        FROM transactions WHERE user_id = ? AND ABS(ABS(COALESCE(chf_amount, IF(currency='CHF', amount, NULL))) - ?) < 1
        AND (? = '2000-01-01' OR booking_date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 5 DAY))
        ORDER BY CASE WHEN ? = '' OR LOWER(description) LIKE ? THEN 0 ELSE 1 END, booking_date DESC LIMIT 8`, [
        user.id, Math.abs(Number(record.totalAmount)), day, day, day, needle, needle ? likeTerm(needle) : '%',
      ])
    }
    return { receipt, items, suggestions }
  })

  app.put('/api/receipts/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const owned = await one('SELECT id FROM receipts WHERE id = ? AND user_id = ?', [id, user.id])
    if (!owned) throw new HttpError(404, 'Receipt not found')
    const body = request.body as Record<string, unknown>
    let transactionId: string | null = body.transactionId ? String(body.transactionId) : null
    if (transactionId) {
      const tx = await one('SELECT id FROM transactions WHERE id = ? AND user_id = ?', [transactionId, user.id])
      if (!tx) throw new HttpError(400, 'Transaction not found')
    }
    const purchasedAt = body.purchasedAt ? String(body.purchasedAt).replace('T', ' ').slice(0, 19) : null
    await exec('UPDATE receipts SET store_name=?, store_chain=?, purchased_at=?, total_amount=?, currency=?, payment_method=?, card_hint=?, transaction_id=? WHERE id=?', [
      text(body.storeName, 200), text(body.storeChain, 80), purchasedAt, money(body.totalAmount), String(body.currency || 'CHF').slice(0, 3).toUpperCase(), text(body.paymentMethod, 80), text(body.cardHint, 40), transactionId, id,
    ])
    const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : []
    await exec('DELETE FROM receipt_items WHERE receipt_id = ?', [id])
    for (const [index, item] of items.entries()) {
      const description = String(item.description || '').trim()
      if (!description) continue
      await exec('INSERT INTO receipt_items (id, receipt_id, description, quantity, weight, unit_price, line_total, expiry_date, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        randomUUID(), id, description.slice(0, 300), money(item.quantity), money(item.weight), money(item.unitPrice), money(item.lineTotal), dateOrNull(item.expiryDate), index,
      ])
    }
    return { ok: true }
  })

  app.delete('/api/receipts/:id', async (request) => {
    const user = await currentUser(request)
    const result = await exec('DELETE FROM receipts WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Receipt not found')
    return { ok: true }
  })

  app.get('/api/receipts/:id/file', async (request, reply) => {
    const user = await currentUser(request)
    const row = await one<{ stored_path: string | null; file_name: string | null }>('SELECT stored_path, file_name FROM receipts WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    if (!row?.stored_path) throw new HttpError(404, 'No file stored')
    return sendStored(reply, row.stored_path, row.file_name || 'receipt.pdf')
  })
}

function text(value: unknown, max: number): string | null {
  const cleaned = String(value || '').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function dateOrNull(value: unknown): string | null {
  const date = String(value || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function money(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function sendStored(reply: FastifyReply, storedPath: string, fileName: string) {
  const buffer = await readUpload(storedPath)
  reply.header('Content-Type', 'application/pdf')
  reply.header('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`)
  return reply.send(buffer)
}
