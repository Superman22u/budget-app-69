import { useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { User } from './api'

export function useUser(): User {
  return useOutletContext<User>()
}

export function Banner({ error, note }: { error?: string; note?: string }) {
  if (error) return <div className="banner error">{error}</div>
  if (note) return <div className="banner ok">{note}</div>
  return null
}

export function useBusy() {
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNote('')
    try { await action() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong') }
    finally { setBusy(false) }
  }
  return { error, note, setNote, busy, run }
}

export function onSubmit(run: () => void | Promise<void>) {
  return (event: FormEvent) => {
    event.preventDefault()
    void run()
  }
}
