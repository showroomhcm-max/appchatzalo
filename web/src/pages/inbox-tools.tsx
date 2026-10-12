import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronRight, Mail, Pin, PinOff, RotateCcw, Search, Trash2, UserCheck, UserPlus, UserRound, UsersRound, X } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { Conversation, User } from '../types'
import { Avatar, Modal } from '../components'
import { can } from '../perm'
import { fold } from '../util'

export type ConvAction = 'pin' | 'unpin' | 'read' | 'unread' | 'assign' | 'status' | 'delete' | 'restore'

/** Gửi thao tác cho một hoặc nhiều hội thoại. Trả về thông báo kết quả. */
export async function bulkAction(ids: string[], action: ConvAction, value?: unknown) {
  if (action === 'delete' && !confirm(`Xóa ${ids.length} hội thoại khỏi hộp thư? Dữ liệu vẫn được giữ để training, khách nhắn lại thì hội thoại hiện lại.`)) return null
  const r = await api<{ ok: boolean; done: number; failed: { id: string; error: string }[] }>('/conversations/bulk', { body: { ids, action, value } })
  return r.failed.length ? `Xong ${r.done}/${ids.length}. Lỗi: ${r.failed[0].error}` : null
}

/** Người có thể nhận phân công (đang hoạt động) */
export function useAssignable() {
  const { users } = useApp()
  return users.filter((u) => u.active)
}

