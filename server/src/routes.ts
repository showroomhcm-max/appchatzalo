import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { odooLogin, odooCompleteTotp, type OdooIdentity } from "./odoo.js";
import multer from "multer";
import fs from "node:fs";
import { config } from "./config.js";
import { all, get, run, logEvent } from "./db.js";
import { generateApiKey, requireAdmin, requireApiKey, requireUser, signToken, type AuthUser } from "./auth.js";
import { zalo } from "./zalo.js";
import { getConversation, listConversations, listMessages } from "./store.js";
import { HttpError, markRead, sendToConversation, updateConversation } from "./conversations.js";
import { agentStats, buildConversations, toCsv, toJsonl, toTxt, type ExportFilter } from "./analytics.js";
import { WEBHOOK_EVENTS, dispatch } from "./webhooks.js";
import { bus } from "./bus.js";

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

const USER_FIELDS = "id, username, display_name, role, auth_source";

function issueLogin(res: Response, userId: number) {
  const user = get<AuthUser>(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, userId)!;
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
    const isAdmin = config.odooAdmins.includes(login);
    const r = run(
      `INSERT INTO users(username, password_hash, display_name, role, active, auth_source, odoo_uid, created_at)
       VALUES(?, ?, ?, ?, ?, 'odoo', ?, ?)`,
      login,
      bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 4), // không dùng: mật khẩu do Odoo quản lý
      odoo.name || login,
      isAdmin ? "admin" : "agent",
      isAdmin ? 1 : 0,
      odoo.uid,
      Date.now(),
    );
    row = { id: Number(r.lastInsertRowid), active: isAdmin ? 1 : 0 };
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

appRouter.use(requireUser);

