/**
 * Ảnh / tệp đính kèm của tin nhắn mẫu (form CTLM): tải từ link về thư mục uploads/templates để chèn vào tin như tệp thường.
 * - Chỉ http(s) tới địa chỉ công khai: chặn localhost, mạng nội bộ, link-local (tránh dùng link trong file Excel để dò mạng nội bộ).
 * - Tự theo tối đa 3 lần chuyển hướng, kiểm lại địa chỉ mỗi lần; tối đa 10 MB, 20 giây.
 * - Ảnh phải đúng loại ảnh; tệp chỉ nhận đuôi văn phòng / nén / ảnh thường gặp.
 */
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { config } from "./config.js";

const DIR = path.join(config.uploadDir, "templates");
fs.mkdirSync(DIR, { recursive: true });
const MAX = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const FILE_EXT = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".zip", ".rar", ".7z", ".jpg", ".jpeg", ".png", ".webp", ".mp4"]);

function privateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

async function assertPublic(u: URL) {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Link phải là http(s)");
  if (u.username || u.password) throw new Error("Link không được chứa tài khoản");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(privateIp)) throw new Error("Link trỏ vào mạng nội bộ, không tải");
}

async function download(raw: string) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Link không hợp lệ");
  }
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "ChatSieuToc/1.0" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Không tải được (mã ${res.status})`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX) throw new Error("Tệp quá 10 MB");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of res.body as any as AsyncIterable<Uint8Array>) {
      size += c.length;
      if (size > MAX) throw new Error("Tệp quá 10 MB");
      chunks.push(Buffer.from(c));
    }
    return { buf: Buffer.concat(chunks), type: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), url: u };
  }
  throw new Error("Chuyển hướng quá nhiều lần");
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
