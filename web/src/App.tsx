import { useEffect, useState, type FormEvent } from 'react'
import { BarChart3, LogOut, MessagesSquare, PlugZap, QrCode, Users as UsersIcon, KeyRound } from 'lucide-react'
import { api, getToken, setToken } from './api'
import { AppProvider, useApp } from './store'
import type { User } from './types'
import Inbox from './pages/Inbox'
import Reports from './pages/Reports'
import UsersPage from './pages/Users'
import ZaloConnect from './pages/ZaloConnect'
import Integrations from './pages/Integrations'
import { Avatar, Modal } from './components'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(!!getToken())

  useEffect(() => {
    if (!getToken()) return
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="splash">Đang tải…</div>
  if (!user) return <Login onLogin={setUser} />
  return (
    <AppProvider user={user} onLogout={() => setUser(null)}>
      <Shell />
    </AppProvider>
  )
}

type LoginResponse = { token?: string; user?: User; totp_required?: boolean; pending_id?: string }

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = pendingId
        ? await api<LoginResponse>('/auth/login-totp', { body: { pending_id: pendingId, code: otp } })
        : await api<LoginResponse>('/auth/login', { body: { username, password } })
      if (r.totp_required && r.pending_id) {
        setPendingId(r.pending_id)
        setOtp('')
        return
      }
      setToken(r.token!)
      onLogin(r.user!)
    } catch (err: any) {
      setError(err.message)
      if (/hết hạn/.test(err.message)) setPendingId(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lockup">
          <span className="brand-mark">
            <MessagesSquare size={22} />
          </span>
          <div>
            <div className="brand-name">Zalo CSKH</div>
            <div className="brand-sub">Đăng nhập bằng tài khoản Odoo SieuToc</div>
          </div>
        </div>
        {!pendingId ? (
          <>
            <label className="field">
              <span>Email / tên đăng nhập Odoo</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="ten@sieutoc.com"
              />
            </label>
            <label className="field">
              <span>Mật khẩu Odoo</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Mã xác thực 2 lớp (OTP)</span>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 số trên app Authenticator"
            />
          </label>
        )}
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary block" disabled={busy || (pendingId ? otp.length < 6 : !username || !password)}>
          {busy ? 'Đang kiểm tra…' : pendingId ? 'Xác nhận' : 'Đăng nhập'}
        </button>
        {pendingId && (
          <button type="button" className="btn ghost block" onClick={() => setPendingId(null)}>
            Quay lại
          </button>
        )}
      </form>
    </div>
  )
}

type Page = 'inbox' | 'reports' | 'users' | 'zalo' | 'integrations'

function parseHash(): { page: Page; convId: string | null } {
  const [, page, id] = window.location.hash.split('/')
  const valid: Page[] = ['inbox', 'reports', 'users', 'zalo', 'integrations']
  // Hỗ trợ link từ web app khác: /?c=<threadId>
  const c = new URLSearchParams(window.location.search).get('c')
  if (c) return { page: 'inbox', convId: c }
  return {
    page: valid.includes(page as Page) ? (page as Page) : 'inbox',
    convId: page === 'inbox' && id ? decodeURIComponent(id) : null,
  }
}

function Shell() {
  const { user, zalo, logout, socketConnected } = useApp()
  const [route, setRoute] = useState(parseHash)
  const [pwOpen, setPwOpen] = useState(false)
  const isAdmin = user.role === 'admin'

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    if (window.location.search.includes('c=')) {
      // Chuyển link ?c= thành hash để giữ trạng thái khi tải lại.
      const { convId } = parseHash()
      history.replaceState(null, '', `/#/inbox/${encodeURIComponent(convId ?? '')}`)
    }
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const nav: { id: Page; label: string; icon: React.ReactNode; admin?: boolean }[] = [
    { id: 'inbox', label: 'Hội thoại', icon: <MessagesSquare size={20} /> },
    { id: 'reports', label: 'Báo cáo & Training', icon: <BarChart3 size={20} /> },
    { id: 'users', label: 'Nhân viên', icon: <UsersIcon size={20} />, admin: true },
    { id: 'zalo', label: 'Kết nối Zalo', icon: <QrCode size={20} />, admin: true },
    { id: 'integrations', label: 'Tích hợp', icon: <PlugZap size={20} />, admin: true },
  ]

  const zaloOk = zalo.state === 'connected'

  return (
    <div className="shell">
      <aside className="sidenav">
        <div className="sidenav-brand" title="Zalo CSKH">
          <MessagesSquare size={22} />
        </div>
        <nav>
          {nav
            .filter((n) => !n.admin || isAdmin)
            .map((n) => (
              <a
                key={n.id}
                href={`#/${n.id}`}
                className={`nav-item ${route.page === n.id ? 'active' : ''}`}
                title={n.label}
                aria-label={n.label}
              >
                {n.icon}
                <span className="nav-label">{n.label}</span>
              </a>
            ))}
        </nav>
        <div className="sidenav-foot">
          <a
            href={isAdmin ? '#/zalo' : undefined}
            className={`zalo-dot ${zaloOk ? 'ok' : 'bad'}`}
            title={zaloOk ? `Zalo đã kết nối: ${zalo.account?.name}` : 'Zalo chưa kết nối'}
            aria-label="Trạng thái Zalo"
          />
          {user.auth_source === 'local' && (
            <button className="icon-btn" onClick={() => setPwOpen(true)} title="Đổi mật khẩu" aria-label="Đổi mật khẩu">
              <KeyRound size={18} />
            </button>
          )}
          <div className="me" title={`${user.display_name} (${user.role === 'admin' ? 'Quản trị' : 'Nhân viên'})`}>
            <Avatar name={user.display_name} size={32} />
          </div>
          <button className="icon-btn" onClick={logout} title="Đăng xuất" aria-label="Đăng xuất">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main">
        {!zaloOk && route.page !== 'zalo' && (
          <div className="banner warn">
            {zalo.state === 'connecting'
              ? 'Đang kết nối Zalo…'
              : zalo.error ?? 'Zalo chưa được kết nối — chưa nhận/gửi được tin nhắn.'}
            {isAdmin && zalo.state !== 'connecting' && <a href="#/zalo">Kết nối ngay</a>}
          </div>
        )}
        {!socketConnected && <div className="banner info">Mất kết nối realtime với máy chủ, đang thử lại…</div>}
        {route.page === 'inbox' && <Inbox convId={route.convId} />}
        {route.page === 'reports' && <Reports />}
        {route.page === 'users' && isAdmin && <UsersPage />}
        {route.page === 'zalo' && isAdmin && <ZaloConnect />}
        {route.page === 'integrations' && isAdmin && <Integrations />}
      </main>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  )
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await api('/auth/password', { body: { current, next } })
      onClose()
    } catch (err: any) {
      setMsg(err.message)
    }
  }
  return (
    <Modal title="Đổi mật khẩu" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Mật khẩu hiện tại</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>Mật khẩu mới (tối thiểu 6 ký tự)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        {msg && <div className="form-error">{msg}</div>}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary">Lưu</button>
        </div>
      </form>
    </Modal>
  )
}
