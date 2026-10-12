import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "./config.js";
import { get, run } from "./db.js";

export type AuthUser = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "agent";
  auth_source: "local" | "odoo";
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

export function userFromToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: number };
    const user = get<AuthUser>(
      "SELECT id, username, display_name, role, auth_source FROM users WHERE id = ? AND active = 1",
      payload.sub,
    );
    return user ?? null;
  } catch {
    return null;
  }
}

function bearer(req: Request) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  // Cho phép ?token= để tải file xuất dữ liệu trực tiếp bằng link.
  return typeof req.query.token === "string" ? req.query.token : undefined;
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = userFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: "Chưa đăng nhập hoặc phiên đã hết hạn" });
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Chỉ quản trị viên mới có quyền" });
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
