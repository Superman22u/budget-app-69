import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money } from '../api'
import { useUser } from '../ui'

type Dashboard = {
  monthSpent: number
  monthReceived: number
  uncategorized: number
  recent: { id: string; bookingDate: string; description: string; provider: string; currency: string; amount: number; chfAmount: number | null; category: string | null }[]
  upcoming: { dueDate: string; description: string; chfAmount: number; currency: string; amount: number }[]
}

export function HomePage() {
  const user = useUser()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Dashboard>('/api/dashboard').then(setData).catch((caught) => setError(caught.message)) }, [])
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="page">
      <h1>{hello}, {user.firstName}</h1>
      {error && <div className="banner error">{error}</div>}
      <div className="stats">
        <div className="card stat"><span className="muted">Spent this month</span><strong className="debit">{money(data?.monthSpent || 0)}</strong></div>
        <div className="card stat"><span className="muted">Received this month</span><strong className="credit">{money(data?.monthReceived || 0)}</strong></div>
        <div className="card stat"><span className="muted">Uncategorized</span><strong>{data?.uncategorized ?? '—'}</strong></div>
      </div>
      <div className="grid-2">
        <section className="card stack">
          <div className="spread"><h2>Coming up</h2><Link to="/budget">Budget</Link></div>
          {!data?.upcoming.length && <p className="muted">No budget payments in the next 45 days. Add entries, then build a list for 360 or 720 days.</p>}
          {data?.upcoming.map((line) => (
            <div className="spread" key={`${line.dueDate}-${line.description}`}>
              <span>{line.dueDate}<br /><span className="muted">{line.description}</span></span>
              <strong className={line.chfAmount < 0 ? 'debit' : 'credit'}>{money(line.chfAmount)}</strong>
            </div>
          ))}
        </section>
        <section className="card stack">
          <div className="spread"><h2>Latest movements</h2><Link to="/transactions">All</Link></div>
          {!data?.recent.length && <p className="muted">Import a UBS, Revolut, Raiffeisen, Viseca, Swisscard, or Liberty file.</p>}
          {data?.recent.map((row) => (
            <div className="spread" key={row.id}>
              <span>{row.bookingDate} · {row.provider}<br /><span className="muted">{row.description}</span></span>
              <strong className={row.amount < 0 ? 'debit' : 'credit'}>{row.currency === 'CHF' ? money(row.amount) : money(row.chfAmount)}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
