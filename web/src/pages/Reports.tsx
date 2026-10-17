import { useEffect, useState } from 'react'
import { BarChart3, ClipboardList, Download, ExternalLink, Eye, FileJson, FileSpreadsheet, FileText, MessageCircleReply, Users as UsersIcon } from 'lucide-react'
import { api, exportUrl } from '../api'
import { useApp } from '../store'
import { Empty } from '../components'
import { duration, isoDate } from '../util'
import { can } from '../perm'
import { PLATFORM_LABEL } from '../platform'
import type { Platform } from '../types'
import { BarChart, CHART_COLORS, Donut, HBars, Heatmap, Legend, LineChart } from '../charts'
import { ISSUE_LABEL } from './monitor-ai'

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
type Overview = {
  days: { day: string; msg_in: number; msg_out: number; customers: number; new_conversations: number; responses: number; avg_response_sec: number | null; within5_pct: number | null; alerts: number; orders: number; order_total: number }[]
  totals: { msg_in: number; msg_out: number; customers: number; new_conversations: number; avg_response_sec: number | null; within5_pct: number | null; alerts: number; alerts_resolved: number; orders: number; order_total: number }
  heat: number[][]
  channels: { id: number; name: string; platform: string; msg_in: number; msg_out: number; conversations: number }[]
  tags: { name: string; n: number; color: string | null }[]
  alerts: { type: string; created: number; resolved: number; avg_resolve_sec: number | null }[]
  order_sources: { source: string; n: number; total: number }[]
}
type MonitorDash = {
  days: { day: string; msg_in: number; msg_out: number; undone: number; flags_rule: number; flags_ai: number }[]
  staff: { channel_id: number; name: string; phone: string | null; customers: number; msg_in: number; msg_out: number; undone: number; flags_rule: number; flags_ai: number; flags_high: number; ai_score: number | null; ai_rated: number; risk_high: number }[]
  risk: { risk: string; n: number }[]
  outcomes: { outcome: string; label: string; n: number }[]
  issue_types: { type: string; n: number }[]
}

