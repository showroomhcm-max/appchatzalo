/**
 * Phần chung cho mọi nền tảng chat (Zalo, Facebook, TikTok, TikTok Shop).
 * Mỗi kênh trong bảng channels có một "adapter" lo đăng nhập, nhận tin (webhook / listener) và gửi tin.
 */
import { get, run } from "../db.js";
import type { Conversation, Source } from "../store.js";

export type Platform = "zalo" | "zalo_oa" | "facebook" | "tiktok" | "tiktok_shop";

export const PLATFORM_LABEL: Record<Platform, string> = {
  zalo: "Zalo",
  zalo_oa: "Zalo OA",
  facebook: "Facebook",
  tiktok: "TikTok",
  tiktok_shop: "TikTok Shop",
};

export type ChannelStatus = {
  channelId: number;
  channelName: string;
  platform: Platform;
  state: "disconnected" | "qr" | "scanned" | "connecting" | "connected" | "error";
  qrImage?: string;
  scannedBy?: { name: string; avatar: string };
  account?: { id: string; name: string; avatar: string };
  error?: string;
  updatedAt: number;
};

export type OutgoingAttachment = {
  data: Buffer;
  filename: string;
  size: number;
  width?: number;
  height?: number;
  /** Đường dẫn bản lưu trên server để hiển thị lại trong lịch sử chat. */
  localUrl?: string;
};

/** Tin nhắn đã lưu, dùng để trả lời / thả cảm xúc / thu hồi. */
export type StoredMessage = {
  zalo_msg_id: string | null;
  cli_msg_id: string | null;
  msg_type: string | null;
  sender_uid: string | null;
  sender_name: string | null;
  text: string | null;
  raw: any;
  ts: number;
};

export type SendOptions = {
  conversation: Conversation;
  text?: string;
  attachments?: OutgoingAttachment[];
  agentId: number | null;
  source: Source;
  quote?: StoredMessage | null;
  /** Bình luận Facebook: "public" = trả lời dưới bình luận, "private" = nhắn riêng qua Messenger */
  mode?: "public" | "private";
};

/** Những gì kênh làm được (giao diện ẩn nút không hỗ trợ). */
export type Capabilities = {
  stickers: boolean;
  reactions: boolean;
  undo: boolean;
  forward: boolean;
  quote: boolean;
  files: boolean;
  /** Tìm bạn bè / tra số điện thoại */
  contacts: boolean;
};

export interface ChannelAdapter {
  readonly channelId: number;
  readonly platform: Platform;
  readonly connected: boolean;
  readonly capabilities: Capabilities;
  getStatus(): ChannelStatus;
  init(): Promise<void>;
  logout(clearCredentials?: boolean): Promise<void>;
  refreshName(): void;
  sendMessage(opts: SendOptions): Promise<any[]>;
}

export function channelRow(id: number) {
  return get<{ id: number; name: string; platform: Platform; credentials: string | null; external_id: string | null; active: number }>(
    "SELECT id, name, platform, credentials, external_id, active FROM channels WHERE id = ?",
    id,
  );
}

export function readCredentials<T>(id: number): T | null {
  const row = channelRow(id);
  if (!row?.credentials) return null;
  try {
    return JSON.parse(row.credentials) as T;
  } catch {
    return null;
  }
}

export function writeCredentials(id: number, creds: unknown) {
  run("UPDATE channels SET credentials = ? WHERE id = ?", creds === null ? null : JSON.stringify(creds), id);
}

export class ApiCallError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

/** Gọi API JSON có thời hạn; lỗi trả về thông điệp dễ đọc. */
export async function fetchJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* không phải JSON */
  }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? (typeof body === "string" ? body.slice(0, 200) : `HTTP ${res.status}`);
    throw new ApiCallError(msg, res.status, body);
  }
  return body as T;
}

/** URL công khai của app (cho webhook, OAuth redirect, ảnh gửi đi). */
export function publicBaseUrl() {
  return (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
}
