/**
 * Ảnh / tệp đính kèm của tin nhắn mẫu (form CTLM): tải từ link về thư mục uploads/templates để chèn vào tin như tệp thường.
 * - Chỉ http(s) tới địa chỉ công khai: chặn localhost, mạng nội bộ, link-local (tránh dùng link trong file Excel để dò mạng nội bộ).
 * - Tự theo tối đa 3 lần chuyển hướng, kiểm lại địa chỉ mỗi lần; tối đa 10 MB, 20 giây.
 * - Ảnh phải đúng loại ảnh; tệp chỉ nhận đuôi văn phòng / nén / ảnh thường gặp.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { safeRequest } from "./net-guard.js";

const DIR = path.join(config.uploadDir, "templates");
fs.mkdirSync(DIR, { recursive: true });
const MAX = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const FILE_EXT = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".zip", ".rar", ".7z", ".jpg", ".jpeg", ".png", ".webp", ".mp4"]);

async function download(raw: string) {
  // Chỉ địa chỉ công khai, kiểm ngay lúc kết nối (net-guard), tối đa 3 lần chuyển hướng
  let res;
  try {
    res = await safeRequest(raw, { maxBytes: MAX, timeoutMs: 20_000, maxRedirects: 3 });
  } catch (e: any) {
    throw new Error(/MB/.test(e?.message) ? "Tệp quá 10 MB" : e?.message ?? "Không tải được");
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`Không tải được (mã ${res.status})`);
  return { buf: res.body, type: String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase(), url: res.url };
}

const sniffImage = (b: Buffer) =>
  b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.slice(0, 4).toString() === "GIF8" ? "image/gif" : b.slice(8, 12).toString() === "WEBP" ? "image/webp" : "";

/** Tải ảnh mẫu → đường dẫn /uploads/templates/… */
export async function fetchTemplateImage(url: string) {
  const { buf } = await download(url);
  const type = sniffImage(buf);
  if (!IMAGE_TYPES[type]) throw new Error("Link không phải ảnh JPG / PNG / WEBP / GIF");
  const name = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 24) + IMAGE_TYPES[type];
  fs.writeFileSync(path.join(DIR, name), buf);
  return { file: `/uploads/templates/${name}` };
}

/** Tải tệp mẫu (pdf, docx, xlsx…) → đường dẫn + tên gốc */
export async function fetchTemplateFile(url: string) {
  const { buf, url: finalUrl } = await download(url);
  const base = decodeURIComponent(path.basename(finalUrl.pathname)).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "tep";
  const ext = path.extname(base).toLowerCase();
  if (!FILE_EXT.has(ext)) throw new Error(`Không nhận loại tệp ${ext || "(không đuôi)"}`);
  const stored = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 24) + ext;
  fs.writeFileSync(path.join(DIR, stored), buf);
  return { file: `/uploads/templates/${stored}`, name: base };
}
