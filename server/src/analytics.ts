import ExcelJS from "exceljs";
import { all, type Row } from "./db.js";

export type ExportFilter = {
  from?: number;
  to?: number;
  agentId?: number;
  conversationId?: string;
  channelId?: number;
  departmentId?: number;
  /** Bỏ qua tin hệ thống/sticker khi xuất cho training. */
  textOnly?: boolean;
  /** 0 = khách chat 1-1, 1 = nhóm chat */
  type?: number;
  /** Bỏ Zalo nhân viên đang giám sát (người xuất không có quyền Giám sát) */
  excludeMonitor?: boolean;
};

type Msg = {
  id: number;
  conversation_id: string;
  direction: "in" | "out";
  agent_id: number | null;
  agent_name: string | null;
  sender_name: string | null;
  source: string;
  msg_type: string | null;
  text: string | null;
  ts: number;
  undone: number;
};

function rangeWhere(f: ExportFilter, alias = "m") {
  const where: string[] = [];
  const params: any[] = [];
  if (f.from) {
    where.push(`${alias}.ts >= ?`);
    params.push(f.from);
  }
  if (f.to) {
    where.push(`${alias}.ts <= ?`);
    params.push(f.to);
  }
  return { where, params };
}

function loadMessages(f: ExportFilter): Msg[] {
  const { where, params } = rangeWhere(f);
  if (f.conversationId) {
    where.push("m.conversation_id = ?");
    params.push(f.conversationId);
  }
  if (f.channelId) {
    where.push("m.conversation_id IN (SELECT id FROM conversations WHERE channel_id = ?)");
    params.push(f.channelId);
  }
  if (f.departmentId) {
    where.push("m.conversation_id IN (SELECT id FROM conversations WHERE department_id = ?)");
    params.push(f.departmentId);
  }
  if (f.type === 0 || f.type === 1) {
    where.push("m.conversation_id IN (SELECT id FROM conversations WHERE type = ?)");
    params.push(f.type);
  }
  if (f.excludeMonitor) where.push("m.conversation_id NOT IN (SELECT c.id FROM conversations c JOIN channels ch ON ch.id = c.channel_id WHERE ch.mode = 'monitor')");
  if (f.agentId) {
    // Lấy trọn các hội thoại mà nhân viên này có tham gia trả lời trong khoảng thời gian.
    const r = rangeWhere(f, "m2");
    where.push(
      `m.conversation_id IN (SELECT DISTINCT m2.conversation_id FROM messages m2 WHERE m2.agent_id = ? ${
        r.where.length ? "AND " + r.where.join(" AND ") : ""
      })`,
    );
    params.push(f.agentId, ...r.params);
  }
  return all<Msg>(
    `SELECT m.id, m.conversation_id, m.direction, m.agent_id, u.display_name AS agent_name, m.sender_name,
            m.source, m.msg_type, m.text, m.ts, m.undone
     FROM messages m LEFT JOIN users u ON u.id = m.agent_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY m.conversation_id, m.ts, m.id`,
    ...params,
  );
}

function speaker(m: Msg) {
  if (m.direction === "in") return "customer";
  return m.agent_id ? "agent" : "staff_unknown";
}

function speakerLabel(m: Msg, customerName: string) {
  if (m.direction === "in") return `Khách (${m.sender_name || customerName})`;
  if (m.agent_name) return `NV ${m.agent_name}`;
  return m.source === "api" ? "Hệ thống (API)" : "Shop (gửi từ điện thoại)";
}

