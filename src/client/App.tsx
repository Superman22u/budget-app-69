import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { api, type User } from './api'
import { AdminPage } from './pages/Admin'
import { AnalysisPage } from './pages/Analysis'
import { ForgotPage, LoginPage, RegisterPage, ResetPage } from './pages/AuthPages'
import { BudgetPage } from './pages/Budget'
import { HealthcarePage } from './pages/Healthcare'
import { InventoryPage } from './pages/Inventory'
import { HomePage } from './pages/Home'
import { PlanPage } from './pages/Plan'
import { ReceiptDetailPage, ReceiptsPage } from './pages/Receipts'
import { SettingsPage } from './pages/Settings'
import { TransactionsPage } from './pages/Transactions'
import { useUser } from './ui'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot" element={<ForgotPage />} />
      <Route path="/reset" element={<ResetPage />} />
      <Route element={<Gate />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/budget/plans/:id" element={<PlanPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/healthcare" element={<HealthcarePage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/receipts" element={<ReceiptsPage />} />
        <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/more" element={<MorePage />} />
      </Route>
    </Routes>
  )
}

function Gate() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => {
    api<User>('/api/auth/me').then(setUser).catch(() => setUser(null))
  }, [])
  if (user === undefined) return <p className="muted auth-wrap">Loading…</p>
  if (!user) return <Navigate to="/login" replace />
  return <Layout user={user} onLogout={() => { api('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null)) }} />
}

function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Budget<small>Household ledger</small></div>
        <nav>
          <Item to="/">Overview</Item>
          <Item to="/budget">Budget</Item>
          <Item to="/transactions">Transactions</Item>
          <Item to="/healthcare">Healthcare</Item>
          <Item to="/inventory">Inventory</Item>
          <Item to="/receipts">Receipts</Item>
          <Item to="/analysis">Analysis</Item>
          <Item to="/settings">Settings</Item>
          {user.role === 'admin' && <Item to="/admin">Users</Item>}
        </nav>
        <div className="who">
          {user.firstName} {user.lastName}
          <button className="btn secondary" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <div className="topbar">
          <strong>Budget</strong>
          <button className="btn ghost" onClick={onLogout}>Sign out</button>
        </div>
        <Outlet context={user} />
      </main>
      <nav className="bottom-nav">
        <Item to="/">Home</Item>
        <Item to="/budget">Budget</Item>
        <Item to="/transactions">Money</Item>
        <Item to="/receipts">Receipts</Item>
        <Item to="/more">More</Item>
      </nav>
    </div>
  )
}

function Item({ to, children }: { to: string; children: ReactNode }) {
  return <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>{children}</NavLink>
}

function MorePage() {
  const user = useUser()
  return (
    <div className="page">
      <h1>More</h1>
      <div className="card stack">
        <NavLink to="/healthcare">Healthcare</NavLink>
        <NavLink to="/inventory">Inventory</NavLink>
        <NavLink to="/analysis">Analysis</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        {user.role === 'admin' && <NavLink to="/admin">Users</NavLink>}
      </div>
    </div>
  )
}
