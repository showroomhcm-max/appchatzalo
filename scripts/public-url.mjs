// In ra link public hiện tại của Cloudflare Quick Tunnel (lấy từ log).
import fs from "node:fs";
import path from "node:path";

const log = path.join(import.meta.dirname, "..", "logs", "tunnel.log");
const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
const urls = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
if (!urls) {
  console.log("Chưa có link. Kiểm tra tunnel: npm run prod:status");
  process.exit(1);
}
console.log(urls[urls.length - 1]);
