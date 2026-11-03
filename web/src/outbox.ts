/**
 * Hàng chờ gửi tin: bấm Gửi là tin hiện ngay trong khung chat ("Đang gửi…"), ô nhập xóa liền để gõ tin tiếp,
 * còn việc gửi sang Zalo / Facebook chạy phía sau. Nằm ngoài khung chat nên chuyển sang hội thoại khác rồi quay lại
 * vẫn thấy tin đang gửi / gửi lỗi.
 *
 * Như Zalo: mỗi hội thoại có 2 luồng gửi — tin chữ và tin có ảnh / tệp. Trong mỗi luồng gửi lần lượt (giữ thứ tự),
 * nhưng tin chữ không phải đứng chờ ảnh đang tải lên chậm.
 */
import { useSyncExternalStore } from 'react'
import { uploadForm } from './api'
import type { Message } from './types'

export type OutboxItem = {
  tmpId: string
  convId: string
  text: string
  files: File[]
  /** Ảnh xem trước (link tạm trong máy) để tin ảnh hiện ngay như Zalo */
  previews: (string | null)[]
  quote: { id: number; from: string; text: string } | null
  mode?: 'public' | 'private'
  mentions?: { pos: number; len: number; uid: string }[]
  createdAt: number
  status: 'sending' | 'failed'
  /** Tin có tệp: % đã tải lên máy chủ (100 = đang gửi sang Zalo) */
  progress?: number
  error?: string
}

let items: OutboxItem[] = []
const snapshots = new Map<string, OutboxItem[]>()
const listeners = new Set<() => void>()
const chains = new Map<string, Promise<void>>()
const sentListeners = new Set<(convId: string, messages: Message[]) => void>()

function emit() {
  snapshots.clear()
  for (const l of listeners) l()
}

function update(tmpId: string, patch: Partial<OutboxItem> | null) {
  if (patch === null) items.find((i) => i.tmpId === tmpId)?.previews.forEach((u) => u && URL.revokeObjectURL(u))
  items = patch === null ? items.filter((i) => i.tmpId !== tmpId) : items.map((i) => (i.tmpId === tmpId ? { ...i, ...patch } : i))
  emit()
}

const MAX_SIDE = 2048
/**
 * Ảnh lớn (ảnh chụp điện thoại 3–5 MB) → thu về cạnh dài 2048px, JPEG chất lượng 0,82 (thường còn 300–600 KB):
 * gửi nhanh hơn nhiều trên mạng di động; Zalo cũng tự nén ảnh như vậy. Lỗi / không nhỏ hơn thì gửi ảnh gốc.
 */
async function shrinkImage(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || f.size < 500 * 1024) return f
  try {
    const bmp = await createImageBitmap(f)
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * k)
    const h = Math.round(bmp.height * k)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return f
    ctx.fillStyle = '#fff' // ảnh PNG nền trong suốt → nền trắng khi chuyển JPEG
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    if (!blob || blob.size >= f.size) return f
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: f.lastModified })
  } catch {
    return f
  }
}

function run(item: OutboxItem) {
  const lane = `${item.convId}|${item.files.length ? 'file' : 'text'}`
  const prev = chains.get(lane) ?? Promise.resolve()
  const next = prev.then(async () => {
    const fd = new FormData()
    fd.append('text', item.text)
    if (item.quote) fd.append('quote_message_id', String(item.quote.id))
    if (item.mode) fd.append('mode', item.mode)
    if (item.mentions?.length) fd.append('mentions', JSON.stringify(item.mentions))
    const files = await Promise.all(item.files.map(shrinkImage))
    files.forEach((f) => fd.append('files', f))
    try {
      // Có tệp: tối đa 3 phút (tải lên + gửi Zalo), chỉ chữ: 1 phút
      const saved = await uploadForm<Message[]>(`/conversations/${encodeURIComponent(item.convId)}/messages`, fd, {
        timeoutMs: files.length ? 180_000 : 60_000,
        onProgress: files.length ? (p) => update(item.tmpId, { progress: p }) : undefined,
      })
      // Đưa tin thật vào khung chat ngay (không chờ tín hiệu realtime) rồi mới bỏ bản "đang gửi"
      for (const l of sentListeners) l(item.convId, Array.isArray(saved) ? saved : [])
      update(item.tmpId, null)
    } catch (e: any) {
      update(item.tmpId, { status: 'failed', progress: undefined, error: e?.message ?? 'Gửi thất bại' })
    }
  })
  chains.set(lane, next)
}

/** Xếp tin vào hàng chờ gửi; trả về ngay. */
export function queueSend(input: Omit<OutboxItem, 'tmpId' | 'createdAt' | 'status' | 'error' | 'previews' | 'progress'>) {
  const item: OutboxItem = {
    ...input,
    previews: input.files.map((f) => (/^image\//.test(f.type) ? URL.createObjectURL(f) : null)),
    tmpId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    status: 'sending',
    progress: input.files.length ? 0 : undefined,
  }
  items = [...items, item]
  emit()
  run(item)
}

export function retrySend(tmpId: string) {
  const item = items.find((i) => i.tmpId === tmpId)
  if (!item || item.status !== 'failed') return
  update(tmpId, { status: 'sending', error: undefined, progress: item.files.length ? 0 : undefined })
  run({ ...item, status: 'sending' })
}

export function discardSend(tmpId: string) {
  update(tmpId, null)
}

/** Tin đang gửi / gửi lỗi của một hội thoại (cập nhật tự động). */
export function useOutbox(convId: string) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => {
      let s = snapshots.get(convId)
      if (!s) {
        s = items.filter((i) => i.convId === convId)
        snapshots.set(convId, s)
      }
      return s
    },
  )
}

/** Nhận tin thật vừa gửi xong (để khung chat thêm ngay). */
export function onSent(fn: (convId: string, messages: Message[]) => void) {
  sentListeners.add(fn)
  return () => {
    sentListeners.delete(fn)
  }
}

/** Còn tin đang gửi (cảnh báo trước khi đóng trang). */
export const hasPendingSends = () => items.some((i) => i.status === 'sending')

// Còn tin đang gửi mà đóng / tải lại trang: hỏi lại để không mất tin
window.addEventListener('beforeunload', (e) => {
  if (!hasPendingSends()) return
  e.preventDefault()
  e.returnValue = ''
})
