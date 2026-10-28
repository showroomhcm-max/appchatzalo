// Bộ dự phòng Chat Siêu Tốc: chạy app trên một máy Windows bất kỳ khi NAS chết hẳn.
// Không cần cài gì: bộ có sẵn Node.js, app, đường hầm Cloudflare (tên miền cskhzalo.sieutoc.com trỏ về máy này).
//   CHAY DU PHONG.cmd           → chạy (nạp bản sao lưu lần đầu, lần sau chạy tiếp dữ liệu đang có)
//   GOI DU LIEU VE NAS.cmd      → gói dữ liệu mới nhất để chép về NAS khi NAS sửa xong
//   chay.mjs --thu              → chạy thử: không mở đường hầm, không kiểm NAS, cổng 4919 (an toàn khi NAS đang chạy)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const HERE = import.meta.dirname; // ...\he-thong
const KIT = path.dirname(HERE);
const DOMAIN = "https://cskhzalo.sieutoc.com";
const args = process.argv.slice(2);
const TEST = args.includes("--thu");
const PORT = TEST ? 4919 : 3000;
const DATA = path.join(HERE, TEST ? "data-thu" : "data");
const LOGS = path.join(HERE, "nhat-ky");
const info = JSON.parse(fs.readFileSync(path.join(HERE, "phien-ban.json"), "utf8"));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const vn = (ts) => (ts ? new Date(ts + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 16) : "?");
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = async (msg) => {
  console.log(`\n${msg}`);
  rl.close();
  process.exit(1);
};

/** Kiểm tra file sao lưu đọc được, trả về số tin / kênh. */
function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const m = db.prepare("SELECT COUNT(*) AS n, MAX(ts) AS last FROM messages").get();
    const c = db.prepare("SELECT COUNT(*) AS n FROM channels WHERE deleted_at IS NULL").get();
    return { messages: m.n, last: m.last, channels: c.n };
  } finally {
    db.close();
  }
}

