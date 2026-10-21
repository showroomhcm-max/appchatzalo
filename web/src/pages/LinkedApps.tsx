import { useEffect, useState, type ReactNode } from 'react'
import { ClipboardList, Copy, KeyRound, PlugZap, Save, Wrench } from 'lucide-react'
import { api } from '../api'
import { Badge } from '../components'

type LinkCfg = { enabled: boolean; url: string; hasKey: boolean; keyHint: string; keyCreatedAt: number | null }
type TestResult = { ok: boolean; ms: number; chat_reachable?: boolean | null; chat_error?: string | null }

/** Cài đặt › Kết nối app & API › App nội bộ: app DVKT (dịch vụ kỹ thuật) + app Báo cáo công việc CSKH. */
export default function LinkedApps() {
  return (
    <>
      <KeyedAppSettings
        base="/report-link"
        icon={<ClipboardList size={18} />}
        title="App Báo cáo công việc CSKH"
        placeholder="https://baocaocskh.sieutoc.com"
        secretName="CHAT_LINK_KEY"
        folder="D:\APPBAOCAOCSKH"
        version="1.0"
        description={
          <>
            Nhân viên mở app báo cáo và bấm <b>Đăng nhập bằng Chat Siêu Tốc</b> là vào thẳng, không phải nhập mật khẩu lại. Số liệu chat của từng người (tin đã
            gửi, hội thoại, thời gian phản hồi, đánh giá, đơn POS lên từ chat, cảnh báo đơn "rơi" đã xử lý) tự điền vào báo cáo ngày. Nhân viên ghi
            thêm việc đã làm, đơn chốt, khó khăn, kế hoạch; quản lý (người có quyền xem Dữ liệu) duyệt và xem tổng hợp theo tuần / tháng.
          </>
        }
      />
      <KeyedAppSettings
        base="/dvkt"
        icon={<Wrench size={18} />}
        title="App Dịch vụ kỹ thuật (DVKT)"
        placeholder="https://dvktkythuat.sieutoc.com"
        secretName="CHAT_SIEUTOC_KEY"
        folder="D:\APPDVKT\cloudflare"
        version="3.20"
        description={
          <>
            Đang chat với khách, khung <b>Thông tin</b> hiện vé dịch vụ kỹ thuật, đơn giao hàng / hỗ trợ kỹ thuật và phiếu bảo hành của khách (tìm
            theo số điện thoại): giai đoạn, kỹ thuật viên phụ trách, dịch vụ đã làm. Chỉ đọc, không sửa gì bên DVKT hay Odoo. Ngược lại, ở app DVKT
            cạnh nút gọi khách có nút <b>Nhắn</b> mở thẳng hội thoại của khách trong Chat Siêu Tốc.
          </>
        }
      />
    </>
  )
}

function KeyedAppSettings(p: { base: string; icon: ReactNode; title: string; placeholder: string; secretName: string; folder: string; version: string; description: ReactNode }) {
  const [cfg, setCfg] = useState<LinkCfg | null>(null)
  const [url, setUrl] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  const apply = (c: LinkCfg) => {
    setCfg(c)
    setUrl(c.url)
  }
  useEffect(() => {
    api<LinkCfg>(`${p.base}/config`)
      .then(apply)
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [p.base])

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
      apply(await api<LinkCfg>(`${p.base}/config`, { method: 'PUT', body: { url, ...(enabled !== undefined ? { enabled } : {}) } }))
      return enabled === undefined ? 'Đã lưu' : enabled ? 'Đã bật kết nối' : 'Đã tắt kết nối'
    })

  const rotate = () => {
    if (cfg?.hasKey && !confirm('Tạo khóa mới thì khóa cũ hết hiệu lực ngay — app kia sẽ báo sai khóa cho tới khi đặt khóa mới vào. Tiếp tục?')) return
    void run('key', async () => {
      const r = await api<{ key: string; config: LinkCfg }>(`${p.base}/key`, { method: 'POST' })
      apply(r.config)
      setNewKey(r.key)
      setCopied(false)
      return 'Đã tạo khóa mới. Chép khóa sang app kia theo hướng dẫn bên dưới.'
    })
  }

  if (!cfg) return msg ? <div className="banner warn inline">{msg.text}</div> : null

  return (
    <div className="card settings-panel stack">
      <div className="row wrap panel-head">
        <h2 className="grow">
          {p.icon} {p.title}
        </h2>
        {cfg.enabled ? <Badge tone="green">Đang bật</Badge> : <Badge tone="warning">Chưa bật</Badge>}
      </div>
      <p className="muted">{p.description}</p>

      <label className="field">
        <span>Địa chỉ app</span>
        <input name={`${p.base.slice(1)}-url`} autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={p.placeholder} />
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
              Mở cửa sổ lệnh ở thư mục <code>{p.folder}</code>, chạy <code>npx wrangler secret put {p.secretName}</code>, dán khóa vừa chép rồi Enter.
            </li>
            <li>
              Cập nhật app lên bản có kết nối ({p.version}): <code>npx wrangler deploy</code>.
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
              const r = await api<TestResult>(`${p.base}/test`, { body: { url } })
              if (r.chat_reachable === false) throw new Error(`App nhận khóa (${r.ms} ms) nhưng chưa gọi ngược được Chat Siêu Tốc: ${r.chat_error ?? 'lỗi không rõ'}`)
              return `Kết nối được (${r.ms} ms)`
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
