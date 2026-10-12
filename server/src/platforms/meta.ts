/**
 * Facebook Fanpage: Messenger + bình luận bài viết (Meta Graph API).
 * Nhận tin qua webhook /webhooks/meta (field "messages", "message_echoes", "message_reactions", "feed").
 * Mỗi kênh = 1 Fanpage, credentials = { pageId, pageToken }.
 */
import crypto from "node:crypto";
import { all, get, logEvent } from "../db.js";
import { bus } from "../bus.js";
import { conversationKey, findMessageByZaloId, getConversation, markUndone, saveMessage, setReaction, updateConversationProfile } from "../store.js";
import { metaConfig } from "./app-config.js";
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

export type MetaCredentials = { pageId: string; pageToken: string; pageName?: string; picture?: string };

const GRAPH = () => `${process.env.META_GRAPH_URL ?? "https://graph.facebook.com"}/${metaConfig()?.graphVersion ?? "v23.0"}`;

export async function graph<T = any>(path: string, token: string, init: { method?: string; body?: unknown; form?: FormData } = {}) {
  const url = `${GRAPH()}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  try {
    return await fetchJson<T>(url, {
      method: init.method ?? (init.body || init.form ? "POST" : "GET"),
      headers: init.form ? undefined : init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
    });
  } catch (e) {
    if (e instanceof ApiCallError) {
      const err = (e.body as any)?.error;
      throw new ApiCallError(`Facebook: ${err?.error_user_msg || err?.message || e.message}`, e.status, e.body);
    }
    throw e;
  }
}

/** Mã hội thoại bình luận: mỗi người bình luận trên mỗi bài viết = 1 hội thoại. */
export const commentThreadId = (postId: string, userId: string) => `cmt_${postId}_${userId}`;

export class MetaSession implements ChannelAdapter {
  readonly platform = "facebook" as const;
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
  private profileQueue = new Set<string>();

  constructor(readonly channelId: number) {
    this.status = { channelId, channelName: channelRow(channelId)?.name ?? `Kênh ${channelId}`, platform: "facebook", state: "disconnected", updatedAt: Date.now() };
  }

  get connected() {
    return this.status.state === "connected";
  }
  getStatus() {
    return this.status;
  }
  private creds() {
    return readCredentials<MetaCredentials>(this.channelId);
  }
  private setStatus(patch: Partial<ChannelStatus>, replace = false) {
    const base = { channelId: this.channelId, channelName: channelRow(this.channelId)?.name ?? "", platform: "facebook" as const };
    this.status = replace ? ({ ...base, ...patch, updatedAt: Date.now() } as ChannelStatus) : { ...this.status, ...base, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }
  refreshName() {
    this.setStatus({});
  }

  /** Kiểm tra token Fanpage còn dùng được và đăng ký nhận webhook cho trang. */
  async init() {
    const c = this.creds();
    if (!c?.pageToken || !channelRow(this.channelId)?.active) return;
    if (!metaConfig()) {
      this.setStatus({ state: "error", error: "Chưa nhập Meta App (Cài đặt › Tích hợp)." }, true);
      return;
    }
    this.setStatus({ state: "connecting" }, true);
    try {
      const me = await graph<{ id: string; name: string; picture?: { data?: { url?: string } } }>("/me?fields=id,name,picture", c.pageToken);
      await graph(`/${me.id}/subscribed_apps`, c.pageToken, {
        method: "POST",
        body: { subscribed_fields: ["messages", "message_echoes", "message_reactions", "messaging_postbacks", "feed"] },
      }).catch((e) => console.warn(`[facebook#${this.channelId}] Không đăng ký được webhook cho trang:`, e.message));
      writeCredentials(this.channelId, { ...c, pageId: me.id, pageName: me.name, picture: me.picture?.data?.url });
      this.setStatus({ state: "connected", account: { id: me.id, name: me.name, avatar: me.picture?.data?.url ?? "" }, error: undefined }, true);
    } catch (e: any) {
      console.error(`[facebook#${this.channelId}] Kết nối thất bại:`, e.message);
      this.setStatus({ state: "error", error: `Token Fanpage không dùng được: ${e.message}. Kết nối lại trang.` }, true);
    }
  }

  async logout(clearCredentials = true) {
    if (clearCredentials) {
      writeCredentials(this.channelId, null);
      logEvent(null, null, "channel.logout", { channel: this.channelId, platform: "facebook" });
    }
    this.setStatus({ state: "disconnected" }, true);
  }

  // ───────────── Nhận sự kiện từ webhook ─────────────

  handleMessaging(ev: any) {
    const c = this.creds();
    if (!c) return;
    const pageId = c.pageId;
    const msg = ev.message;
    // Cảm xúc khách thả vào tin của trang
    if (ev.reaction) {
      const psid = ev.sender?.id === pageId ? ev.recipient?.id : ev.sender?.id;
      const target = findMessageByZaloId(conversationKey(this.channelId, psid), String(ev.reaction.mid));
      if (target) setReaction(target.id, { uid: String(ev.sender?.id), name: ev.sender?.id === pageId ? c.pageName ?? "Trang" : null }, ev.reaction.action === "unreact" ? "" : String(ev.reaction.emoji ?? ev.reaction.reaction ?? ""));
      return;
    }
    if (!msg?.mid) return;
    const isEcho = !!msg.is_echo;
    const psid = String(isEcho ? ev.recipient?.id : ev.sender?.id);
    const att = (msg.attachments ?? [])[0];
    const attType = att?.type;
    const msgType = msg.text ? "webchat" : attType === "image" ? "chat.photo" : attType === "video" ? "chat.video.msg" : attType === "audio" ? "chat.voice" : attType ? "share.file" : "webchat";
    saveMessage({
      channelId: this.channelId,
      threadId: psid,
      conversationType: 0,
      zaloMsgId: String(msg.mid),
      direction: isEcho ? "out" : "in",
      senderUid: String(ev.sender?.id ?? ""),
      senderName: isEcho ? c.pageName ?? "Trang" : null,
      // Tin trang gửi bằng app này đã được lưu kèm tên nhân viên; tin gửi từ Meta Business Suite ghi "phone"
      source: isEcho ? "phone" : "customer",
      msgType,
      content: msg.text ? msg.text : { title: att?.payload?.title ?? "", href: att?.payload?.url ?? "", thumb: attType === "image" ? att?.payload?.url ?? "" : "" },
      ts: Number(ev.timestamp) || Date.now(),
      quote: msg.reply_to?.mid ? { msg: "", fromD: "", globalMsgId: String(msg.reply_to.mid), ownerId: "" } : null,
    });
    if (!isEcho) this.ensureProfile(psid);
  }

  handleFeed(value: any) {
    const c = this.creds();
    if (!c || value?.item !== "comment") return;
    const pageId = c.pageId;
    const fromId = String(value.from?.id ?? "");
    const postId = String(value.post_id ?? "");
    const commentId = String(value.comment_id ?? "");
    if (!commentId || !postId) return;
    const fromPage = fromId === pageId;

    if (value.verb === "remove" || value.verb === "hide") {
      const row = get<{ id: number; conversation_id: string }>("SELECT id, conversation_id FROM messages WHERE zalo_msg_id = ? AND conversation_id LIKE ?", commentId, `${this.channelId}_%`);
      // Bình luận bị xóa / ẩn: đánh dấu như tin thu hồi, vẫn giữ lại để training
      if (row) markUndone(this.channelId, row.conversation_id.slice(String(this.channelId).length + 1), commentId);
      return;
    }
    if (value.verb !== "add" && value.verb !== "edited") return;

    // Trả lời của trang → gắn vào hội thoại của người có bình luận gốc
    let threadId = commentThreadId(postId, fromId);
    if (fromPage) {
      const parentId = String(value.parent_id ?? "");
      const parent = all<{ conversation_id: string }>(
        "SELECT conversation_id FROM messages WHERE zalo_msg_id = ? AND conversation_id LIKE ? LIMIT 1",
        parentId,
        `${this.channelId}_%`,
      )[0];
      if (!parent) return;
      threadId = parent.conversation_id.slice(String(this.channelId).length + 1);
    }
    const meta = {
      post_id: postId,
      post_url: value.post?.permalink_url ?? `https://facebook.com/${postId}`,
      post_message: value.post?.message ?? null,
    };
    saveMessage({
      channelId: this.channelId,
      threadId,
      conversationType: 0,
      zaloMsgId: commentId,
      direction: fromPage ? "out" : "in",
      senderUid: fromId,
      senderName: value.from?.name ?? null,
      source: fromPage ? "phone" : "customer",
      msgType: value.photo ? "chat.photo" : "webchat",
      content: value.photo ? { title: value.message ?? "", href: value.photo, thumb: value.photo } : String(value.message ?? ""),
      ts: value.created_time ? Number(value.created_time) * 1000 : Date.now(),
      kind: "comment",
      meta,
      customerName: fromPage ? null : value.from?.name ?? null,
    });
  }

  /** Tên + ảnh khách Messenger (cần quyền đọc hồ sơ; không có quyền thì bỏ qua). */
  private ensureProfile(psid: string) {
    const id = conversationKey(this.channelId, psid);
    const conv = getConversation(id);
    const token = this.creds()?.pageToken;
    if (!token || !conv || (conv.name && conv.avatar) || this.profileQueue.has(psid)) return;
    this.profileQueue.add(psid);
    graph<{ name?: string; first_name?: string; last_name?: string; profile_pic?: string }>(`/${psid}?fields=name,first_name,last_name,profile_pic`, token)
      .then((p) => updateConversationProfile(id, { name: p.name ?? [p.last_name, p.first_name].filter(Boolean).join(" ") ?? null, avatar: p.profile_pic ?? null }))
      .catch((e) => {
        console.warn(`[facebook#${this.channelId}] Không đọc được hồ sơ khách ${psid}:`, e.message);
        if (!conv.name) updateConversationProfile(id, { name: "Khách Messenger" });
      });
  }

  // ───────────── Gửi ─────────────

  async sendMessage(opts: SendOptions) {
    const c = this.creds();
    if (!c || !this.connected) throw new Error("Fanpage chưa kết nối");
    const conv = opts.conversation;
    const saved: any[] = [];
    const base = {
      channelId: this.channelId,
      conversationType: 0,
      direction: "out" as const,
      senderUid: c.pageId,
      senderName: c.pageName ?? "Trang",
      agentId: opts.agentId,
      source: opts.source,
      ts: Date.now(),
    };

    if (conv.kind === "comment") {
      // Bình luận gốc mới nhất của khách trong hội thoại này
      const target = all<{ zalo_msg_id: string }>(
        "SELECT zalo_msg_id FROM messages WHERE conversation_id = ? AND direction = 'in' AND undone = 0 ORDER BY ts DESC LIMIT 1",
        conv.id,
      )[0];
      const commentId = opts.quote?.zalo_msg_id ?? target?.zalo_msg_id;
      if (!commentId) throw new Error("Không tìm thấy bình luận để trả lời");
      const text = (opts.text ?? "").trim();
      if (!text) throw new Error("Nhập nội dung trả lời");
      if (opts.mode === "private") {
        // Nhắn riêng qua Messenger từ bình luận (mỗi bình luận chỉ nhắn riêng được 1 lần, trong 7 ngày)
        const r = await graph<{ recipient_id: string; message_id: string }>(`/${c.pageId}/messages`, c.pageToken, {
          body: { recipient: { comment_id: commentId }, message: { text } },
        });
        saved.push(
          saveMessage({ ...base, threadId: conv.thread_id, zaloMsgId: r.message_id, msgType: "webchat", content: `[Nhắn riêng qua Messenger] ${text}`, kind: "comment" }).message,
        );
        if (r.recipient_id) {
          saveMessage({ ...base, threadId: String(r.recipient_id), zaloMsgId: r.message_id, msgType: "webchat", content: text, customerName: conv.name });
        }
      } else {
        const r = await graph<{ id: string }>(`/${commentId}/comments`, c.pageToken, { body: { message: text } });
        saved.push(saveMessage({ ...base, threadId: conv.thread_id, zaloMsgId: r.id, msgType: "webchat", content: text, kind: "comment" }).message);
      }
      return saved;
    }

    // Messenger
    const text = (opts.text ?? "").trim();
    if (text) {
      const r = await graph<{ message_id: string }>(`/me/messages`, c.pageToken, {
        body: { recipient: { id: conv.thread_id }, messaging_type: "RESPONSE", message: { text } },
      });
      saved.push(saveMessage({ ...base, threadId: conv.thread_id, zaloMsgId: r.message_id, msgType: "webchat", content: text }).message);
    }
    for (const a of opts.attachments ?? []) {
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(a.filename);
      const form = new FormData();
      form.append("recipient", JSON.stringify({ id: conv.thread_id }));
      form.append("messaging_type", "RESPONSE");
      form.append("message", JSON.stringify({ attachment: { type: isImage ? "image" : "file", payload: { is_reusable: false } } }));
      form.append("filedata", new Blob([new Uint8Array(a.data)]), a.filename);
      const r = await graph<{ message_id: string }>(`/me/messages`, c.pageToken, { form });
      saved.push(
        saveMessage({
          ...base,
          threadId: conv.thread_id,
          zaloMsgId: r.message_id,
          msgType: isImage ? "chat.photo" : "share.file",
          content: { title: a.filename, href: a.localUrl ?? "", thumb: isImage ? a.localUrl ?? "" : "" },
        }).message,
      );
    }
    return saved;
  }
}

