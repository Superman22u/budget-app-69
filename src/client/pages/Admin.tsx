import { useEffect, useState } from 'react'
import { api } from '../api'
import { Banner, useBusy, useUser } from '../ui'

type Account = { id: string; firstName: string; lastName: string; email: string; role: string; createdAt: string }

export function AdminPage() {
  const me = useUser()
  const [users, setUsers] = useState<Account[]>([])
  const [drafts, setDrafts] = useState<Record<string, Account & { password: string }>>({})
  const { error, note, setNote, run } = useBusy()

  function load() {
    return api<{ users: Account[] }>('/api/admin/users').then((data) => {
      setUsers(data.users)
      setDrafts(Object.fromEntries(data.users.map((user) => [user.id, { ...user, password: '' }])))
    })
  }
  useEffect(() => { load().catch((caught) => setNote(caught.message)) }, [])
  if (me.role !== 'admin') return <p>Only an administrator can maintain accounts.</p>

  return (
    <div className="page">
      <h1>Users</h1>
      <Banner error={error} note={note} />
      <p className="muted">Set a new password here when someone forgets theirs and email is not available. Tell them the password you enter. Deleting a user also deletes their budget and transactions.</p>
      {users.map((user) => {
        const draft = drafts[user.id]
        if (!draft) return null
        return (
          <form className="card stack" key={user.id} onSubmit={(event) => {
            event.preventDefault()
            run(async () => {
              await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(draft) })
              setNote(draft.password ? `Saved ${draft.email}. New password: ${draft.password}` : `Saved ${draft.email}.`)
              await load()
            })
          }}>
            <div className="grid-2">
              <label className="field">First name<input value={draft.firstName} onChange={(event) => setDrafts({ ...drafts, [user.id]: { ...draft, firstName: event.target.value } })} /></label>
              <label className="field">Last name<input value={draft.lastName} onChange={(event) => setDrafts({ ...drafts, [user.id]: { ...draft, lastName: event.target.value } })} /></label>
              <label className="field">Email<input value={draft.email} onChange={(event) => setDrafts({ ...drafts, [user.id]: { ...draft, email: event.target.value } })} /></label>
              <label className="field">Role
                <select value={draft.role} onChange={(event) => setDrafts({ ...drafts, [user.id]: { ...draft, role: event.target.value } })}>
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              <label className="field">New password<input value={draft.password} onChange={(event) => setDrafts({ ...drafts, [user.id]: { ...draft, password: event.target.value } })} placeholder="Leave empty to keep the current one" /></label>
            </div>
            <div className="row">
              <button className="btn" type="submit">Save</button>
              <button className="btn secondary" type="button" onClick={() => {
                const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
                let password = ''
                for (let index = 0; index < 14; index++) password += alphabet[Math.floor(Math.random() * alphabet.length)]
                setDrafts({ ...drafts, [user.id]: { ...draft, password } })
              }}>Generate password</button>
              {user.id !== me.id && <button className="btn danger" type="button" onClick={() => run(async () => { if (!confirm(`Delete ${user.email}?`)) return; await api(`/api/admin/users/${user.id}`, { method: 'DELETE' }); await load() })}>Delete</button>}
            </div>
          </form>
        )
      })}
    </div>
  )
}
