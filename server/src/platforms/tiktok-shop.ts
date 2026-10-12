/**
 * TikTok Shop: chat với người mua (Customer Service API 202309, TikTok Shop Partner).
 * Nhận tin qua webhook /webhooks/tiktok-shop (NEW_MESSAGE) + quét lại định kỳ cho chắc.
 * Mỗi kênh = 1 shop, credentials = { shopId, shopCipher, accessToken, refreshToken, ... }.
 * Quyền Customer Service là quyền hạn chế: app phải được TikTok Shop duyệt mới gọi được.
 */
import crypto from "node:crypto";
import { logEvent } from "../db.js";
import { bus } from "../bus.js";
import { saveMessage, conversationKey, getConversation } from "../store.js";
import { tiktokShopConfig } from "./app-config.js";
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

export type TikTokShopCredentials = {
  shopId: string;
  shopCipher: string;
  shopName?: string;
  accessToken: string;
  refreshToken: string;
  /** ms */
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

const OPEN_API = () => process.env.TTS_API_URL ?? "https://open-api.tiktokglobalshop.com";
const AUTH_API = () => process.env.TTS_AUTH_URL ?? "https://auth.tiktok-shops.com";

/** Ký request theo tài liệu "Sign your API request" của TikTok Shop. */
export function signTikTokShop(path: string, query: Record<string, string>, body: string, appSecret: string) {
  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();
  const input = path + keys.map((k) => k + query[k]).join("") + body;
  return crypto.createHmac("sha256", appSecret).update(appSecret + input + appSecret).digest("hex");
}

type ShopResponse<T> = { code: number; message: string; request_id?: string; data: T };

async function shopCall<T>(
  path: string,
  opts: { method?: string; token?: string; query?: Record<string, string>; body?: unknown },
) {
  const cfg = tiktokShopConfig();
  if (!cfg) throw new Error("Chưa nhập TikTok Shop App");
  const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const query: Record<string, string> = { app_key: cfg.appKey, timestamp: String(Math.floor(Date.now() / 1000)), ...(opts.query ?? {}) };
  query.sign = signTikTokShop(path, query, body, cfg.appSecret);
  const r = await fetchJson<ShopResponse<T>>(`${OPEN_API()}${path}?${new URLSearchParams(query)}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...(opts.token ? { "x-tts-access-token": opts.token } : {}) },
    body: body || undefined,
  });
  if (r.code !== 0) throw new ApiCallError(`TikTok Shop: ${r.message} (mã ${r.code})`, 400, r);
  return r.data;
}

type TokenData = {
  access_token: string;
  access_token_expire_in: number;
  refresh_token: string;
  refresh_token_expire_in: number;
  open_id?: string;
  seller_name?: string;
};

async function tokenRequest(params: Record<string, string>) {
  const cfg = tiktokShopConfig();
  if (!cfg) throw new Error("Chưa nhập TikTok Shop App");
  const q = new URLSearchParams({ app_key: cfg.appKey, app_secret: cfg.appSecret, ...params });
  const r = await fetchJson<ShopResponse<TokenData>>(`${AUTH_API()}/api/v2/token/get?${q}`);
  if (r.code !== 0) throw new ApiCallError(`TikTok Shop: ${r.message} (mã ${r.code})`, 400, r);
  return r.data;
}

/** Đổi mã ủy quyền của người bán lấy token + danh sách shop đã ủy quyền. */
export async function exchangeTikTokShopCode(code: string) {
  const t = await tokenRequest({ auth_code: code, grant_type: "authorized_code" });
  const shops = await shopCall<{ shops: { id: string; name: string; region: string; cipher: string; code?: string }[] }>(
    "/authorization/202309/shops",
    { token: t.access_token },
  );
  return shops.shops.map((s) => ({
    shopId: s.id,
    shopCipher: s.cipher,
    shopName: s.name,
    region: s.region,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    // TikTok Shop trả về thời điểm hết hạn (giây)
    accessExpiresAt: t.access_token_expire_in * 1000,
    refreshExpiresAt: t.refresh_token_expire_in * 1000,
  }));
}

/** Kiểm tra chữ ký webhook: header Authorization = HMAC-SHA256(app secret, app_key + body). */
export function verifyTikTokShopWebhook(rawBody: Buffer, header: string | undefined) {
  const cfg = tiktokShopConfig();
  if (!cfg || !header) return false;
  const expected = crypto.createHmac("sha256", cfg.appSecret).update(cfg.appKey).update(rawBody).digest("hex");
  const got = header.trim().toLowerCase();
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

type ShopMessage = {
  id: string;
  index?: string | number;
  type: string;
  content: string;
  create_time: number;
  is_visible?: boolean;
  sender?: { role?: string; nickname?: string; avatar?: string; im_user_id?: string };
};

export class TikTokShopSession implements ChannelAdapter {
  readonly platform = "tiktok_shop" as const;
  readonly capabilities: Capabilities = {
    stickers: false,
    reactions: false,
    undo: false,
    forward: false,
    quote: false,
    files: false,
    contacts: false,
  };
  private status: ChannelStatus;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(readonly channelId: number) {
    this.status = { channelId, channelName: channelRow(channelId)?.name ?? `Kênh ${channelId}`, platform: "tiktok_shop", state: "disconnected", updatedAt: Date.now() };
  }
  get connected() {
    return this.status.state === "connected";
  }
  getStatus() {
    return this.status;
  }
  private creds() {
    return readCredentials<TikTokShopCredentials>(this.channelId);
  }
  private setStatus(patch: Partial<ChannelStatus>, replace = false) {
    const base = { channelId: this.channelId, channelName: channelRow(this.channelId)?.name ?? "", platform: "tiktok_shop" as const };
    this.status = replace ? ({ ...base, ...patch, updatedAt: Date.now() } as ChannelStatus) : { ...this.status, ...base, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }
  refreshName() {
    this.setStatus({});
  }

  private async token() {
    const c = this.creds();
    if (!c) throw new Error("Shop chưa kết nối");
    if (Date.now() < c.accessExpiresAt - 60 * 60_000) return c.accessToken;
    const t = await tokenRequest({ refresh_token: c.refreshToken, grant_type: "refresh_token" });
    writeCredentials(this.channelId, {
      ...c,
      accessToken: t.access_token,
      refreshToken: t.refresh_token || c.refreshToken,
      accessExpiresAt: t.access_token_expire_in * 1000,
      refreshExpiresAt: t.refresh_token_expire_in * 1000 || c.refreshExpiresAt,
    });
    return t.access_token;
  }

  async init() {
    const c = this.creds();
    if (!c || !channelRow(this.channelId)?.active) return;
    if (!tiktokShopConfig()) {
      this.setStatus({ state: "error", error: "Chưa nhập TikTok Shop App (Cài đặt › Tích hợp)." }, true);
      return;
    }
    this.setStatus({ state: "connecting" }, true);
    try {
      const token = await this.token();
      // Gọi thử API chat để chắc app đã được duyệt quyền Customer Service
      await shopCall("/customer_service/202309/conversations", { token, query: { shop_cipher: c.shopCipher, page_size: "1" } });
      this.setStatus({ state: "connected", account: { id: c.shopId, name: c.shopName ?? "TikTok Shop", avatar: "" }, error: undefined }, true);
      if (this.pollTimer) clearInterval(this.pollTimer);
      // Webhook có thể sót tin: quét lại các hội thoại mới mỗi phút
      this.pollTimer = setInterval(() => this.poll().catch((e) => console.warn(`[tiktok_shop#${this.channelId}] Quét tin lỗi:`, e.message)), 60_000);
      void this.poll().catch(() => {});
    } catch (e: any) {
      console.error(`[tiktok_shop#${this.channelId}] Kết nối thất bại:`, e.message);
      this.setStatus({ state: "error", error: e.message }, true);
    }
  }

  async logout(clearCredentials = true) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (clearCredentials) {
      writeCredentials(this.channelId, null);
      logEvent(null, null, "channel.logout", { channel: this.channelId, platform: "tiktok_shop" });
    }
    this.setStatus({ state: "disconnected" }, true);
  }

  /** Tải tin mới nhất của một hội thoại rồi lưu (bỏ trùng theo id tin). */
  async syncConversation(conversationId: string, buyer?: { nickname?: string; avatar?: string }) {
    const c = this.creds();
    if (!c) return;
    const token = await this.token();
    const d = await shopCall<{ messages: ShopMessage[] }>(`/customer_service/202309/conversations/${conversationId}/messages`, {
      token,
      query: { shop_cipher: c.shopCipher, page_size: "10", locale: "vi-VN", need_plaintext: "true" },
    });
    for (const m of [...(d.messages ?? [])].reverse()) this.saveShopMessage(conversationId, m, buyer);
  }

  private saveShopMessage(conversationId: string, m: ShopMessage & { plaintext?: string }, buyer?: { nickname?: string; avatar?: string }) {
    if (m.is_visible === false) return;
    const role = (m.sender?.role ?? "").toUpperCase();
    if (role === "SYSTEM") return;
    let parsed: any = {};
    try {
      parsed = JSON.parse(m.content);
    } catch {
      parsed = { content: m.content };
    }
    const type = (m.type ?? "TEXT").toUpperCase();
    const text = m.plaintext ?? parsed.content ?? "";
    const isBuyer = role === "BUYER";
    saveMessage({
      channelId: this.channelId,
      threadId: conversationId,
      conversationType: 0,
      zaloMsgId: String(m.id),
      direction: isBuyer ? "in" : "out",
      senderUid: m.sender?.im_user_id ?? null,
      senderName: m.sender?.nickname ?? null,
      source: isBuyer ? "customer" : "phone",
      msgType: type === "TEXT" ? "webchat" : type === "IMAGE" ? "chat.photo" : type === "VIDEO" ? "chat.video.msg" : "chat.link",
      content:
        type === "TEXT"
          ? String(text)
          : type === "IMAGE"
            ? { title: "", href: parsed.url ?? "", thumb: parsed.url ?? "" }
            : { title: `[${type}] ${text}`.trim() },
      ts: (Number(m.create_time) || Date.now() / 1000) * 1000,
      customerName: isBuyer ? m.sender?.nickname ?? buyer?.nickname ?? null : buyer?.nickname ?? null,
      customerAvatar: isBuyer ? m.sender?.avatar ?? buyer?.avatar ?? null : buyer?.avatar ?? null,
    });
  }

  /** Quét danh sách hội thoại; hội thoại có tin mới hơn tin đã lưu thì tải tin về. */
  async poll() {
    const c = this.creds();
    if (!c || !this.connected) return;
    const token = await this.token();
    const d = await shopCall<{ conversations: any[] }>("/customer_service/202309/conversations", {
      token,
      query: { shop_cipher: c.shopCipher, page_size: "20", locale: "vi-VN" },
    });
    for (const conv of d.conversations ?? []) {
      const id = String(conv.id ?? "");
      if (!id) continue;
      const latest = Number(conv.latest_message?.create_time ?? 0) * 1000;
      const local = getConversation(conversationKey(this.channelId, id));
      if (local && latest && local.last_message_at && latest <= local.last_message_at) continue;
      const buyer = (conv.participants ?? []).find((p: any) => String(p.role ?? "").toUpperCase() === "BUYER");
      await this.syncConversation(id, { nickname: buyer?.nickname, avatar: buyer?.avatar });
    }
  }

  async sendMessage(opts: SendOptions) {
    const c = this.creds();
    if (!c || !this.connected) throw new Error("Shop chưa kết nối");
    if (opts.attachments?.length) throw new Error("TikTok Shop: hiện app chỉ gửi được tin nhắn chữ");
    const text = (opts.text ?? "").trim();
    if (!text) throw new Error("Nhập nội dung");
    if (text.length > 2000) throw new Error("TikTok Shop giới hạn 2.000 ký tự mỗi tin");
    const token = await this.token();
    const d = await shopCall<{ message_id: string }>(`/customer_service/202309/conversations/${opts.conversation.thread_id}/messages`, {
      token,
      query: { shop_cipher: c.shopCipher },
      body: { type: "TEXT", content: JSON.stringify({ content: text }) },
    });
    return [
      saveMessage({
        channelId: this.channelId,
        threadId: opts.conversation.thread_id,
        conversationType: 0,
        zaloMsgId: String(d.message_id),
        direction: "out",
        senderUid: c.shopId,
        senderName: c.shopName ?? "Shop",
        agentId: opts.agentId,
        source: opts.source,
        msgType: "webchat",
        content: text,
        ts: Date.now(),
      }).message,
    ];
  }

  /** Đăng ký webhook NEW_MESSAGE cho shop này. */
  async registerWebhook(address: string) {
    const c = this.creds();
    if (!c) throw new Error("Shop chưa kết nối");
    const token = await this.token();
    return shopCall("/event/202309/webhooks", {
      method: "PUT",
      token,
      query: { shop_cipher: c.shopCipher },
      body: { address, event_type: "NEW_MESSAGE" },
    });
  }
}
