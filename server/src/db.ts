import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const db = new DatabaseSync(config.dbFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

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

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                 -- threadId của Zalo
  type INTEGER NOT NULL DEFAULT 0,     -- 0 = cá nhân, 1 = nhóm
  name TEXT,
  avatar TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','closed')),
  tags TEXT NOT NULL DEFAULT '[]',
  external_ref TEXT,                   -- mã khách hàng bên hệ thống khác (CRM...)
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  last_message_preview TEXT,
  last_direction TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  zalo_msg_id TEXT UNIQUE,
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
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_ts ON messages(conversation_id, ts);
CREATE INDEX IF NOT EXISTS idx_msg_agent_ts ON messages(agent_id, ts);

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

// Nâng cấp schema cho bản cũ: thêm cột đăng nhập Odoo.
const userCols = new Set((db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name));
if (!userCols.has("auth_source")) db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'");
if (!userCols.has("odoo_uid")) db.exec("ALTER TABLE users ADD COLUMN odoo_uid INTEGER");
if (!userCols.has("last_login_at")) db.exec("ALTER TABLE users ADD COLUMN last_login_at INTEGER");

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
