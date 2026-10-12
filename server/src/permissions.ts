/**
 * Phân quyền chi tiết: mỗi nhân viên có quyền = quyền của các NHÓM QUYỀN họ thuộc về + quyền RIÊNG cấp thêm cho họ.
 * Super Admin luôn có mọi quyền.
 */
import type { NextFunction, Request, Response } from "express";
import { all, get, run, db } from "./db.js";

export const PERMISSIONS = [
  { key: "conversations.all", group: "Hội thoại", label: "Xem tất cả hội thoại (mọi kênh, mọi bộ phận)" },
  { key: "conversations.assign", group: "Hội thoại", label: "Giao, chuyển, giành hội thoại của người khác" },
  { key: "messages.undo_any", group: "Hội thoại", label: "Thu hồi tin nhắn do người khác gửi" },
  { key: "reviews.manage", group: "Dữ liệu", label: "Chấm điểm chất lượng tư vấn" },
  { key: "data.view", group: "Dữ liệu", label: "Xem trang Dữ liệu (thống kê nhân viên)" },
  { key: "data.export", group: "Dữ liệu", label: "Xuất dữ liệu hội thoại (TXT, CSV, JSONL, JSON)" },
  { key: "channels.manage", group: "Cài đặt", label: "Kết nối, cài đặt kênh chat và phân công nhân viên vào kênh" },
  { key: "users.manage", group: "Cài đặt", label: "Thêm, sửa, khóa nhân viên" },
  { key: "departments.manage", group: "Cài đặt", label: "Quản lý bộ phận" },
  { key: "tags.manage", group: "Cài đặt", label: "Quản lý tag" },
  { key: "templates.manage", group: "Cài đặt", label: "Quản lý tin nhắn mẫu" },
  { key: "integrations.manage", group: "Hệ thống", label: "Tích hợp: API key, webhook" },
  { key: "logs.view", group: "Hệ thống", label: "Xem và tải nhật ký hệ thống" },
  { key: "permissions.manage", group: "Hệ thống", label: "Quản lý nhóm quyền, cấp quyền cho người khác" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
const ALL_KEYS = PERMISSIONS.map((p) => p.key) as string[];

db.exec(`
CREATE TABLE IF NOT EXISTS permission_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_permission_groups (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
`);
if (!(db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).some((c) => c.name === "permissions")) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'");
}

/** Lần đầu: tạo 3 nhóm quyền mẫu và chuyển quản trị viên cũ vào nhóm "Quản trị". */
(function seedGroups() {
  if (get<{ n: number }>("SELECT COUNT(*) AS n FROM permission_groups")!.n > 0) return;
  const now = Date.now();
  const mk = (name: string, description: string, perms: string[]) =>
    Number(
      run("INSERT INTO permission_groups(name, description, permissions, created_at) VALUES(?, ?, ?, ?)", name, description, JSON.stringify(perms), now)
        .lastInsertRowid,
    );
  const admin = mk(
    "Quản trị",
    "Quản lý vận hành: thấy mọi hội thoại, dữ liệu, cài đặt kênh, nhân viên, bộ phận, tag, tin nhắn mẫu",
    ALL_KEYS.filter((k) => !["integrations.manage", "logs.view", "permissions.manage"].includes(k)),
  );
  mk("Trưởng nhóm", "Giám sát nhân viên: xem mọi hội thoại, giao việc, chấm điểm, xem thống kê", [
    "conversations.all",
    "conversations.assign",
    "messages.undo_any",
    "reviews.manage",
    "data.view",
  ]);
  mk("Nhân viên CSKH", "Chat ở các kênh, bộ phận được phân công", []);
  for (const u of all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND super_admin = 0")) {
    run("INSERT OR IGNORE INTO user_permission_groups(user_id, group_id) VALUES(?, ?)", u.id, admin);
  }
})();

function parse(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((k) => ALL_KEYS.includes(k)) : [];
  } catch {
    return [];
  }
}

/** Quyền thực tế của một người. */
export function permissionsOf(userId: number): string[] {
  const u = get<{ super_admin: number; permissions: string }>("SELECT super_admin, permissions FROM users WHERE id = ?", userId);
  if (!u) return [];
  if (u.super_admin) return [...ALL_KEYS];
  const set = new Set(parse(u.permissions));
  for (const g of all<{ permissions: string }>(
    "SELECT g.permissions FROM permission_groups g JOIN user_permission_groups ug ON ug.group_id = g.id WHERE ug.user_id = ?",
    userId,
  )) {
    for (const k of parse(g.permissions)) set.add(k);
  }
  return [...set];
}

export function cleanPermissions(list: unknown): string[] {
  return Array.isArray(list) ? [...new Set(list.map(String).filter((k) => ALL_KEYS.includes(k)))] : [];
}

/** Giữ cột role cũ cho đồng bộ: có bất kỳ quyền quản lý nào thì là "admin". */
export function syncLegacyRole(userId: number) {
  const perms = permissionsOf(userId);
  const managerial = perms.some((p) => p !== "conversations.all" && p !== "messages.undo_any");
  run("UPDATE users SET role = ? WHERE id = ?", managerial ? "admin" : "agent", userId);
}

export function can(user: { permissions?: string[]; super_admin?: number } | undefined, perm: Permission) {
  return !!user && (!!user.super_admin || !!user.permissions?.includes(perm));
}

export function requirePerm(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!can(req.user, perm)) {
      const label = PERMISSIONS.find((p) => p.key === perm)?.label ?? perm;
      return res.status(403).json({ error: `Bạn chưa được cấp quyền: ${label}` });
    }
    next();
  };
}
