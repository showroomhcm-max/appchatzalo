import { all, type Row } from "./db.js";

export type ExportFilter = {
  from?: number;
  to?: number;
  agentId?: number;
  conversationId?: string;
  /** Bỏ qua tin hệ thống/sticker khi xuất cho training. */
  textOnly?: boolean;
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
      `SELECT c.id, c.name, c.type, c.status, c.tags, c.external_ref, u.display_name AS assigned_name
       FROM conversations c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id IN (${placeholders})`,
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
    return {
      conversation_id: id,
      customer_name: customerName,
      external_ref: c?.external_ref ?? null,
      is_group: c?.type === 1,
      status: c?.status,
      tags: JSON.parse(c?.tags ?? "[]"),
      assigned_to: c?.assigned_name ?? null,
      agents: [...new Set(list.filter((m) => m.agent_name).map((m) => m.agent_name))],
      started_at: new Date(list[0].ts).toISOString(),
      ended_at: new Date(list[list.length - 1].ts).toISOString(),
      messages: list.map((m) => ({
        time: new Date(m.ts).toISOString(),
        role: speaker(m),
        speaker: speakerLabel(m, customerName),
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
  const header = ["conversation_id", "khach_hang", "thoi_gian", "vai_tro", "nguoi_noi", "nhan_vien", "loai", "noi_dung"];
  const lines = [header.join(",")];
  for (const c of convs) {
    for (const m of c.messages) {
      lines.push(
        [c.conversation_id, c.customer_name, vnTime(m.time), m.role, m.speaker, m.agent ?? "", m.type ?? "", m.text]
          .map(csvCell)
          .join(","),
      );
    }
  }
  // BOM để Excel đọc đúng tiếng Việt.
  return "﻿" + lines.join("\r\n");
}

export function toTxt(convs: ReturnType<typeof buildConversations>) {
  return convs
    .map((c) => {
      const head = [
        `=== Hội thoại với ${c.customer_name} (${c.conversation_id}) ===`,
        `Nhân viên tham gia: ${c.agents.join(", ") || "—"} | Trạng thái: ${c.status} | Nhãn: ${c.tags.join(", ") || "—"}`,
        `Thời gian: ${vnTime(c.started_at)} → ${vnTime(c.ended_at)} (giờ VN)`,
      ];
      const body = c.messages.map((m) => `[${vnTime(m.time)}] ${m.speaker}: ${m.text}`);
      const extra = [
        ...c.notes.map((n) => `  [Ghi chú] (${n.author}): ${n.content}`),
        ...c.reviews.map((r) => `  [Đánh giá] ${r.score}/5 cho ${r.agent ?? "—"} bởi ${r.reviewer}: ${r.comment ?? ""}`),
      ];
      return [...head, "", ...body, ...(extra.length ? ["", ...extra] : [])].join("\n");
    })
    .join("\n\n");
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
  const msgs = loadMessages({ from: f.from, to: f.to });
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
