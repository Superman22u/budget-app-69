import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { currentUser, requireAdmin } from '../auth.ts'
import { exec, many, one } from '../db.ts'
import { HttpError, round2 } from '../http.ts'
import { mailConfigured } from '../mail.ts'
import { addDays, expandEntry, type BudgetEntry, type Frequency } from '../budgetMath.ts'

export function registerAnalysis(app: FastifyInstance): void {
  app.get('/api/analysis', async (request) => {
    const user = await currentUser(request)
    const query = request.query as { from?: string; to?: string }
    const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : `${new Date().getFullYear()}-01-01`
    const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : new Date().toISOString().slice(0, 10)
    const money = `COALESCE(chf_amount, IF(currency = 'CHF', amount, NULL))`
    const categories = await many(`SELECT COALESCE(category, 'Uncategorized') AS category,
        SUM(CASE WHEN ${money} < 0 THEN -${money} ELSE 0 END) AS spent,
        SUM(CASE WHEN ${money} > 0 THEN ${money} ELSE 0 END) AS received
      FROM transactions WHERE user_id = ? AND booking_date BETWEEN ? AND ?
      GROUP BY COALESCE(category, 'Uncategorized') ORDER BY spent DESC`, [user.id, from, to])
    const months = await many(`SELECT DATE_FORMAT(booking_date, '%Y-%m') AS month,
        SUM(CASE WHEN ${money} < 0 THEN -${money} ELSE 0 END) AS spent,
        SUM(CASE WHEN ${money} > 0 THEN ${money} ELSE 0 END) AS received
      FROM transactions WHERE user_id = ? AND booking_date BETWEEN ? AND ?
      GROUP BY DATE_FORMAT(booking_date, '%Y-%m') ORDER BY month`, [user.id, from, to])
    const merchants = await many(`SELECT COALESCE(NULLIF(merchant, ''), description) AS name,
        SUM(CASE WHEN ${money} < 0 THEN -${money} ELSE 0 END) AS spent
      FROM transactions WHERE user_id = ? AND booking_date BETWEEN ? AND ? AND ${money} < 0
      GROUP BY COALESCE(NULLIF(merchant, ''), description) ORDER BY spent DESC LIMIT 12`, [user.id, from, to])
    const providers = await many(`SELECT provider, source_kind AS sourceKind,
        SUM(CASE WHEN ${money} < 0 THEN -${money} ELSE 0 END) AS spent,
        SUM(CASE WHEN ${money} > 0 THEN ${money} ELSE 0 END) AS received
      FROM transactions WHERE user_id = ? AND booking_date BETWEEN ? AND ?
      GROUP BY provider, source_kind ORDER BY spent DESC`, [user.id, from, to])
    const missing = await one<{ total: number }>(`SELECT COUNT(*) AS total FROM transactions WHERE user_id = ? AND booking_date BETWEEN ? AND ? AND ${money} IS NULL`, [user.id, from, to])
    return { from, to, categories, months, merchants, providers, missingChf: Number(missing?.total || 0) }
  })

  app.get('/api/dashboard', async (request) => {
    const user = await currentUser(request)
    const now = new Date()
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const money = `COALESCE(chf_amount, IF(currency = 'CHF', amount, NULL))`
    const totals = await one<{ spent: number | null; received: number | null; uncategorized: number }>(`SELECT
        SUM(CASE WHEN ${money} < 0 THEN -${money} ELSE 0 END) AS spent,
        SUM(CASE WHEN ${money} > 0 THEN ${money} ELSE 0 END) AS received,
        SUM(CASE WHEN category IS NULL THEN 1 ELSE 0 END) AS uncategorized
      FROM transactions WHERE user_id = ? AND booking_date >= ?`, [user.id, from])
    const recent = await many(`SELECT id, booking_date AS bookingDate, description, provider, currency, amount, chf_amount AS chfAmount, category
      FROM transactions WHERE user_id = ? ORDER BY booking_date DESC, id DESC LIMIT 8`, [user.id])
    const entries = await many<BudgetEntry & { first_pay_date: string; occurrence_count: number | null; until_date: string | null; contact_name: string | null; exchange_rate: number | null; chf_amount: number; family_member: string | null; inflation_percent: number }>(`SELECT id, first_pay_date, frequency, occurrence_count, until_date, description, contact_name, direction, amount, currency, exchange_rate, chf_amount, family_member, category, inflation_percent, notes FROM budget_entries WHERE user_id = ?`, [user.id])
    const today = now.toISOString().slice(0, 10)
    const upcoming = entries.flatMap((row) => expandEntry({
      id: row.id,
      firstPayDate: String(row.first_pay_date).slice(0, 10),
      frequency: row.frequency as Frequency,
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
      notes: null,
    }, today, addDays(today, 45))).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6)
    return {
      monthSpent: round2(Number(totals?.spent || 0)),
      monthReceived: round2(Number(totals?.received || 0)),
      uncategorized: Number(totals?.uncategorized || 0),
      recent,
      upcoming,
    }
  })
}

