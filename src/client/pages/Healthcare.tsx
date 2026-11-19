import { useEffect, useState, type ChangeEvent } from 'react'
import { api, money } from '../api'
import { Banner, useBusy } from '../ui'

type Doc = {
  id: string
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
  fileName: string | null
  transactionId: string | null
  bookingDate: string | null
  transactionDescription: string | null
  transactionChf: number | null
}

export function HealthcarePage() {
  const [documents, setDocuments] = useState<Doc[]>([])
  const { error, note, setNote, busy, run } = useBusy()
  function load() { return api<{ documents: Doc[] }>('/api/healthcare').then((data) => setDocuments(data.documents)) }
  useEffect(() => { load().catch((caught) => setNote(caught.message)) }, [])

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run(async () => {
      const body = new FormData()
      body.set('file', file)
      const result = await api<{ imported: number; linked: number }>('/api/import?expect=healthcare', { method: 'POST', body })
      setNote(`Stored ${result.imported} document${result.imported === 1 ? '' : 's'}.${result.linked ? ` Linked ${result.linked} to a SWICA credit on the bank account.` : ' Link a bank credit below if the refund is already imported.'}`)
      await load()
    })
  }

  return (
    <div className="page">
      <div className="spread">
        <h1>Healthcare</h1>
        <div className="row">
          <button className="btn secondary" onClick={() => run(async () => { await api('/api/healthcare', { method: 'POST', body: JSON.stringify({}) }); await load() })}>Add manually</button>
          <label className="btn">Import SWICA PDF<input type="file" accept=".pdf" onChange={onFile} /></label>
        </div>
      </div>
      <Banner error={error} note={note} />
      <p className="muted">A SWICA Leistungsabrechnung is read for the insured person, the bill, your share, and the amount SWICA pays back. If the bank export contains that credit, it is linked. Scanned bills without text are kept so you can type the figures.</p>
      {!documents.length && <div className="card empty muted">No healthcare documents yet.</div>}
      {documents.map((doc) => <Editor key={doc.id} doc={doc} busy={busy} onSave={(body) => run(async () => { await api(`/api/healthcare/${doc.id}`, { method: 'PUT', body: JSON.stringify(body) }); setNote('Saved.'); await load() })} onDelete={() => run(async () => { await api(`/api/healthcare/${doc.id}`, { method: 'DELETE' }); await load() })} />)}
    </div>
  )
}

function Editor({ doc, busy, onSave, onDelete }: { doc: Doc; busy: boolean; onSave: (body: Doc) => void; onDelete: () => void }) {
  const [form, setForm] = useState(doc)
  useEffect(() => setForm(doc), [doc])
  function set<K extends keyof Doc>(key: K, value: Doc[K]) { setForm({ ...form, [key]: value }) }
  return (
    <form className="card stack" onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
      <div className="spread">
        <h2>{form.insuredName || form.providerName || 'Healthcare document'}</h2>
        {doc.referenceNo && <span className="tag">{doc.referenceNo}</span>}
      </div>
      <div className="grid-2">
        <label className="field">Insured person<input value={form.insuredName || ''} onChange={(event) => set('insuredName', event.target.value)} /></label>
        <label className="field">Insured number<input value={form.insuredNumber || ''} onChange={(event) => set('insuredNumber', event.target.value)} /></label>
        <label className="field">Provider<input value={form.providerName || ''} onChange={(event) => set('providerName', event.target.value)} /></label>
        <label className="field">Reference<input value={form.referenceNo || ''} onChange={(event) => set('referenceNo', event.target.value)} /></label>
        <label className="field">Document date<input type="date" value={String(form.documentDate || '').slice(0, 10)} onChange={(event) => set('documentDate', event.target.value)} /></label>
        <label className="field">Treatment date<input type="date" value={String(form.serviceDate || '').slice(0, 10)} onChange={(event) => set('serviceDate', event.target.value)} /></label>
        <label className="field">Invoice CHF<input type="number" step="0.01" value={form.invoiceAmount ?? ''} onChange={(event) => set('invoiceAmount', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label className="field">Your share CHF<input type="number" step="0.01" value={form.patientShare ?? ''} onChange={(event) => set('patientShare', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label className="field">SWICA pays CHF<input type="number" step="0.01" value={form.insurerShare ?? ''} onChange={(event) => set('insurerShare', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label className="field">Payout IBAN<input value={form.payoutIban || ''} onChange={(event) => set('payoutIban', event.target.value)} /></label>
      </div>
      <label className="field">What was treated<textarea value={form.description || ''} onChange={(event) => set('description', event.target.value)} /></label>
      <label className="field">Notes<textarea value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} /></label>
      <TransactionPicker value={form.transactionId} onChange={(transactionId) => set('transactionId', transactionId)} linked={doc.transactionDescription ? `${String(doc.bookingDate).slice(0, 10)} · ${doc.transactionDescription} · ${money(doc.transactionChf)}` : ''} />
      <div className="row">
        <button className="btn" disabled={busy} type="submit">Save</button>
        {doc.fileName && <a className="btn secondary" href={`/api/healthcare/${doc.id}/file`}>Open PDF</a>}
        <button className="btn danger" type="button" onClick={onDelete}>Delete</button>
      </div>
    </form>
  )
}

export function TransactionPicker({ value, onChange, linked }: { value: string | null; onChange: (id: string | null) => void; linked?: string }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<{ id: string; bookingDate: string; description: string; provider: string; chfAmount: number | null; amount: number; currency: string }[]>([])
  useEffect(() => {
    const handle = setTimeout(() => {
      api<{ rows: typeof rows }>(`/api/search/transactions?q=${encodeURIComponent(query)}`).then((data) => setRows(data.rows)).catch(() => setRows([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [query])
  return (
    <div className="stack">
      <label className="field">Linked bank or card transaction<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search to link, for example SWICA" /></label>
      {linked && <p className="muted">Currently linked: {linked}</p>}
      <select value={value || ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Not linked</option>
        {value && !rows.some((row) => row.id === value) && <option value={value}>{linked || 'Currently linked'}</option>}
        {rows.map((row) => <option key={row.id} value={row.id}>{String(row.bookingDate).slice(0, 10)} · {row.provider} · {row.description.slice(0, 60)} · {row.currency === 'CHF' ? money(row.amount) : money(row.chfAmount)}</option>)}
      </select>
    </div>
  )
}
