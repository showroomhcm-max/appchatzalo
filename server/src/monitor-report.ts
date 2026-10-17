/**
 * Báo cáo giám sát Zalo nhân viên (Excel): theo khoảng ngày, một hoặc mọi nhân viên.
 *  1. Tổng hợp theo ngày: số khách, tin khách / nhân viên, tin thu hồi, cờ quy tắc / AI, điểm AI, tổng hợp AI cuối ngày.
 *  2. Tin cần chú ý: từng tin bị gắn cờ, nguồn (AI / quy tắc), mức, giải thích, đã xem chưa.
 *  3. Hội thoại: từng khách trong kỳ, kết quả + điểm + tóm tắt AI.
 */
import ExcelJS from "exceljs";
import { all } from "./db.js";
import { ISSUE_TYPES, OUTCOMES } from "./ai-monitor.js";

const DAY = 86_400_000;
const VN_DATE = "strftime('%Y-%m-%d', (m.ts / 1000) + 25200, 'unixepoch')";
const dmy = (d: string) => d.split("-").reverse().join("/");
const time = (ms: number | null) => (ms ? new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ").replace(/^(\d{4})-(\d\d)-(\d\d)/, "$3/$2/$1") : "");
const RISK: Record<string, string> = { none: "Bình thường", low: "Thấp", medium: "Vừa", high: "Cao" };
const SEV: Record<string, string> = { low: "Nhỏ", medium: "Vừa", high: "Cao" };

export class ReportRangeError extends Error {}
export function vnRange(from: string, to: string) {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(from) || !ok(to) || to < from) throw new ReportRangeError("Khoảng ngày không hợp lệ");
  const a = Date.parse(`${from}T00:00:00+07:00`);
  const b = Date.parse(`${to}T00:00:00+07:00`) + DAY;
  if (b - a > 93 * DAY) throw new ReportRangeError("Tối đa 93 ngày mỗi lần xuất");
  return { a, b };
}