/** Gom tin nhắn theo hội thoại, kèm ghi chú nội bộ và đánh giá chất lượng. */
export function buildConversations(f: ExportFilter) {
  const msgs = loadMessages(f).filter((m) => !m.undone && (!f.textOnly || m.msg_type === "webchat" || !m.msg_type));
  const convIds = [...new Set(msgs.map((m) => m.conversation_id))];
  if (!convIds.length) return [];
  const placeholders = convIds.map(() => "?").join(",");
  const convs = new Map(
    all(
      `SELECT c.id, c.name, c.type, c.status, c.tags, c.external_ref, c.phone, u.display_name AS assigned_name,
              ch.name AS channel_name, ch.platform, ch.mode AS channel_mode, hu.display_name AS holder_name,
              x.summary AS ai_summary, x.quality_score AS ai_score, x.risk AS ai_risk, x.outcome AS ai_outcome
       FROM conversations c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN channels ch ON ch.id = c.channel_id
       LEFT JOIN channel_assets ca ON ca.channel_id = c.channel_id LEFT JOIN users hu ON hu.id = ca.holder_id
       LEFT JOIN ai_conv_analysis x ON x.conversation_id = c.id
       WHERE c.id IN (${placeholders})`,
      ...convIds,
    ).map((c) => [c.id, c]),
  );
  const notes = all(
    `SELECT n.conversation_id, n.content, n.created_at, u.display_name AS author
     FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.conversation_id IN (${placeholders}) ORDER BY n.created_at`,
    ...convIds,
  );
  const reviews = all(
    `SELECT r.conversation_id, r.score, r.comment, r.created_at, rv.display_name AS reviewer, a.display_name AS agent
     FROM reviews r LEFT JOIN users rv ON rv.id = r.reviewer_id LEFT JOIN users a ON a.id = r.agent_id
     WHERE r.conversation_id IN (${placeholders}) ORDER BY r.created_at`,
    ...convIds,
  );

  return convIds.map((id) => {
    const c = convs.get(id) as Row;
    const list = msgs.filter((m) => m.conversation_id === id);
    const customerName = c?.name ?? id;
    const isGroup = c?.type === 1;
    return {
      conversation_id: id,
      customer_name: customerName,
      external_ref: c?.external_ref ?? null,
      is_group: isGroup,
      /** "Khách 1-1" hoặc "Nhóm" */
      chat_type: isGroup ? "Nhóm" : "Khách 1-1",
      customer_phone: c?.phone ?? null,
      channel: c?.channel_name ?? null,
      platform: c?.platform ?? null,
      /** "CSKH chung" hoặc "Zalo nhân viên" (giám sát) */
      channel_kind: c?.channel_mode === "monitor" ? "Zalo nhân viên" : "CSKH chung",
      holder: c?.channel_mode === "monitor" ? c?.holder_name ?? null : null,
      msg_in: list.filter((m) => m.direction === "in").length,
      msg_out: list.filter((m) => m.direction === "out").length,
      /** Nhóm: các thành viên (phía khách) đã nhắn */
      participants: isGroup ? [...new Set(list.filter((m) => m.direction === "in" && m.sender_name).map((m) => m.sender_name as string))] : [],
      ai: c?.ai_summary ? { summary: c.ai_summary, score: c.ai_score, risk: c.ai_risk, outcome: c.ai_outcome } : null,
      status: c?.status,
      tags: JSON.parse(c?.tags ?? "[]"),
      assigned_to: c?.assigned_name ?? null,
      agents: [...new Set(list.filter((m) => m.agent_name).map((m) => m.agent_name))],
      started_at: new Date(list[0].ts).toISOString(),
      ended_at: new Date(list[list.length - 1].ts).toISOString(),
      messages: list.map((m) => ({
        time: new Date(m.ts).toISOString(),
        role: speaker(m),
        direction: m.direction,
        sender: m.direction === "in" ? m.sender_name || customerName : m.agent_name || (c?.channel_mode === "monitor" ? c?.holder_name : null) || "Shop",
        speaker: isGroup && m.direction === "in" ? `Thành viên (${m.sender_name || "?"})` : speakerLabel(m, customerName),
        agent: m.agent_name,
        type: m.msg_type,
        text: m.text ?? "",
      })),
      notes: notes
        .filter((n) => n.conversation_id === id)
        .map((n) => ({ author: n.author, content: n.content, time: new Date(n.created_at).toISOString() })),
      reviews: reviews
        .filter((r) => r.conversation_id === id)
        .map((r) => ({ reviewer: r.reviewer, agent: r.agent, score: r.score, comment: r.comment })),
    };
  });
}