/** Menu chuột phải / nút ⋯ của một hội thoại */
export function ConvMenu({
  conv,
  pinned,
  x,
  y,
  deletedView,
  onClose,
  onDone,
  onSelectMany,
}: {
  conv: Conversation
  pinned: boolean
  x: number
  y: number
  deletedView: boolean
  onClose: () => void
  onDone: (msg: string | null, action: ConvAction) => void
  onSelectMany: () => void
}) {
  const { user } = useApp()
  const users = useAssignable()
  const [sub, setSub] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  // Giữ menu trong màn hình
  const left = Math.min(x, window.innerWidth - 240)
  const top = Math.min(y, window.innerHeight - 320)

  async function run(action: ConvAction, value?: unknown) {
    onClose()
    try {
      onDone(await bulkAction([conv.id], action, value), action)
    } catch (e: any) {
      onDone(e.message, action)
    }
  }
  const canAssign = can(user, 'conversations.assign')

  return (
    <div className="conv-menu" ref={ref} style={{ left, top }} role="menu">
      {deletedView ? (
        <button role="menuitem" onClick={() => run('restore')}>
          <RotateCcw size={16} /> Khôi phục
        </button>
      ) : (
        <>
          <button role="menuitem" onClick={() => run(pinned ? 'unpin' : 'pin')}>
            {pinned ? <PinOff size={16} /> : <Pin size={16} />} {pinned ? 'Bỏ ghim' : 'Ghim hội thoại'}
          </button>
          {conv.unread_count > 0 ? (
            <button role="menuitem" onClick={() => run('read')}>
              <CheckCheck size={16} /> Đánh dấu đã đọc
            </button>
          ) : (
            <button role="menuitem" onClick={() => run('unread')}>
              <Mail size={16} /> Đánh dấu chưa đọc
            </button>
          )}
          <div className="menu-sub-wrap" onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
            <button role="menuitem" aria-haspopup="menu" aria-expanded={sub} onClick={() => setSub((v) => !v)}>
              <UserCheck size={16} /> Phân công người hỗ trợ <ChevronRight size={14} className="menu-chev" />
            </button>
            {sub && (
              <div className="conv-menu sub" role="menu">
                {!conv.assigned_to && (
                  <button role="menuitem" onClick={() => run('assign', user.id)}>
                    <UserRound size={16} /> Tôi nhận
                  </button>
                )}
                {(canAssign ? users : users.filter((u) => u.id === user.id)).map((u) => (
                  <button key={u.id} role="menuitem" onClick={() => run('assign', u.id)} className={conv.assigned_to === u.id ? 'on' : ''}>
                    <Avatar name={u.display_name} size={18} /> {u.display_name}
                    {conv.assigned_to === u.id && <Check size={14} className="menu-chev" />}
                  </button>
                ))}
                {conv.assigned_to && (canAssign || conv.assigned_to === user.id) && (
                  <button role="menuitem" onClick={() => run('assign', null)}>
                    <X size={16} /> Bỏ phân công
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              onClose()
              onSelectMany()
            }}
          >
            <Check size={16} /> Chọn nhiều
          </button>
          {can(user, 'conversations.delete') && (
            <button role="menuitem" className="danger" onClick={() => run('delete')}>
              <Trash2 size={16} /> Xóa hội thoại
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Thanh thao tác khi đang chọn nhiều hội thoại */
export function BulkBar({
  ids,
  total,
  deletedView,
  onSelectAll,
  onCancel,
  onDone,
}: {
  ids: string[]
  total: number
  deletedView: boolean
  onSelectAll: () => void
  onCancel: () => void
  onDone: (msg: string | null, action: ConvAction) => void
}) {
  const { user } = useApp()
  const users = useAssignable()
  const [busy, setBusy] = useState(false)
  async function run(action: ConvAction, value?: unknown) {
    if (!ids.length) return
    setBusy(true)
    try {
      const msg = await bulkAction(ids, action, value)
      onDone(msg, action)
    } catch (e: any) {
      onDone(e.message, action)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bulk-bar">
      <div className="row">
        <b className="grow">Đã chọn {ids.length}</b>
        <button className="link-btn" onClick={onSelectAll}>
          {ids.length === total ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
        </button>
        <button className="icon-btn sm" onClick={onCancel} aria-label="Thoát chọn nhiều">
          <X size={16} />
        </button>
      </div>
      <div className="row wrap">
        {deletedView ? (
          <button className="btn outline sm" disabled={busy || !ids.length} onClick={() => run('restore')}>
            <RotateCcw size={14} /> Khôi phục
          </button>
        ) : (
          <>
            <button className="btn outline sm" disabled={busy || !ids.length} onClick={() => run('read')} title="Đánh dấu đã đọc">
              <CheckCheck size={14} /> Đã đọc
            </button>
            <button className="btn outline sm" disabled={busy || !ids.length} onClick={() => run('unread')} title="Đánh dấu chưa đọc">
              <Mail size={14} /> Chưa đọc
            </button>
            <button className="btn outline sm" disabled={busy || !ids.length} onClick={() => run('pin')}>
              <Pin size={14} /> Ghim
            </button>
            <button className="btn outline sm" disabled={busy || !ids.length} onClick={() => run('status', 'closed')}>
              <Check size={14} /> Xong
            </button>
            <select
              className="select sm"
              value=""
              disabled={busy || !ids.length}
              onChange={(e) => e.target.value && run('assign', e.target.value === 'none' ? null : Number(e.target.value))}
              aria-label="Phân công người hỗ trợ"
            >
              <option value="">Phân công…</option>
              {(can(user, 'conversations.assign') ? users : users.filter((u) => u.id === user.id)).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
              {can(user, 'conversations.assign') && <option value="none">Bỏ phân công</option>}
            </select>
            {can(user, 'conversations.delete') && (
              <button className="btn danger sm" disabled={busy || !ids.length} onClick={() => run('delete')}>
                <Trash2 size={14} /> Xóa
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ───────────── Zalo cá nhân: lời mời kết bạn, tạo nhóm, kết bạn với khách ─────────────

type FriendRequest = { uid: string; name: string; avatar: string; phone: string | null; message: string; channel_id: number; channel_name: string }

export function FriendRequestsModal({ onClose, onOpen }: { onClose: () => void; onOpen: (convId: string) => void }) {
  const [list, setList] = useState<FriendRequest[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const load = () =>
    api<FriendRequest[]>('/zalo/friend-requests')
      .then(setList)
      .catch((e) => setError(e.message))
  useEffect(() => {
    void load()
  }, [])
  async function act(r: FriendRequest, action: 'accept' | 'reject') {
    setBusy(r.uid + action)
    setError('')
    try {
      const res = await api<{ conversation_id: string | null }>(`/zalo/${r.channel_id}/friend-requests/${r.uid}/${action}`, { body: { name: r.name, avatar: r.avatar } })
      if (action === 'accept' && res.conversation_id) onOpen(res.conversation_id)
      void load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }
  return (
    <Modal title="Lời mời kết bạn Zalo" onClose={onClose}>
      <div className="stack">
        {!list && !error && <div className="muted">Đang tải…</div>}
        {list?.length === 0 && <div className="muted">Không có lời mời kết bạn nào đang chờ.</div>}
        {list?.map((r) => (
          <div key={`${r.channel_id}-${r.uid}`} className="friend-row">
            <Avatar name={r.name} src={r.avatar} size={40} />
            <div className="grow">
              <b>{r.name}</b>
              <div className="small muted">
                {r.channel_name}
                {r.phone ? ` · ${r.phone}` : ''}
              </div>
              {r.message && <div className="small">"{r.message}"</div>}
            </div>
            <button className="btn primary sm" disabled={!!busy} onClick={() => act(r, 'accept')}>
              Đồng ý
            </button>
            <button className="btn ghost sm" disabled={!!busy} onClick={() => act(r, 'reject')}>
              Từ chối
            </button>
          </div>
        ))}
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}

export function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: (convId: string) => void }) {
  const { chatChannels, zaloStatuses } = useApp()
  const zaloChannels = chatChannels.filter((c) => c.platform === 'zalo' && c.active && zaloStatuses.find((s) => s.channelId === c.id)?.state === 'connected')
  const [channelId, setChannelId] = useState(zaloChannels[0]?.id ?? 0)
  const [name, setName] = useState('')
  const [friends, setFriends] = useState<{ uid: string; name: string; avatar: string; phone: string | null }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!channelId) return
    setPicked([])
    api<typeof friends>(`/zalo/${channelId}/friends`)
      .then(setFriends)
      .catch((e) => setError(e.message))
  }, [channelId])
  const shown = friends.filter((f) => !q.trim() || fold(f.name).includes(fold(q.trim())) || (f.phone ?? '').includes(q.trim())).slice(0, 100)

  async function create() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ conversation_id: string; failed: string[] }>(`/zalo/${channelId}/groups`, { body: { name, members: picked } })
      if (r.failed.length) alert(`Đã tạo nhóm. ${r.failed.length} người chưa thêm được (có thể họ chặn được thêm vào nhóm).`)
      onCreated(r.conversation_id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Tạo nhóm Zalo" onClose={onClose}>
      <div className="stack">
        {!zaloChannels.length ? (
          <div className="muted">Chưa có kênh Zalo cá nhân nào đang kết nối.</div>
        ) : (
          <>
            {zaloChannels.length > 1 && (
              <label className="field">
                <span>Tạo bằng tài khoản Zalo</span>
                <select className="select" value={channelId} onChange={(e) => setChannelId(Number(e.target.value))}>
                  {zaloChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Tên nhóm</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: MemoryZone x Anh Tuấn" autoFocus />
            </label>
            <div className="field">
              <span>Thành viên (bạn bè Zalo) · đã chọn {picked.length}</span>
              <label className="search-box">
                <Search size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, số điện thoại" aria-label="Tìm bạn bè" />
              </label>
              <div className="friend-pick">
                {shown.map((f) => (
                  <label key={f.uid} className="picker-item">
                    <input type="checkbox" checked={picked.includes(f.uid)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.uid] : picked.filter((x) => x !== f.uid))} />
                    <Avatar name={f.name} src={f.avatar} size={28} />
                    <span className="grow">{f.name}</span>
                    {f.phone && <span className="small muted">{f.phone}</span>}
                  </label>
                ))}
                {!shown.length && <div className="muted small pad">Không có bạn bè phù hợp.</div>}
              </div>
            </div>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy || !name.trim() || !picked.length} onClick={create}>
            <UsersRound size={16} /> Tạo nhóm
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Nút kết bạn với khách (Zalo cá nhân, hội thoại 1-1) */
export function FriendButton({ conv }: { conv: Conversation }) {
  const [st, setSt] = useState<{ isFriend: boolean; requested: boolean; requesting: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const enc = encodeURIComponent(conv.id)
  useEffect(() => {
    setSt(null)
    api<NonNullable<typeof st>>(`/conversations/${enc}/friend`)
      .then(setSt)
      .catch(() => setSt(null))
  }, [enc])
  if (!st) return null
  if (st.isFriend) return <span className="badge green">Bạn bè Zalo</span>

  async function send(action?: 'undo') {
    let message = ''
    if (!action) {
      const m = prompt('Lời nhắn kèm lời mời kết bạn:', 'MemoryZone xin phép kết bạn để tiện tư vấn và hỗ trợ bảo hành ạ.')
      if (m === null) return
      message = m
    }
    setBusy(true)
    try {
      setSt(await api(`/conversations/${enc}/friend`, { body: { action, message } }))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }
  async function accept() {
    setBusy(true)
    try {
      await api(`/zalo/${conv.channel_id}/friend-requests/${conv.thread_id}/accept`, { body: {} })
      setSt({ isFriend: true, requested: false, requesting: false })
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }
  if (st.requesting)
    return (
      <button className="btn primary sm" disabled={busy} onClick={accept} title="Khách đã gửi lời mời kết bạn">
        <UserCheck size={14} /> Đồng ý kết bạn
      </button>
    )
  if (st.requested)
    return (
      <button className="btn ghost sm" disabled={busy} onClick={() => send('undo')} title="Đã gửi lời mời, bấm để hủy">
        <UserPlus size={14} /> Đã gửi lời mời · Hủy
      </button>
    )
  return (
    <button className="btn outline sm" disabled={busy} onClick={() => send()}>
      <UserPlus size={14} /> Kết bạn
    </button>
  )
}

export type { User }
