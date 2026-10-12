export function timeLabel(ts: number | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = (now.getTime() - d.getTime()) / 86400000
  if (diffDays < 7) return d.toLocaleDateString('vi-VN', { weekday: 'short' })
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export function fullTime(ts: number) {
  return new Date(ts).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function dayLabel(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Hôm nay'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? '?').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export function duration(sec: number | null) {
  if (sec === null || sec === undefined) return '—'
  if (sec < 60) return `${sec} giây`
  if (sec < 3600) return `${Math.round(sec / 60)} phút`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h} giờ ${m} phút` : `${h} giờ`
}

export function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Đang xử lý',
  pending: 'Chờ phản hồi',
  closed: 'Đã xong',
}

/** Bỏ dấu + chữ thường, giữ nguyên độ dài chuỗi (giống hàm fold ở máy chủ) để tìm và tô đậm không phân biệt dấu. */
export function fold(s: string | null | undefined) {
  if (!s) return ''
  let out = ''
  for (const ch of s.normalize('NFC')) {
    const base = ch.normalize('NFD').replace(/\p{Mn}/gu, '')
    out += (base === 'đ' || base === 'Đ' ? 'd' : base.length === 1 ? base : ch).toLowerCase()
  }
  return out
}