appRouter.get("/auth/me", (req, res) => res.json(req.user));

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
const USER_LIST_FIELDS = "id, username, display_name, role, active, auth_source, last_login_at, created_at";
appRouter.get("/users", (_req, res) =>
  res.json(all(`SELECT ${USER_LIST_FIELDS} FROM users ORDER BY active DESC, display_name`)),
);
appRouter.post(
  "/users",
  requireAdmin,
  h((req, res) => {
    const { password, display_name, role } = req.body ?? {};
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
    res.json(get(`SELECT ${USER_LIST_FIELDS} FROM users WHERE id = ?`, Number(r.lastInsertRowid)));
  }),
);
appRouter.patch(
  "/users/:id",
  requireAdmin,
  h((req, res) => {
    const id = Number(req.params.id);
    const { display_name, role, active, password } = req.body ?? {};
    if (id === req.user!.id && (active === false || role === "agent")) {
      throw new HttpError(400, "Không thể tự khóa hoặc tự hạ quyền tài khoản của mình");
    }
    const target = get<{ auth_source: string }>("SELECT auth_source FROM users WHERE id = ?", id);
    if (!target) throw new HttpError(404, "Không tìm thấy nhân viên");
    if (display_name) run("UPDATE users SET display_name = ? WHERE id = ?", String(display_name), id);
    if (role) run("UPDATE users SET role = ? WHERE id = ?", role === "admin" ? "admin" : "agent", id);
    if (active !== undefined) run("UPDATE users SET active = ? WHERE id = ?", active ? 1 : 0, id);
    if (password && target.auth_source === "local") {
      if (String(password).length < 6) throw new HttpError(400, "Mật khẩu tối thiểu 6 ký tự");
      run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(String(password), 10), id);
    }
    res.json(get(`SELECT ${USER_LIST_FIELDS} FROM users WHERE id = ?`, id));
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

// Kết nối Zalo
appRouter.get("/zalo/status", (_req, res) => res.json(zalo.getStatus()));
appRouter.post("/zalo/login-qr", requireAdmin, (_req, res) => {
  void zalo.startQRLogin();
  res.json({ ok: true });
});
appRouter.post("/zalo/cancel", requireAdmin, (_req, res) => {
  zalo.cancelQR();
  res.json({ ok: true });
});
appRouter.post(
  "/zalo/reconnect",
  requireAdmin,
  h(async (_req, res) => {
    await zalo.logout(false);
    await zalo.init();
    res.json(zalo.getStatus());
  }),
);
appRouter.post(
  "/zalo/logout",
  requireAdmin,
  h(async (_req, res) => {
    await zalo.logout(true);
    res.json({ ok: true });
  }),
);

// Hội thoại
appRouter.get("/conversations", (req, res) =>
  res.json(
    listConversations({
      userId: req.user!.id,
      scope: (req.query.scope as any) ?? "all",
      status: req.query.status as string | undefined,
      q: req.query.q as string | undefined,
      type: num(req.query.type),
      before: num(req.query.before),
      limit: num(req.query.limit),
    }),
  ),
);
appRouter.get("/conversations/:id", (req, res) => {
  const c = getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: "Không tìm thấy hội thoại" });
  res.json(c);
});
appRouter.patch(
  "/conversations/:id",
  h((req, res) => {
    const patch = { ...(req.body ?? {}) };
    // Nhân viên thường: nhận hội thoại chưa ai phụ trách, hoặc nhả/chuyển hội thoại của chính mình.
    // Giành hội thoại của người khác cần quyền admin.
    if (req.user!.role !== "admin" && patch.assigned_to !== undefined) {
      const current = getConversation(req.params.id);
      const ok =
        current?.assigned_to === req.user!.id || (current?.assigned_to == null && patch.assigned_to === req.user!.id);
      if (!ok) throw new HttpError(403, "Hội thoại đang do người khác phụ trách");
    }
    res.json(updateConversation(req.params.id, patch, req.user!.id));
  }),
);
appRouter.post("/conversations/:id/read", (req, res) => {
  markRead(req.params.id);
  res.json({ ok: true });
});
appRouter.get("/conversations/:id/messages", (req, res) =>
  res.json(listMessages(req.params.id, { before: num(req.query.before), limit: num(req.query.limit) })),
);
appRouter.post(
  "/conversations/:id/messages",
  upload.array("files", 10),
  h(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const messages = await sendToConversation({
      conversationId: req.params.id,
      text: req.body?.text,
      files,
      agentId: req.user!.id,
      source: "web",
    });
    res.json(messages);
  }),
);
appRouter.get("/conversations/:id/notes", (req, res) =>
  res.json(
    all(
      `SELECT n.*, u.display_name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id
       WHERE n.conversation_id = ? ORDER BY n.created_at DESC`,
      req.params.id,
    ),
  ),
);
appRouter.post(
  "/conversations/:id/notes",
  h((req, res) => {
    const content = String(req.body?.content ?? "").trim();
    if (!content) throw new HttpError(400, "Ghi chú trống");
    if (!getConversation(req.params.id)) throw new HttpError(404, "Không tìm thấy hội thoại");
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
appRouter.get("/conversations/:id/reviews", (req, res) =>
  res.json(
    all(
      `SELECT r.*, rv.display_name AS reviewer, a.display_name AS agent FROM reviews r
       LEFT JOIN users rv ON rv.id = r.reviewer_id LEFT JOIN users a ON a.id = r.agent_id
       WHERE r.conversation_id = ? ORDER BY r.created_at DESC`,
      req.params.id,
    ),
  ),
);
appRouter.post(
  "/conversations/:id/reviews",
  requireAdmin,
  h((req, res) => {
    const score = Number(req.body?.score);
    if (!(score >= 1 && score <= 5)) throw new HttpError(400, "Điểm từ 1 đến 5");
    const conv = getConversation(req.params.id);
    if (!conv) throw new HttpError(404, "Không tìm thấy hội thoại");
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

// Mẫu câu trả lời nhanh
appRouter.get("/templates", (_req, res) => res.json(all("SELECT * FROM templates ORDER BY shortcut")));
appRouter.post(
  "/templates",
  h((req, res) => {
    const shortcut = String(req.body?.shortcut ?? "").trim().replace(/^\//, "");
    const content = String(req.body?.content ?? "").trim();
    if (!shortcut || !content) throw new HttpError(400, "Thiếu phím tắt hoặc nội dung");
    const r = run(
      "INSERT INTO templates(shortcut, content, created_by, created_at) VALUES(?, ?, ?, ?)",
      shortcut,
      content,
      req.user!.id,
      Date.now(),
    );
    res.json(get("SELECT * FROM templates WHERE id = ?", Number(r.lastInsertRowid)));
  }),
);
appRouter.delete("/templates/:id", (req, res) => {
  const t = get<{ created_by: number }>("SELECT created_by FROM templates WHERE id = ?", Number(req.params.id));
  if (t && (req.user!.role === "admin" || t.created_by === req.user!.id)) {
    run("DELETE FROM templates WHERE id = ?", Number(req.params.id));
  }
  res.json({ ok: true });
});

// Báo cáo & xuất dữ liệu (nhân viên chỉ xem/xuất được dữ liệu của chính mình)
function scopeForAgent(req: Request) {
  if (req.user!.role !== "admin") req.query.agentId = String(req.user!.id);
}
appRouter.get("/stats", requireAdmin, (req, res) => res.json(agentStats(exportFilter(req.query))));
appRouter.get("/export", (req, res) => {
  scopeForAgent(req);
  sendExport(req, res);
});

// Tích hợp: API key + webhook (chỉ admin)
appRouter.get("/api-keys", requireAdmin, (_req, res) =>
  res.json(all("SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY id DESC")),
);
appRouter.post(
  "/api-keys",
  requireAdmin,
  h((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new HttpError(400, "Đặt tên cho API key (vd: tên web app)");
    const k = generateApiKey();
    run("INSERT INTO api_keys(name, prefix, key_hash, created_at) VALUES(?, ?, ?, ?)", name, k.prefix, k.hash, Date.now());
    // Key chỉ hiển thị một lần.
    res.json({ name, key: k.key, prefix: k.prefix });
  }),
);
appRouter.delete("/api-keys/:id", requireAdmin, (req, res) => {
  run("DELETE FROM api_keys WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});
appRouter.get("/webhooks", requireAdmin, (_req, res) =>
  res.json(all("SELECT * FROM webhooks ORDER BY id DESC").map((w) => ({ ...w, events: JSON.parse(w.events) }))),
);
appRouter.get("/webhook-events", requireAdmin, (_req, res) => res.json(WEBHOOK_EVENTS));
appRouter.post(
  "/webhooks",
  requireAdmin,
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
appRouter.patch("/webhooks/:id", requireAdmin, (req, res) => {
  const { active, events } = req.body ?? {};
  if (active !== undefined) run("UPDATE webhooks SET active = ? WHERE id = ?", active ? 1 : 0, Number(req.params.id));
  if (Array.isArray(events)) run("UPDATE webhooks SET events = ? WHERE id = ?", JSON.stringify(events), Number(req.params.id));
  res.json({ ok: true });
});
appRouter.delete("/webhooks/:id", requireAdmin, (req, res) => {
  run("DELETE FROM webhooks WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});
appRouter.post("/webhooks/test", requireAdmin, (_req, res) => {
  dispatch("ping", { message: "Kết nối webhook thành công", at: new Date().toISOString() });
  res.json({ ok: true });
});

// ───────────────────────── API công khai cho web app khác (X-API-Key) ─────────────────────────
export const publicRouter = Router();
publicRouter.use(requireApiKey);

publicRouter.get("/status", (_req, res) => {
  const s = zalo.getStatus();
  res.json({ state: s.state, account: s.account ?? null });
});
publicRouter.get("/users", (_req, res) =>
  res.json(all("SELECT id, username, display_name, role FROM users WHERE active = 1 ORDER BY display_name")),
);
publicRouter.get("/conversations", (req, res) =>
  res.json(
    listConversations({
      scope: req.query.unassigned === "1" ? "unassigned" : "all",
      status: req.query.status as string | undefined,
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
