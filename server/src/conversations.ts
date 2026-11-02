import { isOthersMonitorChannel } from "./access.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import { get, logEvent, run } from "./db.js";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { getConversation, type Source } from "./store.js";
import { safeRequest } from "./net-guard.js";
import { zalo, type OutgoingAttachment, type StoredMessage } from "./zalo.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ConversationPatch = {
  assigned_to?: number | null;
  /** Chuyển hội thoại sang bộ phận khác (null = chưa thuộc bộ phận nào). */
  department_id?: number | null;
  status?: "open" | "pending" | "closed";
  tags?: string[];
  external_ref?: string | null;
  name?: string;
};

/** Cập nhật hội thoại dùng chung cho giao diện nhân viên và API tích hợp. */
export function updateConversation(id: string, patch: ConversationPatch, byUserId: number | null) {
  const conv = getConversation(id);
  if (!conv) throw new HttpError(404, "Không tìm thấy hội thoại");

  if (patch.department_id !== undefined && patch.department_id !== conv.department_id) {
    if (patch.department_id !== null && !get("SELECT 1 FROM departments WHERE id = ?", patch.department_id)) {
      throw new HttpError(400, "Bộ phận không tồn tại");
    }
    run("UPDATE conversations SET department_id = ? WHERE id = ?", patch.department_id, id);
    // Người đang phụ trách không thuộc bộ phận mới (và không phải admin) → bỏ giao để bộ phận mới nhận.
    if (conv.assigned_to && patch.assigned_to === undefined && patch.department_id !== null) {
      const stays = get(
        `SELECT 1 FROM users u WHERE u.id = ? AND (u.role = 'admin'
           OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id = ?))`,
        conv.assigned_to,
        patch.department_id,
      );
      if (!stays) run("UPDATE conversations SET assigned_to = NULL WHERE id = ?", id);
    }
    logEvent(id, byUserId, "department", { from: conv.department_id, to: patch.department_id });
    bus.emit("conversation.updated", getConversation(id)!, { type: "department", by: byUserId, data: patch.department_id });
  }
  if (patch.assigned_to !== undefined && patch.assigned_to !== conv.assigned_to) {
    if (patch.assigned_to !== null && !get("SELECT 1 FROM users WHERE id = ? AND active = 1", patch.assigned_to)) {
      throw new HttpError(400, "Nhân viên không tồn tại");
    }
    run("UPDATE conversations SET assigned_to = ? WHERE id = ?", patch.assigned_to, id);
    logEvent(id, byUserId, "assign", { from: conv.assigned_to, to: patch.assigned_to });
    bus.emit("conversation.updated", getConversation(id)!, { type: "assign", by: byUserId, data: patch.assigned_to });
  }
  if (patch.status && patch.status !== conv.status) {
    if (!["open", "pending", "closed"].includes(patch.status)) throw new HttpError(400, "Trạng thái không hợp lệ");
    run("UPDATE conversations SET status = ? WHERE id = ?", patch.status, id);
    logEvent(id, byUserId, "status", { from: conv.status, to: patch.status });
    bus.emit("conversation.updated", getConversation(id)!, { type: "status", by: byUserId, data: patch.status });
  }
  const other: string[] = [];
  const params: any[] = [];
  if (patch.tags) {
    other.push("tags = ?");
    params.push(JSON.stringify([...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))]));
  }
  if (patch.external_ref !== undefined) {
    other.push("external_ref = ?");
    params.push(patch.external_ref || null);
  }
  if (patch.name) {
    other.push("name = ?");
    params.push(patch.name);
  }
  if (other.length) {
    run(`UPDATE conversations SET ${other.join(", ")} WHERE id = ?`, ...params, id);
    bus.emit("conversation.updated", getConversation(id)!, { type: "update", by: byUserId, data: patch });
  }
  return getConversation(id)!;
}

