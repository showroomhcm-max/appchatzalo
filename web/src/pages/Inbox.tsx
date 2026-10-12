import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  FileText,
  Hand,
  Inbox as InboxIcon,
  MessageSquareDashed,
  Paperclip,
  PanelRight,
  RotateCcw,
  Search,
  Send,
  Star,
  StickyNote,
  Tag,
  Undo2,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import { api, exportUrl } from '../api'
import { useApp, useSocketEvent } from '../store'
import type { Conversation, ConvStatus, Message, Note, Review, Template } from '../types'
import { Avatar, Badge, Empty } from '../components'
import { dayLabel, fullTime, STATUS_LABEL, timeLabel } from '../util'

type Scope = 'mine' | 'unassigned' | 'all'

export default function Inbox({ convId }: { convId: string | null }) {
  const { user } = useApp()
  const [scope, setScope] = useState<Scope>(user.role === 'admin' ? 'all' : 'mine')
  const [status, setStatus] = useState<string>('active')
  const [q, setQ] = useState('')
  const [list, setList] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  // Màn hình hẹp: khung thông tin nổi đè lên chat nên mặc định đóng.
  const [showInfo, setShowInfo] = useState(() => window.innerWidth > 1200)

  const statusParam = status === 'active' ? undefined : status
  const matches = useCallback(
    (c: Conversation) => {
      if (scope === 'mine' && c.assigned_to !== user.id) return false
      if (scope === 'unassigned' && c.assigned_to !== null) return false
      if (status === 'active' && c.status === 'closed') return false
      if (status !== 'active' && status !== 'all' && c.status !== status) return false
      return true
    },
    [scope, status, user.id],
  )

  const load = useCallback(
    async (before?: number) => {
      const params = new URLSearchParams({ scope, limit: '50' })
      if (statusParam && statusParam !== 'all') params.set('status', statusParam)
      if (q.trim()) params.set('q', q.trim())
      if (before) params.set('before', String(before))
      const rows = await api<Conversation[]>(`/conversations?${params}`)
      const filtered = status === 'active' ? rows.filter((c) => c.status !== 'closed') : rows
      setHasMore(rows.length === 50)
      setList((prev) => (before ? [...prev, ...filtered.filter((r) => !prev.some((p) => p.id === r.id))] : filtered))
      setLoading(false)
    },
    [scope, statusParam, status, q],
  )

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => void load(), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const upsert = useCallback(
    (c: Conversation) => {
      setList((prev) => {
        const without = prev.filter((p) => p.id !== c.id)
        const existed = without.length !== prev.length
        if (!matches(c) || (q.trim() && !existed)) return without
        const next = [c, ...without]
        return next.sort((a, b) => (b.last_message_at ?? b.created_at) - (a.last_message_at ?? a.created_at))
      })
    },
    [matches, q],
  )

  useSocketEvent<{ conversation: Conversation }>('message:new', ({ conversation }) => upsert(conversation))
  useSocketEvent<Conversation>('conversation:update', upsert)

  const current = list.find((c) => c.id === convId) ?? null

  return (
    <div className={`inbox ${convId ? 'has-active' : ''}`}>
      <section className="conv-pane">
        <div className="conv-head">
          <h2>Hội thoại</h2>
          <div className="search">
            <Search size={16} />
            <input placeholder="Tìm tên, nội dung, mã KH…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Xóa tìm kiếm">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="seg">
            {(
              [
                ['mine', 'Của tôi'],
                ['unassigned', 'Chưa nhận'],
                ['all', 'Tất cả'],
              ] as [Scope, string][]
            ).map(([id, label]) => (
              <button key={id} className={scope === id ? 'on' : ''} onClick={() => setScope(id)}>
                {label}
              </button>
            ))}
          </div>
          <select className="select sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
            <option value="active">Chưa xong</option>
            <option value="open">Đang xử lý</option>
            <option value="pending">Chờ phản hồi</option>
            <option value="closed">Đã xong</option>
            <option value="all">Tất cả trạng thái</option>
          </select>
        </div>
        <div className="conv-list">
          {loading && <div className="muted pad">Đang tải…</div>}
          {!loading && !list.length && (
            <Empty icon={<InboxIcon size={28} />} title="Không có hội thoại">
              {scope === 'mine' ? 'Chưa có hội thoại nào giao cho bạn. Xem tab "Chưa nhận".' : 'Tin nhắn mới từ Zalo sẽ hiện ở đây.'}
            </Empty>
          )}
          {list.map((c) => (
            <ConvItem key={c.id} c={c} active={c.id === convId} />
          ))}
          {hasMore && !loading && (
            <button
              className="btn ghost block"
              onClick={() => {
                const last = list[list.length - 1]
                void load(last.last_message_at ?? last.created_at)
              }}
            >
              Tải thêm
            </button>
          )}
        </div>
      </section>
      {convId ? (
        <ChatView key={convId} convId={convId} initial={current} showInfo={showInfo} toggleInfo={() => setShowInfo((v) => !v)} />
      ) : (
        <section className="chat-pane">
          <Empty icon={<MessageSquareDashed size={36} />} title="Chọn một hội thoại để bắt đầu">
            Nhiều nhân viên có thể cùng xử lý — bạn sẽ thấy ai đang xem hoặc đang soạn tin ở từng hội thoại.
          </Empty>
        </section>
      )}
    </div>
  )
}

