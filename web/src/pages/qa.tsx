import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, CircleSlash, ExternalLink, FileSpreadsheet, MinusCircle, Plus, RefreshCw, Save, Sparkles, Trash2, XCircle } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { can } from '../perm'
import { Badge, Empty, Modal } from '../components'
import { fullTime } from '../util'
import { CHART_COLORS, HBars } from '../charts'

/** Chấm tư vấn theo kịch bản (AI): báo cáo trong mục Báo cáo, chi tiết từng phiên chat, cài đặt kịch bản. */

type Result = 'pass' | 'fail' | 'na' | 'skip'
type Step = { key: string; name: string; criteria: string; sample: string; when: 'always' | 'sale'; opening: boolean }
type QaCfg = {
  enabled: boolean
  steps: Step[]
  passPct: number
  improvePct: number
  quietMin: number
  gapHours: number
  notes: string
  version: number
  hasKey: boolean
  provider: string
  model: string
  maxCallsPerDay: number
}
type Report = {
  totals: { sessions: number; scored: number; avg: number | null; dat: number; cai_thien: number; chua_dat: number; no_reply: number; waiting_customer: number; outdated: number }
  steps: { key: string; name: string; pass: number; fail: number; na: number; skip: number; pct: number | null }[]
  agents: { agent_id: number | null; name: string; n: number; avg: number; dat: number; cai_thien: number; chua_dat: number }[]
  kinds: { key: string; label: string; n: number }[]
  skipped: { key: string; label: string; n: number }[]
  config: { enabled: boolean; hasKey: boolean; version: number; passPct: number; improvePct: number }
}
type Item = {
  conversation_id: string
  start_message_id: number
  channel_id: number
  channel_name: string
  mode: string
  customer: string | null
  start_ts: number
  end_ts: number
  msg_in: number
  msg_out: number
  last_direction: string
  status: 'scored' | 'skipped'
  skip_label: string | null
  kind_label: string | null
  score_pct: number | null
  grade: 'dat' | 'cai_thien' | 'chua_dat' | null
  agent_name: string | null
  summary: string | null
  outdated: boolean
  edited: boolean
}
type Detail = Item & {
  tip: string | null
  missing_start: boolean
  model: string | null
  scored_at: number
  edited_at: number | null
  edited_by_name: string | null
  edit_note: string | null
  steps: { key: string; name: string; criteria: string; result: Result; result_label: string; message_id: number | null; quote: string; note: string; agent_name: string | null }[]
}
/** Bộ lọc danh sách phiên chat (bấm vào số / bước / nhân viên). */
type ListFilter = { label: string; q: Record<string, string> }

export const GRADE_UI: Record<string, { label: string; tone: string; color: string }> = {
  dat: { label: 'Đạt chuẩn', tone: 'green', color: CHART_COLORS[0] },
  cai_thien: { label: 'Cần cải thiện', tone: 'warning', color: CHART_COLORS[3] },
  chua_dat: { label: 'Chưa đạt', tone: 'danger', color: CHART_COLORS[5] },
}
const RESULT_UI: Record<Result, { label: string; icon: React.ReactNode; cls: string }> = {
  pass: { label: 'Đạt', icon: <CheckCircle2 size={18} />, cls: 'ok-text' },
  fail: { label: 'Không đạt', icon: <XCircle size={18} />, cls: 'err-text' },
  na: { label: 'Không áp dụng', icon: <MinusCircle size={18} />, cls: 'muted' },
  skip: { label: 'Không chấm', icon: <CircleSlash size={18} />, cls: 'muted' },
}
const time = (ms: number) => new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const convLink = (i: { mode: string; channel_id: number; conversation_id: string }, msgId?: number | null) =>
  i.mode === 'monitor' ? `#/monitor/${i.channel_id}/${encodeURIComponent(i.conversation_id)}` : `#/inbox/${encodeURIComponent(i.conversation_id)}${msgId ? `/${msgId}` : ''}`

function ScoreBadge({ i }: { i: Pick<Item, 'status' | 'grade' | 'score_pct' | 'skip_label'> }) {
  if (i.status !== 'scored' || !i.grade) return <Badge>Không chấm</Badge>
  return (
    <Badge tone={GRADE_UI[i.grade].tone}>
      {i.score_pct}% · {GRADE_UI[i.grade].label}
    </Badge>
  )
}

