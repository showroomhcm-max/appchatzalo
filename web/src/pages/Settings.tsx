import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Building2, Download, MessageSquareText, Pencil, PlugZap, Plus, Tag as TagIcon, Trash2, Upload, Users as UsersIcon } from 'lucide-react'
import { api, authUrl } from '../api'
import { useApp } from '../store'
import type { Department, Tag, Template } from '../types'
import { Avatar, Modal } from '../components'
import UsersPage from './Users'
import { BUILD, buildTimeLabel } from '../version'
import Integrations from './Integrations'
import LogsTab from './Logs'
import PermissionsTab from './Permissions'
import { canAny, type Permission } from '../perm'
import { ScrollText, ShieldCheck } from 'lucide-react'

export type SettingsTab = 'users' | 'permissions' | 'departments' | 'tags' | 'templates' | 'integrations' | 'logs'
type Tab = SettingsTab
const TABS: Tab[] = ['users', 'permissions', 'departments', 'tags', 'templates', 'integrations', 'logs']
const TAB_PERMS: Record<Tab, Permission[]> = {
  users: ['users.manage', 'permissions.manage'],
  permissions: ['permissions.manage'],
  departments: ['departments.manage'],
  tags: ['tags.manage'],
  templates: ['templates.manage'],
  integrations: ['integrations.manage'],
  logs: ['logs.view'],
}

const TAB_KEY = 'zcskh.settingsTab'

export default function SettingsPage({ tab: fromLink }: { tab?: Tab }) {
  const { user } = useApp()
  const allowed = (t: Tab) => canAny(user, TAB_PERMS[t])
  const firstAllowed = TABS.find(allowed) ?? 'users'
  const [tab, setTabRaw] = useState<Tab>(() => {
    if (fromLink && TABS.includes(fromLink)) return fromLink
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab
      return TABS.includes(saved) && allowed(saved) ? saved : firstAllowed
    } catch {
      return firstAllowed
    }
  })
  const setTab = (t: Tab) => setTabRaw(allowed(t) ? t : firstAllowed)
  useEffect(() => {
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
    } catch {
      /* ignore */
    }
  }, [tab])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cài đặt</h1>
          <p className="muted">
            Nhân viên, bộ phận, tag, tin nhắn mẫu và kết nối với web app khác. Nhân viên thuộc bộ phận nào thì thấy kênh, hội
            thoại, tag và tin nhắn mẫu của bộ phận đó.
          </p>
          <p className="muted small">
            Phiên bản {BUILD.version} · cập nhật lúc {buildTimeLabel(BUILD.builtAt)}
            {BUILD.commit ? ` · mã ${BUILD.commit}` : ''}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['users', 'Nhân viên', <UsersIcon size={16} key="u" />],
            ['permissions', 'Phân quyền', <ShieldCheck size={16} key="p" />],
            ['departments', 'Bộ phận', <Building2 size={16} key="d" />],
            ['tags', 'Tag', <TagIcon size={16} key="t" />],
            ['templates', 'Tin nhắn mẫu', <MessageSquareText size={16} key="m" />],
            ['integrations', 'Tích hợp', <PlugZap size={16} key="i" />],
            ['logs', 'Nhật ký', <ScrollText size={16} key="l" />],
          ] as [Tab, string, React.ReactNode][]
        )
          .filter(([id]) => allowed(id))
          .map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {icon} {label}
          </button>
        ))}
      </div>
      {tab === 'users' && allowed('users') && <UsersPage embedded />}
      {tab === 'permissions' && allowed('permissions') && <PermissionsTab />}
      {tab === 'departments' && allowed('departments') && <DepartmentsTab />}
      {tab === 'tags' && allowed('tags') && <TagsTab />}
      {tab === 'templates' && allowed('templates') && <TemplatesTab />}
      {tab === 'integrations' && allowed('integrations') && <Integrations embedded />}
      {tab === 'logs' && allowed('logs') && <LogsTab />}
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
                      <Avatar name={u!.display_name} size={28} />
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

type ImportResult = { created: number; updated: number; skipped: { row: number; reason: string }[] }

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
        <span className="muted small">Mẹo: bấm "Xuất Excel" để lấy file mẫu đúng cột, sửa xong nhập lại.</span>
      </div>
      {error && <div className="form-error">{error}</div>}
      {result && (
        <div className={`banner ${result.skipped.length ? 'warn' : 'info'} inline import-result`}>
          <span>
            Đã thêm {result.created}, cập nhật {result.updated}
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
        </div>
      )}
    </div>
  )
}

// ───────────── Tag ─────────────

function TagsTab() {
  const { tags, reloadSettings } = useApp()
  const [editing, setEditing] = useState<Tag | 'new' | null>(null)

  return (
    <div className="card">
      <div className="row wrap">
        <h3 className="grow">Tag ({tags.length})</h3>
        <button className="btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm tag
        </button>
      </div>
      <ExcelBar kind="tags" onImported={reloadSettings} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Bộ phận dùng</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id}>
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
            {!tags.length && (
              <tr>
                <td colSpan={3} className="muted">
                  Chưa có tag. Ví dụ: Khách VIP, Hỏi giá, Chờ chuyển khoản, Bảo hành.
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
  const reload = () => api<Template[]>('/templates').then(setList)
  useEffect(() => {
    void reload()
  }, [])

  return (
    <div className="card">
      <div className="row wrap">
        <h3 className="grow">Tin nhắn mẫu ({list.length})</h3>
        <button className="btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm mẫu
        </button>
      </div>
      <p className="muted small">
        Trong ô chat gõ <code>/</code> rồi phím tắt để chèn nhanh. Nhân viên chỉ thấy mẫu dùng chung và mẫu của bộ phận mình.
      </p>
      <ExcelBar kind="templates" onImported={() => void reload()} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Phím tắt</th>
              <th>Nội dung</th>
              <th>Bộ phận dùng</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>
                  <code className="ok-text">/{t.shortcut}</code>
                </td>
                <td className="pre-wrap">{t.content}</td>
                <td>
                  <DeptChips ids={t.department_ids} />
                </td>
                <td className="right">
                  <button className="icon-btn sm" onClick={() => setEditing(t)} aria-label={`Sửa mẫu ${t.shortcut}`}>
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={4} className="muted">
                  Chưa có tin nhắn mẫu.
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
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const body = { shortcut, content, department_ids: deptIds }
    try {
      if (template) await api(`/templates/${template.id}`, { method: 'PATCH', body })
      else await api('/templates', { body })
      onSaved()
    } catch (err: any) {
      setError(err.message)
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
          <button className="btn primary" disabled={!shortcut.trim() || !content.trim()}>
            Lưu
          </button>
        </div>
      </form>
    </Modal>
  )
}
