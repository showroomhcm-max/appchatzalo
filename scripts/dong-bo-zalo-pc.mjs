#!/usr/bin/env node
/**
 * Chương trình đồng bộ Zalo PC cho Chat Siêu Tốc. Chạy nền trên máy có Zalo PC.
 *
 * Trên app, bấm "Đồng bộ tin nhắn cũ" ở một kênh Zalo → app tạo việc. Chương trình này hỏi app mỗi 10 giây;
 * nếu Zalo PC trên máy đăng nhập CÙNG tài khoản Zalo với kênh thì nhận việc: mở lại Zalo PC ở chế độ đọc dữ liệu
 * CHỈ TRONG MÁY (127.0.0.1), nhờ chính Zalo PC đọc tin (chức năng sao lưu có sẵn — không bẻ khóa, không gửi / xóa
 * gì trên Zalo), gửi lên app theo từng lô, rồi mở lại Zalo PC bình thường.
 *
 * Cách cài dễ nhất: app › Cài đặt › Kết nối kênh › Máy đồng bộ Zalo PC › Tải bộ cài (.zip), giải nén, bấm đúp
 * "CAI DAT.cmd" (tự cài Node.js nếu thiếu). Hoặc chạy tay (cần Node.js 22+):
 *   node dong-bo-zalo-pc.mjs --ket-noi <mã máy>     lưu mã, bật tự chạy khi mở máy, rồi chạy luôn
 *   node dong-bo-zalo-pc.mjs                         chạy (đọc cấu hình đã lưu)
 *   node dong-bo-zalo-pc.mjs --go                    gỡ tự chạy khi mở máy
 * Cấu hình + nhật ký: %APPDATA%\ChatSieuToc\
 *
 * Từ bản 1.2.0:
 * - Tự cập nhật: app có bản chương trình mới hơn thì tự tải về, thay file rồi chạy lại (không phải cài lại).
 * - Đếm ảnh / video Zalo PC còn giữ trên máy (mỗi 6 giờ): chỉ gửi TÊN + dung lượng tệp lên app để ghép với tin
 *   có ảnh đã hết hạn trên Zalo; không mở / tắt Zalo PC.
 * Từ bản 1.3.0: gửi lên NAS đúng những ảnh / video app hỏi (tin đang mất ảnh, còn trong hạn giữ), mỗi lượt tối đa
 * 100 tệp, nghỉ giữa các tệp để không chiếm mạng.
 *
 * File này cũng là thư viện đọc Zalo PC cho scripts/nhap-tu-zalo-pc.mjs (openZaloPc, readAllConversations).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const VERSION = "1.3.1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═════════════════════════ Đọc Zalo PC ═════════════════════════

function zaloExe() {
  const base = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Zalo");
  const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^Zalo-[\d.]+$/.test(d) && fs.existsSync(path.join(base, d, "Zalo.exe"))) : [];
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error(`Không tìm thấy Zalo PC trong ${base}. Cài Zalo PC (zalo.me/pc) rồi thử lại.`);
  return { versioned: path.join(base, versions.at(-1), "Zalo.exe"), launcher: path.join(base, "Zalo.exe") };
}
function closeZalo() {
  try {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "Get-Process Zalo -ErrorAction SilentlyContinue | % { $_.CloseMainWindow() | Out-Null }; Start-Sleep -Seconds 3; Get-Process Zalo -ErrorAction SilentlyContinue | Stop-Process -Force"],
      { stdio: "ignore", windowsHide: true },
    );
  } catch {}
}
const startZalo = (exe, extra = []) => spawn(exe, extra, { detached: true, stdio: "ignore" }).unref();
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
  throw new Error(`Zalo PC chưa sẵn sàng sau 2 phút (${last}). Nếu Zalo PC đang ở màn hình đăng nhập, đăng nhập rồi thử lại.`);
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
  if (!window.webpackJsonp) throw new Error("Bản Zalo PC này không có webpackJsonp — chương trình chưa hỗ trợ");
  if (!window.__zr) {
    const k = "zimp" + Math.random().toString(36).slice(2);
    window.webpackJsonp.push([[k], { [k]: (m, e, r) => { window.__zr = r; } }, [[k]]]);
  }
  const r = window.__zr;
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
const READ = (raw, threadId, isGroup, cutoff) => `(async () => {
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

/**
 * Đóng Zalo PC, mở lại ở chế độ đọc dữ liệu (chỉ trong máy), đọc tài khoản + danh sách hội thoại.
 * Luôn gọi close() khi xong để mở lại Zalo PC bình thường.
 */
