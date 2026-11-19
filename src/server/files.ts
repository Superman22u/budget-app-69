import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { HttpError } from './http.ts'

export async function storeUpload(userId: string, originalName: string, buffer: Buffer): Promise<string> {
  const extension = (path.extname(originalName).toLowerCase() || '.bin').slice(0, 8)
  const relative = path.posix.join('uploads', userId, `${randomUUID()}${extension}`)
  const full = resolveUpload(relative)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, buffer)
  return relative
}

export function resolveUpload(relative: string): string {
  const root = path.resolve('data')
  const full = path.resolve(root, relative)
  const fromRoot = path.relative(root, full)
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new HttpError(400, 'Bad file path')
  return full
}

export async function readUpload(relative: string): Promise<Buffer> {
  return readFile(resolveUpload(relative))
}
