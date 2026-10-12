import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, LogIn, LogOut, MessagesSquare, Plus, QrCode, RefreshCw, Settings2, Smartphone, Users } from 'lucide-react'
import { api, authUrl } from '../api'
import { useApp } from '../store'
import type { Channel, User, ZaloStatus } from '../types'
import { Avatar, Badge, Modal, PublicLink } from '../components'
import { PLATFORM_LABEL, PlatformBadge, platformOf } from '../platform'
import type { Platform } from '../types'

export default function Channels() {
  const { channels, zaloStatuses, departments, users, reloadSettings, reloadUsers, can: allowed } = useApp()
  const [editing, setEditing] = useState<Channel | 'new' | null>(null)
  const [adding, setAdding] = useState(false)
  const [fbKey, setFbKey] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const isAdmin = allowed('channels.manage')

  // Quay về từ trang đăng nhập Facebook / TikTok: #/channels/<kết quả>
  useEffect(() => {
    const raw = window.location.hash.split('/')[2]
    if (!raw) return
    const q = new URLSearchParams(decodeURIComponent(raw))
    if (q.get('error')) setFlash({ ok: false, text: q.get('error')! })
    else if (q.get('connected')) setFlash({ ok: true, text: 'Đã kết nối kênh mới. Gán bộ phận và nhân viên cho kênh bên dưới.' })
    if (q.get('connect') === 'facebook' && q.get('key')) setFbKey(q.get('key'))
    history.replaceState(null, '', '#/channels')
    reloadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusOf = (c: Channel) => zaloStatuses.find((s) => s.channelId === c.id) ?? c.status
  const visible = isAdmin ? channels : channels.filter((c) => c.active)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Kênh Chat</h1>
          <p className="muted">
            {isAdmin
              ? 'Mỗi kênh là một tài khoản Zalo, Fanpage Facebook, tài khoản TikTok hoặc shop TikTok. Kết nối kênh, chọn bộ phận được xem và phân công nhân viên vào kênh.'
              : 'Các kênh chat bạn được phân công. Tick chọn kênh đang trực để hộp thư chỉ hiện hội thoại của các kênh đó.'}
          </p>
        </div>
        {isAdmin && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={18} /> Thêm kênh
          </button>
        )}
      </div>

      {flash && (
        <div className={`banner ${flash.ok ? 'ok' : 'warn'} inline`}>
          {flash.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {flash.text}
          <button className="btn ghost sm" onClick={() => setFlash(null)}>
            Đóng
          </button>
        </div>
      )}

      <WorkingChannels channels={visible} />
      {isAdmin && <PublicLink />}

      {visible.length === 0 && (
        <div className="card center pad">
          <QrCode size={40} className="muted" />
          <div>
            {isAdmin
              ? 'Chưa có kênh nào. Bấm "Thêm kênh" để kết nối tài khoản đầu tiên.'
              : 'Bạn chưa được phân công kênh nào. Nhờ quản lý thêm bạn vào kênh hoặc bộ phận.'}
          </div>
        </div>
      )}

      <div className="channel-grid">
        {visible.map((c) =>
          isAdmin ? (
            <ChannelCard key={c.id} channel={c} status={statusOf(c)} onEdit={() => setEditing(c)} />
          ) : (
            <AgentChannelCard key={c.id} channel={c} status={statusOf(c)} />
          ),
        )}
      </div>

      {isAdmin && channels.length > 0 && <AssignmentMatrix />}

      <div className="card notice">
        <h3>
          <Smartphone size={18} /> Lưu ý khi dùng các kênh
        </h3>
        <ul>
          <li>
            <b>Facebook Messenger:</b> chỉ trả lời được trong 24 giờ kể từ tin cuối của khách. <b>Bình luận:</b> trả lời công khai bất kỳ
            lúc nào, nhắn riêng được 1 lần cho mỗi bình luận trong 7 ngày.
          </li>
          <li>
            <b>TikTok:</b> trả lời trong 48 giờ, tối đa 10 tin cho mỗi lần khách nhắn. <b>TikTok Shop:</b> chỉ gửi chữ, tối đa 2000 ký
            tự.
          </li>
          <li>
            Mỗi tài khoản Zalo chỉ cho <b>một phiên web</b>. Đừng mở chat.zalo.me hoặc Zalo PC bằng tài khoản đã gắn vào app.
            Ứng dụng trên điện thoại vẫn dùng bình thường.
          </li>
          <li>
            Kết nối dùng thư viện không chính thức (zca-js). Zalo có thể khóa tài khoản nếu gửi hàng loạt. Chỉ dùng để trả lời
            khách.
          </li>
          <li>Tin gửi trực tiếp từ điện thoại vẫn được lưu nhưng ghi "Gửi từ điện thoại", không gắn tên nhân viên.</li>
          {isAdmin && <li>Tắt kênh thì giữ nguyên lịch sử chat để training. Chỉ xóa được kênh chưa có hội thoại nào.</li>}
        </ul>
      </div>

      {adding && (
        <AddChannelModal
          onClose={() => setAdding(false)}
          onZalo={() => {
            setAdding(false)
            setEditing('new')
          }}
          onConnected={(text) => {
            setAdding(false)
            setFlash({ ok: true, text })
            reloadSettings()
          }}
        />
      )}
      {fbKey && (
        <FacebookPagePicker
          pendingKey={fbKey}
          onClose={() => setFbKey(null)}
          onDone={(n) => {
            setFbKey(null)
            setFlash({ ok: true, text: `Đã kết nối ${n} Fanpage. Gán bộ phận và nhân viên cho kênh bên dưới.` })
            reloadSettings()
          }}
        />
      )}
      {editing && (
        <ChannelForm
          channel={editing === 'new' ? null : editing}
          departments={departments}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadSettings()
            reloadUsers()
          }}
        />
      )}
    </div>
  )
}