export async function openZaloPc(log = () => {}) {
  const exe = zaloExe();
  const port = await freePort();
  log(`Đóng Zalo PC rồi mở lại ở chế độ đọc dữ liệu (chỉ trong máy, cổng ${port})…`);
  closeZalo();
  await sleep(1500);
  startZalo(exe.versioned, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"]);
  let client = null;
  const close = async (keep = false) => {
    client?.close();
    if (keep) return;
    log("Mở lại Zalo PC bình thường…");
    closeZalo();
    await sleep(1500);
    startZalo(fs.existsSync(exe.launcher) ? exe.launcher : exe.versioned);
  };
  try {
    const page = await waitPage(port);
    client = cdp(page.webSocketDebuggerUrl);
    await sleep(3000); // đợi Zalo nạp xong dữ liệu
    const { uid, convs } = await client.eval(SETUP);
    return { uid, convs, close, read: (c, cutoff) => client.eval(READ(c.raw, c.threadId, c.isGroup, cutoff)) };
  } catch (e) {
    await close();
    throw e;
  }
}

/**
 * Đọc mọi hội thoại từ mốc cutoff, gom thành lô (< 1,4 MB, ≤ 1.500 tin) rồi gọi sendBatch(lô).
 * onProgress mỗi ~25 hội thoại; trả về false để dừng giữa chừng.
 */
export async function readAllConversations(zp, cutoff, { sendBatch, onProgress }) {
  const meta = new Map(zp.convs.map((c) => [c.threadId, { threadId: c.threadId, isGroup: c.isGroup, name: c.name, avatar: c.avatar }]));
  let batch = [], bytes = 0, read = 0, convWith = 0;
  const types = {};
  const flush = async () => {
    if (!batch.length) return;
    const threads = [...new Set(batch.map((m) => m.threadId))];
    await sendBatch(batch, threads.map((t) => meta.get(t)).filter(Boolean));
    batch = [];
    bytes = 0;
  };
  for (let i = 0; i < zp.convs.length; i++) {
    const msgs = await zp.read(zp.convs[i], cutoff);
    if (msgs.length) convWith++;
    read += msgs.length;
    for (const m of msgs) {
      types[m.msgType || "?"] = (types[m.msgType || "?"] ?? 0) + 1;
      const size = JSON.stringify(m).length + 1;
      if (batch.length >= 1500 || bytes + size > 1_400_000) await flush();
      batch.push(m);
      bytes += size;
    }
    if ((i + 1) % 25 === 0 || i === zp.convs.length - 1) {
      await flush();
      if ((await onProgress?.({ convsDone: i + 1, convsTotal: zp.convs.length, read })) === false) return { read, convWith, types, stopped: true };
    }
  }
  await flush();
  return { read, convWith, types, stopped: false };
}

// ═════════════════════════ Chương trình chạy nền ═════════════════════════

const HOME = path.join(process.env.APPDATA ?? os.homedir(), "ChatSieuToc");
const CONFIG = path.join(HOME, "dong-bo-zalo-pc.json");
const LOG = path.join(HOME, "dong-bo-zalo-pc.log");
const LOCK = path.join(HOME, "dong-bo-zalo-pc.pid");
const INSTALLED = path.join(HOME, "dong-bo-zalo-pc.mjs");
const STARTUP = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Chat Sieu Toc - dong bo Zalo PC.vbs");

function log(...a) {
  const line = `${new Date().toLocaleString("vi-VN", { hour12: false })} ${a.join(" ")}`;
  console.log(line);
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
    if (fs.statSync(LOG).size > 2_000_000) fs.writeFileSync(LOG, fs.readFileSync(LOG, "utf8").slice(-500_000));
  } catch {}
}
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return null;
  }
};
const writeConfig = (c) => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2));
};