function ConvItem({ c, active }: { c: Conversation; active: boolean }) {
  const { presence, user } = useApp()
  const viewers = (presence.byConversation[c.id] ?? []).filter((p) => p.userId !== user.id)
  const typing = viewers.find((v) => v.typing)
  const waiting = c.last_direction === 'in' && c.status !== 'closed'
  return (
    <a href={`#/inbox/${encodeURIComponent(c.id)}`} className={`conv-item ${active ? 'active' : ''} ${c.unread_count ? 'unread' : ''}`}>
      <Avatar name={c.name ?? c.id} src={c.avatar} size={44} />
      <div className="conv-main">
        <div className="conv-top">
          <span className="conv-name">
            {c.type === 1 && <UsersRound size={14} className="inline-icon" />}
            {c.name ?? c.id}
          </span>
          <span className="conv-time">{timeLabel(c.last_message_at ?? c.created_at)}</span>
        </div>
        <div className="conv-bottom">
          <span className="conv-preview">
            {typing ? (
              <em className="typing-text">{typing.name} đang soạn tin…</em>
            ) : (
              <>
                {c.last_direction === 'out' && <span className="muted">Shop: </span>}
                {c.last_message_preview ?? ''}
              </>
            )}
          </span>
          {c.unread_count > 0 && <span className="unread-count">{c.unread_count > 99 ? '99+' : c.unread_count}</span>}
        </div>
        <div className="conv-meta">
          {c.assigned_name ? (
            <Badge tone={c.assigned_to === user.id ? 'green' : 'neutral'}>
              <UserRound size={12} /> {c.assigned_to === user.id ? 'Bạn' : c.assigned_name}
            </Badge>
          ) : (
            <Badge tone="warning">Chưa nhận</Badge>
          )}
          {waiting && <Badge tone="info">Chờ trả lời</Badge>}
          {c.status !== 'open' && <Badge tone={c.status === 'closed' ? 'neutral' : 'lime'}>{STATUS_LABEL[c.status]}</Badge>}
          {viewers.length > 0 && !typing && (
            <span className="viewers" title={`Đang xem: ${viewers.map((v) => v.name).join(', ')}`}>
              <Eye size={12} /> {viewers.length}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}

function senderLabel(m: Message) {
  if (m.direction === 'in') return null
  if (m.agent_name) return m.agent_name
  if (m.source === 'api') return 'Hệ thống (API)'
  if (m.source === 'history') return 'Shop'
  return 'Gửi từ điện thoại'
}

function ChatView({
  convId,
  initial,
  showInfo,
  toggleInfo,
}: {
  convId: string
  initial: Conversation | null
  showInfo: boolean
  toggleInfo: () => void
}) {
  const { user, users, presence, socket } = useApp()
  const [conv, setConv] = useState<Conversation | null>(initial)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [hasOlder, setHasOlder] = useState(false)
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    api<Conversation>(`/conversations/${encodeURIComponent(convId)}`)
      .then((c) => alive && setConv(c))
      .catch((e) => alive && setError(e.message))
    api<Message[]>(`/conversations/${encodeURIComponent(convId)}/messages?limit=60`).then((rows) => {
      if (!alive) return
      setMessages(rows)
      setHasOlder(rows.length === 60)
      setLoading(false)
    })
    void api(`/conversations/${encodeURIComponent(convId)}/read`, { method: 'POST' })
    socket?.emit('view', convId)
    return () => {
      alive = false
      socket?.emit('view', null)
    }
  }, [convId, socket])

  useSocketEvent<{ message: Message; conversation: Conversation }>('message:new', ({ message, conversation }) => {
    if (message.conversation_id !== convId) return
    setConv(conversation)
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message].sort((a, b) => a.ts - b.ts || a.id - b.id)))
    if (message.direction === 'in' && document.visibilityState === 'visible') {
      void api(`/conversations/${encodeURIComponent(convId)}/read`, { method: 'POST' })
    }
  })
  useSocketEvent<{ message: Message }>('message:update', ({ message }) => {
    if (message.conversation_id !== convId) return
    setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)))
  })
  useSocketEvent<Conversation>('conversation:update', (c) => c.id === convId && setConv(c))

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current
      prevHeight.current = null
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  async function loadOlder() {
    if (!messages.length) return
    prevHeight.current = scroller.current?.scrollHeight ?? null
    const rows = await api<Message[]>(
      `/conversations/${encodeURIComponent(convId)}/messages?limit=60&before=${messages[0].ts}`,
    )
    setHasOlder(rows.length === 60)
    setMessages((prev) => [...rows.filter((r) => !prev.some((p) => p.id === r.id)), ...prev])
  }

  async function patch(body: Partial<Conversation>) {
    try {
      setConv(await api<Conversation>(`/conversations/${encodeURIComponent(convId)}`, { method: 'PATCH', body }))
    } catch (e: any) {
      alert(e.message)
    }
  }

  const others = (presence.byConversation[convId] ?? []).filter((p) => p.userId !== user.id)
  const typingOthers = others.filter((p) => p.typing)
  const assignedToOther = conv?.assigned_to && conv.assigned_to !== user.id
  const canReassign = user.role === 'admin' || conv?.assigned_to === user.id

  if (error) {
    return (
      <section className="chat-pane">
        <Empty title="Không mở được hội thoại">{error}</Empty>
      </section>
    )
  }

  return (
    <>
      <section className="chat-pane">
        <header className="chat-head">
          <a href="#/inbox" className="icon-btn back-btn" aria-label="Quay lại danh sách">
            <ArrowLeft size={18} />
          </a>
          <Avatar name={conv?.name ?? convId} src={conv?.avatar} size={40} />
          <div className="chat-title">
            <div className="chat-name">{conv?.name ?? convId}</div>
            <div className="chat-sub">
              {others.length ? (
                <span className="presence-line">
                  <Eye size={13} /> {others.map((o) => o.name).join(', ')} đang xem
                </span>
              ) : conv?.type === 1 ? (
                'Nhóm Zalo'
              ) : (
                'Khách hàng Zalo'
              )}
            </div>
          </div>
          <div className="chat-actions">
            {!conv?.assigned_to ? (
              <button className="btn primary sm" onClick={() => patch({ assigned_to: user.id })}>
                <Hand size={16} /> Nhận hội thoại
              </button>
            ) : (
              <select
                className="select sm"
                value={conv.assigned_to ?? ''}
                disabled={!canReassign}
                onChange={(e) => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })}
                aria-label="Người phụ trách"
                title={canReassign ? 'Chuyển người phụ trách' : 'Chỉ người phụ trách hoặc quản trị viên mới chuyển được'}
              >
                <option value="">— Bỏ nhận —</option>
                {users
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === user.id ? `${u.display_name} (bạn)` : u.display_name}
                    </option>
                  ))}
              </select>
            )}
            <select
              className="select sm"
              value={conv?.status ?? 'open'}
              onChange={(e) => patch({ status: e.target.value as ConvStatus })}
              aria-label="Trạng thái"
            >
              <option value="open">Đang xử lý</option>
              <option value="pending">Chờ phản hồi</option>
              <option value="closed">Đã xong</option>
            </select>
            {conv?.status !== 'closed' && (
              <button className="btn outline sm" onClick={() => patch({ status: 'closed' })} title="Đánh dấu đã xong">
                <Check size={16} /> Xong
              </button>
            )}
            <button className={`icon-btn ${showInfo ? 'on' : ''}`} onClick={toggleInfo} aria-label="Thông tin khách hàng">
              <PanelRight size={18} />
            </button>
          </div>
        </header>

        <div
          className="messages"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
        >
          {hasOlder && (
            <button className="btn ghost sm load-older" onClick={loadOlder}>
              Tải tin cũ hơn
            </button>
          )}
          {loading && <div className="muted pad center">Đang tải tin nhắn…</div>}
          {!loading && !messages.length && <div className="muted pad center">Chưa có tin nhắn được lưu.</div>}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()
            const grouped =
              prev &&
              !newDay &&
              prev.direction === m.direction &&
              prev.agent_id === m.agent_id &&
              prev.sender_uid === m.sender_uid &&
              m.ts - prev.ts < 5 * 60 * 1000
            return (
              <Fragment key={m.id}>
                {newDay && <div className="day-sep">{dayLabel(m.ts)}</div>}
                <Bubble m={m} grouped={!!grouped} isGroup={conv?.type === 1} />
              </Fragment>
            )
          })}
        </div>

        {typingOthers.length > 0 && (
          <div className="typing-bar">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            {typingOthers.map((t) => t.name).join(', ')} đang soạn tin cho khách này
          </div>
        )}
        {assignedToOther && (
          <div className="assign-warn">
            Hội thoại do <b>{conv?.assigned_name}</b> phụ trách. Tin bạn gửi vẫn được ghi nhận dưới tên bạn.
          </div>
        )}
        <Composer convId={convId} />
      </section>
      {showInfo && conv && <InfoPanel conv={conv} onPatch={patch} onClose={toggleInfo} />}
    </>
  )
}

