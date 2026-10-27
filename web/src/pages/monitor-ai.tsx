import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, FileSpreadsheet, PlugZap, RefreshCw, Save, Sparkles, ThumbsUp } from 'lucide-react'
import { api, openAuthedLink } from '../api'
import { useSocketEvent } from '../store'
import { Badge, Modal } from '../components'
import { fullTime } from '../util'

export type Analysis = {
  conversation_id: string
  analyzed_at: number
  risk: 'none' | 'low' | 'medium' | 'high'
  summary: string
  customer_need: string | null
  outcome_label: string
  quality_score: number | null
  issues: { type: string; severity: 'low' | 'medium' | 'high'; message_id: number | null; quote: string; explanation: string }[]
  good_points: string[]
  model: string
}
type Digest = {
  date: string
  created_at: number
  model: string
  overview: string
  score: number | null
  concerns: { title: string; severity: 'low' | 'medium' | 'high'; customer: string | null; detail: string }[]
  highlights: string[]
  coaching: string[]
  stats: { customers: number; msg_in: number; msg_out: number; undone: number }
}

export const ISSUE_LABEL: Record<string, string> = {
  chuyen_khoan_rieng: 'Thu tiền / chuyển khoản riêng',
  keo_khach_ra_ngoai: 'Kéo khách ra ngoài',
  gia_rieng: 'Giá ngoài chính sách',
  thai_do: 'Thái độ',
  sai_thong_tin: 'Thông tin / cam kết sai',
  lo_thong_tin: 'Lộ thông tin',
  bo_lo_khach: 'Bỏ lỡ / để khách chờ',
  thu_hoi_dang_ngo: 'Thu hồi tin đáng ngờ',
  khac: 'Khác',
}
export const RISK: Record<string, { label: string; tone: string }> = {
  none: { label: 'Bình thường', tone: 'green' },
  low: { label: 'Rủi ro thấp', tone: 'info' },
  medium: { label: 'Cần xem', tone: 'warning' },
  high: { label: 'Rủi ro cao', tone: 'danger' },
}
const SEV: Record<string, { label: string; tone: string }> = {
  low: { label: 'Nhỏ', tone: 'info' },
  medium: { label: 'Vừa', tone: 'warning' },
  high: { label: 'Cao', tone: 'danger' },
}

/** AI có đang bật không (người có quyền giám sát xem được). */
export function useAiStatus() {
  const [on, setOn] = useState<{ enabled: boolean; digestHour: number } | null>(null)
  useEffect(() => {
    api<{ enabled: boolean; digestHour: number }>('/ai/status')
      .then(setOn)
      .catch(() => setOn({ enabled: false, digestHour: 20 }))
  }, [])
  return on
}