function sheet(wb: ExcelJS.Workbook, name: string, cols: { header: string; key: string; width: number; wrap?: boolean }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A804A" } };
  head.alignment = { vertical: "middle", wrapText: true };
  rows.forEach((r) => ws.addRow(r));
  cols.forEach((c) => (ws.getColumn(c.key).alignment = { vertical: "top", wrapText: !!c.wrap }));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

export async function monitorReport(from: string, to: string, channelId?: number) {
  const { a, b } = vnRange(from, to);
  const chFilter = channelId ? "AND c.channel_id = ?" : "";
  const chArgs = channelId ? [channelId] : [];

  // 1. Tổng hợp theo ngày × nhân viên
  const days = all<any>(
    `SELECT ${VN_DATE} AS day, c.channel_id, ch.name AS channel_name, a.phone,
            MAX(m.holder_id) AS holder_id, COALESCE(hu.display_name, ch.name) AS current_holder,
            COUNT(DISTINCT m.conversation_id) AS customers, SUM(m.direction = 'in') AS msg_in, SUM(m.direction = 'out') AS msg_out,
            SUM(m.direction = 'out' AND m.undone = 1) AS undone
     FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN channel_assets a ON a.channel_id = ch.id LEFT JOIN users hu ON hu.id = a.holder_id
     WHERE ch.mode = 'monitor' AND m.ts >= ? AND m.ts < ? ${chFilter}
     GROUP BY day, c.channel_id`,
    a,
    b,
    ...chArgs,
  );
  const flagCount = (source: string) =>
    new Map(
      all<{ k: string; n: number }>(
        `SELECT ${VN_DATE} || '|' || f.channel_id AS k, COUNT(*) AS n FROM monitor_flags f JOIN messages m ON m.id = f.message_id JOIN conversations c ON c.id = f.conversation_id
         WHERE f.source = ? AND m.ts >= ? AND m.ts < ? ${chFilter} GROUP BY k`,
        source,
        a,
        b,
        ...chArgs,
      ).map((r) => [r.k, r.n]),
    );
  const ruleFlags = flagCount("rule");
  const aiFlags = flagCount("ai");
  // Điểm / rủi ro AI theo ngày của tin cuối hội thoại được chấm
  const aiDay = new Map(
    all<{ k: string; score: number | null; high: number }>(
      `SELECT ${VN_DATE} || '|' || x.channel_id AS k, ROUND(AVG(x.quality_score), 1) AS score, SUM(x.risk = 'high') AS high
       FROM ai_conv_analysis x JOIN messages m ON m.id = x.last_message_id JOIN conversations c ON c.id = x.conversation_id
       WHERE m.ts >= ? AND m.ts < ? ${chFilter} GROUP BY k`,
      a,
      b,
      ...chArgs,
    ).map((r) => [r.k, r]),
  );
  const digests = new Map(
    all<{ k: string; content: string }>(`SELECT date || '|' || channel_id AS k, content FROM ai_digests WHERE date >= ? AND date <= ?`, from, to).map((r) => [r.k, JSON.parse(r.content)]),
  );
  const userNames = new Map(all<{ id: number; display_name: string }>("SELECT id, display_name FROM users").map((u) => [u.id, u.display_name]));
  for (const d of days) d.holder = (d.holder_id && userNames.get(d.holder_id)) || d.current_holder;
  days.sort((x, y) => (x.day === y.day ? String(x.holder).localeCompare(String(y.holder), "vi") : x.day < y.day ? -1 : 1));
  const summaryRows = days.map((d) => {
    const k = `${d.day}|${d.channel_id}`;
    const dg = digests.get(k);
    const ai = aiDay.get(k);
    return {
      day: dmy(d.day),
      holder: d.holder,
      zalo: d.phone ? `${d.channel_name} (${d.phone})` : d.channel_name,
      customers: d.customers,
      msg_in: d.msg_in,
      msg_out: d.msg_out,
      undone: d.undone,
      rule: ruleFlags.get(k) ?? 0,
      ai: aiFlags.get(k) ?? 0,
      high: ai?.high ?? 0,
      score: dg?.score ?? ai?.score ?? "",
      overview: dg?.overview ?? "",
      concerns: (dg?.concerns ?? []).map((c: any) => `[${SEV[c.severity] ?? c.severity}] ${c.title}${c.customer ? ` (${c.customer})` : ""}: ${c.detail}`).join("\n"),
      coaching: (dg?.coaching ?? []).join("\n"),
    };
  });

  // 2. Tin cần chú ý
  const flags = all<any>(
    `SELECT f.reason, f.source, f.severity, f.detail, f.reviewed_at, ru.display_name AS reviewer, m.ts, m.text, m.direction, m.undone,
            c.name AS customer, c.phone AS customer_phone, ch.name AS channel_name,
            COALESCE(hm.display_name, hu.display_name, ch.name) AS holder
     FROM monitor_flags f JOIN messages m ON m.id = f.message_id JOIN conversations c ON c.id = f.conversation_id JOIN channels ch ON ch.id = f.channel_id
     LEFT JOIN users ru ON ru.id = f.reviewed_by LEFT JOIN users hm ON hm.id = m.holder_id
     LEFT JOIN channel_assets ca ON ca.channel_id = ch.id LEFT JOIN users hu ON hu.id = ca.holder_id
     WHERE m.ts >= ? AND m.ts < ? ${chFilter}
     ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, m.ts`,
    a,
    b,
    ...chArgs,
  ).map((f) => ({
    time: time(f.ts),
    holder: f.holder,
    customer: [f.customer, f.customer_phone].filter(Boolean).join(" · ") || "Khách",
    source: f.source === "ai" ? "AI" : "Quy tắc",
    severity: f.severity ? SEV[f.severity] : "",
    reason: String(f.reason).replace(/^AI · /, ""),
    who: f.direction === "out" ? "Nhân viên" : "Khách",
    text: f.text ?? "",
    undone: f.undone ? "Đã thu hồi" : "",
    detail: f.detail ?? "",
    status: f.reviewed_at ? `Đã xem${f.reviewer ? ` (${f.reviewer})` : ""} ${time(f.reviewed_at)}` : "Chưa xem",
  }));

  // 3. Hội thoại trong kỳ
  const convs = all<any>(
    `SELECT c.id, c.name, c.phone, ch.name AS channel_name, COALESCE(hu.display_name, ch.name) AS holder,
            COUNT(m.id) AS msgs, SUM(m.direction = 'in') AS msg_in, SUM(m.direction = 'out') AS msg_out, MAX(m.ts) AS last_ts,
            x.outcome, x.quality_score, x.risk, x.summary, x.customer_need, x.issues
     FROM conversations c JOIN channels ch ON ch.id = c.channel_id JOIN messages m ON m.conversation_id = c.id
     LEFT JOIN channel_assets ca ON ca.channel_id = ch.id LEFT JOIN users hu ON hu.id = ca.holder_id
     LEFT JOIN ai_conv_analysis x ON x.conversation_id = c.id
     WHERE ch.mode = 'monitor' AND m.ts >= ? AND m.ts < ? ${chFilter}
     GROUP BY c.id ORDER BY holder, last_ts DESC`,
    a,
    b,
    ...chArgs,
  ).map((c) => ({
    holder: c.holder,
    customer: c.name ?? "Khách",
    phone: c.phone ?? "",
    msgs: `${c.msg_in} khách / ${c.msg_out} NV`,
    last: time(c.last_ts),
    outcome: c.outcome ? OUTCOMES[c.outcome] ?? c.outcome : "",
    score: c.quality_score ?? "",
    risk: c.risk ? RISK[c.risk] : "Chưa chấm",
    need: c.customer_need ?? "",
    summary: c.summary ?? "",
    issues: c.issues
      ? JSON.parse(c.issues)
          .map((i: any) => `[${SEV[i.severity] ?? i.severity}] ${ISSUE_TYPES[i.type] ?? i.type}: ${i.explanation}`)
          .join("\n")
      : "",
  }));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Chat Siêu Tốc";
  sheet(
    wb,
    "Tổng hợp theo ngày",
    [
      { header: "Ngày", key: "day", width: 12 },
      { header: "Nhân viên", key: "holder", width: 24 },
      { header: "Zalo", key: "zalo", width: 24 },
      { header: "Số khách", key: "customers", width: 10 },
      { header: "Tin khách", key: "msg_in", width: 10 },
      { header: "Tin nhân viên", key: "msg_out", width: 12 },
      { header: "Tin NV thu hồi", key: "undone", width: 12 },
      { header: "Cờ quy tắc", key: "rule", width: 11 },
      { header: "Cờ AI", key: "ai", width: 9 },
      { header: "Hội thoại rủi ro cao", key: "high", width: 13 },
      { header: "Điểm AI", key: "score", width: 9 },
      { header: "Tổng quan (AI)", key: "overview", width: 60, wrap: true },
      { header: "Cần chú ý (AI)", key: "concerns", width: 60, wrap: true },
      { header: "Góp ý huấn luyện (AI)", key: "coaching", width: 50, wrap: true },
    ],
    summaryRows,
  );
  sheet(
    wb,
    "Tin cần chú ý",
    [
      { header: "Thời gian", key: "time", width: 17 },
      { header: "Nhân viên", key: "holder", width: 22 },
      { header: "Khách", key: "customer", width: 26 },
      { header: "Nguồn", key: "source", width: 9 },
      { header: "Mức", key: "severity", width: 8 },
      { header: "Lý do", key: "reason", width: 30, wrap: true },
      { header: "Người gửi", key: "who", width: 11 },
      { header: "Nội dung tin", key: "text", width: 60, wrap: true },
      { header: "Thu hồi", key: "undone", width: 11 },
      { header: "Giải thích (AI)", key: "detail", width: 50, wrap: true },
      { header: "Trạng thái", key: "status", width: 28, wrap: true },
    ],
    flags,
  );
  sheet(
    wb,
    "Hội thoại",
    [
      { header: "Nhân viên", key: "holder", width: 22 },
      { header: "Khách", key: "customer", width: 26 },
      { header: "SĐT", key: "phone", width: 13 },
      { header: "Số tin trong kỳ", key: "msgs", width: 18 },
      { header: "Tin cuối", key: "last", width: 17 },
      { header: "Kết quả (AI)", key: "outcome", width: 18 },
      { header: "Điểm AI", key: "score", width: 9 },
      { header: "Rủi ro (AI)", key: "risk", width: 11 },
      { header: "Nhu cầu khách (AI)", key: "need", width: 30, wrap: true },
      { header: "Tóm tắt (AI)", key: "summary", width: 60, wrap: true },
      { header: "Vấn đề (AI)", key: "issues", width: 60, wrap: true },
    ],
    convs,
  );
  return { wb, counts: { days: summaryRows.length, flags: flags.length, conversations: convs.length } };
}
