/**
 * Lớp bảo vệ chung cho máy chủ:
 * - Chỉ nhận kết nối từ chính máy này (Cloudflare Tunnel đi qua localhost); máy khác trong mạng LAN bị chặn.
 *   Muốn mở cho LAN (thử nghiệm) thì đặt ALLOW_LAN=1 trong .env.
 * - Header bảo mật cho trình duyệt: CSP, chống nhúng iframe, chống đoán kiểu file, HSTS.
 * - File tải lên (/uploads): chỉ ảnh / video / âm thanh được mở trực tiếp; loại khác (html, svg, pdf…) luôn tải về,
 *   và chạy trong sandbox để không thể chạy mã trên tên miền của app.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const allowLan = () => process.env.ALLOW_LAN === "1";

export function isLoopback(address: string | undefined) {
  return !!address && LOOPBACK.has(address);
}

/**
 * IP thật của người dùng. Qua Cloudflare Tunnel mọi kết nối đều tới từ localhost, IP thật nằm ở header
 * CF-Connecting-IP; chỉ tin header này khi kết nối đến từ localhost (máy trong LAN không giả được).
 */
export function clientIp(req: Request) {
  const remote = req.socket.remoteAddress;
  if (isLoopback(remote)) {
    const cf = req.get("cf-connecting-ip");
    if (cf && /^[0-9a-fA-F:.]{3,45}$/.test(cf)) return cf;
  }
  return remote ?? "unknown";
}

/** So sánh chuỗi bí mật không lộ thời gian (băm SHA-256 trước để hai bên cùng độ dài). */
export function safeEqual(a: unknown, b: unknown) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const h = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(a), h(b));
}

export function localOnly(req: Request, res: Response, next: NextFunction) {
  if (allowLan() || isLoopback(req.socket.remoteAddress)) return next();
  res.status(403).type("text").send("Chỉ truy cập qua tên miền của app.");
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Ảnh khách gửi, avatar, sticker nằm trên CDN của Zalo / Facebook / TikTok
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=15552000");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
  next();
}

const INLINE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm", ".mov", ".mp3", ".m4a", ".ogg", ".aac", ".wav"]);

/** setHeaders cho express.static("/uploads") */
export function uploadHeaders(res: Response, filePath: string) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!INLINE_EXT.has(path.extname(filePath).toLowerCase())) res.setHeader("Content-Disposition", "attachment");
}

/** Chỉ cho đường link http(s) đi qua (chặn javascript:, data: … trong link khách gửi). */
export function safeHttpUrl(v: unknown) {
  const s = String(v ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
