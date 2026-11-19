export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function asNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function asNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\s*;\s*/g, ', ').replace(/\s+,/g, ',').trim()
}

export function normalizeKey(value: string): string {
  return cleanText(value).toLowerCase()
}

export function compactIban(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.toUpperCase().replace(/[^A-Z0-9]/g, ' ').match(/CH\d{2}(?:\s*[A-Z0-9]){17}/)
  if (!match) return null
  return match[0].replace(/\s+/g, '')
}

export function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}
