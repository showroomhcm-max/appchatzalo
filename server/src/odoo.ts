/**
 * Đăng nhập bằng tài khoản Odoo (giống các app SieuToc khác, vd APPDVKT):
 *  1. JSON-RPC common.authenticate — tài khoản không bật 2FA.
 *  2. Nếu thất bại: giả lập form đăng nhập web của Odoo để phân biệt "sai mật khẩu" với "cần mã OTP" (2FA),
 *     vì common.authenticate không có tham số OTP.
 * Lưu ý: bước 2 phụ thuộc cấu trúc trang /web/login và /web/login/totp của Odoo.
 */
import crypto from "node:crypto";
import { config } from "./config.js";

/** internal: false = tài khoản portal (khách hàng / đối tác), không phải nhân viên; undefined = không rõ. */
export type OdooIdentity = { uid: number; login: string; name: string; internal?: boolean };
export type OdooLoginResult =
  | { status: "ok"; user: OdooIdentity }
  | { status: "totp_required"; pendingId: string }
  | { status: "invalid" };

let rpcSeq = 0;

async function jsonRpc(service: string, method: string, args: unknown[]) {
  const res = await fetch(`${config.odooUrl}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: ++rpcSeq }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Odoo trả về dữ liệu không phải JSON (HTTP ${res.status})`);
  }
  if (payload.error) throw new Error(payload.error.data?.message ?? payload.error.message ?? "Lỗi Odoo");
  return payload.result;
}

async function apiLogin(login: string, password: string): Promise<OdooIdentity | null> {
  const uid = await jsonRpc("common", "authenticate", [config.odooDb, login, password, {}]);
  if (!uid) return null;
  let name = login;
  let internal: boolean | undefined;
  try {
    const rows = await jsonRpc("object", "execute_kw", [
      config.odooDb,
      uid,
      password,
      "res.users",
      "read",
      [[uid]],
      { fields: ["name", "login", "share"] },
    ]);
    name = rows?.[0]?.name || login;
    login = rows?.[0]?.login || login;
    if (typeof rows?.[0]?.share === "boolean") internal = !rows[0].share;
  } catch {
    /* không đọc được tên thì dùng login */
  }
  return { uid, login, name, internal };
}

// ───────────── Đăng nhập kiểu web session (cho tài khoản bật 2FA) ─────────────

type Jar = Record<string, string>;

async function requestRaw(method: string, path: string, jar: Jar, body?: string, contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${config.odooUrl}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  for (const line of res.headers.getSetCookie()) {
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return { status: res.status, body: await res.text() };
}

function inputValue(html: string, name: string) {
  for (const re of [
    new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i"),
    new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, "i"),
  ]) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function totpFieldName(html: string) {
  const names = [...html.matchAll(/<input\b[^>]*name=["']([^"']+)["'][^>]*>/gi)]
    .map((m) => m[1])
    .filter((n) => n.toLowerCase() !== "csrf_token" && /token|totp|otp/i.test(n));
  const rank = (n: string) => {
    const l = n.toLowerCase();
    return l.includes("totp") && l.includes("token") ? 0 : l.includes("totp") ? 1 : l.includes("token") ? 2 : 3;
  };
  return names.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

async function sessionInfo(jar: Jar): Promise<OdooIdentity | null> {
  const r = await requestRaw(
    "POST",
    "/web/session/get_session_info",
    jar,
    JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} }),
    "application/json",
  );
  try {
    const s = JSON.parse(r.body)?.result;
    if (!s?.uid) return null;
    return {
      uid: s.uid,
      login: s.username ?? "",
      name: s.name ?? s.partner_display_name ?? s.username ?? "",
      internal: typeof s.is_internal_user === "boolean" ? s.is_internal_user : undefined,
    };
  } catch {
    return null;
  }
}

const PENDING_TTL = 5 * 60_000;
const MAX_OTP_ATTEMPTS = 5;
const pending = new Map<string, { jar: Jar; csrf: string | null; field: string; attempts: number; created: number }>();

function cleanupPending() {
  const now = Date.now();
  for (const [id, p] of pending) if (now - p.created > PENDING_TTL) pending.delete(id);
}

async function webLogin(login: string, password: string): Promise<OdooLoginResult> {
  cleanupPending();
  const jar: Jar = {};
  const page = await requestRaw("GET", "/web/login", jar);
  const form = new URLSearchParams({ login, password });
  const csrf = inputValue(page.body, "csrf_token");
  if (csrf) form.set("csrf_token", csrf);
  await requestRaw("POST", "/web/login", jar, form.toString(), "application/x-www-form-urlencoded");

  const s = await sessionInfo(jar);
  if (s) return { status: "ok", user: s };

  const totpPage = await requestRaw("GET", "/web/login/totp", jar);
  const field = process.env.ODOO_TOTP_FIELD_NAME || totpFieldName(totpPage.body);
  if (!field) return { status: "invalid" };
  const pendingId = crypto.randomBytes(16).toString("hex");
  pending.set(pendingId, { jar, csrf: inputValue(totpPage.body, "csrf_token"), field, attempts: 0, created: Date.now() });
  return { status: "totp_required", pendingId };
}

export async function odooLogin(login: string, password: string): Promise<OdooLoginResult> {
  const user = await apiLogin(login, password);
  if (user) return { status: "ok", user };
  return webLogin(login, password);
}

export async function odooCompleteTotp(pendingId: string, code: string): Promise<OdooLoginResult | { status: "expired" }> {
  cleanupPending();
  const p = pending.get(pendingId);
  if (!p || p.attempts >= MAX_OTP_ATTEMPTS) {
    pending.delete(pendingId);
    return { status: "expired" };
  }
  p.attempts++;
  const form = new URLSearchParams({ [p.field]: code.trim() });
  if (p.csrf) form.set("csrf_token", p.csrf);
  await requestRaw("POST", "/web/login/totp", p.jar, form.toString(), "application/x-www-form-urlencoded");
  const s = await sessionInfo(p.jar);
  if (s) {
    pending.delete(pendingId);
    return { status: "ok", user: s };
  }
  return { status: "invalid" };
}
