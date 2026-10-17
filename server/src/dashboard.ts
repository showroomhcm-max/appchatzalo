/**
 * Số liệu cho mục Báo cáo (biểu đồ). Ngày / giờ tính theo giờ Việt Nam.
 *  - overview: kênh CSKH chung (không gồm Zalo nhân viên đang giám sát): tin theo ngày, thời gian phản hồi,
 *    giờ cao điểm, theo kênh, tag, cảnh báo đơn "rơi", đơn hàng.
 *  - monitorOverview: Zalo nhân viên giám sát: tin, thu hồi, cờ quy tắc / AI theo ngày, điểm + rủi ro + kết quả do AI chấm.
 */
import { all } from "./db.js";
import { OUTCOMES } from "./ai-monitor.js";

const DAY = 86_400_000;
const VN = 7 * 3600e3;
const vnDay = (ms: number) => new Date(ms + VN).toISOString().slice(0, 10);

export type DashFilter = { from: number; to: number; channelId?: number; departmentId?: number };

function dayList(from: number, to: number) {
  const out: string[] = [];
  for (let d = vnDay(from); d <= vnDay(to); d = new Date(Date.parse(d + "T00:00:00Z") + DAY).toISOString().slice(0, 10)) out.push(d);
  return out;
}

export function overview(f: DashFilter) {
  if (f.to - f.from > 370 * DAY) throw new Error("Tối đa 1 năm");
  const where = ["ch.mode = 'shared'", "m.ts >= ?", "m.ts <= ?"];
  const params: any[] = [f.from, f.to];
  if (f.channelId) (where.push("c.channel_id = ?"), params.push(f.channelId));
  if (f.departmentId) (where.push("c.department_id = ?"), params.push(f.departmentId));
  const msgs = all<{ conversation_id: string; direction: "in" | "out"; source: string; ts: number; channel_id: number }>(
    `SELECT m.conversation_id, m.direction, m.source, m.ts, c.channel_id FROM messages m
     JOIN conversations c ON c.id = m.conversation_id JOIN channels ch ON ch.id = c.channel_id
     WHERE ${where.join(" AND ")} ORDER BY m.conversation_id, m.ts, m.id`,
    ...params,
  );

  const days = dayList(f.from, f.to);
  const daily = new Map(days.map((d) => [d, { day: d, msg_in: 0, msg_out: 0, customers: new Set<string>(), responses: 0, resp_sum: 0, within5: 0 }]));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const byChannel = new Map<number, { msg_in: number; msg_out: number; convs: Set<string> }>();
  let waiting: number | null = null;
  let conv = "";
  for (const m of msgs) {
    if (m.conversation_id !== conv) {
      conv = m.conversation_id;
      waiting = null;
    }
    const key = vnDay(m.ts);
    const d = daily.get(key);
    const ch = byChannel.get(m.channel_id) ?? { msg_in: 0, msg_out: 0, convs: new Set<string>() };
    byChannel.set(m.channel_id, ch);
    ch.convs.add(m.conversation_id);
    if (m.direction === "in") {
      ch.msg_in++;
      if (d) (d.msg_in++, d.customers.add(m.conversation_id));
      const t = new Date(m.ts + VN);
      heat[t.getUTCDay()][t.getUTCHours()]++;
      waiting ??= m.ts;
      continue;
    }
    if (m.source === "history") continue;
    ch.msg_out++;
    if (d) d.msg_out++;
    if (waiting !== null && d) {
      const sec = (m.ts - waiting) / 1000;
      d.responses++;
      d.resp_sum += sec;
      if (sec <= 300) d.within5++;
    }
    waiting = null;
  }

  const convWhere = ["ch.mode = 'shared'", "c.created_at >= ?", "c.created_at <= ?"];
  const convParams: any[] = [f.from, f.to];
  if (f.channelId) (convWhere.push("c.channel_id = ?"), convParams.push(f.channelId));
  if (f.departmentId) (convWhere.push("c.department_id = ?"), convParams.push(f.departmentId));
  const newConvs = new Map<string, number>();
  for (const r of all<{ created_at: number }>(`SELECT c.created_at FROM conversations c JOIN channels ch ON ch.id = c.channel_id WHERE ${convWhere.join(" AND ")}`, ...convParams)) {
    const k = vnDay(r.created_at);
    newConvs.set(k, (newConvs.get(k) ?? 0) + 1);
  }

  // Tag của các hội thoại có tin trong kỳ
  const activeConvs = [...new Set(msgs.map((m) => m.conversation_id))];
  const tagCount = new Map<string, number>();
  for (let i = 0; i < activeConvs.length; i += 500) {
    const chunk = activeConvs.slice(i, i + 500);
    for (const r of all<{ tags: string | null }>(`SELECT tags FROM conversations WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk)) {
      try {
        for (const t of JSON.parse(r.tags ?? "[]")) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      } catch {
        /* bỏ qua */
      }
    }
  }
  const tagColors = new Map(all<{ name: string; color: string }>("SELECT name, color FROM tags").map((t) => [t.name, t.color]));

  const channels = new Map(all<{ id: number; name: string; platform: string }>("SELECT id, name, platform FROM channels").map((c) => [c.id, c]));

  // Cảnh báo đơn "rơi" phát sinh trong kỳ
  const alerts = all<{ type: string; created_at: number; resolved_at: number | null; resolution: string | null }>(
    `SELECT a.type, a.created_at, a.resolved_at, a.resolution FROM conversation_alerts a JOIN conversations c ON c.id = a.conversation_id
     WHERE a.created_at >= ? AND a.created_at <= ? ${f.channelId ? "AND c.channel_id = ?" : ""} ${f.departmentId ? "AND c.department_id = ?" : ""}`,
    f.from,
    f.to,
    ...(f.channelId ? [f.channelId] : []),
    ...(f.departmentId ? [f.departmentId] : []),
  );
  const alertTypes = new Map<string, { created: number; resolved: number; resolve_sum: number }>();
  const alertDaily = new Map<string, { created: number; resolved: number }>();
  for (const a of alerts) {
    const t = alertTypes.get(a.type) ?? { created: 0, resolved: 0, resolve_sum: 0 };
    t.created++;
    if (a.resolved_at) (t.resolved++, (t.resolve_sum += (a.resolved_at - a.created_at) / 1000));
    alertTypes.set(a.type, t);
    const k = vnDay(a.created_at);
    const dd = alertDaily.get(k) ?? { created: 0, resolved: 0 };
    dd.created++;
    if (a.resolved_at) dd.resolved++;
    alertDaily.set(k, dd);
  }

  // Đơn hàng gắn với hội thoại (Sapo / API / POS từ chat)
  const orders = all<{ source: string; total: number | null; created_at: number; status: string | null }>(
    `SELECT o.source, o.total, o.created_at, o.status FROM orders o LEFT JOIN conversations c ON c.id = o.conversation_id
     WHERE o.created_at >= ? AND o.created_at <= ? AND COALESCE(o.status, '') NOT IN ('cancel', 'cancelled')
     ${f.channelId ? "AND c.channel_id = ?" : ""} ${f.departmentId ? "AND c.department_id = ?" : ""}`,
    f.from,
    f.to,
    ...(f.channelId ? [f.channelId] : []),
    ...(f.departmentId ? [f.departmentId] : []),
  );
  const orderDaily = new Map<string, { n: number; total: number }>();
  const orderSources = new Map<string, { n: number; total: number }>();
  for (const o of orders) {
    const k = vnDay(o.created_at);
    const dd = orderDaily.get(k) ?? { n: 0, total: 0 };
    dd.n++;
    dd.total += o.total ?? 0;
    orderDaily.set(k, dd);
    const s = orderSources.get(o.source) ?? { n: 0, total: 0 };
    s.n++;
    s.total += o.total ?? 0;
    orderSources.set(o.source, s);
  }

  const dailyOut = [...daily.values()].map((d) => ({
    day: d.day,
    msg_in: d.msg_in,
    msg_out: d.msg_out,
    customers: d.customers.size,
    new_conversations: newConvs.get(d.day) ?? 0,
    responses: d.responses,
    avg_response_sec: d.responses ? Math.round(d.resp_sum / d.responses) : null,
    within5_pct: d.responses ? Math.round((d.within5 / d.responses) * 100) : null,
    alerts: alertDaily.get(d.day)?.created ?? 0,
    orders: orderDaily.get(d.day)?.n ?? 0,
    order_total: orderDaily.get(d.day)?.total ?? 0,
  }));
  const allResp = dailyOut.reduce((s, d) => s + d.responses, 0);
  return {
    days: dailyOut,
    totals: {
      msg_in: dailyOut.reduce((s, d) => s + d.msg_in, 0),
      msg_out: dailyOut.reduce((s, d) => s + d.msg_out, 0),
      customers: activeConvs.length,
      new_conversations: dailyOut.reduce((s, d) => s + d.new_conversations, 0),
      avg_response_sec: allResp ? Math.round(dailyOut.reduce((s, d) => s + (d.avg_response_sec ?? 0) * d.responses, 0) / allResp) : null,
      within5_pct: allResp ? Math.round((dailyOut.reduce((s, d) => s + ((d.within5_pct ?? 0) * d.responses) / 100, 0) / allResp) * 100) : null,
      alerts: alerts.length,
      alerts_resolved: alerts.filter((a) => a.resolved_at).length,
      orders: orders.length,
      order_total: orders.reduce((s, o) => s + (o.total ?? 0), 0),
    },
    heat,
    channels: [...byChannel.entries()]
      .map(([id, c]) => ({ id, name: channels.get(id)?.name ?? `Kênh ${id}`, platform: channels.get(id)?.platform ?? "zalo", msg_in: c.msg_in, msg_out: c.msg_out, conversations: c.convs.size }))
      .sort((a, b) => b.msg_in + b.msg_out - (a.msg_in + a.msg_out)),
    tags: [...tagCount.entries()]
      .map(([name, n]) => ({ name, n, color: tagColors.get(name) ?? null }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 12),
    alerts: [...alertTypes.entries()].map(([type, t]) => ({ type, created: t.created, resolved: t.resolved, avg_resolve_sec: t.resolved ? Math.round(t.resolve_sum / t.resolved) : null })),
    order_sources: [...orderSources.entries()].map(([source, s]) => ({ source, ...s })).sort((a, b) => b.n - a.n),
  };
}

export function monitorOverview(from: number, to: number, channelId?: number) {
  if (to - from > 370 * DAY) throw new Error("Tối đa 1 năm");
  const chans = all<{ id: number; name: string; holder: string | null; phone: string | null }>(
    `SELECT ch.id, ch.name, u.display_name AS holder, a.phone FROM channels ch LEFT JOIN channel_assets a ON a.channel_id = ch.id
     LEFT JOIN users u ON u.id = a.holder_id WHERE ch.mode = 'monitor' ${channelId ? "AND ch.id = ?" : ""} ORDER BY ch.name`,
    ...(channelId ? [channelId] : []),
  );
  const ids = chans.map((c) => c.id);
  const days = dayList(from, to);
  if (!ids.length) return { days: days.map((day) => ({ day, msg_in: 0, msg_out: 0, undone: 0, flags_rule: 0, flags_ai: 0 })), staff: [], risk: [], outcomes: [], issue_types: [] };
  const inIds = `(${ids.map(() => "?").join(",")})`;
  const msgs = all<{ channel_id: number; direction: string; undone: number; ts: number; conversation_id: string }>(
    `SELECT c.channel_id, m.direction, m.undone, m.ts, m.conversation_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.channel_id IN ${inIds} AND m.ts >= ? AND m.ts <= ?`,
    ...ids,
    from,
    to,
  );
  const flags = all<{ channel_id: number; source: string; severity: string | null; ts: number }>(
    `SELECT f.channel_id, f.source, f.severity, m.ts FROM monitor_flags f JOIN messages m ON m.id = f.message_id
     WHERE f.channel_id IN ${inIds} AND m.ts >= ? AND m.ts <= ?`,
    ...ids,
    from,
    to,
  );
  const ai = all<{ channel_id: number; risk: string; quality_score: number | null; outcome: string | null; issues: string }>(
    `SELECT x.channel_id, x.risk, x.quality_score, x.outcome, x.issues FROM ai_conv_analysis x JOIN messages m ON m.id = x.last_message_id
     WHERE x.channel_id IN ${inIds} AND m.ts >= ? AND m.ts <= ?`,
    ...ids,
    from,
    to,
  );
  const daily = new Map(days.map((d) => [d, { day: d, msg_in: 0, msg_out: 0, undone: 0, flags_rule: 0, flags_ai: 0 }]));
  const staff = new Map(
    chans.map((c) => [c.id, { channel_id: c.id, name: c.holder ?? c.name, phone: c.phone, customers: new Set<string>(), msg_in: 0, msg_out: 0, undone: 0, flags_rule: 0, flags_ai: 0, flags_high: 0, scores: [] as number[], risk_high: 0 }]),
  );
  for (const m of msgs) {
    const d = daily.get(vnDay(m.ts));
    const s = staff.get(m.channel_id)!;
    s.customers.add(m.conversation_id);
    if (m.direction === "in") (s.msg_in++, d && d.msg_in++);
    else {
      s.msg_out++;
      if (d) d.msg_out++;
      if (m.undone) (s.undone++, d && d.undone++);
    }
  }
  for (const fl of flags) {
    const d = daily.get(vnDay(fl.ts));
    const s = staff.get(fl.channel_id)!;
    if (fl.source === "ai") (s.flags_ai++, d && d.flags_ai++);
    else (s.flags_rule++, d && d.flags_rule++);
    if (fl.severity === "high") s.flags_high++;
  }
  const risk = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const issueTypes = new Map<string, number>();
  for (const x of ai) {
    const s = staff.get(x.channel_id)!;
    if (x.quality_score != null) s.scores.push(x.quality_score);
    if (x.risk === "high") s.risk_high++;
    risk.set(x.risk, (risk.get(x.risk) ?? 0) + 1);
    if (x.outcome) outcomes.set(x.outcome, (outcomes.get(x.outcome) ?? 0) + 1);
    try {
      for (const i of JSON.parse(x.issues)) issueTypes.set(i.type, (issueTypes.get(i.type) ?? 0) + 1);
    } catch {
      /* bỏ qua */
    }
  }
  return {
    days: [...daily.values()],
    staff: [...staff.values()].map(({ customers, scores, ...s }) => ({ ...s, customers: customers.size, ai_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null, ai_rated: scores.length })),
    risk: ["none", "low", "medium", "high"].map((k) => ({ risk: k, n: risk.get(k) ?? 0 })),
    outcomes: [...outcomes.entries()].map(([k, n]) => ({ outcome: k, label: OUTCOMES[k] ?? k, n })).sort((a, b) => b.n - a.n),
    issue_types: [...issueTypes.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n),
  };
}
