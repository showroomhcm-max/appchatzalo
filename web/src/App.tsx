import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { BarChart3, Eye, LogOut, MessagesSquare, Radio, Settings as SettingsIcon } from 'lucide-react'
import { api, ApiError, getToken, setToken } from './api'
import { AppProvider, useApp } from './store'
import type { User } from './types'
import Inbox from './pages/Inbox'
import type { SettingsTab } from './pages/Settings'
// Trang ít mở tải riêng khi cần (gói đầu nhẹ hơn, mở Hội thoại nhanh hơn)
const Reports = lazy(() => import('./pages/Reports'))
const Channels = lazy(() => import('./pages/Channels'))
const Monitor = lazy(() => import('./pages/Monitor'))
const SettingsPage = lazy(() => import('./pages/Settings'))
import { Avatar, Modal } from './components'
import { UpdateBanner, VersionTag } from './version'
import ChannelPicker from './ChannelPicker'
import { APP_NAME, MzMark } from './Logo'
import { BottomBar, MoreSheet, type NavItem } from './MobileNav'
import { AccountMenu } from './AccountMenu'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(!!getToken())
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    if (!getToken()) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    // Chỉ đăng xuất khi máy chủ báo phiên hết hạn (401/403). Máy chủ đang khởi động lại (cập nhật bản mới,
    // lỗi 502, mất mạng) thì chờ rồi thử lại, không bắt đăng nhập lại.
    const check = () =>
      api<User>('/auth/me')
        .then((u) => {
          if (!alive) return
          setUser(u)
          setChecking(false)
        })
        .catch((e) => {
          if (!alive) return
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setToken(null)
            setChecking(false)
          } else {
            setWaiting(true)
            timer = setTimeout(check, 3000)
          }
        })
    void check()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  if (checking) return <div className="splash">{waiting ? 'Đang kết nối máy chủ… (app vừa cập nhật, đợi vài giây)' : 'Đang tải…'}</div>
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
            <MzMark size={44} />
          </span>
          <div>
            <div className="brand-name">{APP_NAME}</div>
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

type Page = 'inbox' | 'channels' | 'monitor' | 'data' | 'settings'

const PAGE_TITLE: Record<Page, string> = { inbox: 'Hội thoại', channels: 'Kênh Chat', monitor: 'Giám sát Zalo nhân viên', data: 'Báo cáo', settings: 'Cài đặt' }

type Route = { page: Page; convId: string | null; msgId: number | null; tab?: SettingsTab; monitorChannel?: number | null; monitorConv?: string | null; findPhone?: string | null; sso?: 'baocao' | null; reportTab?: string | null }

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
  // #/sso/baocao: app Báo cáo công việc CSKH xin đăng nhập một chạm
  if (rawPage === 'sso' && id === 'baocao') return { page: 'inbox', convId: null, msgId: null, sso: 'baocao' }
  // #/find/<sđt>: app khác (DVKT…) mở tìm khách theo số điện thoại
  if (rawPage === 'find') {
    let raw = id ?? ''
    try {
      raw = decodeURIComponent(raw)
    } catch {
      /* link hỏng: dùng nguyên chuỗi */
    }
    const phone = raw.replace(/[^\d+]/g, '').slice(0, 15)
    return { page: 'inbox', convId: null, msgId: null, findPhone: phone.length >= 8 ? phone : null }
  }
  const page = rawPage
  const valid: Page[] = ['inbox', 'channels', 'monitor', 'data', 'settings']
  // Hỗ trợ link từ web app khác: /?c=<threadId>
  const c = new URLSearchParams(window.location.search).get('c')
  if (c) return { page: 'inbox', convId: c, msgId: null }
  return {
    tab: page === 'settings' && id ? (id as SettingsTab) : undefined,
    page: valid.includes(page as Page) ? (page as Page) : 'inbox',
    convId: page === 'inbox' && id ? decodeURIComponent(id) : null,
    // #/inbox/<hội thoại>/<id tin nhắn>: mở hội thoại và nhảy tới tin đó (từ kết quả tìm kiếm)
    msgId: page === 'inbox' && msg && /^\d+$/.test(msg) ? Number(msg) : null,
    // #/monitor/<kênh>/<hội thoại>
    monitorChannel: page === 'monitor' && id && /^\d+$/.test(id) ? Number(id) : null,
    monitorConv: page === 'monitor' && msg ? decodeURIComponent(msg) : null,
    // #/data/<tab>: mục Báo cáo (overview | staff | monitor | export)
    reportTab: page === 'data' && id ? id : null,
  }
}

