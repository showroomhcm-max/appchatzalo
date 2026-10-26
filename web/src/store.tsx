import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import { api, connectSocket, setToken, setUnauthorizedHandler } from './api'
import type { Alert, Channel, Department, PresenceState, Tag, User, ZaloStatus } from './types'
import { can, type Permission } from './perm'

type Ctx = {
  user: User
  users: User[]
  reloadUsers: () => void
  /** Tải lại thông tin tài khoản đang đăng nhập (sau khi đổi ảnh đại diện…) */
  reloadMe: () => Promise<void>
  /** Trạng thái Zalo của các kênh người này dùng được */
  zaloStatuses: ZaloStatus[]
  channels: Channel[]
  departments: Department[]
  tags: Tag[]
  reloadSettings: () => void
  presence: PresenceState
  /** Người này có quyền không */
  can: (perm: Permission) => boolean
  /** Kênh người này đang tick chọn để chat; null = mọi kênh được quyền */
  workingChannelIds: number[] | null
  setWorkingChannels: (ids: number[] | null) => Promise<void>
  /** Kênh hiển thị trong hộp thư (đã áp lựa chọn ở trang Kênh Chat) */
  activeChannels: Channel[]
  /** Kênh dùng để chat (bỏ Zalo nhân viên đang giám sát, trừ khi chính mình giữ máy) */
  chatChannels: Channel[]
  /** Kênh xem được ở Hội thoại (gồm Zalo nhân viên nếu có quyền Giám sát) */
  viewChannels: Channel[]
  socket: Socket | null
  socketConnected: boolean
  logout: () => void
  /** Cảnh báo đơn "rơi" đang mở (trong phạm vi người này xem được) */
  alerts: Alert[]
  reloadAlerts: () => void
}

const AppContext = createContext<Ctx | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp ngoài AppProvider')
  return ctx
}

/** Đăng ký sự kiện realtime, tự gỡ khi component unmount. */
export function useSocketEvent<T = any>(event: string, handler: (data: T) => void) {
  const { socket } = useApp()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!socket) return
    const fn = (data: T) => ref.current(data)
    socket.on(event, fn)
    return () => {
      socket.off(event, fn)
    }
  }, [socket, event])
}

export function AppProvider({ user: initialUser, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  // Quyền có thể đổi khi quản lý chỉnh nhóm quyền → tải lại thông tin của chính mình
  const [user, setUser] = useState<User>(initialUser)
  const [users, setUsers] = useState<User[]>([])
  const [zaloStatuses, setZaloStatuses] = useState<ZaloStatus[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [presence, setPresence] = useState<PresenceState>({ online: [], byConversation: {} })
  const [workingChannelIds, setWorkingIds] = useState<number[] | null>(user.working_channel_ids ?? null)

  const setWorkingChannels = useCallback(async (ids: number[] | null) => {
    const r = await api<{ working_channel_ids: number[] | null }>('/me/working-channels', {
      method: 'PUT',
      body: { channel_ids: ids },
    })
    setWorkingIds(r.working_channel_ids)
  }, [])
  const [socket, setSocket] = useState<Socket | null>(null)
  const [socketConnected, setSocketConnected] = useState(false)

  const logout = () => {
    setToken(null)
    onLogout()
  }

  const [alerts, setAlerts] = useState<Alert[]>([])
  const reloadAlerts = useCallback(() => {
    api<Alert[]>('/alerts').then(setAlerts).catch(() => {})
  }, [])

  const reloadUsers = useCallback(() => {
    api<User[]>('/users').then(setUsers).catch(() => {})
  }, [])

  const reloadSettings = useCallback(() => {
    api<Channel[]>('/channels').then(setChannels).catch(() => {})
    api<Department[]>('/departments').then(setDepartments).catch(() => {})
    api<Tag[]>('/tags').then(setTags).catch(() => {})
    api<ZaloStatus[]>('/zalo/status').then(setZaloStatuses).catch(() => {})
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    reloadUsers()
    reloadSettings()
    reloadAlerts()
    const s = connectSocket()
    s.on('alerts:changed', reloadAlerts)
    s.on('connect', () => setSocketConnected(true))
    s.on('disconnect', () => setSocketConnected(false))
    s.on('connect_error', (e) => {
      if (e.message === 'unauthorized') logout()
    })
    s.on('zalo:status', (st: ZaloStatus) =>
      setZaloStatuses((prev) => {
        const next = prev.filter((p) => p.channelId !== st.channelId)
        return [...next, st].sort((a, b) => a.channelId - b.channelId)
      }),
    )
    s.on('settings:changed', (what: string) => {
      reloadSettings()
      if (what === 'users' || what === 'departments') {
        reloadUsers()
        api<User>('/auth/me').then(setUser).catch(() => {})
      }
    })
    s.on('presence', setPresence)
    setSocket(s)
    return () => {
      s.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppContext.Provider
      value={{
        user,
        users,
        reloadUsers,
        reloadMe: () => api<User>('/auth/me').then(setUser),
        zaloStatuses,
        channels,
        departments,
        tags,
        reloadSettings,
        presence,
        workingChannelIds,
        setWorkingChannels,
        can: (perm: Permission) => can(user, perm),
        activeChannels: (workingChannelIds ? channels.filter((c) => workingChannelIds.includes(c.id)) : channels).filter(
          (c) => c.mode !== 'monitor' || c.holder_id === user.id,
        ),
        chatChannels: channels.filter((c) => c.mode !== 'monitor' || c.holder_id === user.id),
        // Ô chọn kênh ở Hội thoại: thêm Zalo nhân viên (chỉ xem) cho người có quyền Giám sát
        viewChannels: channels.filter((c) => c.mode !== 'monitor' || c.holder_id === user.id || can(user, 'monitor.view')),
        socket,
        socketConnected,
        logout,
        alerts,
        reloadAlerts,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
