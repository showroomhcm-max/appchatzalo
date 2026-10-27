#!/usr/bin/env node
/**
 * Nhập lịch sử tin nhắn từ Zalo PC lên Chat Siêu Tốc.
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
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

// ───────── Zalo PC ─────────
function zaloExe() {
  const base = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Zalo");
  const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^Zalo-[\d.]+$/.test(d) && fs.existsSync(path.join(base, d, "Zalo.exe"))) : [];
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error(`Không tìm thấy Zalo PC trong ${base}`);
  return { versioned: path.join(base, versions.at(-1), "Zalo.exe"), launcher: path.join(base, "Zalo.exe") };
}
function closeZalo() {
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", "Get-Process Zalo -ErrorAction SilentlyContinue | % { $_.CloseMainWindow() | Out-Null }; Start-Sleep -Seconds 3; Get-Process Zalo -ErrorAction SilentlyContinue | Stop-Process -Force"], { stdio: "ignore" });
  } catch {}
}
function startZalo(exe, extra = []) {
  spawn(exe, extra, { detached: true, stdio: "ignore" }).unref();
}
const freePort = () =>
  new Promise((ok) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

async function waitPage(port) {
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.title === "Zalo");
      if (page) return page;
      last = list.map((t) => t.title).join(", ") || "đang mở";
    } catch (e) {
      last = e.message;
    }
    await sleep(1000);
  }
  throw new Error(`Zalo PC chưa sẵn sàng sau 2 phút (${last}). Nếu Zalo PC đang ở màn hình đăng nhập, đăng nhập rồi chạy lại.`);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      p(m);
    }
  };
  const ready = new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)));
  return {
    ready,
    close: () => ws.close(),
    async eval(expression) {
      await ready;
      const m = await new Promise((ok) => {
        const i = ++id;
        pending.set(i, ok);
        ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      if (m.error) throw new Error(JSON.stringify(m.error));
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
      return m.result?.result?.value;
    },
  };
}

// Chạy trong Zalo PC: tìm các phần cần dùng (tên module đổi theo bản Zalo nên dò theo tên hàm, không ghi cứng)
const SETUP = `(async () => {
  if (!window.webpackJsonp) throw new Error("Bản Zalo PC này không có webpackJsonp — công cụ chưa hỗ trợ");
  if (!window.__zr) {
    const k = "zimp" + Math.random().toString(36).slice(2);
    window.webpackJsonp.push([[k], { [k]: (m, e, r) => { window.__zr = r; } }, [[k]]]);
  }
  const r = window.__zr;
  const protoNames = (o) => { const s = new Set(); let p = o; for (let i = 0; i < 3 && p && p !== Object.prototype; i++) { Object.getOwnPropertyNames(p).forEach((n) => s.add(n)); p = Object.getPrototypeOf(p); } return [...s]; };
  let Backup = null, uid = null, groupsSrc = null, friendsSrc = null;
  for (const [id, f] of Object.entries(r.m)) {
    if (Backup) break;
    if (!Function.prototype.toString.call(f).includes("loadMessagesForBackup")) continue;
    const ex = r(id);
    for (const v of Object.values(ex || {})) if (typeof v === "function" && v.prototype && typeof v.prototype.setUserId === "function") { Backup = v; break; }
  }
  if (!Backup) throw new Error("Không tìm thấy chức năng sao lưu của Zalo PC (Zalo đã đổi bản?)");
  for (const mod of Object.values(r.c)) {
    const ex = mod && mod.exports; if (!ex) continue;
    for (const v of Object.values(ex)) {
      if (!v || typeof v !== "object") continue;
      try {
        if (!uid && typeof v.getUserId === "function" && /^\\d{6,}$/.test(String(v.getUserId()))) uid = String(v.getUserId());
        if (!groupsSrc && typeof v.getGroupsListSync === "function" && Array.isArray(v.getGroupsListSync())) groupsSrc = v;
        if (!friendsSrc && typeof v.getFriendsSync === "function") friendsSrc = v;
      } catch {}
    }
  }
  if (!uid) throw new Error("Không đọc được tài khoản đang đăng nhập Zalo PC");
  const inst = new Backup(); inst.setUserId(uid); inst.setUIN(uid);
  const names = {};
  try { for (const g of groupsSrc ? groupsSrc.getGroupsListSync() : []) { const id = String(g.userId || g.id || "").replace(/^g/, ""); if (id) names[id] = { name: g.displayName || g.name || "", avatar: g.avt || g.avatar || "" }; } } catch {}
  try { const fr = friendsSrc ? friendsSrc.getFriendsSync() : []; for (const f of Array.isArray(fr) ? fr : Object.values(fr || {})) { const id = String(f.userId || f.uid || f.id || ""); if (id) names[id] = { name: f.displayName || f.zaloName || f.dName || "", avatar: f.avatar || f.avt || "" }; } } catch {}
  const convs = await inst.DataAccess.loadConversationsForBackup();
  window.__zimp = { da: inst.DataAccess, uid };
  return {
    uid,
    convs: (Array.isArray(convs) ? convs : Object.values(convs || {})).map((c) => {
      const raw = String(c.userId); const isGroup = !!c.isGroup || raw.startsWith("g"); const id = raw.replace(/^g/, "");
      return { raw, threadId: id, isGroup, name: (names[id] && names[id].name) || "", avatar: (names[id] && names[id].avatar) || "" };
    }),
  };
})()`;

// Chạy trong Zalo PC: đọc tin một hội thoại từ mới → cũ, dừng khi quá mốc ngày
const READ = (raw, threadId, isGroup) => `(async () => {
  const da = window.__zimp.da;
  const cutoff = ${cutoff};
  const out = []; const seen = new Set();
  let cursor = "9999999999999";
  for (let page = 0; page < 200; page++) {
    const b = await da.loadMessagesForBackup(${JSON.stringify(raw)}, cursor, 2000);
    if (!Array.isArray(b) || !b.length) break;
    let oldest = Infinity, next = "";
    for (const m of b) {
      const id = String(m.msgId ?? "");
      const ts = Number(m.sendDttm);
      if (/^\\d+$/.test(id)) { next = id; if (ts < oldest) oldest = ts; }
      if (!/^\\d+$/.test(id) || seen.has(id) || !(ts >= cutoff)) continue;
      seen.add(id);
      let content = m.message;
      if (content && typeof content === "object") {
        content = Object.assign({}, content);
        // Ảnh / GIF / video trên Zalo PC lưu oriUrl / hdUrl / thumbUrl; app đọc href / thumb như Zalo web
        if (!content.href) content.href = content.hdUrl || content.oriUrl || content.normalUrl || "";
        if (!content.thumb) content.thumb = content.thumbUrl || "";
      }
      const q = m.quote && typeof m.quote === "object" ? { msg: String(m.quote.msg ?? ""), fromD: String(m.quote.fromD ?? ""), globalMsgId: String(m.quote.globalMsgId ?? ""), ownerId: String(m.quote.ownerId ?? "") } : null;
      out.push({ msgId: id, cliMsgId: m.cliMsgId != null ? String(m.cliMsgId) : null, threadId: ${JSON.stringify(threadId)}, isGroup: ${isGroup},
        fromUid: String(m.fromUid ?? ""), dName: m.dName || null, msgType: m.originMsgType || (Number(m.msgType) === 1 ? "webchat" : ""), content, ts, quote: q });
    }
    if (b.length < 2000 || oldest < cutoff || !next || next === cursor) break;
    cursor = next;
  }
  return out;
})()`;

// ───────── Chạy ─────────
const exe = zaloExe();
const port = await freePort();
log(`Đóng Zalo PC rồi mở lại ở chế độ đọc dữ liệu (chỉ trong máy, cổng ${port})…`);
closeZalo();
await sleep(1500);
startZalo(exe.versioned, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"]);
let page, client;
try {
  page = await waitPage(port);
  client = cdp(page.webSocketDebuggerUrl);
  await sleep(3000); // đợi Zalo nạp xong dữ liệu
  const { uid, convs } = await client.eval(SETUP);
  log(`Zalo PC đang đăng nhập tài khoản ${uid}: ${convs.length} hội thoại (${convs.filter((c) => c.isGroup).length} nhóm)`);

  let channelId = null;
  if (!DRY) {
    const statuses = await api("/zalo/status");
    const match = statuses.filter((s) => s.platform === "zalo" && String(s.account?.id ?? "") === uid);
    // --kenh: dùng luôn kênh đó (máy chủ vẫn từ chối nếu tài khoản không khớp), kể cả khi kênh đang chưa kết nối
    const pick = CHANNEL ? match.find((s) => String(s.channelId) === String(CHANNEL)) ?? statuses.find((s) => String(s.channelId) === String(CHANNEL)) : match[0];
    if (!pick) throw new Error(`Không có kênh Zalo nào trên app đang kết nối tài khoản ${uid}${CHANNEL ? ` (kênh ${CHANNEL})` : ""}. Quét QR kênh đó trên app trước.`);
    channelId = pick.channelId;
    log(`Nhập vào kênh #${channelId} "${pick.channelName}", tin ${DAYS} ngày gần nhất (từ ${new Date(cutoff).toLocaleDateString("vi-VN")})`);
  } else log(`Chế độ thử: chỉ đọc và đếm tin ${DAYS} ngày gần nhất, không gửi lên app`);

  const meta = new Map(convs.map((c) => [c.threadId, { threadId: c.threadId, isGroup: c.isGroup, name: c.name, avatar: c.avatar }]));
  let batch = [], batchBytes = 0, read = 0, added = 0, skipped = 0, convWith = 0;
  const types = {};
  const flush = async () => {
    if (!batch.length) return;
    if (!DRY) {
      const threads = [...new Set(batch.map((m) => m.threadId))];
      const r = await api(`/channels/${channelId}/import-history`, {
        method: "POST",
        body: JSON.stringify({ account_uid: uid, conversations: threads.map((t) => meta.get(t)).filter(Boolean), messages: batch }),
      });
      added += r.added;
      skipped += r.skipped;
    }
    batch = [];
    batchBytes = 0;
  };
  for (let i = 0; i < convs.length; i++) {
    const c = convs[i];
    const msgs = await client.eval(READ(c.raw, c.threadId, c.isGroup));
    if (msgs.length) convWith++;
    read += msgs.length;
    for (const m of msgs) {
      types[m.msgType || "?"] = (types[m.msgType || "?"] ?? 0) + 1;
      const size = JSON.stringify(m).length + 1;
      if (batch.length >= 1500 || batchBytes + size > 1_400_000) await flush();
      batch.push(m);
      batchBytes += size;
    }
    if ((i + 1) % 50 === 0 || i === convs.length - 1) log(`Đã đọc ${i + 1}/${convs.length} hội thoại — ${read} tin${DRY ? "" : `, đã nhập mới ${added}`}`);
  }
  await flush();
  log(`XONG: đọc ${read} tin trong ${convWith} hội thoại có tin ${DAYS} ngày gần nhất.`);
  log(`Theo loại: ${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (!DRY) log(`Nhập mới ${added} tin, bỏ qua ${skipped} (đã có sẵn / loại tin không hỗ trợ).`);
} finally {
  client?.close();
  if (!KEEP_DEBUG) {
    log("Mở lại Zalo PC bình thường…");
    closeZalo();
    await sleep(1500);
    startZalo(fs.existsSync(exe.launcher) ? exe.launcher : exe.versioned);
  }
}
