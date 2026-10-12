import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useApp } from './store'

export const BUILD = __APP_BUILD__

type ServerVersion = {
  version: string
  commit: string
  startedAt: string
  web: { version: string; buildId: string; builtAt: string; commit: string } | null
}

export function buildTimeLabel(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Số phiên bản ở góc trái dưới; rê chuột để xem chi tiết. */
export function VersionTag() {
  const title = `Phiên bản ${BUILD.version}\nCập nhật lúc ${buildTimeLabel(BUILD.builtAt)}${BUILD.commit ? `\nMã: ${BUILD.commit}` : ''}`
  return (
    <span className="version-tag" title={title}>
      v{BUILD.version}
    </span>
  )
}

/**
 * Kiểm tra máy chủ có bản giao diện mới hơn bản đang mở không (sau mỗi lần cập nhật app trên máy chủ).
 * Kiểm tra lúc mở, mỗi 2 phút, và mỗi lần kết nối realtime nối lại (máy chủ vừa khởi động lại).
 */
export function UpdateBanner() {
  const { socket } = useApp()
  const [next, setNext] = useState<ServerVersion | null>(null)

  useEffect(() => {
    let alive = true
    const check = () =>
      fetch('/api/version', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((v: ServerVersion | null) => {
          if (alive && v?.web?.buildId && v.web.buildId !== BUILD.buildId) setNext(v)
        })
        .catch(() => {})
    void check()
    const t = setInterval(check, 2 * 60_000)
    socket?.on('connect', check)
    return () => {
      alive = false
      clearInterval(t)
      socket?.off('connect', check)
    }
  }, [socket])

  if (!next?.web) return null
  const sameVersion = next.web.version === BUILD.version
  return (
    <div className="banner update">
      <RefreshCw size={16} />
      <span>
        {sameVersion
          ? `Đã có bản cập nhật mới của phiên bản ${next.web.version} (lúc ${buildTimeLabel(next.web.builtAt)}).`
          : `Đã có phiên bản mới ${next.web.version} (bạn đang dùng ${BUILD.version}).`}{' '}
        Tải lại trang để dùng bản mới, tin nhắn đang soạn dở vẫn được giữ.
      </span>
      <button className="btn primary sm" onClick={() => window.location.reload()}>
        Tải lại
      </button>
    </div>
  )
}
