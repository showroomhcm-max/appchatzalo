import { Fragment, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, Flag, Search, ShieldAlert, Sparkles, Undo2, UsersRound } from 'lucide-react'
import { AiPanel, DigestView, MonitorReportButton, RISK } from './monitor-ai'
import { api } from '../api'
import { useSocketEvent } from '../store'
import type { Conversation, Message, ZaloStatus } from '../types'
import { Avatar, Badge, Empty } from '../components'
import { Bubble } from './chat-parts'
import { dayLabel, fullTime, timeLabel } from '../util'

type Account = {
  channel_id: number
  name: string
  phone: string | null
  holder_name: string | null
  holder_active: number | null
  avatar: string | null
  connection: ZaloStatus | null
  monitoring: boolean
  since_drop: number | null
  open_flags: number
  waiting: number
  today: { msg_in: number; msg_out: number; undone: number; customers: number }
}
type MConv = {
  id: string
  type: number
  name: string | null
  avatar: string | null
  phone: string | null
  last_message_at: number | null
  last_message_preview: string | null
  last_direction: 'in' | 'out' | null
  open_flags: number
  undone: number
  ai_risk: 'none' | 'low' | 'medium' | 'high' | null
  ai_score: number | null
  ai_summary: string | null
}
type FlagRow = { id: number; reason: string; created_at: number; conversation_id: string; channel_id: number; message_id: number; text: string; direction: 'in' | 'out'; conversation_name: string | null; channel_name: string; source: 'rule' | 'ai'; severity: 'low' | 'medium' | 'high' | null; detail: string | null }

const NO_CAPS = { stickers: false, reactions: false, undo: false, forward: false, quote: false, files: false, contacts: false }

/** Giám sát Zalo nhân viên: xem toàn bộ tin nhắn nhân viên chat với khách trên SĐT công ty cấp (chỉ xem). */
export default function Monitor({ channelId, convId }: { channelId: number | null; convId: string | null }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState('')
  const load = () =>
    api<Account[]>('/monitor/accounts')
      .then(setAccounts)
      .catch((e) => setError(e.message))
  useEffect(() => {
    void load()
  }, [])
  useSocketEvent('zalo:status', () => void load())
  useSocketEvent('monitor:changed', () => void load())

  if (!accounts) return <div className="page">{error ? <div className="banner warn inline">{error}</div> : <div className="muted">Đang tải…</div>}</div>
  const current = accounts.find((a) => a.channel_id === channelId) ?? null

  return (
    // Điện thoại: mỗi lúc một cấp (nhân viên → khách → tin nhắn), có nút quay lại
    <div className={`monitor ${convId ? 'lvl-msg' : channelId ? 'lvl-conv' : 'lvl-acc'}`}>
      <aside className="monitor-accounts">
        <div className="monitor-head">
          <h2>Giám sát Zalo nhân viên</h2>
          <a className="small" href="#/settings/company">
            Thêm / cài đặt
          </a>
        </div>
        <div className="monitor-actions">
          <MonitorReportButton accounts={accounts} current={channelId} />
        </div>
        <a href="#/monitor" className={`monitor-account ${!channelId ? 'on' : ''}`}>
          <Flag size={18} />
          <span className="grow">Tin cần chú ý</span>
          {accounts.reduce((s, a) => s + a.open_flags, 0) > 0 && <Badge tone="danger">{accounts.reduce((s, a) => s + a.open_flags, 0)}</Badge>}
        </a>
        {!accounts.length && (
          <div className="muted small pad">
            Chưa có Zalo nhân viên nào. Vào <a href="#/settings/company">Cài đặt › Zalo nhân viên</a> để thêm SĐT công ty cấp và quét QR.
          </div>
        )}
        {accounts.map((a) => (
          <a key={a.channel_id} href={`#/monitor/${a.channel_id}`} className={`monitor-account ${a.channel_id === channelId ? 'on' : ''}`}>
            <span className="avatar-wrap">
              <Avatar name={a.holder_name ?? a.name} src={a.connection?.account?.avatar || a.avatar} size={36} />
            </span>
            <span className="grow">
              <b>{a.holder_name ?? a.name}</b>
              <span className="small muted">
                {a.phone ?? a.name} · hôm nay {a.today.customers} khách
              </span>
            </span>
            {a.monitoring ? (
              <span className="status-dot ok" title="Đang giám sát" />
            ) : (
              <span className="status-dot bad" title="Mất giám sát" />
            )}
            {a.open_flags > 0 && <Badge tone="danger">{a.open_flags}</Badge>}
          </a>
        ))}
      </aside>
      {current ? <AccountView account={current} convId={convId} /> : <FlagsView channelId={null} />}
    </div>
  )
}

