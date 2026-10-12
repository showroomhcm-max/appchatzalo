import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Globe, X } from 'lucide-react'
import { api } from './api'
import { initials } from './util'

const AVATAR_TONES = ['#0a804a', '#2563c9', '#7ba63b', '#085e37', '#55655c', '#0f9557', '#47601f']

export function Avatar({ name, src, size = 40 }: { name: string | null | undefined; src?: string | null; size?: number }) {
  const tone = AVATAR_TONES[[...(name ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: src ? undefined : tone }}>
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}

/** Link public (Cloudflare Tunnel) để gửi cho nhân viên đăng nhập từ bất kỳ đâu. */
export function PublicLink() {
  const [url, setUrl] = useState<string | null>(null)
  const [fixed, setFixed] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api<{ url: string | null; fixed: boolean }>('/system/public-url').then((r) => {
      setUrl(r.url)
      setFixed(r.fixed)
    }).catch(() => {})
  }, [])
  if (!url) return null
  return (
    <div className="card public-link">
      <div className="row">
        <Globe size={20} className="ok-icon" />
        <b>Link cho nhân viên đăng nhập</b>
      </div>
      <div className="secret">
        <a href={url} target="_blank" rel="noreferrer" className="break">
          {url}
        </a>
        <button
          className="btn outline sm"
          onClick={() => {
            void navigator.clipboard?.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Đã chép' : 'Chép link'}
        </button>
      </div>
      {!fixed && (
        <p className="muted small">
          Link tạm thời: đổi mỗi khi máy chủ khởi động lại. Khi đó vào lại trang này để lấy link mới gửi cho mọi người.
        </p>
      )}
    </div>
  )
}
