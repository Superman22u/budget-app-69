export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new ApiError(response.status, data.error || 'Request failed')
  return data as T
}

export type User = { id: string; firstName: string; lastName: string; email: string; role: 'admin' | 'user' }

export function money(value: number | null | undefined, currency = 'CHF'): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))} ${currency}`
}

export function rateText(rate: number | null | undefined): string {
  if (rate == null) return ''
  return Number(rate).toLocaleString('de-CH', { maximumFractionDigits: 6 })
}

export function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
