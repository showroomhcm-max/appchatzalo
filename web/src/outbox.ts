/**
 * Hàng chờ gửi tin: bấm Gửi là tin hiện ngay trong khung chat ("Đang gửi…"), ô nhập xóa liền để gõ tin tiếp,
 * còn việc gửi sang Zalo / Facebook chạy phía sau. Mỗi hội thoại gửi tuần tự (giữ đúng thứ tự tin).
 * Nằm ngoài khung chat nên chuyển sang hội thoại khác rồi quay lại vẫn thấy tin đang gửi / gửi lỗi.
 */
import { useSyncExternalStore } from 'react'
import { api } from './api'
import type { Message } from './types'

export type OutboxItem = {
  tmpId: string
  convId: string
  text: string
  files: File[]
  quote: { id: number; from: string; text: string } | null
  mode?: 'public' | 'private'
  mentions?: { pos: number; len: number; uid: string }[]
  createdAt: number
  status: 'sending' | 'failed'
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
  items = patch === null ? items.filter((i) => i.tmpId !== tmpId) : items.map((i) => (i.tmpId === tmpId ? { ...i, ...patch } : i))
  emit()
}

function run(item: OutboxItem) {
  const prev = chains.get(item.convId) ?? Promise.resolve()
  const next = prev.then(async () => {
    const fd = new FormData()
    fd.append('text', item.text)
    if (item.quote) fd.append('quote_message_id', String(item.quote.id))
    if (item.mode) fd.append('mode', item.mode)
    if (item.mentions?.length) fd.append('mentions', JSON.stringify(item.mentions))
    item.files.forEach((f) => fd.append('files', f))
    try {
      const saved = await api<Message[]>(`/conversations/${encodeURIComponent(item.convId)}/messages`, { body: fd })
      // Đưa tin thật vào khung chat ngay (không chờ tín hiệu realtime) rồi mới bỏ bản "đang gửi"
      for (const l of sentListeners) l(item.convId, Array.isArray(saved) ? saved : [])
      update(item.tmpId, null)
    } catch (e: any) {
      update(item.tmpId, { status: 'failed', error: e?.message ?? 'Gửi thất bại' })
    }
  })
  chains.set(item.convId, next)
}

/** Xếp tin vào hàng chờ gửi; trả về ngay. */
export function queueSend(input: Omit<OutboxItem, 'tmpId' | 'createdAt' | 'status' | 'error'>) {
  const item: OutboxItem = {
    ...input,
    tmpId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    status: 'sending',
  }
  items = [...items, item]
  emit()
  run(item)
}

export function retrySend(tmpId: string) {
  const item = items.find((i) => i.tmpId === tmpId)
  if (!item || item.status !== 'failed') return
  update(tmpId, { status: 'sending', error: undefined })
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
