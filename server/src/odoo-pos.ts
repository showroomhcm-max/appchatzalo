/**
 * Lên đơn hàng POS trên Odoo (erp.sieutoc.com, Odoo 17) từ hội thoại chat.
 * - Dùng một tài khoản Odoo "tích hợp" + API key (quản trị nhập ở Cài đặt › Tích hợp › Đồng bộ đơn hàng).
 * - Đơn tạo ở trạng thái nháp (draft) trong ca POS đang mở của điểm bán được chọn; thu ngân mở ca và thanh toán như đơn thường.
 * - Ca POS chưa mở → đơn xếp hàng chờ trong app, tự đẩy lên khi ca mở (quét mỗi 2 phút).
 * - Khách tìm theo số điện thoại (res.partner), chưa có thì tạo mới.
 * - Giá trên Odoo đã gồm thuế (thuế "price_include"), app tính tiền trước thuế / sau thuế theo thuế của sản phẩm.
 * - Trạng thái đơn (draft / to_pay / reserve / paid / done / cancel) và "Trạng thái giao hàng" được lấy về định kỳ
 *   → cảnh báo "chưa tạo đơn" / "chưa đẩy vận chuyển" tự cập nhật.
 */
import crypto from "node:crypto";
import { all, get, getSetting, logEvent, run, setSetting } from "./db.js";
import { config } from "./config.js";
import { upsertOrder } from "./orders.js";

export type OdooPosConfig = {
  enabled: boolean;
  url: string;
  db: string;
  login: string;
  apiKey: string;
  /** Điểm bán mặc định (pos.config id) */
  configId: number | null;
  /** Kênh bán (x_kenh_ban) theo nền tảng chat */
  kenhBan: Record<string, number | null>;
};

export function odooPosConfig(): OdooPosConfig {
  const c = getSetting<Partial<OdooPosConfig>>("odoo_pos.config") ?? {};
  return {
    enabled: !!c.enabled,
    url: (c.url || config.odooUrl || "").replace(/\/+$/, ""),
    db: c.db || config.odooDb || "",
    login: c.login ?? "",
    apiKey: c.apiKey ?? "",
    configId: c.configId ?? null,
    kenhBan: c.kenhBan ?? {},
  };
}

const mask = (v?: string) => (v ? `•••${v.slice(-3)}` : "");
export function publicOdooPosConfig() {
  const c = odooPosConfig();
  const counts = get<{ total: number; pending: number }>(
    "SELECT COUNT(*) AS total, SUM(status = 'pending_pos') AS pending FROM orders WHERE source = 'odoo_pos'",
  )!;
  return { ...c, apiKey: mask(c.apiKey), ready: !!(c.url && c.db && c.login && c.apiKey), orders: counts.total, pending: counts.pending ?? 0 };
}

export function saveOdooPosConfig(input: any, userId: number) {
  const cur = odooPosConfig();
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const kenhBan: Record<string, number | null> = { ...cur.kenhBan };
  if (input?.kenhBan && typeof input.kenhBan === "object") {
    for (const [k, v] of Object.entries(input.kenhBan)) kenhBan[k] = v ? Number(v) : null;
  }
  const next: OdooPosConfig = {
    enabled: input?.enabled !== undefined ? !!input.enabled : cur.enabled,
    url: str(input?.url).replace(/\/+$/, "") || cur.url,
    db: str(input?.db) || cur.db,
    login: input?.login !== undefined ? str(input.login) : cur.login,
    // Đổi địa chỉ Odoo / tài khoản mà không nhập lại API key → không giữ key cũ (tránh gửi key đã lưu sang địa chỉ lạ)
    apiKey: str(input?.apiKey) || (sameTarget(cur, input) ? cur.apiKey : ""),
    configId: input?.configId !== undefined ? (input.configId ? Number(input.configId) : null) : cur.configId,
    kenhBan,
  };
  if (next.enabled && !(next.url && next.db && next.login && next.apiKey)) throw new Error("Nhập đủ địa chỉ Odoo, database, tài khoản và API key trước khi bật");
  setSetting("odoo_pos.config", next);
  session = null;
  logEvent(null, userId, "odoo_pos.config", { enabled: next.enabled, login: next.login, configId: next.configId });
  return publicOdooPosConfig();
}

// ───────────── JSON-RPC ─────────────

