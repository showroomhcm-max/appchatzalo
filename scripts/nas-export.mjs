// Đóng gói app + dữ liệu để chuyển sang Synology NAS (xem deploy/nas/HUONG-DAN.md).
//   node scripts/nas-export.mjs                 dừng app trên máy này rồi đóng gói (lúc chuyển thật)
//   node scripts/nas-export.mjs --keep-running  đóng gói mà không dừng app (chỉ để thử; KHÔNG chạy
//                                               bản này khi app trên máy này còn chạy: Zalo chỉ cho một
//                                               nơi nhận tin, bản sau sẽ đá bản trước)
//   --out <thư mục>                             nơi xuất (mặc định: nas-export/chat-sieutoc)
// Kết quả chứa dữ liệu khách, phiên đăng nhập Zalo và token Cloudflare: chỉ chép qua mạng nội bộ
// lên NAS, chép xong thì xoá thư mục nas-export trên máy này.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const keepRunning = args.includes("--keep-running");
const outIdx = args.indexOf("--out");
const out = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(root, "nas-export", "chat-sieutoc"));
const dataSrc = path.join(root, "server", "data");
const git = (cmd) => execSync(`git ${cmd}`, { cwd: root }).toString();

if (!args.includes("--allow-dirty") && git("status --porcelain").trim()) {
  console.error("Còn thay đổi chưa commit. Phát hành (npm run release) trước rồi mới đóng gói.");
  process.exit(1);
}
if (fs.existsSync(out) && fs.readdirSync(out).length) {
  console.error(`Thư mục ${out} đã có dữ liệu. Xoá nó trước khi đóng gói lại.`);
  process.exit(1);
}

if (!keepRunning) {
  console.log("Dừng app và tunnel trên máy này…");
  execSync("npx pm2 stop zalo-cskh zalo-cskh-tunnel", { cwd: root, stdio: "inherit" });
}

// 1. Dữ liệu: bản chụp CSDL gọn một file + khoá đăng nhập + ảnh/file
const dataDir = path.join(out, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataSrc, "app.db"));
db.exec(`VACUUM INTO '${path.join(dataDir, "app.db").replaceAll("'", "''")}'`);
db.close();
fs.copyFileSync(path.join(dataSrc, ".jwt-secret"), path.join(dataDir, ".jwt-secret"));
if (fs.existsSync(path.join(dataSrc, "uploads"))) fs.cpSync(path.join(dataSrc, "uploads"), path.join(dataDir, "uploads"), { recursive: true });

// 2. Cấu hình: .env → app.env, token tunnel → tunnel.env (bỏ BOM, xuống dòng kiểu Linux)
const clean = (s) => s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const envFile = path.join(root, ".env");
fs.writeFileSync(path.join(out, "app.env"), fs.existsSync(envFile) ? clean(fs.readFileSync(envFile, "utf8")) : "");
const tokenFile = path.join(root, "tools", "cloudflare-tunnel-token.txt");
if (fs.existsSync(tokenFile)) {
  fs.writeFileSync(path.join(out, "tunnel.env"), `TUNNEL_TOKEN=${clean(fs.readFileSync(tokenFile, "utf8")).trim()}\n`);
} else {
  console.warn("Chưa có tools/cloudflare-tunnel-token.txt: tạo tunnel.env trên NAS với dòng TUNNEL_TOKEN=<token>.");
}
// 3. File chạy trên NAS (app lấy bản build sẵn từ GitHub, cap-nhat.sh tự cập nhật)
for (const f of ["docker-compose.yml", "cap-nhat.sh", "ghcr.env.example", "HUONG-DAN.md"]) {
  fs.copyFileSync(path.join(root, "deploy", "nas", f), path.join(out, f));
}

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
console.log(`\nĐã đóng gói v${version} vào ${out}`);
console.log("Tiếp theo: chép cả thư mục chat-sieutoc lên NAS (docker/chat-sieutoc) rồi làm theo deploy/nas/HUONG-DAN.md.");
if (!keepRunning) console.log("Muốn quay lại chạy trên máy này: npx pm2 start zalo-cskh zalo-cskh-tunnel");
