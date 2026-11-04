/**
 * Tự kiểm tra ảnh / video đã nhập từ Zalo PC (một lần, 2 phút sau khi app khởi động): lấy ngẫu nhiên một số tin,
 * thử mở link ảnh trên máy chủ Zalo rồi ghi kết quả vào nhật ký. Chỉ đọc, không sửa dữ liệu.
 * Dùng để biết ảnh cũ không hiện là do link Zalo đã hết hạn hay do app lưu sai trường.
 */
import { all } from "./db.js";
import { safeRequest } from "./net-guard.js";

const FIELDS = ["thumb", "href", "hdUrl", "oriUrl", "normalUrl", "thumbUrl"] as const;

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
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  // Từng trường link: số link mở được / số link có (kèm đuôi tệp: .jxl trình duyệt máy tính không hiện được)
  const fieldOk = new Map<string, number>();
  const fieldAll = new Map<string, number>();
  // Từng tin: còn ít nhất 1 link ảnh .jpg/.png/... mở được (app hiện được) hay hỏng hết; tách theo độ cũ
  const byAge = new Map<string, number>();
  let oldest = Infinity;
  for (const r of rows) {
    let raw: Record<string, any> = {};
    try {
      raw = JSON.parse(r.raw);
    } catch {
      continue;
    }
    oldest = Math.min(oldest, r.ts);
    const seen = new Map<string, number>();
    let viewable = false;
    for (const f of FIELDS) {
      const url = raw[f];
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
      const ext = url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)?.[1]?.toLowerCase() ?? "?";
      const key = `${f}.${ext}`;
      inc(fieldAll, key);
      const status = seen.get(url) ?? (await probe(url));
      seen.set(url, status);
      if (status >= 200 && status < 300) {
        inc(fieldOk, key);
        if (ext !== "jxl") viewable = true;
      }
    }
    const age = Date.now() - r.ts < 30 * 86_400_000 ? "dưới 30 ngày" : "trên 30 ngày";
    inc(byAge, `${age} ${viewable ? "hiện được" : "hỏng hết"}`);
  }
  const fmt = (m: Map<string, number>) => [...m].map(([k, v]) => `${k}: ${v}`).join(", ");
  const fields = [...fieldAll].map(([k, n]) => `${k} ${fieldOk.get(k) ?? 0}/${n}`).join(", ");
  console.log(
    `[media-check] Ảnh / video nhập từ Zalo PC, thử ${rows.length} tin ngẫu nhiên (cũ nhất ${new Date(oldest).toLocaleDateString("vi-VN")}): ` +
      `${fmt(byAge)} | link mở được theo trường: ${fields}`,
  );
}

export function startMediaCheck() {
  setTimeout(() => void checkImportedMedia().catch((e) => console.warn("[media-check] lỗi:", e?.message ?? e)), 120_000).unref?.();
}
