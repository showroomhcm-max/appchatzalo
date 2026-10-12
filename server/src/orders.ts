/**
 * Đơn hàng gắn với hội thoại. Nguồn: Sapo POS (webhook, sẽ bật sau) hoặc hệ thống khác đẩy vào qua API /api/v1/orders.
 * Đơn tự ghép vào hội thoại theo số điện thoại khách (hội thoại gần nhất có cùng số).
 * Dùng cho cảnh báo "chưa tạo đơn" / "chưa đẩy vận chuyển" và hiện đơn trong khung thông tin khách.
 */
import crypto from "node:crypto";
import { all, get, getSetting, logEvent, run, setSetting } from "./db.js";
import { bus } from "./bus.js";
import { fetchJson } from "./platforms/common.js";

export type OrderInput = {
  source: string;
  external_id: string;
  code?: string | null;
  conversation_id?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  status?: string | null;
  fulfillment_status?: string | null;
  total?: number | null;
  created_at?: number | null;
  raw?: unknown;
};

/** "+84 909 123 456" → "0909123456" */
export function normalizeOrderPhone(p: unknown) {
  const d = String(p ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("84") && d.length === 11) return `0${d.slice(2)}`;
  return d.length >= 9 ? d : null;
}

/** Hội thoại gần nhất của khách có số điện thoại này. */
export function conversationForPhone(phone: string) {
  return (
    get<{ id: string }>(
      `SELECT c.id FROM conversations c
       LEFT JOIN conversation_signals s ON s.conversation_id = c.id
       WHERE c.phone = ? OR s.phone = ?
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 1`,
      phone,
      phone,
    )?.id ?? null
  );
}

