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
};

export const bus = new EventEmitter<BusEvents>();
bus.setMaxListeners(50);
