import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { exec, many } from './db.ts'

export const SPENDING_CATEGORIES = [
  'Grocery',
  'Food',
  'Beer',
  'Restaurant',
  'Health',
  'Insurance',
  'Transport',
  'Telecom',
  'Housing',
  'Sport',
  'Entertainment',
  'Shopping',
  'Cash',
  'Transfer',
  'Fees',
  'Income',
  'Other',
]

export const BUDGET_CATEGORIES = [
  'Luxury',
  'Living',
  'Grocery',
  'Insurance',
  'Health',
  'Transport',
  'Telecom',
  'Subscriptions',
  'Savings',
  'Income',
  'Other',
]

const RULES: [string, string, number][] = [
  ['migros', 'Grocery', 20],
  ['coop', 'Grocery', 20],
  ['lidl', 'Grocery', 20],
  ['aldi', 'Grocery', 20],
  ['denner', 'Grocery', 20],
  ['volg', 'Grocery', 20],
  ['otto', 'Grocery', 12],
  ['bierhalle', 'Beer', 30],
  [' pub', 'Beer', 20],
  ['pub ', 'Beer', 18],
  ['lounge', 'Beer', 16],
  ['brauerei', 'Beer', 20],
  ['restaurant', 'Restaurant', 18],
  ['ristorante', 'Restaurant', 18],
  ['pizzeria', 'Restaurant', 20],
  ['brasserie', 'Restaurant', 18],
  ['gastro', 'Restaurant', 14],
  ['bäckerei', 'Food', 16],
  ['baeckerei', 'Food', 16],
  ['zahnarzt', 'Health', 24],
  ['osteopath', 'Health', 24],
  ['apotheke', 'Health', 18],
  ['drogerie', 'Health', 16],
  ['spital', 'Health', 18],
  ['swica', 'Insurance', 16],
  ['versicherung', 'Insurance', 16],
  ['krankenversicherung', 'Insurance', 20],
  ['pax', 'Insurance', 14],
  ['sbb', 'Transport', 18],
  ['cff ffs', 'Transport', 18],
  ['parkhaus', 'Transport', 14],
  ['parking', 'Transport', 12],
  ['bancomat', 'Cash', 20],
  ['bargeldbezug', 'Cash', 20],
  ['fitness', 'Sport', 16],
  ['netflix', 'Entertainment', 20],
  ['spotify', 'Entertainment', 20],
  ['wingo', 'Telecom', 18],
  ['swisscom', 'Telecom', 18],
  ['sunrise', 'Telecom', 16],
  ['digitec', 'Shopping', 16],
  ['interdiscount', 'Shopping', 16],
  ['galaxus', 'Shopping', 16],
  ['manor', 'Shopping', 12],
  ['miete', 'Housing', 18],
  ['hypothek', 'Housing', 18],
  ['elektriz', 'Housing', 16],
  ['mahnspesen', 'Fees', 18],
  ['dienstleistungspreis', 'Fees', 16],
  ['gebühr', 'Fees', 10],
  ['gebuehr', 'Fees', 10],
  ['portokosten', 'Fees', 14],
]

export function suggestCategory(text: string, rules: { pattern: string; category: string; priority: number }[]): string | null {
  const haystack = ` ${text.toLowerCase()} `
  let best: { category: string; score: number } | null = null
  for (const rule of rules) {
    const pattern = rule.pattern.toLowerCase()
    if (!pattern || !haystack.includes(pattern)) continue
    const score = rule.priority * 1000 + pattern.length
    if (!best || score > best.score) best = { category: rule.category, score }
  }
  return best?.category ?? null
}

export async function seedUserDefaults(userId: string): Promise<void> {
  for (const name of SPENDING_CATEGORIES) {
    await exec('INSERT IGNORE INTO categories (id, user_id, name, kind) VALUES (?, ?, ?, ?)', [randomUUID(), userId, name, 'spending'])
  }
  for (const name of BUDGET_CATEGORIES) {
    await exec('INSERT IGNORE INTO categories (id, user_id, name, kind) VALUES (?, ?, ?, ?)', [randomUUID(), userId, name, 'budget'])
  }
  for (const [pattern, category, priority] of RULES) {
    await exec(
      'INSERT IGNORE INTO category_rules (id, user_id, pattern, category, priority) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), userId, pattern, category, priority],
    )
  }
}

export async function seedAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || 'rene@rene-unternaehrer.ch').trim().toLowerCase()
  const existing = await many<{ id: string }>('SELECT id FROM users WHERE email = ?', [email])
  if (existing.length) return
  const password = process.env.ADMIN_INITIAL_PASSWORD?.trim()
  if (!password || password.length < 8) {
    throw new Error('Set ADMIN_INITIAL_PASSWORD in the environment before the first start.')
  }
  const id = randomUUID()
  const hash = await bcrypt.hash(password, 10)
  await exec(
    'INSERT INTO users (id, first_name, last_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'Ren', 'Unternährer', email, hash, 'admin'],
  )
  await seedUserDefaults(id)
  await mkdir(path.resolve('data'), { recursive: true })
  await writeFile(
    path.resolve('data/admin-password.txt'),
    `Administrator\nEmail: ${email}\nPassword: ${password}\n\nThis file was written when the administrator account was created.\nEditing this file does not change the password.\n`,
    'utf8',
  )
  console.log(`Created administrator ${email}. Password written to data/admin-password.txt`)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}
