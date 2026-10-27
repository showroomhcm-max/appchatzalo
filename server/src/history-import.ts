/**
 * Nhập lịch sử tin nhắn Zalo đọc từ Zalo PC (công cụ scripts/nhap-tu-zalo-pc.mjs chạy trên máy có Zalo PC).
 * Zalo web (cách app kết nối) chỉ cho lấy tin từ lúc tài khoản được gắn vào app; Zalo PC thì có lịch sử điện thoại
 * đồng bộ sang, nên đọc từ đó rồi gửi lên đây theo từng lô.
 * - Chỉ nhận đúng tài khoản Zalo của kênh (account_uid phải trùng zalo_uid của kênh).
 * - Tin cũ lưu lặng lẽ: không tăng chưa đọc, không cảnh báo / webhook / realtime từng tin. Tin đã có thì bỏ qua.
 * - Định dạng tin của Zalo PC (originMsgType + message) giống của Zalo web nên lưu như tin listener nhận.
 */
import { get, logEvent } from "./db.js";
import { bus } from "./bus.js";
import { getConversation, saveMessage } from "./store.js";
import { HttpError } from "./conversations.js";

/** Loại tin nhận vào (giống Zalo web). Tin thu hồi (chat.undo), tin hệ thống… bỏ qua. */
const TYPES = new Set([
  "webchat",
  "chat.photo",
  "chat.sticker",
  "chat.voice",
  "chat.video.msg",
  "chat.gif",
  "chat.recommended",
  "chat.link",
  "chat.location.new",
  "share.file",
  "chat.ecard",
  "chat.webcontent",
  "chat.doodle",
]);

export type ImportedMessage = {
  msgId: string;
  cliMsgId?: string | null;
  /** uid người / nhóm (không có tiền tố "g") */
  threadId: string;
  isGroup: boolean;
  fromUid: string;
  dName?: string | null;
  msgType: string;
  content: unknown;
  ts: number;
  quote?: { msg?: string; fromD?: string; globalMsgId?: string; ownerId?: string } | null;
};
export type ImportedConversation = { threadId: string; isGroup: boolean; name?: string | null; avatar?: string | null };

const MAX_BATCH = 2000;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
const safeAvatar = (v: unknown) => {
  const s = str(v, 500);
  return s && /^https:\/\//i.test(s) ? s : null;
};

export function importHistory(channelId: number, body: any, userId: number) {
  const channel = get<{ id: number; name: string; platform: string; zalo_uid: string | null; mode: string }>(
    "SELECT id, name, platform, zalo_uid, mode FROM channels WHERE id = ? AND deleted_at IS NULL",
    channelId,
  );
  if (!channel) throw new HttpError(404, "Kênh không tồn tại");
  if (channel.platform !== "zalo") throw new HttpError(400, "Chỉ nhập lịch sử cho kênh Zalo cá nhân");
  const account = String(body?.account_uid ?? "");
  if (!channel.zalo_uid || account !== channel.zalo_uid)
    throw new HttpError(400, `Zalo PC đang đăng nhập tài khoản khác với kênh "${channel.name}". Đăng nhập đúng tài khoản rồi chạy lại.`);
  const messages: ImportedMessage[] = Array.isArray(body?.messages) ? body.messages : [];
  const conversations: ImportedConversation[] = Array.isArray(body?.conversations) ? body.conversations : [];
  if (messages.length > MAX_BATCH) throw new HttpError(400, `Mỗi lô tối đa ${MAX_BATCH} tin`);

  const names = new Map<string, ImportedConversation>();
  for (const c of conversations.slice(0, 5000)) if (c && /^\d+$/.test(String(c.threadId))) names.set(String(c.threadId), c);

  let added = 0;
  let skipped = 0;
  const touched = new Set<string>();
  for (const m of messages) {
    const threadId = String(m?.threadId ?? "");
    const msgId = String(m?.msgId ?? "");
    const ts = Number(m?.ts);
    // Mã tin tạm trên máy (vd "1790752402014_0001"), loại tin không hỗ trợ, thời gian lạ → bỏ
    if (!/^\d+$/.test(threadId) || !/^\d+$/.test(msgId) || !TYPES.has(String(m?.msgType)) || !Number.isFinite(ts) || ts < 1e12 || ts > Date.now() + 86_400_000) {
      skipped++;
      continue;
    }
    const content = typeof m.content === "string" ? m.content.slice(0, 20_000) : m.content && typeof m.content === "object" ? m.content : "";
    if (JSON.stringify(content).length > 50_000) {
      skipped++;
      continue;
    }
    const self = String(m.fromUid) === "0" || String(m.fromUid) === account;
    const conv = names.get(threadId);
    const q = m.quote && typeof m.quote === "object" ? m.quote : null;
    const r = saveMessage({
      quiet: true,
      isHistory: true,
      channelId,
      threadId,
      conversationType: m.isGroup ? 1 : 0,
      zaloMsgId: msgId,
      cliMsgId: m.cliMsgId && /^\d+$/.test(String(m.cliMsgId)) ? String(m.cliMsgId) : null,
      direction: self ? "out" : "in",
      senderUid: self ? account : str(m.fromUid, 40),
      senderName: str(m.dName, 120),
      source: self ? "history" : "customer",
      msgType: String(m.msgType),
      content: content as any,
      ts,
      quote: q ? { msg: str(q.msg, 2000) ?? "", fromD: str(q.fromD, 120) ?? "", globalMsgId: str(q.globalMsgId, 40) ?? "", ownerId: str(q.ownerId, 40) ?? "" } : null,
      customerName: str(conv?.name, 120),
      customerAvatar: safeAvatar(conv?.avatar),
    });
    if (r.isNew) {
      added++;
      touched.add(r.conversation.id);
    } else skipped++;
  }
  for (const id of touched) {
    const conv = getConversation(id);
    if (conv) bus.emit("conversation.updated", conv);
  }
  if (added) logEvent(null, userId, "channel.history_imported", { channel: channelId, added, conversations: touched.size, source: "zalo_pc" });
  return { added, skipped, conversations: touched.size };
}