/** Tìm file sao lưu: thư mục du-lieu-sao-luu của bộ, Downloads, Google Drive trên máy (nếu có). */
function findBackups() {
  const dirs = [path.join(KIT, "du-lieu-sao-luu"), path.join(os.homedir(), "Downloads"), path.join(os.homedir(), "Desktop")];
  for (const l of "DEFGHIJKLMNOPQRSTUVWXYZ")
    for (const sub of ["My Drive", "Drive của tôi"])
      dirs.push(path.join(`${l}:\\`, sub, "Backup Chat Siêu Tốc", "VPS Chat Sieu Toc", "sao-luu-drive"));
  const out = [];
  for (const d of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names)
      if (/^app-(moi-nhat|20\d\d-\d\d-\d\d).*\.db$/i.test(n)) {
        const f = path.join(d, n);
        out.push({ file: f, mtime: fs.statSync(f).mtimeMs, size: fs.statSync(f).size });
      }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

async function nasAlive() {
  try {
    const r = await fetch(`${DOMAIN}/api/version`, { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function portBusy(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// ───────────── Gói dữ liệu về NAS ─────────────
if (args.includes("--goi-ve-nas")) {
  const db = path.join(DATA, "app.db");
  if (!fs.existsSync(db)) await die("Máy này chưa chạy dự phòng lần nào: không có dữ liệu để gói.");
  if (await portBusy(3000)) await die("App dự phòng vẫn đang chạy. Đóng cửa sổ \"CHAY DU PHONG\" trước, rồi bấm lại file này.");
  const out = path.join(KIT, "CHEP VE NAS", "data");
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const d = new DatabaseSync(db);
  d.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  d.close();
  fs.copyFileSync(db, path.join(out, "app.db"));
  for (const sub of ["uploads"]) if (fs.existsSync(path.join(DATA, sub))) fs.cpSync(path.join(DATA, sub), path.join(out, sub), { recursive: true });
  const s = inspect(path.join(out, "app.db"));
  console.log(`\nĐã gói xong vào thư mục: ${path.dirname(out)}`);
  console.log(`  ${s.messages.toLocaleString("vi-VN")} tin nhắn, tin mới nhất lúc ${vn(s.last)}, ${s.channels} kênh`);
  console.log("\nTiếp theo (xem HUONG DAN.txt, mục 3): dừng dự án chat-sieutoc trên NAS, chép app.db + uploads");
  console.log("trong thư mục trên đè vào thư mục data trên NAS, xóa app.db-wal và app.db-shm trên NAS, chạy tác vụ");
  console.log("\"Doi chu thu muc chat\", rồi bật lại dự án.");
  rl.close();
  process.exit(0);
}

// ───────────── Chạy dự phòng ─────────────
console.log("============================================================");
console.log(`  BỘ DỰ PHÒNG CHAT SIÊU TỐC  ·  app v${info.version}  ·  tạo ngày ${info.created}`);
console.log(TEST ? "  CHẠY THỬ: không mở tên miền, cổng 4919" : "  Chạy app thay NAS trên máy này");
console.log("============================================================\n");

if (!TEST) {
  process.stdout.write("Kiểm tra NAS… ");
  if (await nasAlive()) {
    console.log("TÊN MIỀN VẪN ĐANG TRẢ LỜI.");
    console.log("App trên NAS (hoặc máy khác) còn chạy. Hai nơi cùng chạy thì Zalo đá nhau, khách nhắn có thể bị chia đôi.");
    console.log("Tắt NAS (hoặc Container Manager › chat-sieutoc › Dừng, hoặc rút dây mạng NAS) rồi chạy lại.");
    const a = await ask('Chắc chắn NAS đã tắt hẳn mà vẫn báo thế này thì gõ CHAY rồi Enter (Enter để thoát): ');
    if (a.trim().toUpperCase() !== "CHAY") await die("Đã thoát, chưa chạy gì.");
  } else console.log("không vào được (đúng: NAS đã tắt).");
}

if (await portBusy(PORT)) await die(`Cổng ${PORT} đang có app khác chạy (có thể là cửa sổ dự phòng đang mở). Đóng nó rồi chạy lại.`);

// 1. Dữ liệu
fs.mkdirSync(DATA, { recursive: true });
const dbFile = path.join(DATA, "app.db");
let load = !fs.existsSync(dbFile);
if (!load) {
  const s = inspect(dbFile);
  console.log(`\nMáy này đã có dữ liệu đang chạy dở: ${s.messages.toLocaleString("vi-VN")} tin, mới nhất lúc ${vn(s.last)}.`);
  const a = await ask("Enter = chạy tiếp dữ liệu này (bình thường chọn cái này).  Gõ MOI = nạp bản sao lưu khác: ");
  load = a.trim().toUpperCase() === "MOI";
}
if (load) {
  const list = findBackups();
  if (!list.length)
    await die(
      "Không tìm thấy file sao lưu.\n" +
        "Tải file app-moi-nhat.db trên Google Drive (Backup Chat Siêu Tốc › VPS Chat Sieu Toc › sao-luu-drive)\n" +
        `rồi bỏ vào thư mục:  ${path.join(KIT, "du-lieu-sao-luu")}  (hoặc để trong Downloads), rồi chạy lại.`,
    );
  console.log("\nCác file sao lưu tìm thấy (mới nhất ở trên):");
  list.slice(0, 8).forEach((b, i) => console.log(`  ${i + 1}. ${b.file}  (${mb(b.size)}, sửa lúc ${vn(b.mtime)})`));
  const a = await ask("Enter = dùng file số 1. Hoặc gõ số khác: ");
  const pick = list[Math.max(0, Math.min(list.length - 1, (Number(a.trim()) || 1) - 1))];
  let s;
  try {
    s = inspect(pick.file);
  } catch (e) {
    await die(`File này hỏng hoặc không phải bản sao lưu Chat Siêu Tốc (${e.message}). Chọn file khác.`);
  }
  console.log(`  → ${s.messages.toLocaleString("vi-VN")} tin nhắn, tin mới nhất lúc ${vn(s.last)}, ${s.channels} kênh`);
  if (fs.existsSync(dbFile)) {
    const keep = path.join(DATA, `truoc-khi-nap-${Date.now()}.db`);
    fs.renameSync(dbFile, keep);
    console.log(`  Dữ liệu cũ trên máy cất ở ${keep}`);
  }
  for (const f of ["app.db-wal", "app.db-shm"]) fs.rmSync(path.join(DATA, f), { force: true });
  fs.copyFileSync(pick.file, dbFile);
  console.log("  Đã nạp bản sao lưu.");
}
if (TEST) {
  // Chạy thử song song với NAS: gỡ phiên đăng nhập các kênh, không thì Zalo đá phiên của NAS
  const d = new DatabaseSync(dbFile);
  d.exec("UPDATE channels SET credentials = NULL, active = 0; DELETE FROM settings WHERE key = 'zalo.credentials'");
  d.close();
}
const secret = path.join(DATA, ".jwt-secret");
if (!fs.existsSync(secret)) fs.copyFileSync(path.join(HERE, "jwt-secret"), secret);

// 2. Bật app (tự bật lại nếu app thoát / lỗi)
fs.mkdirSync(LOGS, { recursive: true });
const log = fs.createWriteStream(path.join(LOGS, `du-phong-${new Date().toISOString().slice(0, 10)}.log`), { flags: "a" });
const children = new Set();
let stopping = false;
function keep(name, cmd, cmdArgs, opts, show) {
  const start = () => {
    if (stopping) return;
    const p = spawn(cmd, cmdArgs, { ...opts, windowsHide: true });
    children.add(p);
    const out = (b) => {
      log.write(b);
      if (show) process.stdout.write(b);
    };
    p.stdout?.on("data", out);
    p.stderr?.on("data", out);
    p.on("exit", (code) => {
      children.delete(p);
      if (stopping) return;
      console.log(`\n[${name}] dừng (mã ${code}), bật lại sau 5 giây…`);
      setTimeout(start, 5000);
    });
    return p;
  };
  return start();
}
const stopAll = () => {
  stopping = true;
  for (const p of children) p.kill();
};
process.on("SIGINT", () => (stopAll(), process.exit(0)));
process.on("exit", stopAll);

const app = path.join(HERE, "app");
keep(
  "app",
  path.join(HERE, "node.exe"),
  [`--env-file=${path.join(HERE, "app.env")}`, path.join(app, "server", "dist", "index.js")],
  {
    cwd: path.join(app, "server"),
    env: { ...process.env, NODE_ENV: "production", DATA_DIR: DATA, PORT: String(PORT), WEB_DIST: path.join(app, "web", "dist"), ...(TEST && { PUBLIC_URL: `http://localhost:${PORT}` }) },
  },
  true,
);
console.log("\nĐang bật app…");
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  up = await portBusy(PORT);
}
if (!up) console.log("App chưa lên sau 60 giây: xem lỗi phía trên (hoặc thư mục he-thong\\nhat-ky).");

// 3. Đường hầm Cloudflare: tên miền trỏ về máy này
if (!TEST) {
  let ok = false;
  const t = keep(
    "đường hầm",
    path.join(HERE, "cloudflared.exe"),
    ["tunnel", "--no-autoupdate", "run", "--token-file", path.join(HERE, "tunnel-token.txt")],
    { cwd: HERE },
    false,
  );
  t.stderr?.on("data", (b) => {
    if (!ok && /Registered tunnel connection/i.test(String(b))) {
      ok = true;
      console.log(`Đường hầm Cloudflare đã kết nối: ${DOMAIN} đang trỏ về máy này.`);
    }
  });
  // Không cho máy ngủ trong lúc chạy dự phòng
  const awake = spawn(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      'Add-Type -Name P -Namespace W -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'; while ($true) { [W.P]::SetThreadExecutionState(0x80000003) | Out-Null; Start-Sleep 50 }',
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  children.add(awake);
}

rl.close();
console.log("\n============================================================");
console.log(`  ĐANG CHẠY THAY NAS${TEST ? " (THỬ)" : ""}.  Địa chỉ: ${TEST ? `http://localhost:${PORT}` : DOMAIN}`);
console.log("  KHÔNG đóng cửa sổ này, không tắt máy. Đóng cửa sổ = tắt app.");
console.log("  Cắm sạc, giữ mạng ổn định. Nhân viên tải lại trang là dùng tiếp.");
console.log("============================================================\n");
if (!TEST) spawn("cmd", ["/c", "start", "", DOMAIN], { detached: true, stdio: "ignore" }).unref();
