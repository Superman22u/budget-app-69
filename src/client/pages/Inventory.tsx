import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, today } from '../api'
import { Banner, useBusy } from '../ui'

type Item = {
  id: string
  description: string
  storeName: string | null
  storeChain: string | null
  purchasedAt: string | null
  quantity: number | null
  weight: number | null
  unitPrice: number | null
  pricePerKg: number | null
  lineTotal: number | null
  currency: string
  expiryDate: string | null
  location: string | null
  notes: string | null
  consumedAt: string | null
  receiptId: string | null
}

type List = { items: Item[]; total: number; inStock: number; expiring: number; expired: number }

type Draft = {
  description: string
  storeName: string
  storeChain: string
  purchasedAt: string
  quantity: string
  weight: string
  unitPrice: string
  pricePerKg: string
  lineTotal: string
  expiryDate: string
  location: string
  notes: string
}

const emptyDraft: Draft = {
  description: '', storeName: '', storeChain: '', purchasedAt: today(), quantity: '', weight: '', unitPrice: '', pricePerKg: '', lineTotal: '', expiryDate: '', location: '', notes: '',
}

function draftFrom(item: Item): Draft {
  return {
    description: item.description,
    storeName: item.storeName || '',
    storeChain: item.storeChain || '',
    purchasedAt: item.purchasedAt || '',
    quantity: item.quantity == null ? '' : String(item.quantity),
    weight: item.weight == null ? '' : String(item.weight),
    unitPrice: item.unitPrice == null ? '' : String(item.unitPrice),
    pricePerKg: item.pricePerKg == null ? '' : String(item.pricePerKg),
    lineTotal: item.lineTotal == null ? '' : String(item.lineTotal),
    expiryDate: item.expiryDate || '',
    location: item.location || '',
    notes: item.notes || '',
  }
}

function payload(draft: Draft) {
  const numberOrNull = (value: string) => value === '' ? null : Number(value)
  return {
    description: draft.description,
    storeName: draft.storeName,
    storeChain: draft.storeChain,
    purchasedAt: draft.purchasedAt || null,
    quantity: numberOrNull(draft.quantity),
    weight: numberOrNull(draft.weight),
    unitPrice: numberOrNull(draft.unitPrice),
    pricePerKg: numberOrNull(draft.pricePerKg),
    lineTotal: numberOrNull(draft.lineTotal),
    expiryDate: draft.expiryDate || null,
    location: draft.location,
    notes: draft.notes,
    currency: 'CHF',
  }
}

function plusDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function Expiry({ date }: { date: string | null }) {
  if (!date) return null
  const now = today()
  if (date < now) return <span className="tag bad">Expired</span>
  if (date <= plusDays(14)) return <span className="tag warn">Soon</span>
  return null
}

const columns = [
  ['description', 'Item'],
  ['store', 'Store'],
  ['purchased', 'Bought'],
  ['weight', 'Weight'],
  ['pricePerKg', 'Price / kg'],
  ['expiry', 'Expiry'],
] as const