let session: { key: string; uid: number } | null = null;
let seq = 0;

async function rpc(c: OdooPosConfig, service: string, method: string, args: unknown[]) {
  const res = await fetch(`${c.url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: ++seq }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Odoo trả về dữ liệu không phải JSON (HTTP ${res.status})`);
  }
  if (payload.error) throw new Error(`Odoo: ${payload.error.data?.message ?? payload.error.message ?? "lỗi"}`);
  return payload.result;
}

async function uidOf(c: OdooPosConfig) {
  const key = `${c.url}|${c.db}|${c.login}|${crypto.createHash("sha256").update(c.apiKey).digest("hex")}`;
  if (session?.key === key) return session.uid;
  const uid = await rpc(c, "common", "authenticate", [c.db, c.login, c.apiKey, {}]);
  if (!uid) throw new Error("Odoo từ chối đăng nhập: kiểm tra tài khoản và API key tích hợp");
  session = { key, uid };
  return uid;
}

async function call<T = any>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}, cfg = odooPosConfig()): Promise<T> {
  if (!cfg.url || !cfg.login || !cfg.apiKey) throw new Error("Chưa nhập tài khoản Odoo tích hợp (Cài đặt › Tích hợp › Đồng bộ đơn hàng)");
  const uid = await uidOf(cfg);
  return rpc(cfg, "object", "execute_kw", [cfg.db, uid, cfg.apiKey, model, method, args, kwargs]);
}

/** Kiểm tra kết nối: đăng nhập, liệt kê điểm bán POS và kênh bán. */
/** Địa chỉ / database / tài khoản gửi lên có giống cấu hình đã lưu không (để quyết định dùng lại API key đã lưu). */
function sameTarget(cur: OdooPosConfig, input: any) {
  const v = (x: unknown) => (typeof x === "string" ? x.trim().replace(/\/+$/, "") : "");
  return (!v(input?.url) || v(input.url) === cur.url) && (!v(input?.db) || v(input.db) === cur.db) && (input?.login === undefined || v(input.login) === cur.login);
}

export async function testOdooPos(input?: any) {
  const cur = odooPosConfig();
  if (!input?.apiKey?.trim() && !sameTarget(cur, input)) throw new Error("Đổi địa chỉ / database / tài khoản Odoo thì nhập lại API key để kiểm tra");
  const cfg: OdooPosConfig = { ...cur, url: input?.url?.trim() || cur.url, db: input?.db?.trim() || cur.db, login: input?.login?.trim() || cur.login, apiKey: input?.apiKey?.trim() || cur.apiKey };
  session = null;
  const uid = await uidOf(cfg);
  const configs = await posConfigs(cfg);
  let kenhBan: { id: number; name: string }[] = [];
  try {
    kenhBan = (await call<any[]>("x_kenh_ban", "search_read", [[]], { fields: ["id", "x_name"], limit: 200 }, cfg)).map((k) => ({ id: k.id, name: k.x_name }));
  } catch {
    /* Odoo không có trường Kênh bán */
  }
  return { ok: true, uid, configs, kenhBan };
}

export async function posConfigs(cfg = odooPosConfig()) {
  const rows = await call<any[]>("pos.config", "search_read", [[]], { fields: ["id", "name", "current_session_id", "current_session_state"], limit: 50 }, cfg);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    session: r.current_session_id ? r.current_session_id[1] : null,
    open: r.current_session_state === "opened",
  }));
}

export async function searchProducts(q: string) {
  const term = q.trim();
  const domain: unknown[] = [["available_in_pos", "=", true], ["sale_ok", "=", true]];
  if (term) domain.push("|", "|", ["name", "ilike", term], ["default_code", "ilike", term], ["barcode", "=", term]);
  const rows = await call<any[]>("product.product", "search_read", [domain], {
    fields: ["id", "display_name", "default_code", "lst_price", "taxes_id", "qty_available"],
    limit: 20,
    order: "qty_available desc",
  });
  return rows.map((p) => ({ id: p.id, name: p.display_name, code: p.default_code || null, price: p.lst_price, taxIds: p.taxes_id ?? [], stock: p.qty_available }));
}

// ───────────── Lên đơn ─────────────