/** Khung "Phân tích AI" phía trên đoạn chat giám sát. */
export function AiPanel({ convId, onJump }: { convId: string; onJump: (messageId: number) => void }) {
  const status = useAiStatus()
  const [a, setA] = useState<Analysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(true)
  const load = () =>
    api<Analysis | null>(`/monitor/conversations/${encodeURIComponent(convId)}/ai`)
      .then(setA)
      .catch(() => setA(null))
  useEffect(() => {
    setA(null)
    setErr('')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])
  useSocketEvent('monitor:changed', () => void load())

  if (!status?.enabled && !a) return null
  async function run() {
    setBusy(true)
    setErr('')
    try {
      setA(await api<Analysis>(`/monitor/conversations/${encodeURIComponent(convId)}/ai`, { method: 'POST' }))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const risk = a ? RISK[a.risk] : null
  return (
    <div className={`ai-panel ${a ? `risk-${a.risk}` : ''}`}>
      <div className="row wrap">
        <button className="ai-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Sparkles size={16} /> Phân tích AI
        </button>
        {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
        {a?.quality_score != null && <span className="small muted">Chất lượng tư vấn {a.quality_score}/10</span>}
        {a && <span className="small muted">· {a.outcome_label}</span>}
        <span className="grow" />
        {status?.enabled && (
          <button className="btn ghost sm" onClick={run} disabled={busy} title="Cho AI đọc lại toàn bộ hội thoại">
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Đang phân tích…' : a ? 'Phân tích lại' : 'Phân tích ngay'}
          </button>
        )}
      </div>
      {err && <div className="small err-text">{err}</div>}
      {!a && !busy && !err && <div className="small muted">Chưa phân tích. AI tự đọc khi hội thoại ngừng nhắn vài phút, hoặc bấm Phân tích ngay.</div>}
      {a && open && (
        <div className="ai-body">
          <p>{a.summary}</p>
          {a.customer_need && (
            <p className="small">
              <b>Khách cần:</b> {a.customer_need}
            </p>
          )}
          {a.issues.map((i, k) => (
            <div key={k} className={`ai-issue sev-${i.severity}`}>
              <div className="row wrap">
                <Badge tone={SEV[i.severity].tone}>
                  <AlertTriangle size={12} /> {ISSUE_LABEL[i.type] ?? i.type}
                </Badge>
                {i.message_id && (
                  <button className="link-btn small" onClick={() => onJump(i.message_id!)}>
                    Xem tin
                  </button>
                )}
              </div>
              {i.quote && <blockquote>{i.quote}</blockquote>}
              <span className="small">{i.explanation}</span>
            </div>
          ))}
          {a.good_points.length > 0 && (
            <div className="ai-good small">
              <ThumbsUp size={14} /> {a.good_points.join(' · ')}
            </div>
          )}
          <span className="small muted">
            AI chấm lúc {fullTime(a.analyzed_at)}. AI có thể nhầm, quản lý xem tin gốc trước khi kết luận.
          </span>
        </div>
      )}
    </div>
  )
}

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

/** Tab "Tổng hợp AI" của một nhân viên. */
export function DigestView({ channelId, holder }: { channelId: number; holder: string }) {
  const status = useAiStatus()
  const [date, setDate] = useState(vnToday())
  const [d, setD] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    setLoading(true)
    setErr('')
    api<Digest | null>(`/monitor/accounts/${channelId}/digest?date=${date}`)
      .then(setD)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [channelId, date])

  async function build() {
    setBusy(true)
    setErr('')
    try {
      setD(await api<Digest>(`/monitor/accounts/${channelId}/digest`, { body: { date } }))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="digest">
      <div className="row wrap">
        <input type="date" className="sm" value={date} max={vnToday()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Ngày tổng hợp" />
        <span className="grow" />
        {status?.enabled && (
          <button className="btn outline sm" onClick={build} disabled={busy}>
            <Bot size={14} /> {busy ? 'AI đang đọc…' : d ? 'Tổng hợp lại' : 'Tổng hợp ngay'}
          </button>
        )}
      </div>
      {err && <div className="small err-text">{err}</div>}
      {!status?.enabled && <div className="banner info inline small">Chưa bật Trợ lý AI. Bật ở Cài đặt › Zalo nhân viên (giám sát) › Trợ lý AI.</div>}
      {loading ? (
        <div className="muted small">Đang tải…</div>
      ) : !d ? (
        status?.enabled && (
          <div className="muted small">
            Chưa có bản tổng hợp ngày này. AI tự tổng hợp lúc {status.digestHour}:00 mỗi ngày, hoặc bấm Tổng hợp ngay.
          </div>
        )
      ) : (
        <div className="stack">
          <div className="row wrap">
            <h3 className="grow">
              {holder} · {d.date.split('-').reverse().join('/')}
            </h3>
            {d.score != null && <Badge tone={d.score >= 8 ? 'green' : d.score >= 5 ? 'info' : 'warning'}>{d.score}/10</Badge>}
          </div>
          <div className="small muted">
            {d.stats.customers} khách · {d.stats.msg_in} tin khách · {d.stats.msg_out} tin nhân viên{d.stats.undone ? ` · ${d.stats.undone} tin thu hồi` : ''}
          </div>
          <p>{d.overview}</p>
          {d.concerns.length > 0 && (
            <div className="stack-sm">
              <b className="small">Cần chú ý</b>
              {d.concerns.map((c, i) => (
                <div key={i} className={`ai-issue sev-${c.severity}`}>
                  <div className="row wrap">
                    <Badge tone={SEV[c.severity].tone}>{SEV[c.severity].label}</Badge>
                    <b className="small">{c.title}</b>
                    {c.customer && <span className="small muted">· {c.customer}</span>}
                  </div>
                  <span className="small">{c.detail}</span>
                </div>
              ))}
            </div>
          )}
          {d.highlights.length > 0 && (
            <div className="stack-sm">
              <b className="small">Làm tốt</b>
              <ul className="ai-list">{d.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </div>
          )}
          {d.coaching.length > 0 && (
            <div className="stack-sm">
              <b className="small">Góp ý huấn luyện</b>
              <ul className="ai-list">{d.coaching.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </div>
          )}
          <span className="small muted">Tổng hợp lúc {fullTime(d.created_at)}. AI có thể nhầm, đối chiếu tin gốc trước khi nhắc nhở nhân viên.</span>
        </div>
      )}
    </div>
  )
}

type Provider = 'anthropic' | 'xai'
type AiCfg = {
  enabled: boolean
  provider: Provider
  providers: Record<Provider, string>
  apiKey: string
  hasKey: boolean
  claudeKey: string
  xaiKey: string
  hasClaudeKey: boolean
  hasXaiKey: boolean
  modelsByProvider: Record<Provider, { id: string; label: string }[]>
  scanModel: string
  digestModel: string
  scanEveryMin: number
  quietMin: number
  digestHour: number
  maxCallsPerDay: number
  rules: string
  models: { id: string; label: string }[]
  usage: { calls: number; tokens_in: number; tokens_out: number }
}

/** Cài đặt › Zalo nhân viên › Trợ lý AI */
export function AiSettings() {
  const [cfg, setCfg] = useState<AiCfg | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [denied, setDenied] = useState(false)
  useEffect(() => {
    api<AiCfg>('/ai/config')
      .then(setCfg)
      .catch(() => setDenied(true))
  }, [])
  if (denied) return null
  if (!cfg) return null
  const set = (p: Partial<AiCfg>) => setCfg({ ...cfg, ...p })
  const pname = cfg.providers[cfg.provider]
  const models = cfg.modelsByProvider[cfg.provider]
  const hasKeyFor = cfg.provider === 'xai' ? cfg.hasXaiKey : cfg.hasClaudeKey
  const savedKey = cfg.provider === 'xai' ? cfg.xaiKey : cfg.claudeKey
  const modelSelect = (value: string, onChange: (v: string) => void) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {!models.some((m) => m.id === value) && <option value={value}>{models.length ? value : `${value} (lưu khóa để tải danh sách model)`}</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  )

  async function save(enabled?: boolean) {
    setBusy('save')
    setMsg(null)
    try {
      const c = await api<AiCfg>('/ai/config', {
        method: 'PUT',
        body: {
          provider: cfg!.provider,
          apiKey: key || undefined,
          scanModel: cfg!.scanModel,
          digestModel: cfg!.digestModel,
          scanEveryMin: cfg!.scanEveryMin,
          quietMin: cfg!.quietMin,
          digestHour: cfg!.digestHour,
          maxCallsPerDay: cfg!.maxCallsPerDay,
          rules: cfg!.rules,
          ...(enabled !== undefined ? { enabled } : {}),
        },
      })
      setCfg(c)
      setKey('')
      setMsg({ ok: true, text: enabled === undefined ? `Đã lưu (${c.providers[c.provider]})` : enabled ? 'Đã bật Trợ lý AI' : 'Đã tắt Trợ lý AI' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy('')
    }
  }
  async function test() {
    setBusy('test')
    setMsg(null)
    try {
      const r = await api<{ ok: boolean; ms: number; model: string; provider: string }>('/ai/test', { body: { provider: cfg!.provider, apiKey: key || undefined } })
      setMsg({ ok: true, text: `${r.provider} trả lời được (${r.ms} ms, ${r.model})` })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card stack">
      <div className="row wrap">
        <h3 className="grow">
          <Sparkles size={16} className="inline-icon" /> Trợ lý AI phân tích tin nhắn
        </h3>
        {cfg.enabled ? <Badge tone="green">Đang bật</Badge> : <Badge tone="warning">Chưa bật</Badge>}
      </div>
      <p className="small muted">
        AI đọc các hội thoại Zalo nhân viên có tin mới: tóm tắt, chấm chất lượng tư vấn, tìm dấu hiệu thu tiền riêng, kéo khách ra ngoài, giá
        ngoài chính sách, thái độ, thông tin sai, bỏ lỡ khách… Vấn đề mức vừa / cao hiện ở <b>Tin cần chú ý</b>. Cuối ngày AI viết bản tổng hợp cho từng
        nhân viên. Chỉ đọc hội thoại Zalo nhân viên đang giám sát; nội dung chat được gửi tới {pname} để phân tích. Chấm tư vấn
        theo kịch bản (Cài đặt › Chấm tư vấn) dùng chung khóa và giới hạn lượt ở đây.
      </p>
      <div className="grid-2">
        <label className="field">
          <span>Nhà cung cấp AI</span>
          <select
            className="select"
            value={cfg.provider}
            onChange={(e) => {
              const provider = e.target.value as Provider
              const list = cfg.modelsByProvider[provider]
              setKey('')
              set({ provider, scanModel: list[0]?.id ?? '', digestModel: list[list.length > 1 ? 1 : 0]?.id ?? '' })
            }}
          >
            {(Object.keys(cfg.providers) as Provider[]).map((p) => (
              <option key={p} value={p}>
                {cfg.providers[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Khóa API {pname}</span>
          <input
            name="ai-api-key"
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              hasKeyFor ? `Đã lưu (${savedKey}). Để trống nếu không đổi` : cfg.provider === 'xai' ? 'xai-… (console.x.ai › API Keys)' : 'sk-ant-… (console.anthropic.com › API Keys)'
            }
          />
        </label>
        <label className="field">
          <span>Giới hạn lượt gọi AI mỗi ngày</span>
          <input type="number" min={10} max={5000} value={cfg.maxCallsPerDay} onChange={(e) => set({ maxCallsPerDay: Number(e.target.value) })} />
          <span className="small muted">
            Hôm nay đã dùng {cfg.usage.calls} lượt · {Math.round((cfg.usage.tokens_in + cfg.usage.tokens_out) / 1000)}k token
          </span>
        </label>
        <label className="field">
          <span>AI quét từng hội thoại</span>
          {modelSelect(cfg.scanModel, (v) => set({ scanModel: v }))}
        </label>
        <label className="field">
          <span>AI viết tổng hợp cuối ngày</span>
          {modelSelect(cfg.digestModel, (v) => set({ digestModel: v }))}
        </label>
        <label className="field">
          <span>Quét mỗi (phút)</span>
          <input type="number" min={5} max={240} value={cfg.scanEveryMin} onChange={(e) => set({ scanEveryMin: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Giờ tổng hợp cuối ngày</span>
          <select className="select" value={cfg.digestHour} onChange={(e) => set({ digestHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Quy định riêng của công ty (AI chấm theo)</span>
        <textarea
          rows={4}
          value={cfg.rules}
          onChange={(e) => set({ rules: e.target.value })}
          placeholder={'VD:\n- Chỉ nhận chuyển khoản vào tài khoản Công ty CP Siêu Tốc, Vietcombank …\n- Giảm giá quá 5% phải có quản lý duyệt\n- Trả lời khách trong 5 phút giờ làm việc'}
        />
      </label>
      <div className="row wrap">
        <button className="btn outline" disabled={!!busy || (!hasKeyFor && !key)} onClick={test}>
          <PlugZap size={16} /> {busy === 'test' ? 'Đang thử…' : 'Thử kết nối AI'}
        </button>
        {msg && (
          <span className={`small ${msg.ok ? 'ok-text' : 'err-text'}`}>
            {msg.ok && <CheckCircle2 size={14} className="inline-icon" />} {msg.text}
          </span>
        )}
        <span className="grow" />
        <button className="btn outline" disabled={!!busy} onClick={() => save()}>
          <Save size={16} /> Lưu
        </button>
        {cfg.enabled ? (
          <button className="btn danger" disabled={!!busy} onClick={() => save(false)}>
            Tắt
          </button>
        ) : (
          <button className="btn primary" disabled={!!busy || (!hasKeyFor && !key)} onClick={() => save(true)}>
            Bật Trợ lý AI
          </button>
        )}
      </div>
    </div>
  )
}

/** Nút "Xuất báo cáo" trang Giám sát: Excel theo khoảng ngày, một hoặc mọi nhân viên. */
export function MonitorReportButton({ accounts, current }: { accounts: { channel_id: number; name: string; holder_name: string | null }[]; current: number | null }) {
  const [open, setOpen] = useState(false)
  const today = vnToday()
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [ch, setCh] = useState<string>(current ? String(current) : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setCh(current ? String(current) : ''), [current])

  async function download() {
    setErr('')
    if (!from || !to || from > to) return setErr('Chọn khoảng ngày hợp lệ')
    setBusy(true)
    try {
      await openAuthedLink(`/api/monitor/report.xlsx?from=${from}&to=${to}${ch ? `&channelId=${ch}` : ''}`)
      setOpen(false)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const quick: [string, string, string][] = [
    ['Hôm nay', today, today],
    ['7 ngày', new Date(Date.parse(today) - 6 * 864e5).toISOString().slice(0, 10), today],
    ['Tháng này', today.slice(0, 8) + '01', today],
  ]
  return (
    <>
      <button className="btn outline sm" onClick={() => setOpen(true)}>
        <FileSpreadsheet size={14} /> Xuất báo cáo
      </button>
      {open && (
        <Modal title="Xuất báo cáo giám sát" onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="small muted">
              File Excel gồm 3 trang: Tổng hợp theo ngày (số khách, tin, thu hồi, cờ, điểm và tổng hợp AI), Tin cần chú ý, Hội thoại (kết quả + tóm tắt AI).
            </p>
            <div className="row wrap">
              {quick.map(([l, a, b]) => (
                <button key={l} className={`btn ${from === a && to === b ? 'primary' : 'outline'} sm`} onClick={() => (setFrom(a), setTo(b))}>
                  {l}
                </button>
              ))}
            </div>
            <div className="grid-2">
              <label className="field">
                <span>Từ ngày</span>
                <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                <span>Đến ngày</span>
                <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Nhân viên</span>
              <select className="select" value={ch} onChange={(e) => setCh(e.target.value)}>
                <option value="">Tất cả nhân viên</option>
                {accounts.map((a) => (
                  <option key={a.channel_id} value={a.channel_id}>
                    {a.holder_name ?? a.name}
                  </option>
                ))}
              </select>
            </label>
            {err && <div className="form-error">{err}</div>}
            <div className="row end">
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Hủy
              </button>
              <button className="btn primary" onClick={download} disabled={busy}>
                <FileSpreadsheet size={16} /> {busy ? 'Đang tạo…' : 'Tải Excel'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
