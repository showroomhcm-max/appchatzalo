/**
 * Các phần của khung chat giống Zalo PC: bong bóng tin nhắn có menu thao tác khi rê chuột
 * (trả lời, thả cảm xúc, sao chép, chuyển tiếp, thu hồi, tạo ghi chú), hộp chọn sticker, chuyển tiếp.
 */
import { useEffect, useRef, useState } from 'react'
import { Copy, FileText, Forward, MoreHorizontal, Quote, Search, SmilePlus, StickyNote, Undo2, X } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { Conversation, Message, Sticker, Capabilities } from '../types'
import { Avatar, Modal } from '../components'
import { fullTime } from '../util'

/** 6 cảm xúc nhanh như Zalo PC (mã icon theo Zalo → hình hiển thị). */
export const REACTIONS: { code: string; emoji: string; label: string }[] = [
  { code: '/-strong', emoji: '👍', label: 'Thích' },
  { code: '/-heart', emoji: '❤️', label: 'Yêu thích' },
  { code: ':>', emoji: '😆', label: 'Haha' },
  { code: ':o', emoji: '😮', label: 'Ngạc nhiên' },
  { code: ':-((', emoji: '😭', label: 'Buồn' },
  { code: ':-h', emoji: '😡', label: 'Giận' },
]
const EXTRA_REACTIONS: Record<string, string> = {
  '/-ok': '👌',
  '/-thanks': '🙏',
  '_()_': '🙏',
  '/-rose': '🌹',
  '/-weak': '👎',
  '/-break': '💔',
  ':))': '😂',
  ";xx": '😍',
}
export const reactionEmoji = (code: string) => REACTIONS.find((r) => r.code === code)?.emoji ?? EXTRA_REACTIONS[code] ?? code

export function stickerImageUrl(id: number | string) {
  return `/api/sticker-image/${id}`
}

export function senderLabel(m: Message) {
  if (m.direction === 'in') return null
  if (m.agent_name) return m.agent_name
  if (m.source === 'api') return 'Hệ thống (API)'
  if (m.source === 'history') return 'Shop'
  return 'Gửi từ điện thoại'
}

/** Mô tả ngắn một tin (dùng cho khung "Đang trả lời" và chuyển tiếp). */
export function messageSummary(m: Pick<Message, 'msg_type' | 'text'>) {
  if (m.msg_type === 'chat.sticker') return '[Sticker]'
  return m.text || '[Tin nhắn]'
}

export type MessageAction = 'reply' | 'copy' | 'forward' | 'undo' | 'note'