export function upsertOrder(o: OrderInput) {
  const phone = normalizeOrderPhone(o.customer_phone);
  const existing = get<{ id: number; conversation_id: string | null }>("SELECT id, conversation_id FROM orders WHERE source = ? AND external_id = ?", o.source, o.external_id);
  const conversationId =
    (o.conversation_id && get("SELECT 1 FROM conversations WHERE id = ?", o.conversation_id) ? o.conversation_id : null) ??
    existing?.conversation_id ??
    (phone ? conversationForPhone(phone) : null);
  const now = Date.now();
  if (existing) {
    run(
      `UPDATE orders SET code = COALESCE(?, code), conversation_id = ?, customer_phone = COALESCE(?, customer_phone), customer_name = COALESCE(?, customer_name),
         status = COALESCE(?, status), fulfillment_status = COALESCE(?, fulfillment_status), total = COALESCE(?, total), updated_at = ?, raw = COALESCE(?, raw)
       WHERE id = ?`,
      o.code ?? null,
      conversationId,
      phone,
      o.customer_name ?? null,
      o.status ?? null,
      o.fulfillment_status ?? null,
      o.total ?? null,
      now,
      o.raw === undefined ? null : JSON.stringify(o.raw),
      existing.id,
    );
  } else {
    run(
      `INSERT INTO orders(source, external_id, code, conversation_id, customer_phone, customer_name, status, fulfillment_status, total, created_at, updated_at, raw)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      o.source,
      o.external_id,
      o.code ?? null,
      conversationId,
      phone,
      o.customer_name ?? null,
      o.status ?? null,
      o.fulfillment_status ?? null,
      o.total ?? null,
      o.created_at ?? now,
      now,
      o.raw === undefined ? null : JSON.stringify(o.raw),
    );
    if (conversationId) logEvent(conversationId, null, "order.linked", { source: o.source, code: o.code ?? o.external_id });
  }
  const order = get<any>("SELECT id, source, external_id, code, conversation_id, customer_phone, customer_name, status, fulfillment_status, total, created_at, updated_at FROM orders WHERE source = ? AND external_id = ?", o.source, o.external_id);
  bus.emit("order.updated", order);
  return order;
}

export function ordersOfConversation(conversationId: string) {
  return all(
    "SELECT id, source, external_id, code, customer_phone, customer_name, status, fulfillment_status, total, created_at, updated_at FROM orders WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20",
    conversationId,
  );
}

/** Gắn tay một đơn vào hội thoại (ví dụ khách đặt bằng số khác). */
export function linkOrder(orderId: number, conversationId: string | null, userId: number) {
  run("UPDATE orders SET conversation_id = ?, updated_at = ? WHERE id = ?", conversationId, Date.now(), orderId);
  logEvent(conversationId, userId, "order.linked", { order: orderId, manual: true });
  bus.emit("order.updated", get("SELECT * FROM orders WHERE id = ?", orderId));
}

// ───────────── Sapo POS (đã chuẩn bị, chưa bật) ─────────────
/*
 * Cách sẽ hoạt động khi bật:
 * 1. Tạo "ứng dụng riêng" (private app) trong Sapo: lấy API key + mật khẩu (API secret), quyền đọc đơn hàng, khách hàng.
 * 2. Sapo gọi webhook /webhooks/sapo khi có đơn mới / cập nhật / giao vận chuyển (orders/create, orders/updated, fulfillments/create…).
 *    App kiểm tra chữ ký X-Sapo-Hmac-Sha256 (HMAC-SHA256 base64 của body bằng "webhook secret"), rồi upsertOrder().
 * 3. Đơn tự ghép vào hội thoại theo số điện thoại khách → cảnh báo "chưa tạo đơn" tự đóng, "chưa đẩy vận chuyển" bắt đầu đếm.
 * 4. Khung thông tin khách sẽ tra đơn cũ của khách qua API Sapo theo số điện thoại.
 * Các điểm phải đối chiếu với tài liệu Sapo khi làm thật: tên header chữ ký, tên trường trạng thái giao hàng, giới hạn gọi API.
 */

export type SapoConfig = {
  enabled: boolean;
  /** Tên cửa hàng: <store>.mysapo.net */
  store: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
};

export function sapoConfig(): SapoConfig {
  const c = getSetting<Partial<SapoConfig>>("sapo.config") ?? {};
  return { enabled: false, store: "", apiKey: "", apiSecret: "", webhookSecret: "", ...c } as SapoConfig;
}

const mask = (v?: string) => (v ? `•••${v.slice(-3)}` : "");
export function publicSapoConfig() {
  const c = sapoConfig();
  return {
    enabled: c.enabled,
    store: c.store,
    apiKey: c.apiKey,
    apiSecret: mask(c.apiSecret),
    webhookSecret: mask(c.webhookSecret),
    ready: !!(c.store && c.apiKey && c.apiSecret),
    orders: get<{ n: number }>("SELECT COUNT(*) AS n FROM orders WHERE source = 'sapo'")!.n,
  };
}

export function saveSapoConfig(input: any, userId: number) {
  const cur = sapoConfig();
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // Trình duyệt hay tự điền email + mật khẩu đăng nhập vào ô API key / mật khẩu: chặn lại
  if (/@/.test(str(input?.apiKey))) throw new Error("API key Sapo không phải email. Có thể trình duyệt đã tự điền tài khoản đăng nhập của bạn, hãy xóa ô API key và mật khẩu rồi nhập lại.");
  const next: SapoConfig = {
    // Chưa làm xong phần kết nối thật: chưa cho bật
    enabled: false,
    store: str(input?.store).replace(/^https?:\/\//, "").replace(/\.mysapo\.net.*$/, "") || cur.store,
    apiKey: str(input?.apiKey) || cur.apiKey,
    apiSecret: str(input?.apiSecret) || cur.apiSecret,
    webhookSecret: str(input?.webhookSecret) || cur.webhookSecret,
  };
  setSetting("sapo.config", next);
  logEvent(null, userId, "sapo.config", { store: next.store });
  return publicSapoConfig();
}

export function verifySapoWebhook(rawBody: Buffer, header: string | undefined) {
  const c = sapoConfig();
  if (!c.webhookSecret || !header) return false;
  const expected = crypto.createHmac("sha256", c.webhookSecret).update(rawBody).digest("base64");
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** Chuyển đơn Sapo (dạng JSON giống Shopify) thành OrderInput. */
export function orderFromSapo(o: any): OrderInput {
  return {
    source: "sapo",
    external_id: String(o.id),
    code: o.name ?? o.order_number ?? null,
    customer_phone: o.phone ?? o.customer?.phone ?? o.billing_address?.phone ?? o.shipping_address?.phone ?? null,
    customer_name: o.customer ? [o.customer.last_name, o.customer.first_name].filter(Boolean).join(" ") || null : o.billing_address?.name ?? null,
    status: o.cancelled_on || o.cancelled_at ? "cancelled" : o.closed_on || o.closed_at ? "closed" : o.status ?? "open",
    fulfillment_status: o.fulfillment_status ?? null,
    total: o.total_price !== undefined ? Number(o.total_price) : null,
    created_at: o.created_on || o.created_at ? Date.parse(o.created_on ?? o.created_at) : null,
    raw: o,
  };
}

/** Gọi API Sapo (Basic auth bằng API key + secret của ứng dụng riêng). */
export async function sapoRequest<T = any>(path: string) {
  const c = sapoConfig();
  if (!c.store || !c.apiKey || !c.apiSecret) throw new Error("Chưa nhập thông tin Sapo");
  return fetchJson<T>(`https://${c.store}.mysapo.net/admin${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.apiKey}:${c.apiSecret}`).toString("base64")}`, Accept: "application/json" },
  });
}

/** Đơn của khách theo số điện thoại (dùng khi bật Sapo). */
export async function sapoOrdersByPhone(phone: string) {
  const r = await sapoRequest<{ orders: any[] }>(`/orders.json?phone=${encodeURIComponent(phone)}&limit=20`);
  return (r.orders ?? []).map(orderFromSapo);
}
