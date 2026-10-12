/**
 * Cảnh báo đơn "rơi": tự phát hiện hội thoại / đơn hàng có nguy cơ bị bỏ sót.
 * - Chưa phản hồi: khách nhắn cuối mà quá X phút chưa ai trả lời.
 * - Chưa tạo đơn: khách đã để lại số điện thoại / địa chỉ / từ khóa mua hàng mà quá X phút chưa có đơn gắn với hội thoại.
 * - Chưa đẩy vận chuyển: hội thoại có đơn (từ Sapo / API) nhưng quá X phút đơn chưa giao cho đơn vị vận chuyển.
 * Quét mỗi phút; cảnh báo tự đóng khi điều kiện hết (đã trả lời, đã có đơn, đã giao vận chuyển) hoặc nhân viên bấm "Đã xử lý".
 */
import { all, db, get, getSetting, logEvent, run, setSetting } from "./db.js";
import { bus } from "./bus.js";
import { fold } from "./text.js";
import { conversationFilter, type Scope } from "./access.js";

db.exec(`
CREATE TABLE IF NOT EXISTS conversation_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER,
  resolution TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_open ON conversation_alerts(conversation_id, type) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_conv ON conversation_alerts(conversation_id);

-- Dấu hiệu khách tiềm năng nhận ra từ tin khách gửi
CREATE TABLE IF NOT EXISTS conversation_signals (
  conversation_id TEXT PRIMARY KEY,
  phone TEXT,
  phone_at INTEGER,
  address_at INTEGER,
  keyword TEXT,
  keyword_at INTEGER
);

-- Đơn hàng gắn với hội thoại (Sapo POS hoặc hệ thống khác đẩy vào qua API)
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  code TEXT,
  conversation_id TEXT,
  customer_phone TEXT,
  customer_name TEXT,
  status TEXT,
  fulfillment_status TEXT,
  total REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  raw TEXT,
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_conv ON orders(conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
`);

export type AlertType = "no_reply" | "no_order" | "no_shipping";
export const ALERT_LABEL: Record<AlertType, string> = {
  no_reply: "Chưa phản hồi",
  no_order: "Chưa tạo đơn",
  no_shipping: "Chưa đẩy vận chuyển",
};

export type AlertConfig = {
  noReply: { enabled: boolean; minutes: number };
  noOrder: { enabled: boolean; minutes: number; phone: boolean; address: boolean; keyword: boolean; keywords: string[] };
  noShipping: { enabled: boolean; minutes: number };
  updatedBy?: string | null;
  updatedAt?: number | null;
};

const DEFAULT_CONFIG: AlertConfig = {
  noReply: { enabled: false, minutes: 60 },
  noOrder: { enabled: true, minutes: 60, phone: true, address: true, keyword: false, keywords: ["chốt đơn", "đặt hàng", "lấy cái này", "ship cho em", "mua"] },
  noShipping: { enabled: false, minutes: 240 },
};

export function alertConfig(): AlertConfig {
  const c = getSetting<Partial<AlertConfig>>("alerts.config") ?? {};
  return {
    noReply: { ...DEFAULT_CONFIG.noReply, ...c.noReply },
    noOrder: { ...DEFAULT_CONFIG.noOrder, ...c.noOrder },
    noShipping: { ...DEFAULT_CONFIG.noShipping, ...c.noShipping },
    updatedBy: c.updatedBy ?? null,
    updatedAt: c.updatedAt ?? null,
  };
}

const minutes = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 && n <= 7 * 24 * 60 ? n : fallback;
};

