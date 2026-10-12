import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { odooLogin, odooCompleteTotp, type OdooIdentity } from "./odoo.js";
import multer from "multer";
import fs from "node:fs";
import { config } from "./config.js";
import { all, get, run, logEvent } from "./db.js";
import { generateApiKey, requireApiKey, requireUser, signToken, type AuthUser } from "./auth.js";
import {
  PERMISSIONS,
  can,
  cleanPermissions,
  permissionsOf,
  requirePerm,
  syncLegacyRole,
} from "./permissions.js";
import { logFilesText, recentLogs, redact } from "./logger.js";
import os from "node:os";
import { appVersion } from "./version.js";
import { zalo } from "./zalo.js";
import { getConversation, listConversations, listMessages } from "./store.js";
import {
  HttpError,
  connectedSession,
  markRead,
  messageInConversation,
  sendToConversation,
  updateConversation,
} from "./conversations.js";
import { setReaction } from "./store.js";
import { agentStats, buildConversations, toCsv, toJsonl, toTxt, type ExportFilter } from "./analytics.js";
import { WEBHOOK_EVENTS, dispatch } from "./webhooks.js";
import { bus } from "./bus.js";
import { openConversationWith, searchContacts, searchMessages } from "./people.js";
import { settingsRouter } from "./settings-routes.js";
import { platformRouter } from "./platform-routes.js";
import { alertConfig, listAlerts, resolveAlert, saveAlertConfig } from "./alerts.js";
import { ASSET_STATUS, REVOKE_CHECKLIST, accountHistory, accountsHeldBy, handover, listAccounts, onUserDeactivated, updateAsset } from "./company-accounts.js";
import { linkOrder, ordersOfConversation, publicSapoConfig, saveSapoConfig, upsertOrder } from "./orders.js";
import { createPosOrder, odooPosConfig, posConfigs, publicOdooPosConfig, saveOdooPosConfig, searchProducts, syncPosOrders, testOdooPos } from "./odoo-pos.js";
import { canSeeConversation, canUseChannel, departmentItemFilter, scopeOf, type Scope } from "./access.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

/** Bọc handler async để lỗi trả về JSON thay vì treo request. */
const h =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const num = (v: unknown) => (v === undefined || v === "" || v === null ? undefined : Number(v));

