/**
 * Kết nối app Dịch vụ kỹ thuật (DVKT ver 3, dvktkythuat.sieutoc.com — Cloudflare Worker, repo SieuTocCorp/appdichvukythuat).
 * - Đang chat với khách → khung Thông tin hiện vé DVKT, đơn giao hàng / hỗ trợ kỹ thuật, phiếu bảo hành của khách
 *   (theo số điện thoại), đang ở giai đoạn nào, ai làm. Chỉ đọc.
 * - Bảo vệ bằng khóa riêng: app này tạo khóa (Cài đặt › Kết nối app nội bộ), quản trị đặt vào Worker DVKT bằng
 *   `npx wrangler secret put CHAT_SIEUTOC_KEY`. Khóa gửi qua header X-Integration-Key, chỉ gửi tới địa chỉ https đã lưu.
 * - Chiều ngược lại (DVKT → chat): nút "Nhắn" cạnh số điện thoại khách ở DVKT mở #/find/<sđt> của app này.
 */
import crypto from "node:crypto";
import { getSetting, logEvent, setSetting } from "./db.js";
import { config } from "./config.js";

export type DvktConfig = { enabled: boolean; url: string; key: string; keyCreatedAt: number | null };

const DEFAULT_URL = "https://dvktkythuat.sieutoc.com";

export function dvktConfig(): DvktConfig {
  const c = getSetting<Partial<DvktConfig>>("dvkt.config") ?? {};
  return { enabled: !!c.enabled, url: c.url || DEFAULT_URL, key: c.key ?? "", keyCreatedAt: c.keyCreatedAt ?? null };
}

export function publicDvktConfig() {
  const c = dvktConfig();
  return { enabled: c.enabled, url: c.url, hasKey: !!c.key, keyHint: c.key ? `•••${c.key.slice(-4)}` : "", keyCreatedAt: c.keyCreatedAt };
}

/** https bắt buộc (khóa đi kèm mỗi lần gọi); http chỉ cho máy này (chạy thử). */
function cleanUrl(raw: unknown) {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error("Địa chỉ app DVKT không hợp lệ");
  }
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("Địa chỉ app DVKT phải là https://");
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) throw new Error("Chỉ nhập địa chỉ gốc, VD https://dvktkythuat.sieutoc.com");
  return u.origin;
}

export function saveDvktConfig(input: any, userId: number) {
  const cur = dvktConfig();
  const next: DvktConfig = {
    ...cur,
    url: input?.url !== undefined ? cleanUrl(input.url) : cur.url,
    enabled: input?.enabled !== undefined ? !!input.enabled : cur.enabled,
  };
  if (next.enabled && !next.key) throw new Error("Tạo khóa kết nối và đặt vào app DVKT trước khi bật");
  setSetting("dvkt.config", next);
  cache.clear();
  logEvent(null, userId, "dvkt.config", { url: next.url, enabled: next.enabled, urlChanged: next.url !== cur.url });
  return publicDvktConfig();
}

/** Tạo khóa mới — trả về NGUYÊN khóa đúng một lần để quản trị chép sang DVKT. Khóa cũ hết hiệu lực. */
export function rotateDvktKey(userId: number) {
  const key = crypto.randomBytes(32).toString("base64url");
  setSetting("dvkt.config", { ...dvktConfig(), key, keyCreatedAt: Date.now() });
  cache.clear();
  logEvent(null, userId, "dvkt.key_rotated", {});
  return { key, config: publicDvktConfig() };
}

export type DvktTicket = { id: number; name: string; order: string; status: string; technician: string; services: string[]; start: string | null; end: string | null; updated: string | null };
export type DvktHelpdesk = { id: number; ref: string; name: string; kind: "delivery" | "support" | "other"; team: string; stage: string; done: boolean; user: string; created: string | null; closed: string | null };
export type DvktWarranty = { id: number; no: string; product: string; serial: string; issue: string; stage: string; tech: string; created: string | null; due: string };
export type DvktSummary = { phone: string; dvkt: DvktTicket[]; helpdesk: DvktHelpdesk[]; warranty: DvktWarranty[]; errors: Record<string, string>; links: Record<string, string> };

const cache = new Map<string, { at: number; data: DvktSummary }>();
const TTL = 60_000;

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
const id = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const arr = (v: unknown) => (Array.isArray(v) ? v.slice(0, 30) : []);

