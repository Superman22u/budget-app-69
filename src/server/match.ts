import { randomUUID } from 'node:crypto'
import { exec, many } from './db.ts'
import { round2 } from './http.ts'
import { addFrequency, type Frequency } from './budgetMath.ts'

const PROVIDERS: [string, string][] = [
  ['liberty', 'Liberty'],
  ['cornèr', 'Liberty'],
  ['corner', 'Liberty'],
  ['bonuscard', 'Liberty'],
  ['viseca', 'Viseca'],
  ['swisscard', 'Swisscard'],
  ['revolut', 'Revolut'],
  ['raiffeisen', 'Raiffeisen'],
  ['ubs visa', 'UBS Visa'],
]

const STOP = new Set(['with', 'from', 'this', 'that', 'und', 'für', 'fuer', 'der', 'die', 'das', 'monthly', 'monat', 'monatlich', 'amount', 'credit', 'card', 'karte', 'kreditkarte', 'budget', 'payment', 'zahlung', 'family', 'schweiz', 'swiss'])

type Line = {
  id: string
  budgetEntryId: string | null
  dueDate: string
  description: string
  contactName: string | null
  direction: string
  frequency: Frequency | null
}

type Tx = {
  id: string
  bookingDate: string
  description: string
  merchant: string | null
  provider: string
  amount: number
  chf: number | null
}

export async function autoMatchPlan(userId: string, planId: string): Promise<{ linked: number }> {
  const lines = await many<Line>(`SELECT l.id, l.budget_entry_id AS budgetEntryId, l.due_date AS dueDate,
      l.description, l.contact_name AS contactName, l.direction, e.frequency
    FROM budget_plan_lines l
    LEFT JOIN budget_entries e ON e.id = l.budget_entry_id
    WHERE l.plan_id = ? ORDER BY l.due_date, l.id`, [planId])
  await exec('DELETE FROM budget_links WHERE plan_id = ? AND source = ?', [planId, 'auto'])
  const grouped = new Map<string, Line[]>()
  for (const line of lines) {
    const key = line.budgetEntryId || line.id
    grouped.set(key, [...(grouped.get(key) || []), line])
  }
  let linked = 0
  for (const group of grouped.values()) {
    for (let index = 0; index < group.length; index++) {
      const line = group[index]
      const start = line.dueDate
      const end = group[index + 1]?.dueDate || addFrequency(line.dueDate, line.frequency || 'monthly')
      const text = `${line.description} ${line.contactName || ''}`
      const provider = providerFrom(text)
      const tokens = words(text)
      if (!provider && !tokens.length) continue
      const rows = await many<Tx>(`SELECT t.id, t.booking_date AS bookingDate, t.description, t.merchant, t.provider, t.amount,
          COALESCE(t.chf_amount, IF(t.currency = 'CHF', t.amount, NULL)) AS chf
        FROM transactions t
        WHERE t.user_id = ? AND t.booking_date >= ? AND t.booking_date < ?
          AND NOT EXISTS (SELECT 1 FROM budget_links b WHERE b.plan_id = ? AND b.transaction_id = t.id)`, [userId, start, end, planId])
      const chosen = rows.filter((row) => {
        if (line.direction === 'expense' && !(row.amount < 0)) return false
        if (line.direction === 'income' && !(row.amount > 0)) return false
        if (provider) return row.provider === provider
        const haystack = `${row.description} ${row.merchant || ''}`.toLowerCase()
        return tokens.some((token) => haystack.includes(token))
      })
      for (const row of chosen) {
        await exec('INSERT IGNORE INTO budget_links (id, plan_id, plan_line_id, transaction_id, source) VALUES (?, ?, ?, ?, ?)', [randomUUID(), planId, line.id, row.id, 'auto'])
        linked += 1
      }
    }
  }
  await recalcPlan(planId)
  return { linked }
}

export async function setLineLinks(planId: string, lineId: string, transactionIds: string[]): Promise<void> {
  await exec('DELETE FROM budget_links WHERE plan_line_id = ?', [lineId])
  for (const transactionId of transactionIds) {
    await exec('INSERT IGNORE INTO budget_links (id, plan_id, plan_line_id, transaction_id, source) VALUES (?, ?, ?, ?, ?)', [randomUUID(), planId, lineId, transactionId, 'manual'])
  }
  await recalcLine(lineId)
}

export async function recalcPlan(planId: string): Promise<void> {
  const lines = await many<{ id: string }>('SELECT id FROM budget_plan_lines WHERE plan_id = ?', [planId])
  for (const line of lines) await recalcLine(line.id)
}

export async function recalcLine(lineId: string): Promise<void> {
  const rows = await many<{ chf: number | null }>('SELECT COALESCE(t.chf_amount, IF(t.currency = \'CHF\', t.amount, NULL)) AS chf FROM budget_links b JOIN transactions t ON t.id = b.transaction_id WHERE b.plan_line_id = ?', [lineId])
  if (!rows.length) {
    await exec('UPDATE budget_plan_lines SET actual_chf = NULL WHERE id = ?', [lineId])
    return
  }
  const known = rows.filter((row) => row.chf != null)
  await exec('UPDATE budget_plan_lines SET actual_chf = ? WHERE id = ?', [known.length ? round2(known.reduce((sum, row) => sum + Number(row.chf), 0)) : null, lineId])
}

function providerFrom(text: string): string | null {
  const haystack = text.toLowerCase()
  if (/\bubs\b/.test(haystack) && /visa|kreditkarte|credit card/.test(haystack)) return 'UBS Visa'
  for (const [needle, provider] of PROVIDERS) {
    if (haystack.includes(needle)) return provider
  }
  return null
}

function words(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9äöüéèàáâêîôû.+-]+/gi, ' ').split(/\s+/).filter((word) => word.length >= 4 && !STOP.has(word)))]
}