function parseDate(v: unknown, endOfDay = false) {
  if (!v) return undefined;
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  // yyyy-mm-dd theo giờ Việt Nam
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${endOfDay ? "23:59:59.999" : "00:00:00"}+07:00` : s);
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

function exportFilter(q: Request["query"]): ExportFilter {
  return {
    from: parseDate(q.from),
    to: parseDate(q.to, true),
    agentId: num(q.agentId),
    conversationId: q.conversationId ? String(q.conversationId) : undefined,
    channelId: num(q.channelId),
    departmentId: num(q.departmentId),
    textOnly: q.textOnly === "1" || q.textOnly === "true",
  };
}

function sendExport(req: Request, res: Response) {
  const filter = exportFilter(req.query);
  const format = String(req.query.format ?? "json");
  const convs = buildConversations(filter);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `zalo-cskh-${filter.agentId ? `nv${filter.agentId}-` : ""}${stamp}`;
  const attach = (ext: string, type: string, body: string) => {
    res.setHeader("Content-Type", `${type}; charset=utf-8`);
    if (req.query.download !== "0") res.setHeader("Content-Disposition", `attachment; filename="${name}.${ext}"`);
    res.send(body);
  };
  if (format === "csv") return attach("csv", "text/csv", toCsv(convs));
  if (format === "txt") return attach("txt", "text/plain", toTxt(convs));
  if (format === "jsonl") return attach("jsonl", "application/x-ndjson", toJsonl(convs));
  return attach("json", "application/json", JSON.stringify({ filter, count: convs.length, conversations: convs }, null, 2));
}

function resolveAgent(req: Request): number | null {
  // Web app khác có thể ghi nhận tin gửi thay mặt một nhân viên: agent_username hoặc agent_id.
  const b = req.body ?? {};
  if (b.agent_id) return Number(b.agent_id);
  if (b.agent_username) {
    const u = get<{ id: number }>("SELECT id FROM users WHERE username = ?", String(b.agent_username));
    if (!u) throw new HttpError(400, "agent_username không tồn tại");
    return u.id;
  }
  return null;
}

// ───────────────────────── API nội bộ cho giao diện nhân viên ─────────────────────────
export const appRouter = Router();

// ── Đăng nhập: tài khoản Odoo (chính) hoặc tài khoản nội bộ (dự phòng, vd "admin") ──

const loginFailures = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 5;
const BLOCK_MS = 10 * 60_000;

function checkBlocked(key: string) {
  const f = loginFailures.get(key);
  if (f && f.until > Date.now()) {
    throw new HttpError(429, `Sai quá ${MAX_FAILS} lần. Thử lại sau ${Math.ceil((f.until - Date.now()) / 60_000)} phút.`);
  }
}
function recordFail(key: string) {
  const f = loginFailures.get(key) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + BLOCK_MS;
    f.count = 0;
  }
  loginFailures.set(key, f);
}

const USER_FIELDS = "id, username, display_name, role, auth_source, super_admin";

function issueLogin(res: Response, userId: number) {
  const user = { ...get<AuthUser>(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, userId)!, permissions: permissionsOf(userId) };
  run("UPDATE users SET last_login_at = ? WHERE id = ?", Date.now(), userId);
  logEvent(null, userId, "user.login", { source: user.auth_source });
  res.json({ token: signToken(user), user });
}

/** Tài khoản Odoo đăng nhập thành công → map sang nhân viên trong app (tạo mới ở trạng thái chờ duyệt). */
function finishOdooLogin(res: Response, odoo: OdooIdentity) {
  const login = odoo.login.trim().toLowerCase();
  let row = get<{ id: number; active: number }>(
    "SELECT id, active FROM users WHERE odoo_uid = ? OR (auth_source = 'odoo' AND lower(username) = ?) ORDER BY odoo_uid IS NULL LIMIT 1",
    odoo.uid,
    login,
  );
  if (!row) {
    const isSuper = config.superAdmins.includes(login);
    const isAdmin = isSuper || config.odooAdmins.includes(login);
    const r = run(
      `INSERT INTO users(username, password_hash, display_name, role, active, auth_source, odoo_uid, created_at, super_admin)
       VALUES(?, ?, ?, ?, ?, 'odoo', ?, ?, ${isSuper ? 1 : 0})`,
      login,
      bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 4), // không dùng: mật khẩu do Odoo quản lý
      odoo.name || login,
      isAdmin ? "admin" : "agent",
      isAdmin ? 1 : 0,
      odoo.uid,
      Date.now(),
    );
    row = { id: Number(r.lastInsertRowid), active: isAdmin ? 1 : 0 };
    if (isAdmin && !isSuper) {
      const g = get<{ id: number }>("SELECT id FROM permission_groups WHERE name = 'Quản trị'");
      if (g) run("INSERT OR IGNORE INTO user_permission_groups(user_id, group_id) VALUES(?, ?)", row.id, g.id);
    }
    logEvent(null, row.id, "user.odoo_registered", { login });
  } else {
    run("UPDATE users SET odoo_uid = ? WHERE id = ?", odoo.uid, row.id);
  }
  if (!row.active) {
    return res.status(403).json({
      error: "Tài khoản Odoo của bạn chưa được cấp quyền vào app CSKH. Báo quản trị viên duyệt trong trang Nhân viên.",
      pending_approval: true,
    });
  }
  issueLogin(res, row.id);
}

appRouter.post(
  "/auth/login",
  h(async (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!username || !password) throw new HttpError(400, "Nhập tên đăng nhập và mật khẩu");
    if (username.length > 254 || password.length > 1024) throw new HttpError(400, "Thông tin đăng nhập không hợp lệ");
    const key = `${req.ip}|${username.toLowerCase()}`;
    checkBlocked(key);

    // Tài khoản nội bộ (vd admin dự phòng khi Odoo gặp sự cố)
    const local = get<{ id: number; password_hash: string; active: number }>(
      "SELECT id, password_hash, active FROM users WHERE username = ? AND auth_source = 'local'",
      username,
    );
    if (local && bcrypt.compareSync(password, local.password_hash)) {
      if (!local.active) throw new HttpError(403, "Tài khoản đã bị khóa");
      loginFailures.delete(key);
      return issueLogin(res, local.id);
    }

    let result;
    try {
      result = await odooLogin(username, password);
    } catch (e: any) {
      throw new HttpError(502, `Không kết nối được Odoo: ${e.message}`);
    }
    if (result.status === "ok") {
      loginFailures.delete(key);
      return finishOdooLogin(res, result.user);
    }
    if (result.status === "totp_required") return res.json({ totp_required: true, pending_id: result.pendingId });
    recordFail(key);
    res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu Odoo" });
  }),
);

appRouter.post(
  "/auth/login-totp",
  h(async (req, res) => {
    const pendingId = String(req.body?.pending_id ?? "");
    const code = String(req.body?.code ?? "").trim();
    if (!pendingId || !/^\d{4,8}$/.test(code)) throw new HttpError(400, "Nhập mã OTP 6 số");
    const key = `${req.ip}|otp|${pendingId}`;
    checkBlocked(key);
    const result = await odooCompleteTotp(pendingId, code);
    if (result.status === "ok") return finishOdooLogin(res, result.user);
    if (result.status === "expired") {
      return res.status(401).json({ error: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.", expired: true });
    }
    recordFail(key);
    res.status(401).json({ error: "Mã OTP không đúng. Kiểm tra lại trên app Authenticator." });
  }),
);

// Ảnh sticker Zalo (ảnh công khai của Zalo): thẻ <img> không gửi kèm token nên không yêu cầu đăng nhập.
appRouter.get(
  "/sticker-image/:id",
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Sticker không hợp lệ");
    let row = get<{ url: string | null; updated_at: number }>("SELECT url, updated_at FROM sticker_cache WHERE id = ?", id);
    if (!row?.url) {
      const session = zalo.anyConnected();
      if (!session) throw new HttpError(503, "Chưa có kênh Zalo nào kết nối");
      const [d] = await session.stickerDetails([id]);
      if (!d?.url) throw new HttpError(404, "Không tìm thấy sticker");
      run(
        `INSERT INTO sticker_cache(id, cate_id, type, url, text, updated_at) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`,
        d.id,
        d.cateId,
        d.type,
        d.url,
        d.text,
        Date.now(),
      );
      row = { url: d.url, updated_at: Date.now() };
    }
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.redirect(302, row.url!);
  }),
);

appRouter.use(requireUser);

function workingChannels(userId: number): number[] | null {
  const row = get<{ working_channels: string | null }>("SELECT working_channels FROM users WHERE id = ?", userId);
  if (!row?.working_channels) return null;
  try {
    const list = JSON.parse(row.working_channels);
    return Array.isArray(list) ? list.map(Number).filter((n) => n > 0) : null;
  } catch {
    return null;
  }
}

appRouter.get("/auth/me", (req, res) => res.json({ ...req.user, working_channel_ids: workingChannels(req.user!.id) }));

/** Nhân viên tick chọn kênh đang chat (một hoặc nhiều). null / rỗng = mọi kênh được quyền. */
appRouter.put(
  "/me/working-channels",
  h((req, res) => {
    const scope = scopeOf(req.user!);
    const raw = req.body?.channel_ids;
    let ids: number[] | null = null;
    if (Array.isArray(raw)) {
      ids = [...new Set(raw.map(Number).filter((n) => n > 0))];
      const bad = ids.filter((id) => !canUseChannel(scope, id));
      if (bad.length) throw new HttpError(403, "Bạn không có quyền vào kênh đã chọn");
    }
    run("UPDATE users SET working_channels = ? WHERE id = ?", ids && ids.length ? JSON.stringify(ids) : null, req.user!.id);
    res.json({ working_channel_ids: ids && ids.length ? ids : null });
  }),
);

/** Phân công hàng loạt: { assignments: [{ user_id, channel_ids: [] }] } (quản lý). */
appRouter.put(
  "/channel-assignments",
  requirePerm("channels.manage"),
  h((req, res) => {
    const list = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    for (const a of list) setUserChannels(Number(a.user_id), a.channel_ids);
    res.json(withDepartments(all<{ id: number }>(`SELECT ${USER_LIST_FIELDS} FROM users ORDER BY active DESC, display_name`)));
  }),
);

appRouter.post(
  "/auth/password",
  h((req, res) => {
    if (req.user!.auth_source === "odoo") throw new HttpError(400, "Tài khoản Odoo đổi mật khẩu trên Odoo");
    const { current, next } = req.body ?? {};
    const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", req.user!.id)!;
    if (!bcrypt.compareSync(String(current ?? ""), row.password_hash)) throw new HttpError(400, "Mật khẩu hiện tại không đúng");
    if (String(next ?? "").length < 6) throw new HttpError(400, "Mật khẩu mới tối thiểu 6 ký tự");
    run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(String(next), 10), req.user!.id);
    res.json({ ok: true });
  }),
);

// Nhân viên
const USER_LIST_FIELDS = "id, username, display_name, role, active, auth_source, last_login_at, created_at, super_admin";

/**
 * Ai sửa được ai:
 * - Super Admin sửa được mọi người, cấp / bỏ Super Admin.
 * - Người có quyền "permissions.manage" cấp nhóm quyền / quyền riêng (không vượt quá quyền của chính mình).
 * - Người có "users.manage" chỉ sửa được người có ít quyền hơn hoặc bằng mình.
 */
function guardUserEdit(req: Request, targetId: number | null, body: any) {
  const me = req.user!;
  if (me.super_admin) return;
  if (body?.super_admin) throw new HttpError(403, "Chỉ Super Admin mới cấp được quyền Super Admin");
  if (targetId !== null) {
    const t = get<{ super_admin: number }>("SELECT super_admin FROM users WHERE id = ?", targetId);
    if (t?.super_admin) throw new HttpError(403, "Chỉ Super Admin mới sửa được tài khoản Super Admin");
    const extra = permissionsOf(targetId).filter((p) => !me.permissions?.includes(p));
    if (extra.length && targetId !== me.id) throw new HttpError(403, "Không sửa được người có nhiều quyền hơn bạn");
  }
  const wantsPerms = body?.group_ids !== undefined || body?.own_permissions !== undefined;
  if (wantsPerms && !can(me, "permissions.manage")) throw new HttpError(403, "Bạn chưa được cấp quyền phân quyền cho người khác");
  if (wantsPerms) {
    const granted = new Set([
      ...cleanPermissions(body?.own_permissions),
      ...all<{ permissions: string }>(
        `SELECT permissions FROM permission_groups WHERE id IN (${(Array.isArray(body?.group_ids) ? body.group_ids : []).map(Number).filter((n: number) => n > 0).join(",") || "NULL"})`,
      ).flatMap((g) => cleanPermissions(JSON.parse(g.permissions))),
    ]);
    const over = [...granted].filter((p) => !me.permissions?.includes(p));
    if (over.length) throw new HttpError(403, "Không cấp được quyền mà chính bạn không có");
  }
}

function setUserPermissions(userId: number, body: any) {
  if (Array.isArray(body?.group_ids)) {
    run("DELETE FROM user_permission_groups WHERE user_id = ?", userId);
    for (const g of new Set(body.group_ids.map(Number).filter((n: number) => n > 0))) {
      run("INSERT OR IGNORE INTO user_permission_groups(user_id, group_id) VALUES(?, ?)", userId, g as number);
    }
  }
  if (body?.own_permissions !== undefined) {
    run("UPDATE users SET permissions = ? WHERE id = ?", JSON.stringify(cleanPermissions(body.own_permissions)), userId);
  }
  syncLegacyRole(userId);
}
function withDepartments<T extends { id: number }>(rows: T[]) {
  const links = all<{ user_id: number; department_id: number }>("SELECT user_id, department_id FROM user_departments");
  const chans = all<{ user_id: number; channel_id: number }>("SELECT user_id, channel_id FROM user_channels");
  const groups = all<{ user_id: number; group_id: number }>("SELECT user_id, group_id FROM user_permission_groups");
  const own = new Map(all<{ id: number; permissions: string }>("SELECT id, permissions FROM users").map((u) => [u.id, u.permissions]));
  return rows.map((u) => ({
    ...u,
    department_ids: links.filter((l) => l.user_id === u.id).map((l) => l.department_id),
    channel_ids: chans.filter((l) => l.user_id === u.id).map((l) => l.channel_id),
    group_ids: groups.filter((l) => l.user_id === u.id).map((l) => l.group_id),
    own_permissions: cleanPermissions(JSON.parse(own.get(u.id) ?? "[]")),
    permissions: permissionsOf(u.id),
  }));
}
function setUserChannels(userId: number, channelIds: unknown) {
  if (!Array.isArray(channelIds)) return;
  run("DELETE FROM user_channels WHERE user_id = ?", userId);
  for (const c of new Set(channelIds.map(Number).filter((n) => n > 0))) {
    run("INSERT OR IGNORE INTO user_channels(user_id, channel_id) VALUES(?, ?)", userId, c);
  }
  bus.emit("settings.changed", "users");
}
function setUserDepartments(userId: number, deptIds: unknown) {
  if (!Array.isArray(deptIds)) return;
  run("DELETE FROM user_departments WHERE user_id = ?", userId);
  for (const d of new Set(deptIds.map(Number).filter((n) => n > 0))) {
    run("INSERT OR IGNORE INTO user_departments(user_id, department_id) VALUES(?, ?)", userId, d);
  }
  bus.emit("settings.changed", "users");
}
appRouter.get("/users", (_req, res) =>
  res.json(withDepartments(all<{ id: number }>(`SELECT ${USER_LIST_FIELDS} FROM users ORDER BY active DESC, display_name`))),
);
appRouter.post(
  "/users",
  requirePerm("users.manage"),
  h((req, res) => {
    const { password, display_name, role } = req.body ?? {};
    guardUserEdit(req, null, req.body);
    const source = req.body?.auth_source === "local" ? "local" : "odoo";
    let username = String(req.body?.username ?? "").trim();
    if (source === "odoo") username = username.toLowerCase();
    if (!username || !display_name) throw new HttpError(400, "Thiếu tên đăng nhập hoặc tên hiển thị");
    if (source === "local" && String(password ?? "").length < 6) throw new HttpError(400, "Mật khẩu tối thiểu 6 ký tự");
    if (get("SELECT 1 FROM users WHERE lower(username) = lower(?)", username)) throw new HttpError(400, "Tài khoản đã tồn tại");
    const r = run(
      "INSERT INTO users(username, password_hash, display_name, role, auth_source, created_at) VALUES(?, ?, ?, ?, ?, ?)",
      username,
      bcrypt.hashSync(source === "local" ? String(password) : crypto.randomBytes(24).toString("hex"), source === "local" ? 10 : 4),
      String(display_name).trim(),
      role === "admin" ? "admin" : "agent",
      source,
      Date.now(),
    );
    if (req.body?.super_admin && req.user!.super_admin) {
      run("UPDATE users SET super_admin = 1, role = 'admin' WHERE id = ?", Number(r.lastInsertRowid));
    }
    setUserDepartments(Number(r.lastInsertRowid), req.body?.department_ids);
    setUserChannels(Number(r.lastInsertRowid), req.body?.channel_ids);
    setUserPermissions(Number(r.lastInsertRowid), req.body);
    res.json(withDepartments([get<{ id: number }>(`SELECT ${USER_LIST_FIELDS} FROM users WHERE id = ?`, Number(r.lastInsertRowid))!])[0]);
  }),
);
appRouter.patch(
  "/users/:id",
  requirePerm("users.manage"),
  h((req, res) => {
    const id = Number(req.params.id);
    const { display_name, role, active, password } = req.body ?? {};
    if (id === req.user!.id && (active === false || role === "agent")) {
      throw new HttpError(400, "Không thể tự khóa hoặc tự hạ quyền tài khoản của mình");
    }
    const target = get<{ auth_source: string; role: string; super_admin: number }>(
      "SELECT auth_source, role, super_admin FROM users WHERE id = ?",
      id,
    );
    if (!target) throw new HttpError(404, "Không tìm thấy nhân viên");
    guardUserEdit(req, id, req.body);
    if (req.body?.super_admin !== undefined && req.user!.super_admin) {
      if (id === req.user!.id && !req.body.super_admin) throw new HttpError(400, "Không thể tự bỏ quyền Super Admin của mình");
      run("UPDATE users SET super_admin = ? WHERE id = ?", req.body.super_admin ? 1 : 0, id);
      if (req.body.super_admin) run("UPDATE users SET role = 'admin' WHERE id = ?", id);
    }
    if (target.super_admin && (role === "agent" || active === false) && id !== req.user!.id) {
      throw new HttpError(400, "Bỏ quyền Super Admin trước khi hạ quyền hoặc khóa tài khoản này");
    }
    if (display_name) run("UPDATE users SET display_name = ? WHERE id = ?", String(display_name), id);
    if (role) run("UPDATE users SET role = ? WHERE id = ?", role === "admin" ? "admin" : "agent", id);
    if (active !== undefined) run("UPDATE users SET active = ? WHERE id = ?", active ? 1 : 0, id);
    // Khóa nhân viên còn giữ Zalo / SĐT công ty → đánh dấu cần thu hồi
    if (active === false) onUserDeactivated(id, req.user!.id);
    if (password && target.auth_source === "local") {
      if (String(password).length < 6) throw new HttpError(400, "Mật khẩu tối thiểu 6 ký tự");
      run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(String(password), 10), id);
    }
    setUserDepartments(id, req.body?.department_ids);
    setUserChannels(id, req.body?.channel_ids);
    setUserPermissions(id, req.body);
    res.json(withDepartments([get<{ id: number }>(`SELECT ${USER_LIST_FIELDS} FROM users WHERE id = ?`, id)!])[0]);
  }),
);

// Link public hiện tại (Cloudflare Quick Tunnel đổi link mỗi lần khởi động lại)
appRouter.get("/system/public-url", (_req, res) => {
  let url: string | null = null;
  try {
    const urls = fs.readFileSync(config.tunnelLog, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    url = urls?.[urls.length - 1] ?? null;
  } catch {
    /* chưa chạy tunnel */
  }
  const fixed = process.env.PUBLIC_URL || null;
  res.json({ url: fixed ?? url, fixed: !!fixed });
});

// Kênh chat, bộ phận, tag, tin nhắn mẫu, kết nối nền tảng
appRouter.use(settingsRouter);
appRouter.use(platformRouter);

/** Lấy hội thoại và kiểm tra người đang đăng nhập có được xem không (không được xem → 404 như không tồn tại). */
function visibleConversation(req: Request, id: string) {
  const conv = getConversation(id);
  if (!conv || !canSeeConversation(scopeOf(req.user!), conv)) throw new HttpError(404, "Không tìm thấy hội thoại");
  return conv;
}

// Tìm kiếm gộp: liên hệ + tin nhắn
appRouter.get(
  "/search/contacts",
  h(async (req, res) =>
    res.json(await searchContacts(String(req.query.q ?? ""), { access: scopeOf(req.user!), channelId: num(req.query.channelId) })),
  ),
);
appRouter.get("/search/messages", (req, res) =>
  res.json(
    searchMessages(String(req.query.q ?? ""), {
      access: scopeOf(req.user!),
      before: num(req.query.before),
      limit: num(req.query.limit),
      channelId: num(req.query.channelId),
      conversationId: req.query.conversationId ? String(req.query.conversationId) : undefined,
    }),
  ),
);
appRouter.post(
  "/zalo/people/open",
  h((req, res) => {
    const conv = openConversationWith(req.body ?? {}, scopeOf(req.user!), req.user!.id);
    if (!conv.assigned_to) updateConversation(conv.id, { assigned_to: req.user!.id }, req.user!.id);
    res.json(getConversation(conv.id));
  }),
);

// Hội thoại
appRouter.get("/conversations", (req, res) =>
  res.json(
    listConversations({
      access: scopeOf(req.user!),
      userId: req.user!.id,
      scope: (req.query.scope as any) ?? "all",
      status: req.query.status as string | undefined,
      channelId: num(req.query.channelId),
      channelIds: req.query.channelIds ? String(req.query.channelIds).split(",").map(Number) : undefined,
      departmentId: req.query.departmentId === "none" ? null : num(req.query.departmentId),
      tag: req.query.tag ? String(req.query.tag) : undefined,
      q: req.query.q as string | undefined,
      type: num(req.query.type),
      before: num(req.query.before),
      limit: num(req.query.limit),
      alert: req.query.alert === "1",
    }),
  ),
);

// ───────────── Cảnh báo đơn "rơi" ─────────────
appRouter.get("/alerts", (req, res) => res.json(listAlerts(scopeOf(req.user!))));
appRouter.post("/alerts/:id/resolve", (req, res) => {
  const id = Number(req.params.id);
  const a = get<{ conversation_id: string }>("SELECT conversation_id FROM conversation_alerts WHERE id = ?", id);
  const conv = a ? getConversation(a.conversation_id) : null;
  if (!conv || !canSeeConversation(scopeOf(req.user!), conv)) return res.status(404).json({ error: "Không tìm thấy cảnh báo" });
  resolveAlert(id, req.user!.id, typeof req.body?.note === "string" ? req.body.note : undefined);
  res.json({ ok: true });
});
appRouter.get("/alerts/config", (_req, res) => res.json(alertConfig()));
appRouter.put("/alerts/config", requirePerm("alerts.manage"), (req, res) => res.json(saveAlertConfig(req.body, req.user!)));

// ───────────── Zalo & SĐT công ty cấp cho nhân viên ─────────────
const zaloChannel = (id: number) => get<{ id: number }>("SELECT id FROM channels WHERE id = ? AND platform = 'zalo'", id);
appRouter.get("/company-accounts", requirePerm("channels.manage"), (_req, res) =>
  res.json({ accounts: listAccounts(), statuses: ASSET_STATUS, checklist: REVOKE_CHECKLIST }),
);
appRouter.patch("/company-accounts/:id", requirePerm("channels.manage"), (req, res) => {
  const id = Number(req.params.id);
  if (!zaloChannel(id)) return res.status(404).json({ error: "Không tìm thấy tài khoản Zalo" });
  updateAsset(id, req.body, req.user!.id);
  res.json({ ok: true });
});
appRouter.post("/company-accounts/:id/handover", requirePerm("channels.manage"), (req, res) => {
  const id = Number(req.params.id);
  if (!zaloChannel(id)) return res.status(404).json({ error: "Không tìm thấy tài khoản Zalo" });
  const toUserId = req.body?.user_id ? Number(req.body.user_id) : null;
  if (toUserId && !get("SELECT 1 FROM users WHERE id = ? AND active = 1", toUserId)) return res.status(400).json({ error: "Nhân viên không tồn tại hoặc đã bị khóa" });
  try {
    res.json(
      handover(id, { toUserId, note: req.body?.note, checklist: req.body?.checklist, reassign: req.body?.reassign !== false }, req.user!.id),
    );
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});
appRouter.get("/company-accounts/:id/history", requirePerm("channels.manage"), (req, res) => res.json(accountHistory(Number(req.params.id))));
/** Tài khoản Zalo công ty một nhân viên đang giữ (hiện trong hồ sơ nhân viên) */
appRouter.get("/users/:id/company-accounts", requirePerm("users.manage"), (req, res) => res.json(accountsHeldBy(Number(req.params.id))));
appRouter.get("/me/company-accounts", (req, res) => res.json(accountsHeldBy(req.user!.id)));

// ───────────── Đơn hàng (Sapo / API) ─────────────
appRouter.get("/conversations/:id/orders", (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv || !canSeeConversation(scopeOf(req.user!), conv)) return res.status(404).json({ error: "Không tìm thấy hội thoại" });
  res.json(ordersOfConversation(conv.id));
});
appRouter.post("/orders/:id/link", requirePerm("conversations.assign"), (req, res) => {
  const conversationId = req.body?.conversation_id ? String(req.body.conversation_id) : null;
  if (conversationId) {
    const conv = getConversation(conversationId);
    if (!conv || !canSeeConversation(scopeOf(req.user!), conv)) return res.status(404).json({ error: "Không tìm thấy hội thoại" });
  }
  linkOrder(Number(req.params.id), conversationId, req.user!.id);
  res.json({ ok: true });
});
// ───────────── Lên đơn POS trên Odoo ─────────────
appRouter.get("/odoo-pos/config", requirePerm("integrations.manage"), (_req, res) => res.json(publicOdooPosConfig()));
appRouter.put(
  "/odoo-pos/config",
  requirePerm("integrations.manage"),
  h((req, res) => {
    try {
      res.json(saveOdooPosConfig(req.body, req.user!.id));
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }),
);
appRouter.post(
  "/odoo-pos/test",
  requirePerm("integrations.manage"),
  h(async (req, res) => {
    try {
      res.json(await testOdooPos(req.body));
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }),
);
appRouter.post(
  "/odoo-pos/sync",
  requirePerm("integrations.manage"),
  h(async (_req, res) => {
    try {
      await syncPosOrders();
    } catch (e: any) {
      throw new HttpError(502, e.message);
    }
    res.json(publicOdooPosConfig());
  }),
);
/** Nhân viên: có bật lên đơn POS không + danh sách điểm bán */
appRouter.get(
  "/odoo-pos/status",
  h(async (req, res) => {
    const cfg = odooPosConfig();
    if (!cfg.enabled || !can(req.user, "orders.create")) return res.json({ enabled: false, configs: [], defaultConfigId: null });
    let configs: Awaited<ReturnType<typeof posConfigs>> = [];
    try {
      configs = await posConfigs();
    } catch (e: any) {
      return res.json({ enabled: true, configs: [], defaultConfigId: cfg.configId, error: e.message });
    }
    res.json({ enabled: true, configs, defaultConfigId: cfg.configId });
  }),
);
appRouter.get(
  "/odoo-pos/products",
  requirePerm("orders.create"),
  h(async (req, res) => {
    try {
      res.json(await searchProducts(String(req.query.q ?? "")));
    } catch (e: any) {
      throw new HttpError(502, e.message);
    }
  }),
);
appRouter.post(
  "/conversations/:id/pos-orders",
  requirePerm("orders.create"),
  h(async (req, res) => {
    const conv = getConversation(req.params.id);
    if (!conv || !canSeeConversation(scopeOf(req.user!), conv)) throw new HttpError(404, "Không tìm thấy hội thoại");
    const b = req.body ?? {};
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .map((l: any) => ({ productId: Number(l.productId), name: String(l.name ?? ""), qty: Number(l.qty), price: Number(l.price), discount: Number(l.discount ?? 0) }))
      .filter((l: any) => l.productId > 0 && l.qty > 0 && l.price >= 0 && l.discount >= 0 && l.discount <= 100);
    const odooUid = get<{ odoo_uid: number | null }>("SELECT odoo_uid FROM users WHERE id = ?", req.user!.id)?.odoo_uid ?? null;
    try {
      res.json(
        await createPosOrder({
          conversationId: conv.id,
          platform: (conv as any).platform ?? "zalo",
          configId: Number(b.configId) || odooPosConfig().configId || 0,
          customer: { name: String(b.customer?.name ?? conv.name ?? "").trim(), phone: String(b.customer?.phone ?? conv.phone ?? "").trim(), address: b.customer?.address ?? null },
          lines,
          note: typeof b.note === "string" ? b.note.slice(0, 1000) : null,
          agent: { id: req.user!.id, name: req.user!.display_name, odooUid },
        }),
      );
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }),
);

appRouter.get("/sapo/config", requirePerm("integrations.manage"), (_req, res) => res.json(publicSapoConfig()));
appRouter.put("/sapo/config", requirePerm("integrations.manage"), (req, res) => {
  try {
    res.json(saveSapoConfig(req.body, req.user!.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

appRouter.get(
  "/conversations/:id",
  h((req, res) => {
    // Link cũ /?c=<threadId> (trước khi có nhiều kênh): tìm theo threadId trong các kênh được xem.
    const conv = getConversation(req.params.id)
      ? visibleConversation(req, req.params.id)
      : (() => {
          const scope = scopeOf(req.user!);
          const row = all<{ id: string; channel_id: number; department_id: number | null }>(
            "SELECT id, channel_id, department_id FROM conversations WHERE thread_id = ? ORDER BY channel_id",
            req.params.id,
          ).find((c) => canSeeConversation(scope, c));
          if (!row) throw new HttpError(404, "Không tìm thấy hội thoại");
          return getConversation(row.id)!;
        })();
    res.json(conv);
  }),
);
appRouter.patch(
  "/conversations/:id",
  h((req, res) => {
    const current = visibleConversation(req, req.params.id);
    const patch = { ...(req.body ?? {}) };
    if (!can(req.user, "conversations.assign")) {
      // Nhân viên thường: nhận hội thoại chưa ai phụ trách, hoặc nhả/chuyển hội thoại của chính mình.
      if (patch.assigned_to !== undefined) {
        const ok = current.assigned_to === req.user!.id || (current.assigned_to == null && patch.assigned_to === req.user!.id);
        if (!ok) throw new HttpError(403, "Hội thoại đang do người khác phụ trách");
      }
      // Chuyển bộ phận: chỉ người phụ trách hoặc khi chưa ai nhận.
      if (patch.department_id !== undefined && current.assigned_to && current.assigned_to !== req.user!.id) {
        throw new HttpError(403, "Chỉ người phụ trách mới chuyển được bộ phận");
      }
    }
    if (patch.tags) {
      // Chỉ gắn được tag đã tạo trong Cài đặt và thuộc bộ phận của mình (giữ nguyên tag cũ đã có).
      const allowed = new Set(
        all<{ name: string }>(`SELECT t.name FROM tags t WHERE ${departmentItemFilter(scopeOf(req.user!), "tag_departments", "tag_id", "t")}`).map(
          (t) => t.name,
        ),
      );
      const bad = (patch.tags as string[]).filter((t) => !allowed.has(t) && !current.tags.includes(t));
      if (bad.length) throw new HttpError(400, `Tag không có trong danh sách: ${bad.join(", ")}`);
    }
    res.json(updateConversation(req.params.id, patch, req.user!.id));
  }),
);
appRouter.post(
  "/conversations/:id/read",
  h((req, res) => {
    visibleConversation(req, req.params.id);
    markRead(req.params.id);
    res.json({ ok: true });
  }),
);
appRouter.get(
  "/conversations/:id/messages",
  h((req, res) => {
    visibleConversation(req, req.params.id);
    res.json(
      listMessages(req.params.id, { before: num(req.query.before), limit: num(req.query.limit), around: num(req.query.around) }),
    );
  }),
);
appRouter.post(
  "/conversations/:id/messages",
  upload.array("files", 10),
  h(async (req, res) => {
    visibleConversation(req, req.params.id);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const messages = await sendToConversation({
      conversationId: req.params.id,
      text: req.body?.text,
      files,
      agentId: req.user!.id,
      source: "web",
      quoteMessageId: num(req.body?.quote_message_id),
      mode: req.body?.mode === "private" ? "private" : "public",
    });
    res.json(messages);
  }),
);

// Sticker
appRouter.get(
  "/stickers/search",
  h(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json([]);
    const scope = scopeOf(req.user!);
    const channelId = num(req.query.channelId);
    const session =
      channelId && canUseChannel(scope, channelId) && zalo.session(channelId).platform === "zalo" && zalo.session(channelId).connected
        ? zalo.zaloSession(channelId)
        : zalo.anyConnected();
    if (!session) throw new HttpError(503, "Chưa có kênh Zalo nào kết nối");
    const list = await session.searchStickers(q);
    for (const st of list) {
      if (st.url)
        run(
          `INSERT INTO sticker_cache(id, cate_id, type, url, text, updated_at) VALUES(?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`,
          st.id,
          st.cateId,
          st.type,
          st.url,
          st.text,
          Date.now(),
        );
    }
    res.json(list);
  }),
);
appRouter.post(
  "/conversations/:id/sticker",
  h(async (req, res) => {
    const conv = visibleConversation(req, req.params.id);
    const sticker = { id: Number(req.body?.id), cateId: Number(req.body?.cateId), type: Number(req.body?.type) };
    if (!sticker.id || !sticker.cateId) throw new HttpError(400, "Sticker không hợp lệ");
    const message = await connectedSession(conv).sendSticker({
      threadId: conv.thread_id,
      isGroup: conv.type === 1,
      sticker,
      agentId: req.user!.id,
      source: "web",
    });
    if (!conv.assigned_to) updateConversation(conv.id, { assigned_to: req.user!.id }, req.user!.id);
    res.json(message);
  }),
);

// Thao tác trên tin nhắn: thả cảm xúc, thu hồi, chuyển tiếp (như menu tin nhắn của Zalo PC)
appRouter.post(
  "/conversations/:id/messages/:mid/reaction",
  h(async (req, res) => {
    const conv = visibleConversation(req, req.params.id);
    const msg = messageInConversation(conv.id, Number(req.params.mid));
    const icon = String(req.body?.icon ?? "");
    await connectedSession(conv).react({ threadId: conv.thread_id, isGroup: conv.type === 1, message: msg, icon });
    res.json(setReaction(msg.id, { uid: `shop:${conv.channel_id}`, name: req.user!.display_name, agentId: req.user!.id }, icon));
  }),
);
appRouter.post(
  "/conversations/:id/messages/:mid/undo",
  h(async (req, res) => {
    const conv = visibleConversation(req, req.params.id);
    const msg = messageInConversation(conv.id, Number(req.params.mid));
    if (msg.direction !== "out") throw new HttpError(400, "Chỉ thu hồi được tin của shop");
    if (msg.undone) throw new HttpError(400, "Tin đã được thu hồi");
    if (!can(req.user, "messages.undo_any") && msg.agent_id !== req.user!.id) {
      throw new HttpError(403, "Chỉ người gửi hoặc quản trị viên mới thu hồi được tin này");
    }
    await connectedSession(conv).undo({ threadId: conv.thread_id, isGroup: conv.type === 1, message: msg });
    logEvent(conv.id, req.user!.id, "message.undo", { message_id: msg.id });
    res.json({ ok: true });
  }),
);
appRouter.post(
  "/conversations/:id/messages/:mid/forward",
  h(async (req, res) => {
    const conv = visibleConversation(req, req.params.id);
    const msg = messageInConversation(conv.id, Number(req.params.mid));
    const text = (msg.text ?? "").trim();
    if (!text || (msg.msg_type && msg.msg_type !== "webchat")) throw new HttpError(400, "Hiện chỉ chuyển tiếp được tin nhắn chữ");
    const ids: string[] = Array.isArray(req.body?.conversation_ids) ? req.body.conversation_ids.map(String) : [];
    if (!ids.length) throw new HttpError(400, "Chọn hội thoại để chuyển tiếp");
    if (ids.length > 20) throw new HttpError(400, "Mỗi lần chuyển tiếp tối đa 20 hội thoại");
    const targets = ids.map((id) => visibleConversation(req, id));
    if (targets.some((t) => t.channel_id !== conv.channel_id)) {
      throw new HttpError(400, "Chỉ chuyển tiếp được trong cùng một kênh Zalo");
    }
    const results = await connectedSession(conv).forward({
      text,
      targets: targets.map((t) => ({ threadId: t.thread_id, isGroup: t.type === 1 })),
      agentId: req.user!.id,
      source: "web",
    });
    res.json(results.map((r: { threadId: string; ok: boolean; error?: string }) => ({ ...r, conversation_id: targets.find((t) => t.thread_id === r.threadId)?.id })));
  }),
);
appRouter.get(
  "/conversations/:id/notes",
  h((req, res) => {
    visibleConversation(req, req.params.id);
    res.json(
      all(
        `SELECT n.*, u.display_name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id
         WHERE n.conversation_id = ? ORDER BY n.created_at DESC`,
        req.params.id,
      ),
    );
  }),
);
appRouter.post(
  "/conversations/:id/notes",
  h((req, res) => {
    const content = String(req.body?.content ?? "").trim();
    if (!content) throw new HttpError(400, "Ghi chú trống");
    visibleConversation(req, req.params.id);
    const r = run(
      "INSERT INTO notes(conversation_id, user_id, content, created_at) VALUES(?, ?, ?, ?)",
      req.params.id,
      req.user!.id,
      content,
      Date.now(),
    );
    res.json(
      get(
        "SELECT n.*, u.display_name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = ?",
        Number(r.lastInsertRowid),
      ),
    );
  }),
);
appRouter.get(
  "/conversations/:id/reviews",
  h((req, res) => {
    visibleConversation(req, req.params.id);
    res.json(
      all(
        `SELECT r.*, rv.display_name AS reviewer, a.display_name AS agent FROM reviews r
         LEFT JOIN users rv ON rv.id = r.reviewer_id LEFT JOIN users a ON a.id = r.agent_id
         WHERE r.conversation_id = ? ORDER BY r.created_at DESC`,
        req.params.id,
      ),
    );
  }),
);
appRouter.post(
  "/conversations/:id/reviews",
  requirePerm("reviews.manage"),
  h((req, res) => {
    const score = Number(req.body?.score);
    if (!(score >= 1 && score <= 5)) throw new HttpError(400, "Điểm từ 1 đến 5");
    const conv = visibleConversation(req, req.params.id);
    const agentId = num(req.body?.agent_id) ?? conv.assigned_to ?? null;
    run(
      "INSERT INTO reviews(conversation_id, reviewer_id, agent_id, score, comment, created_at) VALUES(?, ?, ?, ?, ?, ?)",
      req.params.id,
      req.user!.id,
      agentId,
      score,
      String(req.body?.comment ?? "").trim() || null,
      Date.now(),
    );
    res.json({ ok: true });
  }),
);

// Dữ liệu: báo cáo & xuất hội thoại — chỉ quản lý
appRouter.get("/stats", requirePerm("data.view"), (req, res) => res.json(agentStats(exportFilter(req.query))));
appRouter.get("/export", requirePerm("data.export"), (req, res) => sendExport(req, res));

// Tích hợp: API key + webhook (chỉ admin)
appRouter.get("/api-keys", requirePerm("integrations.manage"), (_req, res) =>
  res.json(all("SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY id DESC")),
);
appRouter.post(
  "/api-keys",
  requirePerm("integrations.manage"),
  h((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new HttpError(400, "Đặt tên cho API key (vd: tên web app)");
    const k = generateApiKey();
    run("INSERT INTO api_keys(name, prefix, key_hash, created_at) VALUES(?, ?, ?, ?)", name, k.prefix, k.hash, Date.now());
    // Key chỉ hiển thị một lần.
    res.json({ name, key: k.key, prefix: k.prefix });
  }),
);
appRouter.delete("/api-keys/:id", requirePerm("integrations.manage"), (req, res) => {
  run("DELETE FROM api_keys WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});
appRouter.get("/webhooks", requirePerm("integrations.manage"), (_req, res) =>
  res.json(all("SELECT * FROM webhooks ORDER BY id DESC").map((w) => ({ ...w, events: JSON.parse(w.events) }))),
);
appRouter.get("/webhook-events", requirePerm("integrations.manage"), (_req, res) => res.json(WEBHOOK_EVENTS));
appRouter.post(
  "/webhooks",
  requirePerm("integrations.manage"),
  h((req, res) => {
    const url = String(req.body?.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new HttpError(400, "URL phải bắt đầu bằng http:// hoặc https://");
    const events = Array.isArray(req.body?.events) && req.body.events.length ? req.body.events : ["*"];
    const secret = crypto.randomBytes(24).toString("hex");
    const r = run(
      "INSERT INTO webhooks(url, secret, events, created_at) VALUES(?, ?, ?, ?)",
      url,
      secret,
      JSON.stringify(events),
      Date.now(),
    );
    res.json({ id: Number(r.lastInsertRowid), url, secret, events });
  }),
);
appRouter.patch("/webhooks/:id", requirePerm("integrations.manage"), (req, res) => {
  const { active, events } = req.body ?? {};
  if (active !== undefined) run("UPDATE webhooks SET active = ? WHERE id = ?", active ? 1 : 0, Number(req.params.id));
  if (Array.isArray(events)) run("UPDATE webhooks SET events = ? WHERE id = ?", JSON.stringify(events), Number(req.params.id));
  res.json({ ok: true });
});
appRouter.delete("/webhooks/:id", requirePerm("integrations.manage"), (req, res) => {
  run("DELETE FROM webhooks WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});
appRouter.post("/webhooks/test", requirePerm("integrations.manage"), (_req, res) => {
  dispatch("ping", { message: "Kết nối webhook thành công", at: new Date().toISOString() });
  res.json({ ok: true });
});

// Nhóm quyền
appRouter.get("/permissions", (_req, res) => res.json(PERMISSIONS));
appRouter.get("/permission-groups", (_req, res) => {
  const members = all<{ group_id: number; user_id: number }>("SELECT group_id, user_id FROM user_permission_groups");
  res.json(
    all<{ id: number; name: string; description: string | null; permissions: string }>(
      "SELECT id, name, description, permissions FROM permission_groups ORDER BY name",
    ).map((g) => ({
      ...g,
      permissions: cleanPermissions(JSON.parse(g.permissions)),
      user_ids: members.filter((m) => m.group_id === g.id).map((m) => m.user_id),
    })),
  );
});
function saveGroup(req: Request, id: number | null) {
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  const perms = req.body?.permissions !== undefined ? cleanPermissions(req.body.permissions) : undefined;
  if (perms && !req.user!.super_admin) {
    const over = perms.filter((p) => !req.user!.permissions?.includes(p));
    if (over.length) throw new HttpError(403, "Không đưa vào nhóm quyền mà chính bạn không có");
  }
  if (id === null) {
    if (!name) throw new HttpError(400, "Đặt tên nhóm quyền");
    if (get("SELECT 1 FROM permission_groups WHERE lower(name) = lower(?)", name)) throw new HttpError(400, "Nhóm quyền đã tồn tại");
    id = Number(
      run(
        "INSERT INTO permission_groups(name, description, permissions, created_at) VALUES(?, ?, ?, ?)",
        name,
        String(req.body?.description ?? "").trim() || null,
        JSON.stringify(perms ?? []),
        Date.now(),
      ).lastInsertRowid,
    );
  } else {
    if (!get("SELECT 1 FROM permission_groups WHERE id = ?", id)) throw new HttpError(404, "Không tìm thấy nhóm quyền");
    if (name !== undefined) {
      if (!name) throw new HttpError(400, "Tên nhóm không được trống");
      run("UPDATE permission_groups SET name = ? WHERE id = ?", name, id);
    }
    if (req.body?.description !== undefined) run("UPDATE permission_groups SET description = ? WHERE id = ?", String(req.body.description).trim() || null, id);
    if (perms) run("UPDATE permission_groups SET permissions = ? WHERE id = ?", JSON.stringify(perms), id);
  }
  if (Array.isArray(req.body?.user_ids)) {
    run("DELETE FROM user_permission_groups WHERE group_id = ?", id);
    for (const u of new Set(req.body.user_ids.map(Number).filter((n: number) => n > 0))) {
      run("INSERT OR IGNORE INTO user_permission_groups(user_id, group_id) VALUES(?, ?)", u as number, id);
    }
  }
  for (const u of all<{ id: number }>("SELECT id FROM users")) syncLegacyRole(u.id);
  bus.emit("settings.changed", "users");
  return id;
}
appRouter.post("/permission-groups", requirePerm("permissions.manage"), h((req, res) => res.json({ id: saveGroup(req, null) })));
appRouter.patch(
  "/permission-groups/:id",
  requirePerm("permissions.manage"),
  h((req, res) => res.json({ id: saveGroup(req, Number(req.params.id)) })),
);
appRouter.delete("/permission-groups/:id", requirePerm("permissions.manage"), (req, res) => {
  run("DELETE FROM permission_groups WHERE id = ?", Number(req.params.id));
  for (const u of all<{ id: number }>("SELECT id FROM users")) syncLegacyRole(u.id);
  bus.emit("settings.changed", "users");
  res.json({ ok: true });
});

// Nhật ký hệ thống (Super Admin): xem nhanh, tải file để gửi kiểm tra lỗi
appRouter.get("/logs", requirePerm("logs.view"), (req, res) =>
  res.json(
    recentLogs({
      level: req.query.level ? String(req.query.level) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      limit: num(req.query.limit),
    }),
  ),
);
appRouter.get("/logs/download", requirePerm("logs.view"), (req, res) => {
  const days = num(req.query.days) ?? 3;
  const v = appVersion();
  const header = [
    "Chat Siêu Tốc — nhật ký hệ thống",
    `Tải lúc: ${new Date().toISOString()}`,
    `Phiên bản: ${v.version} (máy chủ ${v.commit || "?"}, giao diện ${v.web?.buildId ?? "?"})`,
    `Máy: ${os.hostname()} · ${os.platform()} ${os.release()} · Node ${process.version} · chạy từ ${v.startedAt}`,
    `RAM trống: ${Math.round(os.freemem() / 1048576)}MB / ${Math.round(os.totalmem() / 1048576)}MB`,
    "Kênh Zalo:",
    ...zalo.statuses().map((s) => `  - #${s.channelId} ${s.channelName}: ${s.state}${s.error ? ` (${s.error})` : ""}`),
    "",
  ].join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nhat-ky-zalo-cskh-${stamp}.txt"`);
  res.send(header + "\n" + logFilesText(days));
});
/** Lỗi phía trình duyệt của nhân viên gửi về để ghi chung vào nhật ký. */
appRouter.post("/client-log", (req, res) => {
  const b = req.body ?? {};
  const msg = redact(String(b.message ?? "").slice(0, 2000));
  const stack = redact(String(b.stack ?? "").slice(0, 4000));
  console.error(`[web] ${req.user!.display_name} (#${req.user!.id}) @ ${String(b.url ?? "").slice(0, 300)}: ${msg}${stack ? "\n" + stack : ""}`);
  res.json({ ok: true });
});

