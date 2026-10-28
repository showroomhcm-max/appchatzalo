// Tạo "Bộ dự phòng Chat Siêu Tốc" (.zip): chạy app trên một máy Windows bất kỳ khi NAS chết hẳn.
//   node scripts/tao-bo-du-phong.mjs
// Bộ gồm Node.js, app đã build (cùng phiên bản đang chạy), Cloudflare Tunnel + token, cấu hình .env, khóa đăng nhập.
// Chép vào Google Drive (Backup Chat Siêu Tốc) nếu máy có Google Drive, không thì để ở thư mục bo-du-phong/.
// File chứa token Cloudflare và cấu hình: chỉ cất ở Drive riêng / USB, không gửi cho ai.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const NAME = "Chat Sieu Toc - Bo du phong";
const stage = path.join(os.tmpdir(), `bo-du-phong-${Date.now()}`);
const kit = path.join(stage, NAME);
const sys = path.join(kit, "he-thong");
const CRLF = String.fromCharCode(13, 10);

for (const f of ["tools/cloudflared.exe", "tools/cloudflare-tunnel-token.txt", ".env", "server/data/.jwt-secret"])
  if (!fs.existsSync(path.join(root, f))) throw new Error(`Thiếu ${f}: bộ dự phòng cần file này`);

console.log(`Tạo bộ dự phòng cho app v${version}…`);
run("npm run build");

// 1. App: server (bản build + thư viện chạy, không kèm công cụ lập trình) và giao diện web
const app = path.join(sys, "app");
fs.mkdirSync(path.join(app, "server"), { recursive: true });
fs.cpSync(path.join(root, "server", "dist"), path.join(app, "server", "dist"), { recursive: true });
for (const f of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(root, "server", f), path.join(app, "server", f));
run("npm ci --omit=dev --no-audit --no-fund --loglevel=error", path.join(app, "server"));
fs.cpSync(path.join(root, "web", "dist"), path.join(app, "web", "dist"), { recursive: true });

// 2. Chạy: Node.js của máy này, Cloudflare Tunnel, cấu hình, khóa đăng nhập (người dùng không phải đăng nhập lại)
fs.copyFileSync(process.execPath, path.join(sys, "node.exe"));
fs.copyFileSync(path.join(root, "tools", "cloudflared.exe"), path.join(sys, "cloudflared.exe"));
const clean = (s) => s.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
fs.writeFileSync(path.join(sys, "tunnel-token.txt"), clean(fs.readFileSync(path.join(root, "tools", "cloudflare-tunnel-token.txt"), "utf8")).trim());
fs.writeFileSync(path.join(sys, "app.env"), clean(fs.readFileSync(path.join(root, ".env"), "utf8")));
fs.copyFileSync(path.join(root, "server", "data", ".jwt-secret"), path.join(sys, "jwt-secret"));
fs.copyFileSync(path.join(root, "deploy", "bo-du-phong", "chay.mjs"), path.join(sys, "chay.mjs"));
const created = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
fs.writeFileSync(path.join(sys, "phien-ban.json"), JSON.stringify({ version, created }));

// 3. File bấm đúp + hướng dẫn
const cmd = (title, extra) =>
  ["@echo off", "chcp 65001 >nul", `title ${title}`, `"%~dp0he-thong\\node.exe" "%~dp0he-thong\\chay.mjs" ${extra}`.trim(), "echo.", "pause"].join(CRLF);
fs.writeFileSync(path.join(kit, "CHAY DU PHONG.cmd"), cmd("Chat Sieu Toc - DU PHONG (dong cua so = tat app)", ""));
fs.writeFileSync(path.join(kit, "GOI DU LIEU VE NAS.cmd"), cmd("Goi du lieu ve NAS", "--goi-ve-nas"));
fs.writeFileSync(path.join(kit, "CHAY THU.cmd"), cmd("Chat Sieu Toc - chay thu (khong anh huong NAS)", "--thu"));
fs.mkdirSync(path.join(kit, "du-lieu-sao-luu"));
fs.writeFileSync(
  path.join(kit, "du-lieu-sao-luu", "BO FILE SAO LUU VAO DAY.txt"),
  ["Tai file app-moi-nhat.db tren Google Drive:", "  Backup Chat Siêu Tốc > VPS Chat Sieu Toc > sao-luu-drive > app-moi-nhat.db", "roi bo vao thu muc nay (hoac de trong Downloads cung duoc)."].join(CRLF),
);
const guide = fs.readFileSync(path.join(root, "deploy", "bo-du-phong", "HUONG-DAN.txt"), "utf8").replace("{{VERSION}}", version).replace("{{CREATED}}", created);
fs.writeFileSync(path.join(kit, "HUONG DAN.txt"), clean(guide).replace(/\n/g, CRLF));

// 4. Nén (.zip bằng tar của Windows)
const outDir = path.join(root, "bo-du-phong");
fs.mkdirSync(outDir, { recursive: true });
const zipName = `${NAME} v${version}.zip`;
const zip = path.join(outDir, zipName);
fs.rmSync(zip, { force: true });
execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-cf", zip, "-C", stage, NAME], { stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
for (const f of fs.readdirSync(outDir)) if (f !== zipName && f.endsWith(".zip")) fs.rmSync(path.join(outDir, f));
console.log(`\nĐã tạo ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} MB)`);

// 5. Chép lên Google Drive (Google Drive cho máy tính) nếu có
for (const l of "GHIJKLMNOPQRSTUVWXYZDEF") {
  const drive = path.join(`${l}:\\`, "My Drive", "Backup Chat Siêu Tốc");
  if (!fs.existsSync(drive)) continue;
  const dst = path.join(drive, "Bo du phong");
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(dst)) if (f.endsWith(".zip")) fs.rmSync(path.join(dst, f));
  fs.copyFileSync(zip, path.join(dst, zipName));
  console.log(`Đã chép lên Google Drive: ${path.join(dst, zipName)}`);
  break;
}
