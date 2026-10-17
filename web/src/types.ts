export type Role = 'admin' | 'agent'

export type Platform = 'zalo' | 'zalo_oa' | 'facebook' | 'tiktok' | 'tiktok_shop'

/** Tính năng nền tảng hỗ trợ (ẩn nút không dùng được) */
export type Capabilities = {
  stickers: boolean
  reactions: boolean
  undo: boolean
  forward: boolean
  quote: boolean
  files: boolean
  contacts: boolean
}

export type User = {
  id: number
  username: string
  display_name: string
  role: Role
  auth_source: 'local' | 'odoo'
  /** 1 = Super Admin (quyền cao nhất) */
  super_admin?: number
  /** Quyền thực tế (nhóm quyền + quyền riêng) */
  permissions?: string[]
  /** Nhóm quyền đang thuộc */
  group_ids?: number[]
  /** Quyền riêng cấp thêm cho người này */
  own_permissions?: string[]
  department_ids?: number[]
  /** Kênh được vào thẳng (thấy toàn bộ hội thoại của kênh) */
  channel_ids?: number[]
  /** Kênh đang tick chọn để chat (null = mọi kênh được quyền) */
  working_channel_ids?: number[] | null
  active?: number
  last_login_at?: number | null
  created_at?: number
}

export type ConvStatus = 'open' | 'pending' | 'closed'

export type Conversation = {
  id: string
  channel_id: number
  channel_name: string | null
  /** monitor = Zalo nhân viên đang giám sát (chỉ xem nếu không phải người giữ máy) */
  channel_mode?: 'shared' | 'monitor' | null
  /** Nhân viên giữ SĐT / Zalo của kênh (Zalo nhân viên) */
  holder_name?: string | null
  thread_id: string
  department_id: number | null
  department_name: string | null
  department_color: string | null
  phone: string | null
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
  platform?: Platform
  /** Đã xóa khỏi hộp thư (ẩn; có tin mới thì hiện lại) */
  deleted_at?: number | null
  /** Zalo: khách đã nhận / đã xem tới tin gửi lúc này */
  delivered_ts?: number | null
  seen_ts?: number | null
  /** Nhóm: số người đã xem tin mới nhất */
  seen_count?: number | null
  /** chat = tin nhắn, comment = bình luận Facebook */
  kind?: 'chat' | 'comment'
  /** Bình luận: bài viết gốc */
  meta?: { post_id?: string; post_url?: string; post_message?: string | null } | null
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
  /** Zalo công ty: người đang giữ máy khi tin được gửi từ điện thoại */
  holder_name?: string | null
  /** Giờ tin bị thu hồi */
  undone_at?: number | null
  source: 'web' | 'api' | 'phone' | 'history' | 'customer'
  msg_type: string | null
  text: string | null
  raw: Record<string, any> | null
  ts: number
  undone: number
  quote: { msg: string; fromD: string; globalMsgId: string; ownerId: string } | null
  reactions?: { icon: string; count: number; names: string[]; mine: boolean }[]
}

export type ZaloStatus = {
  channelId: number
  channelName: string
  platform?: Platform
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
export type Template = {
  id: number
  shortcut: string
  content: string
  created_by: number | null
  department_ids: number[]
  /** Form CTLM: ảnh / tệp đính kèm (link gốc + bản đã tải về /uploads/templates/…) */
  image_url?: string | null
  image_file?: string | null
  file_url?: string | null
  file_file?: string | null
  file_name?: string | null
  ask_address?: boolean
  updated_at?: number | null
  updated_label?: string | null
  updated_by_name?: string | null
}

export type Channel = {
  id: number
  name: string
  platform: Platform
  /** shared = kênh CSKH chung; monitor = Zalo nhân viên đang giám sát */
  mode?: 'shared' | 'monitor'
  /** Nhân viên đang giữ SĐT / Zalo này */
  holder_id?: number | null
  capabilities?: Capabilities
  zalo_uid: string | null
  zalo_name: string | null
  avatar: string | null
  default_department_id: number | null
  active: number
  department_ids: number[]
  /** Nhân viên được vào thẳng kênh (chỉ quản trị viên thấy) */
  user_ids?: number[]
  conversations?: number
  status: ZaloStatus | null
}

export type AlertType = 'no_reply' | 'no_order' | 'no_shipping'

/** Cảnh báo đơn "rơi" đang mở */
export type Alert = {
  id: number
  conversation_id: string
  type: AlertType
  label: string
  detail: { since?: number; phone?: string | null; address?: boolean; keyword?: string | null; order?: string } | null
  created_at: number
  conversation_name: string | null
  conversation_avatar: string | null
  assigned_to: number | null
  assigned_name: string | null
  channel_id: number | null
  channel_name: string | null
  platform: Platform | null
}

export type Order = {
  id: number
  source: string
  external_id: string
  code: string | null
  customer_phone: string | null
  customer_name: string | null
  status: string | null
  fulfillment_status: string | null
  total: number | null
  created_at: number
}

export type Sticker = { id: number; cateId: number; type: number; url: string | null; text: string }

export type Department = { id: number; name: string; color: string; channel_ids: number[]; user_ids: number[] }

export type Tag = { id: number; name: string; color: string; department_ids: number[] }