export type PosOrderInput = {
  conversationId: string;
  platform: string;
  configId: number;
  customer: { name: string; phone: string; address?: string | null };
  lines: { productId: number; name: string; qty: number; price: number; discount?: number }[];
  note?: string | null;
  agent: { id: number; name: string; odooUid: number | null };
};

const round = (n: number) => Math.round(n);

/** Tính tiền dòng theo thuế phần trăm của Odoo (giá đã gồm hoặc chưa gồm thuế). */
function lineAmounts(price: number, qty: number, discount: number, taxes: { amount: number; price_include: boolean }[]) {
  const base = price * qty * (1 - discount / 100);
  const rate = taxes.reduce((s, t) => s + t.amount / 100, 0);
  const included = taxes.length > 0 && taxes.every((t) => t.price_include);
  const incl = included ? base : base * (1 + rate);
  const excl = included ? base / (1 + rate) : base;
  return { price_subtotal: round(excl), price_subtotal_incl: round(incl) };
}

async function findOrCreatePartner(c: PosOrderInput["customer"]) {
  const digits = c.phone.replace(/\D/g, "");
  const tail = digits.slice(-9);
  if (tail.length >= 9) {
    const found = await call<any[]>("res.partner", "search_read", [["|", ["phone", "ilike", tail], ["mobile", "ilike", tail]]], { fields: ["id", "name"], limit: 1 });
    if (found.length) return found[0].id as number;
  }
  return call<number>("res.partner", "create", [{ name: c.name || c.phone, phone: c.phone, street: c.address || false }]);
}

/** Đẩy đơn lên POS. Ca chưa mở → trả null (đơn ở trạng thái chờ). */
async function pushToOdoo(input: PosOrderInput, localRef: string) {
  const sessions = await call<any[]>("pos.session", "search_read", [[["config_id", "=", input.configId], ["state", "=", "opened"]]], {
    fields: ["id", "name"],
    limit: 1,
  });
  if (!sessions.length) return null;
  const partnerId = await findOrCreatePartner(input.customer);
  const products = await call<any[]>("product.product", "read", [[...new Set(input.lines.map((l) => l.productId))]], { fields: ["id", "taxes_id"] });
  const productTaxes = new Map(products.map((p) => [p.id, p.taxes_id as number[]]));
  const taxIds = [...new Set(products.flatMap((p) => p.taxes_id as number[]))];
  const taxes = new Map(
    (taxIds.length ? await call<any[]>("account.tax", "read", [taxIds], { fields: ["id", "amount", "amount_type", "price_include"] }) : [])
      .filter((t) => t.amount_type === "percent")
      .map((t) => [t.id, t]),
  );
  let total = 0;
  let totalExcl = 0;
  const lines = input.lines.map((l) => {
    const tIds = (productTaxes.get(l.productId) ?? []).filter((id) => taxes.has(id));
    const a = lineAmounts(l.price, l.qty, l.discount ?? 0, tIds.map((id) => taxes.get(id)));
    total += a.price_subtotal_incl;
    totalExcl += a.price_subtotal;
    return [0, 0, { product_id: l.productId, full_product_name: l.name, qty: l.qty, price_unit: l.price, discount: l.discount ?? 0, tax_ids: [[6, 0, tIds]], ...a }];
  });
  const cfg = odooPosConfig();
  const values: Record<string, unknown> = {
    session_id: sessions[0].id,
    partner_id: partnerId,
    lines,
    amount_tax: total - totalExcl,
    amount_total: total,
    amount_paid: 0,
    amount_return: 0,
    pos_reference: localRef,
    note: [`Lên từ Chat Siêu Tốc · ${input.agent.name}`, input.customer.address ? `Địa chỉ: ${input.customer.address}` : "", input.note ?? ""].filter(Boolean).join("\n"),
  };
  if (input.agent.odooUid) values.user_id = input.agent.odooUid;
  const kenh = cfg.kenhBan[input.platform] ?? cfg.kenhBan.default ?? null;
  if (kenh) values.x_studio_kenh_ban = kenh;
  const id = await call<number>("pos.order", "create", [values]);
  const [o] = await call<any[]>("pos.order", "read", [[id]], { fields: ["id", "name", "pos_reference", "state", "amount_total"] });
  return { id, code: o?.pos_reference || o?.name || localRef, state: o?.state ?? "draft", total: o?.amount_total ?? total, session: sessions[0].name };
}

