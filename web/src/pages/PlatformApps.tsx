import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Copy, ExternalLink, Save, Webhook } from 'lucide-react'
import { api } from '../api'
import { Badge } from '../components'
import { PlatformBadge } from '../platform'

type Urls = {
  metaWebhook: string
  metaRedirect: string
  tiktokWebhook: string
  tiktokRedirect: string
  tiktokShopWebhook: string
  tiktokShopRedirect: string
}
type Config = {
  meta: { configured: boolean; appId?: string; appSecret?: string; verifyToken?: string; graphVersion?: string }
  tiktok: { configured: boolean; appId?: string; secret?: string; authUrl?: string }
  tiktok_shop: { configured: boolean; appKey?: string; appSecret?: string; serviceId?: string }
  urls: Urls
}

/** Ô chỉ đọc kèm nút sao chép (URL callback, verify token) */
function CopyField({ label, value }: { label: string; value?: string }) {
  const [done, setDone] = useState(false)
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row">
        <input className="grow mono" readOnly value={value ?? ''} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn outline sm"
          onClick={() => {
            void navigator.clipboard?.writeText(value ?? '')
            setDone(true)
            window.setTimeout(() => setDone(false), 1500)
          }}
        >
          {done ? <CheckCircle2 size={14} /> : <Copy size={14} />} {done ? 'Đã chép' : 'Chép'}
        </button>
      </div>
    </label>
  )
}

function AppCard({
  platform,
  title,
  configured,
  docs,
  children,
}: {
  platform: string
  title: string
  configured: boolean
  docs: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <div className="card stack">
      <div className="row wrap">
        <PlatformBadge platform={platform} />
        <h3 className="grow">{title}</h3>
        {configured ? <Badge tone="green">Đã nhập app</Badge> : <Badge tone="warning">Chưa nhập app</Badge>}
      </div>
      {children}
      <a className="small" href={docs.href} target="_blank" rel="noreferrer">
        <ExternalLink size={12} /> {docs.label}
      </a>
    </div>
  )
}

/**
 * Thông tin app nhà phát triển của Facebook / TikTok / TikTok Shop.
 * Bí mật (App Secret) do quản trị viên tự nhập; để trống khi lưu = giữ giá trị cũ.
 */
