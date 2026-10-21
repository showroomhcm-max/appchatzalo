// NAS hỏng: chạy tạm app trên laptop này từ một bản sao lưu (xem deploy/nas/SU-CO.md).
//   node scripts/chay-tam-laptop.mjs "C:\Users\...\Downloads\app-2026-10-21.db"
// Lệnh sẽ: kiểm tra NAS đã tắt hẳn → cất dữ liệu cũ trên laptop → chép bản sao lưu vào server/data/app.db
// → build → bật app + Cloudflare Tunnel (tên miền cskhzalo.sieutoc.com trỏ về laptop).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const src = process.argv[2];
const force = process.argv.includes("--force");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

if (!src || !fs.existsSync(src)) {
  console.error('Cách dùng: node scripts/chay-tam-laptop.mjs "<đường dẫn file app-YYYY-MM-DD.db>"');
  process.exit(1);
}
const check = new DatabaseSync(src, { readOnly: true });
const msgs = check.prepare("SELECT COUNT(*) AS n, MAX(ts) AS last FROM messages").get();
check.close();
console.log(`Bản sao lưu: ${msgs.n} tin nhắn, tin mới nhất lúc ${new Date(msgs.last + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 16)}`);

// Hai nơi cùng chạy thì Zalo đá nhau và tên miền chia đôi lượt truy cập: NAS phải tắt hẳn.
let nasAlive = false;
try {
  const r = await fetch("https://cskhzalo.sieutoc.com/api/version", { signal: AbortSignal.timeout(8000) });
  nasAlive = r.ok;
} catch {
  /* không vào được: tốt */
}
if (nasAlive && !force) {
  console.error(
    "\nTên miền vẫn đang trả lời: app trên NAS (hoặc nơi khác) còn chạy.\n" +
      "Tắt dự án chat-sieutoc trên NAS (Container Manager › Dừng) hoặc rút mạng NAS rồi chạy lại lệnh này.\n" +
      "Chắc chắn NAS đã tắt mà vẫn báo thế này thì thêm --force.",
  );
  process.exit(1);
}

const dataDir = path.join(root, "server", "data");
fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
try {
  execSync("npx pm2 stop zalo-cskh zalo-cskh-tunnel", { cwd: root, stdio: "ignore" });
} catch {
  /* chưa chạy */
}
const dbFile = path.join(dataDir, "app.db");
if (fs.existsSync(dbFile)) {
  const keep = path.join(dataDir, "backups", `laptop-truoc-khoi-phuc-${Date.now()}.db`);
  fs.copyFileSync(dbFile, keep);
  console.log(`Đã cất dữ liệu cũ của laptop vào ${keep}`);
}
for (const f of ["app.db-wal", "app.db-shm"]) fs.rmSync(path.join(dataDir, f), { force: true });
fs.copyFileSync(src, dbFile);
console.log("Đã chép bản sao lưu vào server/data/app.db");

run("npm run build");
try {
  execSync("npx pm2 describe zalo-cskh", { cwd: root, stdio: "ignore" });
  run("npx pm2 restart zalo-cskh zalo-cskh-tunnel");
} catch {
  run("npx pm2 start ecosystem.config.cjs");
}
console.log(
  "\nApp đang chạy trên laptop tại https://cskhzalo.sieutoc.com (đợi khoảng 30 giây).\n" +
    "Tiếp theo: Cài đặt › Kết nối kênh › mỗi kênh Zalo bấm 'Đồng bộ tin nhắn cũ' để Zalo gửi bù tin từ lúc sao lưu đến giờ.\n" +
    "NAS chạy lại được: làm theo mục 'Quay về NAS' trong deploy/nas/SU-CO.md.",
);
