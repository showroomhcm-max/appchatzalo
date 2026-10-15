import { all, get, run, tx, type Row } from "./db.js";
import { bus } from "./bus.js";
import { conversationFilter, type Scope } from "./access.js";

/** id hội thoại = "<kênh>_<threadId Zalo>" (cùng 1 khách chat với 2 tài khoản Zalo là 2 hội thoại). */
export function conversationKey(channelId: number, threadId: string) {
  return `${channelId}_${threadId}`;
}

export type Source = "web" | "api" | "phone" | "history" | "customer";

export type SaveMessageInput = {
  channelId: number;
  threadId: string;
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
  /** Tin này trả lời (trích dẫn) tin nào */
  quote?: MessageQuote | null;
  /** Hội thoại bình luận (Facebook) và thông tin bài viết */
  kind?: "chat" | "comment";
  meta?: Record<string, any> | null;
  /** Tên / ảnh khách (nền tảng có sẵn trong sự kiện) */
  customerName?: string | null;
  customerAvatar?: string | null;
};

export type MessageQuote = { msg: string; fromD: string; globalMsgId: string; ownerId: string };

export type ReactionSummary = { icon: string; count: number; names: string[]; mine: boolean };

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
  channel_id: number;
  channel_name: string | null;
  /** Nền tảng của kênh: zalo | facebook | tiktok | tiktok_shop */
  platform: string;
  /** chat = tin nhắn, comment = bình luận dưới bài viết */
  kind: "chat" | "comment";
  meta: Record<string, any> | null;
  thread_id: string;
  department_id: number | null;
  department_name: string | null;
  department_color: string | null;
  type: number;
  name: string | null;
  avatar: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
  status: "open" | "pending" | "closed";
  tags: string[];
  external_ref: string | null;
  phone: string | null;
  unread_count: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  last_direction: "in" | "out" | null;
  created_at: number;
};

function parseConv(row: Row | undefined): Conversation | undefined {
  if (!row) return undefined;
  return {
    ...row,
    tags: JSON.parse(row.tags ?? "[]") as string[],
    meta: row.meta ? JSON.parse(row.meta) : null,
  } as Conversation;
}

const CONV_SELECT = `
  SELECT c.*, u.display_name AS assigned_name, ch.name AS channel_name, ch.platform AS platform,
         d.name AS department_name, d.color AS department_color
  FROM conversations c
  LEFT JOIN users u ON u.id = c.assigned_to
  LEFT JOIN channels ch ON ch.id = c.channel_id
  LEFT JOIN departments d ON d.id = c.department_id`;

export function getConversation(id: string) {
  return parseConv(get(`${CONV_SELECT} WHERE c.id = ?`, id));
}