function Bubble({ m, grouped, isGroup }: { m: Message; grouped: boolean; isGroup: boolean }) {
  const out = m.direction === 'out'
  const raw = m.raw ?? {}
  const label = senderLabel(m)
  const isImage = m.msg_type === 'chat.photo' && (raw.href || raw.thumb)
  const isSticker = m.msg_type === 'chat.sticker'
  const isFile = m.msg_type === 'share.file'
  const isLink = (m.msg_type === 'chat.recommended' || m.msg_type === 'chat.link') && raw.href

  let body: React.ReactNode = <span className="msg-text">{m.text}</span>
  if (isImage) {
    body = (
      <a href={raw.href || raw.thumb} target="_blank" rel="noreferrer" className="msg-image">
        <img src={raw.thumb || raw.href} alt={raw.title || 'Hình ảnh'} referrerPolicy="no-referrer" loading="lazy" />
      </a>
    )
  } else if (isSticker) {
    body = <span className="msg-text muted">[Sticker]</span>
  } else if (isFile) {
    body = (
      <a href={raw.href} target="_blank" rel="noreferrer" className="msg-file">
        <FileText size={18} /> {raw.title || 'Tệp đính kèm'}
      </a>
    )
  } else if (isLink) {
    body = (
      <a href={raw.href} target="_blank" rel="noreferrer" className="msg-link">
        {raw.thumb && <img src={raw.thumb} alt="" referrerPolicy="no-referrer" />}
        <span>
          <b>{raw.title || raw.href}</b>
          {raw.description && <small>{raw.description}</small>}
        </span>
      </a>
    )
  }

  return (
    <div className={`msg-row ${out ? 'out' : 'in'} ${grouped ? 'grouped' : ''}`}>
      {!grouped && (out ? label : isGroup ? m.sender_name : null) && (
        <div className={`msg-sender ${out && !m.agent_id ? 'muted' : ''}`}>{out ? label : m.sender_name}</div>
      )}
      <div className={`bubble ${m.undone ? 'undone' : ''} ${isImage ? 'media' : ''}`} title={fullTime(m.ts)}>
        {m.undone ? (
          <span className="msg-text muted">
            <Undo2 size={14} className="inline-icon" /> Tin nhắn đã thu hồi
            {m.text ? ` — "${m.text}"` : ''}
          </span>
        ) : (
          body
        )}
        <span className="msg-time">{new Date(m.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  )
}

function Composer({ convId }: { convId: string }) {
  const { socket, zalo } = useApp()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [pickerIndex, setPickerIndex] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const typingTimer = useRef<number | undefined>(undefined)
  const typingOn = useRef(false)

  useEffect(() => {
    api<Template[]>('/templates').then(setTemplates).catch(() => {})
  }, [])

  // Lưu nháp riêng từng hội thoại.
  const draftKey = `zcskh.draft.${convId}`
  useEffect(() => {
    try {
      setText(localStorage.getItem(draftKey) ?? '')
    } catch {
      /* ignore */
    }
  }, [draftKey])
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text)
      else localStorage.removeItem(draftKey)
    } catch {
      /* ignore */
    }
  }, [text, draftKey])

  useEffect(
    () => () => {
      window.clearTimeout(typingTimer.current)
      if (typingOn.current) socket?.emit('typing', false)
    },
    [socket],
  )

  function signalTyping() {
    if (!typingOn.current) {
      typingOn.current = true
      socket?.emit('typing', true)
    }
    window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => {
      typingOn.current = false
      socket?.emit('typing', false)
    }, 3000)
  }

  const slash = text.startsWith('/') && !text.includes('\n') ? text.slice(1).toLowerCase() : null
  const suggestions = useMemo(
    () =>
      slash === null
        ? []
        : templates
            .filter((t) => t.shortcut.toLowerCase().includes(slash) || t.content.toLowerCase().includes(slash))
            .slice(0, 6),
    [slash, templates],
  )

  function applyTemplate(t: Template) {
    setText(t.content)
    setPickerIndex(0)
    textarea.current?.focus()
  }

  async function send() {
    if (sending || (!text.trim() && !files.length)) return
    setSending(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('text', text)
      files.forEach((f) => fd.append('files', f))
      await api(`/conversations/${encodeURIComponent(convId)}/messages`, { body: fd })
      setText('')
      setFiles([])
      typingOn.current = false
      socket?.emit('typing', false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
      textarea.current?.focus()
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPickerIndex((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPickerIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyTemplate(suggestions[Math.min(pickerIndex, suggestions.length - 1)])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const disabled = zalo.state !== 'connected'

  return (
    <div className="composer">
      {suggestions.length > 0 && (
        <div className="template-picker">
          {suggestions.map((t, i) => (
            <button
              key={t.id}
              className={i === pickerIndex ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                applyTemplate(t)
              }}
            >
              <b>/{t.shortcut}</b> <span>{t.content}</span>
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="file-chips">
          {files.map((f, i) => (
            <span key={i} className="chip">
              <Paperclip size={12} /> {f.name}
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Bỏ ${f.name}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="composer-row">
        <button className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Đính kèm ảnh/tệp" disabled={disabled}>
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10))
            e.target.value = ''
          }}
        />
        <textarea
          ref={textarea}
          rows={1}
          value={text}
          placeholder={disabled ? 'Zalo chưa kết nối' : 'Nhập tin nhắn… (gõ / để chọn mẫu câu, Shift+Enter xuống dòng)'}
          onChange={(e) => {
            setText(e.target.value)
            setPickerIndex(0)
            signalTyping()
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length) {
              e.preventDefault()
              setFiles([...files, ...pasted].slice(0, 10))
            }
          }}
          disabled={disabled}
        />
        <button className="btn primary send-btn" onClick={send} disabled={disabled || sending || (!text.trim() && !files.length)}>
          <Send size={18} />
          <span className="send-label">{sending ? 'Đang gửi' : 'Gửi'}</span>
        </button>
      </div>
    </div>
  )
}

function InfoPanel({
  conv,
  onPatch,
  onClose,
}: {
  conv: Conversation
  onPatch: (b: Partial<Conversation>) => Promise<void>
  onClose: () => void
}) {
  const { user } = useApp()
  const [notes, setNotes] = useState<Note[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [note, setNote] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [ref, setRef] = useState(conv.external_ref ?? '')
  const [score, setScore] = useState(0)
  const [comment, setComment] = useState('')

  const enc = encodeURIComponent(conv.id)
  useEffect(() => {
    api<Note[]>(`/conversations/${enc}/notes`).then(setNotes)
    api<Review[]>(`/conversations/${enc}/reviews`).then(setReviews)
    setRef(conv.external_ref ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id])

  async function addNote() {
    if (!note.trim()) return
    const n = await api<Note>(`/conversations/${enc}/notes`, { body: { content: note } })
    setNotes([n, ...notes])
    setNote('')
  }

  async function addReview() {
    if (!score) return
    await api(`/conversations/${enc}/reviews`, { body: { score, comment } })
    setReviews(await api<Review[]>(`/conversations/${enc}/reviews`))
    setScore(0)
    setComment('')
  }

  function addTag() {
    const t = tagInput.trim()
    if (!t || conv.tags.includes(t)) return setTagInput('')
    void onPatch({ tags: [...conv.tags, t] })
    setTagInput('')
  }

  return (
    <aside className="info-pane">
      <div className="info-head">
        <h3>Thông tin</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Đóng thông tin">
          <X size={18} />
        </button>
      </div>
      <div className="info-profile">
        <Avatar name={conv.name ?? conv.id} src={conv.avatar} size={64} />
        <div className="info-name">{conv.name ?? 'Chưa rõ tên'}</div>
        <code className="muted small">ID Zalo: {conv.id}</code>
      </div>

      <div className="info-section">
        <label className="field">
          <span>Mã khách hàng (CRM / hệ thống khác)</span>
          <div className="row">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="VD: KH000123" />
            {ref !== (conv.external_ref ?? '') && (
              <button className="btn outline sm" onClick={() => onPatch({ external_ref: ref })}>
                Lưu
              </button>
            )}
          </div>
        </label>
      </div>

      <div className="info-section">
        <div className="section-title">
          <Tag size={14} /> Nhãn
        </div>
        <div className="tags">
          {conv.tags.map((t) => (
            <span key={t} className="chip">
              {t}
              <button onClick={() => onPatch({ tags: conv.tags.filter((x) => x !== t) })} aria-label={`Xóa nhãn ${t}`}>
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            value={tagInput}
            placeholder="+ Thêm nhãn"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            onBlur={addTag}
          />
        </div>
      </div>

      <div className="info-section">
        <div className="section-title">
          <StickyNote size={14} /> Ghi chú nội bộ
        </div>
        <textarea
          className="note-input"
          rows={2}
          value={note}
          placeholder="Khách không thấy được ghi chú này"
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn outline sm" onClick={addNote} disabled={!note.trim()}>
          Thêm ghi chú
        </button>
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div>{n.content}</div>
              <small className="muted">
                {n.author ?? 'Hệ thống'} · {fullTime(n.created_at)}
              </small>
            </li>
          ))}
        </ul>
      </div>

      <div className="info-section">
        <div className="section-title">
          <Star size={14} /> Đánh giá chất lượng tư vấn
        </div>
        {reviews.map((r) => (
          <div key={r.id} className="review">
            <Stars value={r.score} />
            <small className="muted">
              {r.reviewer} chấm cho {r.agent ?? '—'}
            </small>
            {r.comment && <div>{r.comment}</div>}
          </div>
        ))}
        {user.role === 'admin' ? (
          <div className="stack sm">
            <Stars value={score} onChange={setScore} />
            <textarea
              className="note-input"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Nhận xét để training: điểm tốt, cần cải thiện…"
            />
            <button className="btn outline sm" onClick={addReview} disabled={!score}>
              Lưu đánh giá cho {conv.assigned_name ?? 'người phụ trách'}
            </button>
          </div>
        ) : (
          !reviews.length && <div className="muted small">Chưa có đánh giá.</div>
        )}
      </div>

      <div className="info-section">
        <div className="section-title">
          <Download size={14} /> Xuất hội thoại này
        </div>
        <div className="row wrap">
          {(['txt', 'csv', 'json'] as const).map((f) => (
            <a key={f} className="btn ghost sm" href={exportUrl({ format: f, conversationId: conv.id })}>
              {f.toUpperCase()}
            </a>
          ))}
        </div>
        {conv.status === 'closed' && (
          <button className="btn ghost sm" onClick={() => onPatch({ status: 'open' })}>
            <RotateCcw size={14} /> Mở lại hội thoại
          </button>
        )}
        <div className="muted small">
          <Zap size={12} className="inline-icon" /> Link mở nhanh từ app khác: <code>/?c={conv.id}</code>
        </div>
      </div>
    </aside>
  )
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className={`stars ${onChange ? 'editable' : ''}`}>
      {[1, 2, 3, 4, 5].map((i) =>
        onChange ? (
          <button key={i} onClick={() => onChange(i)} aria-label={`${i} sao`} className={i <= value ? 'on' : ''}>
            <Star size={18} />
          </button>
        ) : (
          <Star key={i} size={14} className={i <= value ? 'on' : ''} />
        ),
      )}
    </span>
  )
}
