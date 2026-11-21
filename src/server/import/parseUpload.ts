import { createRequire } from 'node:module'
import { HttpError } from '../http.ts'
import { emptyHealthDocument, parseReceiptText, parseSwica } from './documents.ts'
import { parseMoneySpreadsheet, parseMoneyText, parseRaiffeisen, parseUbsAccountPdf, parseUbsVisaPdf } from './money.ts'
import { readReceiptPhoto } from './ocr.ts'
import { parsePhotoReceipt } from './photoReceipt.ts'
import { decodeText } from './text.ts'
import type { ParsedFile } from './types.ts'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (data: Buffer) => Promise<{ text: string }>

async function pdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer)
  return result.text || ''
}

export async function parseUpload(filename: string, buffer: Buffer, expect?: string): Promise<ParsedFile> {
  const extension = filename.toLowerCase().split('.').pop() || ''
  if (extension === 'pdf') return parsePdf(buffer, expect)
  if (extension === 'xls' || extension === 'xlsx') {
    try {
      return parseMoneySpreadsheet(buffer)
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Could not read the spreadsheet')
    }
  }
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp') {
    if (expect !== 'receipt') throw new HttpError(400, 'Photos can be imported on the Receipts page.')
    try {
      return parsePhotoReceipt(await readReceiptPhoto(buffer))
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Could not read the photo')
    }
  }
  if (extension === 'csv' || extension === 'txt' || extension === '') {
    try {
      return parseMoneyText(decodeText(buffer))
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Could not read the file')
    }
  }
  throw new HttpError(400, 'Use a CSV, Excel, PDF, or a photo of a receipt.')
}

async function parsePdf(buffer: Buffer, expect?: string): Promise<ParsedFile> {
  const text = await pdfText(buffer)
  const readable = text.replace(/\s+/g, ' ').trim()
  if (readable.length < 40) {
    if (expect === 'healthcare') return emptyHealthDocument('This PDF has no readable text. It was stored so you can type the bill in.')
    if (expect === 'receipt') return parseReceiptText(text)
    throw new HttpError(400, 'This PDF has no readable text. Bank and card PDFs from UBS are easier as CSV. Scans belong on Healthcare or Receipts.')
  }
  if (/leistungsabrechnung|swica gesundheitsorganisation/i.test(text)) return parseSwica(text)
  if (/genossenschaft migros|artikelbezeichnung/i.test(text)) return parseReceiptText(text)
  if (/raiffeisen/i.test(text) && /belastung|gutschrift|kontoauszug/i.test(text)) return parseRaiffeisen(text)
  if (/total kartenbuchungen|kreditkarten/i.test(text) && /buchungstext|einkauf/i.test(text)) return parseUbsVisaPdf(text)
  if (/ubs/i.test(text) && /kontobewegungen/i.test(text)) return parseUbsAccountPdf(text)
  if (expect === 'healthcare') {
    const parsed = parseSwica(text)
    if (parsed.documents.length && parsed.documents[0].referenceNo) return parsed
    return emptyHealthDocument('Stored the PDF. The layout was not a SWICA statement, so fill in the amounts yourself.')
  }
  if (expect === 'receipt') return parseReceiptText(text)
  throw new HttpError(400, 'Could not tell which bank, card, healthcare, or receipt export this PDF is.')
}
