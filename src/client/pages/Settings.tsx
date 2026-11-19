import { useEffect, useState } from 'react'
import { api, today } from '../api'
import { Banner, useBusy } from '../ui'

type Settings = {
  emailEnabled: boolean
  rates: { id: string; currency: string; rateToChf: number; asOf: string }[]
  categories: { id: string; name: string; kind: string }[]
  family: { id: string; name: string }[]
  rules: { id: string; pattern: string; category: string; priority: number }[]
}

export function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null)
  const [currency, setCurrency] = useState('EUR')
  const [rate, setRate] = useState('')
  const [asOf, setAsOf] = useState(today())
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState('spending')
  const [name, setName] = useState('')
  const { error, note, setNote, run } = useBusy()

  function load() { return api<Settings>('/api/settings').then(setData) }
  useEffect(() => { load().catch((caught) => setNote(caught.message)) }, [])

  return (
    <div className="page">
      <h1>Settings</h1>
      <Banner error={error} note={note} />
      <p className="muted">{data?.emailEnabled ? 'Password reset email is switched on.' : 'Password reset email is not configured. An administrator can still set a new password under Users.'}</p>
      <section className="card stack">
        <h2>Exchange rates to CHF</h2>
        <p className="muted">Used when a budget line or an imported transaction is in EUR or USD and the file itself does not contain the bank’s rate. One euro at 0.95 means 1 EUR is 0.95 CHF.</p>
        <form className="grid-3" onSubmit={(event) => { event.preventDefault(); run(async () => { const result = await api<{ updatedTransactions: number }>('/api/rates', { method: 'POST', body: JSON.stringify({ currency, rateToChf: Number(rate), asOf }) }); setNote(`Rate saved. Updated ${result.updatedTransactions} transactions that had no CHF amount.`); await load() }) }}>
          <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} />
          <input type="number" step="0.0001" placeholder="CHF for 1 unit" value={rate} onChange={(event) => setRate(event.target.value)} required />
          <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          <button className="btn" type="submit">Save rate</button>
        </form>
        {data?.rates.map((row) => (
          <div className="spread" key={row.id}><span>1 {row.currency} = {row.rateToChf} CHF · {String(row.asOf).slice(0, 10)}</span><button className="btn small danger" onClick={() => run(async () => { await api(`/api/rates/${row.id}`, { method: 'DELETE' }); await load() })}>Delete</button></div>
        ))}
      </section>
      <section className="card stack">
        <h2>Categories</h2>
        <form className="row" onSubmit={(event) => { event.preventDefault(); run(async () => { await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: category, kind }) }); setCategory(''); await load() }) }}>
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="New category" />
          <select value={kind} onChange={(event) => setKind(event.target.value)}><option value="spending">Spending</option><option value="budget">Budget</option></select>
          <button className="btn" type="submit">Add</button>
        </form>
        {data?.categories.map((row) => <div className="spread" key={row.id}><span>{row.name} <span className="tag">{row.kind}</span></span><button className="btn small danger" onClick={() => run(async () => { await api(`/api/categories/${row.id}`, { method: 'DELETE' }); await load() })}>Delete</button></div>)}
      </section>
      <section className="card stack">
        <h2>Family</h2>
        <form className="row" onSubmit={(event) => { event.preventDefault(); run(async () => { await api('/api/family', { method: 'POST', body: JSON.stringify({ name }) }); setName(''); await load() }) }}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
          <button className="btn" type="submit">Add</button>
        </form>
        {data?.family.map((row) => <div className="spread" key={row.id}><span>{row.name}</span><button className="btn small danger" onClick={() => run(async () => { await api(`/api/family/${row.id}`, { method: 'DELETE' }); await load() })}>Delete</button></div>)}
      </section>
      <section className="card stack">
        <h2>Category rules</h2>
        <p className="muted">If a description contains the pattern, that category is suggested on import.</p>
        {data?.rules.map((row) => <div className="spread" key={row.id}><span>{row.pattern} → {row.category}</span><button className="btn small danger" onClick={() => run(async () => { await api(`/api/rules/${row.id}`, { method: 'DELETE' }); await load() })}>Delete</button></div>)}
      </section>
    </div>
  )
}
