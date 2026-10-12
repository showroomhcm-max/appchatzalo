import { all, get, run, tx, type Row } from "./db.js";
import { bus } from "./bus.js";

export type Source = "web" | "api" | "phone" | "history" | "customer";

export type SaveMessageInput = {
  conversationId: string;
  conversationType: number;
  zaloMsgId: string | null;
  cliMsgId?: string | null;
  direction: "in" | "out";
  senderUid?: string | null;
  senderName?: string | null;
  agentId?: number | null;
  source: Source;
  msgType?: string | null;
  content: unknown;
  ts: number;
  /** Tin cũ đồng bộ lại: không tăng số chưa đọc. */
  isHistory?: boolean;
};

/** Rút gọn nội dung tin nhắn Zalo thành chữ để hiển thị, tìm kiếm và xuất dữ liệu training. */
export function extractText(msgType: string | null | undefined, content: unknown): string {
  if (typeof content === "string") return content;
  const c = (content ?? {}) as Record<string, any>;
  switch (msgType) {
    case "chat.photo":
      return c.title ? `[Hình ảnh] ${c.title}` : "[Hình ảnh]";
    case "chat.sticker":
      return "[Sticker]";
    case "chat.gif":
      return "[GIF]";
    case "chat.voice":
      return "[Tin nhắn thoại]";
    case "chat.video.msg":
      return "[Video]";
    case "share.file":
      return `[Tệp] ${c.title ?? ""}`.trim();
    case "chat.location.new":
      return "[Vị trí]";
    case "chat.recommended":
    case "chat.link":
      return [c.title, c.href].filter(Boolean).join(" — ") || "[Liên kết]";
    case "chat.todo":
      return `[Công việc] ${c.title ?? ""}`.trim();
    default:
      if (c.title || c.description) return [c.title, c.description].filter(Boolean).join(" — ");
      if (c.href) return String(c.href);
      return `[${msgType ?? "Tin nhắn"}]`;
  }
}

export type Conversation = {
  id: string;
  type: number;
  name: string | null;
  avatar: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
  status: "open" | "pending" | "closed";
  tags: string[];
  external_ref: string | null;
  unread_count: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  last_direction: "in" | "out" | null;
  created_at: number;
};

function parseConv(row: Row | undefined): Conversation | undefined {
  if (!row) return undefined;
  return { ...row, tags: JSON.parse(row.tags ?? "[]") as string[] } as Conversation;
}

const CONV_SELECT = `
  SELECT c.*, u.display_name AS assigned_name
  FROM conversations c LEFT JOIN users u ON u.id = c.assigned_to`;

export function getConversation(id: string) {
  return parseConv(get(`${CONV_SELECT} WHERE c.id = ?`, id));
}

export function listConversations(opts: {
  userId?: number;
  scope?: "mine" | "unassigned" | "all";
  status?: string;
  q?: string;
  type?: number;
  limit?: number;
  before?: number;
}) {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.scope === "mine" && opts.userId) {
    where.push("c.assigned_to = ?");
    params.push(opts.userId);
  } else if (opts.scope === "unassigned") {
    where.push("c.assigned_to IS NULL");
  }
  if (opts.status && opts.status !== "all") {
    where.push("c.status = ?");
    params.push(opts.status);
  }
  if (opts.type === 0 || opts.type === 1) {
    where.push("c.type = ?");
    params.push(opts.type);
  }
  if (opts.q) {
    where.push(
      "(c.name LIKE ? OR c.id LIKE ? OR c.external_ref LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.text LIKE ?))",
    );
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  if (opts.before) {
    where.push("COALESCE(c.last_message_at, c.created_at) < ?");
    params.push(opts.before);
  }
  const sql = `${CONV_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?`;
  params.push(Math.min(opts.limit ?? 50, 200));
  return all(sql, ...params).map((r) => parseConv(r)!);
}

const MSG_SELECT = `
  SELECT m.*, u.display_name AS agent_name
  FROM messages m LEFT JOIN users u ON u.id = m.agent_id`;

function parseMsg(row: Row | undefined) {
  if (!row) return undefined;
  return { ...row, raw: row.raw ? JSON.parse(row.raw) : null };
}

export function getMessage(id: number) {
  return parseMsg(get(`${MSG_SELECT} WHERE m.id = ?`, id));
}

export function listMessages(conversationId: string, opts: { before?: number; limit?: number } = {}) {
  const params: any[] = [conversationId];
  let sql = `${MSG_SELECT} WHERE m.conversation_id = ?`;
  if (opts.before) {
    sql += " AND m.ts < ?";
    params.push(opts.before);
  }
  sql += " ORDER BY m.ts DESC, m.id DESC LIMIT ?";
  params.push(Math.min(opts.limit ?? 50, 500));
  return all(sql, ...params).map(parseMsg).reverse();
}