export function InventoryPage() {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [inStock, setInStock] = useState(0)
  const [expiring, setExpiring] = useState(0)
  const [expired, setExpired] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('stock')
  const [sort, setSort] = useState('expiry')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const { error, note, setNote, busy, run } = useBusy()

  function url(nextOffset: number) {
    const params = new URLSearchParams({ status, sort, dir, offset: String(nextOffset) })
    if (query.trim()) params.set('q', query.trim())
    return `/api/inventory?${params}`
  }

  function load(nextOffset = 0, append = false) {
    return api<List>(url(nextOffset)).then((data) => {
      setItems((current) => append ? [...current, ...data.items] : data.items)
      setTotal(data.total)
      setInStock(data.inStock)
      setExpiring(data.expiring)
      setExpired(data.expired)
      setOffset(nextOffset)
    })
  }

  useEffect(() => { load(0).catch((caught) => setNote(caught.message)) }, [status, sort, dir])

  function toggle(column: string) {
    if (sort === column) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(column); setDir(column === 'description' || column === 'store' ? 'asc' : 'asc') }
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft({ ...draft, [key]: value })
  }

  const perKgHint = draft.pricePerKg === '' && Number(draft.weight) > 0 && draft.lineTotal !== ''
    ? money(Number(draft.lineTotal) / Number(draft.weight))
    : ''

  return (
    <div className="page">
      <div className="spread">
        <h1>Inventory</h1>
        <button className="btn" onClick={() => { setEditing('new'); setDraft({ ...emptyDraft, purchasedAt: today() }) }}>Add item</button>
      </div>
      <Banner error={error} note={note} />
      <p className="muted">{inStock} still in the house. {expiring} expiring within 14 days{expired ? `, including ${expired} already past the date` : ''}. Receipt items are added here when a receipt is imported. Mark something used up once it is eaten or finished.</p>
      <div className="row">
        <button className={`btn ${status === 'stock' ? '' : 'secondary'}`} onClick={() => setStatus('stock')}>In stock</button>
        <button className={`btn ${status === 'expiring' ? '' : 'secondary'}`} onClick={() => setStatus('expiring')}>Expiring</button>
        <button className={`btn ${status === 'consumed' ? '' : 'secondary'}`} onClick={() => setStatus('consumed')}>Used up</button>
        <button className={`btn ${status === 'all' ? '' : 'secondary'}`} onClick={() => setStatus('all')}>All</button>
      </div>
      <div className="filters">
        <input placeholder="Search item, store, or where it is kept" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') load(0) }} />
        <button className="btn secondary" onClick={() => load(0)}>Search</button>
      </div>
      {editing && (
        <form className="card stack" onSubmit={(event) => {
          event.preventDefault()
          run(async () => {
            const body = JSON.stringify(payload(draft))
            if (editing === 'new') await api('/api/inventory', { method: 'POST', body })
            else await api(`/api/inventory/${editing}`, { method: 'PUT', body })
            setEditing(null)
            setNote(editing === 'new' ? 'Item added.' : 'Item updated.')
            await load(0)
          })
        }}>
          <h2>{editing === 'new' ? 'New item' : 'Change item'}</h2>
          <div className="grid-3">
            <label className="field">Item<input value={draft.description} onChange={(event) => set('description', event.target.value)} required /></label>
            <label className="field">Store<input value={draft.storeName} onChange={(event) => set('storeName', event.target.value)} placeholder="MM Rüti" /></label>
            <label className="field">Chain<input list="chains" value={draft.storeChain} onChange={(event) => set('storeChain', event.target.value)} placeholder="Migros, Coop, Denner" /></label>
            <datalist id="chains"><option value="Migros" /><option value="Coop" /><option value="Denner" /><option value="Aldi" /><option value="Lidl" /><option value="Volg" /></datalist>
            <label className="field">Bought<input type="date" value={draft.purchasedAt} onChange={(event) => set('purchasedAt', event.target.value)} /></label>
            <label className="field">Quantity<input type="number" min="0" step="0.001" value={draft.quantity} onChange={(event) => set('quantity', event.target.value)} /></label>
            <label className="field">Weight, kg<input type="number" min="0" step="0.001" value={draft.weight} onChange={(event) => set('weight', event.target.value)} /></label>
            <label className="field">Price per kg, CHF<input type="number" min="0" step="0.01" value={draft.pricePerKg} onChange={(event) => set('pricePerKg', event.target.value)} /></label>
            <label className="field">Line total, CHF<input type="number" min="0" step="0.01" value={draft.lineTotal} onChange={(event) => set('lineTotal', event.target.value)} /></label>
            <label className="field">Expiry<input type="date" value={draft.expiryDate} onChange={(event) => set('expiryDate', event.target.value)} /></label>
            <label className="field">Where it is kept<input list="places" value={draft.location} onChange={(event) => set('location', event.target.value)} placeholder="Fridge, freezer, cupboard" /></label>
            <datalist id="places"><option value="Fridge" /><option value="Freezer" /><option value="Cupboard" /><option value="Cellar" /></datalist>
          </div>
          {perKgHint && <p className="muted">From the line total and weight, that is {perKgHint} per kg. Leave price per kg empty to store that figure.</p>}
          <label className="field">Notes<textarea value={draft.notes} onChange={(event) => set('notes', event.target.value)} /></label>
          <div className="row">
            <button className="btn" disabled={busy} type="submit">{editing === 'new' ? 'Add to inventory' : 'Save changes'}</button>
            <button className="btn secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(([key, label]) => <th key={key}><button onClick={() => toggle(key)}>{label}{sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="wrap">
                  {item.description}
                  {item.location ? <div className="muted">{item.location}</div> : null}
                  {item.quantity != null ? <div className="muted">qty {item.quantity}</div> : null}
                </td>
                <td className="wrap">{item.storeName || item.storeChain || '—'}{item.storeName && item.storeChain ? <div className="muted">{item.storeChain}</div> : null}</td>
                <td>{item.purchasedAt || '—'}{item.receiptId ? <div><Link to={`/receipts/${item.receiptId}`}>Receipt</Link></div> : null}</td>
                <td>{item.weight == null ? '—' : `${item.weight} kg`}</td>
                <td>{item.pricePerKg == null ? '—' : money(item.pricePerKg)}{item.lineTotal != null ? <div className="muted">{money(item.lineTotal)}</div> : null}</td>
                <td>{item.expiryDate || '—'} <Expiry date={item.expiryDate} /></td>
                <td>
                  <button className="btn small secondary" onClick={() => { setEditing(item.id); setDraft(draftFrom(item)) }}>Edit</button>
                  {item.consumedAt
                    ? <button className="btn small" disabled={busy} onClick={() => run(async () => { await api(`/api/inventory/${item.id}/restore`, { method: 'POST' }); setNote('Put back in stock.'); await load(0) })}>Put back</button>
                    : <button className="btn small" disabled={busy} onClick={() => run(async () => { await api(`/api/inventory/${item.id}/consume`, { method: 'POST' }); setNote('Marked as used up.'); await load(0) })}>Used up</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="empty muted">{status === 'consumed' ? 'Nothing has been marked used up.' : 'Nothing in stock for this search. Import a receipt or add an item.'}</p>}
      </div>
      <div className="spread">
        <span className="muted">{items.length} of {total}</span>
        {items.length < total && <button className="btn secondary" disabled={busy} onClick={() => load(offset + 60, true)}>Load more</button>}
      </div>
    </div>
  )
}