// ───────── Báo cáo ─────────
export function QaTab({ from, to, channelId }: { from: string; to: string; channelId: string }) {
  const { user, users } = useApp()
  const canManage = can(user, 'qa.manage')
  const [agentId, setAgentId] = useState('')
  const [rep, setRep] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<ListFilter | null>(null)
  const [open, setOpen] = useState<{ conv: string; start: number } | null>(null)
  const [reload, setReload] = useState(0)
  const base = `from=${from}&to=${to}${channelId ? `&channelId=${channelId}` : ''}${agentId ? `&agentId=${agentId}` : ''}`

  useEffect(() => {
    let alive = true
    setRep(null)
    setError('')
    api<Report>(`/qa/report?${base}`)
      .then((r) => alive && setRep(r))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [base, reload])
  useEffect(() => setFilter(null), [base])

  if (error) return <div className="banner warn inline">{error}</div>
  if (!rep) return <div className="muted pad">Đang tính…</div>
  const t = rep.totals
  const pick = (label: string, q: Record<string, string>) => {
    setFilter({ label, q })
    requestAnimationFrame(() => document.getElementById('qa-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const pct = (n: number) => (t.scored ? ` · ${Math.round((n / t.scored) * 100)}%` : '')

  return (
    <>
      <div className="row wrap report-actions">
        <select className="select sm" value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Nhân viên">
          <option value="">Mọi nhân viên</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
          <option value="none">Chưa rõ (gửi từ điện thoại)</option>
        </select>
        <span className="grow muted small">
          {!rep.config.hasKey ? (
            'Chưa có khóa API AI nên chưa chấm được (Cài đặt › Trợ lý AI).'
          ) : rep.config.enabled ? (
            <>AI tự chấm phiên chat đã ngừng nhắn · kịch bản bản {rep.config.version}</>
          ) : (
            'Tự chấm đang tắt (bật ở Cài đặt › Chấm tư vấn).'
          )}
        </span>
        {canManage && <RunButton from={from} to={to} channelId={channelId} onDone={() => setReload((x) => x + 1)} />}
        <a className="btn primary sm" href={`/api/qa/report.xlsx?${base}`}>
          <FileSpreadsheet size={14} /> Xuất Excel
        </a>
      </div>
      {!t.sessions ? (
        <Empty icon={<Sparkles size={28} />} title="Chưa có phiên chat nào được chấm trong khoảng này">
          {canManage ? 'Bật tự chấm ở Cài đặt › Chấm tư vấn, hoặc bấm "Chấm khoảng ngày này" để chấm các phiên cũ.' : 'Nhờ quản trị bật tự chấm.'}
        </Empty>
      ) : (
        <>
          <div className="kpis">
            <KpiBtn label="Điểm trung bình" value={t.avg != null ? `${t.avg}%` : '—'} hint={`${t.scored} phiên được chấm`} onClick={() => pick('Phiên được chấm', { status: 'scored' })} />
            <KpiBtn label="Đạt chuẩn" value={t.dat} hint={`≥ ${rep.config.passPct}%${pct(t.dat)}`} onClick={() => pick('Đạt chuẩn', { grade: 'dat' })} />
            <KpiBtn label="Cần cải thiện" value={t.cai_thien} hint={`≥ ${rep.config.improvePct}%${pct(t.cai_thien)}`} tone={t.cai_thien ? 'warn' : undefined} onClick={() => pick('Cần cải thiện', { grade: 'cai_thien' })} />
            <KpiBtn label="Chưa đạt" value={t.chua_dat} hint={`dưới ${rep.config.improvePct}%${pct(t.chua_dat)}`} tone={t.chua_dat ? 'warn' : undefined} onClick={() => pick('Chưa đạt', { grade: 'chua_dat' })} />
            <KpiBtn label="Khách chưa được trả lời" value={t.no_reply} tone={t.no_reply ? 'warn' : undefined} onClick={() => pick('Khách chưa được trả lời', { skip: 'chua_tra_loi' })} />
            <KpiBtn label="Khách chưa nhắn lại" value={t.waiting_customer} hint="tin cuối là của nhân viên" onClick={() => pick('Khách chưa nhắn lại (tin cuối của nhân viên)', { waiting: '1' })} />
          </div>
          <div className="chart-grid">
            <section className="card chart-card">
              <div className="chart-head">
                <h3>Tỉ lệ đạt từng bước</h3>
                <span className="small muted">bấm một bước để xem các phiên không đạt</span>
              </div>
              <div className="hbars">
                {rep.steps.map((s) => (
                  <button key={s.key} className="hbar qa-step-row" onClick={() => pick(`Không đạt bước "${s.name}"`, { step: s.key, result: 'fail' })}>
                    <div className="hbar-head">
                      <span className="hbar-label">{s.name}</span>
                      <b>{s.pct != null ? `${s.pct}%` : '—'}</b>
                    </div>
                    <div className="hbar-track">
                      <div className="hbar-fill" style={{ width: `${s.pct ?? 0}%`, background: s.pct == null ? 'var(--mz-ink-300)' : s.pct >= rep.config.passPct ? GRADE_UI.dat.color : s.pct >= rep.config.improvePct ? GRADE_UI.cai_thien.color : GRADE_UI.chua_dat.color }} />
                    </div>
                    <span className="small muted">
                      đạt {s.pass} · không đạt {s.fail} · không áp dụng {s.na}
                      {s.skip ? ` · không chấm ${s.skip}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="card chart-card">
              <div className="chart-head">
                <h3>Loại phiên chat</h3>
              </div>
              <HBars items={rep.kinds.map((k, i) => ({ label: k.label, value: k.n, color: CHART_COLORS[i % CHART_COLORS.length] }))} empty="Chưa có phiên được chấm" />
              {rep.skipped.length > 0 && (
                <>
                  <div className="chart-head">
                    <h3>Không chấm</h3>
                    <span className="small muted">thiếu dữ liệu thì không chấm</span>
                  </div>
                  <div className="qa-skips">
                    {rep.skipped.map((s) => (
                      <button key={s.key} className="link-row" onClick={() => pick(`Không chấm: ${s.label}`, { skip: s.key })}>
                        <span className="grow">{s.label}</span>
                        <b>{s.n}</b>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
          <div className="card">
            <h3>Theo nhân viên</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nhân viên</th>
                    <th className="num">Phiên được chấm</th>
                    <th className="num">Điểm TB</th>
                    <th className="num">Đạt chuẩn</th>
                    <th className="num">Cần cải thiện</th>
                    <th className="num">Chưa đạt</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.agents.map((a) => {
                    const id = String(a.agent_id ?? 'none')
                    const cell = (n: number, grade: string | null, label: string) => (
                      <td className="num">
                        {n ? (
                          <button className="link-btn" onClick={() => pick(`${a.name}: ${label}`, { agentId: id, ...(grade ? { grade } : { status: 'scored' }) })}>
                            {n}
                          </button>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                    )
                    return (
                      <tr key={id}>
                        <td className={a.agent_id ? '' : 'muted'}>{a.name}</td>
                        {cell(a.n, null, 'phiên được chấm')}
                        <td className="num">
                          <b className={a.avg >= rep.config.passPct ? 'ok-text' : a.avg >= rep.config.improvePct ? 'warn-text' : 'err-text'}>{a.avg}%</b>
                        </td>
                        {cell(a.dat, 'dat', 'Đạt chuẩn')}
                        {cell(a.cai_thien, 'cai_thien', 'Cần cải thiện')}
                        {cell(a.chua_dat, 'chua_dat', 'Chưa đạt')}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Phiên chat tính cho người trả lời nhiều nhất trong phiên. Tin gửi thẳng từ điện thoại ở kênh chung không biết ai gửi nên ghi "Chưa rõ"; với Zalo nhân viên tính cho người giữ máy.
            </p>
          </div>
          <QaList id="qa-list" base={base} filter={filter} onClear={() => setFilter(null)} onOpen={(i) => setOpen({ conv: i.conversation_id, start: i.start_message_id })} reload={reload} />
        </>
      )}
      {open && <QaDetail conv={open.conv} start={open.start} onClose={() => setOpen(null)} onChanged={() => setReload((x) => x + 1)} />}
    </>
  )
}

function KpiBtn({ label, value, hint, tone, onClick }: { label: string; value: React.ReactNode; hint?: string; tone?: string; onClick: () => void }) {
  return (
    <button className={`kpi kpi-btn ${tone ?? ''}`} onClick={onClick}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="small muted">{hint}</div>}
    </button>
  )
}

function QaList({ id, base, filter, onClear, onOpen, reload }: { id: string; base: string; filter: ListFilter | null; onClear: () => void; onOpen: (i: Item) => void; reload: number }) {
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ total: number; items: Item[] } | null>(null)
  const q = new URLSearchParams({ ...(filter?.q ?? {}), page: String(page) }).toString()
  // Bộ lọc nhân viên trong danh sách (bấm ô bảng nhân viên) ghi đè bộ lọc nhân viên chung
  const path = `/qa/list?${filter?.q.agentId ? base.replace(/&agentId=[^&]*/, '') : base}&${q}`
  useEffect(() => setPage(0), [filter, base])
  useEffect(() => {
    let alive = true
    api<{ total: number; items: Item[] }>(path)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ total: 0, items: [] }))
    return () => {
      alive = false
    }
  }, [path, reload])
  return (
    <div className="card" id={id}>
      <div className="row wrap">
        <h3 className="grow">Phiên chat {data ? <span className="muted small">({data.total})</span> : null}</h3>
        {filter && (
          <span className="chip">
            {filter.label}
            <button onClick={onClear} aria-label="Bỏ lọc">
              ×
            </button>
          </span>
        )}
      </div>
      {!data ? (
        <div className="muted pad">Đang tải…</div>
      ) : !data.items.length ? (
        <div className="muted pad">Không có phiên chat nào</div>
      ) : (
        <div className="qa-list">
          {data.items.map((i) => (
            <button key={`${i.conversation_id}:${i.start_message_id}`} className="qa-item" onClick={() => onOpen(i)}>
              <div className="row wrap">
                <b className="grow ellipsis">{i.customer ?? 'Khách'}</b>
                <ScoreBadge i={i} />
              </div>
              <div className="small muted">
                {time(i.start_ts)} · {i.channel_name} · {i.agent_name ?? 'Chưa rõ'} · {i.msg_in} tin khách / {i.msg_out} tin NV
                {i.kind_label ? ` · ${i.kind_label}` : ''}
                {i.status === 'skipped' && i.skip_label ? ` · ${i.skip_label}` : ''}
                {i.edited ? ' · đã sửa tay' : ''}
                {i.outdated ? ' · kịch bản cũ' : ''}
              </div>
              {i.summary && <div className="small qa-summary">{i.summary}</div>}
            </button>
          ))}
        </div>
      )}
      {data && data.total > 50 && (
        <div className="row pager">
          <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Trước
          </button>
          <span className="small muted">
            Trang {page + 1}/{Math.ceil(data.total / 50)}
          </span>
          <button className="btn ghost sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>
            Sau
          </button>
        </div>
      )}
    </div>
  )
}

/** Nút chấm các phiên trong khoảng ngày (phiên cũ, hoặc sau khi sửa kịch bản). */
function RunButton({ from, to, channelId, onDone }: { from: string; to: string; channelId: string; onDone: () => void }) {
  const [job, setJob] = useState<{ running: boolean; total: number; done: number; scored: number; errors: number; message: string } | null>(null)
  const poll = useCallback(() => api<NonNullable<typeof job>>('/qa/job').then(setJob), [])
  useEffect(() => {
    void poll().catch(() => {})
  }, [poll])
  useEffect(() => {
    if (!job?.running) return
    const t = setInterval(() => void poll().then(() => onDone()).catch(() => {}), 4000)
    return () => clearInterval(t)
  }, [job?.running, poll, onDone])
  async function start() {
    if (!confirm(`Chấm các phiên chat từ ${from.split('-').reverse().join('/')} đến ${to.split('-').reverse().join('/')} chưa được chấm (hoặc chấm theo kịch bản cũ)?\nMỗi phiên tốn 1 lượt AI, chịu giới hạn lượt mỗi ngày.`)) return
    try {
      setJob(await api('/qa/job', { body: { from, to, channelId: channelId || undefined } }))
    } catch (e: any) {
      alert(e.message)
    }
  }
  if (job?.running)
    return (
      <span className="small">
        <RefreshCw size={14} className="spin inline-icon" /> Đang chấm {job.done}/{job.total || '…'}
      </span>
    )
  return (
    <>
      {job && job.done > 0 && (
        <span className={`small ${job.errors ? 'warn-text' : 'muted'}`}>
          Lần chấm trước: {job.scored} phiên mới chấm{job.errors ? `, ${job.errors} lỗi (${job.message})` : ''}
        </span>
      )}
      <button className="btn outline sm" onClick={start}>
        <Sparkles size={14} /> Chấm khoảng ngày này
      </button>
    </>
  )
}

// ───────── Chi tiết một phiên ─────────
export function QaDetail({ conv, start, onClose, onChanged }: { conv: string; start: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useApp()
  const canManage = can(user, 'qa.manage')
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<Record<string, Result> | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    api<Detail>(`/qa/item/${encodeURIComponent(conv)}/${start}`)
      .then(setD)
      .catch((e) => setError(e.message))
  }, [conv, start])

  async function save() {
    setBusy('save')
    try {
      setD(await api<Detail>(`/qa/item/${encodeURIComponent(conv)}/${start}`, { method: 'PATCH', body: { steps: edit, note } }))
      setEdit(null)
      onChanged()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy('')
    }
  }
  async function rescore() {
    if (!confirm('Cho AI chấm lại phiên này? (tốn 1 lượt AI, phần sửa tay sẽ bị thay)')) return
    setBusy('rescore')
    try {
      setD(await api<Detail>(`/qa/item/${encodeURIComponent(conv)}/${start}/rescore`, { method: 'POST' }))
      setEdit(null)
      onChanged()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title={d ? `Chấm tư vấn · ${d.customer ?? 'Khách'}` : 'Chấm tư vấn'} onClose={onClose} wide>
      {error ? (
        <div className="banner warn inline">{error}</div>
      ) : !d ? (
        <div className="muted pad">Đang tải…</div>
      ) : (
        <div className="stack qa-detail">
          <div className="row wrap">
            <ScoreBadge i={d} />
            {d.kind_label && <Badge tone="info">{d.kind_label}</Badge>}
            {d.missing_start && <Badge tone="warning">Thiếu đoạn đầu</Badge>}
            {d.outdated && <Badge tone="warning">Chấm theo kịch bản cũ</Badge>}
            <span className="grow" />
            <a className="btn outline sm" href={convLink(d)} onClick={onClose}>
              <ExternalLink size={14} /> Mở hội thoại
            </a>
          </div>
          <div className="small muted">
            {fullTime(d.start_ts)} → {fullTime(d.end_ts)} · {d.channel_name} · nhân viên: {d.agent_name ?? 'Chưa rõ (gửi từ điện thoại)'} · {d.msg_in} tin khách / {d.msg_out} tin NV
          </div>
          {d.status === 'skipped' && <div className="banner inline">Không chấm: {d.skip_label}</div>}
          {d.summary && <p>{d.summary}</p>}
          {d.tip && (
            <div className="banner info inline">
              <b>Góp ý:</b> {d.tip}
            </div>
          )}
          {d.steps.length > 0 && (
            <div className="qa-steps">
              {d.steps.map((s) => {
                const r = edit?.[s.key] ?? s.result
                return (
                  <div key={s.key} className="qa-step">
                    <span className={RESULT_UI[r].cls}>{RESULT_UI[r].icon}</span>
                    <div className="grow">
                      <div className="row wrap">
                        <b className="grow">{s.name}</b>
                        {edit ? (
                          <select className="select sm" value={r} onChange={(e) => setEdit({ ...edit, [s.key]: e.target.value as Result })} aria-label={`Kết quả bước ${s.name}`}>
                            {(Object.keys(RESULT_UI) as Result[]).map((k) => (
                              <option key={k} value={k}>
                                {RESULT_UI[k].label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`small ${RESULT_UI[r].cls}`}>{RESULT_UI[r].label}</span>
                        )}
                      </div>
                      {s.quote && (
                        <a className="qa-quote" href={convLink(d, s.message_id)} onClick={onClose} title="Mở đúng tin này">
                          “{s.quote}”{s.agent_name ? <span className="muted"> · {s.agent_name}</span> : null}
                        </a>
                      )}
                      {s.note && <div className="small muted">{s.note}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {edit && (
            <label className="field">
              <span>Ghi chú khi sửa (không bắt buộc)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="VD: khách đã được chào ở cuộc gọi trước" />
            </label>
          )}
          <div className="row wrap">
            <span className="grow small muted">
              {d.model ? `AI chấm lúc ${fullTime(d.scored_at)}` : `Chấm lúc ${fullTime(d.scored_at)}`}
              {d.edited_at ? ` · ${d.edited_by_name ?? 'quản lý'} sửa lúc ${fullTime(d.edited_at)}${d.edit_note ? `: ${d.edit_note}` : ''}` : ''}
            </span>
            {canManage &&
              (edit ? (
                <>
                  <button className="btn ghost" onClick={() => setEdit(null)} disabled={!!busy}>
                    Hủy
                  </button>
                  <button className="btn primary" onClick={save} disabled={!!busy}>
                    <Save size={16} /> {busy === 'save' ? 'Đang lưu…' : 'Lưu kết quả'}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn outline" onClick={rescore} disabled={!!busy}>
                    <RefreshCw size={16} className={busy === 'rescore' ? 'spin' : ''} /> {busy === 'rescore' ? 'Đang chấm…' : 'Chấm lại'}
                  </button>
                  {d.status === 'scored' && (
                    <button className="btn outline" onClick={() => (setEdit({}), setNote(d.edit_note ?? ''))}>
                      Sửa kết quả
                    </button>
                  )}
                </>
              ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ───────── Cài đặt kịch bản ─────────
export function QaSettings() {
  const [cfg, setCfg] = useState<QaCfg | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<QaCfg>('/qa/config')
      .then(setCfg)
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [])
  if (!cfg) return msg ? <div className="banner warn inline">{msg.text}</div> : <div className="muted pad">Đang tải…</div>
  const set = (p: Partial<QaCfg>) => setCfg({ ...cfg, ...p })
  const setStep = (i: number, p: Partial<Step>) => set({ steps: cfg.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  const move = (i: number, d: number) => {
    const steps = [...cfg.steps]
    ;[steps[i], steps[i + d]] = [steps[i + d], steps[i]]
    set({ steps })
  }

  async function save(enabled?: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const c = await api<QaCfg>('/qa/config', {
        method: 'PUT',
        body: { steps: cfg!.steps, passPct: cfg!.passPct, improvePct: cfg!.improvePct, quietMin: cfg!.quietMin, gapHours: cfg!.gapHours, notes: cfg!.notes, ...(enabled !== undefined ? { enabled } : {}) },
      })
      setCfg(c)
      setMsg({ ok: true, text: enabled === undefined ? `Đã lưu (kịch bản bản ${c.version})` : enabled ? 'Đã bật tự chấm' : 'Đã tắt tự chấm' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row wrap">
          <h3 className="grow">
            <Sparkles size={16} className="inline-icon" /> Chấm tư vấn theo kịch bản
          </h3>
          {cfg.enabled ? <Badge tone="green">Đang tự chấm</Badge> : <Badge tone="warning">Chưa bật</Badge>}
        </div>
        <p className="small muted">
          AI đọc từng phiên chat ở mọi kênh đã kết nối, chấm từng bước của kịch bản bên dưới. Bước "Đạt" phải kèm câu trích nguyên văn của nhân
          viên, máy chủ kiểm lại; điểm = số bước đạt ÷ số bước được tính. Thiếu dữ liệu (chưa trả lời, thiếu đoạn đầu…) thì không chấm. Chỉ người có quyền
          "Xem chất lượng tư vấn" xem kết quả ở Báo cáo › Chất lượng tư vấn. Nội dung chat được gửi tới {cfg.provider} để chấm.
        </p>
        {!cfg.hasKey && <div className="banner warn inline">Chưa có khóa API AI. Chọn nhà cung cấp (Claude, Grok hoặc DeepSeek) và nhập khóa ở <a href="#/settings/ai">Cài đặt › Trợ lý AI</a>.</div>}
        <div className="grid-2">
          <label className="field">
            <span>Đạt chuẩn từ (%)</span>
            <input type="number" min={1} max={100} value={cfg.passPct} onChange={(e) => set({ passPct: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Cần cải thiện từ (%)</span>
            <input type="number" min={0} max={99} value={cfg.improvePct} onChange={(e) => set({ improvePct: Number(e.target.value) })} />
            <span className="small muted">Dưới mốc này là "Chưa đạt"</span>
          </label>
          <label className="field">
            <span>Chấm khi khách ngừng nhắn (phút)</span>
            <input type="number" min={5} max={720} value={cfg.quietMin} onChange={(e) => set({ quietMin: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Cách nhau bao nhiêu giờ thì tính phiên chat mới</span>
            <input type="number" min={2} max={72} value={cfg.gapHours} onChange={(e) => set({ gapHours: Number(e.target.value) })} />
          </label>
        </div>
        <label className="field">
          <span>Ghi chú chung cho AI khi chấm</span>
          <textarea rows={3} value={cfg.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={'VD:\n- Xưng "em", gọi khách "anh/chị"\n- Báo giá phải kèm thời gian bảo hành'} />
        </label>
        <p className="small muted">
          Mỗi lượt chấm một phiên tốn 1 lượt AI ({cfg.provider} · {cfg.model}), dùng chung giới hạn {cfg.maxCallsPerDay} lượt / ngày với Trợ lý AI giám sát.
        </p>
      </div>

      <div className="card stack">
        <div className="row wrap">
          <h3 className="grow">Các bước của kịch bản (bản {cfg.version})</h3>
          <button className="btn outline sm" onClick={() => set({ steps: [...cfg.steps, { key: '', name: '', criteria: '', sample: '', when: 'always', opening: false }] })} disabled={cfg.steps.length >= 15}>
            <Plus size={14} /> Thêm bước
          </button>
        </div>
        <p className="small muted">Sửa bước, tiêu chí hoặc mốc điểm thì kịch bản lên bản mới; phiên đã chấm theo bản cũ được ghi chú "kịch bản cũ", chấm lại bằng nút "Chấm khoảng ngày này" ở Báo cáo.</p>
        {cfg.steps.map((s, i) => (
          <div key={i} className="qa-step-edit">
            <div className="row wrap">
              <b className="qa-step-no">{i + 1}</b>
              <input className="input grow" value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} placeholder="Tên bước, VD: Chào khách" maxLength={80} aria-label={`Tên bước ${i + 1}`} />
              <select className="select" value={s.when} onChange={(e) => setStep(i, { when: e.target.value as Step['when'] })} aria-label="Áp dụng khi">
                <option value="always">Mọi phiên chat</option>
                <option value="sale">Chỉ khi khách hỏi mua</option>
              </select>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Lên trên">
                <ArrowUp size={16} />
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === cfg.steps.length - 1} aria-label="Xuống dưới">
                <ArrowDown size={16} />
              </button>
              <button className="icon-btn" onClick={() => set({ steps: cfg.steps.filter((_, k) => k !== i) })} disabled={cfg.steps.length <= 1} aria-label="Xóa bước">
                <Trash2 size={16} />
              </button>
            </div>
            <textarea rows={2} value={s.criteria} onChange={(e) => setStep(i, { criteria: e.target.value })} placeholder="Tiêu chí: thế nào là đạt" maxLength={600} aria-label="Tiêu chí" />
            <input className="input" value={s.sample} onChange={(e) => setStep(i, { sample: e.target.value })} placeholder="Câu mẫu (không bắt buộc)" maxLength={400} aria-label="Câu mẫu" />
            <label className="check small">
              <input type="checkbox" checked={s.opening} onChange={(e) => setStep(i, { opening: e.target.checked })} />
              Bước mở đầu (không chấm khi thiếu đoạn đầu hội thoại)
            </label>
          </div>
        ))}
        <div className="row wrap">
          {msg && <span className={`small ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
          <span className="grow" />
          <button className="btn outline" disabled={busy} onClick={() => save()}>
            <Save size={16} /> Lưu
          </button>
          {cfg.enabled ? (
            <button className="btn danger" disabled={busy} onClick={() => save(false)}>
              Tắt tự chấm
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !cfg.hasKey} onClick={() => save(true)}>
              Lưu và bật tự chấm
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