/** Giờ Việt Nam dạng "2026-10-12 11:10:55" cho file đọc bằng mắt (CSV/TXT). */
function vnTime(iso: string) {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(convs: ReturnType<typeof buildConversations>) {
  const header = ["conversation_id", "loai_chat", "khach_hang_hoac_nhom", "sdt_khach", "kenh", "loai_kenh", "thoi_gian", "vai_tro", "nguoi_gui", "nguoi_noi", "nhan_vien", "loai_tin", "noi_dung"];
  const lines = [header.join(",")];
  for (const c of convs) {
    for (const m of c.messages) {
      lines.push(
        [c.conversation_id, c.chat_type, c.customer_name, c.customer_phone ?? "", c.channel ?? "", c.channel_kind, vnTime(m.time), m.role, m.sender, m.speaker, m.agent ?? "", m.type ?? "", m.text]
          .map(csvCell)
          .join(","),
      );
    }
  }
  // BOM để Excel đọc đúng tiếng Việt.
  return "﻿" + lines.join("\r\n");
}

export function toTxt(convs: ReturnType<typeof buildConversations>) {
  const block = (c: ReturnType<typeof buildConversations>[number]) => {
      const head = [
        `=== ${c.is_group ? "Nhóm" : "Khách"}: ${c.customer_name}${c.customer_phone ? ` · ${c.customer_phone}` : ""} (${c.conversation_id}) ===`,
        `Loại: ${c.chat_type}${c.is_group ? ` (${c.participants.length} thành viên đã nhắn: ${c.participants.join(", ") || "—"})` : ""} | Kênh: ${c.channel ?? "—"} (${c.channel_kind}${c.holder ? ` · ${c.holder}` : ""})`,
        `Tin khách: ${c.msg_in} | Tin shop: ${c.msg_out} | Nhân viên tham gia: ${c.agents.join(", ") || "—"} | Trạng thái: ${c.status} | Nhãn: ${c.tags.join(", ") || "—"}`,
        ...(c.ai ? [`AI: ${c.ai.summary}${c.ai.score ? ` (điểm ${c.ai.score}/10)` : ""}`] : []),
        `Thời gian: ${vnTime(c.started_at)} → ${vnTime(c.ended_at)} (giờ VN)`,
      ];
      const body = c.messages.map((m) => `[${vnTime(m.time)}] ${m.speaker}: ${m.text}`);
      const extra = [
        ...c.notes.map((n) => `  [Ghi chú] (${n.author}): ${n.content}`),
        ...c.reviews.map((r) => `  [Đánh giá] ${r.score}/5 cho ${r.agent ?? "—"} bởi ${r.reviewer}: ${r.comment ?? ""}`),
      ];
      return [...head, "", ...body, ...(extra.length ? ["", ...extra] : [])].join("\n");
  };
  const singles = convs.filter((c) => !c.is_group);
  const groups = convs.filter((c) => c.is_group);
  const parts: string[] = [];
  if (singles.length) parts.push(`################ KHÁCH CHAT 1-1 (${singles.length}) ################`, ...singles.map(block));
  if (groups.length) parts.push(`################ NHÓM CHAT (${groups.length}) ################`, ...groups.map(block));
  return parts.join("\n\n");
}

/**
 * JSONL dạng chat (role user/assistant) để huấn luyện/đánh giá AI hoặc làm bộ mẫu tư vấn.
 * Tin liên tiếp của cùng một bên được gộp lại.
 */
export function toJsonl(convs: ReturnType<typeof buildConversations>) {
  return convs
    .map((c) => {
      const turns: { role: "user" | "assistant"; content: string; agent?: string | null }[] = [];
      for (const m of c.messages) {
        const role = m.role === "customer" ? "user" : "assistant";
        const last = turns[turns.length - 1];
        if (last && last.role === role) last.content += "\n" + m.text;
        else turns.push({ role, content: m.text, ...(role === "assistant" ? { agent: m.agent } : {}) });
      }
      return JSON.stringify({
        conversation_id: c.conversation_id,
        chat_type: c.chat_type,
        is_group: c.is_group,
        agents: c.agents,
        tags: c.tags,
        review_score: c.reviews.length ? c.reviews[c.reviews.length - 1].score : null,
        messages: turns,
      });
    })
    .join("\n");
}

/** Thống kê hiệu suất theo nhân viên trong khoảng thời gian. */
export function agentStats(f: ExportFilter) {
  const msgs = loadMessages({ from: f.from, to: f.to, channelId: f.channelId, departmentId: f.departmentId });
  type Acc = {
    agent_id: number | null;
    agent_name: string;
    messages_sent: number;
    conversations: Set<string>;
    responseTimes: number[];
  };
  const acc = new Map<string, Acc>();
  const bucket = (m: Msg): Acc => {
    const key = m.agent_id ? String(m.agent_id) : m.source === "api" ? "api" : "phone";
    let a = acc.get(key);
    if (!a) {
      a = {
        agent_id: m.agent_id,
        agent_name: m.agent_name ?? (key === "api" ? "Hệ thống (API)" : "Gửi từ điện thoại / không rõ"),
        messages_sent: 0,
        conversations: new Set(),
        responseTimes: [],
      };
      acc.set(key, a);
    }
    return a;
  };

  let customerMessages = 0;
  let waitingSince: number | null = null;
  let currentConv = "";
  for (const m of msgs) {
    if (m.conversation_id !== currentConv) {
      currentConv = m.conversation_id;
      waitingSince = null;
    }
    if (m.direction === "in") {
      customerMessages++;
      waitingSince ??= m.ts;
      continue;
    }
    if (m.source === "history") continue;
    const a = bucket(m);
    a.messages_sent++;
    a.conversations.add(m.conversation_id);
    if (waitingSince !== null) {
      a.responseTimes.push((m.ts - waitingSince) / 1000);
      waitingSince = null;
    }
  }

  const reviewRows = all<{ agent_id: number; avg: number; n: number }>(
    `SELECT agent_id, AVG(score) AS avg, COUNT(*) AS n FROM reviews
     WHERE agent_id IS NOT NULL ${f.from ? "AND created_at >= " + Number(f.from) : ""} ${f.to ? "AND created_at <= " + Number(f.to) : ""}
     GROUP BY agent_id`,
  );

  const agents = [...acc.values()]
    .map((a) => {
      const sorted = [...a.responseTimes].sort((x, y) => x - y);
      const review = reviewRows.find((r) => r.agent_id === a.agent_id);
      return {
        agent_id: a.agent_id,
        agent_name: a.agent_name,
        messages_sent: a.messages_sent,
        conversations: a.conversations.size,
        responses: sorted.length,
        avg_response_sec: sorted.length ? Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length) : null,
        median_response_sec: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null,
        within_5min_pct: sorted.length ? Math.round((sorted.filter((x) => x <= 300).length / sorted.length) * 100) : null,
        review_avg: review ? Math.round(review.avg * 10) / 10 : null,
        review_count: review?.n ?? 0,
      };
    })
    .sort((x, y) => y.messages_sent - x.messages_sent);

  const waiting = all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM conversations WHERE last_direction = 'in' AND status != 'closed'",
  )[0].n;

  return {
    customer_messages: customerMessages,
    conversations_active: new Set(msgs.map((m) => m.conversation_id)).size,
    waiting_reply: waiting,
    agents,
  };
}


