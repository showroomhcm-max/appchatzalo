/**
 * Kết nối Facebook / TikTok / TikTok Shop:
 * - /webhooks/*      : nền tảng gửi tin nhắn mới về (công khai, kiểm tra chữ ký)
 * - /api/oauth/*     : luồng đăng nhập / ủy quyền tài khoản (trình duyệt chuyển hướng qua lại)
 * - /api/platform-*  : cấu hình app nhà phát triển, kết nối Fanpage / tài khoản / shop thành kênh
 */
import express, { Router, type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import { all, get, logEvent, run } from "./db.js";
import { config } from "./config.js";
import { userFromToken } from "./auth.js";
import { can, requirePerm } from "./permissions.js";
import { bus } from "./bus.js";
import { zalo } from "./zalo.js";
import { HttpError } from "./conversations.js";
import { publicBaseUrl, type Platform } from "./platforms/common.js";
import { metaConfig, publicConfigs, saveConfig, tiktokConfig, tiktokShopConfig, zaloOaConfig, type AppKind } from "./platforms/app-config.js";
import { FACEBOOK_SCOPES, MetaSession, exchangeCodeForPages, graph, verifyMetaSignature } from "./platforms/meta.js";
import { TikTokSession, exchangeTikTokCode, registerTikTokWebhook, verifyTikTokWebhook } from "./platforms/tiktok.js";
import { TikTokShopSession, exchangeTikTokShopCode, verifyTikTokShopWebhook } from "./platforms/tiktok-shop.js";
import { orderFromSapo, sapoConfig, upsertOrder, verifySapoWebhook } from "./orders.js";
import { ZaloOaSession, exchangeZaloOaCode, verifyZaloOaWebhook, zaloOaAuthorizeUrl } from "./platforms/zalo-oa.js";

const h =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

export const callbackUrls = () => {
  const base = publicBaseUrl();
  return {
    metaWebhook: `${base}/webhooks/meta`,
    metaRedirect: `${base}/api/oauth/facebook/callback`,
    // TikTok không ký mọi webhook → thêm khóa bí mật vào URL để chặn gửi giả
    tiktokWebhook: `${base}/webhooks/tiktok?k=${tiktokConfig()?.webhookKey ?? ""}`,
    tiktokRedirect: `${base}/api/oauth/tiktok/callback`,
    tiktokShopWebhook: `${base}/webhooks/tiktok-shop`,
    tiktokShopRedirect: `${base}/api/oauth/tiktok-shop/callback`,
    zaloOaWebhook: `${base}/webhooks/zalo-oa?k=${zaloOaConfig()?.webhookKey ?? ""}`,
    zaloOaRedirect: `${base}/api/oauth/zalo-oa/callback`,
    zaloOaVerifyFile: zaloOaConfig()?.verifyCode ? `${base}/zalo_verifier${zaloOaConfig()!.verifyCode}.html` : "",
  };
};

// ───────────── Webhook (body thô để kiểm tra chữ ký) ─────────────

export const webhookRouter = Router();
webhookRouter.use(express.raw({ type: () => true, limit: "5mb" }));

function parseBody(req: Request) {
  try {
    return JSON.parse((req.body as Buffer).toString("utf8"));
  } catch {
    return null;
  }
}

// Meta kiểm tra webhook lúc cấu hình: trả lại hub.challenge nếu verify token đúng
webhookRouter.get("/meta", (req, res) => {
  const cfg = metaConfig();
  if (req.query["hub.mode"] === "subscribe" && cfg && req.query["hub.verify_token"] === cfg.verifyToken) {
    return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  }
  res.sendStatus(403);
});

webhookRouter.post("/meta", (req, res) => {
  if (!verifyMetaSignature(req.body as Buffer, req.header("x-hub-signature-256"))) {
    console.warn("[webhook/meta] Sai chữ ký, bỏ qua (kiểm tra App Secret trong Cài đặt › Tích hợp)");
    return res.sendStatus(401);
  }
  res.sendStatus(200); // trả lời ngay, xử lý sau
  const body = parseBody(req);
  if (body?.object !== "page") return;
  for (const entry of body.entry ?? []) {
    const session = zalo.byExternal("facebook", String(entry.id));
    if (!(session instanceof MetaSession)) {
      console.warn(`[webhook/meta] Chưa có kênh cho Fanpage ${entry.id}`);
      continue;
    }
    for (const ev of entry.messaging ?? []) session.handleMessaging(ev);
    for (const ch of entry.changes ?? []) if (ch.field === "feed") session.handleFeed(ch.value);
  }
});

webhookRouter.post("/tiktok", (req, res) => {
  const body = parseBody(req);
  const signed = req.header("tiktok-signature");
  const keyOk = !!tiktokConfig()?.webhookKey && req.query.k === tiktokConfig()!.webhookKey;
  if (!body || (!signed && !keyOk) || !verifyTikTokWebhook(req.body as Buffer, signed, body.client_key)) {
    console.warn("[webhook/tiktok] Sai chữ ký / client_key, bỏ qua");
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  const session = zalo.byExternal("tiktok", String(body.user_openid ?? ""));
  if (!(session instanceof TikTokSession)) {
    console.warn(`[webhook/tiktok] Chưa có kênh cho tài khoản ${body.user_openid}`);
    return;
  }
  let content: any = body.content;
  try {
    if (typeof content === "string") content = JSON.parse(content);
  } catch {
    return;
  }
  session.handleEvent(String(body.event ?? ""), content ?? {});
});

webhookRouter.post("/tiktok-shop", (req, res) => {
  if (!verifyTikTokShopWebhook(req.body as Buffer, req.header("authorization"))) {
    console.warn("[webhook/tiktok-shop] Sai chữ ký, bỏ qua");
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  const body = parseBody(req);
  const session = zalo.byExternal("tiktok_shop", String(body?.shop_id ?? ""));
  const convId = body?.data?.conversation_id;
  if (session instanceof TikTokShopSession && convId) {
    session.syncConversation(String(convId)).catch((e) => console.error("[webhook/tiktok-shop] Tải tin lỗi:", e.message));
  }
});

webhookRouter.post("/zalo-oa", (req, res) => {
  if (!verifyZaloOaWebhook(req.body as Buffer, req.header("x-zevent-signature"), req.query.k)) {
    console.warn("[webhook/zalo-oa] Sai chữ ký / khóa URL, bỏ qua");
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  const ev = parseBody(req);
  if (!ev) return;
  const name = String(ev.event_name ?? "");
  // OA là người gửi với oa_send_*, là người nhận với user_send_*
  const oaId = String(name.startsWith("oa_") ? ev.sender?.id ?? "" : ev.recipient?.id ?? "");
  const session = zalo.byExternal("zalo_oa", oaId);
  if (!(session instanceof ZaloOaSession)) {
    if (name.includes("send")) console.warn(`[webhook/zalo-oa] Chưa có kênh cho OA ${oaId}`);
    return;
  }
  session.handleEvent(ev);
});

// Sapo POS: đã chuẩn bị, chỉ nhận khi bật trong Cài đặt › Tích hợp › Sapo
webhookRouter.post("/sapo", (req, res) => {
  if (!sapoConfig().enabled) return res.sendStatus(404);
  if (!verifySapoWebhook(req.body as Buffer, req.header("x-sapo-hmac-sha256"))) {
    console.warn("[webhook/sapo] Sai chữ ký, bỏ qua");
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  const body = parseBody(req);
  const order = body?.order ?? body;
  if (order?.id) upsertOrder(orderFromSapo(order));
});

/** File xác thực tên miền của Zalo: /zalo_verifier<mã>.html */
export function zaloVerifierHandler(req: Request, res: Response, next: NextFunction) {
  const m = /^\/zalo_verifier([A-Za-z0-9_-]+)\.html$/.exec(req.path);
  const code = zaloOaConfig()?.verifyCode;
  if (!m || !code || m[1] !== code) return next();
  res.type("html").send(
    `<!DOCTYPE html><html lang="en"><head><meta property="zalo-platform-site-verification" content="${code}" /></head><body>There Is No Limit To What You Can Accomplish Using Zalo!</body></html>`,
  );
}

// ───────────── OAuth: chuyển hướng qua lại giữa app và nền tảng ─────────────

export const oauthRouter = Router();

/** state ký HMAC để callback biết ai bắt đầu và chống giả mạo. */
function makeState(userId: number) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + 15 * 60_000, n: crypto.randomBytes(6).toString("hex") })).toString("base64url");
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function readState(state: unknown) {
  const [payload, sig] = String(state ?? "").split(".");
  if (!payload || !sig) throw new HttpError(400, "Phiên kết nối không hợp lệ, thử lại");
  const expect = crypto.createHmac("sha256", config.jwtSecret).update(payload).digest("base64url");
  if (expect.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) {
    throw new HttpError(400, "Phiên kết nối không hợp lệ, thử lại");
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: number; e: number };
  if (Date.now() > data.e) throw new HttpError(400, "Phiên kết nối đã hết hạn, thử lại");
  return data;
}

/** Trang bắt đầu kết nối mở bằng link (không gửi được header) → nhận token qua ?token= */
function managerFromQuery(req: Request) {
  const user = userFromToken(typeof req.query.token === "string" ? req.query.token : undefined, "link");
  if (!user || !can(user, "channels.manage")) throw new HttpError(403, "Bạn chưa được cấp quyền kết nối kênh");
  return user;
}

/** Quay về trang Kênh Chat kèm thông báo */
function backToChannels(res: Response, params: Record<string, string>) {
  res.redirect(`/#/settings/channels/${encodeURIComponent(new URLSearchParams(params).toString())}`);
}

// Danh sách Fanpage vừa lấy được, chờ người dùng chọn (giữ 15 phút trong bộ nhớ)
const pendingPages = new Map<string, { at: number; userId: number; pages: { id: string; name: string; token: string; picture: string }[] }>();

oauthRouter.get(
  "/facebook/start",
  h((req, res) => {
    const user = managerFromQuery(req);
    const cfg = metaConfig();
    if (!cfg) throw new HttpError(400, "Chưa nhập Meta App ở Cài đặt › Tích hợp");
    const url = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", cfg.appId);
    url.searchParams.set("redirect_uri", callbackUrls().metaRedirect);
    url.searchParams.set("state", makeState(user.id));
    url.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
    res.redirect(url.toString());
  }),
);

oauthRouter.get(
  "/facebook/callback",
  h(async (req, res) => {
    if (req.query.error) return backToChannels(res, { error: String(req.query.error_description ?? req.query.error) });
    const st = readState(req.query.state);
    try {
      const pages = await exchangeCodeForPages(String(req.query.code ?? ""), callbackUrls().metaRedirect);
      const key = crypto.randomBytes(12).toString("hex");
      for (const [k, v] of pendingPages) if (Date.now() - v.at > 15 * 60_000) pendingPages.delete(k);
      pendingPages.set(key, { at: Date.now(), userId: st.u, pages });
      backToChannels(res, { connect: "facebook", key });
    } catch (e: any) {
      console.error("[oauth/facebook]", e.message);
      backToChannels(res, { error: `Facebook: ${e.message}` });
    }
  }),
);

oauthRouter.get(
  "/tiktok/start",
  h((req, res) => {
    const user = managerFromQuery(req);
    const cfg = tiktokConfig();
    if (!cfg?.authUrl) throw new HttpError(400, "Chưa nhập link ủy quyền TikTok ở Cài đặt › Tích hợp");
    const url = new URL(cfg.authUrl);
    url.searchParams.set("state", makeState(user.id));
    url.searchParams.set("disable_auto_auth", "1");
    res.redirect(url.toString());
  }),
);

oauthRouter.get(
  "/tiktok/callback",
  h(async (req, res) => {
    const st = readState(req.query.state);
    if (!req.query.code) return backToChannels(res, { error: "TikTok không trả về mã ủy quyền (tài khoản đã ủy quyền trước đó?)" });
    try {
      const creds = await exchangeTikTokCode(String(req.query.code), callbackUrls().tiktokRedirect);
      const id = upsertChannel("tiktok", creds.openId, "TikTok", creds, st.u);
      await zalo.session(id).init();
      backToChannels(res, { connected: String(id) });
    } catch (e: any) {
      console.error("[oauth/tiktok]", e.message);
      backToChannels(res, { error: e.message });
    }
  }),
);

oauthRouter.get(
  "/tiktok-shop/start",
  h((req, res) => {
    const user = managerFromQuery(req);
    const cfg = tiktokShopConfig();
    if (!cfg?.serviceId) throw new HttpError(400, "Chưa nhập Service ID của TikTok Shop App ở Cài đặt › Tích hợp");
    const url = new URL("https://services.tiktokshop.com/open/authorize");
    url.searchParams.set("service_id", cfg.serviceId);
    url.searchParams.set("state", makeState(user.id));
    res.redirect(url.toString());
  }),
);

oauthRouter.get(
  "/tiktok-shop/callback",
  h(async (req, res) => {
    // Người bán có thể ủy quyền từ trang dịch vụ của TikTok Shop (không có state) → chỉ chấp nhận khi có state hợp lệ
    const st = readState(req.query.state);
    try {
      const shops = await exchangeTikTokShopCode(String(req.query.code ?? ""));
      const ids: number[] = [];
      for (const shop of shops) {
        const id = upsertChannel("tiktok_shop", shop.shopId, `TikTok Shop ${shop.shopName ?? ""}`.trim(), shop, st.u);
        ids.push(id);
        const s = zalo.session(id) as TikTokShopSession;
        await s.init();
        await s.registerWebhook(callbackUrls().tiktokShopWebhook).catch((e) => console.warn("[oauth/tiktok-shop] Đăng ký webhook lỗi:", e.message));
      }
      backToChannels(res, { connected: ids.join(",") });
    } catch (e: any) {
      console.error("[oauth/tiktok-shop]", e.message);
      backToChannels(res, { error: e.message });
    }
  }),
);

oauthRouter.get(
  "/zalo-oa/start",
  h((req, res) => {
    const user = managerFromQuery(req);
    if (!zaloOaConfig()) throw new HttpError(400, "Chưa nhập Zalo OA App ở Cài đặt › Tích hợp");
    res.redirect(zaloOaAuthorizeUrl(callbackUrls().zaloOaRedirect, makeState(user.id)));
  }),
);

oauthRouter.get(
  "/zalo-oa/callback",
  h(async (req, res) => {
    const state = String(req.query.state ?? "");
    const st = readState(state);
    if (!req.query.code) return backToChannels(res, { error: "Zalo không trả về mã ủy quyền" });
    try {
      const creds = await exchangeZaloOaCode(String(req.query.code), state, req.query.oa_id ? String(req.query.oa_id) : undefined);
      const id = upsertChannel("zalo_oa", creds.oaId, creds.name || "Zalo OA", creds, st.u);
      await zalo.session(id).init();
      backToChannels(res, { connected: String(id) });
    } catch (e: any) {
      console.error("[oauth/zalo-oa]", e.message);
      backToChannels(res, { error: e.message });
    }
  }),
);

/** Tạo kênh mới, hoặc cập nhật token nếu tài khoản này đã có kênh. */
function upsertChannel(platform: Platform, externalId: string, name: string, creds: unknown, userId: number) {
  const existing = get<{ id: number }>("SELECT id FROM channels WHERE platform = ? AND external_id = ? AND deleted_at IS NULL", platform, externalId);
  if (existing) {
    run("UPDATE channels SET credentials = ?, active = 1 WHERE id = ?", JSON.stringify(creds), existing.id);
    logEvent(null, userId, "channel.reconnected", { id: existing.id, platform });
    bus.emit("settings.changed", "channels");
    return existing.id;
  }
  const id = Number(
    run(
      "INSERT INTO channels(name, platform, external_id, credentials, created_at) VALUES(?, ?, ?, ?, ?)",
      name,
      platform,
      externalId,
      JSON.stringify(creds),
      Date.now(),
    ).lastInsertRowid,
  );
  logEvent(null, userId, "channel.created", { id, name, platform });
  bus.emit("settings.changed", "channels");
  return id;
}

// ───────────── API trong app (cần đăng nhập) ─────────────

export const platformRouter = Router();

platformRouter.get("/platform-config", (req, res) => {
  if (!can(req.user, "channels.manage") && !can(req.user, "integrations.manage")) throw new HttpError(403, "Bạn chưa được cấp quyền này");
  res.json({ ...publicConfigs(), urls: callbackUrls() });
});

platformRouter.put(
  "/platform-config/:kind",
  requirePerm("integrations.manage"),
  h((req, res) => {
    const kind = req.params.kind as AppKind;
    if (!["meta", "tiktok", "tiktok_shop", "zalo_oa"].includes(kind)) throw new HttpError(400, "Loại cấu hình không hợp lệ");
    const r = saveConfig(kind, req.body ?? {});
    // Kênh đang báo "chưa nhập app" thì thử kết nối lại
    const platform = kind === "meta" ? "facebook" : kind;
    for (const c of all<{ id: number }>("SELECT id FROM channels WHERE platform = ? AND active = 1", platform)) {
      void zalo.session(c.id).init();
    }
    res.json({ ...r, urls: callbackUrls() });
  }),
);

platformRouter.post(
  "/platform-config/tiktok/register-webhook",
  requirePerm("integrations.manage"),
  h(async (_req, res) => {
    try {
      await registerTikTokWebhook(callbackUrls().tiktokWebhook);
    } catch (e: any) {
      throw new HttpError(502, e.message);
    }
    res.json({ ok: true, callback: callbackUrls().tiktokWebhook });
  }),
);

/** Fanpage vừa đăng nhập Facebook xong, chờ chọn */
platformRouter.get("/platform-connect/facebook/:key", requirePerm("channels.manage"), (req, res) => {
  const p = pendingPages.get(req.params.key);
  if (!p) throw new HttpError(404, "Phiên chọn Fanpage đã hết hạn, đăng nhập Facebook lại");
  const connected = new Set(all<{ external_id: string }>("SELECT external_id FROM channels WHERE platform = 'facebook' AND deleted_at IS NULL").map((r) => r.external_id));
  res.json(p.pages.map((pg) => ({ id: pg.id, name: pg.name, picture: pg.picture, connected: connected.has(pg.id) })));
});

platformRouter.post(
  "/platform-connect/facebook/:key",
  requirePerm("channels.manage"),
  h(async (req, res) => {
    const p = pendingPages.get(req.params.key);
    if (!p) throw new HttpError(404, "Phiên chọn Fanpage đã hết hạn, đăng nhập Facebook lại");
    const want = new Set((Array.isArray(req.body?.page_ids) ? req.body.page_ids : []).map(String));
    if (!want.size) throw new HttpError(400, "Chọn ít nhất 1 Fanpage");
    const ids: number[] = [];
    for (const pg of p.pages.filter((x) => want.has(x.id))) {
      const id = upsertChannel("facebook", pg.id, pg.name, { pageId: pg.id, pageToken: pg.token, pageName: pg.name, picture: pg.picture }, req.user!.id);
      await zalo.session(id).init();
      ids.push(id);
    }
    pendingPages.delete(req.params.key);
    res.json({ channel_ids: ids });
  }),
);

/** Cách dự phòng: dán Page Access Token (lấy ở Meta Business Suite / Graph API Explorer). */
platformRouter.post(
  "/platform-connect/facebook-token",
  requirePerm("channels.manage"),
  h(async (req, res) => {
    const token = String(req.body?.page_token ?? "").trim();
    if (!token) throw new HttpError(400, "Dán Page Access Token");
    if (!metaConfig()) throw new HttpError(400, "Chưa nhập Meta App ở Cài đặt › Tích hợp (cần App Secret để nhận webhook)");
    let me: { id: string; name: string; picture?: { data?: { url?: string } } };
    try {
      me = await graph("/me?fields=id,name,picture", token);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    const id = upsertChannel("facebook", me.id, me.name, { pageId: me.id, pageToken: token, pageName: me.name, picture: me.picture?.data?.url }, req.user!.id);
    await zalo.session(id).init();
    res.json({ channel_id: id, name: me.name });
  }),
);

// Lỗi trong luồng ủy quyền (mở bằng trình duyệt) → quay về trang Kênh Chat kèm thông báo thay vì trang lỗi trắng
oauthRouter.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.warn("[oauth]", err?.message ?? err);
  backToChannels(res, { error: err?.message ?? "Kết nối thất bại" });
});
