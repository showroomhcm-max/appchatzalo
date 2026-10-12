import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import { get, logEvent, run } from "./db.js";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { getConversation, type Source } from "./store.js";
import { zalo, type OutgoingAttachment } from "./zalo.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ConversationPatch = {
  assigned_to?: number | null;
  status?: "open" | "pending" | "closed";
  tags?: string[];
  external_ref?: string | null;
  name?: string;
};

/** Cập nhật hội thoại dùng chung cho giao diện nhân viên và API tích hợp. */
export function updateConversation(id: string, patch: ConversationPatch, byUserId: number | null) {
  const conv = getConversation(id);
  if (!conv) throw new HttpError(404, "Không tìm thấy hội thoại");

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
}) {
  const conv = getConversation(opts.conversationId);
  if (!conv) throw new HttpError(404, "Không tìm thấy hội thoại");
  const text = (opts.text ?? "").trim();
  if (!text && !opts.files?.length) throw new HttpError(400, "Nội dung trống");
  if (zalo.getStatus().state !== "connected") throw new HttpError(503, "Zalo chưa kết nối, chưa gửi được tin");

  const messages = await zalo.send({
    conversationId: opts.conversationId,
    text,
    attachments: opts.files?.map(storeUpload),
    agentId: opts.agentId,
    source: opts.source,
  });

  if (opts.agentId && !conv.assigned_to) {
    updateConversation(opts.conversationId, { assigned_to: opts.agentId }, opts.agentId);
  }
  if (conv.status === "closed") updateConversation(opts.conversationId, { status: "open" }, opts.agentId);
  return messages;
}
