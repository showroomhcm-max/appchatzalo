/**
 * TikTok Business: tin nhắn trực tiếp (Business Messaging API, TikTok API for Business v1.3).
 * Nhận tin qua webhook /webhooks/tiktok (sự kiện im_receive_msg, im_send_msg).
 * Mỗi kênh = 1 tài khoản TikTok Business, credentials = { openId, accessToken, refreshToken, ... }.
 * Giới hạn của TikTok: tối đa 10 tin trong 48 giờ kể từ tin gần nhất của khách.
 */
import crypto from "node:crypto";
import { logEvent } from "../db.js";
import { bus } from "../bus.js";
import { saveMessage } from "../store.js";
import { tiktokConfig } from "./app-config.js";
import {
  ApiCallError,
  channelRow,
  fetchJson,
  readCredentials,
  writeCredentials,
  type Capabilities,
  type ChannelAdapter,
  type ChannelStatus,
  type SendOptions,
} from "./common.js";

export type TikTokCredentials = {
  openId: string;
  accessToken: string;
  refreshToken: string;
  /** ms */
  accessExpiresAt: number;
  refreshExpiresAt: number;
  username?: string;
  displayName?: string;
  avatar?: string;
};

const API = () => `${process.env.TIKTOK_API_URL ?? "https://business-api.tiktok.com"}/open_api/v1.3`;

type TikTokResponse<T> = { code: number; message: string; request_id?: string; data: T };

