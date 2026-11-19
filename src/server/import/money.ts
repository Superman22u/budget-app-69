import * as XLSX from 'xlsx'
import { cleanText, compactIban, round2 } from '../http.ts'
import type { ParsedMoney, ParsedTx, SourceKind } from './types.ts'
import {
  bookedStamp,
  cell,
  decodeText,
  detectDelimiter,
  headerMap,
  isLoneAmount,
  normalizePdf,
  parseAmount,
  parseCsv,
  parseDateParts,
} from './text.ts'

function tx(partial: Omit<ParsedTx, 'sourceKind' | 'provider'> & { sourceKind?: SourceKind; provider?: string }, base: { sourceKind: SourceKind; provider: string; accountRef: string | null }): ParsedTx {
  const currency = partial.currency.toUpperCase()
  const chf = currency === 'CHF' ? round2(partial.amount) : partial.chfAmount
  return {
    sourceKind: partial.sourceKind || base.sourceKind,
    provider: partial.provider || base.provider,
    accountRef: partial.accountRef ?? base.accountRef,
    cardRef: partial.cardRef,
    bookingDate: partial.bookingDate,
    valueDate: partial.valueDate,
    bookedAt: partial.bookedAt,
    description: cleanText(partial.description).slice(0, 1000) || 'Transaction',
    details: partial.details ? cleanText(partial.details).slice(0, 4000) : null,
    merchant: partial.merchant ? cleanText(partial.merchant).slice(0, 255) : null,
    currency,
    amount: round2(partial.amount),
    chfAmount: chf == null ? null : round2(chf),
    exchangeRate: partial.exchangeRate,
    balance: partial.balance,
    externalId: partial.externalId ? partial.externalId.slice(0, 120) : null,
    categoryHint: partial.categoryHint,
  }
}

