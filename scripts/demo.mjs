// Bản demo chạy trên máy này để xem / chỉnh giao diện và tính năng (không đụng app thật trên NAS).
//   node scripts/demo.mjs          dùng dữ liệu demo đã có (tạo mới nếu chưa có)
//   node scripts/demo.mjs --reset  chép lại dữ liệu từ server/data
//   node scripts/demo.mjs --mock-ai  dùng máy AI giả (scripts/mock-claude.mjs) để thử tính năng AI, không tốn tiền
// Dữ liệu demo nằm ở demo-data/ (không đưa lên git): bản sao server/data đã xóa phiên Zalo (không đá
// kết nối Zalo của app thật), xóa webhook và kết nối app nội bộ (không bắn dữ liệu demo ra ngoài).
// Giao diện: http://localhost:5173 (tự tải lại khi sửa code), máy chủ: http://localhost:3000.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "server", "data");
const dir = path.join(root, "demo-data");
const dbFile = path.join(dir, "app.db");

if (process.argv.includes("--reset")) fs.rmSync(dir, { recursive: true, force: true });
if (!fs.existsSync(dbFile)) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(src, "app.db"))) {
    new DatabaseSync(path.join(src, "app.db"), { readOnly: true }).exec(`VACUUM INTO '${dbFile.replaceAll("'", "''")}'`);
    const db = new DatabaseSync(dbFile);
    db.exec(`
      UPDATE channels SET credentials = NULL;
      DELETE FROM webhooks;
      DELETE FROM settings WHERE key IN ('dvkt.config', 'report_link.config', 'ai.config');
    `);
    db.close();
    if (fs.existsSync(path.join(src, "uploads"))) fs.cpSync(path.join(src, "uploads"), path.join(dir, "uploads"), { recursive: true });
    console.log("Đã tạo dữ liệu demo từ server/data (đã xóa phiên Zalo, webhook, kết nối app nội bộ).");
  } else {
    console.log("Chưa có server/data: app demo bắt đầu với dữ liệu trống.");
  }
}

// Máy AI giả: khóa giả chỉ để app coi như đã cấu hình AI; mọi lượt gọi đi tới 127.0.0.1:3994
const mockAi = process.argv.includes("--mock-ai");
if (mockAi) {
  await import("./mock-claude.mjs");
  const db = new DatabaseSync(dbFile);
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai.config'").get();
  const cur = row ? JSON.parse(row.value) : {};
  if (!cur.apiKey) db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('ai.config', ?)").run(JSON.stringify({ ...cur, apiKey: "sk-ant-demo-khong-phai-khoa-that-0000" }));
  db.close();
}

const child = spawn("npm run dev", {
  cwd: root,
  stdio: "inherit",
  shell: true,
  // PORT cố định 3000 cho máy chủ (trình xem trước có thể gán PORT=5173, trùng cổng giao diện)
  // WEB_DIST trỏ chỗ trống: giao diện do Vite phục vụ, khỏi so với bản build cũ rồi hiện thanh "có phiên bản mới"
  env: { ...process.env, DATA_DIR: dir, PORT: "3000", PUBLIC_URL: "http://localhost:5173", WEB_DIST: path.join(dir, "no-web"), ...(mockAi ? { AI_BASE_URL: "http://127.0.0.1:3994", XAI_BASE_URL: "http://127.0.0.1:3994" } : {}) },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