export default function PlatformApps() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [busy, setBusy] = useState('')

  const load = () =>
    api<Config>('/platform-config')
      .then((c) => {
        setCfg(c)
        setForm({
          'meta.appId': c.meta.appId ?? '',
          'tiktok.appId': c.tiktok.appId ?? '',
          'tiktok.authUrl': c.tiktok.authUrl ?? '',
          'tiktok_shop.appKey': c.tiktok_shop.appKey ?? '',
          'tiktok_shop.serviceId': c.tiktok_shop.serviceId ?? '',
        })
      })
      .catch((e) => setMsg({ all: { ok: false, text: e.message } }))
  useEffect(() => {
    void load()
  }, [])

  const field = (key: string, label: string, opts: { secret?: string; placeholder?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      <input
        type={opts.secret !== undefined ? 'password' : 'text'}
        autoComplete="off"
        value={form[key] ?? ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={opts.secret ? `Đã lưu (${opts.secret}). Để trống nếu không đổi` : opts.placeholder}
      />
    </label>
  )

  async function save(kind: 'meta' | 'tiktok' | 'tiktok_shop') {
    setBusy(kind)
    const body = Object.fromEntries(
      Object.entries(form)
        .filter(([k]) => k.startsWith(`${kind}.`))
        .map(([k, v]) => [k.slice(kind.length + 1), v]),
    )
    try {
      await api(`/platform-config/${kind}`, { method: 'PUT', body })
      setMsg({ ...msg, [kind]: { ok: true, text: 'Đã lưu' } })
      // Xóa ô bí mật vừa nhập khỏi màn hình
      setForm((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !/secret/i.test(k))))
      await load()
    } catch (e: any) {
      setMsg({ ...msg, [kind]: { ok: false, text: e.message } })
    } finally {
      setBusy('')
    }
  }

  async function registerTikTokWebhook() {
    setBusy('tiktok-hook')
    try {
      await api('/platform-config/tiktok/register-webhook', { method: 'POST' })
      setMsg({ ...msg, tiktok: { ok: true, text: 'Đã đăng ký webhook với TikTok' } })
    } catch (e: any) {
      setMsg({ ...msg, tiktok: { ok: false, text: e.message } })
    } finally {
      setBusy('')
    }
  }

  const status = (kind: string) =>
    msg[kind] && <span className={`small ${msg[kind].ok ? 'ok-text' : 'err-text'}`}>{msg[kind].text}</span>

  if (!cfg) return msg.all ? <div className="banner warn inline">{msg.all.text}</div> : null

  return (
    <div className="stack platform-apps">
      <div>
        <h2>Kết nối Facebook và TikTok</h2>
        <p className="muted">
          Nhập thông tin app nhà phát triển một lần ở đây, rồi vào <a href="#/channels">Kênh Chat › Thêm kênh</a> để đăng nhập Fanpage, tài
          khoản TikTok hoặc shop. Chép các đường dẫn bên dưới vào trang quản lý app của từng nền tảng.
        </p>
      </div>
      <div className="grid-3">
        <AppCard
          platform="facebook"
          title="Meta App (Messenger, bình luận)"
          configured={cfg.meta.configured}
          docs={{ href: 'https://developers.facebook.com/apps/', label: 'Mở Meta for Developers' }}
        >
          {field('meta.appId', 'App ID')}
          {field('meta.appSecret', 'App Secret', { secret: cfg.meta.appSecret ?? '' })}
          <CopyField label="Callback URL (Webhooks › Page)" value={cfg.urls.metaWebhook} />
          <CopyField label="Verify token" value={cfg.meta.verifyToken ?? 'Có sau khi lưu App ID'} />
          <CopyField label="Valid OAuth Redirect URI (Facebook Login)" value={cfg.urls.metaRedirect} />
          <div className="row">
            {status('meta')}
            <span className="grow" />
            <button className="btn primary sm" disabled={busy === 'meta'} onClick={() => save('meta')}>
              <Save size={14} /> Lưu
            </button>
          </div>
        </AppCard>

        <AppCard
          platform="tiktok"
          title="TikTok for Business (tin nhắn)"
          configured={cfg.tiktok.configured}
          docs={{ href: 'https://business-api.tiktok.com/portal/apps', label: 'Mở TikTok API for Business' }}
        >
          {field('tiktok.appId', 'App ID')}
          {field('tiktok.secret', 'Secret', { secret: cfg.tiktok.secret ?? '' })}
          {field('tiktok.authUrl', 'Link ủy quyền (Advertiser authorization URL)', { placeholder: 'https://business-api.tiktok.com/portal/auth?app_id=...' })}
          <CopyField label="Redirect URL" value={cfg.urls.tiktokRedirect} />
          <CopyField label="Webhook URL" value={cfg.urls.tiktokWebhook} />
          <div className="row wrap">
            {status('tiktok')}
            <span className="grow" />
            <button className="btn outline sm" disabled={!cfg.tiktok.configured || busy === 'tiktok-hook'} onClick={registerTikTokWebhook}>
              <Webhook size={14} /> Đăng ký webhook
            </button>
            <button className="btn primary sm" disabled={busy === 'tiktok'} onClick={() => save('tiktok')}>
              <Save size={14} /> Lưu
            </button>
          </div>
        </AppCard>

        <AppCard
          platform="tiktok_shop"
          title="TikTok Shop Partner (chat người mua)"
          configured={cfg.tiktok_shop.configured}
          docs={{ href: 'https://partner.tiktokshop.com/', label: 'Mở TikTok Shop Partner Center' }}
        >
          {field('tiktok_shop.appKey', 'App Key')}
          {field('tiktok_shop.appSecret', 'App Secret', { secret: cfg.tiktok_shop.appSecret ?? '' })}
          {field('tiktok_shop.serviceId', 'Service ID')}
          <CopyField label="Redirect URL" value={cfg.urls.tiktokShopRedirect} />
          <CopyField label="Webhook URL (tự đăng ký khi kết nối shop)" value={cfg.urls.tiktokShopWebhook} />
          <div className="row">
            {status('tiktok_shop')}
            <span className="grow" />
            <button className="btn primary sm" disabled={busy === 'tiktok_shop'} onClick={() => save('tiktok_shop')}>
              <Save size={14} /> Lưu
            </button>
          </div>
        </AppCard>
      </div>
    </div>
  )
}