// ───────────── Webhook + OAuth ─────────────

/** Kiểm tra chữ ký X-Hub-Signature-256 = HMAC-SHA256(app secret, body). */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined) {
  const cfg = metaConfig();
  if (!cfg || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", cfg.appSecret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Đổi mã OAuth lấy danh sách Fanpage (kèm Page Access Token dài hạn). */
export async function exchangeCodeForPages(code: string, redirectUri: string) {
  const cfg = metaConfig();
  if (!cfg) throw new Error("Chưa nhập Meta App");
  const base = `${process.env.META_GRAPH_URL ?? "https://graph.facebook.com"}/${cfg.graphVersion}`;
  const short = await fetchJson<{ access_token: string }>(
    `${base}/oauth/access_token?client_id=${cfg.appId}&client_secret=${encodeURIComponent(cfg.appSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
  );
  const long = await fetchJson<{ access_token: string }>(
    `${base}/oauth/access_token?grant_type=fb_exchange_token&client_id=${cfg.appId}&client_secret=${encodeURIComponent(cfg.appSecret)}&fb_exchange_token=${encodeURIComponent(short.access_token)}`,
  );
  const pages = await fetchJson<{ data: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }[] }>(
    `${base}/me/accounts?fields=id,name,access_token,picture&limit=100&access_token=${encodeURIComponent(long.access_token)}`,
  );
  return pages.data.map((p) => ({ id: p.id, name: p.name, token: p.access_token, picture: p.picture?.data?.url ?? "" }));
}

export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "business_management",
];
