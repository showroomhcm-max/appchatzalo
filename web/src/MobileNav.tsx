import { useEffect, type ReactNode } from 'react'
import { ClipboardList, KeyRound, LogOut, MoreHorizontal, ShieldOff, UserRound } from 'lucide-react'
import { api } from './api'
import { useApp } from './store'
import { Avatar } from './components'
import { BUILD } from './version'

export type NavItem = { id: string; label: string; short: string; icon: ReactNode; badge?: number }

/**
 * Thanh dưới đáy cho điện thoại (kiểu Sapo, theo sieutoc-ui khung-dt):
 * - ≤ 4 màn được vào ⇒ đưa hết lên thanh, ô cuối là Tài khoản.
 * - > 4 màn ⇒ 3 màn đầu + "Thêm" (các màn còn lại + tài khoản).
 * - Đang ở màn nằm trong "Thêm" thì ô Thêm sáng.
 * - Màn chi tiết (đang mở một hội thoại) ẩn thanh này — CSS lo qua lớp .detail của .shell.
 */
export function BottomBar({ items, active, onMore, moreOpen }: { items: NavItem[]; active: string; onMore: () => void; moreOpen: boolean }) {
  const direct = items.length <= 4 ? items : items.slice(0, 3)
  const rest = items.length <= 4 ? [] : items.slice(3)
  const moreActive = moreOpen || rest.some((i) => i.id === active)
  const restBadge = rest.reduce((s, i) => s + (i.badge ?? 0), 0)
  return (
    <nav className="bottom-bar" aria-label="Điều hướng chính" style={{ gridTemplateColumns: `repeat(${direct.length + 1}, 1fr)` }}>
      {direct.map((i) => (
        <a key={i.id} href={`#/${i.id}`} className={`bb-item ${active === i.id ? 'on' : ''}`} aria-current={active === i.id ? 'page' : undefined}>
          <span className="bb-ic">
            {i.icon}
            {!!i.badge && <span className="nav-badge">{i.badge > 99 ? '99+' : i.badge}</span>}
          </span>
          <span className="bb-tx">{i.short}</span>
        </a>
      ))}
      <button className={`bb-item ${moreActive ? 'on' : ''}`} onClick={onMore} aria-haspopup="dialog" aria-expanded={moreOpen}>
        <span className="bb-ic">
          {rest.length ? <MoreHorizontal size={22} /> : <UserRound size={22} />}
          {restBadge > 0 && <span className="nav-badge">{restBadge}</span>}
        </span>
        <span className="bb-tx">{rest.length ? 'Thêm' : 'Tài khoản'}</span>
      </button>
    </nav>
  )
}

/** Tấm trượt từ đáy: các màn còn lại + tài khoản (đổi mật khẩu, đăng xuất…) */
export function MoreSheet({ items, reportUrl, onClose, onChangePassword }: { items: NavItem[]; reportUrl?: string | null; onClose: () => void; onChangePassword: () => void }) {
  const { user, logout, zaloStatuses } = useApp()
  const rest = items.length <= 4 ? [] : items.slice(3)
  const offline = zaloStatuses.filter((s) => s.state !== 'connected')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={rest.length ? 'Thêm' : 'Tài khoản'}>
        <div className="sheet-grip" />
        {rest.length > 0 && (
          <div className="sheet-group">
            {rest.map((i) => (
              <a key={i.id} href={`#/${i.id}`} className="sheet-row" onClick={onClose}>
                <span className="sheet-ic">{i.icon}</span>
                <span className="grow">{i.label}</span>
                {!!i.badge && <span className="unread-count">{i.badge}</span>}
              </a>
            ))}
          </div>
        )}
        {reportUrl && (
          <div className="sheet-group">
            <a href="#/sso/baocao" target="_blank" rel="noopener" className="sheet-row" onClick={onClose}>
              <span className="sheet-ic">
                <ClipboardList size={20} />
              </span>
              <span className="grow">Báo cáo công việc</span>
            </a>
          </div>
        )}
        <div className="sheet-group">
          <div className="sheet-row static">
            <Avatar name={user.display_name} size={40} />
            <span className="grow">
              <b>{user.display_name}</b>
              <span className="small muted">{user.super_admin ? 'Super Admin' : user.role === 'admin' ? 'Quản lý' : 'Nhân viên'}</span>
            </span>
          </div>
          <div className="sheet-row static small">
            <span className={`status-dot ${offline.length || !zaloStatuses.length ? 'bad' : 'ok'}`} />
            <span className="grow">
              {!zaloStatuses.length ? 'Chưa có kênh chat nào' : offline.length ? `Chưa kết nối: ${offline.map((s) => s.channelName).join(', ')}` : `Đã kết nối ${zaloStatuses.length} kênh chat`}
            </span>
          </div>
          {user.auth_source === 'local' && (
            <button
              className="sheet-row"
              onClick={() => {
                onClose()
                onChangePassword()
              }}
            >
              <span className="sheet-ic">
                <KeyRound size={20} />
              </span>
              <span className="grow">Đổi mật khẩu</span>
            </button>
          )}
          <button
            className="sheet-row"
            onClick={async () => {
              if (!confirm('Đăng xuất tài khoản này khỏi MỌI thiết bị? Dùng khi nghi lộ tài khoản.')) return
              try {
                await api('/auth/logout-all', { method: 'POST' })
              } finally {
                logout()
              }
            }}
          >
            <span className="sheet-ic">
              <ShieldOff size={20} />
            </span>
            <span className="grow">Đăng xuất mọi thiết bị</span>
          </button>
          <button className="sheet-row danger" onClick={logout}>
            <span className="sheet-ic">
              <LogOut size={20} />
            </span>
            <span className="grow">Đăng xuất</span>
          </button>
        </div>
        <div className="sheet-foot small muted">Chat Siêu Tốc · phiên bản {BUILD.version}</div>
      </div>
    </div>
  )
}