function Shell() {
  const { user, zaloStatuses: allStatuses, workingChannelIds, logout, socketConnected, alerts } = useApp()
  const alertCount = alerts.filter((a) => !workingChannelIds || (a.channel_id !== null && workingChannelIds.includes(a.channel_id))).length
  const zaloStatuses = workingChannelIds ? allStatuses.filter((s) => workingChannelIds.includes(s.channelId)) : allStatuses
  const [route, setRoute] = useState(parseHash)
  const [pwOpen, setPwOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const { can: allowed } = useApp()
  const canData = allowed('data.view') || allowed('data.export') || allowed('monitor.view')
  const canSettings = (['channels.manage', 'alerts.manage', 'users.manage', 'departments.manage', 'tags.manage', 'templates.manage', 'integrations.manage', 'logs.view', 'permissions.manage'] as const).some((p) => allowed(p))

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
    { id: 'monitor', label: 'Giám sát Zalo nhân viên', icon: <Eye size={20} />, show: allowed('monitor.view') },
    { id: 'data', label: 'Báo cáo', icon: <BarChart3 size={20} />, show: canData },
    { id: 'settings', label: 'Cài đặt', icon: <SettingsIcon size={20} />, show: canSettings },
  ]

  const offline = zaloStatuses.filter((s) => s.state !== 'connected')
  const zaloOk = zaloStatuses.length > 0 && offline.length === 0
  // Thanh dưới đáy (điện thoại): tên ngắn cho từng màn
  const SHORT: Record<string, string> = { inbox: 'Hội thoại', channels: 'Kênh', monitor: 'Giám sát', data: 'Báo cáo', settings: 'Cài đặt' }
  const mobileItems: NavItem[] = nav
    .filter((n) => n.show !== false)
    .map((n) => ({ id: n.id, label: n.label, short: SHORT[n.id] ?? n.label, icon: n.icon, badge: n.id === 'inbox' ? alertCount : undefined }))
  // Màn chi tiết (đang mở một hội thoại): ẩn thanh trên + thanh dưới cho khung chat chiếm trọn màn như Zalo
  const detail = (route.page === 'inbox' && !!route.convId) || (route.page === 'monitor' && !!route.monitorConv)
  useEffect(() => setMoreOpen(false), [route.page, route.convId])

  // App Báo cáo công việc CSKH: #/sso/baocao (nút đăng nhập của app đó) → ký vé đăng nhập rồi chuyển sang
  const [ssoMsg, setSsoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (route.sso !== 'baocao') return
    setSsoMsg({ ok: true, text: 'Đang mở app Báo cáo công việc…' })
    api<{ url: string }>('/report-link/sso', { method: 'POST' })
      .then((r) => {
        if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(r.url)) throw new Error('Địa chỉ app báo cáo không hợp lệ')
        window.location.replace(r.url)
      })
      .catch((e) => {
        setSsoMsg({ ok: false, text: e.message })
        history.replaceState(null, '', '#/inbox')
      })
  }, [route.sso])

  return (
    <div className={`shell ${detail ? 'detail' : ''}`}>
      <aside className="sidenav">
        <div className="sidenav-brand" title={`${APP_NAME} · MemoryZone`}>
          <MzMark size={30} />
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
                {n.id === 'inbox' && alertCount > 0 && (
                  <span className="nav-badge" title={`${alertCount} cảnh báo đơn "rơi"`}>
                    {alertCount > 99 ? '99+' : alertCount}
                  </span>
                )}
              </a>
            ))}
        </nav>
        <div className="sidenav-foot">
          <a
            href="#/channels"
            className={`zalo-dot ${zaloOk ? 'ok' : 'bad'}`}
            title={
              zaloOk
                ? `Đã kết nối ${zaloStatuses.length} kênh chat`
                : offline.length
                  ? `Chưa kết nối: ${offline.map((s) => s.channelName).join(', ')}`
                  : 'Chưa có kênh chat nào'
            }
            aria-label="Trạng thái kênh chat"
          />
          <button
            className={`me ${accountOpen ? 'on' : ''}`}
            title={`${user.display_name} · tài khoản, ảnh đại diện, giao diện`}
            aria-label="Tài khoản"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((v) => !v)}
          >
            <Avatar name={user.display_name} src={user.avatar} size={32} />
          </button>
          <button className="icon-btn" onClick={logout} title="Đăng xuất" aria-label="Đăng xuất">
            <LogOut size={18} />
          </button>
          <VersionTag />
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="topbar-title">{PAGE_TITLE[route.page]}</span>
          {/* Chọn kênh chỉ có tác dụng với hộp thư Hội thoại */}
          {route.page === 'inbox' && <ChannelPicker />}
        </header>
        <UpdateBanner />
        {ssoMsg && <div className={`banner ${ssoMsg.ok ? 'info' : 'warn'} inline`}>{ssoMsg.text}</div>}
        {route.page !== 'channels' && (offline.length > 0 || (allowed('channels.manage') && zaloStatuses.length === 0)) && (
          <div className="banner warn">
            {zaloStatuses.length === 0
              ? 'Chưa có kênh chat nào — chưa nhận/gửi được tin nhắn.'
              : offline.every((s) => s.state === 'connecting')
                ? `Đang kết nối kênh: ${offline.map((s) => s.channelName).join(', ')}…`
                : `Kênh chưa kết nối: ${offline.map((s) => s.channelName).join(', ')}. Tin nhắn của kênh này chưa nhận/gửi được.`}
            <a href={allowed('channels.manage') ? '#/settings/channels' : '#/channels'}>{allowed('channels.manage') ? 'Mở Kết nối kênh' : 'Mở trang Kênh Chat'}</a>
          </div>
        )}
        {!socketConnected && <div className="banner info">Mất kết nối realtime với máy chủ, đang thử lại…</div>}
        {route.page === 'inbox' && <Inbox convId={route.convId} focusMsgId={route.msgId} findPhone={route.findPhone} />}
        <Suspense fallback={<div className="splash">Đang tải…</div>}>
          {route.page === 'channels' && <Channels />}
          {route.page === 'monitor' && allowed('monitor.view') && <Monitor channelId={route.monitorChannel ?? null} convId={route.monitorConv ?? null} />}
          {route.page === 'data' && canData && <Reports tab={route.reportTab} />}
          {route.page === 'settings' && canSettings && <SettingsPage tab={route.tab} />}
        </Suspense>
        {((route.page === 'data' && !canData) || (route.page === 'settings' && !canSettings)) && (
          <div className="page">
            <div className="card center pad">Bạn chưa được cấp quyền vào trang này. Nhờ quản lý cấp quyền trong Cài đặt › Phân quyền.</div>
          </div>
        )}
      </main>
      <BottomBar items={mobileItems} active={route.page} onMore={() => setMoreOpen((v) => !v)} moreOpen={moreOpen} />
      {moreOpen && <MoreSheet items={mobileItems} onClose={() => setMoreOpen(false)} onChangePassword={() => setPwOpen(true)} />}
      {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} onChangePassword={() => setPwOpen(true)} />}
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
      const r = await api<{ token?: string }>('/auth/password', { body: { current, next } })
      // Đổi mật khẩu: các thiết bị khác bị đăng xuất, thiết bị này nhận phiên mới
      if (r.token) setToken(r.token)
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
