import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, money } from '../api'
import { Banner, useBusy } from '../ui'

type LinkRow = { id: string; bookingDate: string; description: string; amount: number; currency: string; chfAmount: number | null; provider: string }
type Line = {
  id: string
  dueDate: string
  description: string
  contactName: string | null
  direction: string
  currency: string
  amount: number
  exchangeRate: number | null
  chfAmount: number
  actualChf: number | null
  familyMember: string | null
  category: string | null
  runningBudget: number
  runningActual: number
  links: LinkRow[]
}
type Payload = { plan: { id: string; title: string; startDate: string; days: number; startAmount: number }; lines: Line[] }
type SearchRow = { id: string; bookingDate: string; description: string; provider: string; currency: string; amount: number; chfAmount: number | null }

export function PlanPage() {
  const { id = '' } = useParams()
  const [data, setData] = useState<Payload | null>(null)
  const [matching, setMatching] = useState<Line | null>(null)
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<SearchRow[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const { error, note, setNote, busy, run } = useBusy()

  function load() {
    return api<Payload>(`/api/budget-plans/${id}`).then(setData)
  }
  useEffect(() => { load().catch((caught) => setNote(caught.message)) }, [id])

  useEffect(() => {
    if (!matching) return
    const handle = setTimeout(() => {
      api<{ rows: SearchRow[] }>(`/api/search/transactions?q=${encodeURIComponent(search || matching.description)}`).then((result) => setFound(result.rows))
    }, 250)
    return () => clearTimeout(handle)
  }, [search, matching])

  if (!data) return <p className="muted">Loading the budget list…</p>
  return (
    <div className="page">
      <div className="spread">
        <div>
          <Link to="/budget">Budget</Link>
          <h1>{data.plan.title}</h1>
          <p className="muted">{data.plan.startDate} · {data.plan.days} days · starting {money(data.plan.startAmount)}</p>
        </div>
        <div className="row">
          <a className="btn secondary" href={`/api/budget-plans/${id}/export`}>Excel</a>
          <button className="btn" disabled={busy} onClick={() => run(async () => {
            const result = await api<{ linked: number }>(`/api/budget-plans/${id}/auto-match`, { method: 'POST' })
            setNote(`Linked ${result.linked} transactions. Rows with a known provider or a clear name were matched. Use Match on a row to choose the rest.`)
            await load()
          })}>Match transactions</button>
          <button className="btn secondary" onClick={() => run(async () => { await api(`/api/budget-plans/${id}/clear-matches`, { method: 'POST' }); setNote('Matches cleared.'); await load() })}>Clear matches</button>
        </div>
      </div>
      <Banner error={error} note={note} />
      <p className="muted">A credit-card budget such as “Liberty 4000” each month picks up Liberty card purchases in that period. The row then shows the budgeted CHF and the amount it really was. Anything the app cannot recognise can be chosen by hand.</p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th className="wrap">Description</th><th>Budget</th><th>Actual</th><th>Balance</th><th></th></tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.dueDate}</td>
                <td className="wrap">
                  {line.description}
                  <div className="muted">{[line.contactName, line.familyMember, line.category].filter(Boolean).join(' · ')}</div>
                  {!!line.links.length && <div className="muted">{line.links.length} linked · {line.links.map((link) => link.description).slice(0, 2).join('; ')}</div>}
                </td>
                <td className={line.chfAmount < 0 ? 'debit' : 'credit'}>
                  {money(line.amount, line.currency)}
                  {line.currency !== 'CHF' && <div className="muted">{money(line.chfAmount)} · rate {line.exchangeRate}</div>}
                </td>
                <td className={line.actualChf != null && line.actualChf < 0 ? 'debit' : 'credit'}>{line.actualChf == null ? '—' : money(line.actualChf)}</td>
                <td>{money(line.runningActual)}<div className="muted">budget {money(line.runningBudget)}</div></td>
                <td><button className="btn small secondary" onClick={() => { setMatching(line); setPicked(line.links.map((link) => link.id)); setSearch(line.contactName || line.description) }}>Match</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.lines.length && <p className="empty muted">Nothing falls in this window. Check the first pay date and how many times each entry repeats.</p>}
      </div>
      {matching && (
        <dialog open className="modal" onClose={() => setMatching(null)}>
          <h2>Match {matching.description}</h2>
          <p className="muted">Budgeted {money(matching.chfAmount)}. Search and tick the transactions that belong to this row.</p>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" />
          <div>
            {found.map((row) => (
              <label className="check" key={row.id}>
                <input type="checkbox" checked={picked.includes(row.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, row.id] : picked.filter((item) => item !== row.id))} />
                <span>{row.bookingDate} · {row.provider}<br />{row.description}<br /><strong>{row.currency === 'CHF' ? money(row.amount) : `${money(row.amount, row.currency)} · ${money(row.chfAmount)}`}</strong></span>
              </label>
            ))}
            {!found.length && <p className="muted">No transactions found.</p>}
          </div>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => run(async () => {
              await api(`/api/budget-plans/${id}/lines/${matching.id}/links`, { method: 'PUT', body: JSON.stringify({ transactionIds: picked }) })
              setMatching(null)
              setNote('Row updated with the selected transactions.')
              await load()
            })}>Save match</button>
            <button className="btn secondary" onClick={() => setMatching(null)}>Close</button>
          </div>
        </dialog>
      )}
    </div>
  )
}
