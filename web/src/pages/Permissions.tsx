import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { Avatar, Modal } from '../components'

export type PermissionDef = { key: string; group: string; label: string }
export type PermissionGroup = { id: number; name: string; description: string | null; permissions: string[]; user_ids: number[] }

export function usePermissionData() {
  const [defs, setDefs] = useState<PermissionDef[]>([])
  const [groups, setGroups] = useState<PermissionGroup[]>([])
  const reload = () => {
    api<PermissionDef[]>('/permissions').then(setDefs).catch(() => {})
    api<PermissionGroup[]>('/permission-groups').then(setGroups).catch(() => {})
  }
  useEffect(reload, [])
  return { defs, groups, reload }
}

/** Danh sách quyền có ô tick, gom theo nhóm (Hội thoại, Dữ liệu, Cài đặt, Hệ thống). */
export function PermissionChecklist({
  defs,
  value,
  onChange,
  inherited = [],
  disabledKeys = [],
}: {
  defs: PermissionDef[]
  value: string[]
  onChange: (v: string[]) => void
  /** Quyền đã có từ nhóm quyền (hiện tick mờ) */
  inherited?: string[]
  /** Quyền không được tick (vì người đang thao tác không có) */
  disabledKeys?: string[]
}) {
  const sections = [...new Set(defs.map((d) => d.group))]
  return (
    <div className="perm-list">
      {sections.map((sec) => (
        <div key={sec} className="perm-section">
          <div className="perm-section-title">{sec}</div>
          {defs
            .filter((d) => d.group === sec)
            .map((d) => {
              const fromGroup = inherited.includes(d.key) && !value.includes(d.key)
              return (
                <label key={d.key} className={`check perm-item ${fromGroup ? 'inherited' : ''}`} title={fromGroup ? 'Đã có từ nhóm quyền' : undefined}>
                  <input
                    type="checkbox"
                    checked={value.includes(d.key) || fromGroup}
                    disabled={fromGroup || (disabledKeys.includes(d.key) && !value.includes(d.key))}
                    onChange={(e) => onChange(e.target.checked ? [...value, d.key] : value.filter((k) => k !== d.key))}
                  />
                  <span>
                    {d.label}
                    {fromGroup && <small className="muted"> · từ nhóm quyền</small>}
                  </span>
                </label>
              )
            })}
        </div>
      ))}
    </div>
  )
}

/** Cài đặt › Phân quyền: nhóm quyền và thành viên. */
export default function PermissionsTab() {
  const { users, user: me } = useApp()
  const { defs, groups, reload } = usePermissionData()
  const [editing, setEditing] = useState<PermissionGroup | 'new' | null>(null)
  const label = (k: string) => defs.find((d) => d.key === k)?.label ?? k
  const supers = users.filter((u) => u.super_admin)

  return (
    <>
      <div className="card">
        <div className="row wrap">
          <h3 className="grow">
            <ShieldCheck size={18} /> Nhóm quyền
          </h3>
          <button className="btn primary sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm nhóm quyền
          </button>
        </div>
        <p className="muted small">
          Mỗi nhân viên có quyền = quyền của các nhóm họ thuộc về + quyền riêng cấp thêm (sửa ở tab Nhân viên). Super Admin luôn có
          toàn quyền. Ai thuộc bộ phận / kênh nào vẫn cài ở tab Bộ phận và trang Kênh Chat.
        </p>
        <div className="perm-group-grid">
          {groups.map((g) => (
            <div key={g.id} className="perm-group-card">
              <div className="row">
                <b className="grow">{g.name}</b>
                <button className="icon-btn sm" onClick={() => setEditing(g)} aria-label={`Sửa nhóm ${g.name}`}>
                  <Pencil size={14} />
                </button>
              </div>
              {g.description && <div className="muted small">{g.description}</div>}
              <ul className="perm-mini">
                {g.permissions.length ? g.permissions.map((k) => <li key={k}>{label(k)}</li>) : <li className="muted">Chỉ chat ở kênh, bộ phận được phân công</li>}
              </ul>
              <div className="avatar-row">
                {g.user_ids.map((id) => users.find((u) => u.id === id)).filter(Boolean).map((u) => (
                  <span key={u!.id} title={u!.display_name}>
                    <Avatar name={u!.display_name} src={u!.avatar} size={24} />
                  </span>
                ))}
                {!g.user_ids.length && <span className="muted small">Chưa có thành viên</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Super Admin</h3>
        <p className="muted small">Toàn quyền, không giới hạn. Chỉ Super Admin mới cấp hoặc bỏ được quyền này (ở tab Nhân viên).</p>
        <div className="row wrap">
          {supers.map((u) => (
            <span key={u.id} className="chip plain">
              <Avatar name={u.display_name} src={u.avatar} size={18} /> {u.display_name} <code className="muted">{u.username}</code>
            </span>
          ))}
        </div>
      </div>

      {editing && (
        <GroupForm
          group={editing === 'new' ? null : editing}
          defs={defs}
          myPerms={me.super_admin ? defs.map((d) => d.key) : me.permissions ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </>
  )
}

function GroupForm({
  group,
  defs,
  myPerms,
  onClose,
  onSaved,
}: {
  group: PermissionGroup | null
  defs: PermissionDef[]
  myPerms: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { users, reloadUsers } = useApp()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [perms, setPerms] = useState<string[]>(group?.permissions ?? [])
  const [members, setMembers] = useState<number[]>(group?.user_ids ?? [])
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const body = { name, description, permissions: perms, user_ids: members }
    try {
      if (group) await api(`/permission-groups/${group.id}`, { method: 'PATCH', body })
      else await api('/permission-groups', { body })
      reloadUsers()
      onSaved()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove() {
    if (!group || !confirm(`Xóa nhóm quyền "${group.name}"? Thành viên sẽ mất các quyền của nhóm này.`)) return
    await api(`/permission-groups/${group.id}`, { method: 'DELETE' })
    reloadUsers()
    onSaved()
  }

  return (
    <Modal title={group ? `Sửa nhóm quyền ${group.name}` : 'Thêm nhóm quyền'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Tên nhóm</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Trưởng ca, Kế toán, Kho" autoFocus />
        </label>
        <label className="field">
          <span>Mô tả</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Nhóm này dùng cho ai, làm gì" />
        </label>
        <div className="field">
          <span>Quyền của nhóm</span>
          <PermissionChecklist defs={defs} value={perms} onChange={setPerms} disabledKeys={defs.map((d) => d.key).filter((k) => !myPerms.includes(k))} />
        </div>
        <div className="field">
          <span>Thành viên</span>
          <div className="check-grid">
            {users
              .filter((u) => u.active && !u.super_admin)
              .map((u) => (
                <label key={u.id} className="check">
                  <input
                    type="checkbox"
                    checked={members.includes(u.id)}
                    onChange={(e) => setMembers(e.target.checked ? [...members, u.id] : members.filter((x) => x !== u.id))}
                  />
                  {u.display_name}
                </label>
              ))}
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          {group && (
            <button type="button" className="btn ghost" onClick={remove}>
              <Trash2 size={14} /> Xóa nhóm
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