export function listConversations(opts: {
  access: Scope;
  userId?: number;
  scope?: "mine" | "unassigned" | "all";
  channelId?: number;
  /** Chỉ các kênh này (kênh nhân viên đang tick chọn) */
  channelIds?: number[];
  departmentId?: number | null;
  tag?: string;
  status?: string;
  q?: string;
  type?: number;
  limit?: number;
  before?: number;
  /** Chỉ hội thoại đang có cảnh báo đơn "rơi" */
  alert?: boolean;
  /** Gồm cả hội thoại của Zalo nhân viên đang giám sát */
  includeMonitor?: boolean;
  /** Lọc nhiều tag */
  tags?: string[];
  tagMode?: "any" | "all";
  /** Chỉ hội thoại đã xóa */
  deleted?: boolean;
  /** Chỉ hội thoại người này đã ghim */
  pinnedBy?: number;
}) {
  const where: string[] = [conversationFilter(opts.access)];
  const params: any[] = [];
  if (opts.userId && !opts.includeMonitor) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM channels mch WHERE mch.id = c.channel_id AND mch.mode = 'monitor'
         AND NOT EXISTS (SELECT 1 FROM channel_assets ca WHERE ca.channel_id = mch.id AND ca.holder_id = ${Number(opts.userId)}))`,
    );
  }
  if (opts.alert) where.push("EXISTS (SELECT 1 FROM conversation_alerts a WHERE a.conversation_id = c.id AND a.resolved_at IS NULL)");
  if (opts.channelId) {
    where.push("c.channel_id = ?");
    params.push(opts.channelId);
  }
  if (opts.channelIds) {
    const ids = opts.channelIds.filter((n) => Number.isInteger(n) && n > 0);
    where.push(ids.length ? `c.channel_id IN (${ids.join(",")})` : "0 = 1");
  }
  if (opts.departmentId === null) where.push("c.department_id IS NULL");
  else if (opts.departmentId) {
    where.push("c.department_id = ?");
    params.push(opts.departmentId);
  }
  if (opts.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)");
    params.push(opts.tag);
  }
  // Nhiều tag: "any" = có 1 trong các tag (A hoặc B), "all" = có đủ các tag (A và B)
  const tagList = (opts.tags ?? []).filter(Boolean).slice(0, 20);
  if (tagList.length) {
    if (opts.tagMode === "all") {
      for (const t of tagList) {
        where.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)");
        params.push(t);
      }
    } else {
      where.push(`EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value IN (${tagList.map(() => "?").join(",")}))`);
      params.push(...tagList);
    }
  }
  // Hội thoại đã xóa chỉ hiện khi xem mục "Đã xóa"
  where.push(opts.deleted ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL");
  if (opts.pinnedBy) {
    where.push("EXISTS (SELECT 1 FROM conversation_pins p WHERE p.conversation_id = c.id AND p.user_id = ?)");
    params.push(opts.pinnedBy);
  }
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
  const sql = `${CONV_SELECT} WHERE ${where.join(" AND ")}
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?`;
  params.push(Math.min(opts.limit ?? 50, 200));
  return all(sql, ...params).map((r) => parseConv(r)!);
}

const MSG_SELECT = `
  SELECT m.*, u.display_name AS agent_name, hu.display_name AS holder_name
  FROM messages m LEFT JOIN users u ON u.id = m.agent_id LEFT JOIN users hu ON hu.id = m.holder_id`;

function parseMsg(row: Row | undefined) {
  if (!row) return undefined;
  return { ...row, raw: row.raw ? JSON.parse(row.raw) : null, quote: row.quote ? JSON.parse(row.quote) : null } as Row;
}

/** Gắn danh sách cảm xúc (gom theo biểu tượng) vào tin nhắn. */
function withReactions<T extends Row>(msgs: T[]): T[] {
  if (!msgs.length) return msgs;
  const ids = msgs.map((m) => m.id);
  const rows = all<{ message_id: number; icon: string; reactor_name: string | null; reactor_uid: string; agent_id: number | null }>(
    `SELECT message_id, icon, reactor_name, reactor_uid, agent_id FROM message_reactions
     WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY ts`,
    ...ids,
  );
  return msgs.map((m) => {
    const mine = rows.filter((r) => r.message_id === m.id);
    if (!mine.length) return { ...m, reactions: [] };
    const groups = new Map<string, ReactionSummary>();
    for (const r of mine) {
      const g = groups.get(r.icon) ?? { icon: r.icon, count: 0, names: [], mine: false };
      g.count++;
      g.names.push(r.reactor_name ?? "Khách");
      if (r.agent_id || r.reactor_uid.startsWith("shop:")) g.mine = true;
      groups.set(r.icon, g);
    }
    return { ...m, reactions: [...groups.values()] };
  });
}

export function getMessage(id: number) {
  const m = parseMsg(get(`${MSG_SELECT} WHERE m.id = ?`, id));
  return m ? withReactions([m])[0] : undefined;
}

export function listMessages(conversationId: string, opts: { before?: number; limit?: number; around?: number } = {}) {
  if (opts.around) {
    // Nhảy tới một tin (từ kết quả tìm kiếm): 40 tin trước nó + toàn bộ tin sau nó (tối đa 500).
    const target = get<{ ts: number; id: number }>(
      "SELECT ts, id FROM messages WHERE id = ? AND conversation_id = ?",
      opts.around,
      conversationId,
    );
    if (target) {
      const older = all(
        `${MSG_SELECT} WHERE m.conversation_id = ? AND (m.ts < ? OR (m.ts = ? AND m.id < ?)) ORDER BY m.ts DESC, m.id DESC LIMIT 40`,
        conversationId,
        target.ts,
        target.ts,
        target.id,
      ).reverse();
      const newer = all(
        `${MSG_SELECT} WHERE m.conversation_id = ? AND (m.ts > ? OR (m.ts = ? AND m.id >= ?)) ORDER BY m.ts ASC, m.id ASC LIMIT 500`,
        conversationId,
        target.ts,
        target.ts,
        target.id,
      );
      return withReactions([...older, ...newer].map((r) => parseMsg(r)!));
    }
  }
  const params: any[] = [conversationId];
  let sql = `${MSG_SELECT} WHERE m.conversation_id = ?`;
  if (opts.before) {
    sql += " AND m.ts < ?";
    params.push(opts.before);
  }
  sql += " ORDER BY m.ts DESC, m.id DESC LIMIT ?";
  params.push(Math.min(opts.limit ?? 50, 500));
  return withReactions(all(sql, ...params).map((r) => parseMsg(r)!).reverse());
}

/** Tạo hội thoại nếu chưa có. Hội thoại mới vào bộ phận mặc định của kênh. */
export function ensureConversation(
  channelId: number,
  threadId: string,
  type: number,
  info: { name?: string | null; avatar?: string | null; kind?: "chat" | "comment"; meta?: Record<string, any> | null } = {},
) {
  const id = conversationKey(channelId, threadId);
  const existing = get("SELECT id, name, avatar, meta FROM conversations WHERE id = ?", id);
  if (existing && info.meta && !existing.meta) run("UPDATE conversations SET meta = ? WHERE id = ?", JSON.stringify(info.meta), id);
  if (!existing) {
    const dept = get<{ default_department_id: number | null }>(
      "SELECT default_department_id FROM channels WHERE id = ?",
      channelId,
    );
    run(
      `INSERT INTO conversations(id, channel_id, thread_id, type, department_id, name, avatar, created_at, kind, meta)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      channelId,
      threadId,
      type,
      dept?.default_department_id ?? null,
      info.name ?? null,
      info.avatar ?? null,
      Date.now(),
      info.kind ?? "chat",
      info.meta ? JSON.stringify(info.meta) : null,
    );
    return { id, created: true };
  }
  if ((info.name && !existing.name) || (info.avatar && !existing.avatar)) {
    run(
      "UPDATE conversations SET name = COALESCE(name, ?), avatar = COALESCE(avatar, ?) WHERE id = ?",
      info.name ?? null,
      info.avatar ?? null,
      id,
    );
  }
  return { id, created: false };
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

  const conversationId = conversationKey(input.channelId, input.threadId);
  const result = tx(() => {
    ensureConversation(input.channelId, input.threadId, input.conversationType, {
      name: input.customerName ?? (input.direction === "in" && input.conversationType === 0 ? input.senderName : null),
      avatar: input.customerAvatar ?? null,
      kind: input.kind,
      meta: input.meta,
    });

    const existing = input.zaloMsgId
      ? get<{ id: number; agent_id: number | null; cli_msg_id: string | null; quote: string | null }>(
          "SELECT id, agent_id, cli_msg_id, quote FROM messages WHERE conversation_id = ? AND zalo_msg_id = ?",
          conversationId,
          input.zaloMsgId,
        )
      : undefined;

    if (existing) {
      // Bản tin do listener nhận về có cliMsgId (cần để thả cảm xúc / thu hồi) mà kết quả gửi không có.
      if (input.cliMsgId && !existing.cli_msg_id) run("UPDATE messages SET cli_msg_id = ? WHERE id = ?", input.cliMsgId, existing.id);
      if (input.quote && !existing.quote) run("UPDATE messages SET quote = ? WHERE id = ?", JSON.stringify(input.quote), existing.id);
      if (input.agentId && !existing.agent_id) {
        run("UPDATE messages SET agent_id = ?, source = ?, holder_id = NULL WHERE id = ?", input.agentId, input.source, existing.id);
        return { id: existing.id, isNew: false, changed: true };
      }
      return { id: existing.id, isNew: false, changed: false };
    }

    // Tin gửi từ điện thoại của Zalo công ty: ghi người đang giữ máy (Cài đặt › Zalo & SĐT công ty)
    const holderId =
      input.source === "phone" && input.direction === "out" && !input.agentId
        ? get<{ holder_id: number | null }>("SELECT holder_id FROM channel_assets WHERE channel_id = ? AND status = 'in_use'", input.channelId)?.holder_id ?? null
        : null;
    const r = run(
      `INSERT INTO messages(conversation_id, zalo_msg_id, cli_msg_id, direction, sender_uid, sender_name,
         agent_id, source, msg_type, text, raw, ts, quote, holder_id)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      conversationId,
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
      input.quote ? JSON.stringify(input.quote) : null,
      holderId,
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
      conversationId,
      input.ts,
    );
    if (!input.isHistory) {
      if (input.direction === "in") {
        // Khách nhắn lại vào cuộc đã đóng → mở lại.
        run(
          "UPDATE conversations SET unread_count = unread_count + 1, deleted_at = NULL, status = CASE WHEN status = 'closed' THEN 'open' ELSE status END WHERE id = ?",
          conversationId,
        );
      } else {
        run("UPDATE conversations SET unread_count = 0 WHERE id = ?", conversationId);
      }
    }
    return { id, isNew: true, changed: true };
  });

  const message = getMessage(result.id)!;
  const conversation = getConversation(conversationId)!;
  if (result.isNew) bus.emit("message.created", message, conversation);
  else if (result.changed) bus.emit("message.updated", message, conversation);
  return { message, conversation, isNew: result.isNew };
}

export function markUndone(channelId: number, threadId: string, zaloMsgId: string) {
  const row = get<{ id: number; conversation_id: string }>(
    "SELECT id, conversation_id FROM messages WHERE conversation_id = ? AND zalo_msg_id = ?",
    conversationKey(channelId, threadId),
    zaloMsgId,
  );
  if (!row) return;
  run("UPDATE messages SET undone = 1, undone_at = COALESCE(undone_at, ?) WHERE id = ?", Date.now(), row.id);
  bus.emit("message.updated", getMessage(row.id)!, getConversation(row.conversation_id)!);
}

/**
 * Khách đã nhận / đã xem tin (Zalo). Lưu mốc thời gian của tin mới nhất được nhận / xem:
 * mọi tin shop gửi trước mốc đó coi như đã nhận / đã xem.
 */
export function markReceipt(channelId: number, threadId: string, msgIds: string[], kind: "delivered" | "seen", seenCount?: number) {
  const id = conversationKey(channelId, threadId);
  const ids = msgIds.filter(Boolean);
  if (!ids.length) return;
  const row = get<{ ts: number }>(
    `SELECT MAX(ts) AS ts FROM messages WHERE conversation_id = ? AND zalo_msg_id IN (${ids.map(() => "?").join(",")})`,
    id,
    ...ids,
  );
  if (!row?.ts) return;
  const col = kind === "seen" ? "seen_ts" : "delivered_ts";
  const r = run(`UPDATE conversations SET ${col} = ? WHERE id = ? AND COALESCE(${col}, 0) < ?`, row.ts, id, row.ts);
  if (kind === "seen" && seenCount !== undefined) run("UPDATE conversations SET seen_count = ? WHERE id = ?", seenCount, id);
  // Đã xem thì cũng là đã nhận
  if (kind === "seen") run("UPDATE conversations SET delivered_ts = ? WHERE id = ? AND COALESCE(delivered_ts, 0) < ?", row.ts, id, row.ts);
  if (r.changes) {
    const conv = getConversation(id);
    if (conv) bus.emit("conversation.updated", conv);
  }
}

/** Tìm tin nhắn theo id Zalo trong một hội thoại. */
export function findMessageByZaloId(conversationId: string, zaloMsgId: string) {
  return get<{ id: number }>("SELECT id FROM messages WHERE conversation_id = ? AND zalo_msg_id = ?", conversationId, zaloMsgId);
}

/** Lưu / gỡ cảm xúc (icon rỗng = gỡ). Mỗi người chỉ có 1 cảm xúc trên 1 tin, như Zalo. */
export function setReaction(
  messageId: number,
  reactor: { uid: string; name: string | null; agentId?: number | null },
  icon: string,
) {
  if (!icon) run("DELETE FROM message_reactions WHERE message_id = ? AND reactor_uid = ?", messageId, reactor.uid);
  else
    run(
      `INSERT INTO message_reactions(message_id, reactor_uid, reactor_name, agent_id, icon, ts) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id, reactor_uid) DO UPDATE SET icon = excluded.icon, ts = excluded.ts,
         reactor_name = COALESCE(excluded.reactor_name, reactor_name), agent_id = COALESCE(excluded.agent_id, agent_id)`,
      messageId,
      reactor.uid,
      reactor.name,
      reactor.agentId ?? null,
      icon,
      Date.now(),
    );
  const message = getMessage(messageId);
  if (message) bus.emit("message.updated", message, getConversation(message.conversation_id)!);
  return message;
}
