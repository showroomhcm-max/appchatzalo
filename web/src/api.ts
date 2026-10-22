import { io, type Socket } from 'socket.io-client'

const TOKEN_KEY = 'zcskh.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* trình duyệt chặn storage */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body })
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized()
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Lỗi ${res.status}`)
  return data as T
}

export function exportUrl(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return `/api/export?${q}`
}

/** Link tải file cần đăng nhập (Excel, xuất dữ liệu): gắn token vào query. */
/**
 * Link cần đăng nhập (tải file, bắt đầu kết nối Facebook/TikTok…). Link KHÔNG chứa mã đăng nhập;
 * khi bấm, main.tsx xin một mã dùng một lần (sống 2 phút) rồi mới mở link.
 */
export function authUrl(path: string) {
  return `/api${path}`
}

/** Mở link /api/... bằng mã dùng một lần (không để mã phiên 7 ngày lọt vào URL). */
export async function openAuthedLink(href: string) {
  const r = await api<{ token: string }>('/auth/link-token', { method: 'POST' })
  window.location.href = `${href}${href.includes('?') ? '&' : '?'}token=${encodeURIComponent(r.token)}`
}

/**
 * Chỉ cho link http(s) hoặc file đã tải lên trong app (chặn javascript:, data: … trong tin nhắn khách gửi).
 * Không cho link /api/…: bấm link /api/ là app tự gắn mã đăng nhập (main.tsx), khách không được tạo link kiểu đó.
 */
export function safeUrl(v: unknown) {
  const s = String(v ?? '').trim()
  return /^https?:\/\//i.test(s) || /^\/uploads\//.test(s) ? s : undefined
}

export function connectSocket(): Socket {
  return io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] })
}
