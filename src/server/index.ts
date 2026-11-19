import 'dotenv/config'
import path from 'node:path'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { migrate, waitForDatabase } from './db.ts'
import { HttpError } from './http.ts'
import { seedAdmin } from './seed.ts'
import { registerAuth } from './routes/auth.ts'
import { registerBudget } from './routes/budget.ts'
import { registerTransactions } from './routes/transactions.ts'
import { registerHealthcare, registerReceipts } from './routes/records.ts'
import { registerAdmin, registerAnalysis, registerSettings } from './routes/rest.ts'

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL')
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) throw new Error('Set JWT_SECRET to a long random value')

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 })
await app.register(cookie)
await app.register(jwt, { secret: process.env.JWT_SECRET })
await app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } })

app.setErrorHandler((error, request, reply) => {
  const message = error instanceof Error ? error.message : 'Request failed'
  if (error instanceof HttpError) return reply.code(error.status).send({ error: message })
  const statusCode = (error as { statusCode?: number }).statusCode
  if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: message })
  request.log.error(error)
  return reply.code(500).send({ error: 'Something went wrong' })
})

app.get('/api/health', async () => ({ ok: true }))
registerAuth(app)
registerBudget(app)
registerTransactions(app)
registerHealthcare(app)
registerReceipts(app)
registerAnalysis(app)
registerSettings(app)
registerAdmin(app)

const clientDir = path.resolve('dist/client')
if (existsSync(path.join(clientDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: clientDir })
}
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' })
  if (existsSync(path.join(clientDir, 'index.html'))) return reply.sendFile('index.html')
  return reply.code(404).send({ error: 'Not found' })
})

await waitForDatabase()
await migrate()
await seedAdmin()
const port = Number(process.env.PORT || 3001)
await app.listen({ port, host: '0.0.0.0' })
