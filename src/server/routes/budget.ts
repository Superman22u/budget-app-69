import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import ExcelJS from 'exceljs'
import { currentUser } from '../auth.ts'
import { addDays, expandEntry, frequencyLabel, isFrequency, type BudgetEntry, type Frequency } from '../budgetMath.ts'
import { exec, many, one } from '../db.ts'
import { HttpError, round2 } from '../http.ts'
import { autoMatchPlan, setLineLinks } from '../match.ts'

type EntryRow = {
  id: string
  first_pay_date: string
  frequency: Frequency
  occurrence_count: number | null
  until_date: string | null
  description: string
  contact_name: string | null
  direction: 'expense' | 'income'
  amount: number
  currency: string
  exchange_rate: number | null
  chf_amount: number
  family_member: string | null
  category: string | null
  inflation_percent: number
  notes: string | null
}

function toEntry(row: EntryRow): BudgetEntry {
  return {
    id: row.id,
    firstPayDate: String(row.first_pay_date).slice(0, 10),
    frequency: row.frequency,
    occurrenceCount: row.occurrence_count == null ? null : Number(row.occurrence_count),
    untilDate: row.until_date ? String(row.until_date).slice(0, 10) : null,
    description: row.description,
    contactName: row.contact_name,
    direction: row.direction,
    amount: Number(row.amount),
    currency: row.currency,
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    chfAmount: Number(row.chf_amount),
    familyMember: row.family_member,
    category: row.category,
    inflationPercent: Number(row.inflation_percent),
    notes: row.notes,
  }
}

function readEntry(body: Record<string, unknown>) {
  const description = String(body.description || '').trim()
  if (!description) throw new HttpError(400, 'Description is required')
  const firstPayDate = String(body.firstPayDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstPayDate)) throw new HttpError(400, 'First pay date is required')
  const frequency = String(body.frequency || '')
  if (!isFrequency(frequency)) throw new HttpError(400, 'Choose how often this is paid')
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Amount must be greater than zero')
  const currency = String(body.currency || 'CHF').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency is a 3-letter code such as CHF, EUR, or USD')
  const direction = body.direction === 'income' ? 'income' : 'expense'
  let exchangeRate = body.exchangeRate == null || body.exchangeRate === '' ? null : Number(body.exchangeRate)
  if (currency === 'CHF') exchangeRate = 1
  else if (!exchangeRate || exchangeRate <= 0) throw new HttpError(400, 'Enter how many CHF one unit of this currency is worth')
  const endMode = String(body.endMode || 'open')
  let occurrenceCount: number | null = null
  let untilDate: string | null = null
  if (endMode === 'count') {
    occurrenceCount = Number(body.occurrenceCount)
    if (!Number.isInteger(occurrenceCount) || occurrenceCount < 1) throw new HttpError(400, 'Enter how many times it is paid')
  } else if (endMode === 'until') {
    untilDate = String(body.untilDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) throw new HttpError(400, 'Enter the last date')
  }
  const inflationPercent = body.inflationPercent == null || body.inflationPercent === '' ? 0 : Number(body.inflationPercent)
  if (!Number.isFinite(inflationPercent) || inflationPercent < 0 || inflationPercent > 100) throw new HttpError(400, 'Inflation percent should be between 0 and 100')
  return {
    firstPayDate,
    frequency,
    occurrenceCount,
    untilDate,
    description: description.slice(0, 500),
    contactName: String(body.contactName || '').trim().slice(0, 255) || null,
    direction,
    amount: round2(amount),
    currency,
    exchangeRate,
    chfAmount: round2(currency === 'CHF' ? amount : amount * (exchangeRate || 0)),
    familyMember: String(body.familyMember || '').trim().slice(0, 120) || null,
    category: String(body.category || '').trim().slice(0, 80) || null,
    inflationPercent,
    notes: String(body.notes || '').trim().slice(0, 2000) || null,
  }
}

async function rememberFamily(userId: string, name: string | null) {
  if (!name) return
  await exec('INSERT IGNORE INTO family_members (id, user_id, name) VALUES (?, ?, ?)', [randomUUID(), userId, name])
}

const ENTRY_SQL = `SELECT id, first_pay_date, frequency, occurrence_count, until_date, description, contact_name, direction,
  amount, currency, exchange_rate, chf_amount, family_member, category, inflation_percent, notes FROM budget_entries`