export function ensureConversation(id: string, type: number, info: { name?: string | null; avatar?: string | null } = {}) {
  const existing = get("SELECT id, name, avatar FROM conversations WHERE id = ?", id);
  if (!existing) {
    run(
      "INSERT INTO conversations(id, type, name, avatar, created_at) VALUES(?, ?, ?, ?, ?)",
      id,
      type,
      info.name ?? null,
      info.avatar ?? null,
      Date.now(),
    );
    return { created: true };
  }
  if ((info.name && !existing.name) || (info.avatar && !existing.avatar)) {
    run(
      "UPDATE conversations SET name = COALESCE(name, ?), avatar = COALESCE(avatar, ?) WHERE id = ?",
      info.name ?? null,
      info.avatar ?? null,
      id,
    );
  }
  return { created: false };
}

export function updateConversationProfile(id: string, info: { name?: string | null; avatar?: string | null }) {
  run(
    "UPDATE conversations SET name = COALESCE(?, name), avatar = COALESCE(?, avatar) WHERE id = ?",
    info.name ?? null,
    info.avatar ?? null,
    id,
  );
  const conv = getConversation(id);
  if (conv) bus.emit("conversation.updated", conv);
}

/**
 * Lưu tin nhắn (idempotent theo zalo_msg_id).
 * Tin do nhân viên gửi từ web có thể về qua listener trước khi API gửi trả kết quả,
 * nên khi trùng ta giữ lại agent_id/source nếu bản mới có thông tin nhân viên.
 */
export function saveMessage(input: SaveMessageInput) {
  const text = extractText(input.msgType, input.content);
  const raw = typeof input.content === "string" ? null : JSON.stringify(input.content);

  const result = tx(() => {
    ensureConversation(input.conversationId, input.conversationType, {
      name: input.direction === "in" && input.conversationType === 0 ? input.senderName : null,
    });

    const existing = input.zaloMsgId
      ? get<{ id: number; agent_id: number | null }>(
          "SELECT id, agent_id FROM messages WHERE zalo_msg_id = ?",
          input.zaloMsgId,
        )
      : undefined;

    if (existing) {
      if (input.agentId && !existing.agent_id) {
        run("UPDATE messages SET agent_id = ?, source = ? WHERE id = ?", input.agentId, input.source, existing.id);
        return { id: existing.id, isNew: false, changed: true };
      }
      return { id: existing.id, isNew: false, changed: false };
    }

    const r = run(
      `INSERT INTO messages(conversation_id, zalo_msg_id, cli_msg_id, direction, sender_uid, sender_name,
         agent_id, source, msg_type, text, raw, ts)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.conversationId,
      input.zaloMsgId,
      input.cliMsgId ?? null,
      input.direction,
      input.senderUid ?? null,
      input.senderName ?? null,
      input.agentId ?? null,
      input.source,
      input.msgType ?? null,
      text,
      raw,
      input.ts,
    );
    const id = Number(r.lastInsertRowid);

    const preview = text.length > 120 ? text.slice(0, 117) + "..." : text;
    run(
      `UPDATE conversations SET
         last_message_at = ?, last_message_preview = ?, last_direction = ?
       WHERE id = ? AND (last_message_at IS NULL OR last_message_at <= ?)`,
      input.ts,
      preview,
      input.direction,
      input.conversationId,
      input.ts,
    );
    if (!input.isHistory) {
      if (input.direction === "in") {
        // Khách nhắn lại vào cuộc đã đóng → mở lại.
        run(
          "UPDATE conversations SET unread_count = unread_count + 1, status = CASE WHEN status = 'closed' THEN 'open' ELSE status END WHERE id = ?",
          input.conversationId,
        );
      } else {
        run("UPDATE conversations SET unread_count = 0 WHERE id = ?", input.conversationId);
      }
    }
    return { id, isNew: true, changed: true };
  });

  const message = getMessage(result.id)!;
  const conversation = getConversation(input.conversationId)!;
  if (result.isNew) bus.emit("message.created", message, conversation);
  else if (result.changed) bus.emit("message.updated", message, conversation);
  return { message, conversation, isNew: result.isNew };
}

export function markUndone(zaloMsgId: string) {
  const row = get<{ id: number; conversation_id: string }>(
    "SELECT id, conversation_id FROM messages WHERE zalo_msg_id = ?",
    zaloMsgId,
  );
  if (!row) return;
  run("UPDATE messages SET undone = 1 WHERE id = ?", row.id);
  bus.emit("message.updated", getMessage(row.id)!, getConversation(row.conversation_id)!);
}