export function Bubble({
  m,
  grouped,
  isGroup,
  flash,
  canUndo,
  caps,
  canReply = true,
  onAction,
  onReact,
}: {
  m: Message
  grouped: boolean
  isGroup: boolean
  flash: boolean
  canUndo: boolean
  /** Tính năng của nền tảng (không truyền = Zalo, đủ tính năng) */
  caps?: Capabilities
  canReply?: boolean
  onAction: (action: MessageAction, m: Message) => void
  onReact: (m: Message, code: string) => void
}) {
  const out = m.direction === 'out'
  const raw = m.raw ?? {}
  const label = senderLabel(m)
  const isImage = m.msg_type === 'chat.photo' && (raw.href || raw.thumb)
  const isSticker = m.msg_type === 'chat.sticker' && raw.id
  const isFile = m.msg_type === 'share.file'
  const isLink = (m.msg_type === 'chat.recommended' || m.msg_type === 'chat.link') && raw.href
  const actionable = !m.undone && !!m.zalo_msg_id
  const [menu, setMenu] = useState<'react' | 'more' | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  // Đóng menu khi bấm ra ngoài
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  let body: React.ReactNode = <span className="msg-text">{m.text}</span>
  if (isImage) {
    body = (
      <a href={raw.href || raw.thumb} target="_blank" rel="noreferrer" className="msg-image">
        <img src={raw.thumb || raw.href} alt={raw.title || 'Hình ảnh'} referrerPolicy="no-referrer" loading="lazy" />
      </a>
    )
  } else if (isSticker) {
    body = (
      <img
        className="msg-sticker"
        src={stickerImageUrl(raw.id)}
        alt="[Sticker]"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => {
          // Chưa có kênh nào kết nối để tra ảnh sticker → hiện chữ thay cho ảnh vỡ.
          const span = document.createElement('span')
          span.className = 'msg-text muted'
          span.textContent = '[Sticker]'
          e.currentTarget.replaceWith(span)
        }}
      />
    )
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

  const act = (a: MessageAction) => {
    setMenu(null)
    onAction(a, m)
  }

  return (
    <div
      ref={rowRef}
      className={`msg-row ${out ? 'out' : 'in'} ${grouped ? 'grouped' : ''} ${flash ? 'flash' : ''} ${menu ? 'menu-open' : ''}`}
      data-mid={m.id}
    >
      {!grouped && (out ? label : isGroup ? m.sender_name : null) && (
        <div className={`msg-sender ${out && !m.agent_id ? 'muted' : ''}`}>{out ? label : m.sender_name}</div>
      )}
      <div className="msg-line">
        <div
          className={`bubble ${m.undone ? 'undone' : ''} ${isImage ? 'media' : ''} ${isSticker && !m.undone ? 'sticker' : ''}`}
          title={fullTime(m.ts)}
        >
          {m.quote && !m.undone && (
            <div className="msg-quote">
              <b>{m.quote.fromD || 'Tin nhắn'}</b>
              <span>{m.quote.msg || '[Tin nhắn]'}</span>
            </div>
          )}
          {m.undone ? (
            <span className="msg-text muted">
              <Undo2 size={14} className="inline-icon" /> Tin nhắn đã thu hồi
              {m.text ? ` — "${m.text}"` : ''}
            </span>
          ) : (
            body
          )}
          <span className="msg-time">{new Date(m.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
          {!!m.reactions?.length && (
            <span className="msg-reactions" title={m.reactions.map((r) => `${reactionEmoji(r.icon)} ${r.names.join(', ')}`).join('\n')}>
              {m.reactions.map((r) => (
                <span key={r.icon} className={r.mine ? 'mine' : ''}>
                  {reactionEmoji(r.icon)}
                  {r.count > 1 && <small>{r.count}</small>}
                </span>
              ))}
            </span>
          )}
        </div>

        {actionable && (
          <div className="msg-actions">
            {canReply && (
              <button className="icon-btn sm" onClick={() => act('reply')} title="Trả lời" aria-label="Trả lời">
                <Quote size={15} />
              </button>
            )}
            {(caps?.reactions ?? true) && (
            <div className="msg-pop-wrap">
              <button
                className="icon-btn sm"
                onClick={() => setMenu(menu === 'react' ? null : 'react')}
                title="Thả cảm xúc"
                aria-label="Thả cảm xúc"
              >
                <SmilePlus size={15} />
              </button>
              {menu === 'react' && (
                <div className="reaction-pop" role="menu">
                  {REACTIONS.map((r) => (
                    <button
                      key={r.code}
                      title={r.label}
                      aria-label={r.label}
                      onClick={() => {
                        setMenu(null)
                        onReact(m, r.code)
                      }}
                    >
                      {r.emoji}
                    </button>
                  ))}
                  {m.reactions?.some((r) => r.mine) && (
                    <button
                      className="reaction-clear"
                      title="Gỡ cảm xúc của shop"
                      onClick={() => {
                        setMenu(null)
                        onReact(m, '')
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
            )}
            <div className="msg-pop-wrap">
              <button
                className="icon-btn sm"
                onClick={() => setMenu(menu === 'more' ? null : 'more')}
                title="Thêm"
                aria-label="Thêm thao tác"
              >
                <MoreHorizontal size={15} />
              </button>
              {menu === 'more' && (
                <div className="more-pop" role="menu">
                  {m.text && (
                    <button onClick={() => act('copy')}>
                      <Copy size={14} /> Sao chép
                    </button>
                  )}
                  {(caps?.forward ?? true) && (!m.msg_type || m.msg_type === 'webchat') && m.text && (
                    <button onClick={() => act('forward')}>
                      <Forward size={14} /> Chuyển tiếp
                    </button>
                  )}
                  <button onClick={() => act('note')}>
                    <StickyNote size={14} /> Tạo ghi chú từ tin này
                  </button>
                  {out && canUndo && (caps?.undo ?? true) && (
                    <button className="danger" onClick={() => act('undo')}>
                      <Undo2 size={14} /> Thu hồi
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────── Hộp chọn sticker ─────────────

const RECENT_KEY = 'zcskh.recentStickers'
const QUICK_KEYWORDS = ['chào', 'cảm ơn', 'ok', 'xin lỗi', 'yêu', 'haha', 'buồn', 'chúc mừng', 'đợi', 'tạm biệt']

function loadRecent(): Sticker[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function StickerPicker({
  channelId,
  onPick,
  onClose,
}: {
  channelId: number | null
  onPick: (s: Sticker) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [keyword, setKeyword] = useState(QUICK_KEYWORDS[0])
  const [list, setList] = useState<Sticker[] | null>(null)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState<Sticker[]>(loadRecent)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  useEffect(() => {
    let alive = true
    setList(null)
    setError('')
    const t = setTimeout(() => {
      api<Sticker[]>(`/stickers/search?q=${encodeURIComponent(keyword)}${channelId ? `&channelId=${channelId}` : ''}`)
        .then((r) => alive && setList(r))
        .catch((e) => alive && setError(e.message))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [keyword, channelId])

  function pick(s: Sticker) {
    const next = [s, ...recent.filter((r) => r.id !== s.id)].slice(0, 16)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    onPick(s)
  }

  return (
    <div className="sticker-picker" ref={box} role="dialog" aria-label="Chọn sticker">
      <div className="search">
        <Search size={14} />
        <input
          autoFocus
          value={q}
          placeholder="Tìm sticker: chào, cảm ơn, ok…"
          onChange={(e) => {
            setQ(e.target.value)
            if (e.target.value.trim()) setKeyword(e.target.value.trim())
          }}
        />
      </div>
      <div className="sticker-keywords">
        {QUICK_KEYWORDS.map((k) => (
          <button
            key={k}
            className={keyword === k ? 'on' : ''}
            onClick={() => {
              setQ('')
              setKeyword(k)
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="sticker-scroll">
        {recent.length > 0 && !q && (
          <>
            <div className="muted small">Dùng gần đây</div>
            <div className="sticker-grid">
              {recent.map((s) => (
                <button key={`r${s.id}`} onClick={() => pick(s)} title={s.text}>
                  <img src={s.url ?? stickerImageUrl(s.id)} alt={s.text || 'Sticker'} loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
            <div className="muted small">Kết quả cho "{keyword}"</div>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        {list === null && !error && <div className="muted small pad">Đang tải sticker…</div>}
        {list?.length === 0 && <div className="muted small pad">Không có sticker cho "{keyword}".</div>}
        <div className="sticker-grid">
          {list?.map((s) => (
            <button key={s.id} onClick={() => pick(s)} title={s.text}>
              <img src={s.url ?? stickerImageUrl(s.id)} alt={s.text || 'Sticker'} loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ───────────── Chuyển tiếp ─────────────

export function ForwardModal({ message, from, onClose }: { message: Message; from: Conversation; onClose: () => void }) {
  const [list, setList] = useState<Conversation[]>([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ conversation_id?: string; ok: boolean; error?: string }[] | null>(null)
  const [error, setError] = useState('')
  const { channels } = useApp()

  useEffect(() => {
    api<Conversation[]>(`/conversations?scope=all&channelId=${from.channel_id}&limit=200`).then((rows) =>
      setList(rows.filter((c) => c.id !== from.id)),
    )
  }, [from.id, from.channel_id])

  const shown = list.filter((c) => !q.trim() || (c.name ?? '').toLowerCase().includes(q.trim().toLowerCase()))

  async function send() {
    setBusy(true)
    setError('')
    try {
      setResult(
        await api(`/conversations/${encodeURIComponent(from.id)}/messages/${message.id}/forward`, {
          body: { conversation_ids: picked },
        }),
      )
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const channelName = channels.find((c) => c.id === from.channel_id)?.name

  return (
    <Modal title="Chuyển tiếp tin nhắn" onClose={onClose}>
      <div className="stack">
        <div className="forward-preview">{messageSummary(message)}</div>
        {result ? (
          <>
            <div>
              Đã gửi {result.filter((r) => r.ok).length}/{result.length} hội thoại.
            </div>
            {result
              .filter((r) => !r.ok)
              .map((r, i) => (
                <div key={i} className="form-error">
                  {list.find((c) => c.id === r.conversation_id)?.name ?? r.conversation_id}: {r.error}
                </div>
              ))}
            <div className="row end">
              <button className="btn primary" onClick={onClose}>
                Xong
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="muted small">Chỉ chuyển tiếp được trong cùng kênh {channelName ? `"${channelName}"` : ''}.</div>
            <div className="search">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm hội thoại…" autoFocus />
            </div>
            <div className="forward-list">
              {shown.map((c) => (
                <label key={c.id} className="forward-item">
                  <input
                    type="checkbox"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                  />
                  <Avatar name={c.name ?? c.thread_id} src={c.avatar} size={32} />
                  <span className="grow">{c.name ?? c.thread_id}</span>
                </label>
              ))}
              {!shown.length && <div className="muted small pad">Không có hội thoại.</div>}
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="row end">
              <button className="btn ghost" onClick={onClose}>
                Hủy
              </button>
              <button className="btn primary" disabled={!picked.length || busy} onClick={send}>
                <Forward size={16} /> {busy ? 'Đang gửi…' : `Gửi (${picked.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
