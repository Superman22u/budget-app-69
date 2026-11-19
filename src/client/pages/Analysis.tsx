import { useEffect, useState } from 'react'
import { api, money, today } from '../api'
import { Banner } from '../ui'

type Analysis = {
  from: string
  to: string
  missingChf: number
  categories: { category: string; spent: number; received: number }[]
  months: { month: string; spent: number; received: number }[]
  merchants: { name: string; spent: number }[]
  providers: { provider: string; sourceKind: string; spent: number; received: number }[]
}

export function AnalysisPage() {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(today())
  const [data, setData] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  function load(start = from, end = to) {
    api<Analysis>(`/api/analysis?from=${start}&to=${end}`).then(setData).catch((caught) => setError(caught.message))
  }
  useEffect(() => { load() }, [])
  const max = Math.max(1, ...(data?.categories.map((row) => Number(row.spent)) || [1]))
  const spent = data?.categories.reduce((sum, row) => sum + Number(row.spent), 0) || 0
  const received = data?.categories.reduce((sum, row) => sum + Number(row.received), 0) || 0
  return (
    <div className="page">
      <h1>Analysis</h1>
      <Banner error={error} />
      <div className="row">
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <button className="btn" onClick={() => load()}>Update</button>
      </div>
      {!!data?.missingChf && <div className="banner"> {data.missingChf} transactions in this range have no CHF amount. Add the currency rate in Settings.</div>}
      <div className="stats">
        <div className="card stat"><span className="muted">Spent</span><strong className="debit">{money(spent)}</strong></div>
        <div className="card stat"><span className="muted">Received</span><strong className="credit">{money(received)}</strong></div>
        <div className="card stat"><span className="muted">Net</span><strong>{money(received - spent)}</strong></div>
      </div>
      <section className="card stack">
        <h2>By category</h2>
        {data?.categories.map((row) => (
          <div className="bar-row" key={row.category}>
            <span>{row.category}</span>
            <div className="bar"><span style={{ width: `${(Number(row.spent) / max) * 100}%` }} /></div>
            <strong>{money(Number(row.spent))}</strong>
          </div>
        ))}
        {!data?.categories.length && <p className="muted">Import transactions to see where the money went.</p>}
      </section>
      <div className="grid-2">
        <section className="card stack">
          <h2>By month</h2>
          {data?.months.map((row) => (
            <div className="spread" key={row.month}><span>{row.month}</span><span className="debit">{money(Number(row.spent))}</span><span className="credit">{money(Number(row.received))}</span></div>
          ))}
        </section>
        <section className="card stack">
          <h2>Largest descriptions</h2>
          {data?.merchants.map((row) => <div className="spread" key={row.name}><span>{row.name}</span><strong>{money(Number(row.spent))}</strong></div>)}
        </section>
      </div>
      <section className="card stack">
        <h2>By account or card</h2>
        {data?.providers.map((row) => <div className="spread" key={`${row.provider}-${row.sourceKind}`}><span>{row.provider} · {row.sourceKind}</span><span>{money(Number(row.spent))} out · {money(Number(row.received))} in</span></div>)}
      </section>
    </div>
  )
}