function foreignNote(details: string): { currency: string; amount: number; rate: number | null } | null {
  const amountMatch = details.match(/Kartentransaktionsbetrag:\s*(-?\d[\d'.,]*)\s*([A-Z]{3})/i)
  if (!amountMatch) return null
  const amount = parseAmount(amountMatch[1])
  if (amount == null) return null
  const rateMatch = details.match(/Devisenkurs:\s*([0-9]+(?:[.,][0-9]+)?)/i)
  return { currency: amountMatch[2].toUpperCase(), amount, rate: rateMatch ? parseAmount(rateMatch[1]) : null }
}

export function parseUbsAccount(text: string): ParsedMoney {
  const rows = parseCsv(text, ';')
  const headerIndex = rows.findIndex((row) => row.some((value) => value.trim().toLowerCase() === 'buchungsdatum'))
  if (headerIndex < 0) throw new Error('UBS account file has no booking-date column')
  const meta: Record<string, string> = {}
  for (const row of rows.slice(0, headerIndex)) {
    const key = row[0]?.replace(/:$/, '').trim()
    if (key) meta[key.toLowerCase()] = (row[1] || '').trim()
  }
  const accountRef = compactIban(meta.iban) || meta.kontonummer || null
  const map = headerMap(rows[headerIndex])
  const transactions: ParsedTx[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const booked = parseDateParts(cell(map, row, 'buchungsdatum'))
    if (!booked) continue
    const value = parseDateParts(cell(map, row, 'valutadatum'))
    const closed = parseDateParts(cell(map, row, 'abschlussdatum'))
    const time = cell(map, row, 'abschlusszeit')
    const stampTime = closed?.date === booked.date ? parseDateParts(`${booked.date} ${time}`)?.time || null : null
    const debit = parseAmount(cell(map, row, 'belastung'))
    const credit = parseAmount(cell(map, row, 'gutschrift'))
    if (debit == null && credit == null) continue
    const chf = round2(debit != null ? debit : credit || 0)
    const description = [cell(map, row, 'beschreibung1'), cell(map, row, 'beschreibung2')].filter(Boolean).join(', ')
    const details = [cell(map, row, 'beschreibung3'), cell(map, row, 'fussnoten')].filter(Boolean).join(' ')
    const foreign = foreignNote(details)
    const currency = foreign?.currency || cell(map, row, 'währung', 'waehrung') || meta['bewertet in'] || 'CHF'
    transactions.push(tx({
      accountRef,
      cardRef: null,
      bookingDate: booked.date,
      valueDate: value?.date || null,
      bookedAt: bookedStamp(booked.date, stampTime),
      description,
      details: details || null,
      merchant: cell(map, row, 'beschreibung1').split(';')[0] || null,
      currency,
      amount: foreign ? foreign.amount : chf,
      chfAmount: chf,
      exchangeRate: foreign?.rate ?? (currency === 'CHF' ? 1 : null),
      balance: parseAmount(cell(map, row, 'saldo')),
      externalId: cell(map, row, 'transaktions-nr.', 'transaktions-nr') || null,
      categoryHint: cell(map, row, 'beschreibung2') || null,
    }, { sourceKind: 'bank', provider: 'UBS', accountRef }))
  }
  return { kind: 'money', provider: 'UBS', sourceKind: 'bank', accountRef, transactions }
}

export function parseRevolut(text: string): ParsedMoney {
  const rows = parseCsv(text, ',')
  const headerIndex = rows.findIndex((row) => row.some((value) => /datum des abschlusses/i.test(value)))
  if (headerIndex < 0) throw new Error('Revolut file has no header')
  const map = headerMap(rows[headerIndex])
  const transactions: ParsedTx[] = []
  let accountCurrency = 'CHF'
  for (const row of rows.slice(headerIndex + 1)) {
    const booked = parseDateParts(cell(map, row, 'datum des abschlusses'))
    const started = parseDateParts(cell(map, row, 'datum des begins', 'datum des beginns'))
    if (!booked) continue
    const currency = (cell(map, row, 'währung', 'waehrung') || 'CHF').toUpperCase()
    accountCurrency = currency
    const gross = parseAmount(cell(map, row, 'betrag')) ?? 0
    const fee = parseAmount(cell(map, row, 'gebühr', 'gebuehr')) ?? 0
    const amount = round2(gross - Math.abs(fee))
    const kind = cell(map, row, 'art')
    const status = cell(map, row, 'status')
    transactions.push(tx({
      accountRef: `Revolut ${currency}`,
      cardRef: null,
      bookingDate: booked.date,
      valueDate: started?.date || null,
      bookedAt: bookedStamp(booked.date, booked.time),
      description: cell(map, row, 'beschreibung') || kind,
      details: [kind, cell(map, row, 'produkt'), status, fee ? `Fee ${fee}` : ''].filter(Boolean).join(' · '),
      merchant: cell(map, row, 'beschreibung') || null,
      currency,
      amount,
      chfAmount: currency === 'CHF' ? amount : null,
      exchangeRate: currency === 'CHF' ? 1 : null,
      balance: parseAmount(cell(map, row, 'kontostand')),
      externalId: null,
      categoryHint: kind || null,
    }, { sourceKind: 'bank', provider: 'Revolut', accountRef: `Revolut ${currency}` }))
  }
  return { kind: 'money', provider: 'Revolut', sourceKind: 'bank', accountRef: `Revolut ${accountCurrency}`, transactions }
}

export function parseViseca(text: string): ParsedMoney {
  const rows = parseCsv(text, ',')
  const headerIndex = rows.findIndex((row) => row.some((value) => value.trim() === 'TransactionId'))
  if (headerIndex < 0) throw new Error('Viseca file has no TransactionId column')
  const map = headerMap(rows[headerIndex])
  const transactions: ParsedTx[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const when = parseDateParts(cell(map, row, 'date'))
    const valuta = parseDateParts(cell(map, row, 'valutadate'))
    if (!when) continue
    const billedCurrency = (cell(map, row, 'currency') || 'CHF').toUpperCase()
    const originalCurrency = (cell(map, row, 'originalcurrency') || billedCurrency).toUpperCase()
    const billed = parseAmount(cell(map, row, 'amount')) ?? 0
    const original = parseAmount(cell(map, row, 'originalamount'))
    const rate = parseAmount(cell(map, row, 'exchange rate'))
    const signedBilled = round2(-billed)
    const foreign = originalCurrency !== billedCurrency && original != null
    const amount = foreign ? round2(-(original || 0)) : signedBilled
    const merchant = cell(map, row, 'merchantname')
    transactions.push(tx({
      accountRef: null,
      cardRef: cell(map, row, 'cardid') || null,
      bookingDate: when.date,
      valueDate: valuta?.date || null,
      bookedAt: bookedStamp(when.date, when.time),
      description: cell(map, row, 'details') || merchant,
      details: [merchant, cell(map, row, 'merchantplace'), cell(map, row, 'merchantcountry'), cell(map, row, 'statetype'), cell(map, row, 'type')].filter(Boolean).join(' · '),
      merchant: merchant || null,
      currency: foreign ? originalCurrency : billedCurrency,
      amount,
      chfAmount: billedCurrency === 'CHF' ? signedBilled : null,
      exchangeRate: foreign ? rate : billedCurrency === 'CHF' ? 1 : rate,
      balance: null,
      externalId: cell(map, row, 'transactionid') || null,
      categoryHint: cell(map, row, 'type') || null,
    }, { sourceKind: 'creditcard', provider: 'Viseca', accountRef: null }))
  }
  return { kind: 'money', provider: 'Viseca', sourceKind: 'creditcard', accountRef: null, transactions }
}

function cardSign(raw: number, kind: string): number {
  const label = kind.toLowerCase()
  if (label.startsWith('belast') || label.startsWith('debit')) return -Math.abs(raw)
  if (label.startsWith('gut') || label.startsWith('kredit') || label.startsWith('credit')) return Math.abs(raw)
  return raw
}

export function parseSwisscard(rows: unknown[][]): ParsedMoney {
  const headerIndex = rows.findIndex((row) => row.some((value) => /transaktionsdatum/i.test(String(value ?? ''))))
  if (headerIndex < 0) throw new Error('Swisscard file has no transaction date')
  const map = headerMap(rows[headerIndex])
  const transactions: ParsedTx[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const when = parseDateParts(cell(map, row, 'transaktionsdatum'))
    if (!when) continue
    const raw = parseAmount(cell(map, row, 'betrag'))
    if (raw == null) continue
    const signed = cardSign(raw, cell(map, row, 'debit/kredit'))
    const currency = (cell(map, row, 'währung', 'waehrung') || 'CHF').toUpperCase()
    const foreignCurrency = cell(map, row, 'fremdwährung', 'fremdwahrung').toUpperCase()
    const foreignAmount = parseAmount(cell(map, row, 'betrag in fremdwährung', 'betrag in fremdwahrung'))
    const foreign = Boolean(foreignCurrency && foreignCurrency !== currency && foreignAmount != null)
    const sign = signed < 0 ? -1 : 1
    const merchant = cell(map, row, 'händler', 'haendler')
    transactions.push(tx({
      accountRef: null,
      cardRef: cell(map, row, 'kartennummer') || null,
      bookingDate: when.date,
      valueDate: null,
      bookedAt: bookedStamp(when.date, when.time),
      description: cell(map, row, 'beschreibung') || merchant,
      details: [merchant, cell(map, row, 'status'), cell(map, row, 'händlerkategorie', 'haendlerkategorie'), cell(map, row, 'registrierte kategorie')].filter(Boolean).join(' · '),
      merchant: merchant || null,
      currency: foreign ? foreignCurrency : currency,
      amount: foreign ? round2(sign * Math.abs(foreignAmount || 0)) : signed,
      chfAmount: currency === 'CHF' ? signed : null,
      exchangeRate: foreign && foreignAmount ? round2(Math.abs(signed / foreignAmount) * 1e6) / 1e6 : currency === 'CHF' ? 1 : null,
      balance: null,
      externalId: null,
      categoryHint: cell(map, row, 'registrierte kategorie') || cell(map, row, 'händlerkategorie', 'haendlerkategorie') || null,
    }, { sourceKind: 'creditcard', provider: 'Swisscard', accountRef: null }))
  }
  return { kind: 'money', provider: 'Swisscard', sourceKind: 'creditcard', accountRef: null, transactions }
}

export function parseLiberty(rows: unknown[][]): ParsedMoney {
  const headerIndex = rows.findIndex((row) => row.some((value) => /^datum$/i.test(String(value ?? '').trim())))
  if (headerIndex < 0) throw new Error('Liberty file has no date column')
  const map = headerMap(rows[headerIndex])
  const transactions: ParsedTx[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const when = parseDateParts(cell(map, row, 'datum'))
    if (!when) continue
    const raw = parseAmount(cell(map, row, 'betrag'))
    if (raw == null) continue
    const currency = (cell(map, row, 'währung', 'waehrung') || 'CHF').toUpperCase()
    const amount = round2(-raw)
    transactions.push(tx({
      accountRef: null,
      cardRef: cell(map, row, 'karte') || null,
      bookingDate: when.date,
      valueDate: null,
      bookedAt: bookedStamp(when.date, null),
      description: cell(map, row, 'beschreibung'),
      details: cell(map, row, 'status') || null,
      merchant: cell(map, row, 'beschreibung').split(',')[0] || null,
      currency,
      amount,
      chfAmount: currency === 'CHF' ? amount : null,
      exchangeRate: currency === 'CHF' ? 1 : null,
      balance: null,
      externalId: null,
      categoryHint: null,
    }, { sourceKind: 'creditcard', provider: 'Liberty', accountRef: null }))
  }
  return { kind: 'money', provider: 'Liberty', sourceKind: 'creditcard', accountRef: null, transactions }
}

export function parseUbsVisa(text: string): ParsedMoney {
  const rows = parseCsv(text.replace(/^sep=;\s*/i, ''), ';')
  const headerIndex = rows.findIndex((row) => row.some((value) => /buchungstext/i.test(value)))
  if (headerIndex < 0) throw new Error('UBS Visa file has no booking text')
  const map = headerMap(rows[headerIndex])
  const transactions: ParsedTx[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const purchase = parseDateParts(cell(map, row, 'einkaufsdatum'))
    const booked = parseDateParts(cell(map, row, 'buchung'))
    const when = booked || purchase
    if (!when) continue
    const textValue = cell(map, row, 'buchungstext')
    if (/^total/i.test(textValue) || /^total/i.test(cell(map, row, 'kontonummer'))) continue
    const debit = parseAmount(cell(map, row, 'belastung'))
    const credit = parseAmount(cell(map, row, 'gutschrift'))
    if (debit == null && credit == null) continue
    const signed = round2(debit != null ? -Math.abs(debit) : Math.abs(credit || 0))
    const billedCurrency = (cell(map, row, 'währung', 'waehrung') || 'CHF').toUpperCase()
    const originalCurrency = (cell(map, row, 'originalwährung', 'originalwaehrung') || billedCurrency).toUpperCase()
    const originalAmount = parseAmount(cell(map, row, 'betrag'))
    const rate = parseAmount(cell(map, row, 'kurs'))
    const foreign = originalCurrency !== billedCurrency && originalAmount != null
    const sign = signed < 0 ? -1 : 1
    transactions.push(tx({
      accountRef: compactIban(cell(map, row, 'kontonummer')) || cell(map, row, 'kontonummer') || null,
      cardRef: cell(map, row, 'kartennummer') || null,
      bookingDate: when.date,
      valueDate: purchase?.date || null,
      bookedAt: bookedStamp(when.date, null),
      description: textValue,
      details: [cell(map, row, 'konto-/karteninhaber'), cell(map, row, 'branche')].filter(Boolean).join(' · ') || null,
      merchant: textValue.split(/\s{2,}/)[0] || null,
      currency: foreign ? originalCurrency : billedCurrency,
      amount: foreign ? round2(sign * Math.abs(originalAmount || 0)) : signed,
      chfAmount: billedCurrency === 'CHF' ? signed : null,
      exchangeRate: foreign ? rate : 1,
      balance: null,
      externalId: null,
      categoryHint: cell(map, row, 'branche') || null,
    }, { sourceKind: 'creditcard', provider: 'UBS Visa', accountRef: null }))
  }
  return { kind: 'money', provider: 'UBS Visa', sourceKind: 'creditcard', accountRef: transactions.find((row) => row.accountRef)?.accountRef || null, transactions }
}

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
}

function pdfLines(text: string): string[] {
  return normalizePdf(text).split('\n').map((line) => line.trim()).filter(Boolean)
}

export function parseUbsAccountPdf(text: string): ParsedMoney {
  const lines = pdfLines(text)
  const accountRef = compactIban(text)
  const transactions: ParsedTx[] = []
  let date: string | null = null
  let description = ''
  let expectSaldo = false
  const noise = /^(seite\b|ubs switzerland|po box|www\.ubs|für alle|fuer alle|angezeigt|filterkriterien|buchungsbetrag|zeitraum|kontobewegungen|herr$|aktueller saldo|erstellt|dieser ausdruck|transaktionsbereich|suchbegriff|privatkonto|bic)/i
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const day = line.match(/^\d{1,2}$/)
    const combined = lines[index + 1]?.match(/^(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})$/i)
    const monthName = lines[index + 1]?.toLowerCase().replace(/[^a-zäöü]/g, '')
    const splitMonth = monthName ? MONTHS[monthName] : undefined
    const splitYear = lines[index + 2]?.match(/^\d{4}$/)
    if (day && combined) {
      const month = MONTHS[combined[1].toLowerCase()]
      date = `${combined[2]}-${String(month).padStart(2, '0')}-${day[0].padStart(2, '0')}`
      index += 1
      description = ''
      expectSaldo = false
      continue
    }
    if (day && splitMonth && splitYear) {
      date = `${splitYear[0]}-${String(splitMonth).padStart(2, '0')}-${day[0].padStart(2, '0')}`
      index += 2
      description = ''
      expectSaldo = false
      continue
    }
    if (!date || noise.test(line) || /^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)$/i.test(line) || /^[A-ZÄÖÜ]$/.test(line)) continue
    if (expectSaldo && (isLoneAmount(line) || isBookingType(line))) {
      if (isLoneAmount(line)) expectSaldo = false
      continue
    }
    expectSaldo = false
    const embedded = line.match(/^(.*?)(-?(?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2})$/)
    const embeddedLabel = embedded?.[1]?.trim() || ''
    const embeddedText = embeddedLabel.replace(/[^A-Za-zÀ-ÿ]/g, '')
    if (embedded && embeddedText.length >= 3 && !isBookingType(embeddedLabel)) {
      const amount = parseAmount(embedded[2])
      if (amount == null) continue
      transactions.push(ubsPdfTx(accountRef, date, embeddedLabel, amount))
      description = ''
      expectSaldo = true
      continue
    }
    if (isLoneAmount(line)) {
      if (description && !isBookingType(description)) {
        const amount = parseAmount(line)
        if (amount != null) {
          transactions.push(ubsPdfTx(accountRef, date, description, amount))
          expectSaldo = true
        }
      }
      description = ''
      continue
    }
    description = line
  }
  return { kind: 'money', provider: 'UBS', sourceKind: 'bank', accountRef, transactions }
}