export function saveAlertConfig(input: any, by: { id: number; display_name: string }) {
  const cur = alertConfig();
  const next: AlertConfig = {
    noReply: { enabled: !!(input?.noReply?.enabled ?? cur.noReply.enabled), minutes: minutes(input?.noReply?.minutes, cur.noReply.minutes) },
    noOrder: {
      enabled: !!(input?.noOrder?.enabled ?? cur.noOrder.enabled),
      minutes: minutes(input?.noOrder?.minutes, cur.noOrder.minutes),
      phone: !!(input?.noOrder?.phone ?? cur.noOrder.phone),
      address: !!(input?.noOrder?.address ?? cur.noOrder.address),
      keyword: !!(input?.noOrder?.keyword ?? cur.noOrder.keyword),
      keywords: Array.isArray(input?.noOrder?.keywords)
        ? [...new Set(input.noOrder.keywords.map((k: unknown) => String(k).trim()).filter((k: string) => k.length >= 2 && k.length <= 60))].slice(0, 50) as string[]
        : cur.noOrder.keywords,
    },
    noShipping: { enabled: !!(input?.noShipping?.enabled ?? cur.noShipping.enabled), minutes: minutes(input?.noShipping?.minutes, cur.noShipping.minutes) },
    updatedBy: by.display_name,
    updatedAt: Date.now(),
  };
  setSetting("alerts.config", next);
  logEvent(null, by.id, "alerts.config", next);
  // Tắt loại nào thì đóng các cảnh báo đang mở của loại đó
  if (!next.noReply.enabled) closeAllOfType("no_reply");
  if (!next.noOrder.enabled) closeAllOfType("no_order");
  if (!next.noShipping.enabled) closeAllOfType("no_shipping");
  void scan();
  return next;
}

// ───────────── Nhận diện dấu hiệu trong tin khách gửi ─────────────

/** Số di động Việt Nam trong đoạn chữ (bỏ khoảng trắng, dấu chấm, gạch giữa các chữ số). */
export function detectPhone(text: string) {
  const compact = text.replace(/(\d)[\s.\-]+(?=\d)/g, "$1");
  const m = /(?:\+?84|0)([35789]\d{8})(?!\d)/.exec(compact);
  return m ? `0${m[1]}` : null;
}

const ADMIN_WORDS = ["phuong", "quan", "huyen", "xa", "thi tran", "thi xa", "tinh", "thanh pho", "tp", "khu pho", "ap", "thon", "duong", "hem", "ngo", "ngach", "kiet", "so nha", "chung cu", "toa"];
/** Có vẻ là địa chỉ giao hàng: "địa chỉ: …" hoặc số nhà + ít nhất 2 cấp hành chính (đường, phường, quận…). */
export function detectAddress(text: string) {
  const t = ` ${fold(text).replace(/[.,;:/\\()-]/g, " ")} `;
  if (/\bdia chi\b.{10,}/.test(t) || /\bdc\s*:?\s*\d/.test(t)) return true;
  const hits = ADMIN_WORDS.filter((w) => t.includes(` ${w} `)).length;
  return hits >= 2 && /\d/.test(t);
}

export function detectKeyword(text: string, keywords: string[]) {
  const t = fold(text);
  return keywords.find((k) => t.includes(fold(k))) ?? null;
}

const isMonitored = (channelId: number) => get<{ mode: string }>("SELECT mode FROM channels WHERE id = ?", channelId)?.mode === "monitor";

function onCustomerMessage(message: any, conversation: any) {
  if (message.direction !== "in" || message.source === "history" || !message.text) return;
  if (isMonitored(conversation.channel_id)) return;
  const text = String(message.text);
  const now = message.ts ?? Date.now();
  const cfg = alertConfig();
  const phone = detectPhone(text);
  const address = detectAddress(text);
  const keyword = cfg.noOrder.keyword ? detectKeyword(text, cfg.noOrder.keywords) : null;
  if (!phone && !address && !keyword) return;
  run("INSERT OR IGNORE INTO conversation_signals(conversation_id) VALUES(?)", conversation.id);
  if (phone) {
    run("UPDATE conversation_signals SET phone = ?, phone_at = COALESCE(phone_at, ?) WHERE conversation_id = ?", phone, now, conversation.id);
    // Lưu số điện thoại vào hội thoại (để tra / ghép đơn Sapo theo số)
    run("UPDATE conversations SET phone = COALESCE(phone, ?) WHERE id = ?", phone, conversation.id);
  }
  if (address) run("UPDATE conversation_signals SET address_at = COALESCE(address_at, ?) WHERE conversation_id = ?", now, conversation.id);
  if (keyword) run("UPDATE conversation_signals SET keyword = ?, keyword_at = COALESCE(keyword_at, ?) WHERE conversation_id = ?", keyword, now, conversation.id);
}