/** Tick chọn kênh đang chat: một kênh, nhiều kênh, hoặc tất cả. Hộp thư chỉ hiện các kênh đã chọn. */
function WorkingChannels({ channels }: { channels: Channel[] }) {
  const { workingChannelIds, setWorkingChannels, zaloStatuses } = useApp()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const allSelected = !workingChannelIds
  const selected = (id: number) => allSelected || workingChannelIds!.includes(id)

  async function save(ids: number[] | null) {
    setSaving(true)
    setError('')
    try {
      // Chọn đủ mọi kênh = "tất cả" (kênh mới được phân công sau này cũng tự hiện).
      await setWorkingChannels(ids && ids.length && ids.length < channels.length ? ids : null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function toggle(id: number, on: boolean) {
    const current = allSelected ? channels.map((c) => c.id) : workingChannelIds!
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id)
    if (!next.length) {
      setError('Chọn ít nhất 1 kênh')
      return
    }
    void save(next)
  }

  if (channels.length < 2) return null

  return (
    <div className="card working-card">
      <div className="row wrap">
        <h3 className="grow">
          <MessagesSquare size={18} /> Kênh đang chat
        </h3>
        <button className={`btn sm ${allSelected ? 'primary' : 'outline'}`} disabled={saving} onClick={() => save(null)}>
          Tất cả kênh
        </button>
      </div>
      <div className="working-list">
        {channels.map((c) => {
          const st = zaloStatuses.find((s) => s.channelId === c.id)
          return (
            <label key={c.id} className={`working-item ${selected(c.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected(c.id)} disabled={saving} onChange={(e) => toggle(c.id, e.target.checked)} />
              <span className={`status-dot ${st?.state === 'connected' ? 'ok' : 'bad'}`} />
              {c.name}
            </label>
          )
        })}
      </div>
      <p className="muted small">
        {allSelected
          ? 'Đang hiện hội thoại của mọi kênh bạn được phân công.'
          : `Hộp thư chỉ hiện ${workingChannelIds!.length} kênh đã chọn. Tin nhắn ở kênh khác vẫn được lưu, bỏ chọn không làm mất dữ liệu.`}
      </p>
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}

function AgentChannelCard({ channel: c, status }: { channel: Channel; status: ZaloStatus | null }) {
  const state = status?.state ?? 'disconnected'
  return (
    <div className="card channel-card">
      <div className="channel-head">
        <Avatar name={status?.account?.name ?? c.zalo_name ?? c.name} src={status?.account?.avatar ?? c.avatar} size={48} />
        <div className="grow">
          <div className="channel-name">
            {c.name} <PlatformBadge platform={c.platform} />
          </div>
          <div className="muted small">{status?.account?.name ?? c.zalo_name ?? 'Chưa gắn tài khoản'}</div>
        </div>
        <ChannelState state={state} />
      </div>
      {state !== 'connected' && (
        <div className="muted small">Kênh đang mất kết nối. Báo quản lý kết nối lại để tiếp tục nhận/gửi tin.</div>
      )}
      <a className="btn outline sm" href="#/inbox" style={{ alignSelf: 'flex-start' }}>
        <MessagesSquare size={14} /> Mở hộp thư
      </a>
    </div>
  )
}

/** Bảng phân công: tick nhân viên × kênh để phân công nhiều người, nhiều kênh cùng lúc. */
function AssignmentMatrix() {
  const { users, channels, departments, reloadUsers } = useApp()
  const agents = users.filter((u) => u.active && !u.super_admin && !u.permissions?.includes('conversations.all'))
  const initial = () => Object.fromEntries(agents.map((u) => [u.id, u.channel_ids ?? []])) as Record<number, number[]>
  const [grid, setGrid] = useState<Record<number, number[]>>(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  // Tải lại khi danh sách nhân viên thay đổi (thêm người, đổi quyền ở nơi khác)
  const usersKey = agents.map((u) => `${u.id}:${(u.channel_ids ?? []).join('.')}`).join('|')
  useEffect(() => {
    setGrid(initial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersKey])

  const has = (uid: number, cid: number) => grid[uid]?.includes(cid) ?? false
  const viaDept = (u: (typeof agents)[number], cid: number) =>
    departments.some((d) => (u.department_ids ?? []).includes(d.id) && d.channel_ids.includes(cid))
  const set = (uid: number, cid: number, on: boolean) =>
    setGrid((g) => ({ ...g, [uid]: on ? [...new Set([...(g[uid] ?? []), cid])] : (g[uid] ?? []).filter((x) => x !== cid) }))
  const setColumn = (cid: number, on: boolean) =>
    setGrid((g) =>
      Object.fromEntries(
        Object.entries(g).map(([uid, list]) => [uid, on ? [...new Set([...list, cid])] : list.filter((x) => x !== cid)]),
      ),
    )
  const dirty = agents.some((u) => (u.channel_ids ?? []).slice().sort().join() !== (grid[u.id] ?? []).slice().sort().join())

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      await api('/channel-assignments', {
        method: 'PUT',
        body: { assignments: Object.entries(grid).map(([user_id, channel_ids]) => ({ user_id: Number(user_id), channel_ids })) },
      })
      reloadUsers()
      setMsg('Đã lưu phân công')
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!agents.length) return null

  return (
    <div className="card">
      <div className="row wrap">
        <h3 className="grow">
          <Users size={18} /> Phân công nhân viên vào kênh
        </h3>
        {msg && <span className="small muted">{msg}</span>}
        <button className="btn primary sm" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Đang lưu…' : 'Lưu phân công'}
        </button>
      </div>
      <p className="muted small">
        Tick để nhân viên vào thẳng kênh (thấy toàn bộ hội thoại của kênh). Dấu chấm xanh = đã thấy kênh qua bộ phận. Tick ô tiêu
        đề để chọn cả cột.
      </p>
      <div className="table-wrap">
        <table className="table matrix">
          <thead>
            <tr>
              <th>Nhân viên</th>
              {channels.map((c) => {
                const all = agents.every((u) => has(u.id, c.id))
                return (
                  <th key={c.id} className="center-cell">
                    <label className="matrix-head">
                      <input type="checkbox" checked={all} onChange={(e) => setColumn(c.id, e.target.checked)} />
                      <span>{c.name}</span>
                    </label>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {agents.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="row">
                    <Avatar name={u.display_name} size={26} />
                    {u.display_name}
                  </span>
                </td>
                {channels.map((c) => (
                  <td key={c.id} className="center-cell">
                    <label className="matrix-cell" title={viaDept(u, c.id) ? 'Đã thấy kênh này qua bộ phận' : undefined}>
                      <input type="checkbox" checked={has(u.id, c.id)} onChange={(e) => set(u.id, c.id, e.target.checked)} />
                      {viaDept(u, c.id) && <span className="via-dept" />}
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChannelCard({ channel: c, status, onEdit }: { channel: Channel; status: ZaloStatus | null; onEdit: () => void }) {
  const { departments, reloadSettings } = useApp()
  const [busy, setBusy] = useState(false)
  const state = c.active ? status?.state ?? 'disconnected' : 'off'
  const platform = platformOf(c.platform)
  const isZalo = platform === 'zalo'

  async function call(action: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(true)
    try {
      await api(`/channels/${c.id}/${action}`, { method: 'POST' })
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy(false)
      reloadSettings()
    }
  }

  const { users } = useApp()
  const deptName = (id: number | null) => departments.find((d) => d.id === id)?.name
  const linked = c.department_ids.map((id) => departments.find((d) => d.id === id)).filter(Boolean)
  const direct = (c.user_ids ?? []).map((id) => users.find((u) => u.id === id)).filter(Boolean)

  return (
    <div className={`card channel-card ${c.active ? '' : 'dim'}`}>
      <div className="channel-head">
        <Avatar name={status?.account?.name ?? c.zalo_name ?? c.name} src={status?.account?.avatar ?? c.avatar} size={48} />
        <div className="grow">
          <div className="channel-name">
            {c.name} <PlatformBadge platform={c.platform} />
          </div>
          <div className="muted small">
            {status?.account?.name ?? c.zalo_name ?? (isZalo ? 'Chưa gắn tài khoản Zalo' : 'Chưa kết nối tài khoản')}
            {c.conversations !== undefined && ` · ${c.conversations} hội thoại`}
          </div>
        </div>
        <ChannelState state={state} />
        <button className="icon-btn" onClick={onEdit} aria-label={`Cài đặt kênh ${c.name}`}>
          <Settings2 size={18} />
        </button>
      </div>

      <div className="channel-meta">
        <span className="muted small">Bộ phận được xem:</span>
        {linked.length ? (
          linked.map((d) => (
            <span key={d!.id} className="dept-chip" style={{ '--chip': d!.color } as React.CSSProperties}>
              {d!.name}
            </span>
          ))
        ) : (
          <span className="small muted">Chưa gán bộ phận</span>
        )}
      </div>
      <div className="channel-meta">
        <span className="muted small">Nhân viên vào thẳng:</span>
        {direct.length ? (
          direct.map((u) => (
            <span key={u!.id} className="chip plain" title="Thấy toàn bộ hội thoại của kênh">
              <Avatar name={u!.display_name} size={18} /> {u!.display_name}
            </span>
          ))
        ) : (
          <span className="small muted">Không có</span>
        )}
      </div>
      {!linked.length && !direct.length && (
        <div className="small err-text">Chưa phân quyền — hiện chỉ quản trị viên thấy kênh này.</div>
      )}
      <div className="channel-meta">
        <span className="muted small">Tin nhắn mới vào:</span>
        <b className="small">{deptName(c.default_department_id) ?? 'Chưa thuộc bộ phận nào'}</b>
      </div>

      {(state === 'qr' || state === 'scanned') && (
        <div className="qr-box">
          {state === 'qr' && status?.qrImage && <img src={status.qrImage} alt="Mã QR đăng nhập Zalo" className="qr" />}
          {state === 'scanned' && (
            <div className="scanned">
              <Avatar name={status?.scannedBy?.name} src={status?.scannedBy?.avatar} size={80} />
              <b>{status?.scannedBy?.name}</b>
              <span className="muted">Đã quét — bấm xác nhận đăng nhập trên điện thoại</span>
            </div>
          )}
          <ol className="steps">
            <li>Mở Zalo trên điện thoại của tài khoản cần gắn vào kênh này.</li>
            <li>
              Bấm biểu tượng <b>QR</b> ở thanh tìm kiếm.
            </li>
            <li>Quét mã và bấm Đăng nhập.</li>
          </ol>
          <button className="btn ghost" onClick={() => call('cancel')}>
            Hủy
          </button>
        </div>
      )}

      {status?.error && state !== 'connected' && (
        <div className="banner warn inline">
          <AlertTriangle size={16} /> {status.error}
        </div>
      )}

      {c.active && !isZalo ? (
        <div className="row wrap">
          {state === 'connected' ? (
            <>
              <button className="btn outline sm" disabled={busy} onClick={() => call('reconnect')}>
                <RefreshCw size={14} /> Kết nối lại
              </button>
              <button
                className="btn danger sm"
                disabled={busy}
                onClick={() =>
                  call('logout', `Ngắt ${PLATFORM_LABEL[platform]} khỏi kênh "${c.name}"? Muốn dùng lại phải đăng nhập ủy quyền lại.`)
                }
              >
                <LogOut size={14} /> Ngắt kết nối
              </button>
            </>
          ) : state === 'connecting' ? (
            <span className="muted small row">
              <RefreshCw size={14} className="spin" /> Đang kết nối…
            </span>
          ) : (
            <>
              <a className="btn primary sm" href={authUrl(`/oauth/${OAUTH_SLUG[platform]}/start`)}>
                <LogIn size={14} /> Đăng nhập lại {PLATFORM_LABEL[platform]}
              </a>
              <button className="btn outline sm" disabled={busy} onClick={() => call('reconnect')}>
                <RefreshCw size={14} /> Thử lại
              </button>
            </>
          )}
        </div>
      ) : c.active ? (
        <div className="row wrap">
          {state === 'connected' ? (
            <>
              <button className="btn outline sm" disabled={busy} onClick={() => call('reconnect')}>
                <RefreshCw size={14} /> Kết nối lại
              </button>
              <button
                className="btn danger sm"
                disabled={busy}
                onClick={() =>
                  call('logout', `Ngắt Zalo khỏi kênh "${c.name}"? Kênh này sẽ không nhận/gửi được tin cho tới khi quét QR lại.`)
                }
              >
                <LogOut size={14} /> Ngắt kết nối
              </button>
            </>
          ) : state === 'connecting' ? (
            <span className="muted small row">
              <RefreshCw size={14} className="spin" /> Đang kết nối…
            </span>
          ) : state !== 'qr' && state !== 'scanned' ? (
            <>
              <button className="btn primary sm" disabled={busy} onClick={() => call('login-qr')}>
                <QrCode size={14} /> Quét QR đăng nhập
              </button>
              {c.zalo_uid && (
                <button className="btn outline sm" disabled={busy} onClick={() => call('reconnect')}>
                  <RefreshCw size={14} /> Thử phiên đã lưu
                </button>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <div className="muted small">Kênh đang tắt. Bật lại trong phần cài đặt kênh.</div>
      )}
    </div>
  )
}

function ChannelState({ state }: { state: string }) {
  if (state === 'connected')
    return (
      <Badge tone="green">
        <CheckCircle2 size={12} /> Đã kết nối
      </Badge>
    )
  if (state === 'off') return <Badge>Đã tắt</Badge>
  if (state === 'connecting') return <Badge tone="info">Đang kết nối</Badge>
  if (state === 'qr' || state === 'scanned') return <Badge tone="lime">Chờ quét QR</Badge>
  return <Badge tone="warning">Chưa kết nối</Badge>
}

function ChannelForm({
  channel,
  departments,
  users,
  onClose,
  onSaved,
}: {
  channel: Channel | null
  departments: { id: number; name: string; color: string }[]
  users: User[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(channel?.name ?? '')
  const [deptIds, setDeptIds] = useState<number[]>(channel?.department_ids ?? [])
  const [defaultDept, setDefaultDept] = useState<number | ''>(channel?.default_department_id ?? '')
  const [active, setActive] = useState(channel ? !!channel.active : true)
  const [userIds, setUserIds] = useState<number[]>(channel?.user_ids ?? [])
  const isSuper = !!useApp().user.super_admin
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const body = { name, department_ids: deptIds, default_department_id: defaultDept || null, active, user_ids: userIds }
    try {
      if (channel) await api(`/channels/${channel.id}`, { method: 'PATCH', body })
      else await api('/channels', { body })
      onSaved()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove() {
    if (!channel || !confirm(`Xóa kênh "${channel.name}"?`)) return
    try {
      await api(`/channels/${channel.id}`, { method: 'DELETE' })
      onSaved()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <Modal title={channel ? `Cài đặt kênh ${channel.name}` : 'Thêm kênh Zalo'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Tên kênh</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Zalo Bán hàng" autoFocus />
        </label>
        <div className="field">
          <span>Bộ phận được xem kênh này</span>
          {departments.length === 0 && <div className="muted small">Chưa có bộ phận. Tạo ở trang "Bộ phận, tag & tin nhắn mẫu".</div>}
          <div className="check-grid">
            {departments.map((d) => (
              <label key={d.id} className="check">
                <input
                  type="checkbox"
                  checked={deptIds.includes(d.id)}
                  onChange={(e) => setDeptIds(e.target.checked ? [...deptIds, d.id] : deptIds.filter((x) => x !== d.id))}
                />
                <span className="dept-chip" style={{ '--chip': d.color } as React.CSSProperties}>
                  {d.name}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Nhân viên được vào thẳng kênh</span>
          <span className="muted small">
            Thấy toàn bộ hội thoại của kênh này, không phụ thuộc bộ phận. Dùng cho trưởng nhóm hoặc người trực riêng một kênh.
          </span>
          <div className="check-grid">
            {users
              .filter((u) => u.active && !u.super_admin && !u.permissions?.includes('conversations.all'))
              .map((u) => (
                <label key={u.id} className="check">
                  <input
                    type="checkbox"
                    checked={userIds.includes(u.id)}
                    onChange={(e) => setUserIds(e.target.checked ? [...userIds, u.id] : userIds.filter((x) => x !== u.id))}
                  />
                  {u.display_name}
                </label>
              ))}
          </div>
        </div>
        <label className="field">
          <span>Tin nhắn mới vào bộ phận</span>
          <select className="select" value={defaultDept} onChange={(e) => setDefaultDept(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Chưa thuộc bộ phận nào (mọi bộ phận được xem kênh đều thấy)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {channel && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Kênh đang hoạt động (bỏ chọn để tắt kênh, vẫn giữ lịch sử chat)
          </label>
        )}
        {!channel && <p className="muted small">Lưu xong, bấm "Quét QR đăng nhập" trên thẻ kênh để gắn tài khoản Zalo.</p>}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          {channel && isSuper && (
            <button type="button" className="btn ghost" onClick={remove}>
              Xóa kênh
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={!name.trim()}>
            Lưu
          </button>
        </div>
      </form>
    </Modal>
  )
}

const OAUTH_SLUG: Record<Platform, string> = { zalo: '', facebook: 'facebook', tiktok: 'tiktok', tiktok_shop: 'tiktok-shop' }

type PlatformConfig = {
  meta: { configured: boolean }
  tiktok: { configured: boolean; authUrl?: string }
  tiktok_shop: { configured: boolean; serviceId?: string }
}

/** Chọn nền tảng để thêm kênh: Zalo (QR), Facebook, TikTok, TikTok Shop (đăng nhập ủy quyền). */
function AddChannelModal({ onClose, onZalo, onConnected }: { onClose: () => void; onZalo: () => void; onConnected: (text: string) => void }) {
  const { can: allowed } = useApp()
  const [cfg, setCfg] = useState<PlatformConfig | null>(null)
  const [pageToken, setPageToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api<PlatformConfig>('/platform-config')
      .then(setCfg)
      .catch((e) => setError(e.message))
  }, [])

  async function connectToken() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ name: string }>('/platform-connect/facebook-token', { body: { page_token: pageToken } })
      setPageToken('')
      onConnected(`Đã kết nối Fanpage "${r.name}".`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const needConfig = (label: string) => (
    <div className="muted small">
      Chưa nhập thông tin app {label}.{' '}
      {allowed('integrations.manage') ? (
        <a href="#/settings/integrations" onClick={onClose}>
          Nhập ở Cài đặt › Tích hợp
        </a>
      ) : (
        'Nhờ quản trị viên nhập ở Cài đặt › Tích hợp.'
      )}
    </div>
  )

  return (
    <Modal title="Thêm kênh chat" onClose={onClose}>
      <div className="stack">
        <div className="platform-option">
          <div className="row">
            <PlatformBadge platform="zalo" />
            <b className="grow">Tài khoản Zalo</b>
          </div>
          <div className="muted small">Tạo kênh rồi quét mã QR bằng Zalo trên điện thoại.</div>
          <button className="btn primary sm" onClick={onZalo}>
            <QrCode size={14} /> Thêm kênh Zalo
          </button>
        </div>

        <div className="platform-option">
          <div className="row">
            <PlatformBadge platform="facebook" />
            <b className="grow">Fanpage Facebook: Messenger và bình luận</b>
          </div>
          {!cfg ? (
            <div className="muted small">Đang tải…</div>
          ) : cfg.meta.configured ? (
            <>
              <div className="muted small">Đăng nhập Facebook bằng tài khoản quản trị Fanpage, sau đó chọn các trang cần kết nối.</div>
              <a className="btn primary sm" href={authUrl('/oauth/facebook/start')}>
                <LogIn size={14} /> Đăng nhập Facebook
              </a>
              <details>
                <summary className="small">Hoặc dán Page Access Token</summary>
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    className="grow"
                    type="password"
                    autoComplete="off"
                    value={pageToken}
                    onChange={(e) => setPageToken(e.target.value)}
                    placeholder="Page Access Token (lấy ở Graph API Explorer)"
                  />
                  <button className="btn outline sm" disabled={busy || !pageToken.trim()} onClick={connectToken}>
                    <KeyRound size={14} /> Kết nối
                  </button>
                </div>
              </details>
            </>
          ) : (
            needConfig('Meta (Facebook)')
          )}
        </div>

        <div className="platform-option">
          <div className="row">
            <PlatformBadge platform="tiktok" />
            <b className="grow">Tài khoản TikTok Business: tin nhắn</b>
          </div>
          {!cfg ? null : cfg.tiktok.configured && cfg.tiktok.authUrl ? (
            <>
              <div className="muted small">Đăng nhập TikTok bằng tài khoản doanh nghiệp và cho phép quyền nhắn tin.</div>
              <a className="btn primary sm" href={authUrl('/oauth/tiktok/start')}>
                <LogIn size={14} /> Đăng nhập TikTok
              </a>
            </>
          ) : (
            needConfig('TikTok for Business')
          )}
        </div>

        <div className="platform-option">
          <div className="row">
            <PlatformBadge platform="tiktok_shop" />
            <b className="grow">TikTok Shop: chat với người mua</b>
          </div>
          {!cfg ? null : cfg.tiktok_shop.configured && cfg.tiktok_shop.serviceId ? (
            <>
              <div className="muted small">Đăng nhập Seller Center và ủy quyền cho app. Mỗi shop thành một kênh.</div>
              <a className="btn primary sm" href={authUrl('/oauth/tiktok-shop/start')}>
                <LogIn size={14} /> Đăng nhập TikTok Shop
              </a>
            </>
          ) : (
            needConfig('TikTok Shop')
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}

/** Sau khi đăng nhập Facebook: chọn Fanpage cần kết nối. */
function FacebookPagePicker({ pendingKey, onClose, onDone }: { pendingKey: string; onClose: () => void; onDone: (n: number) => void }) {
  const [pages, setPages] = useState<{ id: string; name: string; picture: string; connected: boolean }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api<typeof pages>(`/platform-connect/facebook/${pendingKey}`)
      .then((list) => {
        setPages(list)
        setPicked((list ?? []).filter((p) => !p.connected).map((p) => p.id))
      })
      .catch((e) => setError(e.message))
  }, [pendingKey])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ channel_ids: number[] }>(`/platform-connect/facebook/${pendingKey}`, { body: { page_ids: picked } })
      onDone(r.channel_ids.length)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Chọn Fanpage cần kết nối" onClose={onClose}>
      <div className="stack">
        {!pages && !error && <div className="muted">Đang tải danh sách trang…</div>}
        {pages?.length === 0 && <div className="muted">Tài khoản này không quản trị Fanpage nào, hoặc chưa cấp quyền cho trang khi đăng nhập.</div>}
        {pages?.map((p) => (
          <label key={p.id} className="check page-pick">
            <input
              type="checkbox"
              checked={picked.includes(p.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
            />
            <Avatar name={p.name} src={p.picture} size={32} />
            <span className="grow">{p.name}</span>
            {p.connected && <Badge tone="green">Đã có kênh, sẽ cập nhật token</Badge>}
          </label>
        ))}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <a className="btn ghost" href="https://business.facebook.com/" target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Meta Business Suite
          </a>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy || !picked.length} onClick={save}>
            {busy ? 'Đang kết nối…' : `Kết nối ${picked.length} trang`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
