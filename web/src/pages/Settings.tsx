import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Smartphone, Building2, ChevronDown, Download, KeyRound, MessageSquareText, Pencil, PlugZap, Plus, Radio, RefreshCw, Tag as TagIcon, Trash2, Upload, Users as UsersIcon } from 'lucide-react'
import { api, authUrl } from '../api'
import { useApp } from '../store'
import type { Department, Tag, Template } from '../types'
import { Avatar, Modal } from '../components'
import UsersPage from './Users'
import { BUILD, buildTimeLabel } from '../version'
import PlatformApps from './PlatformApps'
import Integrations from './Integrations'
import LogsTab from './Logs'
import PermissionsTab from './Permissions'
import { BulkDeptBar, ListFilter, matchDept, matchText, SelectAllBox, useSelection, type DeptFilter } from './bulk-manage'
import AlertsSettings from './AlertsSettings'
import CompanyZalo from './CompanyZalo'
import SapoSettings from './SapoSettings'
import OdooPosSettings from './OdooPosSettings'
import Channels from './Channels'
import { canAny, type Permission } from '../perm'
import { Link2, ScrollText, ShieldCheck } from 'lucide-react'
import LinkedApps from './LinkedApps'

export type SettingsTab =
  | 'channels'
  | 'apps'
  | 'connect'
  | 'integrations'
  | 'orders'
  | 'linked'
  | 'alerts'
  | 'company'
  | 'logs'
  | 'templates'
  | 'tags'
  | 'departments'
  | 'users'
  | 'permissions'
type Tab = SettingsTab

type MenuItem = { id: Tab; label: string; icon: React.ReactNode; perms: Permission[] }
const MENU: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Tích hợp',
    items: [
      { id: 'channels', label: 'Kết nối kênh', icon: <Radio size={18} />, perms: ['channels.manage'] },
      { id: 'connect', label: 'Kết nối app & API', icon: <PlugZap size={18} />, perms: ['integrations.manage'] },
      { id: 'orders', label: 'Đồng bộ đơn hàng', icon: <RefreshCw size={18} />, perms: ['integrations.manage'] },
    ],
  },
  {
    title: 'Quản lý chung',
    items: [
      { id: 'alerts', label: 'Cảnh báo đơn "rơi"', icon: <AlertTriangle size={18} />, perms: ['alerts.manage'] },
      { id: 'company', label: 'Zalo nhân viên (giám sát)', icon: <Smartphone size={18} />, perms: ['channels.manage'] },
      { id: 'logs', label: 'Nhật ký hệ thống', icon: <ScrollText size={18} />, perms: ['logs.view'] },
    ],
  },
  {
    title: 'Quản lý hội thoại',
    items: [
      { id: 'templates', label: 'Câu trả lời mẫu', icon: <MessageSquareText size={18} />, perms: ['templates.manage'] },
      { id: 'tags', label: 'Tag hội thoại', icon: <TagIcon size={18} />, perms: ['tags.manage'] },
      { id: 'departments', label: 'Bộ phận (phân chia hội thoại)', icon: <Building2 size={18} />, perms: ['departments.manage'] },
    ],
  },
  {
    title: 'Phân quyền',
    items: [
      { id: 'users', label: 'Nhân viên', icon: <UsersIcon size={18} />, perms: ['users.manage', 'permissions.manage'] },
      { id: 'permissions', label: 'Nhóm quyền', icon: <ShieldCheck size={18} />, perms: ['permissions.manage'] },
    ],
  },
]
const ITEMS = MENU.flatMap((g) => g.items)
const TABS = ITEMS.map((i) => i.id)

