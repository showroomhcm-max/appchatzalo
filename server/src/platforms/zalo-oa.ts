/**
 * Zalo Official Account (OA): API chính thức của Zalo (Open API v2/v3, OAuth v4).
 * Nhận tin qua webhook /webhooks/zalo-oa (user_send_*, oa_send_*, user_reacted_message…).
 * Mỗi kênh = 1 OA, credentials = { oaId, accessToken, refreshToken, ... }.
 * Gửi tin tư vấn (message/cs) được trong 7 ngày kể từ lần cuối khách tương tác (theo quy định của Zalo).
 */
import { safeEqual } from "../security.js";
import crypto from "node:crypto";
import { logEvent, run } from "../db.js";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { conversationKey, getConversation, saveMessage, updateConversationProfile } from "../store.js";
import { zaloOaConfig } from "./app-config.js";
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

export type ZaloOaCredentials = {
  oaId: string;
  accessToken: string;
  refreshToken: string;
  /** ms */
  accessExpiresAt: number;
  /** ms — refresh token dùng 1 lần, sống 3 tháng */
  refreshExpiresAt: number;
  name?: string;
  avatar?: string;
};

const OPEN_API = () => process.env.ZALO_OPENAPI_URL ?? "https://openapi.zalo.me";
const OAUTH = () => process.env.ZALO_OAUTH_URL ?? "https://oauth.zaloapp.com";

type ZaloResponse<T> = { error: number; message: string; data: T };

