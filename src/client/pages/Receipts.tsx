import { useEffect, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, money } from '../api'
import { Banner, useBusy } from '../ui'
import { TransactionPicker } from './Healthcare'

type Receipt = { id: string; storeName: string | null; storeChain: string | null; purchasedAt: string | null; totalAmount: number | null; currency: string; paymentMethod: string | null; cardHint: string | null; transactionId: string | null; itemCount: number }
type Item = { id?: string; description: string; quantity: number | null; weight: number | null; unitPrice: number | null; lineTotal: number | null; expiryDate: string | null }

export function ReceiptsPage() {
  const navigate = useNavigate()
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [query, setQuery] = useState('')
  const { error, note, setNote, run } = useBusy()
  function load(search = query) { return api<{ receipts: Receipt[] }>(`/api/receipts?q=${encodeURIComponent(search)}`).then((data) => setReceipts(data.receipts)) }
  useEffect(() => { load('').catch((caught) => setNote(caught.message)) }, [])

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run(async () => {
      const body = new FormData()
      body.set('file', file)
      const result = await api<{ receipts: number; items: number; linked: number }>('/api/import?expect=receipt', { method: 'POST', body })
      setNote(`Read ${result.receipts} receipts and ${result.items} items.${result.linked ? ` Linked ${result.linked} to a card or bank payment.` : ''}`)
      await load()
    })
  }

  return (
    <div className="page">
      <div className="spread">
        <h1>Receipts</h1>
        <div className="row">
          <button className="btn secondary" onClick={() => run(async () => { const created = await api<{ id: string }>('/api/receipts', { method: 'POST', body: '{}' }); navigate(`/receipts/${created.id}`) })}>Add manually</button>
          <label className="btn">Import PDF or photo<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={onFile} /></label>
        </div>
      </div>
      <Banner error={error} note={note} />
      <p className="muted">Migros PDFs are split into separate receipts. A JPG or PNG photo of a paper receipt is read the same way: store, date, total, and the lines. Check the lines after a photo, because a crease or a faint print can miss a price. Each item is also added to <Link to="/inventory">Inventory</Link>, where you can set the expiry, the price per kilo, and mark it used up.</p>
      <input placeholder="Search store or item" value={query} onChange={(event) => { setQuery(event.target.value); load(event.target.value) }} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Store</th><th>Items</th><th>Total</th><th>Payment</th></tr></thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td><Link to={`/receipts/${receipt.id}`}>{receipt.purchasedAt ? String(receipt.purchasedAt).slice(0, 16) : 'No date'}</Link></td>
                <td>{receipt.storeName || receipt.storeChain || 'Receipt'}</td>
                <td>{receipt.itemCount}</td>
                <td>{money(receipt.totalAmount, receipt.currency)}</td>
                <td>{[receipt.paymentMethod, receipt.cardHint, receipt.transactionId ? 'linked' : ''].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!receipts.length && <p className="empty muted">No receipts yet.</p>}
      </div>
    </div>
  )
}

