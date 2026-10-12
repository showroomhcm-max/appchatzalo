import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { fold } from "./text.js";

export const db = new DatabaseSync(config.dbFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
// fold(): so khớp không dấu trong SQL (tìm kiếm tin nhắn, tên khách)
db.function("fold", { deterministic: true }, (v) => (v === null || v === undefined ? null : fold(String(v))));

// Hội thoại thuộc 1 kênh (1 tài khoản Zalo) + 1 bộ phận. id = "<kênh>_<threadId Zalo>".
const CONVERSATIONS_SQL = (table: string) => `
CREATE TABLE IF NOT EXISTS ${table} (
  id TEXT PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,               -- threadId của Zalo (uid khách hoặc id nhóm)
  type INTEGER NOT NULL DEFAULT 0,       -- 0 = cá nhân, 1 = nhóm
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  name TEXT,
  avatar TEXT,
  phone TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','closed')),
  tags TEXT NOT NULL DEFAULT '[]',
  external_ref TEXT,                     -- mã khách hàng bên hệ thống khác (CRM...)
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  last_message_preview TEXT,
  last_direction TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (channel_id, thread_id)
)`;

const MESSAGES_SQL = (table: string) => `
CREATE TABLE IF NOT EXISTS ${table} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  zalo_msg_id TEXT,
  cli_msg_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender_uid TEXT,
  sender_name TEXT,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'phone', -- web | api | phone | history | customer
  msg_type TEXT,
  text TEXT,
  raw TEXT,
  ts INTEGER NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  quote TEXT                              -- tin được trả lời (trích dẫn): {msg, fromD, globalMsgId, ownerId}
)`;

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#0a804a',
  created_at INTEGER NOT NULL
);

-- Kênh chat = 1 tài khoản Zalo đã kết nối
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  zalo_uid TEXT,
  zalo_name TEXT,
  avatar TEXT,
  credentials TEXT,                       -- cookie đăng nhập Zalo (bí mật)
  default_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Bộ phận được xem kênh nào
CREATE TABLE IF NOT EXISTS department_channels (
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, channel_id)
);

-- Nhân viên được vào thẳng kênh nào (thấy toàn bộ hội thoại của kênh, không phụ thuộc bộ phận)
CREATE TABLE IF NOT EXISTS user_channels (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);

-- Nhân viên thuộc bộ phận nào (có thể nhiều)
CREATE TABLE IF NOT EXISTS user_departments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#97c354',
  created_at INTEGER NOT NULL
);
-- Tag dùng cho bộ phận nào (không gắn bộ phận nào = dùng chung)
CREATE TABLE IF NOT EXISTS tag_departments (
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, department_id)
);

${CONVERSATIONS_SQL("conversations")};
${MESSAGES_SQL("messages")};

-- Cảm xúc thả vào tin nhắn (của khách hoặc của shop)
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reactor_uid TEXT NOT NULL,
  reactor_name TEXT,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  icon TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (message_id, reactor_uid)
);