export function registerBudget(app: FastifyInstance): void {
  app.get('/api/budget', async (request) => {
    const user = await currentUser(request)
    const query = request.query as { q?: string }
    const term = String(query.q || '').trim()
    const params: unknown[] = [user.id]
    let where = 'WHERE user_id = ?'
    if (term) {
      where += ' AND (description LIKE ? OR contact_name LIKE ? OR family_member LIKE ? OR category LIKE ? OR currency LIKE ?)'
      const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
      params.push(like, like, like, like, like)
    }
    const rows = await many<EntryRow>(`${ENTRY_SQL} ${where} ORDER BY first_pay_date, description`, params)
    const categories = await many<{ name: string }>('SELECT name FROM categories WHERE user_id = ? AND kind = ? ORDER BY name', [user.id, 'budget'])
    const family = await many<{ name: string }>('SELECT name FROM family_members WHERE user_id = ? ORDER BY name', [user.id])
    const plans = await many('SELECT id, title, start_date AS startDate, days, start_amount AS startAmount, created_at AS createdAt FROM budget_plans WHERE user_id = ? ORDER BY created_at DESC', [user.id])
    return {
      entries: rows.map((row) => ({ ...toEntry(row), schedule: frequencyLabel(toEntry(row)) })),
      categories: categories.map((row) => row.name),
      family: family.map((row) => row.name),
      plans,
    }
  })

  app.get('/api/budget/export', async (request, reply) => {
    const user = await currentUser(request)
    const rows = await many<EntryRow>(`${ENTRY_SQL} WHERE user_id = ? ORDER BY first_pay_date, description`, [user.id])
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Budget entries')
    sheet.columns = [
      { header: 'First pay date', key: 'date', width: 16 },
      { header: 'Schedule', key: 'schedule', width: 28 },
      { header: 'Description', key: 'description', width: 36 },
      { header: 'Contact', key: 'contact', width: 24 },
      { header: 'For', key: 'family', width: 18 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Direction', key: 'direction', width: 12 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Currency', key: 'currency', width: 12 },
      { header: 'Exchange rate', key: 'rate', width: 16 },
      { header: 'CHF', key: 'chf', width: 14 },
      { header: 'Yearly increase %', key: 'inflation', width: 18 },
      { header: 'Notes', key: 'notes', width: 30 },
    ]
    for (const row of rows) {
      const entry = toEntry(row)
      sheet.addRow({
        date: entry.firstPayDate,
        schedule: frequencyLabel(entry),
        description: entry.description,
        contact: entry.contactName,
        family: entry.familyMember,
        category: entry.category,
        direction: entry.direction,
        amount: entry.amount,
        currency: entry.currency,
        rate: entry.currency === 'CHF' ? 1 : entry.exchangeRate,
        chf: entry.chfAmount,
        inflation: entry.inflationPercent,
        notes: entry.notes,
      })
    }
    sheet.getRow(1).font = { bold: true }
    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', 'attachment; filename="budget-entries.xlsx"')
    return reply.send(Buffer.from(buffer))
  })

  app.post('/api/budget', async (request, reply) => {
    const user = await currentUser(request)
    const entry = readEntry(request.body as Record<string, unknown>)
    const id = randomUUID()
    await exec(`INSERT INTO budget_entries (id, user_id, first_pay_date, frequency, occurrence_count, until_date, description, contact_name, direction, amount, currency, exchange_rate, chf_amount, family_member, category, inflation_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, user.id, entry.firstPayDate, entry.frequency, entry.occurrenceCount, entry.untilDate, entry.description, entry.contactName, entry.direction, entry.amount, entry.currency, entry.exchangeRate, entry.chfAmount, entry.familyMember, entry.category, entry.inflationPercent, entry.notes,
    ])
    await rememberFamily(user.id, entry.familyMember)
    reply.code(201)
    return { id }
  })

  app.put('/api/budget/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const owned = await one('SELECT id FROM budget_entries WHERE id = ? AND user_id = ?', [id, user.id])
    if (!owned) throw new HttpError(404, 'Budget entry not found')
    const entry = readEntry(request.body as Record<string, unknown>)
    await exec(`UPDATE budget_entries SET first_pay_date=?, frequency=?, occurrence_count=?, until_date=?, description=?, contact_name=?, direction=?, amount=?, currency=?, exchange_rate=?, chf_amount=?, family_member=?, category=?, inflation_percent=?, notes=? WHERE id=?`, [
      entry.firstPayDate, entry.frequency, entry.occurrenceCount, entry.untilDate, entry.description, entry.contactName, entry.direction, entry.amount, entry.currency, entry.exchangeRate, entry.chfAmount, entry.familyMember, entry.category, entry.inflationPercent, entry.notes, id,
    ])
    await rememberFamily(user.id, entry.familyMember)
    return { ok: true }
  })

  app.delete('/api/budget/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const result = await exec('DELETE FROM budget_entries WHERE id = ? AND user_id = ?', [id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Budget entry not found')
    return { ok: true }
  })

  app.post('/api/budget-plans', async (request, reply) => {
    const user = await currentUser(request)
    const body = request.body as Record<string, unknown>
    const startDate = String(body.startDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new HttpError(400, 'Start date is required')
    const days = Number(body.days)
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(400, 'Days should be between 1 and 3650')
    const startAmount = Number(body.startAmount)
    if (!Number.isFinite(startAmount)) throw new HttpError(400, 'Starting amount is required')
    const title = String(body.title || `Budget from ${startDate}`).trim().slice(0, 200)
    const rows = await many<EntryRow>(`${ENTRY_SQL} WHERE user_id = ?`, [user.id])
    const windowEnd = addDays(startDate, days)
    const drafts = rows.flatMap((row) => expandEntry(toEntry(row), startDate, windowEnd)).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description))
    const planId = randomUUID()
    await exec('INSERT INTO budget_plans (id, user_id, title, start_date, days, start_amount) VALUES (?, ?, ?, ?, ?, ?)', [planId, user.id, title, startDate, days, round2(startAmount)])
    for (const line of drafts) {
      await exec(`INSERT INTO budget_plan_lines (id, plan_id, budget_entry_id, due_date, description, contact_name, direction, currency, amount, exchange_rate, chf_amount, family_member, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        randomUUID(), planId, line.budgetEntryId, line.dueDate, line.description, line.contactName, line.direction, line.currency, line.amount, line.exchangeRate, line.chfAmount, line.familyMember, line.category,
      ])
    }
    reply.code(201)
    return { id: planId, lines: drafts.length }
  })

  app.get('/api/budget-plans/:id', async (request) => {
    const user = await currentUser(request)
    return loadPlan(user.id, (request.params as { id: string }).id)
  })

  app.delete('/api/budget-plans/:id', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const result = await exec('DELETE FROM budget_plans WHERE id = ? AND user_id = ?', [id, user.id])
    if (!result.affectedRows) throw new HttpError(404, 'Budget list not found')
    return { ok: true }
  })

  app.get('/api/budget-plans/:id/export', async (request, reply) => {
    const user = await currentUser(request)
    const payload = await loadPlan(user.id, (request.params as { id: string }).id)
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Budget list')
    sheet.addRow(['Title', payload.plan.title])
    sheet.addRow(['Start date', payload.plan.startDate])
    sheet.addRow(['Days', payload.plan.days])
    sheet.addRow(['Starting CHF', payload.plan.startAmount])
    sheet.addRow([])
    sheet.addRow(['Date', 'Description', 'Contact', 'For', 'Category', 'Direction', 'Currency', 'Amount', 'Exchange rate', 'Budget CHF', 'Actual CHF', 'Budget balance', 'Balance with actuals'])
    sheet.getRow(6).font = { bold: true }
    for (const line of payload.lines) {
      sheet.addRow([line.dueDate, line.description, line.contactName, line.familyMember, line.category, line.direction, line.currency, line.amount, line.exchangeRate, line.chfAmount, line.actualChf, line.runningBudget, line.runningActual])
    }
    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="budget-list.xlsx"`)
    return reply.send(Buffer.from(buffer))
  })

  app.post('/api/budget-plans/:id/auto-match', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const plan = await one('SELECT id FROM budget_plans WHERE id = ? AND user_id = ?', [id, user.id])
    if (!plan) throw new HttpError(404, 'Budget list not found')
    return autoMatchPlan(user.id, id)
  })

  app.post('/api/budget-plans/:id/clear-matches', async (request) => {
    const user = await currentUser(request)
    const { id } = request.params as { id: string }
    const plan = await one('SELECT id FROM budget_plans WHERE id = ? AND user_id = ?', [id, user.id])
    if (!plan) throw new HttpError(404, 'Budget list not found')
    await exec('DELETE FROM budget_links WHERE plan_id = ?', [id])
    await exec('UPDATE budget_plan_lines SET actual_chf = NULL WHERE plan_id = ?', [id])
    return { ok: true }
  })

  app.put('/api/budget-plans/:planId/lines/:lineId/links', async (request) => {
    const user = await currentUser(request)
    const { planId, lineId } = request.params as { planId: string; lineId: string }
    const plan = await one('SELECT id FROM budget_plans WHERE id = ? AND user_id = ?', [planId, user.id])
    if (!plan) throw new HttpError(404, 'Budget list not found')
    const line = await one('SELECT id FROM budget_plan_lines WHERE id = ? AND plan_id = ?', [lineId, planId])
    if (!line) throw new HttpError(404, 'Budget row not found')
    const ids = ((request.body as { transactionIds?: unknown }).transactionIds || []) as unknown[]
    const transactionIds = ids.map(String).slice(0, 200)
    if (transactionIds.length) {
      const owned = await many<{ id: string }>(`SELECT id FROM transactions WHERE user_id = ? AND id IN (${transactionIds.map(() => '?').join(',')})`, [user.id, ...transactionIds])
      if (owned.length !== new Set(transactionIds).size) throw new HttpError(400, 'One of those transactions is not yours')
    }
    await setLineLinks(planId, lineId, transactionIds)
    return { ok: true }
  })
}

async function loadPlan(userId: string, planId: string) {
  const plan = await one<{ id: string; title: string; start_date: string; days: number; start_amount: number }>('SELECT id, title, start_date, days, start_amount FROM budget_plans WHERE id = ? AND user_id = ?', [planId, userId])
  if (!plan) throw new HttpError(404, 'Budget list not found')
  const lines = await many<{
    id: string
    due_date: string
    description: string
    contact_name: string | null
    direction: string
    currency: string
    amount: number
    exchange_rate: number | null
    chf_amount: number
    actual_chf: number | null
    family_member: string | null
    category: string | null
  }>('SELECT id, due_date, description, contact_name, direction, currency, amount, exchange_rate, chf_amount, actual_chf, family_member, category FROM budget_plan_lines WHERE plan_id = ? ORDER BY due_date, description', [planId])
  const links = await many<{ plan_line_id: string; id: string; booking_date: string; description: string; amount: number; currency: string; chf_amount: number | null; provider: string }>('SELECT b.plan_line_id, t.id, t.booking_date, t.description, t.amount, t.currency, t.chf_amount, t.provider FROM budget_links b JOIN transactions t ON t.id = b.transaction_id WHERE b.plan_id = ?', [planId])
  const byLine = new Map<string, typeof links>()
  for (const link of links) byLine.set(link.plan_line_id, [...(byLine.get(link.plan_line_id) || []), link])
  let runningBudget = Number(plan.start_amount)
  let runningActual = Number(plan.start_amount)
  return {
    plan: { id: plan.id, title: plan.title, startDate: String(plan.start_date).slice(0, 10), days: Number(plan.days), startAmount: Number(plan.start_amount) },
    lines: lines.map((line) => {
      const chf = Number(line.chf_amount)
      const actual = line.actual_chf == null ? null : Number(line.actual_chf)
      runningBudget = round2(runningBudget + chf)
      runningActual = round2(runningActual + (actual == null ? chf : actual))
      return {
        id: line.id,
        dueDate: String(line.due_date).slice(0, 10),
        description: line.description,
        contactName: line.contact_name,
        direction: line.direction,
        currency: line.currency,
        amount: Number(line.amount),
        exchangeRate: line.exchange_rate == null ? null : Number(line.exchange_rate),
        chfAmount: chf,
        actualChf: actual,
        familyMember: line.family_member,
        category: line.category,
        runningBudget,
        runningActual,
        links: (byLine.get(line.id) || []).map((link) => ({
          id: link.id,
          bookingDate: String(link.booking_date).slice(0, 10),
          description: link.description,
          amount: Number(link.amount),
          currency: link.currency,
          chfAmount: link.chf_amount == null ? null : Number(link.chf_amount),
          provider: link.provider,
        })),
      }
    }),
  }
}
