/**
 * Các phần của khung chat giống Zalo PC: bong bóng tin nhắn có menu thao tác khi rê chuột
 * (trả lời, thả cảm xúc, sao chép, chuyển tiếp, thu hồi, tạo ghi chú), hộp chọn sticker, chuyển tiếp.
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import { CheckSquare, Copy, FileText, Forward, Image as ImageIcon, Info, MessageCircle, MoreHorizontal, Play, Quote, Search, SmilePlus, Square, StickyNote, Undo2, X } from 'lucide-react'
import { api, safeUrl } from '../api'
import { useApp } from '../store'
import type { Conversation, Message, Sticker, Capabilities } from '../types'
import { Avatar, Modal } from '../components'
import { fullTime } from '../util'
import { FallbackImg, isVideoMessage, mediaUrls, videoInfo } from './chat-extras'

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
  return m.holder_name ? `Gửi từ điện thoại · ${m.holder_name}` : 'Gửi từ điện thoại'
}

/** Mô tả ngắn một tin (dùng cho khung "Đang trả lời" và chuyển tiếp). */
export function messageSummary(m: Pick<Message, 'msg_type' | 'text'>) {
  if (m.msg_type === 'chat.sticker') return '[Sticker]'
  return m.text || '[Tin nhắn]'
}

const MEDIA_TYPES = ['chat.photo', 'share.file', 'chat.video.msg', 'chat.voice', 'chat.gif']
/** Tin chuyển tiếp được: chữ, link, sticker, ảnh, tệp, video, tin thoại (cùng điều kiện với máy chủ) */
export function canForward(m: Message) {
  if (m.undone) return false
  const t = m.msg_type
  if (!t || t === 'webchat') return !!m.text?.trim()
  if (t === 'chat.sticker') return !!m.raw?.id
  if (t === 'chat.recommended' || t === 'chat.link') return !!(m.raw?.href || m.text)
  return MEDIA_TYPES.includes(t) && !!(m.raw?._local || m.raw?.href || m.raw?.thumb || m.raw?.hdUrl || m.raw?.oriUrl)
}

