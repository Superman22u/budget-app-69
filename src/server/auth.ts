import type { FastifyRequest } from 'fastify'
import { HttpError } from './http.ts'

export type Authed = { id: string; role: 'admin' | 'user'; email: string }

export async function currentUser(req: FastifyRequest): Promise<Authed> {
  const token = req.cookies?.token
  if (!token) throw new HttpError(401, 'Sign in required')
  try {
    const payload = req.server.jwt.verify<{ sub: string; role: 'admin' | 'user'; email: string }>(token)
    return { id: payload.sub, role: payload.role, email: payload.email }
  } catch {
    throw new HttpError(401, 'Sign in required')
  }
}

export async function requireAdmin(req: FastifyRequest): Promise<Authed> {
  const user = await currentUser(req)
  if (user.role !== 'admin') throw new HttpError(403, 'Administrator only')
  return user
}
