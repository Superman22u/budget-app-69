export type Frequency = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
export type Direction = 'expense' | 'income'

export type BudgetEntry = {
  id: string
  firstPayDate: string
  frequency: Frequency
  occurrenceCount: number | null
  untilDate: string | null
  description: string
  contactName: string | null
  direction: Direction
  amount: number
  currency: string
  exchangeRate: number | null
  chfAmount: number
  familyMember: string | null
  category: string | null
  inflationPercent: number
  notes: string | null
}

export type PlanLineDraft = {
  budgetEntryId: string
  dueDate: string
  description: string
  contactName: string | null
  direction: Direction
  currency: string
  amount: number
  exchangeRate: number | null
  chfAmount: number
  familyMember: string | null
  category: string | null
}

const FREQUENCIES = new Set<Frequency>(['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'])

export function isFrequency(value: string): value is Frequency {
  return FREQUENCIES.has(value as Frequency)
}

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function addFrequency(date: string, frequency: Frequency): string {
  const next = new Date(`${date}T00:00:00Z`)
  const day = next.getUTCDate()
  if (frequency === 'once') return date
  if (frequency === 'weekly') next.setUTCDate(day + 7)
  else if (frequency === 'biweekly') next.setUTCDate(day + 14)
  else if (frequency === 'monthly') moveMonth(next, day, 1)
  else if (frequency === 'quarterly') moveMonth(next, day, 3)
  else if (frequency === 'yearly') moveMonth(next, day, 12)
  return next.toISOString().slice(0, 10)
}

function moveMonth(date: Date, day: number, months: number): void {
  const month = date.getUTCMonth()
  date.setUTCDate(1)
  date.setUTCMonth(month + months)
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, last))
}

export function fullYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let years = ty - fy
  if (tm < fm || (tm === fm && td < fd)) years -= 1
  return Math.max(0, years)
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function expandEntry(entry: BudgetEntry, windowStart: string, windowEnd: string): PlanLineDraft[] {
  const lines: PlanLineDraft[] = []
  let due = entry.firstPayDate
  let count = 0
  while (count < 4000) {
    if (entry.occurrenceCount != null && count >= entry.occurrenceCount) break
    if (entry.untilDate && due > entry.untilDate) break
    if (due >= windowEnd) break
    if (due >= windowStart) {
      const factor = Math.pow(1 + (Number(entry.inflationPercent) || 0) / 100, fullYears(entry.firstPayDate, due))
      const magnitude = round2(Number(entry.amount) * factor)
      const chfMagnitude = round2((entry.currency === 'CHF' ? magnitude : Number(entry.chfAmount) * factor))
      const sign = entry.direction === 'expense' ? -1 : 1
      lines.push({
        budgetEntryId: entry.id,
        dueDate: due,
        description: entry.description,
        contactName: entry.contactName,
        direction: entry.direction,
        currency: entry.currency,
        amount: round2(sign * magnitude),
        exchangeRate: entry.currency === 'CHF' ? 1 : entry.exchangeRate,
        chfAmount: round2(sign * chfMagnitude),
        familyMember: entry.familyMember,
        category: entry.category,
      })
    }
    count += 1
    if (entry.frequency === 'once') break
    const next = addFrequency(due, entry.frequency)
    if (next <= due) break
    due = next
  }
  return lines
}

export function frequencyLabel(entry: Pick<BudgetEntry, 'frequency' | 'occurrenceCount' | 'untilDate'>): string {
  const name: Record<Frequency, string> = {
    once: 'Once',
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
  }
  const base = name[entry.frequency]
  if (entry.occurrenceCount) return `${base} · ${entry.occurrenceCount} times`
  if (entry.untilDate) return `${base} · until ${entry.untilDate}`
  if (entry.frequency === 'once') return base
  return `${base} · ongoing`
}