/** Ba mục cũ gộp vào "Kết nối app & API"; link cũ #/settings/apps | integrations | linked vẫn mở đúng thẻ. */
type ConnectSub = 'linked' | 'integrations' | 'apps'
const CONNECT_SUBS: { id: ConnectSub; label: string; icon: React.ReactNode }[] = [
  { id: 'linked', label: 'App nội bộ', icon: <Link2 size={16} /> },
  { id: 'integrations', label: 'API & Webhook', icon: <PlugZap size={16} /> },
  { id: 'apps', label: 'App nền tảng (Facebook, TikTok…)', icon: <KeyRound size={16} /> },
]
const isConnectSub = (t: unknown): t is ConnectSub => CONNECT_SUBS.some((c) => c.id === t)

const TAB_KEY = 'zcskh.settingsTab'
const COLLAPSE_KEY = 'zcskh.settingsCollapsed'

export default function SettingsPage({ tab: rawLink }: { tab?: Tab }) {
  // Link cũ #/settings/sapo → Đồng bộ đơn hàng; #/settings/apps | integrations | linked → Kết nối app & API
  const fromLink = (rawLink as string) === 'sapo' ? 'orders' : isConnectSub(rawLink) ? 'connect' : rawLink
  const [sub, setSub] = useState<ConnectSub>(() => (isConnectSub(rawLink) ? rawLink : 'linked'))
  const { user } = useApp()
  const allowed = (t: Tab) => canAny(user, ITEMS.find((i) => i.id === t)?.perms ?? [])
  const firstAllowed = TABS.find(allowed) ?? 'users'
  const [tab, setTabRaw] = useState<Tab>(() => {
    if (fromLink && TABS.includes(fromLink)) return fromLink
    try {
      const raw = localStorage.getItem(TAB_KEY)
      const saved = (isConnectSub(raw) ? 'connect' : raw) as Tab
      return TABS.includes(saved) && allowed(saved) ? saved : firstAllowed
    } catch {
      return firstAllowed
    }
  })
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]')
    } catch {
      return []
    }
  })
  const setTab = (t: Tab) => setTabRaw(allowed(t) ? t : firstAllowed)
  useEffect(() => {
    if (isConnectSub(rawLink)) setSub(rawLink)
    if (fromLink && TABS.includes(fromLink)) setTab(fromLink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLink])
  useEffect(() => {
    if (!allowed(tab)) setTabRaw(firstAllowed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user.permissions, user.super_admin])
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed))
    } catch {
      /* ignore */
    }
  }, [tab, collapsed])

  const go = (t: Tab) => {
    setTab(t)
    // Giữ link chia sẻ được: #/settings/<mục>
    if (window.location.hash.split('/')[2] !== t) history.replaceState(null, '', `#/settings/${t}`)
  }
  const current = ITEMS.find((i) => i.id === tab)

  return (
    <div className="settings-layout">
      <aside className="settings-nav" aria-label="Menu cài đặt">
        {MENU.map((g) => {
          const items = g.items.filter((i) => allowed(i.id))
          if (!items.length) return null
          const closed = collapsed.includes(g.title) && !items.some((i) => i.id === tab)
          return (
            <div key={g.title} className="settings-group">
              <button
                className="settings-group-title"
                aria-expanded={!closed}
                onClick={() => setCollapsed(closed ? collapsed.filter((x) => x !== g.title) : [...collapsed, g.title])}
              >
                {g.title}
                <ChevronDown size={16} className={closed ? 'rot' : ''} />
              </button>
              {!closed &&
                items.map((i) => (
                  <button key={i.id} className={`settings-item ${tab === i.id ? 'on' : ''}`} onClick={() => go(i.id)} aria-current={tab === i.id ? 'page' : undefined}>
                    {i.icon}
                    {i.label}
                  </button>
                ))}
            </div>
          )
        })}
        <p className="muted small settings-version">
          Phiên bản {BUILD.version} · {buildTimeLabel(BUILD.builtAt)}
          {BUILD.commit ? ` · ${BUILD.commit}` : ''}
        </p>
      </aside>

      <div className="settings-content">
        <select className="select settings-mobile-nav" value={tab} onChange={(e) => go(e.target.value as Tab)} aria-label="Chọn mục cài đặt">
          {MENU.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.items
                .filter((i) => allowed(i.id))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {current && !['alerts', 'channels', 'company'].includes(tab) && <h1 className="settings-title">{current.label}</h1>}
        {tab === 'channels' && allowed('channels') && <Channels manage />}
        {tab === 'connect' && allowed('connect') && (
          <>
            <div className="seg connect-tabs" role="tablist" aria-label="Loại kết nối">
              {CONNECT_SUBS.map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={sub === c.id}
                  className={sub === c.id ? 'on' : ''}
                  onClick={() => {
                    setSub(c.id)
                    history.replaceState(null, '', `#/settings/${c.id}`)
                  }}
                >
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
            {sub === 'linked' && <LinkedApps />}
            {sub === 'integrations' && <Integrations embedded />}
            {sub === 'apps' && <PlatformApps />}
          </>
        )}
        {tab === 'orders' && allowed('orders') && (
          <>
            <SapoSettings />
            <OdooPosSettings />
          </>
        )}
        {tab === 'alerts' && allowed('alerts') && <AlertsSettings />}
        {tab === 'company' && allowed('company') && <CompanyZalo />}
        {tab === 'logs' && allowed('logs') && <LogsTab />}
        {tab === 'templates' && allowed('templates') && <TemplatesTab />}
        {tab === 'tags' && allowed('tags') && <TagsTab />}
        {tab === 'departments' && allowed('departments') && <DepartmentsTab />}
        {tab === 'users' && allowed('users') && <UsersPage embedded />}
        {tab === 'permissions' && allowed('permissions') && <PermissionsTab />}
      </div>
    </div>
  )
}

// ───────────── Chọn bộ phận ─────────────

export function DeptChips({ ids, empty = 'Dùng chung' }: { ids: number[]; empty?: string }) {
  const { departments } = useApp()
  const list = ids.map((id) => departments.find((d) => d.id === id)).filter((d): d is Department => !!d)
  if (!list.length) return <span className="muted small">{empty}</span>
  return (
    <span className="row wrap">
      {list.map((d) => (
        <span key={d.id} className="dept-chip" style={{ '--chip': d.color } as React.CSSProperties}>
          {d.name}
        </span>
      ))}
    </span>
  )
}

export function DeptPicker({ value, onChange, hint }: { value: number[]; onChange: (v: number[]) => void; hint?: string }) {
  const { departments } = useApp()
  return (
    <div className="field">
      <span>Bộ phận</span>
      {hint && <span className="muted small">{hint}</span>}
      {departments.length === 0 && <span className="muted small">Chưa có bộ phận nào.</span>}
      <div className="check-grid">
        {departments.map((d) => (
          <label key={d.id} className="check">
            <input
              type="checkbox"
              checked={value.includes(d.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, d.id] : value.filter((x) => x !== d.id))}
            />
            <span className="dept-chip" style={{ '--chip': d.color } as React.CSSProperties}>
              {d.name}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

const COLORS = ['#0a804a', '#97c354', '#2563c9', '#e0900a', '#d83a2f', '#7c3aed', '#0891b2', '#55655c']

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span>Màu</span>
      <div className="row wrap">
        {COLORS.map((c) => (
          <button
            type="button"
            key={c}
            className={`swatch ${value === c ? 'on' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={`Chọn màu ${c}`}
          />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Màu khác" className="color-input" />
      </div>
    </div>
  )
}

// ───────────── Bộ phận ─────────────

function DepartmentsTab() {
  const { departments, channels, users, reloadSettings, reloadUsers } = useApp()
  const [editing, setEditing] = useState<Department | 'new' | null>(null)

  return (
    <>
      <div className="row end">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Thêm bộ phận
        </button>
      </div>
      {departments.length === 0 && (
        <div className="card muted center pad">
          Chưa có bộ phận. Ví dụ: Bán hàng, Kỹ thuật, Bảo hành, Chăm sóc sau bán.
        </div>
      )}
      <div className="dept-grid">
        {departments.map((d) => (
          <div key={d.id} className="card dept-card">
            <div className="row">
              <span className="dept-dot" style={{ background: d.color }} />
              <h3 className="grow">{d.name}</h3>
              <button className="icon-btn" onClick={() => setEditing(d)} aria-label={`Sửa bộ phận ${d.name}`}>
                <Pencil size={16} />
              </button>
            </div>
            <div className="stack sm">
              <div>
                <div className="muted small">Kênh được xem</div>
                <div className="small">
                  {d.channel_ids.map((id) => channels.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || (
                    <span className="err-text">Chưa gán kênh nào</span>
                  )}
                </div>
              </div>
              <div>
                <div className="muted small">Thành viên ({d.user_ids.length})</div>
                <div className="avatar-row">
                  {d.user_ids.map((id) => users.find((u) => u.id === id)).filter(Boolean).map((u) => (
                    <span key={u!.id} title={u!.display_name}>
                      <Avatar name={u!.display_name} src={u!.avatar} size={28} />
                    </span>
                  ))}
                  {!d.user_ids.length && <span className="small muted">Chưa có ai</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <DepartmentForm
          dept={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadSettings()
            reloadUsers()
          }}
        />
      )}
    </>
  )
}

function DepartmentForm({ dept, onClose, onSaved }: { dept: Department | null; onClose: () => void; onSaved: () => void }) {
  const { channels, users } = useApp()
  const [name, setName] = useState(dept?.name ?? '')
  const [color, setColor] = useState(dept?.color ?? '#0a804a')
  const [channelIds, setChannelIds] = useState<number[]>(dept?.channel_ids ?? [])
  const [userIds, setUserIds] = useState<number[]>(dept?.user_ids ?? [])
  const [error, setError] = useState('')
  const agents = users.filter((u) => u.active)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const body = { name, color, channel_ids: channelIds, user_ids: userIds }
    try {
      if (dept) await api(`/departments/${dept.id}`, { method: 'PATCH', body })
      else await api('/departments', { body })
      onSaved()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove() {
    if (!dept || !confirm(`Xóa bộ phận "${dept.name}"? Hội thoại của bộ phận này sẽ trở về "chưa thuộc bộ phận".`)) return
    await api(`/departments/${dept.id}`, { method: 'DELETE' })
    onSaved()
  }

  const toggle = (list: number[], id: number, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))

  return (
    <Modal title={dept ? `Sửa bộ phận ${dept.name}` : 'Thêm bộ phận'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Tên bộ phận</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Bán hàng" autoFocus />
        </label>
        <ColorPicker value={color} onChange={setColor} />
        <div className="field">
          <span>Kênh Zalo bộ phận này được xem</span>
          {channels.length === 0 && <span className="muted small">Chưa có kênh nào. Tạo ở trang Kênh Zalo.</span>}
          <div className="check-grid">
            {channels.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={channelIds.includes(c.id)} onChange={(e) => setChannelIds(toggle(channelIds, c.id, e.target.checked))} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Thành viên</span>
          <span className="muted small">Một nhân viên có thể thuộc nhiều bộ phận. Quản trị viên luôn thấy tất cả.</span>
          <div className="check-grid">
            {agents.map((u) => (
              <label key={u.id} className="check">
                <input type="checkbox" checked={userIds.includes(u.id)} onChange={(e) => setUserIds(toggle(userIds, u.id, e.target.checked))} />
                {u.display_name}
                {u.role === 'admin' && <span className="muted small">(quản trị)</span>}
              </label>
            ))}
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          {dept && (
            <button type="button" className="btn ghost" onClick={remove}>
              Xóa bộ phận
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

// ───────────── Xuất / nhập Excel ─────────────

type ImportResult = { created: number; updated: number; merged?: number; renamed?: { row: number; from: string; to: string }[]; warnings?: { row: number; reason: string }[]; skipped: { row: number; reason: string }[] }

function ExcelBar({ kind, onImported }: { kind: 'tags' | 'templates'; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      setResult(await api<ImportResult>(`/${kind}/import`, { body: fd }))
      onImported()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack sm">
      <div className="row wrap">
        <a className="btn outline sm" href={authUrl(`/${kind}/export.xlsx`)}>
          <Download size={14} /> Xuất Excel
        </a>
        <button className="btn outline sm" onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={14} /> {busy ? 'Đang nhập…' : 'Nhập từ Excel'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void upload(f)
          }}
        />
        <span className="muted small">
          {kind === 'templates'
            ? 'Nhập được file "Danh sách CTLM" xuất từ trang Pancake / Sapo (Từ viết tắt, Nội dung, Ảnh đính kèm, Tệp đính kèm, Xin địa chỉ, Cập nhật).'
            : 'Mẹo: bấm "Xuất Excel" để lấy file mẫu đúng cột, sửa xong nhập lại.'}
        </span>
      </div>
      {error && <div className="form-error">{error}</div>}
      {result && (
        <div className={`banner ${result.skipped.length ? 'warn' : 'info'} inline import-result`}>
          <span>
            Đã thêm {result.created}, cập nhật {result.updated}
            {result.merged ? `, gộp ${result.merged} dòng trùng` : ''}
            {result.skipped.length ? `, bỏ qua ${result.skipped.length} dòng:` : '.'}
          </span>
          {result.skipped.length > 0 && (
            <ul>
              {result.skipped.slice(0, 10).map((s) => (
                <li key={s.row}>
                  Dòng {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          {!!result.renamed?.length && (
            <ul>
              {result.renamed.map((r) => (
                <li key={`r${r.row}`}>
                  Dòng {r.row}: /{r.from} trùng nhưng khác nội dung → đặt tên /{r.to}
                </li>
              ))}
            </ul>
          )}
          {!!result.warnings?.length && (
            <ul>
              {result.warnings.slice(0, 10).map((w, i) => (
                <li key={`w${i}`}>
                  Dòng {w.row}: {w.reason} (vẫn lưu nội dung)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ───────────── Tag ─────────────

function TagsTab() {
  const { tags, reloadSettings } = useApp()
  const [editing, setEditing] = useState<Tag | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState<DeptFilter>('all')
  const shown = tags.filter((t) => matchDept(t.department_ids, dept) && matchText(q, t.name))
  const sel = useSelection(shown.map((t) => t.id))

  return (
    <div className="card">
      <div className="row wrap">
        <h3 className="grow">Tag ({tags.length})</h3>
        <button className="btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm tag
        </button>
      </div>
      <ExcelBar kind="tags" onImported={reloadSettings} />
      <ListFilter q={q} onQ={setQ} dept={dept} onDept={setDept} placeholder="Tìm tag…" shown={shown.length} total={tags.length} />
      {sel.selected.length > 0 && (
        <BulkDeptBar
          kind="tags"
          noun="tag"
          ids={sel.selected}
          onClear={sel.clear}
          onDone={() => {
            sel.clear()
            reloadSettings()
          }}
        />
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="check-col">
                <SelectAllBox allOn={sel.allOn} someOn={sel.someOn} onToggle={sel.toggleAll} label="Chọn mọi tag đang hiện" />
              </th>
              <th>Tag</th>
              <th>Bộ phận dùng</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className={sel.has(t.id) ? 'selected' : ''}>
                <td className="check-col">
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => sel.toggle(t.id)} aria-label={`Chọn tag ${t.name}`} />
                </td>
                <td>
                  <TagChip tag={t} />
                </td>
                <td>
                  <DeptChips ids={t.department_ids} />
                </td>
                <td className="right">
                  <button className="icon-btn sm" onClick={() => setEditing(t)} aria-label={`Sửa tag ${t.name}`}>
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={4} className="muted">
                  {tags.length ? 'Không có tag nào khớp bộ lọc.' : 'Chưa có tag. Ví dụ: Khách VIP, Hỏi giá, Chờ chuyển khoản, Bảo hành.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <TagForm
          tag={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadSettings()
          }}
        />
      )}
    </div>
  )
}

export function TagChip({ tag, onRemove }: { tag: { name: string; color: string }; onRemove?: () => void }) {
  return (
    <span className="tag-chip" style={{ '--chip': tag.color } as React.CSSProperties}>
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Bỏ tag ${tag.name}`}>
          ×
        </button>
      )}
    </span>
  )
}

function TagForm({ tag, onClose, onSaved }: { tag: Tag | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? '#97c354')
  const [deptIds, setDeptIds] = useState<number[]>(tag?.department_ids ?? [])
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const body = { name, color, department_ids: deptIds }
    try {
      if (tag) await api(`/tags/${tag.id}`, { method: 'PATCH', body })
      else await api('/tags', { body })
      onSaved()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove() {
    if (!tag || !confirm(`Xóa tag "${tag.name}"? Tag sẽ được gỡ khỏi mọi hội thoại đang gắn.`)) return
    await api(`/tags/${tag.id}`, { method: 'DELETE' })
    onSaved()
  }

  return (
    <Modal title={tag ? `Sửa tag ${tag.name}` : 'Thêm tag'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Tên tag</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Khách VIP" autoFocus />
        </label>
        <ColorPicker value={color} onChange={setColor} />
        <div>
          Xem trước: <TagChip tag={{ name: name || 'Tên tag', color }} />
        </div>
        <DeptPicker value={deptIds} onChange={setDeptIds} hint="Không chọn bộ phận nào = mọi bộ phận đều dùng được." />
        {tag && <p className="muted small">Đổi tên tag sẽ đổi luôn ở các hội thoại đang gắn tag này.</p>}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          {tag && (
            <button type="button" className="btn ghost" onClick={remove}>
              <Trash2 size={14} /> Xóa
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

// ───────────── Tin nhắn mẫu ─────────────

function TemplatesTab() {
  const [list, setList] = useState<Template[]>([])
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState<DeptFilter>('all')
  const shown = list.filter((t) => matchDept(t.department_ids, dept) && matchText(q, t.shortcut, t.content))
  const sel = useSelection(shown.map((t) => t.id))
  const reload = () => api<Template[]>('/templates').then(setList)
  useEffect(() => {
    void reload()
  }, [])

  return (
    <div className="card">
      <div className="row wrap">
        <h3 className="grow">Câu trả lời mẫu ({list.length})</h3>
        <button className="btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm mẫu
        </button>
      </div>
      <p className="muted small">
        Trong ô chat gõ <code>/</code> rồi phím tắt để chèn nhanh. Nhân viên chỉ thấy mẫu dùng chung và mẫu của bộ phận mình.
      </p>
      <ExcelBar kind="templates" onImported={() => void reload()} />
      <ListFilter q={q} onQ={setQ} dept={dept} onDept={setDept} placeholder="Tìm theo từ viết tắt hoặc nội dung…" shown={shown.length} total={list.length} />
      {sel.selected.length > 0 && (
        <BulkDeptBar
          kind="templates"
          noun="mẫu"
          ids={sel.selected}
          onClear={sel.clear}
          onDone={() => {
            sel.clear()
            void reload()
          }}
        />
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="check-col">
                <SelectAllBox allOn={sel.allOn} someOn={sel.someOn} onToggle={sel.toggleAll} label="Chọn mọi mẫu đang hiện" />
              </th>
              <th>Từ viết tắt</th>
              <th>Nội dung</th>
              <th>Đính kèm</th>
              <th>Bộ phận dùng</th>
              <th>Cập nhật</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className={sel.has(t.id) ? 'selected' : ''}>
                <td className="check-col">
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => sel.toggle(t.id)} aria-label={`Chọn mẫu /${t.shortcut}`} />
                </td>
                <td>
                  <code className="ok-text">/{t.shortcut}</code>
                </td>
                <td className="pre-wrap">{t.content}</td>
                <td>
                  <div className="tpl-attach">
                    {t.image_file ? (
                      <a href={t.image_file} target="_blank" rel="noopener noreferrer">
                        <img src={t.image_file} alt={`Ảnh mẫu /${t.shortcut}`} />
                      </a>
                    ) : t.image_url ? (
                      <span className="small warn-text">Ảnh chưa tải được</span>
                    ) : null}
                    {t.file_file ? (
                      <a className="small" href={t.file_file} target="_blank" rel="noopener noreferrer">
                        {t.file_name ?? 'Tệp'}
                      </a>
                    ) : t.file_url ? (
                      <span className="small warn-text">Tệp chưa tải được</span>
                    ) : null}
                    {t.ask_address && <span className="badge info">Xin địa chỉ</span>}
                  </div>
                </td>
                <td>
                  <DeptChips ids={t.department_ids} />
                </td>
                <td className="small muted pre-wrap">{t.updated_label ?? [t.updated_by_name, t.updated_at ? new Date(t.updated_at).toLocaleDateString('vi-VN') : ''].filter(Boolean).join('\n')}</td>
                <td className="right">
                  <button className="icon-btn sm" onClick={() => setEditing(t)} aria-label={`Sửa mẫu ${t.shortcut}`}>
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="muted">
                  {list.length ? 'Không có mẫu nào khớp bộ lọc.' : 'Chưa có tin nhắn mẫu.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <TemplateForm
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
    </div>
  )
}

function TemplateForm({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const [shortcut, setShortcut] = useState(template?.shortcut ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [deptIds, setDeptIds] = useState<number[]>(template?.department_ids ?? [])
  const [imageUrl, setImageUrl] = useState(template?.image_url ?? '')
  const [fileUrl, setFileUrl] = useState(template?.file_url ?? '')
  const [askAddress, setAskAddress] = useState(!!template?.ask_address)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const body = { shortcut, content, department_ids: deptIds, image_url: imageUrl, file_url: fileUrl, ask_address: askAddress }
    try {
      const r = template ? await api<{ warnings?: string[] }>(`/templates/${template.id}`, { method: 'PATCH', body }) : await api<{ warnings?: string[] }>('/templates', { body })
      if (r.warnings?.length) alert(`Đã lưu, nhưng: ${r.warnings.join('; ')}`)
      onSaved()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!template || !confirm(`Xóa mẫu /${template.shortcut}?`)) return
    await api(`/templates/${template.id}`, { method: 'DELETE' })
    onSaved()
  }

  return (
    <Modal title={template ? `Sửa mẫu /${template.shortcut}` : 'Thêm tin nhắn mẫu'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Phím tắt (viết liền, không dấu cách)</span>
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value.replace(/\s+/g, '-'))} placeholder="VD: chao" autoFocus />
        </label>
        <label className="field">
          <span>Nội dung</span>
          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="VD: Dạ MemoryZone xin chào bạn, bạn cần tư vấn sản phẩm nào ạ?"
          />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Ảnh đính kèm (link)</span>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/anh.jpg" inputMode="url" />
            <span className="muted small">Chọn mẫu là ảnh tự gắn vào tin. JPG / PNG / WEBP / GIF, tối đa 10 MB.</span>
          </label>
          <label className="field">
            <span>Tệp đính kèm (link)</span>
            <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…/bang-gia.pdf" inputMode="url" />
            <span className="muted small">PDF, Word, Excel, PowerPoint, ZIP…, tối đa 10 MB.</span>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={askAddress} onChange={(e) => setAskAddress(e.target.checked)} />
          Mẫu xin địa chỉ / thông tin giao hàng
        </label>
        <DeptPicker value={deptIds} onChange={setDeptIds} hint="Không chọn bộ phận nào = mọi bộ phận đều dùng được." />
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          {template && (
            <button type="button" className="btn ghost" onClick={remove}>
              <Trash2 size={14} /> Xóa
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy || !shortcut.trim() || !content.trim()}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
