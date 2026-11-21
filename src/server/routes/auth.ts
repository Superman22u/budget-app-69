import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { currentUser, sessionCookie } from '../auth.ts'
import { one, exec } from '../db.ts'
import { HttpError } from '../http.ts'
import { newToken, seedUserDefaults, sha256 } from '../seed.ts'
import { mailConfigured, sendPasswordReset } from '../mail.ts'

const attempts = new Map<string, { count: number; resetAt: number }>()

function tooMany(key: string): boolean {
  const now = Date.now()
  const current = attempts.get(key)
  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 })
    return false
  }
  current.count += 1
  return current.count > 20
}

function emailOf(value: unknown): string {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address')
  return email
}

function passwordOf(value: unknown): string {
  const password = String(value || '')
  if (password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters')
  return password
}

type UserRow = { id: string; first_name: string; last_name: string; email: string; role: 'admin' | 'user'; password_hash: string }

function publicUser(user: UserRow) {
  return { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 14 * 24 * 60 * 60,
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.post('/api/auth/register', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    if (!firstName || !lastName) throw new HttpError(400, 'First name and last name are required')
    const email = emailOf(body.email)
    const password = passwordOf(body.password)
    const existing = await one('SELECT id FROM users WHERE email = ?', [email])
    if (existing) throw new HttpError(409, 'An account with that email already exists')
    const id = randomUUID()
    await exec('INSERT INTO users (id, first_name, last_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)', [
      id, firstName.slice(0, 100), lastName.slice(0, 100), email, await bcrypt.hash(password, 10), 'user',
    ])
    await seedUserDefaults(id)
    const token = app.jwt.sign({ sub: id, role: 'user', email }, { expiresIn: '14d' })
    reply.setCookie(sessionCookie, token, cookieOptions())
    return { id, firstName, lastName, email, role: 'user' }
  })

  app.post('/api/auth/login', async (request, reply) => {
    if (tooMany(request.ip)) throw new HttpError(429, 'Too many sign-in attempts. Wait a few minutes.')
    const body = request.body as Record<string, unknown>
    const email = emailOf(body.email)
    const password = String(body.password || '')
    const user = await one<UserRow>('SELECT id, first_name, last_name, email, role, password_hash FROM users WHERE email = ?', [email])
    if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, 'Email or password is wrong')
    const token = app.jwt.sign({ sub: user.id, role: user.role, email: user.email }, { expiresIn: '14d' })
    reply.setCookie(sessionCookie, token, cookieOptions())
    return publicUser(user)
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(sessionCookie, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', async (request) => {
    const session = await currentUser(request)
    const user = await one<UserRow>('SELECT id, first_name, last_name, email, role, password_hash FROM users WHERE id = ?', [session.id])
    if (!user) throw new HttpError(401, 'Sign in required')
    return publicUser(user)
  })

  app.post('/api/auth/forgot', async (request) => {
    const body = request.body as Record<string, unknown>
    const email = emailOf(body.email)
    if (!mailConfigured()) {
      return { ok: true, emailSent: false, message: 'Password email is not set up on this server. An administrator can set a new password for you.' }
    }
    const user = await one<{ id: string }>('SELECT id FROM users WHERE email = ?', [email])
    if (!user) return { ok: true, emailSent: true, message: 'If an account exists for that email, a reset link has been sent.' }
    const token = newToken()
    await exec('INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 2 HOUR))', [randomUUID(), user.id, sha256(token)])
    const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
    const link = `${appUrl}/reset?token=${encodeURIComponent(token)}`
    await sendPasswordReset(email, link)
    return { ok: true, emailSent: true, message: 'If an account exists for that email, a reset link has been sent.' }
  })

  app.post('/api/auth/reset', async (request) => {
    const body = request.body as Record<string, unknown>
    const token = String(body.token || '')
    const password = passwordOf(body.password)
    const row = await one<{ id: string; user_id: string }>('SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()', [sha256(token)])
    if (!row) throw new HttpError(400, 'This reset link is invalid or has expired')
    await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), row.user_id])
    await exec('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [row.id])
    return { ok: true }
  })
}