export async function createPosOrder(input: PosOrderInput) {
  const cfg = odooPosConfig();
  if (!cfg.enabled) throw new Error("Chưa bật lên đơn POS (Cài đặt › Tích hợp › Đồng bộ đơn hàng)");
  if (!input.lines.length) throw new Error("Chọn ít nhất 1 sản phẩm");
  if (!input.customer.phone.replace(/\D/g, "")) throw new Error("Nhập số điện thoại khách");
  const localRef = `CHAT-${Date.now().toString(36).toUpperCase()}`;
  const pushed = await pushToOdoo(input, localRef);
  const estTotal = input.lines.reduce((s, l) => s + l.price * l.qty * (1 - (l.discount ?? 0) / 100), 0);
  const order = upsertOrder({
    source: "odoo_pos",
    external_id: pushed ? String(pushed.id) : localRef,
    code: pushed?.code ?? localRef,
    conversation_id: input.conversationId,
    customer_phone: input.customer.phone,
    customer_name: input.customer.name,
    status: pushed ? pushed.state : "pending_pos",
    total: pushed?.total ?? estTotal,
    raw: { input, pushed },
  });
  logEvent(input.conversationId, input.agent.id, "order.pos_created", { code: order.code, queued: !pushed });
  return { order, queued: !pushed, session: pushed?.session ?? null };
}

// ───────────── Đồng bộ trạng thái + đẩy đơn chờ ─────────────

const FINAL = ["done", "cancel", "invoiced"];

export async function syncPosOrders() {
  const cfg = odooPosConfig();
  if (!cfg.enabled || !cfg.apiKey) return;
  // 1. Đơn chờ ca mở
  for (const o of all<{ id: number; external_id: string; raw: string }>("SELECT id, external_id, raw FROM orders WHERE source = 'odoo_pos' AND status = 'pending_pos' LIMIT 20")) {
    try {
      const input = JSON.parse(o.raw).input as PosOrderInput;
      const pushed = await pushToOdoo(input, o.external_id);
      if (!pushed) continue;
      run("DELETE FROM orders WHERE id = ?", o.id);
      upsertOrder({
        source: "odoo_pos",
        external_id: String(pushed.id),
        code: pushed.code,
        conversation_id: input.conversationId,
        customer_phone: input.customer.phone,
        customer_name: input.customer.name,
        status: pushed.state,
        total: pushed.total,
        raw: { input, pushed },
      });
      logEvent(input.conversationId, null, "order.pos_pushed", { code: pushed.code, session: pushed.session });
    } catch (e: any) {
      console.warn("[odoo-pos] Đẩy đơn chờ lỗi:", e.message);
    }
  }
  // 2. Trạng thái đơn đã đẩy
  const open = all<{ external_id: string; status: string | null; fulfillment_status: string | null }>(
    `SELECT external_id, status, fulfillment_status FROM orders WHERE source = 'odoo_pos' AND status != 'pending_pos'
       AND (COALESCE(status, '') NOT IN ('${FINAL.join("','")}') OR fulfillment_status IS NULL) AND created_at > ? LIMIT 200`,
    Date.now() - 30 * 24 * 3600_000,
  );
  if (!open.length) return;
  let rows: any[] = [];
  try {
    rows = await call<any[]>("pos.order", "read", [open.map((o) => Number(o.external_id))], { fields: ["id", "state", "amount_total", "x_studio_trangthaigiaohang"] });
  } catch {
    rows = await call<any[]>("pos.order", "read", [open.map((o) => Number(o.external_id))], { fields: ["id", "state", "amount_total"] });
  }
  for (const r of rows) {
    const cur = open.find((o) => o.external_id === String(r.id));
    const shipping = r.x_studio_trangthaigiaohang || (["paid", "done", "invoiced"].includes(r.state) ? "fulfilled" : null);
    if (cur && (cur.status !== r.state || cur.fulfillment_status !== shipping)) {
      upsertOrder({ source: "odoo_pos", external_id: String(r.id), status: r.state, fulfillment_status: shipping, total: r.amount_total });
    }
  }
}

export function startPosSync() {
  const tick = () => syncPosOrders().catch((e) => console.warn("[odoo-pos] Đồng bộ lỗi:", e.message));
  setTimeout(tick, 30_000);
  setInterval(tick, 2 * 60_000);
}
