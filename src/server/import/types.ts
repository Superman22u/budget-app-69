export type SourceKind = 'bank' | 'creditcard' | 'debitcard'

export type ParsedTx = {
  sourceKind: SourceKind
  provider: string
  accountRef: string | null
  cardRef: string | null
  bookingDate: string
  valueDate: string | null
  bookedAt: string
  description: string
  details: string | null
  merchant: string | null
  currency: string
  amount: number
  chfAmount: number | null
  exchangeRate: number | null
  balance: number | null
  externalId: string | null
  categoryHint: string | null
}

export type ParsedMoney = {
  kind: 'money'
  provider: string
  sourceKind: SourceKind
  accountRef: string | null
  transactions: ParsedTx[]
}

export type ParsedHealth = {
  docType: string
  referenceNo: string | null
  insuredName: string | null
  insuredNumber: string | null
  documentDate: string | null
  serviceDate: string | null
  providerName: string | null
  description: string | null
  invoiceAmount: number | null
  patientShare: number | null
  insurerShare: number | null
  payoutIban: string | null
  notes: string | null
  rawText: string
}

export type ParsedHealthcare = {
  kind: 'healthcare'
  documents: ParsedHealth[]
}

export type ParsedItem = {
  description: string
  quantity: number | null
  weight: number | null
  unitPrice: number | null
  lineTotal: number | null
}

export type ParsedReceipt = {
  storeName: string | null
  storeChain: string | null
  purchasedAt: string | null
  totalAmount: number | null
  currency: string
  paymentMethod: string | null
  cardHint: string | null
  notes: string | null
  rawText: string
  items: ParsedItem[]
}

export type ParsedReceipts = {
  kind: 'receipts'
  receipts: ParsedReceipt[]
}

export type ParsedFile = ParsedMoney | ParsedHealthcare | ParsedReceipts
