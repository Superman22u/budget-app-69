import { useEffect, useState, type ChangeEvent } from 'react'
import { api, money, rateText } from '../api'
import { Banner, useBusy } from '../ui'

type Row = {
  id: string
  sourceKind: string
  provider: string
  accountRef: string | null
  cardRef: string | null
  bookingDate: string
  valueDate: string | null
  description: string
  details: string | null
  currency: string
  amount: number
  chfAmount: number | null
  exchangeRate: number | null
  category: string | null
  importFile: string | null
}

const columns = [
  ['bookingDate', 'Date'],
  ['description', 'Description'],
  ['provider', 'Source'],
  ['category', 'Category'],
  ['amount', 'Amount'],
  ['chfAmount', 'CHF'],
] as const

export function TransactionsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<string[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState('bookingDate')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [remember, setRemember] = useState(false)
  const { error, note, setNote, busy, run } = useBusy()

  function url(nextOffset: number) {
    const params = new URLSearchParams({ sort, dir, offset: String(nextOffset), limit: '80' })
    if (source) params.set('source', source)
    if (query) params.set('q', query)
    if (provider) params.set('provider', provider)
    if (category) params.set('category', category)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return `/api/transactions?${params}`
  }

  function load(nextOffset = 0, append = false) {
    return Promise.all([
      api<{ rows: Row[]; total: number }>(url(nextOffset)),
      api<{ categories: string[]; providers: string[] }>('/api/transactions/meta'),
    ]).then(([list, meta]) => {
      setRows((current) => append ? [...current, ...list.rows] : list.rows)
      setTotal(list.total)
      setOffset(nextOffset)
      setCategories(meta.categories)
      setProviders(meta.providers)
    })
  }

  useEffect(() => { load(0).catch((caught) => setNote(caught.message)) }, [source, provider, category, from, to, sort, dir])

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run(async () => {
      const body = new FormData()
      body.set('file', file)
      const result = await api<{ provider: string; imported: number; skipped: number; missingChf: number }>(`/api/import?expect=money`, { method: 'POST', body })
      setNote(`${result.provider}: imported ${result.imported}, skipped ${result.skipped} already stored.${result.missingChf ? ` ${result.missingChf} rows have no CHF amount yet. Add a rate in Settings.` : ''}`)
      await load(0)
    })
  }

  function toggle(column: string) {
    if (sort === column) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(column); setDir(column === 'description' || column === 'provider' || column === 'category' ? 'asc' : 'desc') }
  }

  const exportParams = new URLSearchParams()
  if (source) exportParams.set('source', source)
  if (query) exportParams.set('q', query)
  if (provider) exportParams.set('provider', provider)
  if (category) exportParams.set('category', category)
  if (from) exportParams.set('from', from)
  if (to) exportParams.set('to', to)

  return (
    <div className="page">
      <div className="spread">
        <h1>Transactions</h1>
        <div className="row">
          <a className="btn secondary" href={`/api/transactions/export?${exportParams}`}>Excel</a>
          <label className="btn">Import CSV, Excel, or PDF<input type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={onFile} /></label>
        </div>
      </div>
      <Banner error={error} note={note} />
      <p className="muted">UBS and Revolut CSV, Raiffeisen PDF, Viseca CSV, Swisscard CSV or Excel, Liberty Excel, and UBS Visa CSV or PDF. Importing the same download again skips rows that are already stored. Card files and the bank payment of that card stay separate, so a Liberty budget can use the card lines.</p>
      <div className="row">
        <button className={`btn ${source === '' ? '' : 'secondary'}`} onClick={() => setSource('')}>All</button>
        <button className={`btn ${source === 'bank' ? '' : 'secondary'}`} onClick={() => setSource('bank')}>Bank</button>
        <button className={`btn ${source === 'creditcard' ? '' : 'secondary'}`} onClick={() => setSource('creditcard')}>Cards</button>
        <button className="btn secondary" disabled={busy} onClick={() => run(async () => {
          const result = await api<{ updated: number }>('/api/transactions/categorize', { method: 'POST' })
          setNote(`Filled ${result.updated} empty categories from your rules.`)
          await load(0)
        })}>Fill empty categories</button>
      </div>
      <div className="filters">
        <input placeholder="Search description, card, file" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') load(0) }} />
        <select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">Every source</option>{providers.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Every category</option><option value="__none__">Uncategorized</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <button className="btn secondary" onClick={() => load(0)}>Search</button>
        <label className="check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember the next category for similar text</label>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(([key, label]) => <th key={key}><button onClick={() => toggle(key)}>{label}{sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.bookingDate}{row.valueDate && row.valueDate !== row.bookingDate ? <div className="muted">value {row.valueDate}</div> : null}</td>
                <td className="wrap">{row.description}{row.details ? <div className="muted">{row.details}</div> : null}<div className="muted">{[row.accountRef, row.cardRef, row.importFile].filter(Boolean).join(' · ')}</div></td>
                <td>{row.provider}<div className="muted">{row.sourceKind}</div></td>
                <td>
                  <select value={row.category || ''} onChange={(event) => run(async () => {
                    await api(`/api/transactions/${row.id}`, { method: 'PATCH', body: JSON.stringify({ category: event.target.value || null, remember }) })
                    await load(0)
                  })}>
                    <option value="">—</option>
                    {categories.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </td>
                <td className={row.amount < 0 ? 'debit' : 'credit'}>{money(row.amount, row.currency)}</td>
                <td className={row.chfAmount != null && row.chfAmount < 0 ? 'debit' : 'credit'}>
                  {row.currency === 'CHF' ? money(row.amount) : row.chfAmount == null ? '—' : money(row.chfAmount)}
                  {row.currency !== 'CHF' && <div className="muted">{row.exchangeRate ? `rate ${rateText(row.exchangeRate)}` : 'no rate'}</div>}
                </td>
                <td><button className="btn small danger" onClick={() => run(async () => { if (!confirm('Delete this transaction?')) return; await api(`/api/transactions/${row.id}`, { method: 'DELETE' }); await load(0) })}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty muted">No transactions for this filter.</p>}
      </div>
      <div className="spread">
        <span className="muted">{rows.length} of {total}</span>
        {rows.length < total && <button className="btn secondary" disabled={busy} onClick={() => load(offset + 80, true)}>Load more</button>}
      </div>
    </div>
  )
}