-- Ảnh sticker Zalo (tra một lần rồi lưu lại)
CREATE TABLE IF NOT EXISTS sticker_cache (
  id INTEGER PRIMARY KEY,
  cate_id INTEGER,
  type INTEGER,
  url TEXT,
  text TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcut TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
-- Tin nhắn mẫu dùng cho bộ phận nào (không gắn bộ phận nào = dùng chung)
CREATE TABLE IF NOT EXISTS template_departments (
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, department_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["*"]',
  active INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  created_at INTEGER NOT NULL
);
`);

function columns(table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

// ── Nâng cấp từ bản cũ ──
const userCols = columns("users");
if (!userCols.has("auth_source")) db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'");
if (!userCols.has("odoo_uid")) db.exec("ALTER TABLE users ADD COLUMN odoo_uid INTEGER");
if (!userCols.has("last_login_at")) db.exec("ALTER TABLE users ADD COLUMN last_login_at INTEGER");
// Super Admin: quyền cao nhất (quản lý quản trị viên, nhật ký hệ thống, tích hợp)
if (!userCols.has("super_admin")) db.exec("ALTER TABLE users ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0");
// Kênh nhân viên đang tick chọn để chat (JSON mảng id kênh; NULL = mọi kênh được quyền)
if (!userCols.has("working_channels")) db.exec("ALTER TABLE users ADD COLUMN working_channels TEXT");

/**
 * Bản cũ chỉ có 1 tài khoản Zalo: hội thoại có id = threadId, cookie lưu trong settings.
 * Chuyển sang nhiều kênh: tạo kênh số 1 từ cookie cũ, đổi id hội thoại thành "1_<threadId>".
 * Làm theo quy trình đổi bảng chuẩn của SQLite (tạo bảng mới → chép → xóa bảng cũ → đổi tên).
 */
function migrateToChannels() {
  if (columns("conversations").has("channel_id")) return;
  console.log("[db] Nâng cấp dữ liệu sang nhiều kênh Zalo…");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    const credRow = db.prepare("SELECT value FROM settings WHERE key = 'zalo.credentials'").get() as
      | { value: string }
      | undefined;
    const convCount = (db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n;
    if (credRow || convCount > 0) {
      db.prepare("INSERT INTO channels(id, name, credentials, created_at) VALUES(1, 'Zalo chính', ?, ?)").run(
        credRow?.value ?? null,
        Date.now(),
      );
    }
    db.exec("DELETE FROM settings WHERE key = 'zalo.credentials'");

    const oldConv = columns("conversations");
    db.exec(CONVERSATIONS_SQL("conversations_new"));
    db.exec(`INSERT INTO conversations_new(id, channel_id, thread_id, type, name, avatar, phone, assigned_to, status, tags,
               external_ref, unread_count, last_message_at, last_message_preview, last_direction, created_at)
             SELECT '1_' || id, 1, id, type, name, avatar, ${oldConv.has("phone") ? "phone" : "NULL"}, assigned_to, status, tags,
               external_ref, unread_count, last_message_at, last_message_preview, last_direction, created_at
             FROM conversations`);
    db.exec(MESSAGES_SQL("messages_new"));
    db.exec(`INSERT INTO messages_new(id, conversation_id, zalo_msg_id, cli_msg_id, direction, sender_uid, sender_name,
               agent_id, source, msg_type, text, raw, ts, undone)
             SELECT id, '1_' || conversation_id, zalo_msg_id, cli_msg_id, direction, sender_uid,
               sender_name, agent_id, source, msg_type, text, raw, ts, undone FROM messages`);
    db.exec("DROP TABLE messages");
    db.exec("DROP TABLE conversations");
    db.exec("ALTER TABLE conversations_new RENAME TO conversations");
    db.exec("ALTER TABLE messages_new RENAME TO messages");
    for (const t of ["notes", "reviews", "events"]) {
      db.exec(`UPDATE ${t} SET conversation_id = '1_' || conversation_id
               WHERE conversation_id IS NOT NULL AND conversation_id NOT LIKE '1\\_%' ESCAPE '\\'`);
    }
    const broken = db.prepare("PRAGMA foreign_key_check").all();
    if (broken.length) throw new Error(`Lỗi khóa ngoại sau khi nâng cấp: ${JSON.stringify(broken.slice(0, 5))}`);
    db.exec("COMMIT");
    console.log("[db] Nâng cấp xong.");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
migrateToChannels();
db.exec("PRAGMA foreign_keys = ON");
if (!columns("messages").has("quote")) db.exec("ALTER TABLE messages ADD COLUMN quote TEXT");
// Đa kênh: nền tảng của kênh (zalo / facebook / tiktok / tiktok_shop) và id tài khoản bên nền tảng (page id, open_id, shop id)
const chanCols = columns("channels");
if (!chanCols.has("platform")) db.exec("ALTER TABLE channels ADD COLUMN platform TEXT NOT NULL DEFAULT 'zalo'");
if (!chanCols.has("external_id")) db.exec("ALTER TABLE channels ADD COLUMN external_id TEXT");
// Hội thoại: "chat" (tin nhắn) hoặc "comment" (bình luận dưới bài viết); meta = thông tin bài viết / bình luận
const convCols2 = columns("conversations");
if (!convCols2.has("kind")) db.exec("ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");
if (!convCols2.has("meta")) db.exec("ALTER TABLE conversations ADD COLUMN meta TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_channels_external ON channels(platform, external_id)");

db.exec(`
CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_dept ON conversations(department_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_zalo ON messages(conversation_id, zalo_msg_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_ts ON messages(conversation_id, ts);
CREATE INDEX IF NOT EXISTS idx_msg_agent_ts ON messages(agent_id, ts);
`);

export type Row = Record<string, any>;

export function all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSetting<T>(key: string): T | undefined {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? (JSON.parse(row.value) as T) : undefined;
}
export function setSetting(key: string, value: unknown) {
  if (value === undefined || value === null) {
    run("DELETE FROM settings WHERE key = ?", key);
    return;
  }
  run(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}

export function logEvent(conversationId: string | null, userId: number | null, type: string, data?: unknown) {
  run(
    "INSERT INTO events(conversation_id, user_id, type, data, ts) VALUES(?, ?, ?, ?, ?)",
    conversationId,
    userId,
    type,
    data === undefined ? null : JSON.stringify(data),
    Date.now(),
  );
}

/** Cấp Super Admin cho các tài khoản trong SUPER_ADMINS (tài khoản chưa đăng nhập lần nào sẽ được cấp lúc đăng nhập). */
export function applySuperAdmins() {
  for (const login of config.superAdmins) {
    const r = run(
      "UPDATE users SET super_admin = 1, role = 'admin', active = 1 WHERE lower(username) = ? AND super_admin = 0",
      login,
    );
    if (r.changes) console.log(`[setup] Đã cấp Super Admin cho ${login}`);
  }
}

/** Tạo tài khoản admin đầu tiên nếu chưa có người dùng nào. */
export function ensureAdmin() {
  const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n;
  if (count > 0) return;
  let password = config.adminPassword;
  if (!password) {
    password = crypto.randomBytes(9).toString("base64url");
    const file = path.join(config.dataDir, "admin-initial-password.txt");
    fs.writeFileSync(file, `username: ${config.adminUsername}\npassword: ${password}\n`, { mode: 0o600 });
    console.log(`[setup] Đã tạo tài khoản admin. Mật khẩu ban đầu lưu tại ${file}`);
  }
  run(
    "INSERT INTO users(username, password_hash, display_name, role, created_at) VALUES(?, ?, ?, 'admin', ?)",
    config.adminUsername,
    bcrypt.hashSync(password, 10),
    "Quản trị viên",
    Date.now(),
  );
}

// ───────────── Zalo & SĐT công ty cấp cho nhân viên (company-accounts.ts) ─────────────
db.exec(`
CREATE TABLE IF NOT EXISTS channel_assets (
  channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  phone TEXT,
  sim_serial TEXT,
  carrier TEXT,
  device TEXT,
  holder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  holder_since INTEGER,
  /** 1 = quyền vào kênh của người giữ do bàn giao tạo ra (thu hồi thì gỡ) */
  holder_access INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'stored',
  note TEXT,
  updated_at INTEGER,
  updated_by INTEGER
);
CREATE TABLE IF NOT EXISTS channel_holder_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_at INTEGER NOT NULL,
  to_at INTEGER,
  handed_by INTEGER,
  returned_by INTEGER,
  hand_note TEXT,
  return_note TEXT,
  checklist TEXT
);
CREATE INDEX IF NOT EXISTS idx_holder_hist ON channel_holder_history(channel_id, from_at);
`);
if (!(db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).some((c) => c.name === "holder_id")) {
  // Người đang giữ máy lúc tin được gửi từ điện thoại
  db.exec("ALTER TABLE messages ADD COLUMN holder_id INTEGER");
}


// ───────────── Giám sát Zalo nhân viên (monitor.ts) ─────────────
// channels.mode: 'shared' = kênh CSKH chung; 'monitor' = Zalo nhân viên tự chat trên điện thoại, quản lý giám sát
if (!(db.prepare("PRAGMA table_info(channels)").all() as { name: string }[]).some((c) => c.name === "mode")) {
  db.exec("ALTER TABLE channels ADD COLUMN mode TEXT NOT NULL DEFAULT 'shared'");
}
if (!(db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).some((c) => c.name === "undone_at")) {
  db.exec("ALTER TABLE messages ADD COLUMN undone_at INTEGER");
}
db.exec(`
CREATE TABLE IF NOT EXISTS monitor_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  channel_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_by INTEGER,
  reviewed_at INTEGER,
  UNIQUE(message_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_flags_open ON monitor_flags(channel_id, reviewed_at);
`);

// ───────────── Ghim / xóa hội thoại (menu thao tác hội thoại) ─────────────
db.exec(`
CREATE TABLE IF NOT EXISTS conversation_pins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);
`);
if (!(db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).some((c) => c.name === "deleted_at")) {
  // Xóa = ẩn khỏi hộp thư (giữ dữ liệu cho training / kiểm tra); có tin mới thì hiện lại
  db.exec("ALTER TABLE conversations ADD COLUMN deleted_at INTEGER");
}
