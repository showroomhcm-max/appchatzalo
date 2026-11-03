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

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  // Có giới hạn thời gian (gửi tin): mạng chập chờn thì báo lỗi để bấm Gửi lại, không treo mãi
  const ctrl = opts.timeoutMs ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: ctrl?.signal })
  } catch (e: any) {
    if (ctrl?.signal.aborted)
      throw new ApiError(0, `Quá ${Math.round(opts.timeoutMs! / 1000)} giây chưa xong: mạng chậm hoặc mất kết nối. Tin có thể đã tới khách, xem lại trước khi bấm Gửi lại.`)
    throw new ApiError(0, 'Không kết nối được máy chủ (mạng yếu hoặc mất mạng). Kiểm tra mạng rồi thử lại.')
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized()
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
  // 502–504 / 520–530: máy chủ đang khởi động lại (cập nhật bản mới) hoặc NAS mất mạng — Cloudflare trả trang lỗi, không phải JSON
  if (!res.ok && (data as any)?.error === undefined && (res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 520 && res.status <= 530)))
    throw new ApiError(res.status, `Máy chủ đang khởi động lại hoặc mất kết nối (lỗi ${res.status}). Đợi khoảng 30 giây rồi thử lại.`)
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Lỗi ${res.status}`)
  return data as T
}

/**
 * Gửi form có tệp (tin nhắn kèm ảnh): như api() nhưng báo % đã tải lên (fetch không báo được) và có giới hạn thời gian.
 * onProgress nhận 0–100; 100 = đã tải lên xong, máy chủ đang gửi sang Zalo.
 */
export function uploadForm<T = any>(path: string, body: FormData, opts: { timeoutMs: number; onProgress?: (pct: number) => void }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api${path}`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = opts.timeoutMs
    let last = -1
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100))
        if (pct !== last) opts.onProgress?.((last = pct))
      }
      xhr.upload.onload = () => last !== 100 && opts.onProgress?.((last = 100))
    }
    xhr.ontimeout = () =>
      reject(new ApiError(0, `Quá ${Math.round(opts.timeoutMs / 1000)} giây chưa xong: mạng chậm hoặc mất kết nối. Tin có thể đã tới khách, xem lại trước khi bấm Gửi lại.`))
    xhr.onerror = () => reject(new ApiError(0, 'Không kết nối được máy chủ (mạng yếu hoặc mất mạng). Kiểm tra mạng rồi thử lại.'))
    xhr.onload = () => {
      const s = xhr.status
      if (s === 401 && !path.startsWith('/auth/login')) onUnauthorized()
      let data: any = xhr.responseText
      if (xhr.getResponseHeader('content-type')?.includes('json')) {
        try {
          data = JSON.parse(xhr.responseText)
        } catch {
          /* giữ chữ */
        }
      }
      if (s >= 200 && s < 300) return resolve(data as T)
      if (data?.error === undefined && (s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530)))
        return reject(new ApiError(s, `Máy chủ đang khởi động lại hoặc mất kết nối (lỗi ${s}). Đợi khoảng 30 giây rồi thử lại.`))
      reject(new ApiError(s, data?.error ?? `Lỗi ${s}`))
    }
    xhr.send(body)
  })
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
