import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowRight, ArrowRightCircle, CheckCircle2, ExternalLink, KeyRound, LogIn, LogOut, Plus, QrCode, RefreshCw, Search, Settings2, Smartphone, Users } from 'lucide-react'
import { api, authUrl } from '../api'
import { useApp } from '../store'
import type { Channel, User, ZaloStatus } from '../types'
import { Avatar, Badge, Modal, PublicLink } from '../components'
import { PLATFORM_LABEL, PLATFORM_ORDER, PlatformBadge, PlatformDot, platformOf } from '../platform'
import { fold } from '../util'
import type { Platform } from '../types'

export default function Channels({ manage = false }: { manage?: boolean }) {
  const { channels: allChannels, chatChannels, zaloStatuses, departments, users, reloadSettings, reloadUsers, can: allowed, workingChannelIds, setWorkingChannels } = useApp()
  // Trang Kênh Chat (chọn kênh chat) không hiện Zalo nhân viên đang giám sát; trang Kết nối kênh hiện tất cả
  const channels = manage ? allChannels : chatChannels
  const [editing, setEditing] = useState<Channel | 'new' | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [fbKey, setFbKey] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [tab, setTab] = useState<Platform | 'all'>('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // Trang Kênh Chat (menu trên) chỉ để chọn kênh chat; kết nối / cài đặt kênh nằm ở Cài đặt › Tích hợp › Kết nối kênh
  const isAdmin = manage && allowed('channels.manage')

  // Quay về từ trang đăng nhập Facebook / TikTok / Zalo OA: #/channels/<kết quả>
  useEffect(() => {
    const raw = window.location.hash.split('/')[manage ? 3 : 2]
    if (!raw) return
    const params = new URLSearchParams(decodeURIComponent(raw))
    if (params.get('error')) setFlash({ ok: false, text: params.get('error')! })
    else if (params.get('connected')) setFlash({ ok: true, text: 'Đã kết nối kênh mới. Bấm vào kênh để gán bộ phận và nhân viên.' })
    if (params.get('connect') === 'facebook' && params.get('key')) setFbKey(params.get('key'))
    history.replaceState(null, '', manage ? '#/settings/channels' : '#/channels')
    reloadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusOf = (c: Channel) => zaloStatuses.find((s) => s.channelId === c.id) ?? c.status
  const activeList = channels.filter((c) => c.active)
  const inactiveList = isAdmin ? channels.filter((c) => !c.active) : []
  const matches = (c: Channel) => {
    if (tab !== 'all' && platformOf(c.platform) !== tab) return false
    if (!q.trim()) return true
    const st = statusOf(c)
    return fold(`${c.name} ${st?.account?.name ?? ''} ${st?.account?.id ?? ''} ${c.zalo_uid ?? ''}`).includes(fold(q.trim()))
  }
  const shownActive = activeList.filter(matches)
  const shownInactive = inactiveList.filter(matches)

  // Kênh đang chọn để chat (lưu khi bấm "Truy cập")
  const workingKey = `${(workingChannelIds ?? []).join(',')}|${activeList.map((c) => c.id).join(',')}`
  const [picked, setPicked] = useState<number[]>([])
  useEffect(() => {
    setPicked(workingChannelIds ? activeList.filter((c) => workingChannelIds.includes(c.id)).map((c) => c.id) : activeList.map((c) => c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingKey])
  const [pickedOff, setPickedOff] = useState<number[]>([])

  const toggle = (list: number[], set: (v: number[]) => void, id: number, on: boolean) =>
    set(on ? [...new Set([...list, id])] : list.filter((x) => x !== id))
  const allShownPicked = shownActive.length > 0 && shownActive.every((c) => picked.includes(c.id))

  async function access() {
    setBusy(true)
    try {
      await setWorkingChannels(picked.length >= activeList.length ? null : picked)
      window.location.hash = '#/inbox'
    } catch (e: any) {
      setFlash({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function activate(ids: number[]) {
    setBusy(true)
    try {
      for (const id of ids) await api(`/channels/${id}`, { method: 'PATCH', body: { active: true } })
      setPickedOff([])
      setFlash({ ok: true, text: `Đã kích hoạt ${ids.length} kênh.` })
    } catch (e: any) {
      setFlash({ ok: false, text: e.message })
    } finally {
      setBusy(false)
      reloadSettings()
    }
  }

  const count = (p: Platform | 'all') => channels.filter((c) => (isAdmin || c.active) && (p === 'all' || platformOf(c.platform) === p)).length
  const detail = channels.find((c) => c.id === detailId) ?? null

  const tile = (c: Channel, checked: boolean, onToggle: (on: boolean) => void) => (
    <ChannelTile key={c.id} channel={c} status={statusOf(c)} checked={checked} onToggle={onToggle} onOpen={() => setDetailId(c.id)} />
  )

  return (
    <div className={manage ? 'stack channels-page' : 'page channels-page'}>
      <div className="page-head">
        <div>
          <h1>{manage ? 'Kết nối kênh' : 'Kênh Chat'}</h1>
          <p className="muted">
            {isAdmin
              ? 'Kết nối Zalo, Zalo OA, Fanpage Facebook, TikTok, TikTok Shop. Bấm vào kênh để xem trạng thái, quét QR, gán bộ phận và nhân viên.'
              : 'Các kênh bạn được phân công. Tick kênh đang trực rồi bấm "Truy cập", hộp thư chỉ hiện hội thoại của các kênh đó.'}
          </p>
          {!manage && allowed('channels.manage') && (
            <p className="small">
              Kết nối kênh mới, quét QR, phân quyền kênh: <a href="#/settings/channels">Cài đặt › Tích hợp › Kết nối kênh</a>
            </p>
          )}
        </div>
        {isAdmin && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={18} /> Kết nối kênh
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

      <div className="platform-tabs" role="tablist" aria-label="Lọc theo nền tảng">
        {(['all', ...PLATFORM_ORDER] as const).map((p) => (
          <button key={p} role="tab" aria-selected={tab === p} className={tab === p ? 'on' : ''} onClick={() => setTab(p)}>
            {p !== 'all' && <PlatformDot platform={p} inline />}
            {p === 'all' ? 'Tất cả' : PLATFORM_LABEL[p]}
            <span className="tab-count">{count(p)}</span>
          </button>
        ))}
      </div>

      <div className={`channel-board ${inactiveList.length ? 'two' : ''}`}>
        {inactiveList.length > 0 && (
          <section className="card board-col">
            <h3>Kênh chưa kích hoạt ({inactiveList.length})</h3>
            <label className="check select-all">
              <input
                type="checkbox"
                checked={shownInactive.length > 0 && shownInactive.every((c) => pickedOff.includes(c.id))}
                onChange={(e) => setPickedOff(e.target.checked ? shownInactive.map((c) => c.id) : [])}
              />
              Chọn tất cả
            </label>
            <div className="board-list">
              {shownInactive.map((c) => tile(c, pickedOff.includes(c.id), (on) => toggle(pickedOff, setPickedOff, c.id, on)))}
              {!shownInactive.length && <div className="muted small pad">Không có kênh nào.</div>}
            </div>
            <div className="board-foot">
              <button className="btn outline block" disabled={busy || !pickedOff.length} onClick={() => activate(pickedOff)}>
                Kích hoạt
              </button>
            </div>
          </section>
        )}

        <section className="card board-col">
          <div className="row wrap">
            <h3 className="grow">
              {isAdmin ? 'Kênh đang hoạt động' : 'Kênh được phân công'} ({activeList.length})
            </h3>
            <label className="search-box">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, ID" aria-label="Tìm kênh" />
            </label>
          </div>
          <label className="check select-all">
            <input
              type="checkbox"
              checked={allShownPicked}
              onChange={(e) =>
                setPicked(e.target.checked ? [...new Set([...picked, ...shownActive.map((c) => c.id)])] : picked.filter((id) => !shownActive.some((c) => c.id === id)))
              }
            />
            Chọn tất cả
          </label>
          <div className="board-list">
            {PLATFORM_ORDER.filter((p) => shownActive.some((c) => platformOf(c.platform) === p)).map((p) => (
              <div key={p} className="board-group">
                <div className="board-group-title">{PLATFORM_LABEL[p]}</div>
                <div className="tile-grid">
                  {shownActive.filter((c) => platformOf(c.platform) === p).map((c) => tile(c, picked.includes(c.id), (on) => toggle(picked, setPicked, c.id, on)))}
                </div>
              </div>
            ))}
            {!shownActive.length && (
              <div className="center pad muted">
                {activeList.length
                  ? 'Không có kênh phù hợp.'
                  : isAdmin
                    ? 'Chưa có kênh nào. Bấm "Kết nối kênh" để thêm tài khoản đầu tiên.'
                    : 'Bạn chưa được phân công kênh nào. Nhờ quản lý thêm bạn vào kênh hoặc bộ phận.'}
              </div>
            )}
          </div>
          <div className="board-foot row">
            <span className="small">
              <b>{picked.length}</b>/{activeList.length} kênh đã chọn để chat
            </span>
            <span className="grow" />
            <button className="btn primary" disabled={busy || !picked.length} onClick={access}>
              Truy cập <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </div>

      {isAdmin && <PublicLink />}
      {isAdmin && channels.length > 0 && <AssignmentMatrix />}

      <details className="card notice">
        <summary>
          <Smartphone size={18} /> Lưu ý khi dùng các kênh
        </summary>
        <ul>
          <li>
            <b>Zalo OA:</b> gửi tin tư vấn miễn phí trong 7 ngày kể từ lần cuối khách nhắn hoặc tương tác với OA. Khách phải nhắn OA trước.
          </li>
          <li>
            <b>Facebook Messenger:</b> chỉ trả lời được trong 24 giờ kể từ tin cuối của khách. <b>Bình luận:</b> trả lời công khai bất kỳ
            lúc nào, nhắn riêng được 1 lần cho mỗi bình luận trong 7 ngày.
          </li>
          <li>
            <b>TikTok:</b> trả lời trong 48 giờ, tối đa 10 tin cho mỗi lần khách nhắn. <b>TikTok Shop:</b> chỉ gửi chữ, tối đa 2000 ký
            tự.
          </li>
          <li>
            <b>Zalo cá nhân:</b> mỗi tài khoản chỉ cho <b>một phiên web</b>, đừng mở chat.zalo.me hoặc Zalo PC bằng tài khoản đã gắn vào
            app. Kết nối dùng thư viện không chính thức (zca-js), Zalo có thể khóa tài khoản nếu gửi hàng loạt.
          </li>
          <li>Tin gửi trực tiếp từ điện thoại / trang quản lý vẫn được lưu nhưng ghi "Gửi từ điện thoại", không gắn tên nhân viên.</li>
          {isAdmin && <li>Tắt kênh thì giữ nguyên lịch sử chat để training. Chỉ xóa được kênh chưa có hội thoại nào.</li>}
        </ul>
      </details>

      {detail && (
        <Modal title={detail.name} onClose={() => setDetailId(null)}>
          {isAdmin ? (
            <ChannelCard
              channel={detail}
              status={statusOf(detail)}
              onEdit={() => {
                setDetailId(null)
                setEditing(detail)
              }}
            />
          ) : (
            <AgentChannelCard channel={detail} status={statusOf(detail)} />
          )}
        </Modal>
      )}
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
            setFlash({ ok: true, text: `Đã kết nối ${n} Fanpage. Bấm vào kênh để gán bộ phận và nhân viên.` })
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

const STATE_TEXT: Record<string, string> = {
  connected: 'Đã kết nối',
  connecting: 'Đang kết nối',
  qr: 'Chờ quét QR',
  scanned: 'Chờ xác nhận',
  error: 'Lỗi kết nối',
  disconnected: 'Chưa kết nối',
  off: 'Đã tắt',
}

/** Một ô kênh: tick chọn, ảnh + ký hiệu nền tảng, tên, ID tài khoản, trạng thái, mở chi tiết. */
function ChannelTile({
  channel: c,
  status,
  checked,
  onToggle,
  onOpen,
}: {
  channel: Channel
  status: ZaloStatus | null
  checked: boolean
  onToggle: (on: boolean) => void
  onOpen: () => void
}) {
  const state = c.active ? status?.state ?? 'disconnected' : 'off'
  const accountId = status?.account?.id ?? c.zalo_uid ?? ''
  return (
    <div className={`channel-tile ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} aria-label={`Chọn kênh ${c.name}`} />
      <span className="avatar-wrap">
        <Avatar name={status?.account?.name ?? c.name} src={status?.account?.avatar || c.avatar} size={40} />
        <PlatformDot platform={c.platform} />
      </span>
      <button type="button" className="tile-main" onClick={onOpen} title="Xem chi tiết kênh">
        <b>{c.name}</b>
        <span className="muted small">{accountId || status?.account?.name || 'Chưa gắn tài khoản'}</span>
      </button>
      <span className={`status-dot ${state === 'connected' ? 'ok' : state === 'off' ? '' : 'bad'}`} title={STATE_TEXT[state] ?? state} />
      <button type="button" className="icon-btn sm tile-open" onClick={onOpen} aria-label={`Mở chi tiết kênh ${c.name}`}>
        <ArrowRightCircle size={18} />
      </button>
    </div>
  )
}

function AgentChannelCard({ channel: c, status }: { channel: Channel; status: ZaloStatus | null }) {
  const state = status?.state ?? 'disconnected'
  return (
    <div className="stack">
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
      {state !== 'connected' && <div className="muted small">Kênh đang mất kết nối. Báo quản lý kết nối lại để tiếp tục nhận/gửi tin.</div>}
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
    <div className={`channel-card ${c.active ? '' : 'dim'}`}>
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
    if (
      !channel ||
      !confirm(
        `Xóa kênh "${channel.name}"?

Zalo của kênh sẽ được đăng xuất và kênh biến mất khỏi danh sách. ` +
          `Hội thoại và tin nhắn cũ vẫn được giữ (xem lại trong Hội thoại, Báo cáo, Xuất dữ liệu, tên kênh kèm "(đã xóa)").`,
      )
    )
      return
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

const OAUTH_SLUG: Record<Platform, string> = { zalo: '', zalo_oa: 'zalo-oa', facebook: 'facebook', tiktok: 'tiktok', tiktok_shop: 'tiktok-shop' }

type PlatformConfig = {
  zalo_oa: { configured: boolean }
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
        <a href="#/settings/apps" onClick={onClose}>
          Nhập ở Cài đặt › Tích hợp › App nền tảng
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
            <PlatformBadge platform="zalo_oa" />
            <b className="grow">Zalo Official Account (OA)</b>
          </div>
          {!cfg ? (
            <div className="muted small">Đang tải…</div>
          ) : cfg.zalo_oa?.configured ? (
            <>
              <div className="muted small">Đăng nhập Zalo bằng tài khoản quản trị OA và bấm Cho phép. API chính thức của Zalo, không lo khóa tài khoản.</div>
              <a className="btn primary sm" href={authUrl('/oauth/zalo-oa/start')}>
                <LogIn size={14} /> Đăng nhập Zalo OA
              </a>
            </>
          ) : (
            needConfig('Zalo OA')
          )}
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
