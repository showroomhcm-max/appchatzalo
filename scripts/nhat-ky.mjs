// Đọc nhật ký hệ thống của app đang chạy (NAS) để kiểm tra lỗi.
//   node scripts/nhat-ky.mjs                 500 dòng gần nhất
//   node scripts/nhat-ky.mjs zalo#4 200      lọc theo từ khóa (vd. một kênh), 200 dòng
//   node scripts/nhat-ky.mjs --warn          chỉ cảnh báo + lỗi
// Dùng khóa đăng nhập trong server/data/.jwt-secret (giống trên NAS) để tạo phiên Super Admin 2 phút; không in khóa ra.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "server", "package.json"));
const jwt = require("jsonwebtoken");
const base = (process.env.APP_URL ?? "https://cskhzalo.sieutoc.com").replace(/\/+$/, "");
const args = process.argv.slice(2);
const level = args.includes("--warn") ? "warn" : args.includes("--error") ? "error" : "";
const rest = args.filter((a) => !a.startsWith("--"));
const q = rest.find((a) => !/^\d+$/.test(a)) ?? "";
const limit = Number(rest.find((a) => /^\d+$/.test(a)) ?? 500);

const dataDir = path.join(root, "server", "data");
const db = new DatabaseSync(path.join(dataDir, "app.db"), { readOnly: true });
const admin = db.prepare("SELECT id FROM users WHERE super_admin = 1 AND active = 1 ORDER BY id LIMIT 1").get();
const token = jwt.sign({ sub: admin.id }, fs.readFileSync(path.join(dataDir, ".jwt-secret"), "utf8").trim(), { expiresIn: "2m" });
const headers = { Authorization: `Bearer ${token}` };

const params = new URLSearchParams({ limit: String(limit), ...(q && { q }), ...(level && { level }) });
const [version, status, lines] = await Promise.all([
  fetch(`${base}/api/version`).then((r) => r.json()),
  fetch(`${base}/api/zalo/status`, { headers }).then((r) => r.json()),
  fetch(`${base}/api/logs?${params}`, { headers }).then((r) => r.json()),
]);
const vn = (ts) => new Date(ts + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
console.log(`Phiên bản ${version.version} · chạy từ ${vn(Date.parse(version.startedAt))}`);
for (const s of status) console.log(`  #${s.channelId} ${s.channelName}: ${s.state}${s.error ? ` (${s.error})` : ""}`);
console.log(`--- ${lines.length} dòng${q ? ` có "${q}"` : ""} (cũ → mới) ---`);
for (const l of [...lines].reverse()) console.log(`${vn(l.ts)} ${l.level.toUpperCase().padEnd(5)} ${l.msg}`);
