#!/usr/bin/env node
/**
 * Nhập lịch sử tin nhắn từ Zalo PC lên Chat Siêu Tốc.
 *
 * (Cách tiện hơn: bấm "Đồng bộ tin nhắn cũ" trên app, chương trình chạy nền scripts/dong-bo-zalo-pc.mjs tự làm.)
 *
 * Zalo web (cách app kết nối) chỉ cho lấy tin kể từ lúc tài khoản được gắn vào app. Zalo PC thì có lịch sử
 * điện thoại đồng bộ sang và lưu trên máy. Công cụ này mở lại Zalo PC ở chế độ gỡ lỗi CHỈ TRONG MÁY (127.0.0.1),
 * nhờ chính Zalo PC đọc tin (chức năng sao lưu có sẵn: DataAccess.loadMessagesForBackup — không bẻ khóa, không gửi /
 * xóa gì trên Zalo), gửi lên app theo từng lô, rồi mở lại Zalo PC bình thường.
 *
 * Chạy trong D:\appchatzalommz (cần server/data/.jwt-secret giống trên NAS):
 *   node scripts/nhap-tu-zalo-pc.mjs              nhập 90 ngày gần nhất vào kênh Zalo trùng tài khoản đang mở trên Zalo PC
 *   node scripts/nhap-tu-zalo-pc.mjs --thu        chỉ đọc và đếm, không gửi lên app
 *   node scripts/nhap-tu-zalo-pc.mjs --ngay 30    số ngày (mặc định 90)
 *   node scripts/nhap-tu-zalo-pc.mjs --kenh 7     chỉ định kênh (máy chủ vẫn kiểm phải đúng tài khoản)
 *   --base http://localhost:3000 --data demo-data  thử trên bản demo
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openZaloPc, readAllConversations } from "./dong-bo-zalo-pc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const DRY = args.includes("--thu");
const DAYS = Math.max(1, Math.min(3650, Number(opt("--ngay", 90)) || 90));
const CHANNEL = opt("--kenh", null);
const BASE = (opt("--base", process.env.APP_URL || "https://cskhzalo.sieutoc.com")).replace(/\/+$/, "");
const KEEP_DEBUG = args.includes("--giu-zalo");
const DATA_DIR = path.resolve(ROOT, opt("--data", path.join("server", "data")));
const cutoff = Date.now() - DAYS * 86_400_000;
const log = (...a) => console.log(new Date().toLocaleTimeString("vi-VN"), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── Phiên Super Admin ngắn hạn (giống scripts/nhat-ky.mjs) ─────────
const require = createRequire(path.join(ROOT, "server", "package.json"));
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");
function token() {
  const dataDir = DATA_DIR;
  const db = new DatabaseSync(path.join(dataDir, "app.db"), { readOnly: true });
  const admin = db.prepare("SELECT id FROM users WHERE super_admin = 1 AND active = 1 ORDER BY id LIMIT 1").get();
  db.close();
  if (!admin) throw new Error("Không thấy tài khoản Super Admin trong server/data/app.db");
  return jwt.sign({ sub: admin.id }, fs.readFileSync(path.join(dataDir, ".jwt-secret"), "utf8").trim(), { expiresIn: "10m" });
}
async function api(p, init = {}) {
  // Máy chủ đang khởi động lại (cập nhật bản mới) / mất mạng: đợi rồi thử lại, tối đa ~5 phút
  for (let attempt = 1; ; attempt++) {
    try {
      return await apiOnce(p, init);
    } catch (e) {
      if (!e.retry || attempt >= 10) throw e;
      log(`Máy chủ chưa trả lời (${e.message}), thử lại sau 30 giây… (${attempt}/10)`);
      await sleep(30_000);
    }
  }
}
async function apiOnce(p, init = {}) {
  let r;
  try {
    r = await fetch(`${BASE}/api${p}`, { ...init, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    throw Object.assign(new Error(`${p}: ${e.message}`), { retry: true });
  }
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!r.ok) throw Object.assign(new Error(`${p}: ${data?.error ?? `HTTP ${r.status}`}`), { retry: r.status === 502 || r.status === 503 || r.status === 504 || (r.status >= 520 && r.status <= 530) });
  return data;
}

// ───────── Chạy ─────────
const zp = await openZaloPc(log);
try {
  log(`Zalo PC đang đăng nhập tài khoản ${zp.uid}: ${zp.convs.length} hội thoại (${zp.convs.filter((c) => c.isGroup).length} nhóm)`);
  let channelId = null;
  if (!DRY) {
    const statuses = await api("/zalo/status");
    const match = statuses.filter((s) => s.platform === "zalo" && String(s.account?.id ?? "") === zp.uid);
    // --kenh: dùng luôn kênh đó (máy chủ vẫn từ chối nếu tài khoản không khớp), kể cả khi kênh đang chưa kết nối
    const pick = CHANNEL ? match.find((s) => String(s.channelId) === String(CHANNEL)) ?? statuses.find((s) => String(s.channelId) === String(CHANNEL)) : match[0];
    if (!pick) throw new Error(`Không có kênh Zalo nào trên app đang kết nối tài khoản ${zp.uid}${CHANNEL ? ` (kênh ${CHANNEL})` : ""}. Quét QR kênh đó trên app trước.`);
    channelId = pick.channelId;
    log(`Nhập vào kênh #${channelId} "${pick.channelName}", tin ${DAYS} ngày gần nhất (từ ${new Date(cutoff).toLocaleDateString("vi-VN")})`);
  } else log(`Chế độ thử: chỉ đọc và đếm tin ${DAYS} ngày gần nhất, không gửi lên app`);

  let added = 0, skipped = 0;
  const res = await readAllConversations(zp, cutoff, {
    sendBatch: async (messages, conversations) => {
      if (DRY) return;
      const r = await api(`/channels/${channelId}/import-history`, { method: "POST", body: JSON.stringify({ account_uid: zp.uid, conversations, messages }) });
      added += r.added;
      skipped += r.skipped;
    },
    onProgress: (p) => {
      if (p.convsDone % 50 === 0 || p.convsDone === p.convsTotal) log(`Đã đọc ${p.convsDone}/${p.convsTotal} hội thoại — ${p.read} tin${DRY ? "" : `, đã nhập mới ${added}`}`);
    },
  });
  log(`XONG: đọc ${res.read} tin trong ${res.convWith} hội thoại có tin ${DAYS} ngày gần nhất.`);
  log(`Theo loại: ${Object.entries(res.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (!DRY) log(`Nhập mới ${added} tin, bỏ qua ${skipped} (đã có sẵn / loại tin không hỗ trợ).`);
} finally {
  await zp.close(KEEP_DEBUG);
}
