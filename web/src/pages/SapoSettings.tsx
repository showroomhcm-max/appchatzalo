import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api } from '../api'
import { Badge } from '../components'

type SapoConfig = { enabled: boolean; store: string; apiKey: string; apiSecret: string; webhookSecret: string; ready: boolean; orders: number }

/** Cài đặt › Đồng bộ Sapo: đã chuẩn bị luồng dữ liệu, chưa bật kết nối thật. */
export default function SapoSettings() {
  const [cfg, setCfg] = useState<SapoConfig | null>(null)
  const [form, setForm] = useState({ store: '', apiKey: '', apiSecret: '', webhookSecret: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<SapoConfig>('/sapo/config')
      .then((c) => {
        setCfg(c)
        setForm({ store: c.store, apiKey: c.apiKey, apiSecret: '', webhookSecret: '' })
      })
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [])

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const c = await api<SapoConfig>('/sapo/config', { method: 'PUT', body: form })
      setCfg(c)
      setForm({ store: c.store, apiKey: c.apiKey, apiSecret: '', webhookSecret: '' })
      setMsg({ ok: true, text: 'Đã lưu' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const origin = window.location.origin
  return (
    <div className="card settings-panel stack">
      <div className="row wrap panel-head">
        <h2 className="grow">Đồng bộ Sapo POS</h2>
        <Badge tone="warning">Đang chuẩn bị, chưa bật</Badge>
      </div>
      <p className="muted">
        Khi bật, đơn hàng tạo trên Sapo sẽ tự gắn vào hội thoại của khách theo số điện thoại. Nhờ vậy cảnh báo "chưa tạo đơn" tự tắt khi khách
        đã có đơn, cảnh báo "chưa đẩy vận chuyển" theo dõi được đơn chưa giao, và khung thông tin khách hiện các đơn của khách.
      </p>

      <div className="sapo-flow">
        <div>
          <b>1. Đơn mới trên Sapo</b>
          <span className="muted small">Sapo gửi webhook (đơn mới, cập nhật, giao vận chuyển) về app.</span>
        </div>
        <div>
          <b>2. Ghép vào hội thoại</b>
          <span className="muted small">Tìm hội thoại gần nhất có cùng số điện thoại khách (số khách nhắn trong chat cũng được nhận ra).</span>
        </div>
        <div>
          <b>3. Cảnh báo tự cập nhật</b>
          <span className="muted small">Có đơn thì tắt "chưa tạo đơn"; đơn quá giờ chưa giao thì bật "chưa đẩy vận chuyển".</span>
        </div>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>Tên cửa hàng Sapo</span>
          <div className="row">
            <input value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} placeholder="memoryzone" />
            <span className="muted small">.mysapo.net</span>
          </div>
        </label>
        <label className="field">
          <span>API key (ứng dụng riêng)</span>
          <input value={form.apiKey} autoComplete="off" onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </label>
        <label className="field">
          <span>Mật khẩu API (API secret)</span>
          <input
            type="password"
            autoComplete="off"
            value={form.apiSecret}
            onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
            placeholder={cfg?.apiSecret ? `Đã lưu (${cfg.apiSecret}). Để trống nếu không đổi` : ''}
          />
        </label>
        <label className="field">
          <span>Khóa ký webhook</span>
          <input
            type="password"
            autoComplete="off"
            value={form.webhookSecret}
            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            placeholder={cfg?.webhookSecret ? `Đã lưu (${cfg.webhookSecret}). Để trống nếu không đổi` : ''}
          />
        </label>
      </div>
      <label className="field">
        <span>Webhook URL (dán vào Sapo khi bật)</span>
        <input className="mono" readOnly value={`${origin}/webhooks/sapo`} onFocus={(e) => e.target.select()} />
      </label>
      <p className="muted small">
        Trong lúc chờ: web bán hàng / hệ thống khác có thể đẩy đơn vào qua API <code>POST /api/v1/orders</code> (kèm số điện thoại khách) để
        gắn đơn với hội thoại. Xem mục API & Webhook.
      </p>
      <div className="row">
        {msg && <span className={`small ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
        <span className="grow" />
        <button className="btn primary" disabled={busy} onClick={save}>
          <Save size={16} /> Lưu thông tin
        </button>
      </div>
    </div>
  )
}
