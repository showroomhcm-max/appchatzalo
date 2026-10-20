/**
 * Nhật ký hệ thống: ghi mọi console.log / warn / error ra file theo ngày (data/logs) và giữ 3.000 dòng gần nhất
 * trong bộ nhớ để xem nhanh trong Cài đặt › Nhật ký. Tự che token, cookie, mật khẩu trước khi ghi.
 */
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { config } from "./config.js";

export type LogLevel = "info" | "warn" | "error";
export type LogLine = { ts: number; level: LogLevel; msg: string };

const LOG_DIR = path.join(config.dataDir, "logs");
const KEEP_DAYS = 14;
const MAX_LINES = 3000;
const buffer: LogLine[] = [];

fs.mkdirSync(LOG_DIR, { recursive: true });

/** Che thông tin bí mật hay gặp trong log. */
export function redact(text: string) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+){0,2}/g, "eyJ***")
    .replace(/zck_[A-Za-z0-9_-]{8,}/g, "zck_***")
    .replace(/("?(?:password|pass|token|secret|cookie|zpw_sek|zpsid|imei)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***");
}

function fileFor(ts: number) {
  const d = new Date(ts + 7 * 3600_000); // ngày theo giờ Việt Nam
  return path.join(LOG_DIR, `app-${d.toISOString().slice(0, 10)}.log`);
}

function vnTime(ts: number) {
  return new Date(ts + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
}

export function formatLine(l: LogLine) {
  return `${vnTime(l.ts)} [${l.level.toUpperCase()}] ${l.msg}`;
}

function write(level: LogLevel, args: unknown[]) {
  const msg = redact(args.map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 4, breakLength: 160 }))).join(" "));
  const line: LogLine = { ts: Date.now(), level, msg };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  try {
    fs.appendFileSync(fileFor(line.ts), formatLine(line) + "\n");
  } catch {
    /* ổ đĩa đầy / không ghi được: vẫn giữ trong bộ nhớ */
  }
}

let installed = false;
/** Gắn vào console một lần lúc khởi động. */
export function installLogger() {
  if (installed) return;
  installed = true;
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => (write("info", a), orig.log(...a));
  console.info = (...a: unknown[]) => (write("info", a), orig.info(...a));
  console.warn = (...a: unknown[]) => (write("warn", a), orig.warn(...a));
  console.error = (...a: unknown[]) => (write("error", a), orig.error(...a));
  process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));

  // Xóa file log cũ hơn 14 ngày
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const p = path.join(LOG_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    /* ignore */
  }
  preload();
}

/**
 * Nạp lại các dòng gần nhất từ file (2 ngày gần nhất) vào bộ nhớ, để sau khi app khởi động lại
 * (cập nhật bản mới, mất điện) vẫn xem được chuyện xảy ra ngay trước đó.
 */
function preload() {
  try {
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .slice(-2);
    const lines: LogLine[] = [];
    const head = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[(INFO|WARN|ERROR)\] ([\s\S]*)$/;
    for (const f of files) {
      for (const raw of fs.readFileSync(path.join(LOG_DIR, f), "utf8").split("\n")) {
        const m = head.exec(raw);
        if (m) lines.push({ ts: Date.parse(`${m[1]}T${m[2]}+07:00`), level: m[3].toLowerCase() as LogLevel, msg: m[4] });
        else if (raw && lines.length) lines[lines.length - 1].msg += "\n" + raw; // dòng tiếp theo của lỗi nhiều dòng
      }
    }
    buffer.unshift(...lines.slice(-MAX_LINES + buffer.length));
  } catch {
    /* không đọc được file cũ: bỏ qua */
  }
}

export function recentLogs(opts: { level?: string; q?: string; limit?: number }) {
  const q = opts.q?.toLowerCase();
  let list = buffer;
  if (opts.level === "error") list = list.filter((l) => l.level === "error");
  else if (opts.level === "warn") list = list.filter((l) => l.level !== "info");
  if (q) list = list.filter((l) => l.msg.toLowerCase().includes(q));
  return list.slice(-Math.min(opts.limit ?? 500, MAX_LINES)).reverse();
}

/** Nội dung file log của N ngày gần nhất, để tải về gửi đi kiểm tra lỗi. */
export function logFilesText(days: number) {
  const files = fs
    .readdirSync(LOG_DIR)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    .sort()
    .slice(-Math.max(1, Math.min(days, KEEP_DAYS)));
  return files.map((f) => `===== ${f} =====\n` + fs.readFileSync(path.join(LOG_DIR, f), "utf8")).join("\n");
}
