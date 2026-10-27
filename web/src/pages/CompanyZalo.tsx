import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Eye, History, Pencil, Plus, QrCode, ShieldAlert, Smartphone } from 'lucide-react'
import { api } from '../api'
import { useApp, useSocketEvent } from '../store'
import type { ZaloStatus } from '../types'
import { Avatar, Badge, Modal } from '../components'
import { fullTime } from '../util'

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

/** Cài đặt › Zalo nhân viên (giám sát): SĐT công ty cấp, nhân viên tự chat trên điện thoại, quản lý giám sát. */
export default function CompanyZalo() {
  const { channels, users } = useApp()
  const [data, setData] = useState<Data | null>(null)
  const [accounts, setAccounts] = useState<(Account & MonitorInfo)[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Account | null>(null)
  const [handing, setHanding] = useState<Account | null>(null)
  const [history, setHistory] = useState<Account | null>(null)
  const [adding, setAdding] = useState(false)

  const load = () => {
    api<Data>('/company-accounts')
      .then(setData)
      .catch((e) => setError(e.message))
    api<(Account & MonitorInfo)[]>('/monitor/accounts')
      .then(setAccounts)
      .catch((e) => setError(e.message))
  }
  useEffect(() => {
    load()
  }, [])
  useSocketEvent('settings:changed', load)
  useSocketEvent('zalo:status', load)
  // Đang chờ quét QR: tải lại mỗi 3 giây để thấy mã mới / trạng thái đã quét
  const waitingQr = accounts.some((a) => a.connection?.state === 'qr' || a.connection?.state === 'scanned' || a.connection?.state === 'connecting')
  useEffect(() => {
    if (!waitingQr) return
    const t = window.setInterval(load, 3000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingQr])

  async function channelCall(id: number, action: string) {
    try {
      await api(`/channels/${id}/${action}`, { method: 'POST' })
    } catch (e: any) {
      alert(e.message)
    }
    load()
  }
  async function stopMonitoring(a: Account) {
    if (!confirm(`Bỏ giám sát "${a.name}" và chuyển thành kênh CSKH chung? Lịch sử tin nhắn vẫn giữ.`)) return
    await api(`/monitor/accounts/${a.channel_id}/mode`, { body: { mode: 'shared' } })
    load()
  }

  if (!data) return error ? <div className="banner warn inline">{error}</div> : <div className="muted">Đang tải…</div>
  const offline = accounts.filter((a) => !a.monitoring)
  const needRevoke = accounts.filter((a) => a.status === 'revoking' || (a.holder_id && a.holder_active === 0))
  const sharedZalo = channels.filter((c) => c.platform === 'zalo' && c.mode !== 'monitor')

  return (
    <div className="stack company-zalo">
      <div className="page-head">
        <div>
          <h1>Zalo nhân viên (giám sát)</h1>
          <p className="muted">
            Công ty cấp SIM cho nhân viên, nhân viên tạo Zalo trên số đó và tự chat với khách bằng điện thoại. Gắn Zalo đó vào app ở chế độ
            giám sát để quản lý xem được toàn bộ tin nhắn với khách, kể cả tin nhân viên đã thu hồi. Khách và lịch sử chat thuộc SĐT công ty,
            nhân viên nghỉ thì thu hồi, bàn giao cho người khác.
          </p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={18} /> Thêm Zalo nhân viên
        </button>
      </div>

      <div className="sapo-flow">
        <div>
          <b>1. Cấp SIM</b>
          <span className="muted small">Bấm "Thêm Zalo nhân viên", nhập SĐT công ty và chọn nhân viên nhận.</span>
        </div>
        <div>
          <b>2. Nhân viên tạo Zalo</b>
          <span className="muted small">Tạo tài khoản Zalo bằng SĐT đó trên điện thoại, chat với khách như bình thường.</span>
        </div>
        <div>
          <b>3. Quét QR giám sát</b>
          <span className="muted small">Bấm "Quét QR", dùng Zalo trên điện thoại đó quét mã. Từ lúc này mọi tin được lưu về app.</span>
        </div>
        <div>
          <b>4. Xem ở menu Giám sát</b>
          <span className="muted small">Xem từng hội thoại, tin thu hồi, tin bị gắn cờ (chuyển khoản riêng, SĐT khác…).</span>
        </div>
      </div>

      {offline.length > 0 && (
        <div className="banner warn inline">
          <ShieldAlert size={16} /> Mất giám sát: {offline.map((a) => a.holder_name ?? a.name).join(', ')}. Nhân viên có thể đã đăng xuất phiên Zalo Web
          trên điện thoại, hoặc chưa quét QR. Bấm "Quét QR" để kết nối lại.
        </div>
      )}
      {needRevoke.length > 0 && (
        <div className="banner warn inline">
          <AlertTriangle size={16} /> Nhân viên đã khóa / nghỉ nhưng còn giữ SĐT: {needRevoke.map((a) => `${a.name} (${a.holder_name ?? '?'})`).join(', ')}. Bấm "Thu hồi".
        </div>
      )}

      {!accounts.length && <div className="card center pad muted">Chưa có Zalo nhân viên nào đang giám sát.</div>}

      <div className="account-grid">
        {accounts.map((a) => {
          const st = a.connection?.state
          return (
            <div key={a.channel_id} className={`card account-card ${!a.monitoring || a.status === 'revoking' ? 'alert' : ''}`}>
              <div className="row">
                <Avatar name={a.holder_name ?? a.name} src={a.connection?.account?.avatar || a.avatar} size={44} />
                <div className="grow">
                  <b>{a.holder_name ?? 'Chưa cấp cho ai'}</b>
                  <div className="muted small">
                    {a.name}
                    {a.phone ? ` · ${a.phone}` : ''}
                    {a.connection?.account?.name ? ` · Zalo: ${a.connection.account.name}` : ''}
                  </div>
                </div>
                {a.monitoring ? <Badge tone="green">Đang giám sát</Badge> : <Badge tone="danger">Mất giám sát</Badge>}
              </div>

              {(st === 'qr' || st === 'scanned') && (
                <div className="qr-box">
                  {st === 'qr' && a.connection?.qrImage && <img src={a.connection.qrImage} alt="Mã QR đăng nhập Zalo" className="qr" />}
                  {st === 'scanned' && <b>Đã quét, bấm xác nhận đăng nhập trên điện thoại</b>}
                  <ol className="steps">
                    <li>Mở Zalo trên điện thoại của nhân viên (SĐT {a.phone ?? 'công ty'}).</li>
                    <li>Bấm biểu tượng QR ở thanh tìm kiếm, quét mã này, bấm Đăng nhập.</li>
                  </ol>
                  <button className="btn ghost sm" onClick={() => channelCall(a.channel_id, 'cancel')}>
                    Hủy
                  </button>
                </div>
              )}

              <dl className="account-facts">
                <dt>Trạng thái</dt>
                <dd>
                  <Badge tone={STATUS_TONE[a.status]}>{a.status_label}</Badge>
                </dd>
                <dt>Giám sát</dt>
                <dd>
                  <span className={`status-dot ${a.monitoring ? 'ok' : 'bad'}`} />
                  {a.monitoring ? 'Đang lưu tin nhắn' : a.connection?.error ?? 'Chưa quét QR'}
                  {!a.monitoring && a.since_drop && <span className="muted small"> · từ {fullTime(a.since_drop)}</span>}
                </dd>
                <dt>Hôm nay</dt>
                <dd>
                  {a.today.customers} khách · {a.today.msg_in} tin khách · {a.today.msg_out} tin nhân viên
                  {a.today.undone > 0 && <span className="warn-text"> · {a.today.undone} tin thu hồi</span>}
                </dd>
                <dt>Cần chú ý</dt>
                <dd className={a.open_flags ? 'err-text' : ''}>{a.open_flags} tin</dd>
                <dt>Chờ trả lời</dt>
                <dd className={a.waiting ? 'err-text' : ''}>{a.waiting} khách</dd>
              </dl>

              <div className="row wrap">
                <a className="btn primary sm" href={`#/monitor/${a.channel_id}`}>
                  <Eye size={14} /> Xem tin nhắn
                </a>
                {!a.monitoring && st !== 'qr' && st !== 'scanned' && (
                  <button className="btn outline sm" onClick={() => channelCall(a.channel_id, 'login-qr')}>
                    <QrCode size={14} /> Quét QR
                  </button>
                )}
                <button className={`btn sm ${a.status === 'revoking' ? 'danger' : 'outline'}`} onClick={() => setHanding(a)}>
                  <ArrowRightLeft size={14} /> {a.holder_id ? 'Thu hồi / bàn giao' : 'Cấp cho nhân viên'}
                </button>
                <button className="btn ghost sm" onClick={() => setEditing(a)}>
                  <Pencil size={14} /> Hồ sơ SIM
                </button>
                <button className="btn ghost sm" onClick={() => setHistory(a)}>
                  <History size={14} /> Lịch sử
                </button>
                <button className="btn ghost sm" onClick={() => stopMonitoring(a)}>
                  Bỏ giám sát
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="banner info inline small">
        Trợ lý AI đọc tin Zalo nhân viên và quy tắc gắn cờ tin (số tài khoản, SĐT khác, từ khóa) nằm ở nhóm Giám sát & chất lượng:{' '}
        <a href="#/settings/ai">Trợ lý AI</a> · <a href="#/settings/flags">Gắn cờ tin cần chú ý</a>.
      </div>

      <div className="card notice">
        <h3>
          <Smartphone size={18} /> Lưu ý
        </h3>
        <ul>
          <li>
            App giám sát qua <b>phiên Zalo Web</b> của tài khoản nhân viên. Nhân viên vẫn chat trên điện thoại bình thường, nhưng
            <b> không mở Zalo PC / chat.zalo.me</b> bằng tài khoản này (sẽ đẩy phiên giám sát ra).
          </li>
          <li>
            Nhân viên có thể thấy và đăng xuất phiên web trong Zalo › Cài đặt › Tài khoản và bảo mật › Thiết bị đăng nhập. Khi đó app báo
            <b> "Mất giám sát"</b> và ghi vào Lịch sử; tin nhắn trong lúc mất kết nối có thể không được lưu.
          </li>
          <li>Tin nhân viên thu hồi vẫn còn trong app, có ghi giờ thu hồi. Tin xóa "chỉ ở phía tôi" trên điện thoại không ảnh hưởng bản lưu.</li>
          <li>Quản lý chỉ xem, không gửi tin thay nhân viên. Mỗi lần mở xem hội thoại được ghi nhật ký.</li>
          <li>Nên ghi rõ trong quy định / hợp đồng: SĐT và Zalo công ty cấp là tài sản công ty, nội dung chat với khách được giám sát.</li>
        </ul>
      </div>

      {adding && (
        <AddMonitorModal
          users={users.filter((u) => u.active)}
          sharedZalo={sharedZalo}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            load()
          }}
        />
      )}
      {editing && <AssetForm account={editing} statuses={data.statuses} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />}
      {handing && <HandoverModal account={handing} checklist={data.checklist} onClose={() => setHanding(null)} onDone={() => (setHanding(null), load())} />}
      {history && <HistoryModal account={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

type MonitorInfo = {
  monitoring: boolean
  since_drop: number | null
  open_flags: number
  today: { msg_in: number; msg_out: number; undone: number; customers: number; out_app?: number; out_phone?: number }
}

function AddMonitorModal({
  users,
  sharedZalo,
  onClose,
  onDone,
}: {
  users: { id: number; display_name: string }[]
  sharedZalo: { id: number; name: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [holder, setHolder] = useState('')
  const [existing, setExisting] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ channel_id: number }>('/monitor/accounts', {
        body: mode === 'existing' ? { channel_id: Number(existing) } : { name, phone, holder_id: holder ? Number(holder) : null },
      })
      // Tạo xong: mở luôn mã QR để quét bằng Zalo trên điện thoại nhân viên
      if (mode === 'new') await api(`/channels/${r.channel_id}/login-qr`, { method: 'POST' }).catch(() => {})
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Thêm Zalo nhân viên để giám sát" onClose={onClose}>
      <div className="stack">
        <div className="seg">
          <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>
            SĐT mới cấp
          </button>
          <button className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')} disabled={!sharedZalo.length}>
            Chuyển kênh Zalo có sẵn
          </button>
        </div>
        {mode === 'new' ? (
          <>
            <label className="field">
              <span>Số điện thoại công ty cấp</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="09xx xxx xxx" />
            </label>
            <label className="field">
              <span>Nhân viên nhận SIM</span>
              <select className="select" value={holder} onChange={(e) => setHolder(e.target.value)}>
                <option value="">Chọn nhân viên…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tên gọi (tùy chọn)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Zalo NV Kỳ Anh" />
            </label>
            <p className="muted small">Lưu xong app hiện mã QR: dùng Zalo trên điện thoại của nhân viên quét để bắt đầu giám sát.</p>
          </>
        ) : (
          <label className="field">
            <span>Kênh Zalo đang dùng chung</span>
            <select className="select" value={existing} onChange={(e) => setExisting(e.target.value)}>
              <option value="">Chọn kênh…</option>
              {sharedZalo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="muted small">Kênh sẽ rời hộp thư chung, chỉ người có quyền Giám sát và nhân viên giữ máy xem được.</span>
          </label>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy || (mode === 'new' ? !phone.trim() : !existing)} onClick={submit}>
            {mode === 'new' ? 'Lưu và quét QR' : 'Chuyển sang giám sát'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Cài đặt › Gắn cờ tin cần chú ý: từ khóa / dấu hiệu gắn cờ tin Zalo nhân viên */
export function KeywordSettings() {
  const [cfg, setCfg] = useState<{ bank: boolean; otherPhone: boolean; checkCustomer: boolean; keywords: string[] } | null>(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api<NonNullable<typeof cfg>>('/monitor/config').then((c) => {
      setCfg(c)
      setText(c.keywords.join(', '))
    })
  }, [])
  if (!cfg) return null
  async function save() {
    const c = await api<NonNullable<typeof cfg>>('/monitor/config', {
      method: 'PUT',
      body: { ...cfg, keywords: text.split(/[,\n]/).map((k) => k.trim()).filter(Boolean) },
    })
    setCfg(c)
    setText(c.keywords.join(', '))
    setMsg('Đã lưu')
  }
  return (
    <div className="card stack">
      <p className="small muted">
        Áp dụng cho Zalo nhân viên đang giám sát. Tin khớp quy tắc hiện ở Giám sát › <b>Tin cần chú ý</b> (cùng các tin Trợ lý AI tự phát hiện).
      </p>
      <label className="check">
        <input type="checkbox" checked={cfg.bank} onChange={(e) => setCfg({ ...cfg, bank: e.target.checked })} />
        Nhân viên gửi số tài khoản ngân hàng / ví
      </label>
      <label className="check">
        <input type="checkbox" checked={cfg.otherPhone} onChange={(e) => setCfg({ ...cfg, otherPhone: e.target.checked })} />
        Nhân viên gửi số điện thoại khác số công ty cấp
      </label>
      <label className="check">
        <input type="checkbox" checked={cfg.checkCustomer} onChange={(e) => setCfg({ ...cfg, checkCustomer: e.target.checked })} />
        Kiểm tra cả tin của khách
      </label>
      <label className="field">
        <span>Từ khóa (cách nhau bằng dấu phẩy, không phân biệt dấu)</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        {msg && <span className="small ok-text">{msg}</span>}
        <span className="grow" />
        <button className="btn primary sm" onClick={save}>
          Lưu
        </button>
      </div>
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
