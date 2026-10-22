import { isOthersMonitorChannel } from "./access.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import { get, logEvent, run } from "./db.js";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { getConversation, type Source } from "./store.js";
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

function storeUpload(file: UploadedFile): OutgoingAttachment {
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
