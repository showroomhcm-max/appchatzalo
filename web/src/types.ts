export type Role = 'admin' | 'agent'

export type User = {
  id: number
  username: string
  display_name: string
  role: Role
  auth_source: 'local' | 'odoo'
  active?: number
  last_login_at?: number | null
  created_at?: number
}

export type ConvStatus = 'open' | 'pending' | 'closed'

export type Conversation = {
  id: string
  type: number
  name: string | null
  avatar: string | null
  assigned_to: number | null
  assigned_name: string | null
  status: ConvStatus
  tags: string[]
  external_ref: string | null
  unread_count: number
  last_message_at: number | null
  last_message_preview: string | null
  last_direction: 'in' | 'out' | null
  created_at: number
}

export type Message = {
  id: number
  conversation_id: string
  zalo_msg_id: string | null
  direction: 'in' | 'out'
  sender_uid: string | null
  sender_name: string | null
  agent_id: number | null
  agent_name: string | null
  source: 'web' | 'api' | 'phone' | 'history' | 'customer'
  msg_type: string | null
  text: string | null
  raw: Record<string, any> | null
  ts: number
  undone: number
}

export type ZaloStatus = {
  state: 'disconnected' | 'qr' | 'scanned' | 'connecting' | 'connected' | 'error'
  qrImage?: string
  scannedBy?: { name: string; avatar: string }
  account?: { id: string; name: string; avatar: string }
  error?: string
  updatedAt: number
}

export type PresenceState = {
  online: { userId: number; name: string }[]
  byConversation: Record<string, { userId: number; name: string; typing: boolean }[]>
}

export type Note = { id: number; content: string; author: string | null; created_at: number }
export type Review = {
  id: number
  score: number
  comment: string | null
  reviewer: string | null
  agent: string | null
  created_at: number
}
export type Template = { id: number; shortcut: string; content: string; created_by: number | null }