// ───────────── Mở / đóng cảnh báo ─────────────

let changed = false;

function openAlert(conversationId: string, type: AlertType, detail: Record<string, unknown>) {
  const r = run(
    "INSERT OR IGNORE INTO conversation_alerts(conversation_id, type, detail, created_at) VALUES(?, ?, ?, ?)",
    conversationId,
    type,
    JSON.stringify(detail),
    Date.now(),
  );
  if (r.changes) {
    changed = true;
    bus.emit("alert.created", { id: Number(r.lastInsertRowid), conversation_id: conversationId, type, label: ALERT_LABEL[type], detail });
  }
}

function closeAlerts(type: AlertType, conversationIds: string[], resolution: string) {
  for (const id of conversationIds) {
    const r = run(
      "UPDATE conversation_alerts SET resolved_at = ?, resolution = ? WHERE conversation_id = ? AND type = ? AND resolved_at IS NULL",
      Date.now(),
      resolution,
      id,
      type,
    );
    if (r.changes) changed = true;
  }
}

function closeAllOfType(type: AlertType) {
  const r = run("UPDATE conversation_alerts SET resolved_at = ?, resolution = 'tắt cảnh báo' WHERE type = ? AND resolved_at IS NULL", Date.now(), type);
  if (r.changes) bus.emit("alerts.changed");
}

/** Nhân viên bấm "Đã xử lý": đóng cảnh báo, không mở lại cho cùng dấu hiệu đó nữa. */
export function resolveAlert(id: number, userId: number, note?: string) {
  const a = get<{ conversation_id: string; type: AlertType }>("SELECT conversation_id, type FROM conversation_alerts WHERE id = ? AND resolved_at IS NULL", id);
  if (!a) return false;
  run("UPDATE conversation_alerts SET resolved_at = ?, resolved_by = ?, resolution = ? WHERE id = ?", Date.now(), userId, note?.slice(0, 300) || "đã xử lý", id);
  logEvent(a.conversation_id, userId, "alert.resolved", { type: a.type, note });
  bus.emit("alerts.changed");
  return true;
}

/** Đã có cảnh báo cùng loại được nhân viên đóng tay sau mốc này thì không mở lại. */
const dismissedSince = (conversationId: string, type: AlertType, since: number) =>
  !!get(
    "SELECT 1 FROM conversation_alerts WHERE conversation_id = ? AND type = ? AND resolved_by IS NOT NULL AND resolved_at >= ? LIMIT 1",
    conversationId,
    type,
    since,
  );

const WINDOW = 7 * 24 * 3600_000;