export function ReceiptDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [storeName, setStoreName] = useState('')
  const [storeChain, setStoreChain] = useState('')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [totalAmount, setTotalAmount] = useState<number | null>(null)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [cardHint, setCardHint] = useState('')
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [suggestions, setSuggestions] = useState<{ id: string; bookingDate: string; description: string; provider: string; amount: number; currency: string; chfAmount: number | null }[]>([])
  const [linkedLabel, setLinkedLabel] = useState('')
  const { error, note, setNote, busy, run } = useBusy()

  useEffect(() => {
    api<{ receipt: Record<string, unknown>; items: Item[]; suggestions: typeof suggestions }>(`/api/receipts/${id}`).then((data) => {
      const receipt = data.receipt
      setStoreName(String(receipt.storeName || ''))
      setStoreChain(String(receipt.storeChain || ''))
      setPurchasedAt(receipt.purchasedAt ? String(receipt.purchasedAt).slice(0, 16).replace(' ', 'T') : '')
      setTotalAmount(receipt.totalAmount == null ? null : Number(receipt.totalAmount))
      setPaymentMethod(String(receipt.paymentMethod || ''))
      setCardHint(String(receipt.cardHint || ''))
      setTransactionId(receipt.transactionId ? String(receipt.transactionId) : null)
      setFileName(receipt.fileName ? String(receipt.fileName) : null)
      const linkedText = receipt.transactionDescription
        ? `${String(receipt.bookingDate).slice(0, 10)} · ${receipt.transactionProvider || ''} · ${receipt.transactionDescription}`
        : ''
      setLinkedLabel(linkedText)
      setItems(data.items.map((item) => ({ ...item, expiryDate: item.expiryDate ? String(item.expiryDate).slice(0, 10) : null })))
      setSuggestions(data.suggestions)
    }).catch((caught) => setNote(caught.message))
  }, [id])

  function update(index: number, patch: Partial<Item>) {
    setItems(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  return (
    <div className="page">
      <Link to="/receipts">Receipts</Link>
      <h1>{storeName || 'Receipt'}</h1>
      <Banner error={error} note={note} />
      <form className="card stack" onSubmit={(event) => {
        event.preventDefault()
        run(async () => {
          const when = purchasedAt ? (purchasedAt.length === 16 ? `${purchasedAt.replace('T', ' ')}:00` : purchasedAt.replace('T', ' ')) : null
          await api(`/api/receipts/${id}`, { method: 'PUT', body: JSON.stringify({ storeName, storeChain, purchasedAt: when, totalAmount, currency: 'CHF', paymentMethod, cardHint, transactionId, items }) })
          setNote('Receipt saved.')
        })
      }}>
        <div className="grid-2">
          <label className="field">Store<input value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="MM Rüti" /></label>
          <label className="field">Chain<input value={storeChain} onChange={(event) => setStoreChain(event.target.value)} placeholder="Migros, Coop, Denner" /></label>
          <label className="field">Bought at<input type="datetime-local" value={purchasedAt} onChange={(event) => setPurchasedAt(event.target.value)} /></label>
          <label className="field">Total CHF<input type="number" step="0.01" value={totalAmount ?? ''} onChange={(event) => setTotalAmount(event.target.value === '' ? null : Number(event.target.value))} /></label>
          <label className="field">Payment<input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} /></label>
          <label className="field">Card ending<input value={cardHint} onChange={(event) => setCardHint(event.target.value)} /></label>
        </div>
        <h2>Items</h2>
        {items.map((item, index) => (
          <div className="grid-3" key={index}>
            <label className="field">Description<input value={item.description} onChange={(event) => update(index, { description: event.target.value })} /></label>
            <label className="field">Quantity<input type="number" step="0.001" value={item.quantity ?? ''} onChange={(event) => update(index, { quantity: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label className="field">Weight, kg<input type="number" step="0.001" value={item.weight ?? ''} onChange={(event) => update(index, { weight: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label className="field">Price<input type="number" step="0.01" value={item.unitPrice ?? ''} onChange={(event) => update(index, { unitPrice: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label className="field">Line total<input type="number" step="0.01" value={item.lineTotal ?? ''} onChange={(event) => update(index, { lineTotal: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label className="field">Expiry<input type="date" value={item.expiryDate || ''} onChange={(event) => update(index, { expiryDate: event.target.value || null })} /></label>
          </div>
        ))}
        <button className="btn secondary" type="button" onClick={() => setItems([...items, { description: '', quantity: 1, weight: null, unitPrice: null, lineTotal: null, expiryDate: null }])}>Add item</button>
        {!!suggestions.length && (
          <div className="stack">
            <h2>Possible card or bank payments</h2>
            {suggestions.map((row) => (
              <button className="btn secondary" type="button" key={row.id} onClick={() => setTransactionId(row.id)}>
                {String(row.bookingDate).slice(0, 10)} · {row.provider} · {row.description} · {money(row.chfAmount ?? row.amount)}
              </button>
            ))}
          </div>
        )}
        <TransactionPicker value={transactionId} onChange={setTransactionId} linked={linkedLabel} />
        <div className="row">
          <button className="btn" disabled={busy} type="submit">Save receipt</button>
          {fileName && <a className="btn secondary" href={`/api/receipts/${id}/file`}>{/\.pdf$/i.test(fileName) ? 'Open PDF' : 'Open photo'}</a>}
          <button className="btn danger" type="button" onClick={() => run(async () => { await api(`/api/receipts/${id}`, { method: 'DELETE' }); navigate('/receipts') })}>Delete</button>
        </div>
      </form>
    </div>
  )
}