export type ReportTab = 'overview' | 'staff' | 'monitor' | 'export'
const ALERT_LABEL: Record<string, string> = { no_reply: 'Chưa phản hồi', no_order: 'Chưa tạo đơn', no_shipping: 'Chưa đẩy vận chuyển' }
const SOURCE_LABEL: Record<string, string> = { odoo_pos: 'POS Odoo (lên từ chat)', sapo: 'Sapo', api: 'Web / API' }
const money = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr₫` : `${n.toLocaleString('vi-VN')}₫`)
const C = { green: CHART_COLORS[0], lime: CHART_COLORS[1], blue: CHART_COLORS[2], amber: CHART_COLORS[3], violet: CHART_COLORS[4], red: CHART_COLORS[5] }

/** Mục Báo cáo: biểu đồ tổng quan, hiệu suất nhân viên, giám sát Zalo nhân viên, xuất dữ liệu / báo cáo. */
export default function Reports({ tab: linkTab }: { tab?: string | null }) {
  const { user, channels, departments } = useApp()
  const canView = can(user, 'data.view')
  const canExport = can(user, 'data.export')
  const canMonitor = can(user, 'monitor.view')
  const tabs: { id: ReportTab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'overview', label: 'Tổng quan', icon: <BarChart3 size={16} />, show: canView },
    { id: 'staff', label: 'Nhân viên', icon: <UsersIcon size={16} />, show: canView },
    { id: 'monitor', label: 'Giám sát', icon: <Eye size={16} />, show: canMonitor },
    { id: 'export', label: 'Xuất dữ liệu & báo cáo', icon: <Download size={16} />, show: canExport || canMonitor },
  ]
  const visible = tabs.filter((t) => t.show)
  const tab: ReportTab = visible.find((t) => t.id === linkTab)?.id ?? visible[0]?.id ?? 'export'
  const go = (t: ReportTab) => {
    window.location.hash = `#/data/${t}`
  }

  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(isoDate(new Date()))
  const [channelId, setChannelId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const sharedChannels = channels.filter((c) => c.mode !== 'monitor')
  const presets: [string, number][] = [
    ['Hôm nay', 0],
    ['7 ngày', 6],
    ['30 ngày', 29],
    ['90 ngày', 89],
  ]

  return (
    <div className="page reports">
      <div className="page-head">
        <div>
          <h1>Báo cáo</h1>
          <p className="muted">Biểu đồ hoạt động chat, hiệu suất nhân viên, giám sát Zalo nhân viên và xuất dữ liệu / báo cáo Excel ở một chỗ.</p>
        </div>
      </div>
      <div className="report-tabs seg" role="tablist">
        {visible.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="report-filters row wrap">
        {presets.map(([label, days]) => {
          const a = isoDate(new Date(Date.now() - days * 86400000))
          const on = from === a && to === isoDate(new Date())
          return (
            <button key={label} className={`btn ${on ? 'primary' : 'ghost'} sm`} onClick={() => (setFrom(a), setTo(isoDate(new Date())))}>
              {label}
            </button>
          )
        })}
        <input type="date" className="input sm" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Từ ngày" />
        <span className="muted">→</span>
        <input type="date" className="input sm" value={to} min={from} max={isoDate(new Date())} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Đến ngày" />
        {tab !== 'monitor' && sharedChannels.length > 1 && (
          <select className="select sm" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Kênh">
            <option value="">Mọi kênh</option>
            {sharedChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {tab !== 'monitor' && canView && departments.length > 0 && (
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
      {tab === 'overview' && <OverviewTab from={from} to={to} channelId={channelId} departmentId={departmentId} />}
      {tab === 'staff' && <StaffTab from={from} to={to} channelId={channelId} departmentId={departmentId} />}
      {tab === 'monitor' && <MonitorTab from={from} to={to} />}
      {tab === 'export' && <ExportTab from={from} to={to} channelId={channelId} departmentId={departmentId} />}
    </div>
  )
}

type RangeProps = { from: string; to: string; channelId?: string; departmentId?: string }
const qs = (p: RangeProps) => `from=${p.from}&to=${p.to}${p.channelId ? `&channelId=${p.channelId}` : ''}${p.departmentId ? `&departmentId=${p.departmentId}` : ''}`

function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!path) return
    let alive = true
    setData(null)
    setError('')
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [path])
  return { data, error }
}

function Panel({ title, sub, children, wide }: { title: string; sub?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`card chart-card ${wide ? 'wide' : ''}`}>
      <div className="chart-head">
        <h3>{title}</h3>
        {sub && <span className="small muted">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-value">{value ?? '—'}</div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  )
}

// ───────── Tổng quan ─────────
function OverviewTab(p: RangeProps) {
  const { data: d, error } = useData<Overview>(`/reports/overview?${qs(p)}`)
  if (error) return <div className="banner warn inline">{error}</div>
  if (!d) return <div className="muted pad">Đang tính…</div>
  const labels = d.days.map((x) => x.day)
  const t = d.totals
  return (
    <>
      <div className="kpis">
        <Kpi label="Khách nhắn" value={t.customers.toLocaleString('vi-VN')} hint={`${t.new_conversations} hội thoại mới`} />
        <Kpi label="Tin khách nhắn" value={t.msg_in.toLocaleString('vi-VN')} hint={`${t.msg_out.toLocaleString('vi-VN')} tin shop trả lời`} />
        <Kpi label="Phản hồi trung bình" value={duration(t.avg_response_sec)} hint={t.within5_pct != null ? `${t.within5_pct}% trả lời trong 5 phút` : undefined} tone={t.avg_response_sec != null && t.avg_response_sec > 600 ? 'warn' : undefined} />
        <Kpi label='Cảnh báo đơn "rơi"' value={`${t.alerts_resolved}/${t.alerts}`} hint="đã xử lý / phát sinh" tone={t.alerts - t.alerts_resolved > 0 ? 'warn' : undefined} />
        <Kpi label="Đơn hàng gắn hội thoại" value={t.orders.toLocaleString('vi-VN')} hint={t.order_total ? money(t.order_total) : undefined} />
      </div>
      <div className="chart-grid">
        <Panel title="Tin nhắn theo ngày" wide>
          <Legend items={[{ label: 'Tin khách', color: C.green }, { label: 'Tin shop trả lời', color: C.blue }]} />
          <LineChart labels={labels} series={[{ label: 'Tin khách', color: C.green, values: d.days.map((x) => x.msg_in), area: true }, { label: 'Tin shop', color: C.blue, values: d.days.map((x) => x.msg_out) }]} />
        </Panel>
        <Panel title="Khách nhắn mỗi ngày" sub="khách mới / khách cũ quay lại">
          <Legend items={[{ label: 'Khách mới', color: C.lime }, { label: 'Khách cũ quay lại', color: C.green }]} />
          <BarChart labels={labels} series={[{ label: 'Khách mới', color: C.lime, values: d.days.map((x) => Math.min(x.customers, x.new_conversations)) }, { label: 'Khách cũ quay lại', color: C.green, values: d.days.map((x) => x.customers - Math.min(x.customers, x.new_conversations)) }]} />
        </Panel>
        <Panel title="Thời gian phản hồi" sub="trung bình mỗi ngày (phút)">
          <Legend items={[{ label: 'Phản hồi TB (phút)', color: C.amber }, { label: '% trả lời ≤ 5 phút', color: C.green, dashed: true }]} />
          <LineChart
            labels={labels}
            series={[
              { label: 'Phản hồi TB (phút)', color: C.amber, values: d.days.map((x) => (x.avg_response_sec == null ? null : Math.round((x.avg_response_sec / 60) * 10) / 10)) },
              { label: '% ≤ 5 phút', color: C.green, values: d.days.map((x) => x.within5_pct), dashed: true },
            ]}
          />
        </Panel>
        <Panel title="Giờ cao điểm khách nhắn" sub="để xếp ca trực" wide>
          <Heatmap data={d.heat} />
        </Panel>
        <Panel title="Theo kênh">
          <HBars
            items={d.channels.map((c, i) => ({
              label: (
                <>
                  {c.name} <span className="muted small">· {PLATFORM_LABEL[c.platform as Platform] ?? c.platform}</span>
                </>
              ),
              value: c.msg_in + c.msg_out,
              color: CHART_COLORS[i % CHART_COLORS.length],
              sub: `${c.conversations} hội thoại · ${c.msg_in} tin khách · ${c.msg_out} tin shop`,
            }))}
          />
        </Panel>
        <Panel title="Tag hội thoại" sub="hội thoại có tin trong kỳ">
          <HBars items={d.tags.map((x) => ({ label: x.name, value: x.n, color: x.color ?? C.lime }))} empty="Chưa có hội thoại nào gắn tag" />
        </Panel>
        <Panel title='Cảnh báo đơn "rơi"'>
          <HBars
            items={d.alerts.map((a) => ({
              label: ALERT_LABEL[a.type] ?? a.type,
              value: a.created,
              color: C.amber,
              sub: `đã xử lý ${a.resolved}/${a.created}${a.avg_resolve_sec != null ? ` · xử lý TB ${duration(a.avg_resolve_sec)}` : ''}`,
            }))}
            empty='Không có cảnh báo đơn "rơi" trong kỳ'
          />
        </Panel>
        <Panel title="Đơn hàng theo ngày">
          <BarChart labels={labels} series={[{ label: 'Đơn', color: C.violet, values: d.days.map((x) => x.orders) }]} empty="Chưa có đơn gắn với hội thoại" />
          {d.order_sources.length > 0 && (
            <HBars items={d.order_sources.map((s, i) => ({ label: SOURCE_LABEL[s.source] ?? s.source, value: s.n, color: CHART_COLORS[(i + 4) % CHART_COLORS.length], sub: s.total ? money(s.total) : undefined }))} />
          )}
        </Panel>
      </div>
      <p className="muted small">Không gồm Zalo nhân viên đang giám sát (xem ở tab Giám sát). Giờ theo giờ Việt Nam.</p>
    </>
  )
}

// ───────── Nhân viên ─────────
function StaffTab(p: RangeProps) {
  const { data: stats, error } = useData<Stats>(`/stats?${qs(p)}`)
  if (error) return <div className="banner warn inline">{error}</div>
  if (!stats) return <div className="muted pad">Đang tính…</div>
  const named = stats.agents.filter((a) => a.agent_id)
  return (
    <>
      <div className="kpis">
        <Kpi label="Hội thoại có tin nhắn" value={stats.conversations_active} />
        <Kpi label="Tin nhắn từ khách" value={stats.customer_messages} />
        <Kpi label="Đang chờ shop trả lời" value={stats.waiting_reply} tone={stats.waiting_reply ? 'warn' : undefined} />
        <Kpi label="Nhân viên đã trả lời" value={named.length} />
      </div>
      <div className="chart-grid">
        <Panel title="Tin đã gửi theo nhân viên">
          <HBars items={stats.agents.map((a, i) => ({ label: a.agent_name, value: a.messages_sent, color: a.agent_id ? CHART_COLORS[i % CHART_COLORS.length] : 'var(--mz-ink-300)', sub: `${a.conversations} hội thoại` }))} />
        </Panel>
        <Panel title="Phản hồi trung bình" sub="càng ngắn càng tốt">
          <HBars
            items={named
              .filter((a) => a.avg_response_sec != null)
              .sort((a, b) => (a.avg_response_sec ?? 0) - (b.avg_response_sec ?? 0))
              .map((a) => ({ label: a.agent_name, value: a.avg_response_sec ?? 0, color: (a.avg_response_sec ?? 0) > 600 ? C.amber : C.green, sub: a.within_5min_pct != null ? `${a.within_5min_pct}% trong 5 phút` : undefined }))}
            format={(n) => duration(n)}
          />
        </Panel>
      </div>
      <div className="card">
        <h3>Hiệu suất theo nhân viên</h3>
        {!stats.agents.length ? (
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
                    <td className="num">{a.within_5min_pct === null ? '—' : <Pct value={a.within_5min_pct} />}</td>
                    <td className="num">{a.review_avg ? `${a.review_avg}/5 (${a.review_count})` : '—'}</td>
                    <td>
                      {a.agent_id && (
                        <a className="btn ghost sm" href={exportUrl({ format: 'txt', from: p.from, to: p.to, agentId: a.agent_id, textOnly: '1' })} title="Tải toàn bộ hội thoại nhân viên này đã tham gia">
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
          "Phản hồi" = thời gian từ tin đầu tiên khách nhắn (chưa được trả lời) tới khi shop trả lời. Tin gửi trực tiếp từ điện thoại không gắn được tên nhân viên — nên khuyến khích mọi người trả lời qua app này.
        </p>
      </div>
    </>
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

// ───────── Giám sát ─────────
const RISK_UI: Record<string, { label: string; color: string }> = {
  none: { label: 'Bình thường', color: C.green },
  low: { label: 'Rủi ro thấp', color: C.blue },
  medium: { label: 'Cần xem', color: C.amber },
  high: { label: 'Rủi ro cao', color: C.red },
}
function MonitorTab(p: RangeProps) {
  const { data: d, error } = useData<MonitorDash>(`/reports/monitor?from=${p.from}&to=${p.to}`)
  if (error) return <div className="banner warn inline">{error}</div>
  if (!d) return <div className="muted pad">Đang tính…</div>
  const labels = d.days.map((x) => x.day)
  const sum = (k: keyof MonitorDash['staff'][number]) => d.staff.reduce((s, x) => s + (Number(x[k]) || 0), 0)
  const rated = d.staff.filter((s) => s.ai_score != null)
  return (
    <>
      <div className="row wrap report-actions">
        <span className="grow muted small">Zalo nhân viên trên SIM công ty cấp. Chi tiết từng hội thoại ở trang Giám sát.</span>
        <a className="btn outline sm" href="#/monitor">
          <Eye size={14} /> Mở trang Giám sát
        </a>
        <a className="btn primary sm" href={`/api/monitor/report.xlsx?from=${p.from}&to=${p.to}`}>
          <FileSpreadsheet size={14} /> Xuất báo cáo giám sát (Excel)
        </a>
      </div>
      {!d.staff.length ? (
        <Empty title="Chưa có Zalo nhân viên nào được giám sát">Thêm ở Cài đặt › Zalo nhân viên (giám sát).</Empty>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Khách đã chat" value={sum('customers')} />
            <Kpi label="Tin khách nhắn" value={sum('msg_in')} hint={`${sum('msg_out')} tin nhân viên gửi`} />
            <Kpi label="Tin nhân viên thu hồi" value={sum('undone')} tone={sum('undone') ? 'warn' : undefined} />
            <Kpi label="Tin cần chú ý" value={sum('flags_ai') + sum('flags_rule')} hint={`AI ${sum('flags_ai')} · quy tắc ${sum('flags_rule')}`} tone={sum('flags_high') ? 'warn' : undefined} />
            <Kpi label="Điểm tư vấn TB (AI)" value={rated.length ? (rated.reduce((s, x) => s + (x.ai_score ?? 0), 0) / rated.length).toFixed(1) + '/10' : '—'} />
          </div>
          <div className="chart-grid">
            <Panel title="Tin nhắn theo ngày" wide>
              <Legend items={[{ label: 'Tin khách', color: C.green }, { label: 'Tin nhân viên', color: C.blue }, { label: 'Tin NV thu hồi', color: C.red }]} />
              <LineChart
                labels={labels}
                series={[
                  { label: 'Tin khách', color: C.green, values: d.days.map((x) => x.msg_in), area: true },
                  { label: 'Tin nhân viên', color: C.blue, values: d.days.map((x) => x.msg_out) },
                  { label: 'Thu hồi', color: C.red, values: d.days.map((x) => x.undone) },
                ]}
              />
            </Panel>
            <Panel title="Tin cần chú ý theo ngày">
              <Legend items={[{ label: 'AI phát hiện', color: C.violet }, { label: 'Quy tắc / từ khóa', color: C.amber }]} />
              <BarChart labels={labels} series={[{ label: 'AI', color: C.violet, values: d.days.map((x) => x.flags_ai) }, { label: 'Quy tắc', color: C.amber, values: d.days.map((x) => x.flags_rule) }]} empty="Không có tin cần chú ý" />
            </Panel>
            <Panel title="Mức rủi ro (AI chấm)" sub="theo hội thoại">
              <Donut items={d.risk.map((r) => ({ label: RISK_UI[r.risk].label, value: r.n, color: RISK_UI[r.risk].color }))} center="hội thoại" />
            </Panel>
            <Panel title="Loại vấn đề AI phát hiện">
              <HBars items={d.issue_types.map((i) => ({ label: ISSUE_LABEL[i.type] ?? i.type, value: i.n, color: C.red }))} empty="Chưa có vấn đề nào (hoặc chưa bật Trợ lý AI)" />
            </Panel>
            <Panel title="Kết quả hội thoại (AI)">
              <HBars items={d.outcomes.map((o, i) => ({ label: o.label, value: o.n, color: CHART_COLORS[i % CHART_COLORS.length] }))} empty="Chưa có hội thoại được AI chấm" />
            </Panel>
          </div>
          <div className="card">
            <h3>Theo nhân viên</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nhân viên</th>
                    <th className="num">Khách</th>
                    <th className="num">Tin khách</th>
                    <th className="num">Tin NV</th>
                    <th className="num">Thu hồi</th>
                    <th className="num">Cờ AI</th>
                    <th className="num">Cờ quy tắc</th>
                    <th className="num">Rủi ro cao</th>
                    <th className="num">Điểm AI</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.staff.map((s) => (
                    <tr key={s.channel_id}>
                      <td>
                        {s.name}
                        {s.phone && <span className="small muted"> · {s.phone}</span>}
                      </td>
                      <td className="num">{s.customers}</td>
                      <td className="num">{s.msg_in}</td>
                      <td className="num">{s.msg_out}</td>
                      <td className={`num ${s.undone ? 'warn-text' : ''}`}>{s.undone}</td>
                      <td className="num">{s.flags_ai}</td>
                      <td className="num">{s.flags_rule}</td>
                      <td className={`num ${s.risk_high ? 'err-text' : ''}`}>{s.risk_high}</td>
                      <td className="num">{s.ai_score != null ? `${s.ai_score}/10` : '—'}</td>
                      <td className="right nowrap">
                        <a className="btn ghost sm" href={`#/monitor/${s.channel_id}`}>
                          Xem
                        </a>
                        <a className="btn ghost sm" href={`/api/monitor/report.xlsx?from=${p.from}&to=${p.to}&channelId=${s.channel_id}`} title="Xuất báo cáo Excel riêng nhân viên này">
                          <FileSpreadsheet size={14} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ───────── Xuất dữ liệu & báo cáo ─────────
function ExportTab(p: RangeProps) {
  const { user, users } = useApp()
  const canView = can(user, 'data.view')
  const canExport = can(user, 'data.export')
  const canMonitor = can(user, 'monitor.view')
  const [agentId, setAgentId] = useState<string>(canView ? '' : String(user.id))
  const [textOnly, setTextOnly] = useState(true)
  const [reportApp, setReportApp] = useState<string | null>(null)
  useEffect(() => {
    api<{ enabled: boolean; url: string | null }>('/report-link/status')
      .then((r) => setReportApp(r.enabled ? r.url : null))
      .catch(() => {})
  }, [])
  const link = (format: string) =>
    exportUrl({ format, from: p.from, to: p.to, agentId: agentId || undefined, channelId: p.channelId || undefined, departmentId: p.departmentId || undefined, textOnly: textOnly ? '1' : undefined })
  return (
    <>
      {(canMonitor || reportApp) && (
        <div className="card">
          <h3>Báo cáo</h3>
          <div className="export-grid">
            {canMonitor && (
              <ExportCard
                href={`/api/monitor/report.xlsx?from=${p.from}&to=${p.to}`}
                icon={<FileSpreadsheet size={22} />}
                title="Báo cáo giám sát (Excel)"
                desc="Zalo nhân viên: tổng hợp theo ngày, tin cần chú ý, từng hội thoại kèm điểm và tóm tắt AI. Theo khoảng ngày đang chọn."
              />
            )}
            {reportApp && (
              <a className="export-card" href="#/sso/baocao" target="_blank" rel="noopener">
                <span className="export-icon">
                  <ClipboardList size={22} />
                </span>
                <span>
                  <b>Báo cáo công việc CSKH</b>
                  <small>Báo cáo ngày của từng nhân viên (số liệu chat tự điền), duyệt và tổng hợp tuần / tháng. Mở app báo cáo, không cần đăng nhập lại.</small>
                </span>
                <ExternalLink size={18} className="export-dl" />
              </a>
            )}
          </div>
        </div>
      )}
      {canExport && (
        <div className="card">
          <h3>Xuất dữ liệu hội thoại</h3>
          <div className="export-form">
            {canView && (
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
            <ExportCard href={link('txt')} icon={<FileText size={22} />} title="Kịch bản đọc (TXT)" desc="Hội thoại dạng đối thoại kèm tên nhân viên, ghi chú và đánh giá. Phù hợp để in ra hoặc đưa vào buổi training." />
            <ExportCard href={link('csv')} icon={<FileSpreadsheet size={22} />} title="Bảng tính (CSV)" desc="Mỗi dòng một tin nhắn: thời gian, vai trò, nhân viên, nội dung. Mở bằng Excel/Google Sheets để lọc, chấm điểm." />
            <ExportCard href={link('jsonl')} icon={<MessageCircleReply size={22} />} title="Dữ liệu AI (JSONL)" desc="Mỗi dòng một hội thoại dạng user/assistant. Dùng để huấn luyện chatbot hoặc làm bộ mẫu câu tư vấn." />
            <ExportCard href={link('json')} icon={<FileJson size={22} />} title="Đầy đủ (JSON)" desc="Toàn bộ dữ liệu có cấu trúc: hội thoại, tin nhắn, nhãn, ghi chú, đánh giá. Dùng cho web app khác." />
          </div>
        </div>
      )}
    </>
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