function AccountView({ account: a, convId }: { account: Account; convId: string | null }) {
  const [q, setQ] = useState('')
  const [convs, setConvs] = useState<MConv[]>([])
  const [tab, setTab] = useState<'chats' | 'flags' | 'ai'>('chats')
  const load = () => api<MConv[]>(`/monitor/accounts/${a.channel_id}/conversations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(setConvs)
  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 300 : 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.channel_id, q])
  useSocketEvent<{ conversation: Conversation }>('message:new', ({ conversation }) => {
    if (conversation.channel_id === a.channel_id) void load()
  })

  return (
    <>
      <section className="monitor-convs">
        {!a.monitoring && (
          <div className="banner warn inline">
            <ShieldAlert size={16} /> Mất giám sát{a.since_drop ? ` từ ${fullTime(a.since_drop)}` : ''}: {a.connection?.error ?? 'Zalo này chưa kết nối với app'}. Tin
            nhắn trong lúc mất kết nối có thể không được lưu. <a href="#/settings/company">Quét QR lại</a>
          </div>
        )}
        <div className="monitor-stats">
          <span>
            <b>{a.today.customers}</b> khách hôm nay
          </span>
          <span>
            <b>{a.today.msg_in}</b> tin khách
          </span>
          <span>
            <b>{a.today.msg_out}</b> tin nhân viên
          </span>
          <span className={a.today.undone ? 'warn-text' : ''}>
            <b>{a.today.undone}</b> tin thu hồi
          </span>
          <span className={a.waiting ? 'err-text' : ''}>
            <b>{a.waiting}</b> khách chờ trả lời
          </span>
        </div>
        <div className="seg">
          <button className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}>
            Hội thoại ({convs.length})
          </button>
          <button className={tab === 'flags' ? 'on' : ''} onClick={() => setTab('flags')}>
            Cần chú ý ({a.open_flags})
          </button>
          <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>
            <Sparkles size={14} /> Tổng hợp AI
          </button>
        </div>
        {tab === 'chats' ? (
          <>
            <label className="search-box">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách, số điện thoại, nội dung tin" aria-label="Tìm" />
            </label>
            <div className="monitor-list">
              {convs.map((c) => (
                <a key={c.id} href={`#/monitor/${a.channel_id}/${encodeURIComponent(c.id)}`} className={`conv-item ${c.id === convId ? 'active' : ''}`}>
                  <Avatar name={c.name ?? c.id} src={c.avatar} size={40} />
                  <div className="conv-main">
                    <div className="conv-top">
                      <span className="conv-name">
                        {c.type === 1 && <UsersRound size={14} className="inline-icon" />}
                        {c.name ?? c.id}
                      </span>
                      <span className="conv-time">{timeLabel(c.last_message_at)}</span>
                    </div>
                    <div className="conv-bottom">
                      <span className="conv-preview">
                        {c.last_direction === 'out' && <span className="muted">NV: </span>}
                        {c.last_message_preview ?? ''}
                      </span>
                    </div>
                    {(c.open_flags > 0 || c.undone > 0 || (c.ai_risk && c.ai_risk !== 'none')) && (
                      <div className="conv-meta">
                        {c.ai_risk && c.ai_risk !== 'none' && (
                          <Badge tone={RISK[c.ai_risk].tone}>
                            <Sparkles size={12} /> {RISK[c.ai_risk].label}
                          </Badge>
                        )}
                        {c.open_flags > 0 && (
                          <Badge tone="danger">
                            <Flag size={12} /> {c.open_flags} cần chú ý
                          </Badge>
                        )}
                        {c.undone > 0 && (
                          <Badge tone="warning">
                            <Undo2 size={12} /> {c.undone} thu hồi
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </a>
              ))}
              {!convs.length && <div className="muted small pad">Chưa có hội thoại.</div>}
            </div>
          </>
        ) : tab === 'flags' ? (
          <FlagsView channelId={a.channel_id} compact />
        ) : (
          <DigestView channelId={a.channel_id} holder={a.holder_name ?? a.name} />
        )}
      </section>
      <Transcript convId={convId} holder={a.holder_name} />
    </>
  )
}

