import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { api } from '../api'

type Config = {
  noReply: { enabled: boolean; minutes: number }
  noOrder: { enabled: boolean; minutes: number; phone: boolean; address: boolean; keyword: boolean; keywords: string[] }
  noShipping: { enabled: boolean; minutes: number }
  updatedBy?: string | null
  updatedAt?: number | null
}

const DURATIONS: [number, string][] = [
  [15, '15 phút'],
  [30, '30 phút'],
  [60, '1 tiếng'],
  [120, '2 tiếng'],
  [240, '4 tiếng'],
  [480, '8 tiếng'],
  [1440, '1 ngày'],
]

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function Duration({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const options = DURATIONS.some(([m]) => m === value) ? DURATIONS : [...DURATIONS, [value, `${value} phút`] as [number, string]]
  return (
    <select className="select sm duration" value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map(([m, label]) => (
        <option key={m} value={m}>
          {label}
        </option>
      ))}
    </select>
  )
}

/** Cài đặt › Cảnh báo đơn "rơi" */
export default function AlertsSettings() {
  const [saved, setSaved] = useState<Config | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [keywords, setKeywords] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api<Config>('/alerts/config')
      .then((c) => {
        setSaved(c)
        setCfg(c)
        setKeywords(c.noOrder.keywords.join(', '))
      })
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [])

  if (!cfg || !saved) return msg ? <div className="banner warn inline">{msg.text}</div> : <div className="muted">Đang tải…</div>

  const keywordList = keywords
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean)
  const dirty = JSON.stringify({ ...cfg, noOrder: { ...cfg.noOrder, keywords: keywordList } }) !== JSON.stringify(saved)
  const set = <K extends 'noReply' | 'noOrder' | 'noShipping'>(key: K, patch: Partial<Config[K]>) => setCfg({ ...cfg, [key]: { ...cfg[key], ...patch } })

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const c = await api<Config>('/alerts/config', { method: 'PUT', body: { ...cfg, noOrder: { ...cfg!.noOrder, keywords: keywordList } } })
      setSaved(c)
      setCfg(c)
      setKeywords(c.noOrder.keywords.join(', '))
      setMsg({ ok: true, text: 'Đã lưu' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card settings-panel alerts-settings">
      <div className="row wrap panel-head">
        <h2 className="grow">Cảnh báo đơn "rơi"</h2>
        {saved.updatedBy && saved.updatedAt && (
          <span className="muted small">
            Cập nhật lần cuối bởi {saved.updatedBy} lúc {new Date(saved.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
        )}
        {msg && <span className={`small ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
        <button className="btn primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
      </div>
      <p className="muted">
        Hệ thống tự phát hiện các hội thoại và đơn hàng có nguy cơ bị bỏ sót, không được xử lý kịp thời, rồi gắn cảnh báo vào hội thoại và
        báo cho nhân viên: tăng tỉ lệ phản hồi nhanh, không bỏ lỡ khách tiềm năng và đẩy vận chuyển đúng thời gian.
      </p>

      <section className="alert-rule">
        <h3>Cảnh báo chưa phản hồi</h3>
        <div className="rule-line">
          <Toggle on={cfg.noReply.enabled} onChange={(v) => set('noReply', { enabled: v })} label="Bật cảnh báo chưa phản hồi" />
          <span>Khi hội thoại chưa được phản hồi sau</span>
          <Duration value={cfg.noReply.minutes} onChange={(v) => set('noReply', { minutes: v })} disabled={!cfg.noReply.enabled} />
          <span>kể từ thời điểm khách tương tác cuối cùng</span>
        </div>
      </section>

      <section className="alert-rule">
        <h3>
          Cảnh báo chưa tạo đơn{' '}
          <span className="hint-icon" title="Khách đã để lại số điện thoại, địa chỉ hoặc nói từ khóa mua hàng nhưng chưa có đơn nào gắn với hội thoại. Đơn được gắn tự động khi kết nối Sapo, hoặc khi hệ thống khác đẩy đơn qua API.">
            <Info size={14} />
          </span>
        </h3>
        <div className="rule-line">
          <Toggle on={cfg.noOrder.enabled} onChange={(v) => set('noOrder', { enabled: v })} label="Bật cảnh báo chưa tạo đơn" />
          <span>Khi tiếp cận khách hàng tiềm năng chưa tạo đơn sau</span>
          <Duration value={cfg.noOrder.minutes} onChange={(v) => set('noOrder', { minutes: v })} disabled={!cfg.noOrder.enabled} />
        </div>
        <div className="rule-options">
          <label className="check">
            <input type="checkbox" disabled={!cfg.noOrder.enabled} checked={cfg.noOrder.phone} onChange={(e) => set('noOrder', { phone: e.target.checked })} />
            Hội thoại có số điện thoại
          </label>
          <label className="check">
            <input type="checkbox" disabled={!cfg.noOrder.enabled} checked={cfg.noOrder.address} onChange={(e) => set('noOrder', { address: e.target.checked })} />
            Hội thoại có địa chỉ khách hàng
          </label>
          <label className="check">
            <input type="checkbox" disabled={!cfg.noOrder.enabled} checked={cfg.noOrder.keyword} onChange={(e) => set('noOrder', { keyword: e.target.checked })} />
            Hội thoại có từ khóa
          </label>
          {cfg.noOrder.enabled && cfg.noOrder.keyword && (
            <label className="field keyword-field">
              <span className="small muted">Từ khóa, cách nhau bằng dấu phẩy (không phân biệt dấu, hoa thường)</span>
              <textarea rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="chốt đơn, đặt hàng, ship cho em" />
            </label>
          )}
        </div>
      </section>

      <section className="alert-rule">
        <h3>
          Cảnh báo chưa đẩy vận chuyển{' '}
          <span className="hint-icon" title="Cần đơn hàng gắn với hội thoại (Sapo POS hoặc hệ thống khác đẩy qua API). Khi chưa kết nối Sapo, cảnh báo này chưa có dữ liệu để chạy.">
            <Info size={14} />
          </span>
        </h3>
        <div className="rule-line">
          <Toggle on={cfg.noShipping.enabled} onChange={(v) => set('noShipping', { enabled: v })} label="Bật cảnh báo chưa đẩy vận chuyển" />
          <span>Khi hội thoại có đơn hàng đã tạo nhưng chưa đẩy vận chuyển sau</span>
          <Duration value={cfg.noShipping.minutes} onChange={(v) => set('noShipping', { minutes: v })} disabled={!cfg.noShipping.enabled} />
        </div>
      </section>

      <p className="muted small">
        Cảnh báo hiện thành nhãn đỏ trên hội thoại, ở bộ lọc "Cảnh báo" trong Hộp thư và số đếm trên menu Hội thoại. Cảnh báo tự tắt khi đã trả
        lời, đã có đơn hoặc đã giao vận chuyển; nhân viên cũng có thể bấm "Đã xử lý" trong khung thông tin khách.
      </p>
    </div>
  )
}