/** Khung trích dẫn trong tin trả lời: tên người gửi + nội dung tin gốc (ảnh / video hiện ảnh nhỏ), bấm để nhảy tới tin gốc. */
function QuoteBox({ m, onQuote }: { m: Message; onQuote?: (m: Message) => void }) {
  const q = m.quote!
  const ref = m.quote_ref
  const kind = ref?.msg_type && ref.msg_type !== 'webchat' ? KIND_LABEL[ref.msg_type] : undefined
  const isMedia = ref?.msg_type === 'chat.photo' || ref?.msg_type === 'chat.gif' || ref?.msg_type === 'chat.video.msg'
  const text = ref?.undone ? 'Tin nhắn đã thu hồi' : (ref?.text || q.msg || '').trim() || (kind ? `[${kind}]` : '[Tin nhắn]')
  const label = isMedia && /^\[.*\]$/.test(text) ? kind ?? text : text
  const clickable = !!ref && !!onQuote
  return (
    <button
      type="button"
      className={`msg-quote ${clickable ? 'clickable' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        if (clickable) onQuote!(m)
      }}
      title={clickable ? 'Bấm để xem tin gốc' : 'Tin gốc không có trong app (cũ hơn lịch sử đã đồng bộ)'}
    >
      {isMedia && !ref?.undone && (
        <span className="msg-quote-thumb">
          {ref!.thumbs.length > 0 ? <FallbackImg urls={ref!.thumbs} alt="" /> : <ImageIcon size={18} />}
          {ref!.msg_type === 'chat.video.msg' && <Play size={14} className="msg-quote-play" />}
        </span>
      )}
      <span className="msg-quote-body">
        <b>{q.fromD || 'Tin nhắn'}</b>
        <span>{label}</span>
      </span>
    </button>
  )
}

/** Chữ để sao chép: tin chữ lấy nội dung; ảnh / tệp / video / link lấy đường link */
export function copyText(m: Message) {
  if (!m.msg_type || m.msg_type === 'webchat') return m.text ?? ''
  const card = contactCard(m)
  if (card) return [card.name, card.phone].filter(Boolean).join(' - ')
  const href = String(m.raw?.href || m.raw?.thumb || '')
  if (href) return href.startsWith('/') ? window.location.origin + href : href
  return m.text ?? ''
}

const KIND_LABEL: Record<string, string> = {
  'chat.photo': 'Hình ảnh',
  'chat.sticker': 'Sticker',
  'share.file': 'Tệp',
  'chat.video.msg': 'Video',
  'chat.voice': 'Tin nhắn thoại',
  'chat.gif': 'Ảnh GIF',
  'chat.recommended': 'Liên kết',
  'chat.link': 'Liên kết',
  'chat.location.new': 'Vị trí',
}
/** Loại tin cho mục "Xem chi tiết" */
export const messageKind = (m: Message) =>
  !m.msg_type || m.msg_type === 'webchat' ? 'Tin nhắn chữ' : contactCard(m) ? 'Danh thiếp' : KIND_LABEL[m.msg_type] ?? m.msg_type

export type MessageAction = 'reply' | 'copy' | 'forward' | 'undo' | 'note' | 'select' | 'details'

/** Thành viên nhóm (để tô và bấm "@Tên" ở tin cũ chưa lưu vị trí nhắc tên) */
export type MentionMember = { uid: string; name: string }

/** Các đoạn "@Tên" trong chữ: dùng vị trí Zalo gửi kèm, không có thì dò theo tên thành viên nhóm. */
function mentionRanges(m: Message, members?: MentionMember[]): { pos: number; len: number; uid: string }[] {
  const text = m.text ?? ''
  if (m.mentions?.length) return m.mentions.filter((x) => x.pos >= 0 && x.pos + x.len <= text.length).sort((a, b) => a.pos - b.pos)
  if (!members?.length || !text.includes('@')) return []
  const out: { pos: number; len: number; uid: string }[] = []
  for (const mb of [...members].sort((a, b) => b.name.length - a.name.length)) {
    if (!mb.name) continue
    const tag = `@${mb.name}`
    let from = 0
    let i: number
    while ((i = text.indexOf(tag, from)) >= 0) {
      const at = i
      if (!out.some((o) => at < o.pos + o.len && o.pos < at + tag.length)) out.push({ pos: at, len: tag.length, uid: mb.uid })
      from = at + tag.length
    }
  }
  return out.sort((a, b) => a.pos - b.pos)
}

/** Chữ của tin: "@Tên" tô màu riêng, bấm vào để nhắn riêng người đó; link bấm được. */
function MessageText({ m, members, onMention }: { m: Message; members?: MentionMember[]; onMention?: (uid: string, name: string) => void }) {
  const text = m.text ?? ''
  const ranges = mentionRanges(m, members)
  if (!ranges.length) return <span className="msg-text">{linkify(text)}</span>
  const parts: React.ReactNode[] = []
  let at = 0
  ranges.forEach((r, i) => {
    if (r.pos < at) return
    if (r.pos > at) parts.push(<Fragment key={`t${i}`}>{linkify(text.slice(at, r.pos))}</Fragment>)
    const label = text.slice(r.pos, r.pos + r.len)
    const name = label.replace(/^@/, '')
    parts.push(
      r.uid === '-1' || !onMention ? (
        <span key={`m${i}`} className="msg-mention">
          {label}
        </span>
      ) : (
        <button
          key={`m${i}`}
          type="button"
          className="msg-mention"
          title={`Nhắn riêng cho ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onMention(r.uid, name)
          }}
        >
          {label}
        </button>
      ),
    )
    at = r.pos + r.len
  })
  if (at < text.length) parts.push(<Fragment key="end">{linkify(text.slice(at))}</Fragment>)
  return <span className="msg-text">{parts}</span>
}