/** Chỉ lấy đúng các trường biết trước (dữ liệu từ app khác coi như dữ liệu, không tin cấu trúc). */
function sanitize(raw: any, base: string): DvktSummary {
  const odoo = config.odooUrl;
  return {
    phone: str(raw?.phone, 20),
    dvkt: arr(raw?.dvkt).map((t: any) => ({
      id: id(t?.id),
      name: str(t?.name, 120),
      order: str(t?.order, 120),
      status: ["DANG_THUC_HIEN", "XONG", "HUY"].includes(t?.status) ? t.status : "DANG_THUC_HIEN",
      technician: str(t?.technician, 120),
      services: arr(t?.services).map((s) => str(s, 60)).slice(0, 8),
      start: t?.start ? str(t.start, 40) : null,
      end: t?.end ? str(t.end, 40) : null,
      updated: t?.updated ? str(t.updated, 40) : null,
    })),
    helpdesk: arr(raw?.helpdesk).map((h: any) => ({
      id: id(h?.id),
      ref: str(h?.ref, 40),
      name: str(h?.name, 200),
      kind: h?.kind === "delivery" || h?.kind === "support" ? h.kind : "other",
      team: str(h?.team, 120),
      stage: str(h?.stage, 120),
      done: !!h?.done,
      user: str(h?.user, 120),
      created: h?.created ? str(h.created, 40) : null,
      closed: h?.closed ? str(h.closed, 40) : null,
    })),
    warranty: arr(raw?.warranty).map((w: any) => ({
      id: id(w?.id),
      no: str(w?.no, 60),
      product: str(w?.product, 200),
      serial: str(w?.serial, 80),
      issue: str(w?.issue, 300),
      stage: str(w?.stage, 120),
      tech: str(w?.tech, 120),
      created: w?.created ? str(w.created, 40) : null,
      due: str(w?.due, 20),
    })),
    errors: Object.fromEntries(Object.entries(raw?.errors ?? {}).slice(0, 5).map(([k, v]) => [str(k, 20), str(v, 200)])),
    // Link mở bản ghi: app DVKT (theo mục) và Odoo (theo id) — dựng tại đây, không lấy link từ phản hồi
    links: {
      dvkt: `${base}/#dvkt`,
      delivery: `${base}/#delivery`,
      support: `${base}/#support`,
      warranty: `${base}/#warranty`,
      odoo_dvkt: `${odoo}/web#model=x_dich_vu_ky_thuat&view_type=form&id=`,
      odoo_helpdesk: `${odoo}/web#model=helpdesk.ticket&view_type=form&id=`,
      odoo_warranty: `${odoo}/web#model=x_bao_hanh&view_type=form&id=`,
    },
  };
}

async function call(c: DvktConfig, path: string) {
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, { headers: { "X-Integration-Key": c.key, Accept: "application/json" }, signal: AbortSignal.timeout(12_000), redirect: "error" });
  } catch (e: any) {
    throw new Error(e?.name === "TimeoutError" ? "App DVKT không trả lời (quá 12 giây)" : "Không gọi được app DVKT");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw new Error("App DVKT báo sai khóa kết nối — đặt lại khóa mới vào DVKT");
  if (res.status === 503) throw new Error("App DVKT chưa bật kết nối (chưa đặt CHAT_SIEUTOC_KEY)");
  if (res.status === 404) throw new Error("App DVKT chưa có bản hỗ trợ kết nối (cần bản v3.20 trở lên)");
  if (!res.ok || !body) throw new Error(str(body?.error, 200) || `App DVKT lỗi (mã ${res.status})`);
  return body;
}

/** Việc kỹ thuật của khách theo số điện thoại; cache 60 giây cho mỗi số. */
export async function dvktCustomer(phone: string, opts: { refresh?: boolean } = {}) {
  const c = dvktConfig();
  if (!c.enabled || !c.key) return null;
  const hit = cache.get(phone);
  if (hit && !opts.refresh && Date.now() - hit.at < TTL) return hit.data;
  const data = sanitize(await call(c, `/api/integration/customer?phone=${encodeURIComponent(phone)}`), c.url);
  cache.set(phone, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return data;
}

/** Kiểm tra kết nối bằng một số không có thật — chỉ cần DVKT nhận khóa. */
export async function testDvkt(input?: any) {
  const cur = dvktConfig();
  const c = { ...cur, url: input?.url ? cleanUrl(input.url) : cur.url };
  if (!c.key) throw new Error("Chưa tạo khóa kết nối");
  const t0 = Date.now();
  await call(c, "/api/integration/customer?phone=0900000000");
  return { ok: true, ms: Date.now() - t0 };
}
