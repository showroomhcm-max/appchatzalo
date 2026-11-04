/**
 * Lưu bản ảnh / video / tệp / ghi âm lên NAS ngay khi nhận tin.
 *
 * Link ảnh Zalo hết hạn rất nhanh (kiểm 04/11/2026: 8/10 ảnh dưới 30 ngày đã 404). App chỉ lưu link thì sau vài
 * tuần ảnh mất. Ở đây một tiến trình nền tải bản sao về uploads/media/<tháng>/ rồi ghi đường dẫn vào raw._local;
 * giao diện ưu tiên bản trên NAS, hỏng mới dùng link Zalo.
 *
 * - Tin mới: tải ngay sau khi nhận (đánh thức qua bus). Tin cũ chưa có bản: tải dần, mới trước cũ sau.
 * - Link hết hạn (404…) → ghi raw._local_fail, không thử lại. Lỗi mạng → thử lại sau 1 giờ.
 * - Giữ bản trên NAS keepDays ngày (0 = giữ mãi); quá hạn thì xóa tệp, tin quay về link Zalo.
 * - Ổ NAS còn dưới 5 GB trống → tạm dừng tải, ghi cảnh báo.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, db, get, getSetting, logEvent, run, setSetting } from "./db.js";
import { config } from "./config.js";
import { bus } from "./bus.js";
import { safeRequest } from "./net-guard.js";
import { HttpError } from "./conversations.js";

export const MEDIA_TYPES = ["chat.photo", "chat.video.msg", "share.file", "chat.voice", "chat.gif"] as const;
const TYPES_SQL = MEDIA_TYPES.map((t) => `'${t}'`).join(", ");
// Chỉ mục riêng cho tin có tệp: tiến trình nền hỏi thường xuyên mà không quét cả bảng tin
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(id) WHERE msg_type IN (${TYPES_SQL})`);

const MB = 1024 * 1024;
const MIN_FREE = 5 * 1024 * MB;
const RETRY_MS = 3_600_000;

// ───────────── Cấu hình ─────────────

export type MediaStoreConfig = { enabled: boolean; keepDays: number };
const KEY = "media_store";

export function mediaStoreConfig(): MediaStoreConfig {
  const c = getSetting<Partial<MediaStoreConfig>>(KEY) ?? {};
  const days = Math.round(Number(c.keepDays ?? 365));
  return { enabled: c.enabled ?? true, keepDays: Number.isFinite(days) ? Math.max(0, Math.min(3650, days)) : 365 };
}

export function saveMediaStoreConfig(body: any, userId: number) {
  const days = Number(body?.keepDays);
  if (!Number.isInteger(days) || days < 0 || days > 3650 || (days > 0 && days < 30))
    throw new HttpError(400, "Số ngày giữ phải từ 30 đến 3650 (0 = giữ mãi)");
  const next = { enabled: !!body?.enabled, keepDays: days };
  setSetting(KEY, next);
  logEvent(null, userId, "media_store.saved", next);
  wake();
  return mediaStoreStatus();
}

let usageCache: { at: number; files: number; bytes: number; pending: number; failed: number } | null = null;

/** Cấu hình + dung lượng đang dùng (cho Cài đặt). */
export function mediaStoreStatus() {
  if (!usageCache || Date.now() - usageCache.at > 60_000) {
    const cutoff = cutoffTs();
    const u = get<{ files: number; bytes: number | null; failed: number; pending: number }>(
      `SELECT
         SUM(json_extract(raw, '$._local') IS NOT NULL) AS files,
         SUM(COALESCE(json_extract(raw, '$._local_size'), 0)) AS bytes,
         SUM(json_extract(raw, '$._local_fail') IS NOT NULL) AS failed,
         SUM(json_extract(raw, '$._local') IS NULL AND json_extract(raw, '$._local_fail') IS NULL AND ts >= ?) AS pending
       FROM messages WHERE msg_type IN (${TYPES_SQL}) AND raw IS NOT NULL`,
      cutoff,
    );
    usageCache = { at: Date.now(), files: u?.files ?? 0, bytes: u?.bytes ?? 0, pending: u?.pending ?? 0, failed: u?.failed ?? 0 };
  }
  const { at: _at, ...usage } = usageCache;
  return { ...mediaStoreConfig(), ...usage, freeBytes: freeBytes(), paused: pausedReason };
}

