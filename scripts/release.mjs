// Phát hành phiên bản mới: node scripts/release.mjs 2.1.0
// 1. Đổi số phiên bản trong package.json (gốc, server, web)
// 2. Kiểm tra CHANGELOG.md đã có mục "## v<số mới>"
// 3. Commit, gắn tag v<số mới>, đẩy lên GitHub
// Sau đó chạy "npm run prod:restart" trên máy chủ để cập nhật app.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Cách dùng: node scripts/release.mjs <phiên bản>   ví dụ: node scripts/release.mjs 2.1.0");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
const out = (cmd) => execSync(cmd, { cwd: root }).toString().trim();

if (out("git tag -l v" + version)) {
  console.error(`Đã có phiên bản v${version}. Chọn số khác.`);
  process.exit(1);
}
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## v${version}`)) {
  console.error(`CHANGELOG.md chưa có mục "## v${version}". Ghi lại thay đổi của phiên bản này trước.`);
  process.exit(1);
}

for (const file of ["package.json", "server/package.json", "web/package.json"]) {
  const p = path.join(root, file);
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.version = version;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
}

run("git add -A");
run(`git commit -m "Phát hành v${version}"`);
run(`git tag -a v${version} -m "Phiên bản ${version}"`);
run("git push origin HEAD --follow-tags");
console.log(`\nĐã phát hành v${version}. GitHub đang build; NAS tự cập nhật trong khoảng 5–10 phút (kiểm tra: https://cskhzalo.sieutoc.com/api/version).`);