// ───────────────────────── API công khai cho web app khác (X-API-Key, thấy toàn bộ) ─────────────────────────
export const publicRouter = Router();
publicRouter.use(requireApiKey);
const FULL: Scope = { all: true };

publicRouter.get("/status", (_req, res) => {
  res.json({
    channels: zalo.statuses().map((s) => ({ channel_id: s.channelId, name: s.channelName, state: s.state, account: s.account ?? null })),
  });
});
publicRouter.get("/channels", (_req, res) => res.json(all("SELECT id, name, zalo_uid, zalo_name, default_department_id FROM channels WHERE active = 1")));
publicRouter.get("/departments", (_req, res) => res.json(all("SELECT id, name, color FROM departments ORDER BY name")));
publicRouter.get("/users", (_req, res) =>
  res.json(all("SELECT id, username, display_name, role FROM users WHERE active = 1 ORDER BY display_name")),
);
publicRouter.get(
  "/search/contacts",
  h(async (req, res) => res.json(await searchContacts(String(req.query.q ?? ""), { access: FULL, channelId: num(req.query.channelId) }))),
);
publicRouter.get("/search/messages", (req, res) =>
  res.json(
    searchMessages(String(req.query.q ?? ""), {
      access: FULL,
      before: num(req.query.before),
      limit: num(req.query.limit),
      channelId: num(req.query.channelId),
      conversationId: req.query.conversationId ? String(req.query.conversationId) : undefined,
    }),
  ),
);
publicRouter.post(
  "/zalo/people/open",
  h((req, res) => res.json(openConversationWith(req.body ?? {}, FULL, null))),
);
/** Hệ thống khác (Sapo, Odoo, web bán hàng…) đẩy đơn hàng vào để gắn với hội thoại và tắt cảnh báo "chưa tạo đơn". */
publicRouter.post("/orders", (req, res) => {
  const b = req.body ?? {};
  if (!b.external_id) return res.status(400).json({ error: "Thiếu external_id (mã đơn bên hệ thống của bạn)" });
  res.json(
    upsertOrder({
      source: String(b.source ?? "api").slice(0, 30),
      external_id: String(b.external_id),
      code: b.code ?? null,
      conversation_id: b.conversation_id ?? null,
      customer_phone: b.customer_phone ?? b.phone ?? null,
      customer_name: b.customer_name ?? null,
      status: b.status ?? null,
      fulfillment_status: b.fulfillment_status ?? null,
      total: b.total !== undefined ? Number(b.total) : null,
      created_at: b.created_at ? Number(new Date(b.created_at)) : null,
      raw: b.raw,
    }),
  );
});