const cutoffTs = () => {
  const d = mediaStoreConfig().keepDays;
  return d > 0 ? Date.now() - d * 86_400_000 : 0;
};

function freeBytes() {
  try {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const s = fs.statfsSync(config.uploadDir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

// ───────────── Chọn link, tải, lưu ─────────────

const parseParams = (raw: Record<string, any>) => {
  const p = raw.params;
  if (p && typeof p === "object") return p as Record<string, any>;
  try {
    return typeof p === "string" ? JSON.parse(p) : {};
  } catch {
    return {};
  }
};

/** Link nên tải theo thứ tự ưu tiên (bỏ .jxl: trình duyệt máy tính không hiện được). */
export function mediaLinks(msgType: string, raw: Record<string, any>): string[] {
  const p = parseParams(raw);
  const pick: Record<string, unknown[]> = {
    "chat.photo": [p.hd, raw.hdUrl, raw.href, raw.oriUrl, raw.normalUrl, raw.thumb, raw.thumbUrl],
    "chat.gif": [raw.href, raw.hdUrl, raw.oriUrl, raw.thumb],
    "chat.video.msg": [raw.href, raw.hdUrl, raw.oriUrl, raw.normalUrl, p.videoUrl, p.video_url],
    "share.file": [raw.href],
    "chat.voice": [raw.href],
  };
  const list = (pick[msgType] ?? []).map((u) => (typeof u === "string" ? u.trim() : "")).filter((u) => /^https?:\/\//i.test(u) && !/\.jxl(\?|$)/i.test(u));
  return [...new Set(list)];
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/aac": ".aac",
  "audio/x-aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
};

/** Đuôi tệp lưu trên NAS: ảnh / video / ghi âm theo loại dữ liệu thật; tệp gửi kèm theo tên tệp (chỉ chữ số thường). */
function extFor(msgType: string, contentType: string, url: string, raw: Record<string, any>) {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (msgType === "share.file") {
    const e = path.extname(String(raw.title ?? "")).toLowerCase();
    return /^\.[a-z0-9]{1,6}$/.test(e) ? e : ".bin";
  }
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct];
  const e = (url.match(/\.([a-z0-9]{2,4})(?:\?|$)/i)?.[1] ?? "").toLowerCase();
  if (msgType === "chat.voice" && ["aac", "m4a", "mp3", "amr"].includes(e)) return `.${e}`;
  return null;
}

/** Kiểm dữ liệu đúng loại (không lưu trang HTML lỗi thành ảnh). */
function looksRight(msgType: string, contentType: string, buf: Buffer) {
  const ct = contentType.toLowerCase();
  if (msgType === "chat.photo" || msgType === "chat.gif") return ct.startsWith("image/") && !ct.includes("svg");
  if (msgType === "chat.video.msg") return ct.startsWith("video/") || buf.subarray(4, 8).toString("latin1") === "ftyp";
  if (msgType === "chat.voice") return ct.startsWith("audio/") || ct.startsWith("video/") || ct === "application/octet-stream";
  return buf.length > 0;
}

type Row = { id: number; msg_type: string; raw: string; ts: number };
type Outcome = { ok: true; bytes: number } | { ok: false; retry: boolean; reason: string };

async function mirrorOne(row: Row): Promise<Outcome> {
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(row.raw);
  } catch {
    return { ok: false, retry: false, reason: "raw" };
  }
  // Tin nhân viên gửi từ app (mẫu trả lời…) đã có tệp trên NAS: trỏ thẳng vào đó, khỏi tải lại
  const own = ["hdUrl", "href", "oriUrl", "normalUrl", "thumb", "thumbUrl"].map((k) => raw[k]).find((u) => typeof u === "string" && /^\/uploads\/[\w./-]+$/.test(u) && !u.includes(".."));
  if (own) {
    run("UPDATE messages SET raw = json_set(raw, '$._local', ?) WHERE id = ?", own, row.id);
    return { ok: true, bytes: 0 };
  }
  const links = mediaLinks(row.msg_type, raw);
  if (!links.length) return { ok: false, retry: false, reason: "không có link tải được" };
  const max = row.msg_type === "chat.photo" || row.msg_type === "chat.gif" ? 25 * MB : 60 * MB;
  let retry = false;
  let reason = "";
  for (const url of links) {
    try {
      const r = await safeRequest(url, { maxBytes: max, timeoutMs: 60_000, maxRedirects: 3 });
      if (r.status < 200 || r.status >= 300) {
        reason = `HTTP ${r.status}`;
        if (r.status >= 500 || r.status === 429) retry = true;
        continue;
      }
      const ct = String(r.headers["content-type"] ?? "");
      if (!looksRight(row.msg_type, ct, r.body)) {
        reason = `sai loại dữ liệu (${ct || "?"})`;
        continue;
      }
      const ext = extFor(row.msg_type, ct, url, raw);
      if (!ext) {
        reason = `không rõ định dạng (${ct || "?"})`;
        continue;
      }
      const month = new Date(row.ts || Date.now()).toISOString().slice(0, 7);
      const dir = path.join(config.uploadDir, "media", month);
      fs.mkdirSync(dir, { recursive: true });
      const name = `${crypto.randomBytes(12).toString("hex")}${ext}`;
      fs.writeFileSync(path.join(dir, name), r.body);
      run(
        "UPDATE messages SET raw = json_set(raw, '$._local', ?, '$._local_size', ?) WHERE id = ?",
        `/uploads/media/${month}/${name}`,
        r.body.length,
        row.id,
      );
      return { ok: true, bytes: r.body.length };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      reason = msg;
      // Quá dung lượng / link nội bộ: bỏ hẳn; lỗi mạng: thử lại sau
      if (!/MB|nội bộ|không hợp lệ/i.test(msg)) retry = true;
    }
  }
  return { ok: false, retry, reason };
}

// ───────────── Tiến trình nền ─────────────

let timer: NodeJS.Timeout | null = null;
let running = false;
let pausedReason: string | null = null;
const stats = { saved: 0, bytes: 0, failed: 0, since: Date.now() };

function wake(delay = 1500) {
  if (running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void loop(), delay);
  timer.unref?.();
}

function nextBatch() {
  return all<Row>(
    `SELECT id, msg_type, raw, ts FROM messages
     WHERE msg_type IN (${TYPES_SQL}) AND raw IS NOT NULL AND undone = 0 AND ts >= ?
       AND json_extract(raw, '$._local') IS NULL AND json_extract(raw, '$._local_fail') IS NULL
       AND COALESCE(json_extract(raw, '$._local_try'), 0) < ?
     ORDER BY id DESC LIMIT 20`,
    cutoffTs(),
    Date.now() - RETRY_MS,
  );
}

async function loop() {
  timer = null;
  if (running) return;
  running = true;
  let idle = 30_000;
  try {
    if (!mediaStoreConfig().enabled) {
      pausedReason = "đang tắt";
      idle = 5 * 60_000;
      return;
    }
    const free = freeBytes();
    if (free != null && free < MIN_FREE) {
      if (pausedReason !== "ổ đầy") console.warn(`[media-store] Ổ NAS chỉ còn ${(free / 1024 / MB).toFixed(1)} GB trống: tạm dừng lưu ảnh / video`);
      pausedReason = "ổ đầy";
      idle = 10 * 60_000;
      return;
    }
    pausedReason = null;
    for (;;) {
      const rows = nextBatch();
      if (!rows.length) break;
      for (const row of rows) {
        const r = await mirrorOne(row);
        if (r.ok) {
          stats.saved++;
          stats.bytes += r.bytes;
        } else if (r.retry) {
          // Lỗi mạng: thử lại sau 1 giờ, tối đa 3 lần rồi thôi
          const tries = Number(JSON.parse(row.raw)._local_tries ?? 0) + 1;
          if (tries >= 3) run("UPDATE messages SET raw = json_set(raw, '$._local_fail', ?) WHERE id = ?", Date.now(), row.id);
          else run("UPDATE messages SET raw = json_set(raw, '$._local_try', ?, '$._local_tries', ?) WHERE id = ?", Date.now(), tries, row.id);
        } else {
          stats.failed++;
          run("UPDATE messages SET raw = json_set(raw, '$._local_fail', ?) WHERE id = ?", Date.now(), row.id);
        }
        await new Promise((ok) => setTimeout(ok, 200));
      }
      const f = freeBytes();
      if (f != null && f < MIN_FREE) break;
    }
  } catch (e: any) {
    console.warn("[media-store] lỗi:", e?.message ?? e);
  } finally {
    running = false;
    if (!timer) {
      timer = setTimeout(() => void loop(), idle);
      timer.unref?.();
    }
  }
}

/** Xóa bản trên NAS quá số ngày giữ (0 = giữ mãi). */
export function cleanupMedia() {
  const { keepDays } = mediaStoreConfig();
  if (!keepDays) return 0;
  const rows = all<{ id: number; local: string }>(
    `SELECT id, json_extract(raw, '$._local') AS local FROM messages
     WHERE msg_type IN (${TYPES_SQL}) AND raw IS NOT NULL AND ts < ? AND json_extract(raw, '$._local') IS NOT NULL`,
    Date.now() - keepDays * 86_400_000,
  );
  let freed = 0;
  for (const r of rows) {
    const m = /^\/uploads\/(media\/\d{4}-\d{2}\/[0-9a-f]{24}\.[a-z0-9]{1,6})$/.exec(r.local ?? "");
    if (m) {
      const file = path.join(config.uploadDir, m[1]);
      try {
        freed += fs.statSync(file).size;
        fs.rmSync(file, { force: true });
      } catch {}
    }
    run("UPDATE messages SET raw = json_remove(raw, '$._local', '$._local_size') WHERE id = ?", r.id);
  }
  if (rows.length) console.info(`[media-store] Đã xóa ${rows.length} bản ảnh / video quá ${keepDays} ngày (${(freed / MB).toFixed(0)} MB)`);
  return rows.length;
}

function report() {
  if (stats.saved || stats.failed) {
    const st = mediaStoreStatus();
    console.info(
      `[media-store] 30 phút qua: lưu lên NAS ${stats.saved} tệp (${(stats.bytes / MB).toFixed(1)} MB), không lưu được ${stats.failed} (link Zalo đã hết hạn) | ` +
        `tổng trên NAS ${st.files} tệp, ${(st.bytes / 1024 / MB).toFixed(2)} GB, còn chờ ${st.pending}` +
        (st.freeBytes != null ? `, ổ trống ${(st.freeBytes / 1024 / MB).toFixed(0)} GB` : ""),
    );
  }
  stats.saved = stats.bytes = stats.failed = 0;
  stats.since = Date.now();
}

export function startMediaStore() {
  bus.on("message.created", (message) => {
    if ((MEDIA_TYPES as readonly string[]).includes(String(message.msg_type))) wake();
  });
  wake(60_000);
  setInterval(report, 30 * 60_000).unref?.();
  const daily = () => {
    try {
      cleanupMedia();
    } catch (e: any) {
      console.warn("[media-store] dọn bản cũ lỗi:", e?.message ?? e);
    }
  };
  setTimeout(daily, 10 * 60_000).unref?.();
  setInterval(daily, 86_400_000).unref?.();
}

/** Chạy một lượt tải ngay (kiểm thử / gọi tay). */
export const runMediaStoreOnce = () => loop();
