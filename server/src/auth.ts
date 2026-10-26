import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "./config.js";
import { get, run } from "./db.js";
import { permissionsOf } from "./permissions.js";
import { bus } from "./bus.js";

export type AuthUser = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "agent";
  auth_source: "local" | "odoo";
  /** Super Admin: quyền cao nhất */
  super_admin: number;
  /** Ảnh đại diện (/uploads/avatars/…) */
  avatar?: string | null;
  /** Quyền thực tế (nhóm quyền + quyền riêng) */
  permissions?: string[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKey?: { id: number; name: string };
    }
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: "7d" });
}

/**
 * Mã dùng trong đường link (tải file, bắt đầu kết nối Facebook/TikTok…): sống 2 phút,
 * để mã phiên 7 ngày không bao giờ nằm trong URL (lịch sử trình duyệt, nhật ký máy chủ / Cloudflare).
 */
export function signLinkToken(userId: number) {
  return jwt.sign({ sub: userId, scope: "link" }, config.jwtSecret, { expiresIn: "2m" });
}

/** kind = "session": mã đăng nhập thường (header). kind = "link": mã ngắn hạn trong URL. */
export function userFromToken(token: string | undefined, kind: "session" | "link" = "session"): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: number; iat: number; scope?: string };
    if (kind === "link" ? payload.scope !== "link" : payload.scope === "link") return null;
    const user = get<AuthUser & { token_after: number }>(
      "SELECT id, username, display_name, role, auth_source, super_admin, avatar, token_after FROM users WHERE id = ? AND active = 1",
      payload.sub,
    );
    // Phiên tạo trước lúc đổi mật khẩu / "đăng xuất mọi thiết bị" → hết hiệu lực
    if (!user || payload.iat * 1000 < user.token_after) return null;
    const { token_after: _ignored, ...rest } = user;
    return { ...rest, permissions: permissionsOf(user.id) };
  } catch {
    return null;
  }
}

/** Hủy mọi phiên đăng nhập cũ của một người (lùi 1 giây để phiên mới cấp ngay sau vẫn dùng được). */
export function revokeSessions(userId: number) {
  run("UPDATE users SET token_after = ? WHERE id = ?", Math.floor(Date.now() / 1000) * 1000, userId);
  // Ngắt luôn các kết nối realtime đang mở của người này (realtime.ts)
  bus.emit("user.revoked", userId);
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  // Header: mã phiên. ?token=: chỉ nhận mã link ngắn hạn, và chỉ để xem / tải (GET) —
  // không gửi tin, không sửa dữ liệu, không tự xin mã link mới để kéo dài phiên.
  const linkOk = req.method === "GET" && !req.path.startsWith("/auth/");
  const user = h?.startsWith("Bearer ")
    ? userFromToken(h.slice(7), "session")
    : linkOk && typeof req.query.token === "string"
      ? userFromToken(req.query.token, "link")
      : null;
  if (!user) return res.status(401).json({ error: "Chưa đăng nhập hoặc phiên đã hết hạn" });
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Chỉ quản trị viên mới có quyền" });
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.super_admin) return res.status(403).json({ error: "Chỉ Super Admin mới có quyền" });
  next();
}

export function hashApiKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateApiKey() {
  const key = "zck_" + crypto.randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 10), hash: hashApiKey(key) };
}

/** Xác thực cho các web app khác gọi vào: header `X-API-Key: zck_...` */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-api-key");
  if (!key) return res.status(401).json({ error: "Thiếu header X-API-Key" });
  const row = get<{ id: number; name: string }>("SELECT id, name FROM api_keys WHERE key_hash = ?", hashApiKey(key));
  if (!row) return res.status(401).json({ error: "API key không hợp lệ" });
  run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", Date.now(), row.id);
  req.apiKey = row;
  next();
}
