import { useEffect, useRef, useState } from 'react'
import { Camera, KeyRound, LogOut, ShieldOff, Trash2 } from 'lucide-react'
import { api } from './api'
import { useApp } from './store'
import { Avatar } from './components'
import { ThemeChoice } from './ThemeToggle'

const ROLE = (u: { super_admin?: number; role: string }) => (u.super_admin ? 'Super Admin' : u.role === 'admin' ? 'Quản lý' : 'Nhân viên')

/** Cắt vuông giữa ảnh, thu về 256×256 JPG (nhẹ, máy chủ chỉ cần lưu). */
async function squareAvatar(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 256, 256)
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256)
    return await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.88))
  } catch {
    throw new Error('Không đọc được ảnh này, chọn ảnh JPG hoặc PNG khác')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Đổi / bỏ ảnh đại diện của chính mình. */
export function useAvatarActions() {
  const { reloadMe } = useApp()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reloadMe()
    } catch (e: any) {
      alert(e?.message ?? 'Không đổi được ảnh đại diện')
    } finally {
      setBusy(false)
    }
  }
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        void run(async () => {
          const fd = new FormData()
          fd.append('file', await squareAvatar(f), 'avatar.jpg')
          await api('/me/avatar', { body: fd })
        })
      }}
    />
  )
  return {
    busy,
    fileInput,
    pick: () => input.current?.click(),
    remove: () => run(() => api('/me/avatar', { method: 'DELETE' })),
  }
}

/** Bấm avatar ở thanh bên (máy tính): thông tin tài khoản, ảnh đại diện, giao diện, mật khẩu, đăng xuất. */
export function AccountMenu({ onClose, onChangePassword }: { onClose: () => void; onChangePassword: () => void }) {
  const { user, logout } = useApp()
  const avatar = useAvatarActions()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.me')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])
  return (
    <div className="account-menu" ref={box} role="dialog" aria-label="Tài khoản">
      <div className="account-head">
        <button className="account-photo" onClick={avatar.pick} disabled={avatar.busy} title="Đổi ảnh đại diện" aria-label="Đổi ảnh đại diện">
          <Avatar name={user.display_name} src={user.avatar} size={56} />
          <span className="account-photo-ic">
            <Camera size={14} />
          </span>
        </button>
        <div className="grow">
          <b>{user.display_name}</b>
          <div className="small muted">
            {ROLE(user)} · {user.username}
          </div>
        </div>
      </div>
      <div className="account-actions">
        <button className="menu-row" onClick={avatar.pick} disabled={avatar.busy}>
          <Camera size={16} /> {avatar.busy ? 'Đang tải ảnh…' : user.avatar ? 'Đổi ảnh đại diện' : 'Thêm ảnh đại diện'}
        </button>
        {user.avatar && (
          <button className="menu-row" onClick={avatar.remove} disabled={avatar.busy}>
            <Trash2 size={16} /> Bỏ ảnh đại diện
          </button>
        )}
        {avatar.fileInput}
      </div>
      <ThemeChoice />
      <div className="account-actions">
        {user.auth_source === 'local' && (
          <button
            className="menu-row"
            onClick={() => {
              onClose()
              onChangePassword()
            }}
          >
            <KeyRound size={16} /> Đổi mật khẩu
          </button>
        )}
        <button
          className="menu-row"
          onClick={async () => {
            if (!confirm('Đăng xuất tài khoản này khỏi MỌI thiết bị (máy tính, điện thoại…)? Dùng khi nghi lộ tài khoản.')) return
            try {
              await api('/auth/logout-all', { method: 'POST' })
            } finally {
              logout()
            }
          }}
        >
          <ShieldOff size={16} /> Đăng xuất mọi thiết bị
        </button>
        <button className="menu-row danger" onClick={logout}>
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>
    </div>
  )
}
