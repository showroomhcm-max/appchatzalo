import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import { api, connectSocket, setToken, setUnauthorizedHandler } from './api'
import type { PresenceState, User, ZaloStatus } from './types'

type Ctx = {
  user: User
  users: User[]
  reloadUsers: () => void
  zalo: ZaloStatus
  presence: PresenceState
  socket: Socket | null
  socketConnected: boolean
  logout: () => void
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

export function AppProvider({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([])
  const [zalo, setZalo] = useState<ZaloStatus>({ state: 'disconnected', updatedAt: 0 })
  const [presence, setPresence] = useState<PresenceState>({ online: [], byConversation: {} })
  const [socket, setSocket] = useState<Socket | null>(null)
  const [socketConnected, setSocketConnected] = useState(false)

  const logout = () => {
    setToken(null)
    onLogout()
  }

  const reloadUsers = () => {
    api<User[]>('/users').then(setUsers).catch(() => {})
  }

  useEffect(() => {
    setUnauthorizedHandler(logout)
    reloadUsers()
    api<ZaloStatus>('/zalo/status').then(setZalo).catch(() => {})
    const s = connectSocket()
    s.on('connect', () => setSocketConnected(true))
    s.on('disconnect', () => setSocketConnected(false))
    s.on('connect_error', (e) => {
      if (e.message === 'unauthorized') logout()
    })
    s.on('zalo:status', setZalo)
    s.on('presence', setPresence)
    setSocket(s)
    return () => {
      s.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppContext.Provider value={{ user, users, reloadUsers, zalo, presence, socket, socketConnected, logout }}>
      {children}
    </AppContext.Provider>
  )
}