function makeApi(cfg) {
  const once = async (p, body) => {
    let r;
    try {
      r = await fetch(`${cfg.base}/api/pc-agent${p}`, {
        method: "POST",
        headers: { Authorization: `Agent ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw Object.assign(new Error(e.message), { retry: true });
    }
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!r.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${r.status}`), { status: r.status, retry: r.status === 502 || r.status === 503 || r.status === 504 || (r.status >= 520 && r.status <= 530) });
    return data;
  };
  // Máy chủ đang khởi động lại (cập nhật bản mới) / mất mạng: đợi rồi thử lại, tối đa ~5 phút
  return async (p, body, retries = 10) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(p, body);
      } catch (e) {
        if (!e.retry || attempt >= retries) throw e;
        await sleep(30_000);
      }
    }
  };
}

function installAutostart() {
  if (!process.env.APPDATA) return;
  fs.mkdirSync(HOME, { recursive: true });
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(self) !== path.resolve(INSTALLED)) fs.copyFileSync(self, INSTALLED);
  // Chạy ẩn (không hiện cửa sổ đen) mỗi khi đăng nhập Windows
  const vbs = `Set sh = CreateObject("WScript.Shell")\r\nsh.Run """${process.execPath}"" ""${INSTALLED}""", 0, False\r\n`;
  fs.writeFileSync(STARTUP, vbs);
  log(`Đã bật tự chạy khi mở máy (${STARTUP})`);
}

/** Tắt bản đang chạy nền (khi cài lại / gỡ). */
function stopRunning() {
  try {
    const pid = Number(fs.readFileSync(LOCK, "utf8"));
    if (pid && pid !== process.pid) {
      // Chỉ tắt đúng tiến trình của chương trình này (số pid cũ có thể đã thuộc về chương trình khác)
      const cmd = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (cmd.includes("dong-bo-zalo-pc")) process.kill(pid);
    }
  } catch {}
  try {
    fs.rmSync(LOCK, { force: true });
  } catch {}
}

/** Chỉ một bản chạy cùng lúc trên mỗi máy. */
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, "utf8"));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {}
    }
  } catch {}
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}

// ───────────── Tự cập nhật ─────────────