publicRouter.get("/conversations", (req, res) =>
  res.json(
    listConversations({
      access: FULL,
      scope: req.query.unassigned === "1" ? "unassigned" : "all",
      status: req.query.status as string | undefined,
      channelId: num(req.query.channelId),
      departmentId: num(req.query.departmentId),
      tag: req.query.tag ? String(req.query.tag) : undefined,
      q: req.query.q as string | undefined,
      type: num(req.query.type),
      before: num(req.query.before),
      limit: num(req.query.limit),
    }),
  ),
);
publicRouter.get("/conversations/by-ref/:ref", (req, res) => {
  const row = get<{ id: string }>("SELECT id FROM conversations WHERE external_ref = ?", req.params.ref);
  if (!row) return res.status(404).json({ error: "Không có hội thoại gắn mã này" });
  res.json(getConversation(row.id));
});
publicRouter.get("/conversations/:id", (req, res) => {
  const c = getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: "Không tìm thấy hội thoại" });
  res.json(c);
});
publicRouter.patch(
  "/conversations/:id",
  h((req, res) => res.json(updateConversation(req.params.id, req.body ?? {}, null))),
);
publicRouter.get("/conversations/:id/messages", (req, res) =>
  res.json(listMessages(req.params.id, { before: num(req.query.before), limit: num(req.query.limit) })),
);
publicRouter.post(
  "/conversations/:id/messages",
  upload.array("files", 10),
  h(async (req, res) => {
    const messages = await sendToConversation({
      conversationId: req.params.id,
      text: req.body?.text,
      files: (req.files as Express.Multer.File[] | undefined) ?? [],
      agentId: resolveAgent(req),
      source: "api",
    });
    res.json(messages);
  }),
);
publicRouter.post(
  "/conversations/:id/notes",
  h((req, res) => {
    const content = String(req.body?.content ?? "").trim();
    if (!content) throw new HttpError(400, "Ghi chú trống");
    if (!getConversation(req.params.id)) throw new HttpError(404, "Không tìm thấy hội thoại");
    run(
      "INSERT INTO notes(conversation_id, user_id, content, created_at) VALUES(?, ?, ?, ?)",
      req.params.id,
      null,
      `[${req.apiKey!.name}] ${content}`,
      Date.now(),
    );
    const conv = getConversation(req.params.id)!;
    bus.emit("conversation.updated", conv);
    res.json({ ok: true });
  }),
);
publicRouter.get("/stats", (req, res) => res.json(agentStats(exportFilter(req.query))));
publicRouter.get("/export", sendExport);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : err?.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err?.message ?? "Lỗi máy chủ" });
}