function isBookingType(value: string): boolean {
  return /e-banking|e-bill|paynet|gutschrift|dauerauftrag|lastschrift|vergütung|verguetung|bancomat/i.test(value)
}

function ubsPdfTx(accountRef: string | null, date: string, description: string, amount: number): ParsedTx {
  return tx({
    accountRef,
    cardRef: null,
    bookingDate: date,
    valueDate: null,
    bookedAt: bookedStamp(date, null),
    description,
    details: 'Imported from UBS PDF',
    merchant: null,
    currency: 'CHF',
    amount,
    chfAmount: amount,
    exchangeRate: 1,
    balance: null,
    externalId: null,
    categoryHint: null,
  }, { sourceKind: 'bank', provider: 'UBS', accountRef })
}

export function parseUbsVisaPdf(text: string): ParsedMoney {
  const lines = pdfLines(text)
  const transactions: ParsedTx[] = []
  for (let index = 0; index < lines.length; index++) {
    const started = lines[index].match(/^(\d{2}\.\d{2}\.\d{4})\s+(.+)$/)
    if (!started) continue
    const chunk = [started[2]]
    let booked: string | null = null
    let amount: number | null = null
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 6); cursor++) {
      const money = lines[cursor].match(/^CHF\s+(-?\d[\d'.,]*)\s+(\d{2}\.\d{2}\.\d{4})$/i)
      if (money) {
        amount = parseAmount(money[1])
        booked = parseDateParts(money[2])?.date || null
        index = cursor
        break
      }
      if (/^\d{2}\.\d{2}\.\d{4}\s+/.test(lines[cursor])) break
      chunk.push(lines[cursor])
    }
    if (amount == null || !booked) continue
    const description = chunk[0]
    const credit = /übertrag|uebertrag|zahlung|storno|gutschrift/i.test(description)
    const signed = credit ? Math.abs(amount) : -Math.abs(amount)
    transactions.push(tx({
      accountRef: null,
      cardRef: null,
      bookingDate: booked,
      valueDate: parseDateParts(started[1])?.date || null,
      bookedAt: bookedStamp(booked, null),
      description,
      details: chunk.slice(1).join(' · ') || 'Imported from UBS Visa PDF',
      merchant: description,
      currency: 'CHF',
      amount: signed,
      chfAmount: signed,
      exchangeRate: 1,
      balance: null,
      externalId: null,
      categoryHint: null,
    }, { sourceKind: 'creditcard', provider: 'UBS Visa', accountRef: null }))
  }
  return { kind: 'money', provider: 'UBS Visa', sourceKind: 'creditcard', accountRef: null, transactions }
}

type RaiffeisenDraft = {
  bookingDate: string
  valueDate: string | null
  description: string
  absAmount: number
  saldo: number
}

export function parseRaiffeisen(text: string): ParsedMoney {
  const lines = pdfLines(text).filter((line) => !/alle angaben erfolgen|druckdatum|seite \d|raiffeisenbank zürich|genossenschaft/i.test(line))
  const contract = text.match(/Vertrag:\s*([0-9-]+)/i)?.[1] || null
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (/^\d{2}\.\d{2}\.\d{4}(?!\d)/.test(line) && !/^\d{2}\.\d{2}\.\d{4},/.test(line)) {
      if (current.length) blocks.push(current)
      current = [line]
    } else if (current.length) current.push(line)
  }
  if (current.length) blocks.push(current)
  const drafts: RaiffeisenDraft[] = []
  for (const block of blocks) {
    let matched = ''
    let amount = 0
    let saldo = 0
    let valueDate: string | null = null
    for (const line of block) {
      const found = line.match(/((?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2})((?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2})(\d{2}\.\d{2}\.\d{4})\s*$/)
      if (!found) continue
      amount = parseAmount(found[1]) || 0
      saldo = parseAmount(found[2]) || 0
      valueDate = parseDateParts(found[3])?.date || null
      matched = line
      break
    }
    if (!matched || !amount) continue
    const bookingDate = parseDateParts(block[0])?.date
    if (!bookingDate) continue
    const parts: string[] = []
    for (const line of block) {
      if (line === matched) {
        const head = line
          .replace(/((?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2})((?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2})\d{2}\.\d{2}\.\d{4}\s*$/, '')
          .replace(/^\d{2}\.\d{2}\.\d{4}/, '')
          .trim()
        if (head) parts.push(head.replace(/^\d{2}\.\d{2}\.\d{4}/, '').trim())
      } else if (!isLoneAmount(line)) {
        const detail = line.replace(/^\d{2}\.\d{2}\.\d{4}/, '').replace(/(?:\d{1,3}(?:'\d{3})+|\d+)\.\d{2}$/, '').trim()
        if (detail) parts.push(detail)
      }
    }
    drafts.push({ bookingDate, valueDate, description: parts.join(' · '), absAmount: Math.abs(amount), saldo })
  }
  const transactions: ParsedTx[] = drafts.map((draft, index) => {
    const older = drafts[index + 1]
    const delta = older ? round2(draft.saldo - older.saldo) : null
    const creditWord = /\b(gutschrift|rückzahlung|ruckzahlung|einzahlung|rückvergütung|ruckvergutung)\b/i.test(draft.description)
    let signed: number
    if (delta != null && Math.abs(Math.abs(delta) - draft.absAmount) < 0.05) signed = delta
    else signed = creditWord ? draft.absAmount : -draft.absAmount
    return tx({
      accountRef: contract,
      cardRef: null,
      bookingDate: draft.bookingDate,
      valueDate: draft.valueDate,
      bookedAt: bookedStamp(draft.bookingDate, null),
      description: draft.description,
      details: 'Imported from Raiffeisen PDF',
      merchant: draft.description.split('·')[0]?.trim() || null,
      currency: 'CHF',
      amount: signed,
      chfAmount: signed,
      exchangeRate: 1,
      balance: draft.saldo,
      externalId: null,
      categoryHint: null,
    }, { sourceKind: 'bank', provider: 'Raiffeisen', accountRef: contract })
  })
  return { kind: 'money', provider: 'Raiffeisen', sourceKind: 'bank', accountRef: contract, transactions }
}

export function rowsFromSheet(buffer: Buffer): unknown[][] {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheet = book.Sheets[book.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as unknown[][]
}

export function parseMoneySpreadsheet(buffer: Buffer): ParsedMoney {
  const rows = rowsFromSheet(buffer)
  const header = rows.find((row) => row.some((value) => /betrag|beschreibung|transaktionsdatum/i.test(String(value ?? '')))) || []
  const names = header.map((value) => String(value ?? '').toLowerCase())
  if (names.some((name) => name.includes('transaktionsdatum') || name.includes('händler') || name.includes('haendler'))) return parseSwisscard(rows)
  if (names.includes('karte') && names.some((name) => name.startsWith('währ') || name.startsWith('waehr'))) return parseLiberty(rows)
  throw new Error('This spreadsheet is not a Swisscard or Liberty export.')
}

export function parseMoneyText(text: string): ParsedMoney {
  if (/transaktions-nr/i.test(text) && /buchungsdatum/i.test(text) && /abschlussdatum/i.test(text)) return parseUbsAccount(text)
  if (/datum des beginns/i.test(text) && /kontostand/i.test(text)) return parseRevolut(text)
  if (/transactionid/i.test(text) && /merchantname/i.test(text)) return parseViseca(text)
  if (/transaktionsdatum/i.test(text) && /händler|haendler/i.test(text)) return parseSwisscard(parseCsv(text, detectDelimiter(text)))
  if (/buchungstext/i.test(text) && /einkaufsdatum/i.test(text)) return parseUbsVisa(text)
  throw new Error('Unrecognised table')
}
