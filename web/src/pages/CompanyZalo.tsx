import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, History, Pencil, Smartphone } from 'lucide-react'
import { api } from '../api'
import { useApp, useSocketEvent } from '../store'
import type { ZaloStatus } from '../types'
import { Avatar, Badge, Modal } from '../components'
import { fullTime, timeLabel } from '../util'

type Account = {
  channel_id: number
  name: string
  zalo_uid: string | null
  zalo_name: string | null
  avatar: string | null
  active: number
  phone: string | null
  sim_serial: string | null
  carrier: string | null
  device: string | null
  holder_id: number | null
  holder_name: string | null
  holder_active: number | null
  holder_since: number | null
  status: 'in_use' | 'stored' | 'revoking' | 'lost' | 'locked'
  status_label: string
  note: string | null
  connection: ZaloStatus | null
  today: { msg_in: number; out_app: number; out_phone: number; customers: number }
  waiting: number
  last_message_at: number | null
  last_disconnect: { ts: number; error?: string | null } | null
}
type Data = { accounts: Account[]; statuses: Record<string, string>; checklist: { key: string; label: string }[] }

const STATUS_TONE: Record<Account['status'], string> = { in_use: 'green', stored: 'neutral', revoking: 'danger', lost: 'danger', locked: 'warning' }

