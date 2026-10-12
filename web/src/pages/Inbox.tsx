import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ShoppingBag,
  ExternalLink,
  Globe,
  Lock,
  Check,
  Download,
  Eye,
  Hand,
  Inbox as InboxIcon,
  MessageSquareDashed,
  Paperclip,
  PanelRight,
  RotateCcw,
  Quote,
  Search,
  Send,
  Smile,
  Star,
  StickyNote,
  Tag,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import { api, exportUrl } from '../api'
import { useApp, useSocketEvent } from '../store'
import type { Alert, Conversation, ConvStatus, Message, Note, Order, Review, Sticker, Template } from '../types'
import { Avatar, Badge, Empty } from '../components'
import { TagChip } from './Settings'
import TagPicker from './TagPicker'
import { Bubble, ForwardModal, StickerPicker, messageSummary, type MessageAction } from './chat-parts'
import PosOrderModal from './PosOrderModal'
import { dayLabel, fold, fullTime, STATUS_LABEL, timeLabel } from '../util'
import { can } from '../perm'
import { PLATFORM_CAPS, PLATFORM_LABEL, PlatformBadge, PlatformDot, platformOf } from '../platform'

type Scope = 'mine' | 'unassigned' | 'all'

export default function Inbox({ convId, focusMsgId }: { convId: string | null; focusMsgId: number | null }) {
  const { user, departments, tags, activeChannels, workingChannelIds, alerts } = useApp()
  const channels = activeChannels
  const [scope, setScope] = useState<Scope>(can(user, 'conversations.all') ? 'all' : 'mine')
  // Mặc định hiện mọi trạng thái như Zalo: bấm "Xong" không làm hội thoại biến mất.
  const [status, setStatus] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [deptFilter, setDeptFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  // Chỉ hội thoại đang có cảnh báo đơn "rơi"
  const [alertOnly, setAlertOnly] = useState(false)
  const alertIds = useMemo(() => new Set(alerts.map((a) => a.conversation_id)), [alerts])
  const myAlerts = alerts.filter((a) => !workingChannelIds || (a.channel_id !== null && workingChannelIds.includes(a.channel_id)))
  // Hàng tag lọc nhanh: mặc định mở để thấy sẵn các tag
  const [showTagFilter, setShowTagFilter] = useState(true)
  const [q, setQ] = useState('')
  const [list, setList] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  // Màn hình hẹp: khung thông tin nổi đè lên chat nên mặc định đóng.
  const [showInfo, setShowInfo] = useState(() => window.innerWidth > 1200)
  const searchInput = useRef<HTMLInputElement>(null)
  const searching = q.trim().length > 0
  const activeRef = useRef(convId)
  activeRef.current = convId

  // Bộ phận người này thấy (quản trị: tất cả; nhân viên: bộ phận mình thuộc về)
  const myDepartments = can(user, 'conversations.all') ? departments : departments.filter((d) => d.user_ids.includes(user.id))
  const filtersActive = status !== 'all' || !!channelFilter || !!deptFilter || !!tagFilter || alertOnly

  const matches = useCallback(
    (c: Conversation) => {
      if (scope === 'mine' && c.assigned_to !== user.id) return false
      if (scope === 'unassigned' && c.assigned_to !== null) return false
      if (status === 'active' && c.status === 'closed') return false
      if (status !== 'active' && status !== 'all' && c.status !== status) return false
      if (workingChannelIds && !workingChannelIds.includes(c.channel_id)) return false
      if (channelFilter && c.channel_id !== Number(channelFilter)) return false
      if (deptFilter === 'none' && c.department_id !== null) return false
      if (deptFilter && deptFilter !== 'none' && c.department_id !== Number(deptFilter)) return false
      if (tagFilter && !c.tags.includes(tagFilter)) return false
      if (alertOnly && !alertIds.has(c.id)) return false
      return true
    },
    [scope, status, channelFilter, deptFilter, tagFilter, user.id, workingChannelIds, alertOnly, alertIds],
  )

  const load = useCallback(
    async (before?: number) => {
      const params = new URLSearchParams({ scope, limit: '50' })
      if (status !== 'all' && status !== 'active') params.set('status', status)
      if (channelFilter) params.set('channelId', channelFilter)
      // Chỉ các kênh đang tick chọn ở trang Kênh Chat
      if (workingChannelIds) params.set('channelIds', workingChannelIds.join(','))
      if (deptFilter) params.set('departmentId', deptFilter)
      if (tagFilter) params.set('tag', tagFilter)
      if (alertOnly) params.set('alert', '1')
      if (before) params.set('before', String(before))
      const rows = await api<Conversation[]>(`/conversations?${params}`)
      const filtered = status === 'active' ? rows.filter((c) => c.status !== 'closed') : rows
      setHasMore(rows.length === 50)
      setList((prev) => (before ? [...prev, ...filtered.filter((r) => !prev.some((p) => p.id === r.id))] : filtered))
      setLoading(false)
    },
    [scope, status, channelFilter, deptFilter, tagFilter, workingChannelIds, alertOnly],
  )

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])
  // Đang lọc "Cảnh báo": danh sách cảnh báo đổi thì tải lại
  const alertKey = alerts.map((a) => a.id).join(',')
  useEffect(() => {
    if (alertOnly) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKey])

  // Ctrl+F / Ctrl+K: nhảy vào ô tìm kiếm như Zalo PC.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const upsert = useCallback(
    (c: Conversation) => {
      setList((prev) => {
        const without = prev.filter((p) => p.id !== c.id)
        // Hội thoại đang mở luôn được giữ trong danh sách, kể cả khi đổi trạng thái/bộ lọc.
        if (!matches(c) && c.id !== activeRef.current) return without
        const next = [c, ...without]
        return next.sort((a, b) => (b.last_message_at ?? b.created_at) - (a.last_message_at ?? a.created_at))
      })
    },
    [matches],
  )

  useSocketEvent<{ conversation: Conversation }>('message:new', ({ conversation }) => upsert(conversation))
  useSocketEvent<Conversation>('conversation:update', upsert)
  useSocketEvent<{ id: string }>('conversation:removed', ({ id }) => setList((prev) => prev.filter((p) => p.id !== id)))

  const current = list.find((c) => c.id === convId) ?? null

  return (
    <div className={`inbox ${convId ? 'has-active' : ''}`}>
      <section className="conv-pane">
        <div className="conv-head">
          <div className="conv-title-row">
            <h2>Hội thoại</h2>
            {workingChannelIds && (
              <a className="working-pill" href="#/channels" title="Đổi kênh đang chat">
                {channels.length === 1 ? channels[0].name : `${channels.length} kênh`}
              </a>
            )}
          </div>
          <div className="search">
            <Search size={16} />
            <input
              ref={searchInput}
              placeholder="Tìm khách, số điện thoại, tin nhắn…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQ('')}
              aria-label="Tìm kiếm"
            />
            {q && (
              <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Xóa tìm kiếm">
                <X size={14} />
              </button>
            )}
          </div>
          {!searching && (
            <>
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
              <div className="filter-row">
                <select className="select sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
                  <option value="all">Mọi trạng thái</option>
                  <option value="active">Chưa xong</option>
                  <option value="open">Đang xử lý</option>
                  <option value="pending">Chờ phản hồi</option>
                  <option value="closed">Đã xong</option>
                </select>
                {channels.length > 1 && (
                  <select className="select sm" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Lọc kênh">
                    <option value="">Mọi kênh</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {myDepartments.length > 1 || (can(user, 'conversations.all') && departments.length > 0) ? (
                  <select className="select sm" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Lọc bộ phận">
                    <option value="">Mọi bộ phận</option>
                    {myDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                    <option value="none">Chưa thuộc bộ phận</option>
                  </select>
                ) : null}

                <button
                  className={`btn ghost sm alert-filter ${alertOnly ? 'on' : ''} ${myAlerts.length ? 'has' : ''}`}
                  onClick={() => setAlertOnly((v) => !v)}
                  aria-pressed={alertOnly}
                  title='Hội thoại có cảnh báo đơn "rơi": chưa phản hồi, chưa tạo đơn, chưa đẩy vận chuyển'
                >
                  <AlertTriangle size={14} /> Cảnh báo{myAlerts.length ? ` (${myAlerts.length})` : ''}
                </button>
                {tags.length > 0 && (
                  <button
                    className={`btn ghost sm ${showTagFilter || tagFilter ? 'on' : ''}`}
                    onClick={() => setShowTagFilter((v) => !v)}
                    aria-expanded={showTagFilter}
                  >
                    Tag{tagFilter ? `: ${tagFilter}` : ''}
                  </button>
                )}
                {filtersActive && (
                  <button
                    className="link-btn"
                    onClick={() => {
                      setStatus('all')
                      setChannelFilter('')
                      setDeptFilter('')
                      setTagFilter('')
                      setAlertOnly(false)
                    }}
                  >
                    Bỏ lọc
                  </button>
                )}
              </div>
              {showTagFilter && tags.length > 0 && (
                <TagPicker
                  compact
                  tags={tags}
                  selected={tagFilter ? [tagFilter] : []}
                  onToggle={(name) => setTagFilter((cur) => (cur === name ? '' : name))}
                />
              )}
            </>
          )}
        </div>
        {searching ? (
          <SearchPanel q={q.trim()} activeConv={convId} />
        ) : (
          <div className="conv-list">
            {loading && <div className="muted pad">Đang tải…</div>}
            {!loading && !list.length && (
              <Empty icon={<InboxIcon size={28} />} title="Không có hội thoại">
                {filtersActive
                  ? 'Không có hội thoại khớp bộ lọc.'
                  : scope === 'mine'
                    ? 'Chưa có hội thoại nào giao cho bạn. Xem tab "Chưa nhận".'
                    : !can(user, 'conversations.all') && myDepartments.length === 0
                      ? 'Bạn chưa thuộc bộ phận nào. Nhờ quản trị viên thêm bạn vào bộ phận để thấy hội thoại.'
                      : 'Tin nhắn mới từ Zalo sẽ hiện ở đây.'}
              </Empty>
            )}
            {list.map((c) => (
              <ConvItem key={c.id} c={c} active={c.id === convId} showChannel={channels.length > 1} />
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
        )}
      </section>
      {convId ? (
        <ChatView
          key={convId}
          convId={convId}
          focusMsgId={focusMsgId}
          initial={current}
          showInfo={showInfo}
          toggleInfo={() => setShowInfo((v) => !v)}
        />
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

// ───────────── Tìm kiếm gộp kiểu Zalo: Liên hệ + Tin nhắn ─────────────

type ContactResult = {
  uid: string
  channel_id: number
  channel_name: string | null
  name: string
  avatar: string | null
  phone: string | null
  source: 'conversation' | 'friend' | 'phone'
  is_friend: boolean | null
  is_group: boolean
  conversation_id: string | null
  last_message_preview: string | null
  last_message_at: number | null
}

type MessageHit = {
  id: number
  conversation_id: string
  direction: 'in' | 'out'
  text: string | null
  ts: number
  sender_name: string | null
  agent_name: string | null
  conversation_name: string | null
  conversation_avatar: string | null
  conversation_type: number
  channel_name: string | null
}

type SearchTab = 'all' | 'contacts' | 'messages'

function SearchPanel({ q, activeConv }: { q: string; activeConv: string | null }) {
  const { channels, zaloStatuses } = useApp()
  const [tab, setTab] = useState<SearchTab>('all')
  // Kênh dùng để tìm bạn bè / tra số điện thoại (mặc định: kênh đầu tiên đang kết nối)
  const [lookupChannel, setLookupChannel] = useState<number | ''>('')
  const [contacts, setContacts] = useState<ContactResult[] | null>(null)
  const [phoneLookup, setPhoneLookup] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageHit[] | null>(null)
  const [moreMessages, setMoreMessages] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setContacts(null)
    setMessages(null)
    setError('')
    const t = setTimeout(() => {
      api<{ contacts: ContactResult[]; phone_lookup: boolean; phone_error: string | null }>(
        `/search/contacts?q=${encodeURIComponent(q)}${lookupChannel ? `&channelId=${lookupChannel}` : ''}`,
      )
        .then((r) => {
          if (!alive) return
          setContacts(r.contacts)
          setPhoneLookup(r.phone_lookup)
          setPhoneError(r.phone_error)
        })
        .catch((e) => alive && setError(e.message))
      if (q.length >= 2) {
        api<MessageHit[]>(`/search/messages?q=${encodeURIComponent(q)}&limit=30`)
          .then((rows) => {
            if (!alive) return
            setMessages(rows)
            setMoreMessages(rows.length === 30)
          })
          .catch((e) => alive && setError(e.message))
      } else setMessages([])
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, lookupChannel])

  async function loadMoreMessages() {
    if (!messages?.length) return
    const rows = await api<MessageHit[]>(
      `/search/messages?q=${encodeURIComponent(q)}&limit=30&before=${messages[messages.length - 1].ts}`,
    )
    setMessages([...messages, ...rows])
    setMoreMessages(rows.length === 30)
  }

  async function openContact(c: ContactResult) {
    if (c.conversation_id) {
      window.location.hash = `#/inbox/${encodeURIComponent(c.conversation_id)}`
      return
    }
    setOpening(`${c.channel_id}_${c.uid}`)
    try {
      const conv = await api<Conversation>('/zalo/people/open', {
        body: { uid: c.uid, channel_id: c.channel_id, name: c.name, avatar: c.avatar, phone: c.phone },
      })
      window.location.hash = `#/inbox/${encodeURIComponent(conv.id)}`
    } catch (e: any) {
      setError(e.message)
    } finally {
      setOpening(null)
    }
  }

  const showContacts = tab !== 'messages'
  const showMessages = tab !== 'contacts'
  const contactList = tab === 'all' ? contacts?.slice(0, 5) : contacts
  const messageList = tab === 'all' ? messages?.slice(0, 8) : messages

  return (
    <div className="search-panel">
      <div className="search-tabs" role="tablist">
        {(
          [
            ['all', 'Tất cả'],
            ['contacts', `Liên hệ${contacts ? ` (${contacts.length})` : ''}`],
            ['messages', `Tin nhắn${messages ? ` (${messages.length}${moreMessages ? '+' : ''})` : ''}`],
          ] as [SearchTab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {channels.length > 1 && tab !== 'messages' && (
        <div className="lookup-channel">
          <span className="muted small">Tìm bạn bè / số điện thoại qua kênh</span>
          <select className="select sm" value={lookupChannel} onChange={(e) => setLookupChannel(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Tự chọn kênh đang kết nối</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id} disabled={zaloStatuses.find((s) => s.channelId === c.id)?.state !== 'connected'}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="conv-list">
        {error && <div className="form-error pad">{error}</div>}

        {showContacts && (
          <div className="search-section">
            <div className="search-section-head">
              <span>Liên hệ</span>
              {tab === 'all' && contacts && contacts.length > 5 && (
                <button className="link-btn" onClick={() => setTab('contacts')}>
                  Xem tất cả
                </button>
              )}
            </div>
            {contacts === null && <div className="muted pad small">Đang tìm…</div>}
            {phoneError && <div className="form-error pad small">{phoneError}</div>}
            {contacts?.length === 0 && (
              <div className="muted pad small">
                {phoneLookup
                  ? 'Số này chưa dùng Zalo, hoặc người dùng đã tắt cho tìm qua số điện thoại.'
                  : /^[\d\s+.-]+$/.test(q)
                    ? 'Gõ đủ 10 số điện thoại để tìm trên Zalo.'
                    : 'Không có liên hệ nào trùng.'}
              </div>
            )}
            {contactList?.map((c) => (
              <button
                key={`${c.channel_id}_${c.uid}`}
                className={`search-row ${c.conversation_id && c.conversation_id === activeConv ? 'active' : ''}`}
                onClick={() => openContact(c)}
                disabled={opening === `${c.channel_id}_${c.uid}`}
              >
                <Avatar name={c.name} src={c.avatar} size={40} />
                <span className="search-row-main">
                  <span className="search-row-title">
                    {c.is_group && <UsersRound size={14} className="inline-icon" />}
                    <Highlight text={c.name} q={q} />
                  </span>
                  <span className="search-row-sub">
                    {c.phone && (
                      <>
                        <Highlight text={c.phone} q={q} />
                        {' · '}
                      </>
                    )}
                    {c.source === 'conversation'
                      ? c.last_message_preview ?? 'Đã có hội thoại'
                      : c.source === 'phone'
                        ? c.is_friend
                          ? 'Bạn bè · tìm qua số điện thoại'
                          : 'Chưa kết bạn · tìm qua số điện thoại'
                        : 'Bạn bè Zalo'}
                    {channels.length > 1 && c.channel_name ? ` · ${c.channel_name}` : ''}
                  </span>
                </span>
                <span className="search-row-side">
                  {c.conversation_id ? (
                    timeLabel(c.last_message_at)
                  ) : (
                    <span className="badge green">{opening === `${c.channel_id}_${c.uid}` ? 'Đang mở…' : 'Nhắn tin'}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {showMessages && (
          <div className="search-section">
            <div className="search-section-head">
              <span>Tin nhắn</span>
              {tab === 'all' && messages && messages.length > 8 && (
                <button className="link-btn" onClick={() => setTab('messages')}>
                  Xem tất cả
                </button>
              )}
            </div>
            {messages === null && <div className="muted pad small">Đang tìm…</div>}
            {messages?.length === 0 && (
              <div className="muted pad small">{q.length < 2 ? 'Gõ ít nhất 2 ký tự để tìm tin nhắn.' : 'Không có tin nhắn nào chứa từ này.'}</div>
            )}
            {messageList?.map((m) => (
              <a
                key={m.id}
                className="search-row"
                href={`#/inbox/${encodeURIComponent(m.conversation_id)}/${m.id}`}
              >
                <Avatar name={m.conversation_name ?? m.conversation_id} src={m.conversation_avatar} size={40} />
                <span className="search-row-main">
                  <span className="search-row-title">
                    {m.conversation_name ?? m.conversation_id}
                    {channels.length > 1 && m.channel_name && <span className="channel-label">{m.channel_name}</span>}
                  </span>
                  <span className="search-row-sub">
                    <span className="muted">
                      {m.direction === 'in'
                        ? m.conversation_type === 1
                          ? `${m.sender_name ?? 'Thành viên'}: `
                          : ''
                        : `${m.agent_name ?? 'Shop'}: `}
                    </span>
                    <Highlight text={snippet(m.text ?? '', q)} q={q} />
                  </span>
                </span>
                <span className="search-row-side">{timeLabel(m.ts)}</span>
              </a>
            ))}
            {tab === 'messages' && moreMessages && (
              <button className="btn ghost block" onClick={loadMoreMessages}>
                Tải thêm tin nhắn
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Cắt đoạn quanh từ khóa để kết quả tin nhắn dài vẫn thấy chỗ trùng. */
function snippet(raw: string, q: string) {
  const text = raw.normalize('NFC')
  const i = fold(text).indexOf(fold(q))
  if (i < 0 || text.length <= 90) return text
  const start = Math.max(0, i - 30)
  return (start > 0 ? '…' : '') + text.slice(start, start + 90) + (start + 90 < text.length ? '…' : '')
}

/** Tô đậm phần trùng từ khóa, không phân biệt dấu (gõ "gop" sáng "góp"). */
function Highlight({ text: raw, q }: { text: string; q: string }) {
  const text = raw.normalize('NFC')
  const needle = fold(q)
  if (!needle) return <>{text}</>
  const hay = fold(text)
  const parts: React.ReactNode[] = []
  let from = 0
  let i = hay.indexOf(needle)
  while (i >= 0 && parts.length < 20) {
    if (i > from) parts.push(text.slice(from, i))
    parts.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>)
    from = i + needle.length
    i = hay.indexOf(needle, from)
  }
  parts.push(text.slice(from))
  return <>{parts}</>
}

function ConvItem({ c, active, showChannel }: { c: Conversation; active: boolean; showChannel: boolean }) {
  const { presence, user, tags, channels, alerts } = useApp()
  const convAlerts = alerts.filter((a) => a.conversation_id === c.id)
  const viewers = (presence.byConversation[c.id] ?? []).filter((p) => p.userId !== user.id)
  // Chỉ hiện ký hiệu nền tảng khi có từ 2 nền tảng trở lên
  const mixed = new Set(channels.map((ch) => ch.platform ?? 'zalo')).size > 1 || platformOf(c.platform) !== 'zalo'
  const typing = viewers.find((v) => v.typing)
  const waiting = c.last_direction === 'in' && c.status !== 'closed'
  return (
    <a
      href={`#/inbox/${encodeURIComponent(c.id)}`}
      className={`conv-item ${active ? 'active' : ''} ${c.unread_count ? 'unread' : ''} ${c.status === 'closed' ? 'closed' : ''}`}
    >
      <span className="avatar-wrap">
        <Avatar name={c.name ?? c.id} src={c.avatar} size={44} />
        {mixed && <PlatformDot platform={c.platform} />}
      </span>
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
          {c.kind === 'comment' && <Badge tone="lime">Bình luận</Badge>}
          {convAlerts.map((a) => (
            <Badge key={a.id} tone="danger">
              <AlertTriangle size={12} /> {a.label}
            </Badge>
          ))}
          {c.status !== 'open' && <Badge tone={c.status === 'closed' ? 'neutral' : 'lime'}>{STATUS_LABEL[c.status]}</Badge>}
          {viewers.length > 0 && !typing && (
            <span className="viewers" title={`Đang xem: ${viewers.map((v) => v.name).join(', ')}`}>
              <Eye size={12} /> {viewers.length}
            </span>
          )}
        </div>
        {(showChannel || c.department_name || c.tags.length > 0) && (
          <div className="conv-meta">
            {showChannel && c.channel_name && <span className="channel-label">{c.channel_name}</span>}
            {c.department_name && (
              <span className="dept-chip sm" style={{ '--chip': c.department_color ?? '#55655c' } as React.CSSProperties}>
                {c.department_name}
              </span>
            )}
            {c.tags.map((t) => (
              <TagChip key={t} tag={{ name: t, color: tags.find((x) => x.name === t)?.color ?? '#9aa6a0' }} />
            ))}
          </div>
        )}
      </div>
    </a>
  )
}


function ChatView({
  convId,
  focusMsgId,
  initial,
  showInfo,
  toggleInfo,
}: {
  convId: string
  focusMsgId: number | null
  initial: Conversation | null
  showInfo: boolean
  toggleInfo: () => void
}) {
  const { user, users, presence, socket, departments, channels } = useApp()
  const [conv, setConv] = useState<Conversation | null>(initial)
  const caps = channels.find((ch) => ch.id === conv?.channel_id)?.capabilities ?? PLATFORM_CAPS[platformOf(conv?.platform)]
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [hasOlder, setHasOlder] = useState(false)
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
  const [notesVersion, setNotesVersion] = useState(0)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(t)
  }, [toast])

  async function onMessageAction(action: MessageAction, m: Message) {
    const base = `/conversations/${encodeURIComponent(convId)}/messages/${m.id}`
    try {
      if (action === 'reply') {
        setReplyTo(m)
        document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
      } else if (action === 'copy') {
        await navigator.clipboard.writeText(m.text ?? '')
        setToast('Đã sao chép')
      } else if (action === 'forward') {
        setForwardMsg(m)
      } else if (action === 'undo') {
        if (!confirm('Thu hồi tin nhắn này? Khách sẽ thấy "Tin nhắn đã thu hồi".')) return
        await api(`${base}/undo`, { method: 'POST' })
        setToast('Đã thu hồi')
      } else if (action === 'note') {
        const who = m.direction === 'in' ? m.sender_name ?? 'Khách' : m.agent_name ?? 'Shop'
        const time = new Date(m.ts).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
        await api(`/conversations/${encodeURIComponent(convId)}/notes`, {
          body: { content: `Tin nhắn của ${who} lúc ${time}: "${messageSummary(m)}"` },
        })
        setNotesVersion((v) => v + 1)
        setToast('Đã thêm vào ghi chú nội bộ')
      }
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function onReact(m: Message, code: string) {
    try {
      const updated = await api<Message>(`/conversations/${encodeURIComponent(convId)}/messages/${m.id}/reaction`, {
        body: { icon: code },
      })
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e: any) {
      alert(e.message)
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    api<Conversation>(`/conversations/${encodeURIComponent(convId)}`)
      .then((c) => {
        if (!alive) return
        // Link cũ dạng /?c=<threadId>: chuyển sang id hội thoại theo kênh.
        if (c.id !== convId) window.location.replace(`#/inbox/${encodeURIComponent(c.id)}`)
        else setConv(c)
      })
      .catch((e) => alive && setError(e.message))
    const base = `/conversations/${encodeURIComponent(convId)}/messages`
    api<Message[]>(focusMsgId ? `${base}?around=${focusMsgId}` : `${base}?limit=60`).then((rows) => {
      if (!alive) return
      const idx = focusMsgId ? rows.findIndex((m) => m.id === focusMsgId) : -1
      stickBottom.current = idx < 0
      setMessages(rows)
      setHasOlder(idx >= 0 ? idx >= 40 : rows.length === 60)
      setFlashId(idx >= 0 ? focusMsgId : null)
      setLoading(false)
    })
    void api(`/conversations/${encodeURIComponent(convId)}/read`, { method: 'POST' })
    socket?.emit('view', convId)
    return () => {
      alive = false
      socket?.emit('view', null)
    }
  }, [convId, focusMsgId, socket])

  // Nhảy tới tin nhắn tìm được và nháy sáng 2 giây.
  useEffect(() => {
    if (!flashId) return
    const el = scroller.current?.querySelector(`[data-mid="${flashId}"]`)
    el?.scrollIntoView({ block: 'center' })
    const t = setTimeout(() => setFlashId(null), 2500)
    return () => clearTimeout(t)
  }, [flashId])

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
  useSocketEvent<{ id: string }>('conversation:removed', ({ id }) => {
    if (id === convId) setError('Hội thoại đã được chuyển sang bộ phận khác, bạn không còn quyền xem.')
  })

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
  const canReassign = can(user, 'conversations.assign') || conv?.assigned_to === user.id
  const canTransfer = can(user, 'conversations.assign') || !conv?.assigned_to || conv.assigned_to === user.id
  // Chuyển được sang bộ phận được xem kênh của hội thoại (quản trị viên: mọi bộ phận).
  const transferTargets = departments.filter(
    (d) => can(user, 'conversations.all') || d.channel_ids.includes(conv?.channel_id ?? -1) || d.id === conv?.department_id,
  )
  // Người phụ trách: thành viên bộ phận của hội thoại + quản trị viên (chưa có bộ phận → mọi người).
  const dept = departments.find((d) => d.id === conv?.department_id)
  const assignable = users.filter(
    (u) => u.active && (!dept || can(u, 'conversations.all') || dept.user_ids.includes(u.id) || u.id === conv?.assigned_to),
  )

  async function transfer(value: string) {
    const target = value ? Number(value) : null
    const name = departments.find((d) => d.id === target)?.name ?? 'chưa thuộc bộ phận'
    const leaving = !can(user, 'conversations.all') && target !== null && !departments.find((d) => d.id === target)?.user_ids.includes(user.id)
    if (leaving && !confirm(`Chuyển hội thoại sang "${name}"? Bạn không thuộc bộ phận này nên sẽ không thấy hội thoại nữa.`)) return
    await patch({ department_id: target })
  }

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
              {conv?.channel_name && <span className="channel-label">{conv.channel_name}</span>}
              {others.length ? (
                <span className="presence-line">
                  <Eye size={13} /> {others.map((o) => o.name).join(', ')} đang xem
                </span>
              ) : conv?.type === 1 ? (
                'Nhóm Zalo'
              ) : (
                <PlatformBadge platform={conv?.platform} comment={conv?.kind === 'comment'} />
              )}
            </div>
            {conv?.kind === 'comment' && conv.meta?.post_url && (
              <a className="post-link" href={conv.meta.post_url} target="_blank" rel="noreferrer" title={conv.meta.post_message ?? undefined}>
                <ExternalLink size={12} /> {conv.meta.post_message ? `Bài viết: ${conv.meta.post_message.slice(0, 80)}` : 'Xem bài viết'}
              </a>
            )}
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
                {assignable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id === user.id ? `${u.display_name} (bạn)` : u.display_name}
                  </option>
                ))}
              </select>
            )}
            {departments.length > 0 && (
              <select
                className="select sm dept-select"
                value={conv?.department_id ?? ''}
                disabled={!canTransfer}
                onChange={(e) => void transfer(e.target.value)}
                aria-label="Bộ phận"
                title={canTransfer ? 'Chuyển hội thoại sang bộ phận khác' : 'Chỉ người phụ trách mới chuyển được bộ phận'}
                style={{ '--chip': conv?.department_color ?? '#9aa6a0' } as React.CSSProperties}
              >
                <option value="">Chưa thuộc bộ phận</option>
                {transferTargets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
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
                <Bubble
                  m={m}
                  grouped={!!grouped}
                  isGroup={conv?.type === 1}
                  flash={m.id === flashId}
                  canUndo={can(user, 'messages.undo_any') || m.agent_id === user.id}
                  caps={caps}
                  canReply={caps.quote || conv?.kind === 'comment'}
                  onAction={onMessageAction}
                  onReact={onReact}
                />
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
        {toast && <div className="toast">{toast}</div>}
        <Composer
          convId={convId}
          channelId={conv?.channel_id ?? null}
          conv={conv}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
        />
      </section>
      {showInfo && conv && <InfoPanel key={notesVersion} conv={conv} onPatch={patch} onClose={toggleInfo} />}
      {forwardMsg && conv && <ForwardModal message={forwardMsg} from={conv} onClose={() => setForwardMsg(null)} />}
    </>
  )
}

function Composer({
  convId,
  channelId,
  conv,
  replyTo,
  onClearReply,
}: {
  convId: string
  channelId: number | null
  conv: Conversation | null
  replyTo: Message | null
  onClearReply: () => void
}) {
  const [stickerOpen, setStickerOpen] = useState(false)
  const { socket, zaloStatuses, channels } = useApp()
  const platform = platformOf(conv?.platform)
  const caps = channels.find((ch) => ch.id === channelId)?.capabilities ?? PLATFORM_CAPS[platform]
  const isComment = conv?.kind === 'comment'
  // Bình luận Facebook: trả lời công khai dưới bình luận hoặc nhắn riêng qua Messenger
  const [mode, setMode] = useState<'public' | 'private'>('public')
  useEffect(() => setMode('public'), [convId])
  const channelStatus = zaloStatuses.find((s) => s.channelId === channelId)
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
      if (replyTo) fd.append('quote_message_id', String(replyTo.id))
      if (isComment) fd.append('mode', mode)
      files.forEach((f) => fd.append('files', f))
      await api(`/conversations/${encodeURIComponent(convId)}/messages`, { body: fd })
      setText('')
      setFiles([])
      onClearReply()
      typingOn.current = false
      socket?.emit('typing', false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
      textarea.current?.focus()
    }
  }

  async function sendSticker(st: Sticker) {
    setStickerOpen(false)
    setError('')
    try {
      await api(`/conversations/${encodeURIComponent(convId)}/sticker`, { body: { id: st.id, cateId: st.cateId, type: st.type } })
    } catch (e: any) {
      setError(e.message)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && replyTo) {
      onClearReply()
      return
    }
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

  const disabled = channelStatus?.state !== 'connected'

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
      {replyTo && (
        <div className="reply-bar">
          <Quote size={16} />
          <div className="grow">
            <b>Trả lời {replyTo.direction === 'in' ? replyTo.sender_name ?? 'khách' : replyTo.agent_name ?? 'shop'}</b>
            <span>{messageSummary(replyTo)}</span>
          </div>
          <button className="icon-btn sm" onClick={onClearReply} aria-label="Bỏ trả lời">
            <X size={14} />
          </button>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {stickerOpen && <StickerPicker channelId={channelId} onPick={sendSticker} onClose={() => setStickerOpen(false)} />}
      {isComment && (
        <div className="reply-mode" role="radiogroup" aria-label="Cách trả lời bình luận">
          <button role="radio" aria-checked={mode === 'public'} className={mode === 'public' ? 'on' : ''} onClick={() => setMode('public')}>
            <Globe size={14} /> Trả lời công khai
          </button>
          <button role="radio" aria-checked={mode === 'private'} className={mode === 'private' ? 'on' : ''} onClick={() => setMode('private')}>
            <Lock size={14} /> Nhắn riêng qua Messenger
          </button>
          <span className="muted small">
            {mode === 'public'
              ? `Trả lời dưới ${replyTo ? 'bình luận đang chọn' : 'bình luận mới nhất của khách'}, ai cũng thấy.`
              : 'Mỗi bình luận chỉ nhắn riêng được 1 lần, trong 7 ngày.'}
          </span>
        </div>
      )}
      <div className="composer-row">
        {caps.stickers && (
        <button
          className={`icon-btn ${stickerOpen ? 'on' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setStickerOpen((v) => !v)}
          aria-label="Gửi sticker"
          title="Sticker"
          disabled={disabled}
        >
          <Smile size={20} />
        </button>
        )}
        {caps.files && !isComment && (
          <button className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Đính kèm ảnh/tệp" title="Gửi ảnh, tệp" disabled={disabled}>
            <Paperclip size={20} />
          </button>
        )}
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
          placeholder={
            disabled
              ? `${PLATFORM_LABEL[platform]} chưa kết nối`
              : isComment
                ? 'Nhập trả lời bình luận… (gõ / để chọn mẫu câu)'
                : 'Nhập tin nhắn… (gõ / để chọn mẫu câu, Shift+Enter xuống dòng)'
          }
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
  const { user, tags, alerts, reloadAlerts, can: allowed } = useApp()
  const convAlerts = alerts.filter((a) => a.conversation_id === conv.id)
  const [orders, setOrders] = useState<Order[]>([])
  const [posOpen, setPosOpen] = useState(false)
  const [posMsg, setPosMsg] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [note, setNote] = useState('')
  const [ref, setRef] = useState(conv.external_ref ?? '')
  const [score, setScore] = useState(0)
  const [comment, setComment] = useState('')

  const enc = encodeURIComponent(conv.id)
  useEffect(() => {
    api<Note[]>(`/conversations/${enc}/notes`).then(setNotes)
    api<Review[]>(`/conversations/${enc}/reviews`).then(setReviews)
    api<Order[]>(`/conversations/${enc}/orders`).then(setOrders).catch(() => setOrders([]))
    setRef(conv.external_ref ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id])

  useSocketEvent<{ conversation_id: string }>('orders:changed', ({ conversation_id }) => {
    if (conversation_id === conv.id) api<Order[]>(`/conversations/${enc}/orders`).then(setOrders).catch(() => {})
  })

  async function resolveAlert(a: Alert) {
    await api(`/alerts/${a.id}/resolve`, { body: {} })
    reloadAlerts()
  }

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

  // Tag chọn từ danh sách đã tạo trong Cài đặt (theo bộ phận của nhân viên).
  const colorOf = (name: string) => tags.find((t) => t.name === name)?.color ?? '#9aa6a0'
  // Tag cũ không còn trong danh sách (đã xóa / bộ phận khác) vẫn hiện để bỏ được
  const orphanTags = conv.tags.filter((t) => !tags.some((x) => x.name === t))
  function toggleTag(name: string) {
    void onPatch({ tags: conv.tags.includes(name) ? conv.tags.filter((x) => x !== name) : [...conv.tags, name] })
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
        <code className="muted small">
          ID {PLATFORM_LABEL[platformOf(conv.platform)]}: {conv.thread_id}
        </code>
        <span className="muted small">
          {conv.channel_name}
          {conv.department_name ? ` · ${conv.department_name}` : ''}
        </span>
      </div>

      {convAlerts.length > 0 && (
        <div className="info-section alert-box">
          <div className="section-title">
            <AlertTriangle size={14} /> Cảnh báo đơn "rơi"
          </div>
          {convAlerts.map((a) => (
            <div key={a.id} className="alert-item">
              <div className="grow">
                <b>{a.label}</b>
                <span className="small muted">{alertDetail(a)}</span>
              </div>
              <button className="btn outline sm" onClick={() => resolveAlert(a)} title="Đánh dấu đã xử lý, tắt cảnh báo này">
                Đã xử lý
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="info-section">
        <div className="section-title row">
          <span className="grow">
            <ShoppingBag size={14} /> Đơn hàng
          </span>
          {allowed('orders.create') && (
            <button className="btn primary sm" onClick={() => setPosOpen(true)}>
              Lên đơn POS
            </button>
          )}
        </div>
        {posMsg && <div className="small ok-text">{posMsg}</div>}
        {posOpen && (
          <PosOrderModal
            conv={conv}
            onClose={() => setPosOpen(false)}
            onDone={(text) => {
              setPosOpen(false)
              setPosMsg(text)
              api<Order[]>(`/conversations/${enc}/orders`).then(setOrders).catch(() => {})
            }}
          />
        )}
        {orders.length ? (
          orders.map((o) => (
            <div key={o.id} className="order-item">
              <div className="row">
                <b className="grow">{o.code ?? o.external_id}</b>
                {o.total !== null && <span>{o.total.toLocaleString('vi-VN')}₫</span>}
              </div>
              <span className="small muted">
                {SOURCE_LABEL[o.source] ?? o.source} · {new Date(o.created_at).toLocaleDateString('vi-VN')}
                {o.status ? ` · ${POS_STATE[o.status] ?? o.status}` : ''}
                {` · ${shippingLabel(o.fulfillment_status)}`}
              </span>
            </div>
          ))
        ) : (
          <span className="muted small">Chưa có đơn gắn với hội thoại. Đơn tự gắn theo số điện thoại khi kết nối Sapo hoặc web bán hàng.</span>
        )}
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
          <Tag size={14} /> Tag
        </div>
        <span className="muted small">Bấm để gắn / bỏ tag.</span>
        {orphanTags.length > 0 && (
          <div className="tags">
            {orphanTags.map((t) => (
              <TagChip key={t} tag={{ name: t, color: colorOf(t) }} onRemove={() => toggleTag(t)} />
            ))}
          </div>
        )}
        <TagPicker
          tags={tags}
          selected={conv.tags}
          onToggle={toggleTag}
          emptyText={can(user, 'tags.manage') ? 'Chưa có tag. Tạo ở Cài đặt › Tag.' : 'Chưa có tag cho bộ phận của bạn.'}
        />
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

      {can(user, 'reviews.manage') && (
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
        {can(user, 'reviews.manage') ? (
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
      )}

      <div className="info-section">
        {can(user, 'data.export') && (
          <>
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
          </>
        )}
        {conv.status === 'closed' && (
          <button className="btn ghost sm" onClick={() => onPatch({ status: 'open' })}>
            <RotateCcw size={14} /> Mở lại hội thoại
          </button>
        )}
        <div className="muted small">
          <Zap size={12} className="inline-icon" /> Link mở nhanh từ app khác: <code>/?c={conv.thread_id}</code>
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

const SOURCE_LABEL: Record<string, string> = { sapo: 'Sapo', odoo_pos: 'POS Odoo', api: 'API', web: 'Web' }
const POS_STATE: Record<string, string> = {
  pending_pos: 'chờ ca POS mở',
  draft: 'nháp trên POS',
  to_pay: 'chờ thanh toán',
  reserve: 'giữ hàng',
  paid: 'đã thanh toán',
  done: 'hoàn tất',
  invoiced: 'đã xuất hóa đơn',
  cancel: 'đã hủy',
  open: 'mới',
}

/** Trạng thái giao hàng dễ đọc */
function shippingLabel(s: string | null) {
  const v = (s ?? '').toLowerCase()
  if (v === 'fulfilled' || v === 'shipped' || v === 'delivered') return 'đã đẩy vận chuyển'
  if (v === 'partial') return 'giao một phần'
  if (!v || v === 'unshipped' || v === 'pending' || v === 'unfulfilled') return 'chưa đẩy vận chuyển'
  return v
}

/** Mô tả ngắn lý do cảnh báo */
function alertDetail(a: Alert) {
  const d = a.detail ?? {}
  const since = d.since ? `từ ${new Date(d.since).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : ''
  if (a.type === 'no_reply') return `Khách chờ trả lời ${since}`
  if (a.type === 'no_shipping') return `Đơn ${d.order ?? ''} chưa đẩy vận chuyển ${since}`
  const why = [d.phone ? `SĐT ${d.phone}` : '', d.address ? 'có địa chỉ' : '', d.keyword ? `nói "${d.keyword}"` : ''].filter(Boolean).join(', ')
  return `Khách ${why || 'tiềm năng'} nhưng chưa có đơn ${since}`
}
