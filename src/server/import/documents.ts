import { cleanText, compactIban } from '../http.ts'
import type { ParsedHealth, ParsedHealthcare, ParsedItem, ParsedReceipt, ParsedReceipts } from './types.ts'
import { isLoneAmount, normalizePdf, parseAmount, parseDateParts } from './text.ts'

function splitAmountLine(line: string): number[] {
  const amounts: number[] = []
  let rest = line.trim()
  while (rest) {
    const match = rest.match(/^((?:\d{1,3}(?:'\d{3})+|\d{1,7})\.\d{2})/)
    if (!match) return []
    amounts.push(parseAmount(match[1]) || 0)
    rest = rest.slice(match[1].length).trim()
  }
  return amounts
}

function linesOf(text: string): string[] {
  return normalizePdf(text).split('\n').map((line) => line.trim()).filter(Boolean)
}

export function parseSwica(text: string): ParsedHealthcare {
  const raw = normalizePdf(text)
  const lines = linesOf(raw)
  if (!/leistungsabrechnung|swica/i.test(raw)) {
    return { kind: 'healthcare', documents: [] }
  }
  const reference = raw.match(/LEISTUNGSABRECHNUNG\s+([0-9]+)/i)?.[1] || null
  const insuredNumber = raw.match(/VERSICHERTEN-NR\.?\s*([0-9]+)/i)?.[1] || null
  const insuredIndex = lines.findIndex((line) => /VERSICHERTEN-NR/i.test(line))
  const insuredName = insuredIndex > 0 ? lines[insuredIndex - 1] : null
  const documentDate = parseDateParts((raw.match(/,\s*(\d{2}\.\d{2}\.\d{4})/) || [])[1] || '')?.date || null
  const serviceDate = parseDateParts((raw.match(/vom\s+(\d{2}\.\d{2}\.\d{4})/i) || [])[1] || '')?.date || null
  const services: { description: string; provider: string; invoice: number; patient: number; insurer: number }[] = []
  for (let index = 0; index < lines.length; index++) {
    if (/^total/i.test(lines[index])) continue
    const amounts = splitAmountLine(lines[index])
    if (amounts.length !== 4) continue
    services.push({
      provider: lines[index - 1] && !/vom\s+\d/i.test(lines[index - 1]) ? lines[index - 1] : '',
      description: lines[index - 2] && /vom\s+\d/i.test(lines[index - 2]) ? lines[index - 2] : lines[index - 1] || 'Treatment',
      invoice: amounts[0],
      patient: amounts[1],
      insurer: amounts[2],
    })
  }
  const payout = parseAmount((raw.match(/Saldo zu Ihren Gunsten\s*([0-9][0-9'.]*)/i) || [])[1] || '')
  const iban = compactIban(raw)
  const description = services.map((service) => `${service.description}${service.provider ? ` · ${service.provider}` : ''}`).join('; ')
  const document: ParsedHealth = {
    docType: 'statement',
    referenceNo: reference,
    insuredName,
    insuredNumber,
    documentDate,
    serviceDate,
    providerName: services[0]?.provider || 'SWICA',
    description: description || 'SWICA Leistungsabrechnung',
    invoiceAmount: services.reduce((sum, service) => sum + service.invoice, 0) || null,
    patientShare: services.reduce((sum, service) => sum + service.patient, 0) || null,
    insurerShare: payout ?? (services.reduce((sum, service) => sum + service.insurer, 0) || null),
    payoutIban: iban,
    notes: null,
    rawText: raw.slice(0, 20000),
  }
  return { kind: 'healthcare', documents: [document] }
}

function parseItemLine(line: string): ParsedItem | null {
  const columns = line.trim().split(/\s{2,}/).map((part) => part.trim()).filter(Boolean)
  if (columns.length >= 4) {
    const numbers = columns.slice(1)
    if (numbers.every((value) => /^-?\d+(?:\.\d+)?$/.test(value)) && /^\d+$/.test(numbers[numbers.length - 1])) {
      const quantity = Number(numbers[0])
      const unitPrice = Number(numbers[1])
      const lineTotal = Number(numbers[numbers.length - 2])
      return {
        description: columns[0].slice(0, 300),
        quantity,
        weight: Number.isInteger(quantity) ? null : quantity,
        unitPrice,
        lineTotal,
      }
    }
  }
  const match = line.trim().match(/^(.*?)\s+(\d+\.\d{3}|\d+)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+)$/)
  if (!match) return null
  const quantity = Number(match[2])
  return {
    description: match[1].trim().slice(0, 300),
    quantity,
    weight: Number.isInteger(quantity) ? null : quantity,
    unitPrice: Number(match[3]),
    lineTotal: Number(match[4]),
  }
}

function parseMigrosChunk(chunk: string): ParsedReceipt | null {
  const lines = linesOf(chunk)
  const items: ParsedItem[] = []
  let inItems = false
  for (const line of lines) {
    if (/artikelbezeichnung/i.test(line)) {
      inItems = true
      continue
    }
    if (!inItems) continue
    if (/^-{5,}/.test(line) || /^total chf/i.test(line)) break
    const item = parseItemLine(line)
    if (item) items.push(item)
  }
  const total = parseAmount((chunk.match(/Total CHF\s+([0-9][0-9'.,]*)/i) || [])[1] || '')
  if (!items.length && total == null) return null
  const storeLine = lines.find((line, index) => index > 0 && !/genossenschaft|artikelbezeichnung/i.test(line) && !isLoneAmount(line))
  const when = chunk.match(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})/)
  const date = when ? parseDateParts(`${when[1]} ${when[2]}`) : null
  const payment = (chunk.match(/\b(Visa|Mastercard|Maestro|TWINT|Debit|Bar)\b/i) || [])[1] || null
  const card = (chunk.match(/X{2,}(\d{4})/) || [])[1] || null
  return {
    storeName: storeLine ? cleanText(storeLine).slice(0, 200) : 'Migros',
    storeChain: 'Migros',
    purchasedAt: date ? `${date.date} ${date.time || '00:00:00'}` : null,
    totalAmount: total,
    currency: 'CHF',
    paymentMethod: payment,
    cardHint: card,
    notes: null,
    rawText: chunk.slice(0, 20000),
    items,
  }
}

export function parseReceiptText(text: string): ParsedReceipts {
  const raw = normalizePdf(text)
  if (/GENOSSENSCHAFT MIGROS|Artikelbezeichnung/i.test(raw)) {
    const chunks = raw.split(/(?=GENOSSENSCHAFT MIGROS)/).map((chunk) => chunk.trim()).filter(Boolean)
    const receipts = chunks.map(parseMigrosChunk).filter((receipt): receipt is ParsedReceipt => Boolean(receipt))
    if (receipts.length) return { kind: 'receipts', receipts }
  }
  const total = parseAmount((raw.match(/Total(?:\s+CHF)?\s+([0-9][0-9'.,]*)/i) || [])[1] || '')
  const chain = /migros/i.test(raw) ? 'Migros' : /coop/i.test(raw) ? 'Coop' : /denner/i.test(raw) ? 'Denner' : /aldi/i.test(raw) ? 'Aldi' : /lidl/i.test(raw) ? 'Lidl' : null
  return {
    kind: 'receipts',
    receipts: [{
      storeName: chain,
      storeChain: chain,
      purchasedAt: null,
      totalAmount: total,
      currency: 'CHF',
      paymentMethod: null,
      cardHint: null,
      notes: raw.trim().length < 40 ? 'This PDF has no readable text. Enter the receipt yourself.' : 'The receipt text could not be split into items. You can add them below.',
      rawText: raw.slice(0, 20000),
      items: [],
    }],
  }
}

export function emptyHealthDocument(note: string): ParsedHealthcare {
  return {
    kind: 'healthcare',
    documents: [{
      docType: 'scan',
      referenceNo: null,
      insuredName: null,
      insuredNumber: null,
      documentDate: null,
      serviceDate: null,
      providerName: null,
      description: null,
      invoiceAmount: null,
      patientShare: null,
      insurerShare: null,
      payoutIban: null,
      notes: note,
      rawText: '',
    }],
  }
}