const newer = (a, b) => {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/** App có bản mới hơn → tải, kiểm, thay file đã cài rồi chạy lại (tiến trình này thoát). */
async function selfUpdate(cfg, latest) {
  if (!latest || !newer(latest, VERSION)) return;
  if (path.resolve(fileURLToPath(import.meta.url)) !== path.resolve(INSTALLED)) return; // chạy tay từ thư mục khác: bỏ qua
  try {
    const r = await fetch(`${cfg.base}/api/pc-agent/script`, { headers: { Authorization: `Agent ${cfg.key}` }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const code = await r.text();
    if (!code.includes(`export const VERSION = "${latest}"`) || !code.includes("async function agentLoop")) throw new Error("tệp tải về không đúng");
    fs.writeFileSync(INSTALLED + ".new", code);
    fs.renameSync(INSTALLED + ".new", INSTALLED);
    log(`Đã cập nhật chương trình ${VERSION} → ${latest}, chạy lại…`);
    fs.rmSync(LOCK, { force: true });
    spawn(process.execPath, [INSTALLED], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    process.exit(0);
  } catch (e) {
    log(`Không tự cập nhật được lên ${latest}: ${e.message}`);
  }
}

// ───────────── Ảnh / video Zalo PC còn giữ trên máy ─────────────

// Mỗi tài khoản Windows có thư mục Zalo PC riêng: app tách danh sách / tệp cần tải theo tên máy + tài khoản
const INSTANCE = `${os.hostname()}/${(() => { try { return os.userInfo().username; } catch { return ""; } })()}`;
const MEDIA_ROOT = path.join(process.env.APPDATA ?? "", "ZaloData", "media");
const KINDS = ["picture", "video", "Cache"];

/** Tên + dung lượng tệp ảnh / video Zalo PC đã tải về, theo từng tài khoản Zalo trên máy. */
export function scanZaloMedia() {
  const out = [];
  let uids = [];
  try {
    uids = fs.readdirSync(MEDIA_ROOT).filter((d) => /^\d{6,25}$/.test(d));
  } catch {
    return out;
  }
  for (const uid of uids) {
    const base = path.join(MEDIA_ROOT, uid, "ZaloDownloads", "resource");
    const files = [];
    let threads = [];
    try {
      threads = fs.readdirSync(base).filter((d) => /^g?\d{3,25}$/.test(d));
    } catch {}
    for (const t of threads) {
      for (const k of KINDS) {
        let names = [];
        try {
          names = fs.readdirSync(path.join(base, t, k));
        } catch {
          continue;
        }
        for (const n of names) {
          if (!/^\d{12,14}_\d+_g?\d+/.test(n)) continue;
          try {
            files.push({ p: `${t}/${k}/${n}`, s: fs.statSync(path.join(base, t, k, n)).size });
          } catch {}
        }
      }
    }
    out.push({ uid, files });
  }
  return out;
}

/** Tài khoản Zalo trên máy có tệp ghép được với tin trên app: còn tải lên dần. */
const uploadQueue = new Set();

/** Gửi danh sách lên app theo lô (app bỏ qua tài khoản Zalo không phải kênh của mình). */
async function reportZaloMedia(api) {
  for (const { uid, files } of scanZaloMedia()) {
    let matched = 0;
    for (let i = 0; i < Math.max(files.length, 1); i += 2000) {
      const last = i + 2000 >= files.length;
      const r = await api("/media/manifest", { uid, instance: INSTANCE, files: files.slice(i, i + 2000), first: i === 0, last }, 3);
      if (r?.ignored) break;
      matched += r?.matched ?? 0;
      if (last) log(`Zalo PC tài khoản ${uid}: còn giữ ${files.length} tệp ảnh / video, ghép được ${matched} tin trên app`);
    }
    if (matched > 0) uploadQueue.add(uid);
  }
}

const SAFE_REL = /^g?\d{3,25}\/(picture|video|Cache)\/[\w.]{10,120}$/;

/** Một lượt tải lên NAS (tối đa 100 tệp app hỏi). Hết tệp thì bỏ tài khoản khỏi hàng chờ. */
async function uploadZaloMedia(cfg, api) {
  for (const uid of [...uploadQueue]) {
    const r = await api("/media/wanted", { uid, instance: INSTANCE }, 3);
    if (!r?.files?.length) {
      uploadQueue.delete(uid);
      if (r?.reason) log(`Không tải ảnh Zalo PC lên: ${r.reason}`);
      continue;
    }
    const base = path.join(MEDIA_ROOT, uid, "ZaloDownloads", "resource");
    let sent = 0;
    let bytes = 0;
    let failed = 0;
    for (const f of r.files) {
      if (!SAFE_REL.test(f.p)) continue;
      let data;
      try {
        data = fs.readFileSync(path.join(base, ...f.p.split("/")));
      } catch {
        data = null; // Zalo PC đã dọn tệp này: báo app bỏ qua
      }
      const q = `uid=${encodeURIComponent(uid)}&inst=${encodeURIComponent(INSTANCE)}&p=${encodeURIComponent(f.p)}${data ? "" : "&missing=1"}`;
      let res;
      try {
        res = await fetch(`${cfg.base}/api/pc-agent/media/upload?${q}`, {
          method: "POST",
          headers: { Authorization: `Agent ${cfg.key}`, "Content-Type": "application/octet-stream" },
          body: data ?? Buffer.from("-"),
          signal: AbortSignal.timeout(300_000),
        });
      } catch (e) {
        log(`Gửi ảnh Zalo PC lên app bị gián đoạn (${e.message}), lượt sau gửi tiếp.`);
        return;
      }
      if (res.status >= 500) {
        log(`App đang bận (HTTP ${res.status}), lượt sau gửi tiếp.`);
        return;
      }
      if (res.ok && data) {
        sent++;
        bytes += data.length;
      } else failed++;
      await sleep(150);
    }
    log(`Đã gửi ${sent} ảnh / video Zalo PC (${(bytes / 1048576).toFixed(1)} MB) lên NAS${failed ? `, ${failed} tệp lỗi / không còn` : ""}.`);
    return; // mỗi vòng một lượt, để vẫn nhận việc đồng bộ tin xen giữa
  }
}

async function runJob(api, cfg, job, zp) {
  const claimed = await api(`/jobs/${job.id}/claim`, { uid: zp.uid });
  const cutoff = Date.now() - claimed.days * 86_400_000;
  log(`Nhận việc #${job.id}: kênh "${claimed.channel}", tin ${claimed.days} ngày gần nhất, ${zp.convs.length} hội thoại trên Zalo PC`);
  let added = 0;
  await api(`/jobs/${job.id}/progress`, { convsDone: 0, convsTotal: zp.convs.length, read: 0, step: "Bắt đầu đọc Zalo PC" }).catch(() => {});
  try {
    const res = await readAllConversations(zp, cutoff, {
      sendBatch: async (messages, conversations) => {
        const r = await api(`/jobs/${job.id}/import`, { account_uid: zp.uid, conversations, messages });
        added += r.added;
      },
      onProgress: async (p) => {
        const r = await api(`/jobs/${job.id}/progress`, { ...p, step: "Đang đọc Zalo PC" });
        if (r.status === "cancelled") {
          log(`Việc #${job.id} bị hủy trên app, dừng.`);
          return false;
        }
      },
    });
    if (!res.stopped) {
      await api(`/jobs/${job.id}/progress`, { convsDone: zp.convs.length, convsTotal: zp.convs.length, read: res.read, step: "Xong" });
      await api(`/jobs/${job.id}/finish`, { ok: true });
    }
    log(`Việc #${job.id} ${res.stopped ? "đã dừng" : "xong"}: đọc ${res.read} tin trong ${res.convWith} hội thoại, nhập mới ${added} tin.`);
  } catch (e) {
    log(`Việc #${job.id} lỗi: ${e.message}`);
    await api(`/jobs/${job.id}/finish`, { ok: false, error: e.message }, 3).catch(() => {});
  }
}

async function agentLoop() {
  const cfg = readConfig();
  if (!cfg?.key || !cfg?.base) {
    console.log("Chưa có mã máy. Lấy mã ở app: Cài đặt › Kết nối kênh › Máy đồng bộ Zalo PC, rồi chạy:\n  node dong-bo-zalo-pc.mjs --ket-noi <mã máy>");
    process.exit(1);
  }
  if (!takeLock()) {
    console.log("Chương trình đồng bộ đã đang chạy trên máy này.");
    process.exit(0);
  }
  const api = makeApi(cfg);
  const checked = new Set(); // việc đã kiểm mà Zalo PC không cùng tài khoản (khỏi mở lại Zalo PC liên tục)
  let lastErr = "";
  let nextScan = Date.now() + 30_000;
  log(`Chương trình đồng bộ Zalo PC v${VERSION} đang chạy, nối tới ${cfg.base}`);
  for (;;) {
    try {
      const hello = await api("/hello", { uid: cfg.uid ?? null, host: os.hostname(), version: VERSION }, 1);
      if (lastErr) log("Đã nối lại được app.");
      lastErr = "";
      await selfUpdate(cfg, hello.latest);
      if (Date.now() >= nextScan) {
        nextScan = Date.now() + 6 * 3_600_000;
        await reportZaloMedia(api).catch((e) => log(`Không gửi được danh sách ảnh Zalo PC: ${e.message}`));
      }
      if (uploadQueue.size) await uploadZaloMedia(cfg, api).catch((e) => log(`Không gửi được ảnh Zalo PC lên NAS: ${e.message}`));
      const jobs = (hello.jobs ?? []).filter((j) => !j.declined && !checked.has(`${j.id}:${cfg.uid ?? ""}`));
      // Ưu tiên việc khớp tài khoản đã biết; tài khoản lạ / chưa biết thì mở Zalo PC kiểm một lần cho mỗi việc
      const job = jobs.find((j) => j.zalo_uid === cfg.uid) ?? jobs[0];
      if (job) {
        let zp = null;
        try {
          zp = await openZaloPc(log);
          if (cfg.uid !== zp.uid) writeConfig({ ...cfg, uid: zp.uid });
          cfg.uid = zp.uid;
          const fresh = (await api("/hello", { uid: zp.uid, host: os.hostname(), version: VERSION })).jobs ?? [];
          for (const j of fresh.filter((x) => x.zalo_uid !== zp.uid && !x.declined)) {
            checked.add(`${j.id}:${zp.uid}`);
            await api(`/jobs/${j.id}/decline`, { uid: zp.uid, reason: "Zalo PC trên máy này đang đăng nhập tài khoản khác" }).catch(() => {});
          }
          const mine = fresh.find((x) => x.zalo_uid === zp.uid);
          if (mine) await runJob(api, cfg, mine, zp);
        } catch (e) {
          log(`Không đọc được Zalo PC: ${e.message}`);
          checked.add(`${job.id}:${cfg.uid ?? ""}`);
          await api(`/jobs/${job.id}/decline`, { uid: cfg.uid ?? "", reason: e.message }).catch(() => {});
        } finally {
          await zp?.close();
        }
      }
    } catch (e) {
      if (e.status === 401) {
        log(`App từ chối mã máy: ${e.message}`);
        await sleep(5 * 60_000);
      } else if (e.message !== lastErr) {
        lastErr = e.message;
        log(`Chưa nối được app (${e.message}), sẽ thử lại.`);
      }
    }
    await sleep(10_000);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--go")) {
    try {
      fs.rmSync(STARTUP, { force: true });
    } catch {}
    stopRunning();
    console.log("Đã gỡ máy đồng bộ: tắt chương trình đang chạy và bỏ tự chạy khi mở máy.");
    console.log('Nhớ xóa máy này trên app (Cài đặt › Kết nối kênh › Máy đồng bộ Zalo PC).');
    return;
  }
  // Bộ cài (CAI DAT.cmd): đọc mã máy trong cau-hinh.json đi kèm
  const installFile = opt("--cai-dat");
  let fromFile = null;
  if (installFile) {
    try {
      fromFile = JSON.parse(fs.readFileSync(installFile, "utf8"));
    } catch (e) {
      console.log(`Không đọc được ${installFile}: ${e.message}. Giải nén đủ các file trong bộ cài rồi bấm lại.`);
      process.exit(1);
    }
  }
  const key = fromFile?.key ?? opt("--ket-noi");
  if (key) {
    const base = (fromFile?.base ?? opt("--base") ?? readConfig()?.base ?? "https://cskhzalo.sieutoc.com").replace(/\/+$/, "");
    const cfg = { base, key: String(key).trim() };
    const hello = await makeApi(cfg)("/hello", { host: os.hostname(), version: VERSION }, 1).catch((e) => {
      console.log(`Không kết nối được app bằng mã này: ${e.message}`);
      process.exit(1);
    });
    writeConfig(cfg);
    log(`Đã kết nối app ${base} với tên máy "${hello.agent}"`);
    if (!args.includes("--khong-tu-chay")) {
      stopRunning(); // cài lại: tắt bản cũ đang chạy (mã cũ)
      installAutostart();
      // Chạy ẩn ngay bây giờ (giống lúc mở máy), cửa sổ này đóng được
      spawn("wscript.exe", [STARTUP], { detached: true, stdio: "ignore" }).unref();
      console.log("");
      console.log(`ĐÃ CÀI XONG máy đồng bộ "${hello.agent}".`);
      console.log("Chương trình đã chạy nền và sẽ tự chạy mỗi khi mở máy. Có thể đóng cửa sổ này.");
      console.log("Tiếp theo: đăng nhập Zalo PC đúng tài khoản Zalo của kênh, rồi trên app bấm \"Đồng bộ tin nhắn cũ\" ở kênh đó.");
      console.log(`Nhật ký: ${LOG}`);
      return;
    }
  }
  await agentLoop();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    log(`Lỗi: ${e.message}`);
    process.exit(1);
  });
}
