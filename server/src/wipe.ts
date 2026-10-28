/**
 * Xóa sạch dữ liệu chat (Super Admin), dùng trước khi giao app cho nhân viên.
 *
 * Giữ: tài khoản, bộ phận, nhóm quyền, ảnh đại diện nhân viên, cờ chuyển đổi dữ liệu.
 * Xóa: mọi kênh (đăng xuất), hội thoại, tin, khách, ghi chú, đơn, đánh giá, dữ liệu AI, nhãn, mẫu tin,
 * cài đặt kết nối (Meta, TikTok, Zalo OA, Odoo, AI…), máy đồng bộ Zalo PC, file đính kèm, sao lưu, nhật ký.
 * Xong thì tắt tiến trình để Docker bật lại với bộ nhớ sạch.
 */
import fs from "node:fs";
import path from "node:path";
import { all, db, get, logEvent, run } from "./db.js";
import { config } from "./config.js";
import { clearLogs } from "./logger.js";
import { zalo } from "./zalo.js";

const KEEP_TABLES = new Set(["users", "departments", "user_departments", "permission_groups", "user_permission_groups", "settings"]);
// Cài đặt kết nối / cấu hình tính năng; các khóa khác (cờ chuyển đổi dữ liệu perm.migrated.*) giữ lại
const WIPE_SETTINGS = "key LIKE '%.config' OR key LIKE 'app.%' OR key LIKE 'search.%' OR key LIKE 'zalo.%'";
export const WIPE_CONFIRM = "XOA SACH";

/** Các bảng sẽ bị xóa (bảng phụ của chỉ mục tìm kiếm tự dọn theo messages_fts). */
function wipeTables() {
  return all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts_%' ORDER BY name")
    .map((r) => r.name)
    .filter((n) => !KEEP_TABLES.has(n));
}

const UPLOAD_KEEP = new Set(["avatars"]);
function dirStats(dir: string, skip = new Set<string>()) {
  let files = 0;
  let bytes = 0;
  const walk = (p: string) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else (files++, (bytes += fs.statSync(f).size));
    }
  };
  if (fs.existsSync(dir))
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else (files++, (bytes += fs.statSync(f).size));
    }
  return { files, bytes };
}

const dirs = () => ({
  uploads: { dir: config.uploadDir, skip: UPLOAD_KEEP },
  backups: { dir: path.join(config.dataDir, "backups"), skip: new Set<string>() },
  logs: { dir: path.join(config.dataDir, "logs"), skip: new Set<string>() },
});

/** Xem trước: mỗi bảng còn bao nhiêu dòng, bao nhiêu file sẽ bị xóa. */
export function wipePreview() {
  const tables = Object.fromEntries(wipeTables().map((t) => [t, get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`)!.n]));
  const settings = all<{ key: string }>(`SELECT key FROM settings WHERE ${WIPE_SETTINGS} ORDER BY key`).map((r) => r.key);
  const files = Object.fromEntries(Object.entries(dirs()).map(([k, d]) => [k, dirStats(d.dir, d.skip)]));
  const kept = {
    users: get<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n,
    departments: get<{ n: number }>("SELECT COUNT(*) AS n FROM departments")!.n,
    permission_groups: get<{ n: number }>("SELECT COUNT(*) AS n FROM permission_groups")!.n,
    settings: all<{ key: string }>(`SELECT key FROM settings WHERE NOT (${WIPE_SETTINGS}) ORDER BY key`).map((r) => r.key),
  };
  return { tables, settings, files, kept, confirm: WIPE_CONFIRM };
}

/**
 * Xóa hẳn hội thoại + tin nhắn của một kênh (khi xóa kênh và chọn "xóa luôn tin nhắn").
 * Gồm cả các bảng ghi theo conversation_id không có khóa ngoại (cảnh báo, AI, chấm điểm…) và chỉ mục tìm kiếm.
 */
export function purgeChannelData(channelId: number) {
  const convs = "SELECT id FROM conversations WHERE channel_id = ?";
  const refTables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts%'")
    .map((r) => r.name)
    .filter((t) => t !== "conversations" && all<{ name: string }>(`PRAGMA table_info("${t}")`).some((c) => c.name === "conversation_id"));
  const n = get<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE channel_id = ?", channelId)!.n;
  db.exec("BEGIN");
  try {
    run(`DELETE FROM messages_fts WHERE rowid IN (SELECT m.id FROM messages m WHERE m.conversation_id IN (${convs}))`, channelId);
    for (const t of refTables) run(`DELETE FROM "${t}" WHERE conversation_id IN (${convs})`, channelId);
    run("DELETE FROM conversations WHERE channel_id = ?", channelId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // Dựng lại chỉ mục tìm kiếm: DELETE chỉ đánh dấu xóa, chữ của tin vừa xóa vẫn còn trong chỉ mục
  if (n) db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
  return n;
}

let wiping = false;

export async function wipeChatData(userId: number) {
  if (wiping) throw new Error("Đang xóa dữ liệu, chờ chút");
  wiping = true;
  const before = wipePreview();
  // 1. Đăng xuất mọi kênh đang chạy (xóa phiên Zalo đã lưu, ngắt Meta / TikTok…)
  for (const { id } of all<{ id: number }>("SELECT id FROM channels")) await zalo.remove(id).catch(() => undefined);

  // 2. Xóa dữ liệu trong một giao dịch
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    for (const t of wipeTables()) db.exec(`DELETE FROM "${t}"`);
    run(`DELETE FROM settings WHERE ${WIPE_SETTINGS}`);
    if (get("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'")) {
      const keep = [...KEEP_TABLES].map((t) => `'${t}'`).join(", ");
      db.exec(`DELETE FROM sqlite_sequence WHERE name NOT IN (${keep})`);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    wiping = false;
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  // 3. Dựng lại chỉ mục tìm kiếm (DELETE chỉ đánh dấu xóa, chữ của tin cũ vẫn nằm trong chỉ mục), rồi thu nhỏ file
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  // 4. File: đính kèm (trừ ảnh đại diện nhân viên), sao lưu, nhật ký
  for (const d of Object.values(dirs())) {
    if (!fs.existsSync(d.dir)) continue;
    for (const name of fs.readdirSync(d.dir)) {
      if (d.skip.has(name)) continue;
      try {
        fs.rmSync(path.join(d.dir, name), { recursive: true, force: true });
      } catch {
        /* file đang mở (nhật ký hôm nay): ghi đè rỗng bên dưới */
      }
    }
  }
  clearLogs();

  logEvent(null, userId, "system.chat_data_wiped", {
    tables: Object.values(before.tables).reduce((a, b) => a + b, 0),
    files: Object.values(before.files).reduce((a, b) => a + b.files, 0),
  });
  console.info("[wipe] Đã xóa sạch dữ liệu chat, khởi động lại app");
  // Bộ nhớ đệm (phiên kênh, sticker, tìm kiếm…) còn dữ liệu cũ: tắt để Docker bật lại
  setTimeout(() => process.exit(0), 1500);
  return { ok: true, removed: before };
}