function Transcript({ convId, holder }: { convId: string | null; holder: string | null }) {
  const [data, setData] = useState<{ conversation: Conversation; messages: Message[] } | null>(null)
  const [error, setError] = useState('')
  const [flashId, setFlashId] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const jump = (id: number) => {
    setFlashId(id)
    scroller.current?.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => setFlashId(null), 2500)
  }
  const load = () =>
    convId
      ? api<{ conversation: Conversation; messages: Message[] }>(`/monitor/conversations/${encodeURIComponent(convId)}/messages`)
          .then(setData)
          .catch((e) => setError(e.message))
      : setData(null)
  useEffect(() => {
    setData(null)
    setError('')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])
  useSocketEvent<{ conversation: Conversation }>('message:new', ({ conversation }) => {
    if (conversation.id === convId) void load()
  })
  useSocketEvent<{ conversation: Conversation }>('message:update', ({ conversation }) => {
    if (conversation?.id === convId) void load()
  })

  if (!convId)
    return (
      <section className="monitor-transcript">
        <Empty icon={<Eye size={32} />} title="Chọn một hội thoại để xem">
          Chỉ xem: không gửi tin thay nhân viên. Mỗi lần mở xem được ghi vào nhật ký.
        </Empty>
      </section>
    )
  if (error) return <section className="monitor-transcript"><div className="banner warn inline">{error}</div></section>
  if (!data) return <section className="monitor-transcript"><div className="muted pad">Đang tải…</div></section>
  const c = data.conversation
  return (
    <section className="monitor-transcript">
      <header className="chat-head">
        <a href={`#/monitor/${c.channel_id}`} className="icon-btn back-btn" aria-label="Quay lại danh sách khách">
          <ArrowLeft size={18} />
        </a>
        <Avatar name={c.name ?? c.id} src={c.avatar} size={40} />
        <div className="chat-title">
          <div className="chat-name">{c.name ?? c.thread_id}</div>
          <div className="chat-sub">
            {c.phone ? `${c.phone} · ` : ''}chat với {holder ?? 'nhân viên'} · <Badge tone="info">Chỉ xem</Badge>
          </div>
        </div>
      </header>
      <AiPanel convId={c.id} onJump={jump} />
      <div className="messages" ref={scroller}>
        {!data.messages.length && <div className="muted pad center">Chưa có tin nhắn được lưu.</div>}
        {data.messages.map((m, i) => {
          const prev = data.messages[i - 1]
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep">{dayLabel(m.ts)}</div>}
              <Bubble
                m={{ ...m, holder_name: m.direction === 'out' && !m.agent_name ? m.holder_name ?? holder : m.holder_name }}
                grouped={false}
                isGroup={c.type === 1}
                flash={m.id === flashId}
                canUndo={false}
                caps={NO_CAPS}
                canReply={false}
                readOnly
                onAction={() => {}}
                onReact={() => {}}
              />
              {!!m.undone && (m as any).undone_at && (
                <div className={`undone-note ${m.direction === 'out' ? 'out' : ''}`}>
                  <Undo2 size={12} /> {m.direction === 'out' ? 'Nhân viên' : 'Khách'} thu hồi lúc {fullTime((m as any).undone_at)}
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}

function FlagsView({ channelId, compact }: { channelId: number | null; compact?: boolean }) {
  const [flags, setFlags] = useState<FlagRow[]>([])
  const load = () => api<FlagRow[]>(`/monitor/flags${channelId ? `?channelId=${channelId}` : ''}`).then(setFlags)
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])
  useSocketEvent('monitor:changed', () => void load())

  async function review(id: number) {
    await api(`/monitor/flags/${id}/review`, { method: 'POST' })
    void load()
  }

  const list = (
    <div className="flag-list">
      {!flags.length && (
        <div className="muted small pad">
          <CheckCircle2 size={14} className="inline-icon" /> Không có tin cần chú ý.
        </div>
      )}
      {flags.map((f) => (
        <div key={f.id} className="flag-item">
          <div className="row wrap">
            <Badge tone={f.severity === 'medium' ? 'warning' : 'danger'}>
              {f.source === 'ai' ? <Sparkles size={12} /> : <AlertTriangle size={12} />} {f.reason}
            </Badge>
            <span className="small muted grow">
              {!compact && `${f.channel_name} · `}
              {f.conversation_name ?? 'Khách'} · {fullTime(f.created_at)}
            </span>
          </div>
          <div className={`flag-text ${f.direction}`}>
            <b>{f.direction === 'out' ? 'Nhân viên' : 'Khách'}:</b> {f.text}
          </div>
          {f.detail && <div className="small flag-detail">{f.detail}</div>}
          <div className="row">
            <a className="btn ghost sm" href={`#/monitor/${f.channel_id}/${encodeURIComponent(f.conversation_id)}`}>
              <Eye size={14} /> Xem hội thoại
            </a>
            <button className="btn outline sm" onClick={() => review(f.id)}>
              Đã xem, bình thường
            </button>
          </div>
        </div>
      ))}
    </div>
  )
  if (compact) return list
  return (
    <section className="monitor-flags">
      <h2>Tin cần chú ý</h2>
      <p className="muted small">
        Tin có dấu hiệu đáng ngờ do AI phát hiện (biểu tượng lấp lánh) hoặc do quy tắc: từ khóa, số điện thoại khác, số tài khoản. Chỉnh ở Cài đặt › Zalo nhân viên.
      </p>
      {list}
    </section>
  )
}
