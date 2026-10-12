import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { getToken, openAuthedLink } from './api'

// Link tải file / kết nối (/api/...) cần đăng nhập: xin mã dùng một lần rồi mới mở
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href^="/api/"]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    openAuthedLink(a.getAttribute('href')!).catch((err) => alert(err?.message ?? 'Không mở được link'))
  },
  true,
)

// Gửi lỗi trên trình duyệt về nhật ký máy chủ (Cài đặt › Nhật ký), tối đa 10 lỗi mỗi phút.
let sent: number[] = []
export function reportClientError(message: string, stack?: string) {
  const now = Date.now()
  sent = sent.filter((t) => now - t < 60_000)
  const token = getToken()
  if (sent.length >= 10 || !token) return
  sent.push(now)
  void fetch('/api/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, stack, url: location.href }),
  }).catch(() => {})
}
window.addEventListener('error', (e) => reportClientError(e.message, e.error?.stack))
window.addEventListener('unhandledrejection', (e) => reportClientError(String(e.reason?.message ?? e.reason), e.reason?.stack))

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    reportClientError(`Giao diện bị lỗi: ${error.message}`, error.stack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="splash">
        <div className="card center pad" style={{ maxWidth: 420 }}>
          <b>Trang gặp lỗi và đã tự gửi báo cáo cho quản lý.</b>
          <span className="muted small">{this.state.error.message}</span>
          <button className="btn primary" onClick={() => location.reload()}>
            Tải lại trang
          </button>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
