import { useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, Send, Trash2, Webhook } from 'lucide-react'
import { api } from '../api'
import { Badge, Modal } from '../components'
import { fullTime } from '../util'

type ApiKey = { id: number; name: string; prefix: string; created_at: number; last_used_at: number | null }
type Hook = { id: number; url: string; events: string[]; active: number; last_status: string | null; created_at: number }

function copy(text: string) {
  void navigator.clipboard?.writeText(text)
}

export default function Integrations() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [hooks, setHooks] = useState<Hook[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [keyName, setKeyName] = useState('')
  const [hookUrl, setHookUrl] = useState('')
  const [hookEvents, setHookEvents] = useState<string[]>([])
  const [secretShown, setSecretShown] = useState<{ title: string; value: string; hint: string } | null>(null)
  const [error, setError] = useState('')

  const reload = () => {
    api<ApiKey[]>('/api-keys').then(setKeys)
    api<Hook[]>('/webhooks').then(setHooks)
  }
  useEffect(() => {
    reload()
    api<string[]>('/webhook-events').then(setEvents)
  }, [])

  async function createKey() {
    setError('')
    try {
      const r = await api<{ key: string; name: string }>('/api-keys', { body: { name: keyName } })
      setKeyName('')
      setSecretShown({
        title: `API key cho "${r.name}"`,
        value: r.key,
        hint: 'Key chỉ hiển thị một lần. Lưu vào biến môi trường của web app kia (VD: ZALO_CSKH_API_KEY).',
      })
      reload()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function createHook() {
    setError('')
    try {
      const r = await api<{ secret: string }>('/webhooks', { body: { url: hookUrl, events: hookEvents } })
      setHookUrl('')
      setHookEvents([])
      setSecretShown({
        title: 'Secret ký webhook',
        value: r.secret,
        hint: 'Dùng secret này để xác minh header X-Zalo-CSKH-Signature (HMAC-SHA256 của body).',
      })
      reload()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const origin = window.location.origin

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tích hợp với web app khác</h1>
          <p className="muted">
            Cho các hệ thống bạn đang xây dựng (CRM, đơn hàng, bảo hành…) đọc hội thoại, gửi tin và nhận sự kiện realtime.
          </p>
        </div>
      </div>
      {error && <div className="banner warn inline">{error}</div>}

      <div className="grid-2">
        <div className="card">
          <h3>
            <KeyRound size={18} /> API key
          </h3>
          <div className="row">
            <input
              className="input grow"
              placeholder="Tên web app, VD: CRM bảo hành"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
            <button className="btn primary" onClick={createKey} disabled={!keyName.trim()}>
              <Plus size={16} /> Tạo key
            </button>
          </div>
          <ul className="list">
            {keys.map((k) => (
              <li key={k.id}>
                <div>
                  <b>{k.name}</b> <code className="muted">{k.prefix}…</code>
                  <div className="muted small">
                    Tạo {fullTime(k.created_at)} · {k.last_used_at ? `Dùng lần cuối ${fullTime(k.last_used_at)}` : 'Chưa dùng'}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  aria-label={`Thu hồi key ${k.name}`}
                  onClick={async () => {
                    if (!confirm(`Thu hồi key "${k.name}"? Web app đang dùng key này sẽ mất quyền truy cập.`)) return
                    await api(`/api-keys/${k.id}`, { method: 'DELETE' })
                    reload()
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
            {!keys.length && <li className="muted">Chưa có API key.</li>}
          </ul>
        </div>

        <div className="card">
          <h3>
            <Webhook size={18} /> Webhook
          </h3>
          <input
            className="input"
            placeholder="https://crm.cua-ban.vn/webhooks/zalo"
            value={hookUrl}
            onChange={(e) => setHookUrl(e.target.value)}
          />
          <div className="event-checks">
            {events.map((ev) => (
              <label key={ev} className="check">
                <input
                  type="checkbox"
                  checked={hookEvents.includes(ev)}
                  onChange={(e) => setHookEvents(e.target.checked ? [...hookEvents, ev] : hookEvents.filter((x) => x !== ev))}
                />
                <code>{ev}</code>
              </label>
            ))}
            <span className="muted small">Không chọn = nhận tất cả sự kiện.</span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={createHook} disabled={!hookUrl.trim()}>
              <Plus size={16} /> Thêm webhook
            </button>
            {hooks.length > 0 && (
              <button className="btn ghost" onClick={() => api('/webhooks/test', { method: 'POST' }).then(() => setTimeout(reload, 2500))}>
                <Send size={16} /> Gửi thử
              </button>
            )}
          </div>
          <ul className="list">
            {hooks.map((h) => (
              <li key={h.id}>
                <div className="grow">
                  <div className="row">
                    <code className="break">{h.url}</code>
                    {h.active ? <Badge tone="green">Bật</Badge> : <Badge>Tắt</Badge>}
                  </div>
                  <div className="muted small">{h.events.join(', ')}</div>
                  {h.last_status && <div className={`small ${h.last_status.startsWith('OK') ? 'ok-text' : 'err-text'}`}>{h.last_status}</div>}
                </div>
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    await api(`/webhooks/${h.id}`, { method: 'PATCH', body: { active: !h.active } })
                    reload()
                  }}
                >
                  {h.active ? 'Tắt' : 'Bật'}
                </button>
                <button
                  className="icon-btn"
                  aria-label="Xóa webhook"
                  onClick={async () => {
                    if (!confirm('Xóa webhook này?')) return
                    await api(`/webhooks/${h.id}`, { method: 'DELETE' })
                    reload()
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card docs">
        <h3>Tài liệu API nhanh</h3>
        <p className="muted small">
          Mọi request gửi header <code>X-API-Key: zck_…</code>. Base URL: <code>{origin}/api/v1</code>
        </p>
        <table className="table api-table">
          <tbody>
            {[
              ['GET', '/status', 'Trạng thái kết nối Zalo'],
              ['GET', '/users', 'Danh sách nhân viên'],
              ['GET', '/conversations?status=open&q=&limit=50', 'Danh sách hội thoại (mới nhất trước)'],
              ['GET', '/conversations/by-ref/{maKH}', 'Tìm hội thoại theo mã khách hàng đã gắn'],
              ['GET', '/conversations/{id}', 'Chi tiết hội thoại'],
              ['PATCH', '/conversations/{id}', 'Cập nhật: status, tags, external_ref, assigned_to'],
              ['GET', '/conversations/{id}/messages?before=&limit=', 'Tin nhắn của hội thoại'],
              ['POST', '/conversations/{id}/messages', 'Gửi tin: { text, agent_username? } hoặc multipart có files'],
              ['POST', '/conversations/{id}/notes', 'Thêm ghi chú nội bộ: { content }'],
              ['GET', '/stats?from=2026-10-01&to=2026-10-31', 'Thống kê hiệu suất nhân viên'],
              ['GET', '/export?format=json|csv|txt|jsonl&from=&to=&agentId=', 'Xuất dữ liệu hội thoại'],
            ].map(([m, p, d]) => (
              <tr key={m + p}>
                <td>
                  <Badge tone={m === 'GET' ? 'info' : m === 'POST' ? 'green' : 'lime'}>{m}</Badge>
                </td>
                <td>
                  <code className="break">{p}</code>
                </td>
                <td className="muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Ví dụ gửi tin từ web app khác</h4>
        <pre className="code">{`curl -X POST ${origin}/api/v1/conversations/<threadId>/messages \\
  -H "X-API-Key: zck_..." -H "Content-Type: application/json" \\
  -d '{"text":"Đơn hàng của bạn đã được giao","agent_username":"lan"}'`}</pre>
        <h4>Mở thẳng hội thoại từ app khác</h4>
        <pre className="code">{`${origin}/?c=<threadId>`}</pre>
        <h4>Webhook payload</h4>
        <pre className="code">{`POST <url của bạn>
X-Zalo-CSKH-Event: message.received
X-Zalo-CSKH-Signature: sha256=<hmac_sha256(secret, body)>

{ "event": "message.received", "timestamp": 1760000000000,
  "data": { "message": { "text": "...", "direction": "in", ... },
            "conversation": { "id": "...", "name": "...", "external_ref": "KH001", ... } } }`}</pre>
      </div>

      {secretShown && (
        <Modal title={secretShown.title} onClose={() => setSecretShown(null)}>
          <div className="stack">
            <div className="secret">
              <code className="break">{secretShown.value}</code>
              <button className="icon-btn" onClick={() => copy(secretShown.value)} aria-label="Sao chép">
                <Copy size={16} />
              </button>
            </div>
            <p className="muted small">{secretShown.hint}</p>
            <div className="row end">
              <button className="btn primary" onClick={() => setSecretShown(null)}>
                Đã lưu
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
