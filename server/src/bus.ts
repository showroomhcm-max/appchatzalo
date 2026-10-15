import { EventEmitter } from "node:events";

/**
 * Kênh sự kiện nội bộ. Realtime (Socket.IO) và webhook đều nghe ở đây,
 * nên mọi thay đổi chỉ cần emit một lần.
 */
export type BusEvents = {
  "message.created": [message: any, conversation: any];
  "message.updated": [message: any, conversation: any];
  "conversation.updated": [conversation: any, change?: { type: string; by?: number | null; data?: unknown }];
  "zalo.status": [status: any];
  /** Cài đặt (tag, bộ phận…) thay đổi → giao diện tải lại danh sách. */
  "settings.changed": [what: string];
  /** Cảnh báo đơn "rơi" mới mở */
  "alert.created": [alert: any];
  /** Danh sách cảnh báo thay đổi (mở / đóng) */
  "alerts.changed": [];
  /** Đơn hàng mới / cập nhật (Sapo, API) */
  "order.updated": [order: any];
  /** Zalo: khách đang soạn tin */
  "zalo.typing": [event: { channelId: number; threadId: string; uid: string }];
  /** Zalo cá nhân: lời mời kết bạn mới / đã thành bạn */
  "zalo.friend": [event: { channelId: number; type: "request" | "added"; uid: string }];
  /** Giám sát Zalo nhân viên: có tin bị gắn cờ */
  "monitor.flagged": [flag: any];
};

export const bus = new EventEmitter<BusEvents>();
bus.setMaxListeners(50);