export function markRead(id: string) {
  run("UPDATE conversations SET unread_count = 0 WHERE id = ?", id);
  const conv = getConversation(id);
  if (conv) bus.emit("conversation.updated", conv);
}

export type UploadedFile = { buffer: Buffer; originalname: string; size: number };

export function storeUpload(file: UploadedFile): OutgoingAttachment {
  // multer giải mã tên file theo latin1 → chuyển lại UTF-8 cho tên tiếng Việt.
  const original = Buffer.from(file.originalname, "latin1").toString("utf8");
  const ext = path.extname(original).toLowerCase() || ".bin";
  const base = path.basename(original, path.extname(original)).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "file";
  const stored = `${crypto.randomBytes(12).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, stored), file.buffer);
  let width: number | undefined;
  let height: number | undefined;
  if (/\.(png|jpe?g|gif|webp)$/.test(ext)) {
    try {
      const dim = imageSize(file.buffer);
      width = dim.width;
      height = dim.height;
    } catch {
      /* không đọc được kích thước, gửi như file */
    }
  }
  return { data: file.buffer, filename: `${base}${ext}`, size: file.size, width, height, localUrl: `/uploads/${stored}` };
}

/** Nhân viên/API gửi tin. Hội thoại chưa ai nhận sẽ tự giao cho người trả lời đầu tiên. */
export async function sendToConversation(opts: {
  conversationId: string;
  text?: string;
  files?: UploadedFile[];
  agentId: number | null;
  source: Source;
  /** id (trong app) của tin được trả lời */
  quoteMessageId?: number | null;
  /** Bình luận Facebook: trả lời công khai hay nhắn riêng */
  mode?: "public" | "private";
  /** Nhắc tên trong nhóm Zalo */
  mentions?: { pos: number; len: number; uid: string }[];
}) {
  const conv = getConversation(opts.conversationId);
  if (!conv) throw new HttpError(404, "Không tìm thấy hội thoại");
  const text = (opts.text ?? "").trim();
  if (!text && !opts.files?.length) throw new HttpError(400, "Nội dung trống");
  const monitored = get<{ mode: string; holder_id: number | null }>(
    "SELECT ch.mode, a.holder_id FROM channels ch LEFT JOIN channel_assets a ON a.channel_id = ch.id WHERE ch.id = ?",
    conv.channel_id,
  );
  if (monitored?.mode === "monitor" && (!opts.agentId || monitored.holder_id !== opts.agentId)) {
    throw new HttpError(403, "Đây là Zalo nhân viên đang giám sát: chỉ xem, không gửi tin thay nhân viên");
  }
  const session = zalo.session(conv.channel_id);
  if (!session.connected) {
    throw new HttpError(503, `Kênh "${conv.channel_name ?? conv.channel_id}" chưa kết nối, chưa gửi được tin`);
  }

  const quote = opts.quoteMessageId
    ? get<StoredMessage & { raw: string | null }>(
        "SELECT zalo_msg_id, cli_msg_id, msg_type, sender_uid, sender_name, text, raw, ts FROM messages WHERE id = ? AND conversation_id = ?",
        opts.quoteMessageId,
        opts.conversationId,
      )
    : null;
  const messages = await session
    .sendMessage({
      conversation: conv,
      quote: quote ? { ...quote, raw: quote.raw ? JSON.parse(quote.raw) : null } : null,
      text,
      attachments: opts.files?.map(storeUpload),
      agentId: opts.agentId,
      source: opts.source,
      mode: opts.mode,
      mentions: opts.mentions,
    })
    .catch((e: any) => {
      // Lỗi từ nền tảng (Facebook, TikTok…) trả về nguyên văn cho nhân viên đọc được
      throw new HttpError(502, e?.message ?? "Gửi tin thất bại");
    });

  if (opts.agentId && !conv.assigned_to) {
    updateConversation(opts.conversationId, { assigned_to: opts.agentId }, opts.agentId);
  }
  if (conv.status === "closed") updateConversation(opts.conversationId, { status: "open" }, opts.agentId);
  return messages;
}

/** Lấy tin nhắn trong hội thoại để thả cảm xúc / thu hồi / chuyển tiếp. */
export function messageInConversation(conversationId: string, messageId: number) {
  const m = get<StoredMessage & { id: number; direction: string; agent_id: number | null; undone: number; raw: string | null }>(
    `SELECT id, zalo_msg_id, cli_msg_id, msg_type, sender_uid, sender_name, text, raw, ts, direction, agent_id, undone
     FROM messages WHERE id = ? AND conversation_id = ?`,
    messageId,
    conversationId,
  );
  if (!m) throw new HttpError(404, "Không tìm thấy tin nhắn");
  return { ...m, raw: m.raw ? JSON.parse(m.raw) : null };
}

/** Phiên Zalo đang kết nối của hội thoại (cho sticker, cảm xúc, thu hồi, chuyển tiếp — chỉ Zalo có). */
/**
 * Phiên Zalo của kênh để thao tác (sticker, cảm xúc, thu hồi, chuyển tiếp). Zalo nhân viên đang giám sát chỉ được xem:
 * chỉ người đang giữ máy mới thao tác được (giống gửi tin).
 */
export function connectedSession(conv: { channel_id: number; channel_name: string | null; platform?: string }, userId: number) {
  if (conv.platform && conv.platform !== "zalo") throw new HttpError(400, "Thao tác này hiện chỉ có ở kênh Zalo");
  if (isOthersMonitorChannel(conv.channel_id, userId)) throw new HttpError(403, "Zalo nhân viên đang giám sát chỉ được xem, không thao tác thay nhân viên");
  const session = zalo.zaloSession(conv.channel_id);
  if (!session.connected) throw new HttpError(503, `Kênh "${conv.channel_name ?? conv.channel_id}" chưa kết nối Zalo`);
  return session;
}

// ───────────── Chuyển tiếp (chữ, ảnh, tệp, video, tin thoại, sticker, link; nhiều tin một lần) ─────────────

const FORWARD_MAX_BYTES = 30 * 1024 * 1024;
const MEDIA_TYPES = new Set(["chat.photo", "share.file", "chat.video.msg", "chat.voice", "chat.gif"]);

export type ForwardItem =
  | { kind: "text"; text: string }
  | { kind: "sticker"; sticker: { id: number; cateId: number; type: number } }
  | { kind: "file"; attachment: OutgoingAttachment };

/** Tin có chuyển tiếp được không (giao diện dùng cùng điều kiện). */
export function forwardable(m: { msg_type: string | null; text: string | null; raw: any; undone?: number }) {
  if (m.undone) return false;
  const t = m.msg_type;
  if (!t || t === "webchat") return !!(m.text ?? "").trim();
  if (t === "chat.sticker") return !!m.raw?.id;
  if (t === "chat.recommended" || t === "chat.link") return !!(m.raw?.href || m.text);
  return MEDIA_TYPES.has(t) && !!mediaUrl(m.raw);
}

function parseParams(raw: any): Record<string, any> {
  try {
    return typeof raw?.params === "string" ? JSON.parse(raw.params) : raw?.params && typeof raw.params === "object" ? raw.params : {};
  } catch {
    return {};
  }
}

/** Link tệp gốc của tin ảnh / tệp / video / thoại (ảnh: ưu tiên bản HD). */
function mediaUrl(raw: any): string {
  const p = parseParams(raw);
  return String(p.hd || raw?.hdUrl || raw?.oriUrl || raw?.href || raw?.normalUrl || raw?.thumb || "");
}

const EXT_BY_TYPE: Record<string, string> = { "chat.photo": ".jpg", "chat.video.msg": ".mp4", "chat.voice": ".m4a", "chat.gif": ".gif" };
const sniffImageExt = (b: Buffer) =>
  b[0] === 0xff && b[1] === 0xd8 ? ".jpg" : b[0] === 0x89 && b[1] === 0x50 ? ".png" : b.slice(0, 4).toString() === "GIF8" ? ".gif" : b.slice(8, 12).toString() === "WEBP" ? ".webp" : "";

/** Đọc lại tệp của tin (bản lưu trên máy chủ hoặc tải từ Zalo) để gửi sang hội thoại khác. */
async function loadMedia(m: { id: number; msg_type: string | null; raw: any }): Promise<OutgoingAttachment> {
  const url = mediaUrl(m.raw);
  let data: Buffer;
  let urlName = "";
  if (url.startsWith("/uploads/")) {
    const file = path.resolve(config.uploadDir, decodeURIComponent(url.slice("/uploads/".length)));
    if (!file.startsWith(path.resolve(config.uploadDir) + path.sep) || !fs.existsSync(file)) throw new Error("Tệp gốc không còn trên máy chủ");
    data = fs.readFileSync(file);
    urlName = path.basename(file);
  } else {
    let res;
    try {
      res = await safeRequest(url, { maxBytes: FORWARD_MAX_BYTES, timeoutMs: 60_000, maxRedirects: 3 });
    } catch (e: any) {
      throw new Error(/MB/.test(e?.message ?? "") ? "Tệp quá 30 MB, không chuyển tiếp được" : `Không tải được tệp gốc từ Zalo (${e?.message ?? e})`);
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Không tải được tệp gốc từ Zalo (mã ${res.status}), có thể link đã hết hạn`);
    data = res.body;
    urlName = decodeURIComponent(path.basename(res.url.pathname));
  }
  const type = m.msg_type ?? "";
  // Tên tệp: tệp giữ tên gốc; ảnh lấy đuôi theo nội dung thật; còn lại theo đuôi link hoặc loại tin
  let ext = type === "chat.photo" ? sniffImageExt(data) || ".jpg" : path.extname(urlName).toLowerCase();
  if (!/^\.[a-z0-9]{1,6}$/.test(ext)) ext = EXT_BY_TYPE[type] ?? ".bin";
  const title = String(m.raw?.title ?? "").trim();
  const base =
    type === "share.file" && title
      ? title.replace(/[\/:*?"<>|]+/g, "_").slice(0, 120)
      : `${type === "chat.photo" ? "anh" : type === "chat.video.msg" ? "video" : type === "chat.voice" ? "ghi-am" : "tep"}-${m.id}${ext}`;
  const filename = path.extname(base) ? base : base + ext;
  return storeUpload({ buffer: data, originalname: Buffer.from(filename, "utf8").toString("latin1"), size: data.length });
}

/** Chuẩn bị nội dung gửi lại cho từng tin (tải tệp 1 lần, gửi cho nhiều hội thoại). */
export async function forwardItems(msgs: { id: number; msg_type: string | null; text: string | null; raw: any; undone?: number }[]) {
  const items: ForwardItem[] = [];
  for (const m of msgs) {
    if (!forwardable(m)) throw new HttpError(400, `Tin "${(m.text ?? "").slice(0, 40) || m.msg_type}" không chuyển tiếp được (tin đã thu hồi hoặc loại tin chưa hỗ trợ)`);
    const t = m.msg_type;
    if (!t || t === "webchat") items.push({ kind: "text", text: (m.text ?? "").trim() });
    else if (t === "chat.sticker") items.push({ kind: "sticker", sticker: { id: Number(m.raw.id), cateId: Number(m.raw.catId ?? m.raw.cateId), type: Number(m.raw.type ?? 0) } });
    else if (t === "chat.recommended" || t === "chat.link") items.push({ kind: "text", text: String(m.raw?.href || m.text) });
    else {
      try {
        items.push({ kind: "file", attachment: await loadMedia(m) });
      } catch (e: any) {
        throw new HttpError(400, e?.message ?? String(e));
      }
    }
  }
  return items;
}
