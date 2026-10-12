import { useEffect, useState, type FormEvent } from 'react'
import { Database, LogOut, MessagesSquare, Radio, Settings as SettingsIcon, KeyRound } from 'lucide-react'
import { api, getToken, setToken } from './api'
import { AppProvider, useApp } from './store'
import type { User } from './types'
import Inbox from './pages/Inbox'
import Reports from './pages/Reports'
import type { SettingsTab } from './pages/Settings'
import Channels from './pages/Channels'
import SettingsPage from './pages/Settings'
import { Avatar, Modal } from './components'
import { UpdateBanner, VersionTag } from './version'

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

type Page = 'inbox' | 'channels' | 'data' | 'settings'

type Route = { page: Page; convId: string | null; msgId: number | null; tab?: SettingsTab }

function parseHash(): Route {
  const [, rawPage, id, msg] = window.location.hash.split('/')
  // Link cũ trước khi gộp trang
  const legacy: Record<string, Partial<Route>> = {
    reports: { page: 'data' },
    users: { page: 'settings', tab: 'users' },
    integrations: { page: 'settings', tab: 'integrations' },
    zalo: { page: 'channels' },
  }
  if (legacy[rawPage]) return { page: 'inbox', convId: null, msgId: null, ...legacy[rawPage] }
  const page = rawPage
  const valid: Page[] = ['inbox', 'channels', 'data', 'settings']
  // Hỗ trợ link từ web app khác: /?c=<threadId>
  const c = new URLSearchParams(window.location.search).get('c')
  if (c) return { page: 'inbox', convId: c, msgId: null }
  return {
    tab: page === 'settings' && id ? (id as SettingsTab) : undefined,
    page: valid.includes(page as Page) ? (page as Page) : 'inbox',
    convId: page === 'inbox' && id ? decodeURIComponent(id) : null,
    // #/inbox/<hội thoại>/<id tin nhắn>: mở hội thoại và nhảy tới tin đó (từ kết quả tìm kiếm)
    msgId: page === 'inbox' && msg && /^\d+$/.test(msg) ? Number(msg) : null,
  }
}

function Shell() {
  const { user, zaloStatuses: allStatuses, workingChannelIds, logout, socketConnected } = useApp()
  const zaloStatuses = workingChannelIds ? allStatuses.filter((s) => workingChannelIds.includes(s.channelId)) : allStatuses
  const [route, setRoute] = useState(parseHash)
  const [pwOpen, setPwOpen] = useState(false)
  const { can: allowed } = useApp()
  const canData = allowed('data.view') || allowed('data.export')
  const canSettings = (['users.manage', 'departments.manage', 'tags.manage', 'templates.manage', 'integrations.manage', 'logs.view', 'permissions.manage'] as const).some((p) => allowed(p))

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

  const nav: { id: Page; label: string; icon: React.ReactNode; show?: boolean }[] = [
    { id: 'inbox', label: 'Hội thoại', icon: <MessagesSquare size={20} /> },
    { id: 'channels', label: 'Kênh Chat', icon: <Radio size={20} /> },
    { id: 'data', label: 'Dữ liệu', icon: <Database size={20} />, show: canData },
    { id: 'settings', label: 'Cài đặt', icon: <SettingsIcon size={20} />, show: canSettings },
  ]

  const offline = zaloStatuses.filter((s) => s.state !== 'connected')
  const zaloOk = zaloStatuses.length > 0 && offline.length === 0

  return (
    <div className="shell">
      <aside className="sidenav">
        <div className="sidenav-brand" title="Zalo CSKH">
          <MessagesSquare size={22} />
        </div>
        <nav>
          {nav
            .filter((n) => n.show !== false)
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
            href="#/channels"
            className={`zalo-dot ${zaloOk ? 'ok' : 'bad'}`}
            title={
              zaloOk
                ? `Đã kết nối ${zaloStatuses.length} kênh Zalo`
                : offline.length
                  ? `Chưa kết nối: ${offline.map((s) => s.channelName).join(', ')}`
                  : 'Chưa có kênh Zalo nào'
            }
            aria-label="Trạng thái Zalo"
          />
          {user.auth_source === 'local' && (
            <button className="icon-btn" onClick={() => setPwOpen(true)} title="Đổi mật khẩu" aria-label="Đổi mật khẩu">
              <KeyRound size={18} />
            </button>
          )}
          <div className="me" title={`${user.display_name} (${user.super_admin ? 'Super Admin' : user.role === 'admin' ? 'Quản lý' : 'Nhân viên'})`}>
            <Avatar name={user.display_name} size={32} />
          </div>
          <button className="icon-btn" onClick={logout} title="Đăng xuất" aria-label="Đăng xuất">
            <LogOut size={18} />
          </button>
          <VersionTag />
        </div>
      </aside>
      <main className="main">
        <UpdateBanner />
        {route.page !== 'channels' && (offline.length > 0 || (allowed('channels.manage') && zaloStatuses.length === 0)) && (
          <div className="banner warn">
            {zaloStatuses.length === 0
              ? 'Chưa có kênh Zalo nào — chưa nhận/gửi được tin nhắn.'
              : offline.every((s) => s.state === 'connecting')
                ? `Đang kết nối Zalo: ${offline.map((s) => s.channelName).join(', ')}…`
                : `Kênh chưa kết nối: ${offline.map((s) => s.channelName).join(', ')}. Tin nhắn của kênh này chưa nhận/gửi được.`}
            <a href="#/channels">Mở trang Kênh Chat</a>
          </div>
        )}
        {!socketConnected && <div className="banner info">Mất kết nối realtime với máy chủ, đang thử lại…</div>}
        {route.page === 'inbox' && <Inbox convId={route.convId} focusMsgId={route.msgId} />}
        {route.page === 'channels' && <Channels />}
        {route.page === 'data' && canData && <Reports />}
        {route.page === 'settings' && canSettings && <SettingsPage tab={route.tab} />}
        {((route.page === 'data' && !canData) || (route.page === 'settings' && !canSettings)) && (
          <div className="page">
            <div className="card center pad">Bạn chưa được cấp quyền vào trang này. Nhờ quản lý cấp quyền trong Cài đặt › Phân quyền.</div>
          </div>
        )}
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
