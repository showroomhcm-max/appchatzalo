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
  q.set('token', getToken() ?? '')
  return `/api/export?${q}`
}

/** Link tải file cần đăng nhập (Excel, xuất dữ liệu): gắn token vào query. */
export function authUrl(path: string) {
  return `/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken() ?? '')}`
}

export function connectSocket(): Socket {
  return io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] })
}