async function call<T>(path: string, init: { method?: string; token?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
  const r = await fetchJson<TikTokResponse<T>>(`${API()}${path}${qs}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(init.token ? { "Access-Token": init.token } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (r.code !== 0) throw new ApiCallError(`TikTok: ${r.message} (mã ${r.code})`, 400, r);
  return r.data;
}

/** Đổi auth_code lấy token (sau khi chủ tài khoản bấm Cho phép). */
export async function exchangeTikTokCode(authCode: string, redirectUri: string) {
  const cfg = tiktokConfig();
  if (!cfg) throw new Error("Chưa nhập TikTok for Business App");
  const d = await call<{ access_token: string; refresh_token: string; expires_in: number; refresh_token_expires_in: number; open_id: string }>(
    "/tt_user/oauth2/token/",
    { body: { client_id: cfg.appId, client_secret: cfg.secret, grant_type: "authorization_code", auth_code: authCode, redirect_uri: redirectUri } },
  );
  return {
    openId: d.open_id,
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    accessExpiresAt: Date.now() + d.expires_in * 1000,
    refreshExpiresAt: Date.now() + d.refresh_token_expires_in * 1000,
  } satisfies TikTokCredentials;
}

export class TikTokSession implements ChannelAdapter {
  readonly platform = "tiktok" as const;
  readonly capabilities: Capabilities = {
    stickers: false,
    reactions: false,
    undo: false,
    forward: false,
    quote: true,
    files: false,
    contacts: false,
  };
  private status: ChannelStatus;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(readonly channelId: number) {
    this.status = { channelId, channelName: channelRow(channelId)?.name ?? `Kênh ${channelId}`, platform: "tiktok", state: "disconnected", updatedAt: Date.now() };
  }
  get connected() {
    return this.status.state === "connected";
  }
  getStatus() {
    return this.status;
  }
  private creds() {
    return readCredentials<TikTokCredentials>(this.channelId);
  }
  private setStatus(patch: Partial<ChannelStatus>, replace = false) {
    const base = { channelId: this.channelId, channelName: channelRow(this.channelId)?.name ?? "", platform: "tiktok" as const };
    this.status = replace ? ({ ...base, ...patch, updatedAt: Date.now() } as ChannelStatus) : { ...this.status, ...base, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }
  refreshName() {
    this.setStatus({});
  }

  /** Access token sống 1 ngày: làm mới trước khi hết hạn 10 phút. */
  private async token() {
    const c = this.creds();
    if (!c) throw new Error("Tài khoản TikTok chưa kết nối");
    if (Date.now() < c.accessExpiresAt - 10 * 60_000) return c.accessToken;
    const cfg = tiktokConfig();
    if (!cfg) throw new Error("Chưa nhập TikTok for Business App");
    const d = await call<{ access_token: string; refresh_token: string; expires_in: number; refresh_token_expires_in: number }>(
      "/tt_user/oauth2/refresh_token/",
      { body: { client_id: cfg.appId, client_secret: cfg.secret, grant_type: "refresh_token", refresh_token: c.refreshToken } },
    );
    writeCredentials(this.channelId, {
      ...c,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || c.refreshToken,
      accessExpiresAt: Date.now() + d.expires_in * 1000,
      refreshExpiresAt: d.refresh_token_expires_in ? Date.now() + d.refresh_token_expires_in * 1000 : c.refreshExpiresAt,
    });
    return d.access_token;
  }

  async init() {
    const c = this.creds();
    if (!c || !channelRow(this.channelId)?.active) return;
    if (!tiktokConfig()) {
      this.setStatus({ state: "error", error: "Chưa nhập TikTok for Business App (Cài đặt › Tích hợp)." }, true);
      return;
    }
    if (c.refreshExpiresAt && Date.now() > c.refreshExpiresAt) {
      this.setStatus({ state: "error", error: "Ủy quyền TikTok đã hết hạn (1 năm). Kết nối lại tài khoản." }, true);
      return;
    }
    this.setStatus({ state: "connecting" }, true);
    try {
      const token = await this.token();
      let name = c.displayName ?? c.username ?? "TikTok";
      let avatar = c.avatar ?? "";
      try {
        const info = await call<{ username?: string; display_name?: string; profile_image?: string }>("/business/get/", {
          token,
          query: { business_id: c.openId, fields: JSON.stringify(["username", "display_name", "profile_image"]) },
        });
        name = info.display_name || info.username || name;
        avatar = info.profile_image || avatar;
        writeCredentials(this.channelId, { ...this.creds(), username: info.username, displayName: info.display_name, avatar });
      } catch (e: any) {
        console.warn(`[tiktok#${this.channelId}] Không đọc được thông tin tài khoản:`, e.message);
      }
      this.setStatus({ state: "connected", account: { id: c.openId, name, avatar }, error: undefined }, true);
      // Giữ token luôn còn hạn
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => this.token().catch((e) => console.error(`[tiktok#${this.channelId}] Làm mới token lỗi:`, e.message)), 30 * 60_000);
    } catch (e: any) {
      console.error(`[tiktok#${this.channelId}] Kết nối thất bại:`, e.message);
      this.setStatus({ state: "error", error: e.message }, true);
    }
  }

  async logout(clearCredentials = true) {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (clearCredentials) {
      writeCredentials(this.channelId, null);
      logEvent(null, null, "channel.logout", { channel: this.channelId, platform: "tiktok" });
    }
    this.setStatus({ state: "disconnected" }, true);
  }

  /** Sự kiện webhook (content là chuỗi JSON). */
  handleEvent(event: string, content: any) {
    if (event !== "im_receive_msg" && event !== "im_send_msg") return;
    const conversationId = String(content.conversation_id ?? "");
    const messageId = String(content.message_id ?? "");
    if (!conversationId || !messageId) return;
    const out = content.from_user?.role === "business_account";
    const type = String(content.type ?? "text");
    const text = content.text?.body ?? "";
    const msgType =
      type === "text" ? "webchat" : type === "image" ? "chat.photo" : type === "video" ? "chat.video.msg" : type === "sticker" || type === "emoji" ? "chat.sticker" : type === "share_post" ? "chat.link" : "webchat";
    const contentValue =
      type === "text"
        ? String(text)
        : type === "share_post"
          ? { title: "Bài viết TikTok", href: content.share_post?.embed_url ?? "" }
          : type === "sticker"
            ? { title: "[Sticker]", href: content.sticker?.url ?? "", thumb: content.sticker?.url ?? "" }
            : { title: `[${type}]` };
    saveMessage({
      channelId: this.channelId,
      threadId: conversationId,
      conversationType: 0,
      zaloMsgId: messageId,
      direction: out ? "out" : "in",
      senderUid: String(content.from_user?.id ?? ""),
      senderName: content.from ?? null,
      // Tin gửi bằng app này đã lưu kèm tên nhân viên; tin gửi từ app TikTok ghi "phone"
      source: out ? "phone" : "customer",
      msgType,
      content: contentValue,
      ts: Number(content.timestamp) || Date.now(),
      customerName: out ? content.to ?? null : content.from ?? null,
      quote: content.referenced_message_info?.referenced_message_id
        ? { msg: "", fromD: "", globalMsgId: String(content.referenced_message_info.referenced_message_id), ownerId: "" }
        : null,
    });
  }

  async sendMessage(opts: SendOptions) {
    const c = this.creds();
    if (!c || !this.connected) throw new Error("Tài khoản TikTok chưa kết nối");
    if (opts.attachments?.length) throw new Error("TikTok: hiện app chỉ gửi được tin nhắn chữ");
    const text = (opts.text ?? "").trim();
    if (!text) throw new Error("Nhập nội dung");
    const token = await this.token();
    const d = await call<{ message: { message_id: string } }>("/business/message/send/", {
      token,
      body: {
        business_id: c.openId,
        recipient_type: "CONVERSATION",
        recipient: opts.conversation.thread_id,
        message_type: "TEXT",
        text: { body: text },
        ...(opts.quote?.zalo_msg_id ? { referenced_message_info: { referenced_message_id: opts.quote.zalo_msg_id } } : {}),
      },
    });
    return [
      saveMessage({
        channelId: this.channelId,
        threadId: opts.conversation.thread_id,
        conversationType: 0,
        zaloMsgId: d.message.message_id,
        direction: "out",
        senderUid: c.openId,
        senderName: c.displayName ?? c.username ?? "TikTok",
        agentId: opts.agentId,
        source: opts.source,
        msgType: "webchat",
        content: text,
        ts: Date.now(),
        quote: opts.quote ? { msg: opts.quote.text ?? "", fromD: opts.quote.sender_name ?? "", globalMsgId: opts.quote.zalo_msg_id ?? "", ownerId: opts.quote.sender_uid ?? "" } : null,
      }).message,
    ];
  }
}

/** Đăng ký webhook tin nhắn cho app (làm 1 lần sau khi nhập App ID / Secret). */
export async function registerTikTokWebhook(callbackUrl: string) {
  const cfg = tiktokConfig();
  if (!cfg) throw new Error("Chưa nhập TikTok for Business App");
  return call("/business/webhook/update/", {
    body: { app_id: cfg.appId, secret: cfg.secret, event_type: "DIRECT_MESSAGE", callback_url: callbackUrl },
  });
}

/**
 * Kiểm tra chữ ký webhook nếu TikTok gửi header "TikTok-Signature: t=<giây>,s=<hex>"
 * (HMAC-SHA256 của "<t>.<body>" bằng app secret). Không có header thì kiểm tra client_key trùng App ID.
 */
export function verifyTikTokWebhook(rawBody: Buffer, header: string | undefined, clientKey: string | undefined) {
  const cfg = tiktokConfig();
  if (!cfg) return false;
  if (header) {
    const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
    if (!parts.t || !parts.s) return false;
    const expected = crypto.createHmac("sha256", cfg.secret).update(`${parts.t}.${rawBody.toString("utf8")}`).digest("hex");
    return parts.s.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.s), Buffer.from(expected));
  }
  return clientKey === cfg.appId;
}