export function Bubble({
  m,
  grouped,
  isGroup,
  flash,
  canUndo,
  caps,
  canReply = true,
  readOnly = false,
  extraActions,
  onExtra,
  onOpenImage,
  receipt,
  onAction,
  onReact,
  selecting = false,
  selected = false,
  onToggleSelect,
  members,
  onMention,
  onContact,
  onQuote,
}: {
  m: Message
  grouped: boolean
  isGroup: boolean
  flash: boolean
  canUndo: boolean
  /** Tính năng của nền tảng (không truyền = Zalo, đủ tính năng) */
  caps?: Capabilities
  canReply?: boolean
  /** Chỉ xem (trang Giám sát): ẩn mọi thao tác */
  readOnly?: boolean
  /** Thao tác riêng của nền tảng (VD bình luận Facebook: thích, ẩn, xóa) */
  extraActions?: { key: string; label: string; danger?: boolean }[]
  onExtra?: (key: string) => void
  /** Bấm ảnh: mở trình xem ảnh toàn màn hình */
  onOpenImage?: (m: Message) => void
  /** Đã gửi / Đã nhận / Đã xem (chỉ truyền cho tin cuối của shop) */
  receipt?: string | null
  onAction: (action: MessageAction, m: Message) => void
  onReact: (m: Message, code: string) => void
  /** Đang chọn nhiều tin: hiện ô chọn, bấm vào tin để chọn / bỏ chọn */
  selecting?: boolean
  selected?: boolean
  onToggleSelect?: (m: Message) => void
  /** Thành viên nhóm (tô "@Tên" ở tin cũ) và bấm "@Tên" để nhắn riêng */
  members?: MentionMember[]
  onMention?: (uid: string, name: string) => void
  /** Bấm "Nhắn tin" trên danh thiếp Zalo */
  onContact?: (card: ContactCardInfo) => void
  /** Bấm khung trích dẫn: nhảy tới tin gốc */
  onQuote?: (m: Message) => void
}) {
  const out = m.direction === 'out'
  const raw = m.raw ?? {}
  const label = senderLabel(m)
  const isImage = m.msg_type === 'chat.photo' && mediaUrls(raw, 'small').length > 0
  const isVideo = isVideoMessage(m)
  const isSticker = m.msg_type === 'chat.sticker' && raw.id
  const isFile = m.msg_type === 'share.file'
  const card = contactCard(m)
  const isLink = (m.msg_type === 'chat.recommended' || m.msg_type === 'chat.link') && raw.href
  const actionable = !readOnly && !selecting && !m.undone && !!m.zalo_msg_id
  const [menu, setMenuState] = useState<'react' | 'more' | null>(null)
  // Menu mở lên trên tin; tin nằm sát đầu khung chat thì mở xuống dưới cho khỏi bị che
  const [menuDown, setMenuDown] = useState(false)
  const setMenu = (v: 'react' | 'more' | null) => {
    if (v) {
      const row = rowRef.current?.getBoundingClientRect()
      const box = rowRef.current?.closest('.messages')?.getBoundingClientRect()
      setMenuDown(!!row && !!box && row.top - box.top < (v === 'more' ? 300 : 70))
    }
    setMenuState(v)
  }
  // Điện thoại / máy tính bảng: nhấn giữ tin nhắn để hiện thao tác (như Zalo)
  const [touchOpen, setTouchOpen] = useState(false)
  const pressTimer = useRef<number | undefined>(undefined)
  const rowRef = useRef<HTMLDivElement>(null)

  // Đóng menu khi bấm ra ngoài
  useEffect(() => {
    if (!menu && !touchOpen) return
    const close = (e: Event) => {
      if (!rowRef.current?.contains(e.target as Node)) {
        setMenu(null)
        setTouchOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [menu, touchOpen])

  const longPress = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch' || !actionable) return
      window.clearTimeout(pressTimer.current)
      pressTimer.current = window.setTimeout(() => {
        setTouchOpen(true)
        navigator.vibrate?.(15)
      }, 450)
    },
    onPointerUp: () => window.clearTimeout(pressTimer.current),
    onPointerMove: () => window.clearTimeout(pressTimer.current),
    onPointerCancel: () => window.clearTimeout(pressTimer.current),
    onContextMenu: (e: React.MouseEvent) => {
      if (!actionable) return
      // Android: nhấn giữ sinh contextmenu → mở thao tác thay cho menu của trình duyệt
      if (window.matchMedia('(hover: none)').matches) {
        e.preventDefault()
        setTouchOpen(true)
        return
      }
      // Máy tính: chuột phải vào tin mở menu thao tác như Zalo PC (đang bôi đen chữ thì để menu trình duyệt sao chép đoạn đó)
      if (window.getSelection()?.toString()) return
      e.preventDefault()
      setMenu('more')
    },
  }

  let body: React.ReactNode = <MessageText m={m} members={isGroup ? members : undefined} onMention={readOnly || selecting ? undefined : onMention} />
  if (isImage) {
    body = (
      <a
        href={safeUrl(mediaUrls(raw, 'full')[0])}
        target="_blank"
        rel="noreferrer"
        className="msg-image"
        onClick={(e) => {
          if (!onOpenImage) return
          e.preventDefault()
          onOpenImage(m)
        }}
      >
        <FallbackImg urls={mediaUrls(raw, 'small')} alt={raw.title || 'Hình ảnh'} />
      </a>
    )
    // Ảnh gửi kèm chữ: Zalo để chữ trong "title" (ảnh shop gửi từ app thì title là tên tệp → không hiện)
    const caption = photoCaption(raw)
    if (caption) {
      body = (
        <>
          {body}
          <span className="msg-text msg-caption">{linkify(caption)}</span>
        </>
      )
    }
  } else if (isVideo) {
    // Như Zalo: ảnh bìa + nút phát + thời lượng; bấm mở trình xem toàn màn hình (phát luôn)
    const info = videoInfo(raw)
    const poster = mediaUrls(raw, 'small').filter((u) => u !== info.src)
    body = (
      <a
        href={safeUrl(info.src)}
        target="_blank"
        rel="noreferrer"
        className="msg-video"
        onClick={(e) => {
          if (!onOpenImage) return
          e.preventDefault()
          onOpenImage(m)
        }}
        aria-label={`Xem video${info.duration ? ` (${info.duration})` : ''}`}
      >
        {poster.length ? <FallbackImg urls={poster} alt="Video" /> : <span className="msg-video-blank" />}
        <span className="msg-video-play" aria-hidden>
          <Play size={22} fill="currentColor" />
        </span>
        {info.duration && <span className="msg-video-time">{info.duration}</span>}
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
      <a href={safeUrl(raw._local || raw.href)} download={raw._local ? String(raw.title || '') || true : undefined} target="_blank" rel="noreferrer" className="msg-file">
        <FileText size={18} /> {raw.title || 'Tệp đính kèm'}
      </a>
    )
  } else if (card) {
    body = (
      <span className="msg-contact">
        <Avatar name={card.name} src={card.avatar} size={44} />
        <span className="msg-contact-main">
          <small className="muted">Danh thiếp Zalo</small>
          <b>{card.name}</b>
          {card.phone && <span className="msg-contact-phone">{card.phone}</span>}
        </span>
        {onContact && !readOnly && (card.uid || card.phone) && (
          <button
            type="button"
            className="btn outline sm"
            onClick={(e) => {
              e.stopPropagation()
              onContact(card)
            }}
          >
            <MessageCircle size={14} /> Nhắn tin
          </button>
        )}
      </span>
    )
  } else if (isLink) {
    body = (
      <a href={safeUrl(raw.href)} target="_blank" rel="noreferrer" className="msg-link">
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
    setTouchOpen(false)
    onAction(a, m)
  }

  return (
    <div
      ref={rowRef}
      className={`msg-row ${out ? 'out' : 'in'} ${grouped ? 'grouped' : ''} ${flash ? 'flash' : ''} ${menu || touchOpen ? 'menu-open' : ''} ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      data-mid={m.id}
      {...longPress}
      onClickCapture={
        selecting
          ? (e) => {
              // Đang chọn nhiều tin: bấm vào tin = chọn / bỏ chọn (không mở ảnh, link)
              e.preventDefault()
              e.stopPropagation()
              if (!m.undone) onToggleSelect?.(m)
            }
          : undefined
      }
    >
      {selecting && (
        <span className={`msg-check ${m.undone ? 'off' : ''}`} aria-hidden>
          {selected ? <CheckSquare size={18} /> : <Square size={18} />}
        </span>
      )}
      {!grouped && (out ? label : isGroup ? m.sender_name : null) && (
        <div className={`msg-sender ${out && !m.agent_id ? 'muted' : ''}`}>{out ? label : m.sender_name}</div>
      )}
      <div className="msg-line">
        <div
          className={`bubble ${m.undone ? 'undone' : ''} ${isImage || isVideo ? 'media' : ''} ${isSticker && !m.undone ? 'sticker' : ''}`}
          title={fullTime(m.ts)}
        >
          {m.quote && !m.undone && <QuoteBox m={m} onQuote={onQuote} />}
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
          <div className={`msg-actions ${menuDown ? 'pop-down' : ''}`}>
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
                  {!!copyText(m) && (
                    <button onClick={() => act('copy')}>
                      <Copy size={14} /> {!m.msg_type || m.msg_type === 'webchat' || card ? 'Sao chép' : 'Sao chép link'}
                    </button>
                  )}
                  {(caps?.forward ?? true) && canForward(m) && (
                    <button onClick={() => act('forward')}>
                      <Forward size={14} /> Chuyển tiếp
                    </button>
                  )}
                  <button onClick={() => act('select')}>
                    <CheckSquare size={14} /> Chọn nhiều tin nhắn
                  </button>
                  <button onClick={() => act('details')}>
                    <Info size={14} /> Xem chi tiết
                  </button>
                  {extraActions?.map((x) => (
                    <button
                      key={x.key}
                      className={x.danger ? 'danger' : ''}
                      onClick={() => {
                        setMenu(null)
                        onExtra?.(x.key)
                      }}
                    >
                      {x.label}
                    </button>
                  ))}
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
      {receipt && <div className="msg-receipt">{receipt}</div>}
    </div>
  )
}

export type ContactCardInfo = { name: string; avatar: string | null; phone: string | null; uid: string | null }

const parseJson = (v: unknown): Record<string, any> => {
  if (v && typeof v === 'object') return v as Record<string, any>
  try {
    const o = typeof v === 'string' && v.trim().startsWith('{') ? JSON.parse(v) : null
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

/** Danh thiếp Zalo (khách gửi thông tin liên hệ của một người): tên, ảnh, SĐT, id Zalo nếu có */
export function contactCard(m: Pick<Message, 'msg_type' | 'raw'>): ContactCardInfo | null {
  const raw = m.raw ?? {}
  if (m.msg_type !== 'chat.recommended') return null
  const desc = parseJson(raw.description)
  const params = parseJson(raw.params)
  if (raw.action !== 'recommened.user' && !desc.gUid && !desc.phone && !params.contactUid) return null
  const uid = [params.uid, params.contactUid, desc.uid, desc.contactUid, raw.uid].map((x) => String(x ?? '')).find((x) => /^\d{5,25}$/.test(x)) ?? null
  const phone = String(desc.phone || params.phone || '').trim() || null
  return { name: String(raw.title || desc.caption || 'Danh thiếp'), avatar: raw.thumb ? String(raw.thumb) : null, phone, uid }
}

/** Chữ gửi kèm ảnh (bỏ tên tệp ảnh và dữ liệu kỹ thuật) */
export function photoCaption(raw: Record<string, any>) {
  for (const v of [raw.title, raw.description]) {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s && !/^[{[]/.test(s) && !/^[^\s/\\]+\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(s)) return s
  }
  return ''
}

/** Biến đường link trong chữ thành link bấm được (chỉ http/https, như Zalo). */
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="msg-autolink" onClick={(e) => e.stopPropagation()}>
        {p}
      </a>
    ) : (
      p
    ),
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

export function ForwardModal({ messages, from, onClose }: { messages: Message[]; from: Conversation; onClose: () => void }) {
  const [list, setList] = useState<Conversation[]>([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ conversation_id?: string; ok: boolean; sent?: number; error?: string }[] | null>(null)
  const hasMedia = messages.some((m) => m.msg_type && m.msg_type !== 'webchat' && m.msg_type !== 'chat.sticker' && m.msg_type !== 'chat.recommended' && m.msg_type !== 'chat.link')
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
        await api(`/conversations/${encodeURIComponent(from.id)}/forward`, {
          body: { message_ids: messages.map((m) => m.id), conversation_ids: picked },
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
    <Modal title={messages.length > 1 ? `Chuyển tiếp ${messages.length} tin nhắn` : 'Chuyển tiếp tin nhắn'} onClose={onClose}>
      <div className="stack">
        <div className="forward-preview">
          {messages.slice(0, 5).map((m) => (
            <div key={m.id}>{messageSummary(m)}</div>
          ))}
          {messages.length > 5 && <div className="muted small">… và {messages.length - 5} tin khác</div>}
        </div>
        {busy && hasMedia && <div className="muted small">Đang tải ảnh / tệp gốc và gửi lại, có thể mất vài giây…</div>}
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

// ───────────── Xem chi tiết tin nhắn ─────────────

const SOURCE_LABEL: Record<Message['source'], string> = {
  web: 'Gửi từ app Chat Siêu Tốc',
  api: 'Gửi qua API',
  phone: 'Gửi từ điện thoại / Zalo PC',
  history: 'Đồng bộ tin cũ',
  customer: 'Khách gửi',
}

export function MessageDetails({ m, conv, onClose }: { m: Message; conv: Conversation | null; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Người gửi', m.direction === 'out' ? senderLabel(m) ?? 'Shop' : m.sender_name ?? conv?.name ?? 'Khách'],
    ['Thời gian', fullTime(m.ts)],
    ['Loại tin', messageKind(m)],
    ['Nguồn', SOURCE_LABEL[m.source] ?? m.source],
  ]
  if (m.raw?.title && m.msg_type === 'share.file') rows.push(['Tên tệp', String(m.raw.title)])
  if (m.quote) rows.push(['Trả lời tin', `${m.quote.fromD || 'Tin nhắn'}: ${m.quote.msg || '[Tin nhắn]'}`])
  if (m.reactions?.length) rows.push(['Cảm xúc', m.reactions.map((r) => `${reactionEmoji(r.icon)} ${r.names.join(', ')}`).join(' · ')])
  if (m.undone) rows.push(['Trạng thái', m.undone_at ? `Đã thu hồi lúc ${fullTime(m.undone_at)}` : 'Đã thu hồi'])
  if (m.zalo_msg_id) rows.push(['Mã tin Zalo', m.zalo_msg_id])
  return (
    <Modal title="Chi tiết tin nhắn" onClose={onClose}>
      <div className="stack">
        {!!m.text && <div className="forward-preview pre-wrap">{m.text}</div>}
        <dl className="msg-details">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="row end">
          <button className="btn primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </Modal>
  )
}