/**
 * Excel "Tổng hợp theo khách hàng & nhóm chat": trang Khách 1-1 (mỗi khách một dòng), trang Nhóm chat (mỗi nhóm một dòng),
 * trang Tin nhắn (mỗi tin một dòng, có cột Loại chat để lọc).
 */
export async function toXlsx(convs: ReturnType<typeof buildConversations>) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Chat Siêu Tốc";
  const add = (name: string, cols: { header: string; key: string; width: number; wrap?: boolean }[], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A804A" } };
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    rows.forEach((r) => ws.addRow(r));
    cols.forEach((c) => (ws.getColumn(c.key).alignment = { vertical: "top", wrapText: !!c.wrap }));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  };
  const common = (c: ReturnType<typeof buildConversations>[number]) => ({
    channel: c.channel ?? "",
    kind: c.channel_kind + (c.holder ? ` · ${c.holder}` : ""),
    msg_in: c.msg_in,
    msg_out: c.msg_out,
    first: vnTime(c.started_at),
    last: vnTime(c.ended_at),
    agents: c.agents.join(", "),
    status: c.status ?? "",
    tags: c.tags.join(", "),
    review: c.reviews.length ? `${c.reviews[c.reviews.length - 1].score}/5` : "",
    ai: c.ai ? `${c.ai.summary}${c.ai.score ? ` (điểm ${c.ai.score}/10)` : ""}` : "",
    id: c.conversation_id,
  });
  const tail = [
    { header: "Kênh", key: "channel", width: 18 },
    { header: "Loại kênh", key: "kind", width: 22 },
    { header: "Tin khách", key: "msg_in", width: 10 },
    { header: "Tin shop", key: "msg_out", width: 10 },
    { header: "Lần đầu (giờ VN)", key: "first", width: 19 },
    { header: "Lần cuối (giờ VN)", key: "last", width: 19 },
    { header: "Nhân viên tham gia", key: "agents", width: 24, wrap: true },
    { header: "Trạng thái", key: "status", width: 11 },
    { header: "Tag", key: "tags", width: 22, wrap: true },
    { header: "Đánh giá", key: "review", width: 9 },
    { header: "Tóm tắt AI", key: "ai", width: 50, wrap: true },
    { header: "Mã hội thoại", key: "id", width: 22 },
  ];
  const singles = convs.filter((c) => !c.is_group).sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1));
  const groups = convs.filter((c) => c.is_group).sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1));
  add(
    "Khách 1-1",
    [{ header: "Khách hàng", key: "name", width: 26 }, { header: "SĐT", key: "phone", width: 13 }, { header: "Mã KH", key: "ref", width: 12 }, ...tail],
    singles.map((c) => ({ name: c.customer_name, phone: c.customer_phone ?? "", ref: c.external_ref ?? "", ...common(c) })),
  );
  add(
    "Nhóm chat",
    [{ header: "Nhóm", key: "name", width: 28 }, { header: "Số người nhắn", key: "count", width: 12 }, { header: "Thành viên đã nhắn", key: "members", width: 40, wrap: true }, ...tail],
    groups.map((c) => ({ name: c.customer_name, count: c.participants.length, members: c.participants.join(", "), ...common(c) })),
  );
  add(
    "Tin nhắn",
    [
      { header: "Loại chat", key: "type", width: 11 },
      { header: "Khách / nhóm", key: "name", width: 26 },
      { header: "Kênh", key: "channel", width: 18 },
      { header: "Thời gian (giờ VN)", key: "time", width: 19 },
      { header: "Bên", key: "side", width: 9 },
      { header: "Người gửi", key: "sender", width: 22 },
      { header: "Nội dung", key: "text", width: 70, wrap: true },
      { header: "Loại tin", key: "msgType", width: 14 },
    ],
    [...singles, ...groups].flatMap((c) =>
      c.messages.map((m) => ({ type: c.chat_type, name: c.customer_name, channel: c.channel ?? "", time: vnTime(m.time), side: m.direction === "in" ? "Khách" : "Shop", sender: m.sender ?? "", text: m.text, msgType: m.type ?? "" })),
    ),
  );
  return wb;
}
