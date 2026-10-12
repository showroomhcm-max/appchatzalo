import { useEffect, useState } from 'react'
import { PlugZap, Save } from 'lucide-react'
import { api } from '../api'
import { Badge } from '../components'
import { PLATFORM_LABEL, PLATFORM_ORDER } from '../platform'

type Cfg = {
  enabled: boolean
  url: string
  db: string
  login: string
  apiKey: string
  configId: number | null
  kenhBan: Record<string, number | null>
  ready: boolean
  orders: number
  pending: number
}
type TestResult = { ok: boolean; uid: number; configs: { id: number; name: string; session: string | null; open: boolean }[]; kenhBan: { id: number; name: string }[] }

/** Đồng bộ đơn hàng POS: lên đơn trên POS Odoo từ hội thoại. */
export default function OdooPosSettings() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [form, setForm] = useState({ url: '', db: '', login: '', apiKey: '' })
  const [configId, setConfigId] = useState<string>('')
  const [kenhBan, setKenhBan] = useState<Record<string, string>>({})
  const [test, setTest] = useState<TestResult | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  const apply = (c: Cfg) => {
    setCfg(c)
    setForm({ url: c.url, db: c.db, login: c.login, apiKey: '' })
    setConfigId(c.configId ? String(c.configId) : '')
    setKenhBan(Object.fromEntries(Object.entries(c.kenhBan).map(([k, v]) => [k, v ? String(v) : ''])))
  }
  useEffect(() => {
    api<Cfg>('/odoo-pos/config')
      .then(apply)
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [])

  async function runTest() {
    setBusy('test')
    setMsg(null)
    try {
      const r = await api<TestResult>('/odoo-pos/test', { body: form })
      setTest(r)
      setMsg({ ok: true, text: `Kết nối được Odoo, thấy ${r.configs.length} điểm bán POS.` })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy('')
    }
  }

  async function save(enabled?: boolean) {
    setBusy('save')
    setMsg(null)
    try {
      const c = await api<Cfg>('/odoo-pos/config', {
        method: 'PUT',
        body: { ...form, configId: configId || null, kenhBan, ...(enabled !== undefined ? { enabled } : {}) },
      })
      apply(c)
      setMsg({ ok: true, text: enabled === undefined ? 'Đã lưu' : enabled ? 'Đã bật lên đơn POS' : 'Đã tắt lên đơn POS' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy('')
    }
  }

  if (!cfg) return msg ? <div className="banner warn inline">{msg.text}</div> : null

  return (
    <div className="card settings-panel stack">
      <div className="row wrap panel-head">
        <h2 className="grow">Đồng bộ đơn hàng POS (Odoo)</h2>
        {cfg.enabled ? <Badge tone="green">Đang bật</Badge> : <Badge tone="warning">Chưa bật</Badge>}
      </div>
      <p className="muted">
        Nhân viên lên đơn ngay trong hội thoại: chọn sản phẩm, số lượng, giá → đơn tạo trên <b>POS Odoo</b> (trạng thái nháp) ở điểm bán được chọn,
        gắn khách theo số điện thoại, ghi tên nhân viên bán và kênh bán. Thu ngân mở đơn trên POS để thanh toán. Ca POS chưa mở thì đơn chờ trong
        app và tự đẩy lên khi mở ca. Trạng thái đơn được lấy về mỗi 2 phút để tắt cảnh báo "chưa tạo đơn".
      </p>

      <div className="grid-2">
        <label className="field">
          <span>Địa chỉ Odoo</span>
          <input name="odoo-pos-url" autoComplete="off" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://erp.sieutoc.com" />
        </label>
        <label className="field">
          <span>Database</span>
          <input name="odoo-pos-db" autoComplete="off" value={form.db} onChange={(e) => setForm({ ...form, db: e.target.value })} placeholder="SieuToc" />
        </label>
        <label className="field">
          <span>Tài khoản Odoo tích hợp (login)</span>
          <input name="odoo-pos-integration-login" autoComplete="off" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="VD: api.chat@sieutoc.com" />
          <span className="muted small">Nên tạo riêng một tài khoản cho app, quyền: Điểm bán hàng (người dùng), đọc sản phẩm, tạo khách hàng.</span>
        </label>
        <label className="field">
          <span>API key của tài khoản đó</span>
          <input
            name="odoo-pos-integration-key"
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder={cfg.apiKey ? `Đã lưu (${cfg.apiKey}). Để trống nếu không đổi` : 'Odoo › Hồ sơ › Bảo mật › API Keys'}
          />
          <span className="muted small">Dùng API key, không dùng mật khẩu đăng nhập cá nhân.</span>
        </label>
      </div>
      <div className="row">
        <button className="btn outline" disabled={busy === 'test'} onClick={runTest}>
          <PlugZap size={16} /> {busy === 'test' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
        </button>
        {msg && <span className={`small ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
      </div>

      {test && (
        <>
          <label className="field">
            <span>Điểm bán mặc định</span>
            <select className="select" value={configId} onChange={(e) => setConfigId(e.target.value)}>
              <option value="">Chọn điểm bán…</option>
              {test.configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.open ? `· đang mở ca ${c.session ?? ''}` : '· chưa mở ca'}
                </option>
              ))}
            </select>
            <span className="muted small">Nhân viên vẫn chọn được điểm bán khác khi lên đơn.</span>
          </label>
          {test.kenhBan.length > 0 && (
            <div className="field">
              <span>Kênh bán ghi trên đơn (theo nền tảng chat)</span>
              <div className="grid-2 tight">
                {(['default', ...PLATFORM_ORDER] as string[]).map((p) => (
                  <label key={p} className="field">
                    <span className="small muted">{p === 'default' ? 'Mặc định' : PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL]}</span>
                    <select className="select sm" value={kenhBan[p] ?? ''} onChange={(e) => setKenhBan({ ...kenhBan, [p]: e.target.value })}>
                      <option value="">{p === 'default' ? 'Không ghi' : 'Theo mặc định'}</option>
                      {test.kenhBan.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="row wrap">
        <span className="small muted grow">
          {cfg.orders} đơn đã lên từ chat{cfg.pending ? ` · ${cfg.pending} đơn chờ ca POS mở` : ''}
        </span>
        {cfg.enabled && (
          <button
            className="btn ghost"
            disabled={!!busy}
            onClick={async () => {
              setBusy('sync')
              try {
                apply(await api<Cfg>('/odoo-pos/sync', { method: 'POST' }))
                setMsg({ ok: true, text: 'Đã đồng bộ trạng thái đơn' })
              } catch (e: any) {
                setMsg({ ok: false, text: e.message })
              } finally {
                setBusy('')
              }
            }}
          >
            Đồng bộ ngay
          </button>
        )}
        <button className="btn outline" disabled={!!busy} onClick={() => save()}>
          <Save size={16} /> Lưu
        </button>
        {cfg.enabled ? (
          <button className="btn danger" disabled={!!busy} onClick={() => save(false)}>
            Tắt lên đơn POS
          </button>
        ) : (
          <button className="btn primary" disabled={!!busy || !(cfg.ready || (form.login && form.apiKey))} onClick={() => save(true)}>
            Bật lên đơn POS
          </button>
        )}
      </div>
    </div>
  )
}
