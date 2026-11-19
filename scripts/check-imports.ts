import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseUpload } from '../src/server/import/parseUpload.ts'
import { addFrequency, expandEntry, fullYears } from '../src/server/budgetMath.ts'

const root = path.resolve('resources')

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function file(relative: string) {
  const buffer = await readFile(path.join(root, relative))
  return parseUpload(path.basename(relative), buffer, relative.includes('swica\\Belege') || relative.includes('swica/Belege') ? 'healthcare' : undefined)
}

async function main(): Promise<void> {
  assert(addFrequency('2026-01-31', 'monthly') === '2026-02-28', 'month end clamp')
  assert(fullYears('2026-03-01', '2027-02-28') === 0, 'year not reached')
  assert(fullYears('2026-03-01', '2027-03-01') === 1, 'anniversary')
  const lines = expandEntry({
    id: '1',
    firstPayDate: '2026-03-01',
    frequency: 'yearly',
    occurrenceCount: 3,
    untilDate: null,
    description: 'Car insurance',
    contactName: 'Insurer',
    direction: 'expense',
    amount: 100,
    currency: 'CHF',
    exchangeRate: 1,
    chfAmount: 100,
    familyMember: 'Ren',
    category: 'Insurance',
    inflationPercent: 10,
    notes: null,
  }, '2026-01-01', '2029-01-01')
  assert(lines.length === 3, `expected 3 insurance lines, got ${lines.length}`)
  assert(lines[0].chfAmount === -100 && lines[1].chfAmount === -110 && lines[2].chfAmount === -121, `inflation ${lines.map((line) => line.chfAmount).join(',')}`)

  const ubs = await file('account/UBS/UBS-PK-REN-20261119064809.csv')
  assert(ubs.kind === 'money', 'ubs kind')
  if (ubs.kind === 'money') {
    assert(ubs.transactions.length > 300, `ubs count ${ubs.transactions.length}`)
    const corner = ubs.transactions.find((row) => row.externalId === '1235321TO5458934')
    assert(corner && corner.amount === -2841.5, 'ubs corner payment')
    assert(ubs.accountRef?.startsWith('CH86'), `ubs iban ${ubs.accountRef}`)
  }

  const debit = await file('debitcard/UBS-Mastercard_20261119065425.csv')
  assert(debit.kind === 'money' && debit.transactions.some((row) => row.externalId === '9930808BN6015346'), 'debit card id')

  const revolut = await file('account/Revolut/CHF-Revolut_2025-09-01_2026-11-19_de-de_fce470.csv')
  assert(revolut.kind === 'money' && revolut.transactions.some((row) => /coop/i.test(row.description) && row.amount < 0), 'revolut coop')

  const eur = await file('account/Revolut/EUR-Revolut_2025-09-01_2026-11-19_de-de_93d6a7.csv')
  assert(eur.kind === 'money' && eur.transactions.some((row) => row.currency === 'EUR' && /quellenhof/i.test(row.description)), 'revolut eur')

  const viseca = await file('creditcard/Viseca/20261119-Rene.csv')
  assert(viseca.kind === 'money' && viseca.transactions.some((row) => /netflix/i.test(row.description) && row.amount < 0), 'viseca netflix')

  const swissCsv = await file('creditcard/Swisscard/SC-Transactions_2026-06-22_11-07-07.csv')
  const swissXlsx = await file('creditcard/Swisscard/SC-Transactions_2026-06-22_11-07-05.xlsx')
  assert(swissCsv.kind === 'money' && swissXlsx.kind === 'money', 'swisscard kinds')
  if (swissCsv.kind === 'money' && swissXlsx.kind === 'money') {
    assert(Math.abs(swissCsv.transactions.length - swissXlsx.transactions.length) <= 1, `swisscard csv/xlsx counts ${swissCsv.transactions.length} ${swissXlsx.transactions.length}`)
    assert(swissCsv.transactions.some((row) => /safari bar/i.test(row.description) && row.amount < 0), 'swisscard bar sign')
    assert(swissCsv.transactions.some((row) => /ihre zahlung/i.test(row.description) && row.amount > 0), 'swisscard payment sign')
  }

  const liberty = await file('creditcard/Liberty/Liberty-20261119.xls')
  assert(liberty.kind === 'money' && liberty.transactions.length > 100, 'liberty count')
  if (liberty.kind === 'money') {
    assert(liberty.transactions.some((row) => /netflix/i.test(row.description) && row.amount < 0), 'liberty purchase sign')
    assert(liberty.transactions.some((row) => /ihre zahlung/i.test(row.description) && row.amount > 0), 'liberty payment sign')
  }

  const visa = await file('creditcard/UBS/UBS-Visa.csv')
  assert(visa.kind === 'money' && visa.transactions.some((row) => /nooba/i.test(row.description) && row.amount < 0), 'ubs visa debit')
  if (visa.kind === 'money') assert(visa.transactions.some((row) => /qr-zahlung/i.test(row.description) && row.amount > 0), 'ubs visa credit')

  const raiffeisen = await file('account/Raiffeisen/2026-Raiffeisen.pdf')
  assert(raiffeisen.kind === 'money', 'raiffeisen kind')
  if (raiffeisen.kind === 'money') {
    const rent = raiffeisen.transactions.find((row) => row.bookingDate === '2026-11-02' && Math.abs(row.amount) === 1320)
    assert(rent && rent.amount < 0, 'raiffeisen rent is a debit')
    const payIn = raiffeisen.transactions.find((row) => row.bookingDate === '2026-10-27' && Math.abs(row.amount) === 1500)
    assert(payIn && payIn.amount > 0, 'raiffeisen salary credit')
    const shares = raiffeisen.transactions.find((row) => /rückzahlung|ruckzahlung/i.test(row.description) && Math.abs(row.amount) === 10000)
    assert(shares && shares.amount > 0, 'raiffeisen share repayment is a credit')
  }

  const older = await file('account/Raiffeisen/2025-Raiffeisen.pdf')
  assert(older.kind === 'money' && older.transactions.length > 5, 'raiffeisen 2025')

  const ubsPdf = await file('account/UBS/UBS-PK-REN-20261119064815.pdf')
  if (ubsPdf.kind === 'money') {
    assert(ubsPdf.transactions.length > 320 && ubsPdf.transactions.length < 380, `ubs pdf count ${ubsPdf.transactions.length}`)
    assert(ubsPdf.transactions.some((row) => row.amount === -2841.5), 'ubs pdf corner amount')
  }

  const swica = await file('swica/Leistungsabrechnung/Leistungsabrechnung_1776412200.pdf')
  assert(swica.kind === 'healthcare', 'swica kind')
  if (swica.kind === 'healthcare') {
    const doc = swica.documents[0]
    assert(doc.referenceNo === '1776412200', 'swica reference')
    assert(doc.insurerShare === 47.05, `swica share ${doc.insurerShare}`)
    assert(/bella grace/i.test(doc.insuredName || ''), 'swica insured')
  }

  const beleg = await parseUpload('beleg.pdf', await readFile(path.join(root, 'swica/Belege/682d725c-1e7c-405d-b467-733641ce2317.pdf')), 'healthcare')
  assert(beleg.kind === 'healthcare' && beleg.documents.length === 1, 'scan beleg stored')

  const migros = await file('receipts/shopping/Migros/20260101_20261231.pdf')
  assert(migros.kind === 'receipts', 'migros kind')
  if (migros.kind === 'receipts') {
    const small = migros.receipts.find((receipt) => receipt.totalAmount === 8.85)
    assert(small && small.items.length >= 3, 'migros 8.85 receipt items')
    assert(migros.receipts.length > 5, 'several receipts in one file')
  }

  console.log('Sample files parsed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
