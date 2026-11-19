import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type User } from '../api'
import { Banner, onSubmit } from '../ui'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await api<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      navigate('/')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed')
    }
  }
  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Budget, bank and card movements, healthcare refunds, and receipts. One place for the household.</p>
        <Banner error={error} />
        <label className="field">Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
        <label className="field">Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
        <button className="btn" type="submit">Sign in</button>
        <div className="links"><Link to="/register">Create an account</Link><Link to="/forgot">Forgot password</Link></div>
      </form>
    </div>
  )
}

export function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' })
  const [error, setError] = useState('')
  function set(key: keyof typeof form, value: string) { setForm({ ...form, [key]: value }) }
  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={onSubmit(async () => {
        setError('')
        try {
          await api('/api/auth/register', { method: 'POST', body: JSON.stringify(form) })
          navigate('/')
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not register') }
      })}>
        <h1>Register</h1>
        <Banner error={error} />
        <label className="field">First name<input value={form.firstName} onChange={(event) => set('firstName', event.target.value)} required /></label>
        <label className="field">Last name<input value={form.lastName} onChange={(event) => set('lastName', event.target.value)} required /></label>
        <label className="field">Email<input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} autoComplete="email" required /></label>
        <label className="field">Password<input type="password" value={form.password} onChange={(event) => set('password', event.target.value)} autoComplete="new-password" required minLength={8} /></label>
        <button className="btn" type="submit">Create account</button>
        <Link to="/login">Already registered? Sign in</Link>
      </form>
    </div>
  )
}

export function ForgotPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={onSubmit(async () => {
        setError('')
        try {
          const result = await api<{ message: string }>('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) })
          setMessage(result.message)
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not send the link') }
      })}>
        <h1>Forgot password</h1>
        <p className="muted">If email is set up on the server, you get a link to choose a new password. Otherwise an administrator can set one for you.</p>
        <Banner error={error} note={message} />
        <label className="field">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <button className="btn" type="submit">Send reset link</button>
        <Link to="/login">Back to sign in</Link>
      </form>
    </div>
  )
}

export function ResetPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={onSubmit(async () => {
        setError('')
        try {
          await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token: params.get('token'), password }) })
          navigate('/login')
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not set the password') }
      })}>
        <h1>Set a new password</h1>
        <Banner error={error} />
        <label className="field">New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        <button className="btn" type="submit">Save password</button>
      </form>
    </div>
  )
}