export function registerSettings(app: FastifyInstance): void {
  app.get('/api/settings', async (request) => {
    const user = await currentUser(request)
    const rates = await many('SELECT id, currency, rate_to_chf AS rateToChf, as_of AS asOf FROM exchange_rates WHERE user_id = ? ORDER BY currency, as_of DESC', [user.id])
    const categories = await many('SELECT id, name, kind FROM categories WHERE user_id = ? ORDER BY kind, name', [user.id])
    const family = await many('SELECT id, name FROM family_members WHERE user_id = ? ORDER BY name', [user.id])
    const rules = await many('SELECT id, pattern, category, priority FROM category_rules WHERE user_id = ? ORDER BY priority DESC, pattern', [user.id])
    return { rates, categories, family, rules, emailEnabled: mailConfigured() }
  })

  app.post('/api/rates', async (request) => {
    const user = await currentUser(request)
    const body = request.body as Record<string, unknown>
    const currency = String(body.currency || '').trim().toUpperCase()
    const rate = Number(body.rateToChf)
    const asOf = String(body.asOf || new Date().toISOString().slice(0, 10))
    if (!/^[A-Z]{3}$/.test(currency) || currency === 'CHF') throw new HttpError(400, 'Enter a foreign currency code')
    if (!Number.isFinite(rate) || rate <= 0) throw new HttpError(400, 'Enter how many CHF one unit is worth')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new HttpError(400, 'Enter the rate date')
    await exec('INSERT INTO exchange_rates (id, user_id, currency, rate_to_chf, as_of) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rate_to_chf = VALUES(rate_to_chf)', [randomUUID(), user.id, currency, rate, asOf])
    const result = await exec('UPDATE transactions SET exchange_rate = ?, chf_amount = ROUND(amount * ?, 2) WHERE user_id = ? AND currency = ? AND chf_amount IS NULL', [rate, rate, user.id, currency])
    return { updatedTransactions: result.affectedRows }
  })

  app.delete('/api/rates/:id', async (request) => {
    const user = await currentUser(request)
    await exec('DELETE FROM exchange_rates WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    return { ok: true }
  })

  app.post('/api/categories', async (request) => {
    const user = await currentUser(request)
    const body = request.body as Record<string, unknown>
    const name = String(body.name || '').trim().slice(0, 80)
    const kind = body.kind === 'budget' ? 'budget' : 'spending'
    if (!name) throw new HttpError(400, 'Category name is required')
    await exec('INSERT IGNORE INTO categories (id, user_id, name, kind) VALUES (?, ?, ?, ?)', [randomUUID(), user.id, name, kind])
    return { ok: true }
  })

  app.delete('/api/categories/:id', async (request) => {
    const user = await currentUser(request)
    await exec('DELETE FROM categories WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    return { ok: true }
  })

  app.post('/api/family', async (request) => {
    const user = await currentUser(request)
    const name = String((request.body as { name?: string }).name || '').trim().slice(0, 120)
    if (!name) throw new HttpError(400, 'Name is required')
    await exec('INSERT IGNORE INTO family_members (id, user_id, name) VALUES (?, ?, ?)', [randomUUID(), user.id, name])
    return { ok: true }
  })

  app.delete('/api/family/:id', async (request) => {
    const user = await currentUser(request)
    await exec('DELETE FROM family_members WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    return { ok: true }
  })

  app.delete('/api/rules/:id', async (request) => {
    const user = await currentUser(request)
    await exec('DELETE FROM category_rules WHERE id = ? AND user_id = ?', [(request.params as { id: string }).id, user.id])
    return { ok: true }
  })
}

export function registerAdmin(app: FastifyInstance): void {
  app.get('/api/admin/users', async (request) => {
    await requireAdmin(request)
    const users = await many('SELECT id, first_name AS firstName, last_name AS lastName, email, role, created_at AS createdAt FROM users ORDER BY created_at')
    return { users }
  })

  app.patch('/api/admin/users/:id', async (request) => {
    const admin = await requireAdmin(request)
    const { id } = request.params as { id: string }
    const user = await one<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ?', [id])
    if (!user) throw new HttpError(404, 'User not found')
    const body = request.body as Record<string, unknown>
    const firstName = String(body.firstName || '').trim().slice(0, 100)
    const lastName = String(body.lastName || '').trim().slice(0, 100)
    const email = String(body.email || '').trim().toLowerCase()
    const role = body.role === 'admin' ? 'admin' : 'user'
    if (!firstName || !lastName) throw new HttpError(400, 'First name and last name are required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address')
    if (admin.id === id && role !== 'admin') throw new HttpError(400, 'You cannot remove your own administrator role')
    const clash = await one<{ id: string }>('SELECT id FROM users WHERE email = ? AND id <> ?', [email, id])
    if (clash) throw new HttpError(409, 'Another account already uses that email')
    await exec('UPDATE users SET first_name = ?, last_name = ?, email = ?, role = ? WHERE id = ?', [firstName, lastName, email, role, id])
    if (body.password) {
      const password = String(body.password)
      if (password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters')
      await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), id])
    }
    return { ok: true }
  })

  app.delete('/api/admin/users/:id', async (request) => {
    const admin = await requireAdmin(request)
    const { id } = request.params as { id: string }
    if (admin.id === id) throw new HttpError(400, 'You cannot delete your own account')
    const user = await one<{ role: string }>('SELECT role FROM users WHERE id = ?', [id])
    if (!user) throw new HttpError(404, 'User not found')
    if (user.role === 'admin') {
      const admins = await one<{ total: number }>('SELECT COUNT(*) AS total FROM users WHERE role = ?', ['admin'])
      if (Number(admins?.total || 0) <= 1) throw new HttpError(400, 'Keep at least one administrator')
    }
    await exec('DELETE FROM users WHERE id = ?', [id])
    return { ok: true }
  })
}