export async function scan() {
  const cfg = alertConfig();
  const now = Date.now();
  changed = false;

  // 1. Chưa phản hồi
  if (cfg.noReply.enabled) {
    const late = all<{ id: string; last_message_at: number }>(
      `SELECT id, last_message_at FROM conversations
       WHERE status != 'closed' AND last_direction = 'in' AND last_message_at BETWEEN ? AND ?
         AND channel_id NOT IN (SELECT id FROM channels WHERE mode = 'monitor')`,
      now - WINDOW,
      now - cfg.noReply.minutes * 60_000,
    );
    for (const c of late) if (!dismissedSince(c.id, "no_reply", c.last_message_at)) openAlert(c.id, "no_reply", { since: c.last_message_at });
    const done = all<{ conversation_id: string }>(
      `SELECT a.conversation_id FROM conversation_alerts a JOIN conversations c ON c.id = a.conversation_id
       WHERE a.type = 'no_reply' AND a.resolved_at IS NULL AND (c.last_direction = 'out' OR c.status = 'closed')`,
    ).map((r) => r.conversation_id);
    closeAlerts("no_reply", done, "đã trả lời");
  }

  // 2. Chưa tạo đơn
  if (cfg.noOrder.enabled) {
    const conds: string[] = [];
    if (cfg.noOrder.phone) conds.push("s.phone_at IS NOT NULL AND s.phone_at <= @cut");
    if (cfg.noOrder.address) conds.push("s.address_at IS NOT NULL AND s.address_at <= @cut");
    if (cfg.noOrder.keyword) conds.push("s.keyword_at IS NOT NULL AND s.keyword_at <= @cut");
    if (conds.length) {
      const cut = now - cfg.noOrder.minutes * 60_000;
      const rows = db
        .prepare(
          `SELECT s.*, c.last_message_at FROM conversation_signals s JOIN conversations c ON c.id = s.conversation_id
           WHERE c.last_message_at >= @since AND (${conds.map((x) => `(${x})`).join(" OR ")})
             AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = s.conversation_id)`,
        )
        .all({ cut, since: now - WINDOW }) as any[];
      for (const s of rows) {
        const first = Math.min(...[s.phone_at, s.address_at, s.keyword_at].filter(Boolean));
        if (dismissedSince(s.conversation_id, "no_order", first)) continue;
        openAlert(s.conversation_id, "no_order", {
          phone: cfg.noOrder.phone ? s.phone : null,
          address: cfg.noOrder.address && !!s.address_at,
          keyword: cfg.noOrder.keyword ? s.keyword : null,
          since: first,
        });
      }
    }
    const withOrder = all<{ conversation_id: string }>(
      `SELECT a.conversation_id FROM conversation_alerts a
       WHERE a.type = 'no_order' AND a.resolved_at IS NULL AND EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = a.conversation_id)`,
    ).map((r) => r.conversation_id);
    closeAlerts("no_order", withOrder, "đã có đơn");
  }

  // 3. Chưa đẩy vận chuyển (cần đơn hàng từ Sapo / API)
  if (cfg.noShipping.enabled) {
    const pending = all<{ conversation_id: string; code: string; created_at: number }>(
      `SELECT conversation_id, code, created_at FROM orders
       WHERE conversation_id IS NOT NULL AND created_at BETWEEN ? AND ?
         AND COALESCE(status, '') NOT IN ('cancelled', 'canceled', 'closed')
         AND COALESCE(fulfillment_status, '') IN ('', 'unshipped', 'pending', 'unfulfilled', 'partial')`,
      now - WINDOW,
      now - cfg.noShipping.minutes * 60_000,
    );
    for (const o of pending) if (!dismissedSince(o.conversation_id, "no_shipping", o.created_at)) openAlert(o.conversation_id, "no_shipping", { order: o.code, since: o.created_at });
    const shipped = all<{ conversation_id: string }>(
      `SELECT a.conversation_id FROM conversation_alerts a
       WHERE a.type = 'no_shipping' AND a.resolved_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM orders o WHERE o.conversation_id = a.conversation_id
           AND COALESCE(o.status, '') NOT IN ('cancelled', 'canceled', 'closed')
           AND COALESCE(o.fulfillment_status, '') IN ('', 'unshipped', 'pending', 'unfulfilled', 'partial'))`,
    ).map((r) => r.conversation_id);
    closeAlerts("no_shipping", shipped, "đã giao vận chuyển");
  }

  if (changed) bus.emit("alerts.changed");
}

/** Cảnh báo đang mở trong phạm vi người này được xem. */
export function listAlerts(access: Scope) {
  return all<any>(
    `SELECT a.id, a.conversation_id, a.type, a.detail, a.created_at,
            c.name AS conversation_name, c.avatar AS conversation_avatar, c.channel_id, c.assigned_to, u.display_name AS assigned_name,
            ch.name AS channel_name, ch.platform AS platform
     FROM conversation_alerts a
     JOIN conversations c ON c.id = a.conversation_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN users u ON u.id = c.assigned_to
     WHERE a.resolved_at IS NULL AND ${conversationFilter(access)}
     ORDER BY a.created_at DESC LIMIT 500`,
  ).map((a) => ({ ...a, label: ALERT_LABEL[a.type as AlertType], detail: a.detail ? JSON.parse(a.detail) : null }));
}

export function startAlerts() {
  bus.on("message.created", (message, conversation) => {
    try {
      onCustomerMessage(message, conversation);
    } catch (e) {
      console.error("[alerts] Nhận diện tin lỗi:", e);
    }
  });
  const tick = () => scan().catch((e) => console.error("[alerts] Quét cảnh báo lỗi:", e));
  // Có đơn mới → đóng / mở cảnh báo ngay, không chờ lượt quét
  bus.on("order.updated", () => void tick());
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
