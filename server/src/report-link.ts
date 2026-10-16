/**
 * Kết nối app Báo cáo công việc CSKH (Cloudflare Worker riêng, thư mục D:\APPBAOCAOCSKH).
 * - Đăng nhập một chạm: nhân viên đang đăng nhập Chat Siêu Tốc bấm "Báo cáo công việc" → app này ký một vé
 *   ngắn hạn (2 phút, HMAC-SHA256 bằng khóa kết nối) → chuyển sang app báo cáo, app báo cáo kiểm chữ ký rồi tạo phiên.
 *   Địa chỉ chuyển tới lấy từ cấu hình (không lấy từ link) nên không bị lợi dụng chuyển hướng.
 * - App báo cáo lấy số liệu chat của nhân viên qua /api/link/work-report, xác thực bằng cùng khóa (header X-Integration-Key).
 *   Khóa này chỉ mở được đúng các đường /api/link/*, không dùng được cho API /api/v1 (gửi tin, đọc hội thoại…).
 */
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { getSetting, logEvent, setSetting } from "./db.js";
import { can } from "./permissions.js";
import type { AuthUser } from "./auth.js";
import { vnDayRange, workReport } from "./work-report.js";

export type ReportLinkConfig = { enabled: boolean; url: string; key: string; keyCreatedAt: number | null };

const DEFAULT_URL = "https://baocaocskh.sieutoc.com";
const SSO_TTL = 120_000;

export function reportLinkConfig(): ReportLinkConfig {
  const c = getSetting<Partial<ReportLinkConfig>>("report_link.config") ?? {};
  return { enabled: !!c.enabled, url: c.url || DEFAULT_URL, key: c.key ?? "", keyCreatedAt: c.keyCreatedAt ?? null };
}

export function publicReportLinkConfig() {
  const c = reportLinkConfig();
  return { enabled: c.enabled, url: c.url, hasKey: !!c.key, keyHint: c.key ? `•••${c.key.slice(-4)}` : "", keyCreatedAt: c.keyCreatedAt };
}

function cleanUrl(raw: unknown) {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error("Địa chỉ app báo cáo không hợp lệ");
  }
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("Địa chỉ app báo cáo phải là https://");
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) throw new Error("Chỉ nhập địa chỉ gốc, VD https://baocaocskh.sieutoc.com");
  return u.origin;
}

export function saveReportLinkConfig(input: any, userId: number) {
  const cur = reportLinkConfig();
  const next: ReportLinkConfig = {
    ...cur,
    url: input?.url !== undefined ? cleanUrl(input.url) : cur.url,
    enabled: input?.enabled !== undefined ? !!input.enabled : cur.enabled,
  };
  if (next.enabled && !next.key) throw new Error("Tạo khóa kết nối và đặt vào app báo cáo trước khi bật");
  setSetting("report_link.config", next);
  logEvent(null, userId, "report_link.config", { url: next.url, enabled: next.enabled });
  return publicReportLinkConfig();
}

export function rotateReportLinkKey(userId: number) {
  const key = crypto.randomBytes(32).toString("base64url");
  setSetting("report_link.config", { ...reportLinkConfig(), key, keyCreatedAt: Date.now() });
  logEvent(null, userId, "report_link.key_rotated", {});
  return { key, config: publicReportLinkConfig() };
}

/** Quản lý trong app báo cáo = người xem được Dữ liệu (thống kê nhân viên) bên Chat Siêu Tốc. */
export function isReportManager(user: AuthUser) {
  return !!user.super_admin || can(user, "data.view");
}

/** Vé đăng nhập một chạm: base64url(payload).base64url(HMAC) — app báo cáo kiểm bằng cùng khóa. */
export function signSso(user: AuthUser) {
  const c = reportLinkConfig();
  if (!c.enabled || !c.key) throw new Error("Chưa bật kết nối app báo cáo công việc");
  const now = Date.now();
  const payload = {
    v: 1,
    aud: "baocaocskh",
    sub: user.id,
    name: user.display_name,
    email: user.username.includes("@") ? user.username : null,
    role: isReportManager(user) ? "manager" : "staff",
    iat: now,
    exp: now + SSO_TTL,
    jti: crypto.randomBytes(16).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", c.key).update(body).digest("base64url");
  logEvent(null, user.id, "report_link.sso", { role: payload.role });
  // Vé đặt sau dấu # để không nằm trong nhật ký máy chủ / Referer
  return { url: `${c.url}/auth/chat#t=${body}.${sig}` };
}

function requireLinkKey(req: Request, res: Response, next: NextFunction) {
  const c = reportLinkConfig();
  if (!c.key) return res.status(503).json({ error: "Chat Siêu Tốc chưa tạo khóa kết nối app báo cáo" });
  const given = Buffer.from(String(req.header("x-integration-key") ?? ""));
  const want = Buffer.from(c.key);
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Sai khóa kết nối" });
  // /ping chạy được ngay khi có khóa (để kiểm tra trước khi bật); lấy số liệu thì phải bật
  if (!c.enabled && req.path !== "/ping") return res.status(503).json({ error: "Chat Siêu Tốc chưa bật kết nối app báo cáo" });
  next();
}

/** /api/link/* — chỉ cho app báo cáo công việc (khóa kết nối riêng). */
export const linkRouter = Router();
linkRouter.use(requireLinkKey);
linkRouter.get("/ping", (_req, res) => res.json({ ok: true }));
linkRouter.get("/work-report", (req, res) => {
  const r = vnDayRange(String(req.query.from ?? req.query.date ?? ""), String(req.query.to ?? req.query.date ?? req.query.from ?? ""));
  if (!r) return res.status(400).json({ error: "Cần ?date=YYYY-MM-DD hoặc ?from=&to=" });
  try {
    res.json(workReport(r.from, r.to));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** Kiểm tra kết nối: gọi app báo cáo /api/link/ping với khóa. */
export async function testReportLink(input?: any) {
  const cur = reportLinkConfig();
  const url = input?.url ? cleanUrl(input.url) : cur.url;
  if (!cur.key) throw new Error("Chưa tạo khóa kết nối");
  const t0 = Date.now();
  let res: globalThis.Response;
  try {
    res = await fetch(`${url}/api/link/ping`, { method: "POST", headers: { "X-Integration-Key": cur.key }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  } catch {
    throw new Error("Không gọi được app báo cáo");
  }
  const body: any = await res.json().catch(() => null);
  if (res.status === 401) throw new Error("App báo cáo báo sai khóa — đặt lại khóa mới vào app báo cáo");
  if (res.status === 503) throw new Error("App báo cáo chưa đặt khóa kết nối (CHAT_LINK_KEY)");
  if (!res.ok) throw new Error(String(body?.error ?? `App báo cáo lỗi (mã ${res.status})`).slice(0, 200));
  return { ok: true, ms: Date.now() - t0, chat_reachable: body?.chat_reachable ?? null, chat_error: body?.chat_error ?? null };
}