/** Gọi Open API của OA (header access_token). Lỗi Zalo trả error ≠ 0 kèm HTTP 200. */
async function oaCall<T>(path: string, token: string, init: { method?: string; body?: unknown; form?: FormData; query?: Record<string, string> } = {}) {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
  const r = await fetchJson<ZaloResponse<T>>(`${OPEN_API()}${path}${qs}`, {
    method: init.method ?? (init.body || init.form ? "POST" : "GET"),
    headers: { access_token: token, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  if (r.error && r.error !== 0) throw new ApiCallError(`Zalo OA: ${r.message} (mã ${r.error})`, 400, r);
  return r.data;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: string | number; error?: number; error_name?: string; error_description?: string; message?: string };

async function tokenRequest(params: Record<string, string>) {
  const cfg = zaloOaConfig();
  if (!cfg) throw new Error("Chưa nhập Zalo OA App (Cài đặt › Tích hợp)");
  const r = await fetchJson<TokenResponse>(`${OAUTH()}/v4/oa/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: cfg.appSecret },
    body: new URLSearchParams({ app_id: cfg.appId, ...params }).toString(),
  });
  if (!r.access_token) throw new ApiCallError(`Zalo OA: ${r.error_description || r.error_name || r.message || "không lấy được token"}`, 400, r);
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? "",
    accessExpiresAt: Date.now() + (Number(r.expires_in) || 90_000) * 1000,
    refreshExpiresAt: Date.now() + 90 * 24 * 3600_000,
  };
}

/** PKCE: code_verifier suy ra từ state (bí mật nhờ khóa máy chủ) nên không phải lưu tạm. */
export function zaloOaPkce(state: string) {
  const verifier = crypto.createHmac("sha256", config.jwtSecret).update(`zalo-oa-pkce:${state}`).digest("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function zaloOaAuthorizeUrl(redirectUri: string, state: string) {
  const cfg = zaloOaConfig();
  if (!cfg) throw new Error("Chưa nhập Zalo OA App (Cài đặt › Tích hợp)");
  const url = new URL(`${OAUTH()}/v4/oa/permission`);
  url.searchParams.set("app_id", cfg.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", zaloOaPkce(state).challenge);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Đổi mã ủy quyền lấy token, đọc thông tin OA. */
export async function exchangeZaloOaCode(code: string, state: string, oaIdHint?: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", code_verifier: zaloOaPkce(state).verifier });
  const info = await oaCall<{ oa_id: string; name: string; avatar?: string }>("/v2.0/oa/getoa", t.accessToken);
  return { oaId: String(info.oa_id ?? oaIdHint ?? ""), name: info.name, avatar: info.avatar, ...t } satisfies ZaloOaCredentials;
}

/**
 * Chữ ký webhook: X-ZEvent-Signature = "mac=" + sha256(appId + body + timestamp + OA Secret Key).
 * Thêm lớp bảo vệ: khóa bí mật trong URL webhook (?k=), đúng một trong hai là nhận.
 */
export function verifyZaloOaWebhook(rawBody: Buffer, signature: string | undefined, urlKey: unknown) {
  const cfg = zaloOaConfig();
  if (!cfg) return false;
  if (safeEqual(urlKey, cfg.webhookKey)) return true;
  if (!cfg.oaSecretKey || !signature) return false;
  let ts = "";
  try {
    ts = String(JSON.parse(rawBody.toString("utf8")).timestamp ?? "");
  } catch {
    return false;
  }
  const expected = crypto.createHash("sha256").update(cfg.appId + rawBody.toString("utf8") + ts + cfg.oaSecretKey).digest("hex");
  const got = signature.replace(/^mac=/, "").trim().toLowerCase();
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export class ZaloOaSession implements ChannelAdapter {
  readonly platform = "zalo_oa" as const;
  readonly capabilities: Capabilities = {
    stickers: false,
    reactions: false,
    undo: false,
    forward: false,
    quote: false,
    files: true,
    contacts: false,
  };
  private status: ChannelStatus;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<string> | null = null;
  private profileQueue = new Set<string>();

  constructor(readonly channelId: number) {
    this.status = { channelId, channelName: channelRow(channelId)?.name ?? `Kênh ${channelId}`, platform: "zalo_oa", state: "disconnected", updatedAt: Date.now() };
  }
  get connected() {
    return this.status.state === "connected";
  }
  getStatus() {
    return this.status;
  }
  private creds() {
    return readCredentials<ZaloOaCredentials>(this.channelId);
  }
  private setStatus(patch: Partial<ChannelStatus>, replace = false) {
    const base = { channelId: this.channelId, channelName: channelRow(this.channelId)?.name ?? "", platform: "zalo_oa" as const };
    this.status = replace ? ({ ...base, ...patch, updatedAt: Date.now() } as ChannelStatus) : { ...this.status, ...base, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }
  refreshName() {
    this.setStatus({});
  }

  /** Access token sống ~25 giờ; refresh token chỉ dùng được 1 lần → luôn lưu token mới ngay. */
  private token(): Promise<string> {
    const c = this.creds();
    if (!c) return Promise.reject(new Error("Zalo OA chưa kết nối"));
    if (Date.now() < c.accessExpiresAt - 30 * 60_000) return Promise.resolve(c.accessToken);
    // Không làm mới song song (refresh token dùng 1 lần)
    this.refreshing ??= tokenRequest({ refresh_token: c.refreshToken, grant_type: "refresh_token" })
      .then((t) => {
        writeCredentials(this.channelId, { ...this.creds(), ...t, refreshToken: t.refreshToken || c.refreshToken });
        return t.accessToken;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async init() {
    const c = this.creds();
    if (!c || !channelRow(this.channelId)?.active) return;
    if (!zaloOaConfig()) {
      this.setStatus({ state: "error", error: "Chưa nhập Zalo OA App (Cài đặt › Tích hợp)." }, true);
      return;
    }
    this.setStatus({ state: "connecting" }, true);
    try {
      const token = await this.token();
      const info = await oaCall<{ oa_id: string; name: string; avatar?: string }>("/v2.0/oa/getoa", token);
      writeCredentials(this.channelId, { ...this.creds(), name: info.name, avatar: info.avatar });
      this.setStatus({ state: "connected", account: { id: c.oaId, name: info.name, avatar: info.avatar ?? "" }, error: undefined }, true);
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => this.token().catch((e) => console.error(`[zalo_oa#${this.channelId}] Làm mới token lỗi:`, e.message)), 20 * 60_000);
    } catch (e: any) {
      console.error(`[zalo_oa#${this.channelId}] Kết nối thất bại:`, e.message);
      this.setStatus({ state: "error", error: /refresh|token/i.test(e.message) ? `${e.message}. Đăng nhập lại Zalo OA.` : e.message }, true);
    }
  }

  async logout(clearCredentials = true) {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (clearCredentials) {
      writeCredentials(this.channelId, null);
      logEvent(null, null, "channel.logout", { channel: this.channelId, platform: "zalo_oa" });
    }
    this.setStatus({ state: "disconnected" }, true);
  }

  /** Sự kiện webhook của OA. */
  handleEvent(ev: any) {
    const name = String(ev?.event_name ?? "");
    const c = this.creds();
    if (!c) return;
    if (name === "user_submit_info") {
      // Khách bấm chia sẻ thông tin (từ tin "Xin thông tin khách")
      const userId = String(ev.sender?.id ?? "");
      const info = ev.info ?? {};
      const parts = [
        info.name && `Tên: ${info.name}`,
        info.phone && `SĐT: ${info.phone}`,
        info.address && `Địa chỉ: ${[info.address, info.ward, info.district, info.city].filter(Boolean).join(", ")}`,
      ].filter(Boolean);
      if (!userId || !parts.length) return;
      saveMessage({
        channelId: this.channelId,
        threadId: userId,
        conversationType: 0,
        zaloMsgId: `info_${ev.timestamp ?? Date.now()}`,
        direction: "in",
        senderUid: userId,
        senderName: info.name ?? null,
        source: "customer",
        msgType: "webchat",
        content: `[Khách chia sẻ thông tin] ${parts.join(" · ")}`,
        ts: Number(ev.timestamp) || Date.now(),
      });
      if (info.phone) run("UPDATE conversations SET phone = COALESCE(phone, ?) WHERE id = ?", String(info.phone), conversationKey(this.channelId, userId));
      return;
    }
    const fromOa = name.startsWith("oa_send_");
    const fromUser = name.startsWith("user_send_");
    if (!fromOa && !fromUser) return;
    const userId = String(fromOa ? ev.recipient?.id ?? "" : ev.sender?.id ?? "");
    const msg = ev.message ?? {};
    const msgId = String(msg.msg_id ?? "");
    if (!userId || !msgId) return;
    const att = (msg.attachments ?? [])[0];
    const p = att?.payload ?? {};
    let msgType = "webchat";
    let content: string | Record<string, unknown> = String(msg.text ?? "");
    const kind = att?.type ?? name.replace(/^(user|oa)_send_/, "");
    if (kind === "image" || kind === "gif") {
      msgType = "chat.photo";
      content = { title: msg.text ?? "", href: p.url ?? "", thumb: p.thumbnail ?? p.url ?? "" };
    } else if (kind === "sticker") {
      msgType = "chat.photo";
      content = { title: "[Sticker]", href: p.url ?? "", thumb: p.url ?? "" };
    } else if (kind === "file") {
      msgType = "share.file";
      content = { title: p.name ?? "Tệp đính kèm", href: p.url ?? "" };
    } else if (kind === "link") {
      msgType = "chat.link";
      content = { title: p.description ?? msg.text ?? p.url ?? "", href: p.url ?? "", thumb: p.thumbnail ?? "" };
    } else if (kind === "location") {
      const coord = p.coordinates ?? {};
      msgType = "chat.link";
      content = { title: "Vị trí", href: `https://maps.google.com/?q=${coord.latitude},${coord.longitude}` };
    } else if (kind === "audio" || kind === "video") {
      msgType = "chat.link";
      content = { title: kind === "audio" ? "[Tin nhắn thoại]" : "[Video]", href: p.url ?? "" };
    } else if (kind !== "text") {
      content = msg.text ? String(msg.text) : `[${kind}]`;
    }
    saveMessage({
      channelId: this.channelId,
      threadId: userId,
      conversationType: 0,
      zaloMsgId: msgId,
      direction: fromOa ? "out" : "in",
      senderUid: String(ev.sender?.id ?? ""),
      senderName: fromOa ? c.name ?? "OA" : null,
      // Tin gửi bằng app này đã lưu kèm tên nhân viên; tin gửi từ trang quản lý OA ghi "phone"
      source: fromOa ? "phone" : "customer",
      msgType,
      content,
      ts: Number(ev.timestamp) || Date.now(),
    });
    if (fromUser) this.ensureProfile(userId);
  }

  /** Tên + ảnh khách (chỉ đọc được với người đã quan tâm hoặc đã nhắn OA). */
  private ensureProfile(userId: string) {
    const id = conversationKey(this.channelId, userId);
    const conv = getConversation(id);
    if (!conv || (conv.name && conv.avatar) || this.profileQueue.has(userId)) return;
    this.profileQueue.add(userId);
    this.token()
      .then((token) =>
        oaCall<{ display_name?: string; avatar?: string; avatars?: Record<string, string> }>("/v3.0/oa/user/detail", token, {
          query: { data: JSON.stringify({ user_id: userId }) },
        }),
      )
      .then((u) => updateConversationProfile(id, { name: u.display_name ?? null, avatar: u.avatars?.["240"] ?? u.avatar ?? null }))
      .catch((e) => {
        console.warn(`[zalo_oa#${this.channelId}] Không đọc được hồ sơ khách ${userId}:`, e.message);
        if (!conv.name) updateConversationProfile(id, { name: "Khách Zalo OA" });
      });
  }

  /** Gửi mẫu "Xin thông tin khách" (khách bấm là chia sẻ tên, SĐT, địa chỉ cho OA). */
  async requestUserInfo(userId: string, title: string, subtitle: string, imageUrl: string) {
    const c = this.creds();
    if (!c || !this.connected) throw new Error("Zalo OA chưa kết nối");
    const token = await this.token();
    const r = await oaCall<{ message_id: string }>("/v3.0/oa/message/cs", token, {
      body: {
        recipient: { user_id: userId },
        message: { attachment: { type: "template", payload: { template_type: "request_user_info", elements: [{ title, subtitle, image_url: imageUrl }] } } },
      },
    });
    return saveMessage({
      channelId: this.channelId,
      threadId: userId,
      conversationType: 0,
      zaloMsgId: r.message_id,
      direction: "out",
      senderUid: c.oaId,
      senderName: c.name ?? "OA",
      agentId: null,
      source: "web",
      msgType: "webchat",
      content: `[Xin thông tin khách] ${title}`,
      ts: Date.now(),
    }).message;
  }

  async sendMessage(opts: SendOptions) {
    const c = this.creds();
    if (!c || !this.connected) throw new Error("Zalo OA chưa kết nối");
    const token = await this.token();
    const userId = opts.conversation.thread_id;
    const base = {
      channelId: this.channelId,
      threadId: userId,
      conversationType: 0,
      direction: "out" as const,
      senderUid: c.oaId,
      senderName: c.name ?? "OA",
      agentId: opts.agentId,
      source: opts.source,
    };
    const saved: any[] = [];
    const send = (message: unknown) => oaCall<{ message_id: string }>("/v3.0/oa/message/cs", token, { body: { recipient: { user_id: userId }, message } });

    for (const a of opts.attachments ?? []) {
      const isImage = /\.(png|jpe?g)$/i.test(a.filename);
      const isGif = /\.gif$/i.test(a.filename);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(a.data)]), a.filename);
      if (isImage || isGif) {
        const up = await oaCall<{ attachment_id: string }>(isGif ? "/v2.0/oa/upload/gif" : "/v2.0/oa/upload/image", token, { form });
        const element: Record<string, unknown> = { media_type: isGif ? "gif" : "image", attachment_id: up.attachment_id };
        if (isGif) Object.assign(element, { width: a.width ?? 300, height: a.height ?? 300 });
        const r = await send({ attachment: { type: "template", payload: { template_type: "media", elements: [element] } } });
        saved.push(saveMessage({ ...base, ts: Date.now(), zaloMsgId: r.message_id, msgType: "chat.photo", content: { title: a.filename, href: a.localUrl ?? "", thumb: a.localUrl ?? "" } }).message);
      } else {
        const up = await oaCall<{ token: string }>("/v2.0/oa/upload/file", token, { form });
        const r = await send({ attachment: { type: "file", payload: { token: up.token } } });
        saved.push(saveMessage({ ...base, ts: Date.now(), zaloMsgId: r.message_id, msgType: "share.file", content: { title: a.filename, href: a.localUrl ?? "" } }).message);
      }
    }
    const text = (opts.text ?? "").trim();
    if (text) {
      if (text.length > 2000) throw new Error("Zalo OA giới hạn 2.000 ký tự mỗi tin");
      const r = await send({ text });
      saved.push(saveMessage({ ...base, ts: Date.now(), zaloMsgId: r.message_id, msgType: "webchat", content: text }).message);
    }
    if (!saved.length) throw new Error("Nhập nội dung");
    return saved;
  }
}
