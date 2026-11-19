import { round2 } from '../http.ts'

export function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8').replace(/^\uFEFF/, '')
  if (utf8.includes('\uFFFD')) return buffer.toString('latin1')
  return utf8
}

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') cell += char
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''))
}

export function detectDelimiter(text: string): string {
  if (/^sep=\s*;/im.test(text)) return ';'
  const sample = text.split(/\r?\n/).find((line) => /betrag|buchungsdatum|amount|beschreibung|transaktionsdatum/i.test(line)) || ''
  const semis = (sample.match(/;/g) || []).length
  const commas = (sample.match(/,/g) || []).length
  return semis > commas ? ';' : ','
}

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function parseDateParts(value: unknown): { date: string; time: string | null } | null {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    const time = value.getHours() + value.getMinutes() + value.getSeconds() === 0
      ? null
      : `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    return { date, time }
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
    return { date: utc.toISOString().slice(0, 10), time: null }
  }
  const text = String(value).trim()
  if (/^\d{5}(?:\.\d+)?$/.test(text)) return parseDateParts(Number(text))
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (match) {
    return {
      date: `${match[1]}-${match[2]}-${match[3]}`,
      time: match[4] ? `${match[4]}:${match[5]}:${match[6] || '00'}` : null,
    }
  }
  match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T,](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (match) {
    return {
      date: `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`,
      time: match[4] ? `${match[4]}:${match[5]}:${match[6] || '00'}` : null,
    }
  }
  return null
}

export function bookedStamp(date: string, time: string | null): string {
  return `${date} ${time || '00:00:00'}`
}

export function parseAmount(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let text = String(value).trim()
  if (!text || text === '-' || text === '–') return null
  text = text.replace(/[\s\u00a0]/g, '').replace(/[’'`´]/g, '')
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.')
    else text = text.replace(/,/g, '')
  } else if (text.includes(',')) text = text.replace(',', '.')
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

export function headerMap(headers: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  headers.forEach((header, index) => map.set(String(header ?? '').trim().toLowerCase(), index))
  return map
}

export function cell(map: Map<string, number>, row: unknown[], ...names: string[]): string {
  for (const name of names) {
    const index = map.get(name.toLowerCase())
    if (index == null) continue
    const value = row[index]
    if (value == null) continue
    return String(value).trim()
  }
  return ''
}

export function signedChf(amount: number, currency: string, chf: number | null, rate: number | null): { chfAmount: number | null; exchangeRate: number | null } {
  if (currency === 'CHF') return { chfAmount: round2(amount), exchangeRate: 1 }
  if (chf != null) return { chfAmount: round2(chf), exchangeRate: rate }
  return { chfAmount: null, exchangeRate: rate }
}

const AMOUNT_PATTERN = /^-?(?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2}$/

export function isLoneAmount(line: string): boolean {
  return AMOUNT_PATTERN.test(line.trim())
}

export function endsWithAmount(line: string): boolean {
  return /(?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2}\s*$/.test(line.trim())
}

export function normalizePdf(text: string): string {
  return text.replace(/[\u2019\u2018\u02bc\u00b4]/g, "'").replace(/\r/g, '')
}
