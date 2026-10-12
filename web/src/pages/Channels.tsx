import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, LogOut, MessagesSquare, Plus, QrCode, RefreshCw, Settings2, Smartphone, Users } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { Channel, User, ZaloStatus } from '../types'
import { Avatar, Badge, Modal, PublicLink } from '../components'

export default function Channels() {
  const { user, channels, zaloStatuses, departments, users, reloadSettings, reloadUsers } = useApp()
  const [editing, setEditing] = useState<Channel | 'new' | null>(null)
  const isAdmin = user.role === 'admin'

  const statusOf = (c: Channel) => zaloStatuses.find((s) => s.channelId === c.id) ?? c.status
  const visible = isAdmin ? channels : channels.filter((c) => c.active)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Kênh Chat</h1>
          <p className="muted">
            {isAdmin
              ? 'Mỗi kênh là một tài khoản Zalo. Kết nối kênh, chọn bộ phận được xem và phân công nhân viên vào kênh.'
              : 'Các kênh Zalo bạn được phân công. Tick chọn kênh đang trực để hộp thư chỉ hiện hội thoại của các kênh đó.'}
          </p>
        </div>
        {isAdmin && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={18} /> Thêm kênh
          </button>
        )}
      </div>

      <WorkingChannels channels={visible} />
      {isAdmin && <PublicLink />}

      {visible.length === 0 && (
        <div className="card center pad">
          <QrCode size={40} className="muted" />
          <div>
            {isAdmin
              ? 'Chưa có kênh Zalo nào. Bấm "Thêm kênh" để kết nối tài khoản đầu tiên.'
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
          <Smartphone size={18} /> Lưu ý khi dùng Zalo cá nhân
        </h3>
        <ul>
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
          <div className="channel-name">{c.name}</div>
          <div className="muted small">{status?.account?.name ?? c.zalo_name ?? 'Chưa gắn tài khoản Zalo'}</div>
        </div>
        <ChannelState state={state} />
      </div>
      {state !== 'connected' && (
        <div className="muted small">Kênh đang mất kết nối Zalo. Báo quản lý quét lại mã QR để tiếp tục nhận/gửi tin.</div>
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
  const agents = users.filter((u) => u.active && u.role !== 'admin')
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
          <div className="channel-name">{c.name}</div>
          <div className="muted small">
            {status?.account?.name ?? c.zalo_name ?? 'Chưa gắn tài khoản Zalo'}
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

      {c.active ? (
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
              .filter((u) => u.active && u.role !== 'admin')
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
          {channel && (
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
