import { useEffect, useState } from 'react'
import { Download, FileJson, FileSpreadsheet, FileText, MessageCircleReply } from 'lucide-react'
import { api, exportUrl } from '../api'
import { useApp } from '../store'
import { Empty } from '../components'
import { duration, isoDate } from '../util'

type AgentStat = {
  agent_id: number | null
  agent_name: string
  messages_sent: number
  conversations: number
  responses: number
  avg_response_sec: number | null
  median_response_sec: number | null
  within_5min_pct: number | null
  review_avg: number | null
  review_count: number
}
type Stats = { customer_messages: number; conversations_active: number; waiting_reply: number; agents: AgentStat[] }

export default function Reports() {
  const { user, users, channels, departments } = useApp()
  const [channelId, setChannelId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const isAdmin = user.role === 'admin'
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 6 * 86400000)
  const [from, setFrom] = useState(isoDate(weekAgo))
  const [to, setTo] = useState(isoDate(today))
  const [stats, setStats] = useState<Stats | null>(null)
  const [agentId, setAgentId] = useState<string>(isAdmin ? '' : String(user.id))
  const [textOnly, setTextOnly] = useState(true)

  useEffect(() => {
    if (!isAdmin) return
    setStats(null)
    const extra = `${channelId ? `&channelId=${channelId}` : ''}${departmentId ? `&departmentId=${departmentId}` : ''}`
    api<Stats>(`/stats?from=${from}&to=${to}${extra}`).then(setStats)
  }, [from, to, isAdmin, channelId, departmentId])

  const link = (format: string) =>
    exportUrl({
      format,
      from,
      to,
      agentId: agentId || undefined,
      channelId: channelId || undefined,
      departmentId: departmentId || undefined,
      textOnly: textOnly ? '1' : undefined,
    })

  const presets: [string, number][] = [
    ['Hôm nay', 0],
    ['7 ngày', 6],
    ['30 ngày', 29],
    ['90 ngày', 89],
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dữ liệu</h1>
          <p className="muted">
            Theo dõi hiệu suất từng nhân viên và xuất dữ liệu hội thoại để đào tạo kỹ năng tư vấn.
          </p>
        </div>
        <div className="row wrap">
          {presets.map(([label, days]) => (
            <button
              key={label}
              className="btn ghost sm"
              onClick={() => {
                setFrom(isoDate(new Date(Date.now() - days * 86400000)))
                setTo(isoDate(new Date()))
              }}
            >
              {label}
            </button>
          ))}
          <input type="date" className="input sm" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Từ ngày" />
          <span className="muted">→</span>
          <input type="date" className="input sm" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Đến ngày" />
          {channels.length > 1 && (
            <select className="select sm" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Kênh">
              <option value="">Mọi kênh</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {isAdmin && departments.length > 0 && (
            <select className="select sm" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Bộ phận">
              <option value="">Mọi bộ phận</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="kpis">
            <Kpi label="Hội thoại có tin nhắn" value={stats?.conversations_active} />
            <Kpi label="Tin nhắn từ khách" value={stats?.customer_messages} />
            <Kpi label="Đang chờ shop trả lời" value={stats?.waiting_reply} tone={stats?.waiting_reply ? 'warn' : undefined} />
            <Kpi label="Nhân viên đã trả lời" value={stats?.agents.filter((a) => a.agent_id).length} />
          </div>

          <div className="card">
            <h3>Hiệu suất theo nhân viên</h3>
            {!stats ? (
              <div className="muted pad">Đang tính…</div>
            ) : !stats.agents.length ? (
              <Empty title="Chưa có dữ liệu trong khoảng thời gian này" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nhân viên</th>
                      <th className="num">Hội thoại</th>
                      <th className="num">Tin đã gửi</th>
                      <th className="num">Lượt phản hồi</th>
                      <th className="num">Phản hồi TB</th>
                      <th className="num">Trung vị</th>
                      <th className="num">Trong 5 phút</th>
                      <th className="num">Điểm đánh giá</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {stats.agents.map((a) => (
                      <tr key={a.agent_id ?? a.agent_name}>
                        <td className={a.agent_id ? '' : 'muted'}>{a.agent_name}</td>
                        <td className="num">{a.conversations}</td>
                        <td className="num">{a.messages_sent}</td>
                        <td className="num">{a.responses}</td>
                        <td className="num">{duration(a.avg_response_sec)}</td>
                        <td className="num">{duration(a.median_response_sec)}</td>
                        <td className="num">
                          {a.within_5min_pct === null ? '—' : <Pct value={a.within_5min_pct} />}
                        </td>
                        <td className="num">{a.review_avg ? `${a.review_avg}/5 (${a.review_count})` : '—'}</td>
                        <td>
                          {a.agent_id && (
                            <a
                              className="btn ghost sm"
                              href={exportUrl({ format: 'txt', from, to, agentId: a.agent_id, textOnly: '1' })}
                              title="Tải toàn bộ hội thoại nhân viên này đã tham gia"
                            >
                              <Download size={14} /> Hội thoại
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">
              "Phản hồi" = thời gian từ tin đầu tiên khách nhắn (chưa được trả lời) tới khi shop trả lời. Tin gửi trực tiếp
              từ điện thoại không gắn được tên nhân viên — nên khuyến khích mọi người trả lời qua app này.
            </p>
          </div>
        </>
      )}

      <div className="card">
        <h3>Xuất dữ liệu hội thoại</h3>
        <div className="export-form">
          {isAdmin && (
            <label className="field">
              <span>Nhân viên</span>
              <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Tất cả nhân viên</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} />
            Chỉ lấy tin nhắn chữ (bỏ sticker, ảnh, file)
          </label>
        </div>
        <div className="export-grid">
          <ExportCard
            href={link('txt')}
            icon={<FileText size={22} />}
            title="Kịch bản đọc (TXT)"
            desc="Hội thoại dạng đối thoại kèm tên nhân viên, ghi chú và đánh giá. Phù hợp để in ra hoặc đưa vào buổi training."
          />
          <ExportCard
            href={link('csv')}
            icon={<FileSpreadsheet size={22} />}
            title="Bảng tính (CSV)"
            desc="Mỗi dòng một tin nhắn: thời gian, vai trò, nhân viên, nội dung. Mở bằng Excel/Google Sheets để lọc, chấm điểm."
          />
          <ExportCard
            href={link('jsonl')}
            icon={<MessageCircleReply size={22} />}
            title="Dữ liệu AI (JSONL)"
            desc="Mỗi dòng một hội thoại dạng user/assistant. Dùng để huấn luyện chatbot hoặc làm bộ mẫu câu tư vấn."
          />
          <ExportCard
            href={link('json')}
            icon={<FileJson size={22} />}
            title="Đầy đủ (JSON)"
            desc="Toàn bộ dữ liệu có cấu trúc: hội thoại, tin nhắn, nhãn, ghi chú, đánh giá. Dùng cho web app khác."
          />
        </div>
      </div>

    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number | undefined; tone?: string }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-value">{value ?? '—'}</div>
      <div className="kpi-label">{label}</div>
    </div>
  )
}

function Pct({ value }: { value: number }) {
  return (
    <span className="pct">
      <span className="pct-bar">
        <span style={{ width: `${value}%` }} />
      </span>
      {value}%
    </span>
  )
}

function ExportCard({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <a className="export-card" href={href}>
      <span className="export-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <small>{desc}</small>
      </span>
      <Download size={18} className="export-dl" />
    </a>
  )
}