/** Cài đặt › Zalo & SĐT công ty: tài khoản Zalo cá nhân + SIM công ty cấp cho nhân viên. */
export default function CompanyZalo() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Account | null>(null)
  const [handing, setHanding] = useState<Account | null>(null)
  const [history, setHistory] = useState<Account | null>(null)

  const load = () =>
    api<Data>('/company-accounts')
      .then(setData)
      .catch((e) => setError(e.message))
  useEffect(() => {
    void load()
  }, [])
  useSocketEvent('settings:changed', () => void load())
  useSocketEvent('zalo:status', () => void load())

  if (!data) return error ? <div className="banner warn inline">{error}</div> : <div className="muted">Đang tải…</div>
  const list = data.accounts
  const count = (s: Account['status']) => list.filter((a) => a.status === s).length
  const needRevoke = list.filter((a) => a.status === 'revoking' || (a.holder_id && a.holder_active === 0))
  const offline = list.filter((a) => a.active && a.connection?.state !== 'connected')

  return (
    <div className="stack company-zalo">
      <div className="page-head">
        <div>
          <h1>Zalo & SĐT công ty</h1>
          <p className="muted">
            Tài khoản Zalo cá nhân và SIM công ty cấp cho nhân viên. Khách hàng và lịch sử chat luôn thuộc tài khoản công ty: nhân viên nghỉ thì
            thu hồi, bàn giao cho người khác mà không mất khách. Tin nhân viên nhắn trực tiếp trên điện thoại vẫn được lưu, ghi tên người đang
            giữ máy.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="muted small">Tổng tài khoản</span>
          <b>{list.length}</b>
        </div>
        <div className="kpi">
          <span className="muted small">Đang cấp cho nhân viên</span>
          <b>{count('in_use')}</b>
        </div>
        <div className="kpi">
          <span className="muted small">Trong kho</span>
          <b>{count('stored')}</b>
        </div>
        <div className={`kpi ${needRevoke.length ? 'kpi-bad' : ''}`}>
          <span className="muted small">Cần thu hồi</span>
          <b>{needRevoke.length}</b>
        </div>
        <div className={`kpi ${offline.length ? 'kpi-bad' : ''}`}>
          <span className="muted small">Mất kết nối</span>
          <b>{offline.length}</b>
        </div>
      </div>

      {needRevoke.length > 0 && (
        <div className="banner warn inline">
          <AlertTriangle size={16} />
          Nhân viên đã khóa / nghỉ nhưng còn giữ Zalo công ty: {needRevoke.map((a) => `${a.name} (${a.holder_name ?? '?'})`).join(', ')}. Bấm "Thu hồi" để bàn
          giao khách và lưu checklist.
        </div>
      )}

      {!list.length && (
        <div className="card center pad muted">
          Chưa có tài khoản Zalo nào. Thêm ở <a href="#/settings/channels">Tích hợp › Kết nối kênh</a> (quét QR bằng Zalo trên máy công ty).
        </div>
      )}

      <div className="account-grid">
        {list.map((a) => {
          const connected = a.connection?.state === 'connected'
          return (
            <div key={a.channel_id} className={`card account-card ${a.status === 'revoking' ? 'alert' : ''}`}>
              <div className="row">
                <Avatar name={a.zalo_name ?? a.name} src={a.connection?.account?.avatar || a.avatar} size={44} />
                <div className="grow">
                  <b>{a.name}</b>
                  <div className="muted small">
                    {a.connection?.account?.name ?? a.zalo_name ?? 'Chưa gắn Zalo'}
                    {a.phone ? ` · ${a.phone}` : ''}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[a.status]}>{a.status_label}</Badge>
              </div>

              <dl className="account-facts">
                <dt>Người giữ</dt>
                <dd>
                  {a.holder_name ? (
                    <span className="row">
                      <Avatar name={a.holder_name} size={20} /> {a.holder_name}
                      {a.holder_active === 0 && <Badge tone="danger">đã khóa</Badge>}
                      {a.holder_since && <span className="muted small">từ {fullTime(a.holder_since)}</span>}
                    </span>
                  ) : (
                    <span className="muted">Chưa cấp</span>
                  )}
                </dd>
                <dt>SIM / máy</dt>
                <dd>{[a.carrier, a.sim_serial && `SIM ${a.sim_serial}`, a.device].filter(Boolean).join(' · ') || <span className="muted">Chưa nhập</span>}</dd>
                <dt>Kết nối</dt>
                <dd>
                  <span className={`status-dot ${connected ? 'ok' : 'bad'}`} /> {!a.active ? 'Kênh đang tắt' : connected ? 'Đang kết nối' : a.connection?.error ?? 'Mất kết nối'}
                  {a.last_disconnect && <span className="muted small"> · ngắt gần nhất {timeLabel(a.last_disconnect.ts)}</span>}
                </dd>
                <dt>Hôm nay</dt>
                <dd>
                  {a.today.customers} khách nhắn · {a.today.out_app} tin trả lời trên app ·{' '}
                  <span className={a.today.out_phone ? 'warn-text' : ''}>{a.today.out_phone} tin nhắn từ điện thoại</span>
                </dd>
                <dt>Chờ trả lời</dt>
                <dd className={a.waiting ? 'err-text' : ''}>{a.waiting} hội thoại</dd>
              </dl>
              {a.note && <p className="small muted">Ghi chú: {a.note}</p>}

              <div className="row wrap">
                <button className={`btn sm ${a.holder_id ? 'outline' : 'primary'} ${a.status === 'revoking' ? 'danger' : ''}`} onClick={() => setHanding(a)}>
                  <ArrowRightLeft size={14} /> {a.holder_id ? 'Thu hồi / bàn giao' : 'Cấp cho nhân viên'}
                </button>
                <button className="btn ghost sm" onClick={() => setEditing(a)}>
                  <Pencil size={14} /> Hồ sơ SIM
                </button>
                <button className="btn ghost sm" onClick={() => setHistory(a)}>
                  <History size={14} /> Lịch sử
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card notice">
        <h3>
          <Smartphone size={18} /> Quy trình gợi ý
        </h3>
        <ul>
          <li>
            <b>Cấp máy:</b> quét QR kênh bằng Zalo trên máy công ty, nhập SĐT / SIM ở "Hồ sơ SIM", rồi "Cấp cho nhân viên". Người nhận được vào
            thẳng kênh trên app.
          </li>
          <li>
            <b>Hằng ngày:</b> nhân viên nên trả lời trên app để tin có tên người gửi và được chấm điểm; tin nhắn từ điện thoại vẫn lưu, ghi tên người giữ
            máy. Số "tin nhắn từ điện thoại" cao là dấu hiệu cần nhắc.
          </li>
          <li>
            <b>Nghỉ việc:</b> khóa nhân viên ở mục Nhân viên → tài khoản họ giữ tự chuyển "Cần thu hồi". Bấm Thu hồi: chọn người nhận, khách đang
            tư vấn tự chuyển sang, tick checklist (thu SIM, đổi mật khẩu Zalo…).
          </li>
          <li>
            <b>Mất kết nối bất thường</b> (đăng nhập Zalo PC / Web ở máy khác) được ghi lại trong Lịch sử để kiểm tra.
          </li>
        </ul>
      </div>

      {editing && <AssetForm account={editing} statuses={data.statuses} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void load())} />}
      {handing && <HandoverModal account={handing} checklist={data.checklist} onClose={() => setHanding(null)} onDone={() => (setHanding(null), void load())} />}
      {history && <HistoryModal account={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

function AssetForm({ account: a, statuses, onClose, onSaved }: { account: Account; statuses: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ phone: a.phone ?? '', sim_serial: a.sim_serial ?? '', carrier: a.carrier ?? '', device: a.device ?? '', note: a.note ?? '', status: a.status })
  const [error, setError] = useState('')
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v })
  async function save() {
    setError('')
    try {
      await api(`/company-accounts/${a.channel_id}`, { method: 'PATCH', body: form })
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Modal title={`Hồ sơ SIM · ${a.name}`} onClose={onClose}>
      <div className="stack">
        <div className="grid-2 tight">
          <label className="field">
            <span>Số điện thoại</span>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="09xx xxx xxx" />
          </label>
          <label className="field">
            <span>Nhà mạng</span>
            <input value={form.carrier} onChange={(e) => set('carrier', e.target.value)} placeholder="Viettel / Mobifone / Vinaphone" />
          </label>
          <label className="field">
            <span>Số serial SIM</span>
            <input value={form.sim_serial} onChange={(e) => set('sim_serial', e.target.value)} />
          </label>
          <label className="field">
            <span>Điện thoại (máy công ty)</span>
            <input value={form.device} onChange={(e) => set('device', e.target.value)} placeholder="VD: Samsung A15, IMEI …" />
          </label>
        </div>
        <label className="field">
          <span>Trạng thái</span>
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(statuses)
              .filter(([k]) => k !== 'in_use' || a.status === 'in_use')
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </select>
          <span className="muted small">"Đang cấp" chỉ đặt bằng nút Cấp / Bàn giao để có lịch sử.</span>
        </label>
        <label className="field">
          <span>Ghi chú</span>
          <textarea rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" onClick={save}>
            Lưu
          </button>
        </div>
      </div>
    </Modal>
  )
}

function HandoverModal({ account: a, checklist, onClose, onDone }: { account: Account; checklist: Data['checklist']; onClose: () => void; onDone: () => void }) {
  const { users } = useApp()
  const [to, setTo] = useState<string>('')
  const [note, setNote] = useState('')
  const [reassign, setReassign] = useState(true)
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const candidates = users.filter((u) => u.active && u.id !== a.holder_id)
  const revoking = !!a.holder_id
  const allChecked = checklist.every((c) => checks[c.key])

  async function submit() {
    if (!revoking && !to) return setError('Chọn nhân viên nhận máy')
    if (revoking && !allChecked && !confirm('Checklist thu hồi chưa tick đủ. Vẫn thu hồi?')) return
    setBusy(true)
    setError('')
    try {
      await api(`/company-accounts/${a.channel_id}/handover`, { body: { user_id: to ? Number(to) : null, note, checklist: checks, reassign } })
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={revoking ? `Thu hồi / bàn giao · ${a.name}` : `Cấp ${a.name} cho nhân viên`} onClose={onClose}>
      <div className="stack">
        {revoking && (
          <p className="small">
            Đang giữ: <b>{a.holder_name}</b>
            {a.waiting > 0 && <span className="err-text"> · {a.waiting} hội thoại đang chờ trả lời</span>}
          </p>
        )}
        <label className="field">
          <span>{revoking ? 'Bàn giao cho' : 'Nhân viên nhận máy'}</span>
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            {revoking && <option value="">Thu về kho (chưa cấp cho ai)</option>}
            {!revoking && <option value="">Chọn nhân viên…</option>}
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
          <span className="muted small">Người nhận được vào thẳng kênh này trên app; tin nhắn từ điện thoại sau đó ghi tên người nhận.</span>
        </label>
        {revoking && (
          <>
            <label className="check">
              <input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
              Chuyển các hội thoại {a.holder_name} đang phụ trách ở kênh này sang {to ? 'người nhận' : '"chưa nhận"'}
            </label>
            <div className="field">
              <span>Checklist thu hồi</span>
              {checklist.map((c) => (
                <label key={c.key} className="check">
                  <input type="checkbox" checked={!!checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
                  {c.label}
                </label>
              ))}
            </div>
          </>
        )}
        <label className="field">
          <span>Ghi chú</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={revoking ? 'VD: nghỉ việc 15/10, đã nhận lại máy' : 'VD: cấp cho trực ca tối'} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {revoking ? (to ? 'Thu hồi và bàn giao' : 'Thu hồi về kho') : 'Cấp máy'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

type HistoryData = {
  holders: { id: number; user_name: string | null; from_at: number; to_at: number | null; handed_by_name: string | null; returned_by_name: string | null; hand_note: string | null; return_note: string | null; checklist: Record<string, boolean> | null }[]
  events: { type: string; ts: number; by_name: string | null; data: any }[]
}

const EVENT_TEXT: Record<string, (d: any) => string> = {
  'channel.disconnected': (d) => `Mất kết nối Zalo${d?.error ? `: ${d.error}` : ''}`,
  'channel.connected': () => 'Kết nối lại Zalo',
  'channel.handover': (d) => (d?.to ? `Bàn giao${d?.moved ? `, chuyển ${d.moved} hội thoại` : ''}` : `Thu hồi về kho${d?.moved ? `, chuyển ${d.moved} hội thoại` : ''}`),
  'channel.asset_updated': (d) => `Sửa hồ sơ SIM (trạng thái: ${d?.status})`,
  'channel.logout': () => 'Ngắt Zalo khỏi app',
  'channel.holder_deactivated': () => 'Người giữ bị khóa tài khoản → cần thu hồi',
}

function HistoryModal({ account: a, onClose }: { account: Account; onClose: () => void }) {
  const [h, setH] = useState<HistoryData | null>(null)
  useEffect(() => {
    api<HistoryData>(`/company-accounts/${a.channel_id}/history`).then(setH)
  }, [a.channel_id])
  return (
    <Modal title={`Lịch sử · ${a.name}`} onClose={onClose} wide>
      {!h ? (
        <div className="muted">Đang tải…</div>
      ) : (
        <div className="stack">
          <h3 className="small-head">Người giữ qua các thời kỳ</h3>
          {!h.holders.length && <div className="muted small">Chưa cấp cho ai.</div>}
          <div className="timeline">
            {h.holders.map((x) => (
              <div key={x.id} className="timeline-item">
                <b>{x.user_name ?? 'Nhân viên đã xóa'}</b>
                <span className="small muted">
                  {fullTime(x.from_at)} → {x.to_at ? fullTime(x.to_at) : 'nay'} · cấp bởi {x.handed_by_name ?? '?'}
                  {x.returned_by_name ? ` · thu hồi bởi ${x.returned_by_name}` : ''}
                </span>
                {(x.hand_note || x.return_note) && <span className="small">{[x.hand_note, x.return_note].filter(Boolean).join(' · ')}</span>}
                {x.checklist && Object.keys(x.checklist).length > 0 && (
                  <span className="small muted">Checklist: {Object.entries(x.checklist).filter(([, v]) => v).length}/4 mục đã làm</span>
                )}
              </div>
            ))}
          </div>
          <h3 className="small-head">Sự kiện</h3>
          {!h.events.length && <div className="muted small">Chưa có sự kiện.</div>}
          <div className="timeline">
            {h.events.map((e, i) => (
              <div key={i} className={`timeline-item ${e.type === 'channel.disconnected' ? 'bad' : ''}`}>
                <span>{(EVENT_TEXT[e.type] ?? (() => e.type))(e.data)}</span>
                <span className="small muted">
                  {fullTime(e.ts)}
                  {e.by_name ? ` · ${e.by_name}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
