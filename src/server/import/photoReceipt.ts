import { round2 } from '../http.ts'
import type { ParsedItem, ParsedReceipt, ParsedReceipts } from './types.ts'

const photoNote = 'Read from a photo. Please check the items, the weight, and the total.'

function normalizeLine(line: string): string {
  return line
    .replace(/(\d),(\d{2})(?!\d)/g, '$1.$2')
    .replace(/(\d):(\d{2})(?!\d)/g, '$1.$2')
    .replace(/(\d\.\d{2})0(?=\D|$)/g, '$1')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function moneyValues(line: string): number[] {
  const values: number[] = []
  const pattern = /(^|[^\d])(-?\d+\.\d{2})(-)?(?!\d)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line))) {
    let value = Number(match[2])
    if (match[3]) value = -Math.abs(value)
    if (Number.isFinite(value)) values.push(round2(value))
  }
  return values
}

function skipLine(line: string): boolean {
  return /mwst|total\b|summe|erhalten|buchung|kreditkarte|mastercard|maestro|\bvisa\b|\bamex\b|twint|\bdatum\b|\bzeit\b|tel\.|telefon|www\.|https?:|danke|dank für|wiedersehen|rabatt|bezeichnung|\bbetrag\b|\bartikel\b|che-\d|\bbarcode\b|\bkasse\b|bediener|account type|contact.?less|trim-id|akt-id|\baid\b|rundung|coupon|gutschein|upan/i.test(line)
}

function descriptionOf(line: string, amounts: number[]): string {
  let text = line
  for (const value of amounts) {
    text = text.replace(Math.abs(value).toFixed(2), ' ')
  }
  return text
    .replace(/^\d{4,8}\s+/, '')
    .replace(/^[A-C]\s+(?=[A-Za-zÄÖÜäöü0-9])/u, '')
    .replace(/^\d\s+(?=[A-Za-zÄÖÜäöü])/u, '')
    .replace(/\s+[A-C]$/u, '')
    .replace(/\*|#/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function findWhen(text: string): string | null {
  const date = text.match(/(\d{2})\.(\d{2})\.(20\d{2})/)
  if (!date) return null
  const day = Number(date[1])
  const month = Number(date[2])
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  const after = text.slice(text.indexOf(date[0]))
  const time = after.match(/(\d{2}):(\d{2})(?::(\d{2}))?/)
  const clock = time && Number(time[1]) < 24 && Number(time[2]) < 60 ? `${time[1]}:${time[2]}:${time[3] || '00'}` : '00:00:00'
  return `${date[3]}-${date[2]}-${date[1]} ${clock}`
}

function findTotal(text: string): number | null {
  const normalized = normalizeLine(text)
  const labeled = normalized.match(/(?:total\s+chf|summe\s+chf)\s+(\d+\.\d{2})/i)
  if (labeled && Number(labeled[1]) > 0) return Number(labeled[1])
  const paid = normalized.match(/(?:kreditkarten|mastercard|maestro|visa|amex|twint)\s+(\d+\.\d{2})/i)
  if (paid && Number(paid[1]) > 0) return Number(paid[1])
  return null
}

function findPayment(text: string): string | null {
  const match = text.match(/mastercard|maestro|visa|amex|twint|kreditkarten/i)
  if (!match) return null
  const word = match[0].toLowerCase()
  if (word === 'mastercard') return 'Mastercard'
  if (word === 'maestro') return 'Maestro'
  if (word === 'visa') return 'Visa'
  if (word === 'amex') return 'Amex'
  if (word === 'twint') return 'TWINT'
  return 'Card'
}

function findChain(text: string): string | null {
  const loose = text.replace(/land[!|\]]/gi, 'Landi')
  if (/ochsner/i.test(loose)) return 'Ochsner Sport'
  if (/denner/i.test(loose)) return 'Denner'
  if (/landi/i.test(loose)) return 'Landi'
  if (/migros/i.test(text)) return 'Migros'
  if (/\bcoop\b/i.test(text)) return 'Coop'
  if (/aldi/i.test(text)) return 'Aldi'
  if (/lidl/i.test(text)) return 'Lidl'
  return null
}

function findStore(lines: string[], chain: string | null): string | null {
  if (chain === 'Landi') {
    const shop = lines.find((line) => /laden/i.test(line))
    if (shop) return shop.replace(/land[!|]/i, 'Landi').replace(/\s+/g, ' ').trim().slice(0, 200)
    return 'Landi'
  }
  if (chain === 'Denner') {
    const street = lines.findIndex((line) => /strasse|str\./i.test(line))
    const place = street > 0 ? lines[street - 1] : null
    if (place && place.length < 40 && !/denner|tel|www/i.test(place)) return `Denner ${place.replace(/[^A-Za-zÄÖÜäöü .-]/g, '').trim()}`.trim()
    return 'Denner'
  }
  return chain
}

function itemsFrom(lines: string[]): ParsedItem[] {
  const items: ParsedItem[] = []
  let pending: ParsedItem | null = null
  const push = () => {
    if (!pending) return
    if (pending.description) items.push(pending)
    pending = null
  }
  for (const raw of lines) {
    const line = normalizeLine(raw)
    if (!line || skipLine(line)) continue
    const weight = line.match(/(\d+\.\d{3})\s*k\w*\s*[xX×]\s*(\d+\.\d{2})/i)
    if (weight && pending && pending.lineTotal == null) {
      pending.weight = Number(weight[1])
      pending.unitPrice = Number(weight[2])
      continue
    }
    const quantity = line.match(/(\d+)\s*[xX×]\s*(\d+\.\d{2})/)
    if (quantity && pending && pending.lineTotal == null) {
      const count = Number(quantity[1])
      const unit = Number(quantity[2])
      const amounts = moneyValues(line)
      const lineTotal = amounts.length > 1 ? amounts[amounts.length - 1] : null
      pending.quantity = count
      pending.unitPrice = unit
      pending.lineTotal = lineTotal
      if (count > 1 && lineTotal != null && Math.abs(count * unit - lineTotal) > 0.05) pending.unitPrice = round2(lineTotal / count)
      continue
    }
    if (/^statt\b/i.test(line) && pending?.weight != null && pending.lineTotal == null) {
      const amounts = moneyValues(line)
      if (amounts.length) pending.lineTotal = amounts[amounts.length - 1]
      continue
    }
    const amounts = moneyValues(line)
    const description = descriptionOf(line, amounts)
    if (description.length < 3 || !/[A-Za-zÄÖÜäöü]/.test(description)) continue
    push()
    const lineTotal = amounts.length ? amounts[amounts.length - 1] : null
    pending = {
      description,
      quantity: 1,
      weight: null,
      unitPrice: lineTotal,
      lineTotal,
    }
  }
  push()
  return items
}

export function parsePhotoReceipt(text: string): ParsedReceipts {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const chain = findChain(text)
  const card = (text.match(/[Xx*]{2,}[\s-]*(\d{4})/) || [])[1] || null
  const receipt: ParsedReceipt = {
    storeName: findStore(lines, chain),
    storeChain: chain,
    purchasedAt: findWhen(text),
    totalAmount: findTotal(text),
    currency: 'CHF',
    paymentMethod: findPayment(text),
    cardHint: card,
    notes: photoNote,
    rawText: text.slice(0, 20000),
    items: itemsFrom(lines),
  }
  return { kind: 'receipts', receipts: [receipt] }
}
