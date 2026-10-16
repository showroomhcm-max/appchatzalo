/**
 * Số liệu công việc CSKH của từng nhân viên trong một khoảng thời gian (dùng cho app Báo cáo công việc CSKH
 * và API /api/v1/work-report). Ngày tính theo giờ Việt Nam.
 */
import { all } from "./db.js";
import { agentStats } from "./analytics.js";

const DAY = 86_400_000;

/** "YYYY-MM-DD" (giờ VN) → mốc đầu / cuối ngày. */
export function vnDayRange(from: string, to: string = from) {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(from) || !ok(to)) return null;
  const a = Date.parse(`${from}T00:00:00+07:00`);
  const b = Date.parse(`${to}T23:59:59.999+07:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return { from: a, to: b };
}

export function workReport(from: number, to: number) {
  if (to - from > 93 * DAY) throw new Error("Khoảng thời gian tối đa 93 ngày");
  const stats = agentStats({ from, to });
  const byAgent = new Map(stats.agents.filter((a) => a.agent_id !== null).map((a) => [a.agent_id, a]));
  const countBy = (sql: string) => new Map(all<{ user_id: number; n: number; total?: number }>(sql, from, to).map((r) => [r.user_id, r]));
  const notes = countBy("SELECT user_id, COUNT(*) AS n FROM notes WHERE user_id IS NOT NULL AND created_at BETWEEN ? AND ? GROUP BY user_id");
  // Đơn POS nhân viên lên từ chat (raw.input.agent.id ghi lúc tạo đơn)
  const pos = countBy(
    `SELECT CAST(json_extract(raw, '$.input.agent.id') AS INTEGER) AS user_id, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
     FROM orders WHERE source = 'odoo_pos' AND COALESCE(status, '') != 'cancel' AND created_at BETWEEN ? AND ?
     AND json_extract(raw, '$.input.agent.id') IS NOT NULL GROUP BY 1`,
  );
  // Cảnh báo đơn "rơi" nhân viên đã xử lý
  const resolved = countBy("SELECT resolved_by AS user_id, COUNT(*) AS n FROM conversation_alerts WHERE resolved_by IS NOT NULL AND resolved_at BETWEEN ? AND ? GROUP BY resolved_by");
  // Cảnh báo phát sinh trong kỳ ở hội thoại đang giao cho nhân viên, tới giờ vẫn chưa xử lý
  const openAlerts = countBy(
    `SELECT c.assigned_to AS user_id, COUNT(*) AS n FROM conversation_alerts a JOIN conversations c ON c.id = a.conversation_id
     WHERE a.resolved_at IS NULL AND c.assigned_to IS NOT NULL AND a.created_at BETWEEN ? AND ? GROUP BY c.assigned_to`,
  );
  const users = all<{ id: number; username: string; display_name: string; odoo_uid: number | null; active: number }>(
    "SELECT id, username, display_name, odoo_uid, active FROM users ORDER BY display_name",
  );
  const staff = users
    .filter((u) => u.active || byAgent.has(u.id))
    .map((u) => {
      const a = byAgent.get(u.id);
      return {
        user_id: u.id,
        email: u.username.includes("@") ? u.username : null,
        username: u.username,
        odoo_uid: u.odoo_uid,
        name: u.display_name,
        active: !!u.active,
        messages_sent: a?.messages_sent ?? 0,
        conversations: a?.conversations ?? 0,
        responses: a?.responses ?? 0,
        avg_response_sec: a?.avg_response_sec ?? null,
        median_response_sec: a?.median_response_sec ?? null,
        within_5min_pct: a?.within_5min_pct ?? null,
        review_avg: a?.review_avg ?? null,
        review_count: a?.review_count ?? 0,
        notes: notes.get(u.id)?.n ?? 0,
        pos_orders: pos.get(u.id)?.n ?? 0,
        pos_total: pos.get(u.id)?.total ?? 0,
        alerts_resolved: resolved.get(u.id)?.n ?? 0,
        alerts_open: openAlerts.get(u.id)?.n ?? 0,
      };
    });
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    customer_messages: stats.customer_messages,
    conversations_active: stats.conversations_active,
    waiting_reply_now: stats.waiting_reply,
    staff,
    // Tin gửi từ điện thoại / hệ thống (không gắn được nhân viên)
    unattributed: stats.agents.filter((a) => a.agent_id === null).map((a) => ({ name: a.agent_name, messages_sent: a.messages_sent, conversations: a.conversations })),
  };
}
