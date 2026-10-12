import { useState, type FormEvent } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { User } from '../types'
import { Avatar, Badge, Modal, PublicLink } from '../components'
import { fullTime } from '../util'

export default function UsersPage() {
  const { users, reloadUsers, user: me, presence } = useApp()
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const online = new Set(presence.online.map((o) => o.userId))
  // Tài khoản Odoo tự đăng nhập lần đầu: chưa được duyệt, chưa từng vào app.
  const pending = users.filter((u) => !u.active && u.auth_source === 'odoo' && !u.last_login_at)

  async function approve(u: User) {
    await api(`/users/${u.id}`, { method: 'PATCH', body: { active: true } })
    reloadUsers()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Nhân viên</h1>
          <p className="muted">
            Nhân viên đăng nhập bằng tài khoản Odoo. Người mới đăng nhập lần đầu sẽ nằm ở mục "Chờ duyệt" cho tới khi bạn
            cho phép.
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <UserPlus size={18} /> Thêm nhân viên
        </button>
      </div>
      <PublicLink />

      {pending.length > 0 && (
        <div className="card">
          <h3>Chờ duyệt ({pending.length})</h3>
          <ul className="list">
            {pending.map((u) => (
              <li key={u.id}>
                <span className="row">
                  <Avatar name={u.display_name} size={30} />
                  <span>
                    <b>{u.display_name}</b>
                    <div className="muted small">
                      {u.username} · thử đăng nhập lúc {u.created_at ? fullTime(u.created_at) : '—'}
                    </div>
                  </span>
                </span>
                <span className="row">
                  <button className="btn primary sm" onClick={() => approve(u)}>
                    <Check size={14} /> Cho phép
                  </button>
                  <button className="btn ghost sm" onClick={() => setEditing(u)}>
                    Sửa
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tài khoản</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Lần vào gần nhất</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => !pending.includes(u))
                .map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'dim'}>
                    <td>
                      <span className="row">
                        <Avatar name={u.display_name} size={30} />
                        {u.display_name}
                        {online.has(u.id) && <span className="online-dot" title="Đang trực tuyến" />}
                      </span>
                    </td>
                    <td>
                      <span className="row">
                        <code>{u.username}</code>
                        {u.auth_source === 'odoo' ? <Badge tone="info">Odoo</Badge> : <Badge>Nội bộ</Badge>}
                      </span>
                    </td>
                    <td>{u.role === 'admin' ? <Badge tone="green">Quản trị</Badge> : <Badge>Nhân viên</Badge>}</td>
                    <td>{u.active ? 'Đang hoạt động' : 'Đã khóa'}</td>
                    <td className="muted">{u.last_login_at ? fullTime(u.last_login_at) : 'Chưa vào'}</td>
                    <td className="right">
                      <button className="btn ghost sm" onClick={() => setEditing(u)}>
                        Sửa
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadUsers()
          }}
        />
      )}
    </div>
  )
}

function UserForm({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User | null
  isSelf: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [source, setSource] = useState<User['auth_source']>(user?.auth_source ?? 'odoo')
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [role, setRole] = useState(user?.role ?? 'agent')
  const [active, setActive] = useState(user ? !!user.active : true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const isOdoo = source === 'odoo'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (user) {
        await api(`/users/${user.id}`, {
          method: 'PATCH',
          body: { display_name: displayName, role, active, ...(password && !isOdoo ? { password } : {}) },
        })
      } else {
        await api('/users', { body: { auth_source: source, username, display_name: displayName, role, password } })
      }
      onSaved()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <Modal title={user ? `Sửa ${user.display_name}` : 'Thêm nhân viên'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!user && (
          <label className="field">
            <span>Loại tài khoản</span>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value as User['auth_source'])}>
              <option value="odoo">Tài khoản Odoo (khuyên dùng)</option>
              <option value="local">Tài khoản riêng của app (người không có Odoo)</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>{isOdoo ? 'Email đăng nhập Odoo' : 'Tên đăng nhập'}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={!!user}
            autoComplete="off"
            placeholder={isOdoo ? 'ten@sieutoc.com' : ''}
          />
        </label>
        <label className="field">
          <span>Tên hiển thị (hiện trong lịch sử chat và báo cáo)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
        </label>
        {isOdoo ? (
          <p className="muted small">Nhân viên dùng mật khẩu Odoo của họ để đăng nhập. App không lưu mật khẩu Odoo.</p>
        ) : (
          <label className="field">
            <span>{user ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu (tối thiểu 6 ký tự)'}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        <label className="field">
          <span>Vai trò</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as User['role'])} disabled={isSelf}>
            <option value="agent">Nhân viên — chat, ghi chú, xuất dữ liệu của mình</option>
            <option value="admin">Quản trị — thêm toàn quyền: báo cáo, đánh giá, kết nối Zalo, tích hợp</option>
          </select>
        </label>
        {user && !isSelf && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Cho phép đăng nhập
          </label>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary">Lưu</button>
        </div>
      </form>
    </Modal>
  )
}
