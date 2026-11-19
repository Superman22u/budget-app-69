import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, today } from '../api'
import { Banner, useBusy } from '../ui'

type Entry = {
  id: string
  firstPayDate: string
  frequency: string
  occurrenceCount: number | null
  untilDate: string | null
  description: string
  contactName: string | null
  direction: 'expense' | 'income'
  amount: number
  currency: string
  exchangeRate: number | null
  chfAmount: number
  familyMember: string | null
  category: string | null
  inflationPercent: number
  notes: string | null
  schedule: string
}

type Plan = { id: string; title: string; startDate: string; days: number; startAmount: number }

const empty = {
  description: '', contactName: '', familyMember: '', category: '', direction: 'expense', firstPayDate: today(),
  frequency: 'monthly', endMode: 'open', occurrenceCount: '12', untilDate: '', amount: '', currency: 'CHF', exchangeRate: '', inflationPercent: '0', notes: '',
}

export function BudgetPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [family, setFamily] = useState<string[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState({ ...empty })
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState({ startDate: today(), days: '360', startAmount: '0', title: '' })
  const { error, note, setNote, busy, run } = useBusy()

  function load(search = query) {
    return api<{ entries: Entry[]; categories: string[]; family: string[]; plans: Plan[] }>(`/api/budget?q=${encodeURIComponent(search)}`).then((data) => {
      setEntries(data.entries)
      setCategories(data.categories)
      setFamily(data.family)
      setPlans(data.plans)
    })
  }
  useEffect(() => { load('').catch((caught) => setNote(caught.message)) }, [])

  function edit(entry: Entry) {
    setEditing(entry.id)
    setOpen(true)
    setForm({
      description: entry.description,
      contactName: entry.contactName || '',
      familyMember: entry.familyMember || '',
      category: entry.category || '',
      direction: entry.direction,
      firstPayDate: entry.firstPayDate,
      frequency: entry.frequency,
      endMode: entry.occurrenceCount ? 'count' : entry.untilDate ? 'until' : 'open',
      occurrenceCount: String(entry.occurrenceCount || 12),
      untilDate: entry.untilDate || '',
      amount: String(entry.amount),
      currency: entry.currency,
      exchangeRate: entry.exchangeRate && entry.currency !== 'CHF' ? String(entry.exchangeRate) : '',
      inflationPercent: String(entry.inflationPercent),
      notes: entry.notes || '',
    })
  }

  const chfPreview = form.currency === 'CHF' ? Number(form.amount) : Number(form.amount) * Number(form.exchangeRate)

  return (
    <div className="page">
      <div className="spread">
        <h1>Budget</h1>
        <div className="row">
          <a className="btn secondary" href="/api/budget/export">Excel</a>
          <button className="btn" onClick={() => { setEditing(null); setForm({ ...empty, firstPayDate: today() }); setOpen(true) }}>Add entry</button>
        </div>
      </div>
      <Banner error={error} note={note} />
      {open && (
        <form className="card stack" onSubmit={(event) => {
          event.preventDefault()
          run(async () => {
            const body = { ...form, amount: Number(form.amount), exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : null, occurrenceCount: Number(form.occurrenceCount), inflationPercent: Number(form.inflationPercent) }
            if (editing) await api(`/api/budget/${editing}`, { method: 'PUT', body: JSON.stringify(body) })
            else await api('/api/budget', { method: 'POST', body: JSON.stringify(body) })
            setOpen(false)
            setNote(editing ? 'Entry updated.' : 'Entry added.')
            await load()
          })
        }}>
          <h2>{editing ? 'Change entry' : 'New entry'}</h2>
          <div className="grid-2">
            <label className="field">Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></label>
            <label className="field">Contact, store, or person<input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label>
            <label className="field">Who it is for<input list="family" value={form.familyMember} onChange={(event) => setForm({ ...form, familyMember: event.target.value })} /></label>
            <datalist id="family">{family.map((name) => <option key={name} value={name} />)}</datalist>
            <label className="field">Category
              <input list="budget-categories" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
            </label>
            <datalist id="budget-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
            <label className="field">Direction
              <select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label className="field">First pay date<input type="date" value={form.firstPayDate} onChange={(event) => setForm({ ...form, firstPayDate: event.target.value })} required /></label>
            <label className="field">How often
              <select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
                <option value="once">Once</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className="field">Ends
              <select value={form.endMode} onChange={(event) => setForm({ ...form, endMode: event.target.value })}>
                <option value="open">Keep going for the whole budget list</option>
                <option value="count">A fixed number of times</option>
                <option value="until">Until a date</option>
              </select>
            </label>
            {form.endMode === 'count' && <label className="field">How many times<input type="number" min="1" value={form.occurrenceCount} onChange={(event) => setForm({ ...form, occurrenceCount: event.target.value })} /></label>}
            {form.endMode === 'until' && <label className="field">Until<input type="date" value={form.untilDate} onChange={(event) => setForm({ ...form, untilDate: event.target.value })} /></label>}
            <label className="field">Amount<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label>
            <label className="field">Currency
              <input list="currencies" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} maxLength={3} />
            </label>
            <datalist id="currencies"><option value="CHF" /><option value="EUR" /><option value="USD" /></datalist>
            {form.currency !== 'CHF' && <label className="field">CHF per 1 {form.currency || 'unit'}<input type="number" min="0" step="0.0001" value={form.exchangeRate} onChange={(event) => setForm({ ...form, exchangeRate: event.target.value })} required /></label>}
            <label className="field">Yearly increase %<input type="number" min="0" step="0.1" value={form.inflationPercent} onChange={(event) => setForm({ ...form, inflationPercent: event.target.value })} /></label>
          </div>
          <p className="muted">{form.currency === 'CHF' ? money(Number(form.amount) || 0) : `${form.amount || 0} ${form.currency} · ${Number.isFinite(chfPreview) ? money(chfPreview) : 'CHF —'} · rate ${form.exchangeRate || '—'}`}</p>
          <p className="muted">The increase applies on each anniversary of the first pay date and compounds. A car insurance of 100 with 5% becomes 105 the next year.</p>
          <label className="field">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="row">
            <button className="btn" disabled={busy} type="submit">{editing ? 'Save changes' : 'Save entry'}</button>
            <button className="btn secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      <form className="card stack" onSubmit={(event) => {
        event.preventDefault()
        run(async () => {
          const created = await api<{ id: string; lines: number }>('/api/budget-plans', { method: 'POST', body: JSON.stringify({ ...plan, days: Number(plan.days), startAmount: Number(plan.startAmount) }) })
          setNote(`Budget list created with ${created.lines} rows.`)
          window.location.href = `/budget/plans/${created.id}`
        })
      }}>
        <h2>Create the budget list</h2>
        <div className="grid-3">
          <label className="field">Start date<input type="date" value={plan.startDate} onChange={(event) => setPlan({ ...plan, startDate: event.target.value })} /></label>
          <label className="field">Days<input type="number" min="1" value={plan.days} onChange={(event) => setPlan({ ...plan, days: event.target.value })} /></label>
          <label className="field">Starting cash, CHF<input type="number" step="0.01" value={plan.startAmount} onChange={(event) => setPlan({ ...plan, startAmount: event.target.value })} /></label>
        </div>
        <div className="row">
          <button className="btn secondary" type="button" onClick={() => setPlan({ ...plan, days: '180' })}>180 days</button>
          <button className="btn secondary" type="button" onClick={() => setPlan({ ...plan, days: '360' })}>360 days</button>
          <button className="btn secondary" type="button" onClick={() => setPlan({ ...plan, days: '720' })}>720 days</button>
          <button className="btn" disabled={busy} type="submit">Create list</button>
        </div>
      </form>

      <div className="card stack">
        <div className="spread">
          <h2>Entries</h2>
          <input placeholder="Search description, contact, person, category" value={query} onChange={(event) => { setQuery(event.target.value); load(event.target.value) }} />
        </div>
        {!entries.length && <p className="empty muted">No budget entries yet.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>First date</th><th className="wrap">Description</th><th>For</th><th>Schedule</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.firstPayDate}</td>
                  <td className="wrap">{entry.description}{entry.contactName ? <div className="muted">{entry.contactName}</div> : null}{entry.category ? <span className="tag">{entry.category}</span> : null}</td>
                  <td>{entry.familyMember}</td>
                  <td>{entry.schedule}{entry.inflationPercent ? <div className="muted">+{entry.inflationPercent}% / year</div> : null}</td>
                  <td className={entry.direction === 'expense' ? 'debit' : 'credit'}>
                    {money(entry.direction === 'expense' ? -entry.amount : entry.amount, entry.currency)}
                    {entry.currency !== 'CHF' && <div className="muted">{money(entry.direction === 'expense' ? -entry.chfAmount : entry.chfAmount)} · rate {entry.exchangeRate}</div>}
                  </td>
                  <td>
                    <button className="btn small secondary" onClick={() => edit(entry)}>Edit</button>
                    <button className="btn small danger" onClick={() => run(async () => { if (!confirm('Delete this budget entry?')) return; await api(`/api/budget/${entry.id}`, { method: 'DELETE' }); await load() })}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card stack">
        <h2>Saved lists</h2>
        {!plans.length && <p className="muted">A list is the day-by-day projection you can export and match to real transactions.</p>}
        {plans.map((item) => (
          <div className="spread" key={item.id}>
            <Link to={`/budget/plans/${item.id}`}>{item.title}</Link>
            <span className="muted">{String(item.startDate).slice(0, 10)} · {item.days} days · start {money(Number(item.startAmount))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
