/**
 * Sao lưu tự động vào data/backups/auto:
 *  - app-moi-nhat.db: ghi đè mỗi giờ (NAS hỏng thì mất tối đa ~1 giờ dữ liệu trong app)
 *  - app-YYYY-MM-DD.db: mỗi đêm 2 giờ sáng giờ Việt Nam (và lúc khởi động nếu hôm nay chưa có), giữ 14 bản.
 * Thư mục này để NAS chép ra ngoài (Cloud Sync lên Google Drive): NAS hỏng thì tải file về là chạy lại được.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { db } from "./db.js";

const DIR = path.join(config.dataDir, "backups", "auto");
const KEEP = 14;
const LATEST = "app-moi-nhat.db";

const vnDate = (ts = Date.now()) => new Date(ts + 7 * 3600_000).toISOString().slice(0, 10);

export function backupNow(name = `app-${vnDate()}.db`) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  const tmp = `${file}.tmp`;
  const started = Date.now();
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  fs.renameSync(tmp, file); // ghi xong mới đổi tên: file .db trong thư mục luôn là bản đầy đủ
  const old = fs
    .readdirSync(DIR)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) fs.rmSync(path.join(DIR, f), { force: true });
  const mb = (fs.statSync(file).size / 1048576).toFixed(1);
  console.info(`[backup] Đã sao lưu ${path.basename(file)} (${mb} MB, ${Date.now() - started} ms), giữ ${KEEP} bản`);
  return file;
}

export function startBackups() {
  const run = () => {
    try {
      backupNow();
    } catch (e) {
      console.error("[backup] Sao lưu lỗi:", e);
    }
  };
  if (!fs.existsSync(path.join(DIR, `app-${vnDate()}.db`))) setTimeout(run, 60_000);
  // Kiểm tra mỗi 10 phút: sang giờ mới thì ghi bản mới nhất; đúng khung 2 giờ sáng thì thêm bản theo ngày
  let lastHour = -1;
  let lastDay = "";
  setInterval(() => {
    const hour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
    const day = vnDate();
    if (hour !== lastHour) {
      lastHour = hour;
      try {
        backupNow(LATEST);
      } catch (e) {
        console.error("[backup] Sao lưu lỗi:", e);
      }
    }
    if (hour === 2 && lastDay !== day) {
      lastDay = day;
      run();
    }
  }, 10 * 60_000).unref?.();
}
