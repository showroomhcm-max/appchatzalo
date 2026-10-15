import { useEffect, useState } from 'react'
import { ClipboardList, Copy, KeyRound, PlugZap, Save, Wrench } from 'lucide-react'
import { api } from '../api'
import { Badge } from '../components'

type DvktCfg = { enabled: boolean; url: string; hasKey: boolean; keyHint: string; keyCreatedAt: number | null }

/** Cài đặt › Kết nối app nội bộ: app DVKT (dịch vụ kỹ thuật) + app báo cáo công việc. */
export default function LinkedApps() {
  return (
    <>
      <DvktSettings />
      <WorkReportCard />
    </>
  )
}

function DvktSettings() {
  const [cfg, setCfg] = useState<DvktCfg | null>(null)
  const [url, setUrl] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  const apply = (c: DvktCfg) => {
    setCfg(c)
    setUrl(c.url)
  }
  useEffect(() => {
    api<DvktCfg>('/dvkt/config')
      .then(apply)
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [])

  async function run(kind: string, fn: () => Promise<string>) {
    setBusy(kind)
    setMsg(null)
    try {
      setMsg({ ok: true, text: await fn() })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy('')
    }
  }

  const save = (enabled?: boolean) =>
    run('save', async () => {
      apply(await api<DvktCfg>('/dvkt/config', { method: 'PUT', body: { url, ...(enabled !== undefined ? { enabled } : {}) } }))
      return enabled === undefined ? 'Đã lưu' : enabled ? 'Đã bật kết nối DVKT' : 'Đã tắt kết nối DVKT'
    })

  const rotate = () => {
    if (cfg?.hasKey && !confirm('Tạo khóa mới thì khóa cũ hết hiệu lực ngay — app DVKT sẽ báo sai khóa cho tới khi đặt khóa mới vào. Tiếp tục?')) return
    void run('key', async () => {
      const r = await api<{ key: string; config: DvktCfg }>('/dvkt/key', { method: 'POST' })
      apply(r.config)
      setNewKey(r.key)
      setCopied(false)
      return 'Đã tạo khóa mới. Chép khóa sang app DVKT theo hướng dẫn bên dưới.'
    })
  }

  if (!cfg) return msg ? <div className="banner warn inline">{msg.text}</div> : null

  return (
    <div className="card settings-panel stack">
      <div className="row wrap panel-head">
        <h2 className="grow">
          <Wrench size={18} /> App Dịch vụ kỹ thuật (DVKT)
        </h2>
        {cfg.enabled ? <Badge tone="green">Đang bật</Badge> : <Badge tone="warning">Chưa bật</Badge>}
      </div>
      <p className="muted">
        Đang chat với khách, khung <b>Thông tin</b> hiện vé dịch vụ kỹ thuật, đơn giao hàng / hỗ trợ kỹ thuật và phiếu bảo hành của khách (tìm theo
        số điện thoại): giai đoạn, kỹ thuật viên phụ trách, dịch vụ đã làm. Chỉ đọc, không sửa gì bên DVKT hay Odoo. Ngược lại, ở app DVKT cạnh nút gọi
        khách có nút <b>Nhắn</b> mở thẳng hội thoại của khách trong Chat Siêu Tốc.
      </p>

      <label className="field">
        <span>Địa chỉ app DVKT</span>
        <input name="dvkt-url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://dvktkythuat.sieutoc.com" />
      </label>

      <div className="field">
        <span>Khóa kết nối</span>
        <div className="row wrap">
          <span className="grow small">
            {cfg.hasKey ? (
              <>
                Đã có khóa <code>{cfg.keyHint}</code>
                {cfg.keyCreatedAt ? ` · tạo ${new Date(cfg.keyCreatedAt).toLocaleString('vi-VN')}` : ''}
              </>
            ) : (
              <span className="muted">Chưa có khóa</span>
            )}
          </span>
          <button className="btn outline" disabled={!!busy} onClick={rotate}>
            <KeyRound size={16} /> {cfg.hasKey ? 'Tạo khóa mới' : 'Tạo khóa'}
          </button>
        </div>
      </div>

      {newKey && (
        <div className="banner info inline stack">
          <b>Khóa chỉ hiện một lần — chép ngay rồi đóng.</b>
          <div className="row">
            <code className="grow secret-box">{newKey}</code>
            <button
              className="btn outline sm"
              onClick={() => {
                void navigator.clipboard?.writeText(newKey)
                setCopied(true)
              }}
            >
              <Copy size={14} /> {copied ? 'Đã chép' : 'Chép'}
            </button>
          </div>
          <ol className="small steps">
            <li>
              Mở cửa sổ lệnh ở thư mục <code>D:\APPDVKT\cloudflare</code>, chạy <code>npx wrangler secret put CHAT_SIEUTOC_KEY</code>, dán khóa vừa chép rồi
              Enter.
            </li>
            <li>
              Cập nhật app DVKT lên bản có kết nối (v3.20): <code>npx wrangler deploy</code>.
            </li>
            <li>
              Quay lại đây bấm <b>Kiểm tra kết nối</b>, được thì bấm <b>Bật kết nối</b>.
            </li>
          </ol>
          <div>
            <button className="btn ghost sm" onClick={() => setNewKey(null)}>
              Đã chép xong, ẩn khóa
            </button>
          </div>
        </div>
      )}

      <div className="row wrap">
        <button
          className="btn outline"
          disabled={!!busy || !cfg.hasKey}
          onClick={() =>
            run('test', async () => {
              const r = await api<{ ok: boolean; ms: number }>('/dvkt/test', { body: { url } })
              return `Kết nối được app DVKT (${r.ms} ms)`
            })
          }
        >
          <PlugZap size={16} /> {busy === 'test' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
        </button>
        {msg && <span className={`small ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
      </div>

      <div className="row wrap">
        <span className="grow" />
        <button className="btn outline" disabled={!!busy} onClick={() => save()}>
          <Save size={16} /> Lưu
        </button>
        {cfg.enabled ? (
          <button className="btn danger" disabled={!!busy} onClick={() => save(false)}>
            Tắt kết nối
          </button>
        ) : (
          <button className="btn primary" disabled={!!busy || !cfg.hasKey} onClick={() => save(true)}>
            Bật kết nối
          </button>
        )}
      </div>
    </div>
  )
}

/** App báo cáo công việc: chưa có địa chỉ / mã nguồn — hiện cách app đó lấy số liệu CSKH qua API. */
function WorkReportCard() {
  return (
    <div className="card settings-panel stack">
      <div className="row wrap panel-head">
        <h2 className="grow">
          <ClipboardList size={18} /> App báo cáo công việc
        </h2>
        <Badge tone="neutral">Chờ thông tin app</Badge>
      </div>
      <p className="muted">
        App báo cáo công việc lấy số liệu chat của từng nhân viên theo ngày (số hội thoại xử lý, tin đã gửi, thời gian phản hồi, đánh giá) qua API của
        Chat Siêu Tốc: <code>GET /api/v1/work-report?date=2026-10-15</code>, kèm khóa tạo ở mục <b>API &amp; Webhook</b>. Nhân viên khớp theo email
        đăng nhập Odoo.
      </p>
    </div>
  )
}
