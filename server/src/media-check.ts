/**
 * Tự kiểm tra ảnh / video đã nhập từ Zalo PC (một lần, 2 phút sau khi app khởi động): lấy ngẫu nhiên một số tin,
 * thử mở link ảnh trên máy chủ Zalo rồi ghi kết quả vào nhật ký. Chỉ đọc, không sửa dữ liệu.
 * Dùng để biết ảnh cũ không hiện là do link Zalo đã hết hạn hay do app lưu sai trường.
 */
import { all } from "./db.js";
import { safeRequest } from "./net-guard.js";

const FIELDS = ["href", "thumb", "hdUrl", "oriUrl", "normalUrl", "thumbUrl"] as const;

async function probe(url: string) {
  try {
    const r = await safeRequest(url, { maxBytes: 64 * 1024, timeoutMs: 10_000, maxRedirects: 2, headers: { Range: "bytes=0-1023" } });
    return r.status;
  } catch (e: any) {
    // Đọc quá 64 KB nghĩa là máy chủ trả cả ảnh (không hỗ trợ Range): vẫn là mở được
    return /MB/.test(e?.message ?? "") ? 200 : 0;
  }
}

export async function checkImportedMedia() {
  const rows = all<{ msg_type: string; raw: string; ts: number }>(
    `SELECT msg_type, raw, ts FROM messages
     WHERE source = 'history' AND msg_type IN ('chat.photo', 'chat.video.msg') AND raw IS NOT NULL
     ORDER BY RANDOM() LIMIT 30`,
  );
  if (!rows.length) return;
  const fieldCount = new Map<string, number>();
  const result = new Map<string, number>();
  const hosts = new Map<string, number>();
  let oldest = Infinity;
  for (const r of rows) {
    let raw: Record<string, any> = {};
    try {
      raw = JSON.parse(r.raw);
    } catch {
      continue;
    }
    oldest = Math.min(oldest, r.ts);
    for (const f of FIELDS) if (typeof raw[f] === "string" && raw[f]) fieldCount.set(f, (fieldCount.get(f) ?? 0) + 1);
    // Thử link app hiển thị trước (ảnh nhỏ rồi tới ảnh gốc)
    const url = [raw.thumb, raw.href, raw.thumbUrl, raw.hdUrl, raw.oriUrl, raw.normalUrl].find((u) => typeof u === "string" && /^https?:\/\//.test(u));
    if (!url) {
      result.set("không có link", (result.get("không có link") ?? 0) + 1);
      continue;
    }
    try {
      const u = new URL(url);
      const ext = u.pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
      const key = `${u.hostname.replace(/^[^.]*\d[^.]*\./, "*.")}${ext ? ` [${ext}]` : ""}`;
      hosts.set(key, (hosts.get(key) ?? 0) + 1);
    } catch {
      /* link lạ */
    }
    const status = await probe(url);
    const label = status >= 200 && status < 300 ? "mở được" : status ? `lỗi ${status}` : "không kết nối được";
    result.set(label, (result.get(label) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>) => [...m].map(([k, v]) => `${k}: ${v}`).join(", ");
  console.log(
    `[media-check] Ảnh / video nhập từ Zalo PC, thử ${rows.length} tin ngẫu nhiên (cũ nhất ${new Date(oldest).toLocaleDateString("vi-VN")}): ${fmt(result)}` +
      ` | trường có dữ liệu: ${fmt(fieldCount)} | máy chủ ảnh: ${fmt(hosts)}`,
  );
}

export function startMediaCheck() {
  setTimeout(() => void checkImportedMedia().catch((e) => console.warn("[media-check] lỗi:", e?.message ?? e)), 120_000).unref?.();
}
