/**
 * Cài đặt: kênh Zalo, bộ phận, tag, tin nhắn mẫu (+ xuất/nhập Excel).
 * Mọi thay đổi chỉ quản trị viên làm được; nhân viên chỉ đọc phần thuộc bộ phận của mình.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { all, get, run, tx, logEvent } from "./db.js";
import { requireSuperAdmin } from "./auth.js";
import { can, requirePerm } from "./permissions.js";
import { HttpError } from "./conversations.js";
import { canUseChannel, departmentItemFilter, scopeOf } from "./access.js";
import { zalo } from "./zalo.js";
import { bus } from "./bus.js";
import { fetchTemplateFile, fetchTemplateImage } from "./template-media.js";
import { publicBaseUrl } from "./platforms/common.js";

export const settingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const h =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const HEX = /^#[0-9a-f]{6}$/i;
const ids = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback);

function setLinks(table: string, ownerCol: string, ownerId: number, otherCol: string, otherIds: number[]) {
  run(`DELETE FROM ${table} WHERE ${ownerCol} = ?`, ownerId);
  for (const id of otherIds) run(`INSERT OR IGNORE INTO ${table}(${ownerCol}, ${otherCol}) VALUES(?, ?)`, ownerId, id);
}
function linkMap(table: string, keyCol: string, valCol: string) {
  const map = new Map<number, number[]>();
  for (const r of all<Record<string, number>>(`SELECT ${keyCol} AS k, ${valCol} AS v FROM ${table}`)) {
    map.set(r.k, [...(map.get(r.k) ?? []), r.v]);
  }
  return map;
}

// ───────────── Kênh Zalo ─────────────

function channelPayload(isAdmin: boolean) {
  const deptLinks = linkMap("department_channels", "channel_id", "department_id");
  const userLinks = linkMap("user_channels", "channel_id", "user_id");
  const convCounts = new Map(
    all<{ channel_id: number; n: number }>("SELECT channel_id, COUNT(*) AS n FROM conversations GROUP BY channel_id").map((r) => [
      r.channel_id,
      r.n,
    ]),
  );
  return all<any>("SELECT ch.id, ch.name, ch.platform, ch.mode, ch.zalo_uid, ch.zalo_name, ch.avatar, ch.default_department_id, ch.active, ch.created_at, a.holder_id FROM channels ch LEFT JOIN channel_assets a ON a.channel_id = ch.id WHERE ch.deleted_at IS NULL ORDER BY ch.id").map(
    (c) => ({
      ...c,
      department_ids: deptLinks.get(c.id) ?? [],
      user_ids: isAdmin ? userLinks.get(c.id) ?? [] : undefined,
      conversations: isAdmin ? convCounts.get(c.id) ?? 0 : undefined,
      status: c.active ? zalo.session(c.id).getStatus() : null,
      capabilities: zalo.session(c.id).capabilities,
    }),
  );
}

settingsRouter.get("/channels", (req, res) => {
  const scope = scopeOf(req.user!);
  const manager = can(req.user, "channels.manage");
  res.json(channelPayload(manager).filter((c) => manager || ((scope.all || canUseChannel(scope, c.id)) && c.active)));
});

settingsRouter.post(
  "/channels",
  requirePerm("channels.manage"),
  h((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new HttpError(400, "Đặt tên cho kênh, ví dụ: Zalo Bán hàng");
    const r = run(
      "INSERT INTO channels(name, default_department_id, created_at) VALUES(?, ?, ?)",
      name,
      req.body?.default_department_id ? Number(req.body.default_department_id) : null,
      Date.now(),
    );
    const id = Number(r.lastInsertRowid);
    setLinks("department_channels", "channel_id", id, "department_id", ids(req.body?.department_ids));
    setLinks("user_channels", "channel_id", id, "user_id", ids(req.body?.user_ids));
    logEvent(null, req.user!.id, "channel.created", { id, name });
    bus.emit("settings.changed", "channels");
    res.json(channelPayload(true).find((c) => c.id === id));
  }),
);

settingsRouter.patch(
  "/channels/:id",
  requirePerm("channels.manage"),
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!get("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NULL", id)) throw new HttpError(404, "Không tìm thấy kênh");
    const b = req.body ?? {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new HttpError(400, "Tên kênh không được trống");
      run("UPDATE channels SET name = ? WHERE id = ?", name, id);
    }
    if (b.default_department_id !== undefined) {
      run("UPDATE channels SET default_department_id = ? WHERE id = ?", b.default_department_id ? Number(b.default_department_id) : null, id);
    }
    if (b.department_ids !== undefined) setLinks("department_channels", "channel_id", id, "department_id", ids(b.department_ids));
    if (b.user_ids !== undefined) setLinks("user_channels", "channel_id", id, "user_id", ids(b.user_ids));
    const wasActive = !!get<{ active: number }>("SELECT active FROM channels WHERE id = ?", id)?.active;
    if (b.active !== undefined && !!b.active !== wasActive) {
      run("UPDATE channels SET active = ? WHERE id = ?", b.active ? 1 : 0, id);
      if (!b.active) await zalo.session(id).logout(false);
      else void zalo.session(id).init();
    }
    zalo.session(id).refreshName();
    bus.emit("settings.changed", "channels");
    res.json(channelPayload(true).find((c) => c.id === id));
  }),
);

settingsRouter.delete(
  "/channels/:id",
  requireSuperAdmin,
  h(async (req, res) => {
    const id = Number(req.params.id);
    const ch = get<{ name: string }>("SELECT name FROM channels WHERE id = ? AND deleted_at IS NULL", id);
    if (!ch) throw new HttpError(404, "Không tìm thấy kênh");
    const n = get<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE channel_id = ?", id)!.n;
    await zalo.remove(id);
    if (n > 0) {
      // Còn hội thoại (dữ liệu training): đăng xuất, xóa cookie Zalo, ẩn kênh; hội thoại và tin nhắn giữ nguyên.
      run(
        "UPDATE channels SET active = 0, deleted_at = ?, credentials = NULL, name = ? WHERE id = ?",
        Date.now(),
        ch.name.endsWith(" (đã xóa)") ? ch.name : `${ch.name} (đã xóa)`,
        id,
      );
    } else {
      run("DELETE FROM channels WHERE id = ?", id);
    }
    logEvent(null, req.user!.id, "channel.deleted", { id, name: ch.name, kept_conversations: n });
    bus.emit("settings.changed", "channels");
    res.json({ ok: true, kept_conversations: n });
  }),
);

const channelAction = (fn: (id: number) => unknown) =>
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!get("SELECT 1 FROM channels WHERE id = ? AND active = 1", id)) throw new HttpError(404, "Kênh không tồn tại hoặc đang tắt");
    await fn(id);
    res.json(zalo.session(id).getStatus());
  });
settingsRouter.post("/channels/:id/login-qr", requirePerm("channels.manage"), channelAction((id) => void zalo.zaloSession(id).startQRLogin()));
settingsRouter.post("/channels/:id/cancel", requirePerm("channels.manage"), channelAction((id) => zalo.zaloSession(id).cancelQR()));
settingsRouter.post(
  "/channels/:id/reconnect",
  requirePerm("channels.manage"),
  channelAction(async (id) => {
    await zalo.session(id).logout(false);
    await zalo.session(id).init();
  }),
);
settingsRouter.post("/channels/:id/logout", requirePerm("channels.manage"), channelAction((id) => zalo.session(id).logout(true)));

// Trạng thái các kênh người này dùng được (banner "Zalo chưa kết nối")
settingsRouter.get("/zalo/status", (req, res) => {
  const scope = scopeOf(req.user!);
  res.json(zalo.statuses().filter((s) => canUseChannel(scope, s.channelId)));
});

// ───────────── Bộ phận ─────────────

function departmentPayload() {
  const channelLinks = linkMap("department_channels", "department_id", "channel_id");
  const memberLinks = linkMap("user_departments", "department_id", "user_id");
  return all<any>("SELECT id, name, color, created_at FROM departments ORDER BY name").map((d) => ({
    ...d,
    channel_ids: channelLinks.get(d.id) ?? [],
    user_ids: memberLinks.get(d.id) ?? [],
  }));
}

settingsRouter.get("/departments", (_req, res) => res.json(departmentPayload()));

function saveDepartment(id: number | null, b: any) {
  return tx(() => {
    let deptId = id;
    if (deptId === null) {
      const name = String(b?.name ?? "").trim();
      if (!name) throw new HttpError(400, "Đặt tên bộ phận, ví dụ: Bán hàng");
      if (get("SELECT 1 FROM departments WHERE lower(name) = lower(?)", name)) throw new HttpError(400, "Bộ phận đã tồn tại");
      deptId = Number(run("INSERT INTO departments(name, color, created_at) VALUES(?, ?, ?)", name, color(b?.color, "#0a804a"), Date.now()).lastInsertRowid);
    } else {
      if (!get("SELECT 1 FROM departments WHERE id = ?", deptId)) throw new HttpError(404, "Không tìm thấy bộ phận");
      if (b?.name !== undefined) {
        const name = String(b.name).trim();
        if (!name) throw new HttpError(400, "Tên bộ phận không được trống");
        if (get("SELECT 1 FROM departments WHERE lower(name) = lower(?) AND id != ?", name, deptId)) throw new HttpError(400, "Trùng tên bộ phận khác");
        run("UPDATE departments SET name = ? WHERE id = ?", name, deptId);
      }
      if (b?.color !== undefined) run("UPDATE departments SET color = ? WHERE id = ?", color(b.color, "#0a804a"), deptId);
    }
    if (b?.channel_ids !== undefined) setLinks("department_channels", "department_id", deptId, "channel_id", ids(b.channel_ids));
    if (b?.user_ids !== undefined) setLinks("user_departments", "department_id", deptId, "user_id", ids(b.user_ids));
    bus.emit("settings.changed", "departments");
    return departmentPayload().find((d) => d.id === deptId);
  });
}

settingsRouter.post("/departments", requirePerm("departments.manage"), h((req, res) => res.json(saveDepartment(null, req.body))));
settingsRouter.patch("/departments/:id", requirePerm("departments.manage"), h((req, res) => res.json(saveDepartment(Number(req.params.id), req.body))));
settingsRouter.delete(
  "/departments/:id",
  requirePerm("departments.manage"),
  h((req, res) => {
    const id = Number(req.params.id);
    const n = get<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE department_id = ?", id)!.n;
    // Hội thoại của bộ phận bị xóa trở về "chưa thuộc bộ phận" (khóa ngoại ON DELETE SET NULL).
    run("DELETE FROM departments WHERE id = ?", id);
    bus.emit("settings.changed", "departments");
    res.json({ ok: true, released_conversations: n });
  }),
);

// ───────────── Tag ─────────────

function tagPayload(req: Request) {
  const scope = scopeOf(req.user!);
  const links = linkMap("tag_departments", "tag_id", "department_id");
  return all<any>(`SELECT t.id, t.name, t.color FROM tags t WHERE ${departmentItemFilter(scope, "tag_departments", "tag_id", "t")} ORDER BY t.name`).map(
    (t) => ({ ...t, department_ids: links.get(t.id) ?? [] }),
  );
}

/** Đổi tên / xóa tag thì cập nhật luôn các hội thoại đang gắn tag đó. */
function renameTagInConversations(oldName: string, newName: string | null) {
  const rows = all<{ id: string; tags: string }>(
    "SELECT id, tags FROM conversations WHERE EXISTS (SELECT 1 FROM json_each(conversations.tags) WHERE value = ?)",
    oldName,
  );
  for (const r of rows) {
    const list = (JSON.parse(r.tags) as string[]).map((t) => (t === oldName ? newName : t)).filter((t): t is string => !!t);
    run("UPDATE conversations SET tags = ? WHERE id = ?", JSON.stringify([...new Set(list)]), r.id);
  }
  return rows.length;
}

function saveTag(id: number | null, b: any) {
  return tx(() => {
    const name = b?.name !== undefined ? String(b.name).trim() : undefined;
    if (id === null) {
      if (!name) throw new HttpError(400, "Nhập tên tag");
      if (get("SELECT 1 FROM tags WHERE lower(name) = lower(?)", name)) throw new HttpError(400, `Tag "${name}" đã có`);
      id = Number(run("INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)", name, color(b?.color, "#97c354"), Date.now()).lastInsertRowid);
    } else {
      const cur = get<{ name: string }>("SELECT name FROM tags WHERE id = ?", id);
      if (!cur) throw new HttpError(404, "Không tìm thấy tag");
      if (name !== undefined && name !== cur.name) {
        if (!name) throw new HttpError(400, "Tên tag không được trống");
        if (get("SELECT 1 FROM tags WHERE lower(name) = lower(?) AND id != ?", name, id)) throw new HttpError(400, `Tag "${name}" đã có`);
        run("UPDATE tags SET name = ? WHERE id = ?", name, id);
        renameTagInConversations(cur.name, name);
      }
      if (b?.color !== undefined) run("UPDATE tags SET color = ? WHERE id = ?", color(b.color, "#97c354"), id);
    }
    if (b?.department_ids !== undefined) setLinks("tag_departments", "tag_id", id, "department_id", ids(b.department_ids));
    return id;
  });
}

settingsRouter.get("/tags", (req, res) => res.json(tagPayload(req)));
settingsRouter.post(
  "/tags",
  requirePerm("tags.manage"),
  h((req, res) => {
    const id = saveTag(null, req.body);
    res.json(tagPayload(req).find((t) => t.id === id));
  }),
);
settingsRouter.patch(
  "/tags/:id",
  requirePerm("tags.manage"),
  h((req, res) => {
    const id = saveTag(Number(req.params.id), req.body);
    bus.emit("settings.changed", "tags");
    res.json(tagPayload(req).find((t) => t.id === id));
  }),
);
settingsRouter.delete(
  "/tags/:id",
  requirePerm("tags.manage"),
  h((req, res) => {
    const t = get<{ name: string }>("SELECT name FROM tags WHERE id = ?", Number(req.params.id));
    if (t) {
      tx(() => {
        renameTagInConversations(t.name, null);
        run("DELETE FROM tags WHERE id = ?", Number(req.params.id));
      });
      bus.emit("settings.changed", "tags");
    }
    res.json({ ok: true });
  }),
);

// ───────────── Tin nhắn mẫu ─────────────

const TEMPLATE_COLS =
  "t.id, t.shortcut, t.content, t.created_by, t.image_url, t.image_file, t.file_url, t.file_file, t.file_name, t.ask_address, t.updated_at, t.updated_label, u.display_name AS updated_by_name";

function templatePayload(req: Request) {
  const scope = scopeOf(req.user!);
  const links = linkMap("template_departments", "template_id", "department_id");
  return all<any>(
    `SELECT ${TEMPLATE_COLS} FROM templates t LEFT JOIN users u ON u.id = t.updated_by
     WHERE ${departmentItemFilter(scope, "template_departments", "template_id", "t")} ORDER BY t.shortcut`,
  ).map((t) => ({ ...t, ask_address: !!t.ask_address, department_ids: links.get(t.id) ?? [] }));
}

const cleanShortcut = (v: unknown) => String(v ?? "").trim().replace(/^\//, "").replace(/\s+/g, "-").slice(0, 40);
const cleanUrl = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\/\S+$/i.test(s) || s.length > 1000) throw new HttpError(400, "Link ảnh / tệp phải bắt đầu bằng http:// hoặc https://");
  return s;
};

/** Tải ảnh / tệp đính kèm của mẫu khi link đổi; lỗi tải không chặn lưu (báo lại cho người dùng). */
async function mediaFor(cur: { image_url?: string | null; image_file?: string | null; file_url?: string | null; file_file?: string | null; file_name?: string | null } | undefined, imageUrl: string | undefined, fileUrl: string | undefined) {
  const out: { image_url?: string | null; image_file?: string | null; file_url?: string | null; file_file?: string | null; file_name?: string | null } = {};
  const warnings: string[] = [];
  if (imageUrl !== undefined && imageUrl !== (cur?.image_url ?? "")) {
    out.image_url = imageUrl || null;
    out.image_file = null;
    if (imageUrl) {
      try {
        out.image_file = (await fetchTemplateImage(imageUrl)).file;
      } catch (e: any) {
        warnings.push(`Ảnh: ${e.message}`);
      }
    }
  }
  if (fileUrl !== undefined && fileUrl !== (cur?.file_url ?? "")) {
    out.file_url = fileUrl || null;
    out.file_file = null;
    out.file_name = null;
    if (fileUrl) {
      try {
        const f = await fetchTemplateFile(fileUrl);
        out.file_file = f.file;
        out.file_name = f.name;
      } catch (e: any) {
        warnings.push(`Tệp: ${e.message}`);
      }
    }
  }
  return { out, warnings };
}

async function saveTemplate(id: number | null, b: any, userId: number) {
  const shortcut = b?.shortcut !== undefined ? cleanShortcut(b.shortcut) : undefined;
  const content = b?.content !== undefined ? String(b.content).trim() : undefined;
  const imageUrl = b?.image_url !== undefined ? cleanUrl(b.image_url) : undefined;
  const fileUrl = b?.file_url !== undefined ? cleanUrl(b.file_url) : undefined;
  const cur = id ? get<any>("SELECT * FROM templates WHERE id = ?", id) : undefined;
  if (id !== null && !cur) throw new HttpError(404, "Không tìm thấy tin nhắn mẫu");
  if (id === null && (!shortcut || !content)) throw new HttpError(400, "Thiếu phím tắt hoặc nội dung");
  if (shortcut !== undefined && !shortcut) throw new HttpError(400, "Phím tắt không được trống");
  if (content !== undefined && !content) throw new HttpError(400, "Nội dung không được trống");
  if (shortcut && get("SELECT 1 FROM templates WHERE lower(shortcut) = lower(?) AND id != ?", shortcut, id ?? 0)) throw new HttpError(400, `Phím tắt /${shortcut} đã có`);
  const { out, warnings } = await mediaFor(cur, imageUrl, fileUrl);
  const savedId = tx(() => {
    let tid = id;
    if (tid === null) tid = Number(run("INSERT INTO templates(shortcut, content, created_by, created_at) VALUES(?, ?, ?, ?)", shortcut!, content!, userId, Date.now()).lastInsertRowid);
    const sets: Record<string, any> = { ...out, updated_by: userId, updated_at: Date.now(), updated_label: null };
    if (shortcut !== undefined) sets.shortcut = shortcut;
    if (content !== undefined) sets.content = content;
    if (b?.ask_address !== undefined) sets.ask_address = b.ask_address ? 1 : 0;
    const keys = Object.keys(sets);
    run(`UPDATE templates SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => sets[k]), tid);
    if (b?.department_ids !== undefined) setLinks("template_departments", "template_id", tid, "department_id", ids(b.department_ids));
    return tid;
  });
  bus.emit("settings.changed", "templates");
  return { id: savedId, warnings };
}

settingsRouter.get("/templates", (req, res) => res.json(templatePayload(req)));
settingsRouter.post(
  "/templates",
  requirePerm("templates.manage"),
  h(async (req, res) => {
    const r = await saveTemplate(null, req.body, req.user!.id);
    res.json({ ...templatePayload(req).find((t) => t.id === r.id), warnings: r.warnings });
  }),
);
settingsRouter.patch(
  "/templates/:id",
  requirePerm("templates.manage"),
  h(async (req, res) => {
    const r = await saveTemplate(Number(req.params.id), req.body, req.user!.id);
    res.json({ ...templatePayload(req).find((t) => t.id === r.id), warnings: r.warnings });
  }),
);
settingsRouter.delete("/templates/:id", requirePerm("templates.manage"), (req, res) => {
  run("DELETE FROM templates WHERE id = ?", Number(req.params.id));
  bus.emit("settings.changed", "templates");
  res.json({ ok: true });
});

// ───────────── Xuất / nhập Excel (theo form "Danh sách CTLM") ─────────────

const deptNames = () => new Map(all<{ id: number; name: string }>("SELECT id, name FROM departments").map((d) => [d.id, d.name]));

function parseDeptCell(value: string, byName: Map<string, number>) {
  const names = value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = names.filter((n) => !byName.has(n.toLowerCase()));
  return { ids: names.map((n) => byName.get(n.toLowerCase())).filter((x): x is number => !!x), unknown };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("hyperlink" in v && "text" in v) return String((v as any).hyperlink || (v as any).text);
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result ?? "");
  }
  return String(v);
}

/** "Lead Bảo hành Nguyễn Xuân Thịnh\n03/06/2026" ← người cập nhật + ngày */
const dmy = (ms: number) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join("/");
function updatedCell(r: { updated_by_name?: string | null; updated_at?: number | null; updated_label?: string | null }) {
  if (r.updated_label) return r.updated_label;
  if (r.updated_by_name && r.updated_at) return `${r.updated_by_name}\n${dmy(r.updated_at)}`;
  return r.updated_at ? dmy(r.updated_at) : "";
}
function parseUpdated(v: string) {
  const m = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const at = m ? Date.parse(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+07:00`) : NaN;
  return { label: v.trim() || null, at: Number.isFinite(at) ? at : null };
}
const yes = (v: string) => /^(có|co|x|v|✓|✔|true|1|yes|y)$/i.test(v.trim());

type Col = { header: string; key: string; width: number };
async function sendWorkbook(res: Response, filename: string, sheet: string, headers: Col[], rows: Record<string, string>[], note: string, wrapKeys: string[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = headers;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A804A" } };
  ws.getRow(1).alignment = { vertical: "middle" };
  rows.forEach((r) => ws.addRow(r));
  for (const k of wrapKeys) ws.getColumn(k).alignment = { wrapText: true, vertical: "top" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  const help = wb.addWorksheet("Hướng dẫn");
  help.getColumn(1).width = 110;
  note.split("\n").forEach((line) => help.addRow([line]));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await wb.xlsx.write(res);
  res.end();
}

const foldHeader = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Đọc sheet đầu, nhận cột theo tên tiêu đề (đổi thứ tự / thêm cột vẫn đọc đúng). */
async function readTable(file: Express.Multer.File | undefined, aliases: Record<string, string[]>, positional: string[]) {
  if (!file) throw new HttpError(400, "Chọn file Excel (.xlsx)");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as any);
  } catch {
    throw new HttpError(400, "File không phải Excel .xlsx hợp lệ");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, "File Excel trống");
  const head = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => foldHeader(cellText(v)));
  const index: Record<string, number> = {};
  for (const [key, names] of Object.entries(aliases)) {
    const i = head.findIndex((h) => h && names.includes(h));
    if (i > 0) index[key] = i;
  }
  // Không nhận ra tiêu đề → đọc theo thứ tự cột như file mẫu cũ
  if (!Object.keys(index).length) positional.forEach((k, i) => (index[k] = i + 1));
  const rows: { row: number; get: (k: string) => string }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (k: string) => (index[k] ? cellText(row.getCell(index[k]).value).replace(/\r\n/g, "\n").trim() : "");
    if (Object.keys(index).some((k) => get(k))) rows.push({ row: n, get });
  });
  return { rows, recognized: Object.keys(index) };
}

const DEPT_NOTE = "Cột Bộ phận: ghi tên bộ phận đúng như trong app, nhiều bộ phận cách nhau dấu phẩy. Để trống = dùng chung cho mọi bộ phận.";

settingsRouter.get(
  "/tags/export.xlsx",
  requirePerm("tags.manage"),
  h(async (_req, res) => {
    const names = deptNames();
    const links = linkMap("tag_departments", "tag_id", "department_id");
    const rows = all<any>("SELECT t.id, t.name, t.color, t.updated_at, t.updated_label, u.display_name AS updated_by_name FROM tags t LEFT JOIN users u ON u.id = t.updated_by ORDER BY t.name").map(
      (t) => ({
        name: t.name,
        color: t.color,
        departments: (links.get(t.id) ?? []).map((d) => names.get(d)).filter(Boolean).join(", "),
        updated: updatedCell(t),
      }),
    );
    await sendWorkbook(
      res,
      "Danh sach Tag Chat Sieu Toc.xlsx",
      "Tag",
      [
        { header: "Tên tag", key: "name", width: 30 },
        { header: "Màu", key: "color", width: 14 },
        { header: "Bộ phận", key: "departments", width: 40 },
        { header: "Cập nhật", key: "updated", width: 30 },
      ],
      rows,
      `Nhập tag: mỗi dòng 1 tag. Tag trùng tên sẽ được cập nhật màu và bộ phận.\nCột Màu: mã màu dạng #0a804a (để trống = màu mặc định).\n${DEPT_NOTE}\nCột Cập nhật: người cập nhật và ngày (dd/mm/yyyy), có thể để trống.`,
      ["updated"],
    );
  }),
);

settingsRouter.post(
  "/tags/import",
  requirePerm("tags.manage"),
  upload.single("file"),
  h(async (req, res) => {
    const { rows } = await readTable(
      req.file,
      { name: ["ten tag", "tag", "ten"], color: ["mau", "mau sac", "color"], departments: ["bo phan"], updated: ["cap nhat"] },
      ["name", "color", "departments"],
    );
    const byName = new Map(all<{ id: number; name: string }>("SELECT id, name FROM departments").map((d) => [d.name.toLowerCase(), d.id]));
    const result = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };
    tx(() => {
      for (const r of rows) {
        const name = r.get("name");
        if (!name) {
          result.skipped.push({ row: r.row, reason: "Thiếu tên tag" });
          continue;
        }
        const d = parseDeptCell(r.get("departments"), byName);
        if (d.unknown.length) {
          result.skipped.push({ row: r.row, reason: `Không có bộ phận: ${d.unknown.join(", ")}` });
          continue;
        }
        const up = r.get("updated") ? parseUpdated(r.get("updated")) : { label: null, at: Date.now() };
        const col = r.get("color");
        const existing = get<{ id: number }>("SELECT id FROM tags WHERE lower(name) = lower(?)", name);
        let id = existing?.id;
        if (id) {
          if (col) run("UPDATE tags SET color = ? WHERE id = ?", color(col, "#97c354"), id);
          result.updated++;
        } else {
          id = Number(run("INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)", name, color(col, "#97c354"), Date.now()).lastInsertRowid);
          result.created++;
        }
        run("UPDATE tags SET updated_by = ?, updated_at = ?, updated_label = ? WHERE id = ?", up.label ? null : req.user!.id, up.at ?? Date.now(), up.label, id);
        if (r.get("departments") || !existing) setLinks("tag_departments", "tag_id", id, "department_id", d.ids);
      }
    });
    logEvent(null, req.user!.id, "tags.imported", { created: result.created, updated: result.updated });
    bus.emit("settings.changed", "tags");
    res.json(result);
  }),
);

/** Đường dẫn công khai của ảnh / tệp mẫu (để ô Excel bấm mở được). */
const publicLink = (local: string | null, original: string | null) => original || (local ? `${publicBaseUrl()}${local}` : "");

settingsRouter.get(
  "/templates/export.xlsx",
  requirePerm("templates.manage"),
  h(async (_req, res) => {
    const names = deptNames();
    const links = linkMap("template_departments", "template_id", "department_id");
    const rows = all<any>(`SELECT ${TEMPLATE_COLS} FROM templates t LEFT JOIN users u ON u.id = t.updated_by ORDER BY t.shortcut`).map((t) => ({
      shortcut: t.shortcut,
      content: t.content,
      image: publicLink(t.image_file, t.image_url),
      file: publicLink(t.file_file, t.file_url),
      ask: t.ask_address ? "Có" : "",
      updated: updatedCell(t),
      departments: (links.get(t.id) ?? []).map((d: number) => names.get(d)).filter(Boolean).join(", "),
    }));
    await sendWorkbook(
      res,
      "Danh sach CTLM Chat Sieu Toc.xlsx",
      "CTLM Chat Siêu Tốc",
      [
        { header: "Từ viết tắt", key: "shortcut", width: 19.5 },
        { header: "Nội dung", key: "content", width: 62.5 },
        { header: "Ảnh đính kèm", key: "image", width: 60 },
        { header: "Tệp đính kèm", key: "file", width: 60 },
        { header: "Xin địa chỉ", key: "ask", width: 14 },
        { header: "Cập nhật", key: "updated", width: 30 },
        { header: "Bộ phận", key: "departments", width: 24 },
      ],
      rows,
      [
        "Nhập câu trả lời mẫu (CTLM): mỗi dòng 1 mẫu, dùng được file xuất từ trang Pancake / Sapo (cùng các cột: Từ viết tắt, Nội dung, Ảnh đính kèm, Tệp đính kèm, Xin địa chỉ, Cập nhật).",
        "Từ viết tắt: viết liền không dấu cách (vd: ck, diachi). Trong ô chat gõ /từ-viết-tắt để chèn. Từ viết tắt trùng trong app sẽ được cập nhật.",
        "Trong cùng 1 file: dòng trùng từ viết tắt và trùng nội dung được gộp (giữ ảnh / tệp); trùng từ viết tắt nhưng khác nội dung được đặt tên mới (vd: ck-2).",
        "Ảnh đính kèm / Tệp đính kèm: link http(s); app tải về để gửi kèm khi chọn mẫu. Ảnh JPG/PNG/WEBP/GIF, tệp PDF/Word/Excel/PowerPoint/ZIP…, tối đa 10 MB.",
        "Xin địa chỉ: ghi Có (hoặc x) nếu mẫu dùng để xin địa chỉ / thông tin giao hàng.",
        "Cập nhật: người cập nhật và ngày (dd/mm/yyyy), giữ nguyên khi nhập lại.",
        DEPT_NOTE,
      ].join("\n"),
      ["content", "updated"],
    );
  }),
);

settingsRouter.post(
  "/templates/import",
  requirePerm("templates.manage"),
  upload.single("file"),
  h(async (req, res) => {
    const { rows } = await readTable(
      req.file,
      {
        shortcut: ["tu viet tat", "phim tat", "viet tat", "shortcut"],
        content: ["noi dung", "content", "cau tra loi"],
        image: ["anh dinh kem", "anh", "hinh anh"],
        file: ["tep dinh kem", "tep", "file dinh kem"],
        ask: ["xin dia chi"],
        updated: ["cap nhat"],
        departments: ["bo phan"],
      },
      ["shortcut", "content", "departments"],
    );
    const byName = new Map(all<{ id: number; name: string }>("SELECT id, name FROM departments").map((d) => [d.name.toLowerCase(), d.id]));
    const result = { created: 0, updated: 0, merged: 0, renamed: [] as { row: number; from: string; to: string }[], warnings: [] as { row: number; reason: string }[], skipped: [] as { row: number; reason: string }[] };

    // Gom các dòng trước: trùng từ viết tắt + nội dung → gộp; trùng từ viết tắt khác nội dung → đặt tên mới
    type Item = { row: number; shortcut: string; content: string; image: string; file: string; ask: boolean; updated: string; depts: number[]; hasDepts: boolean };
    const items: Item[] = [];
    const seen = new Map<string, Item>();
    for (const r of rows) {
      let shortcut = cleanShortcut(r.get("shortcut"));
      const content = r.get("content");
      if (!shortcut || !content) {
        result.skipped.push({ row: r.row, reason: "Thiếu từ viết tắt hoặc nội dung" });
        continue;
      }
      const d = parseDeptCell(r.get("departments"), byName);
      if (d.unknown.length) {
        result.skipped.push({ row: r.row, reason: `Không có bộ phận: ${d.unknown.join(", ")}` });
        continue;
      }
      let image = "";
      let file = "";
      try {
        image = cleanUrl(r.get("image"));
        file = cleanUrl(r.get("file"));
      } catch (e: any) {
        result.warnings.push({ row: r.row, reason: e.message });
      }
      const prev = seen.get(shortcut.toLowerCase());
      if (prev && prev.content === content) {
        prev.image ||= image;
        prev.file ||= file;
        prev.ask ||= yes(r.get("ask"));
        result.merged++;
        continue;
      }
      if (prev) {
        const base = shortcut;
        let n = 2;
        while (seen.has(`${base}-${n}`.toLowerCase())) n++;
        shortcut = `${base}-${n}`;
        result.renamed.push({ row: r.row, from: base, to: shortcut });
      }
      const item = { row: r.row, shortcut, content, image, file, ask: yes(r.get("ask")), updated: r.get("updated"), depts: d.ids, hasDepts: !!r.get("departments") };
      seen.set(shortcut.toLowerCase(), item);
      items.push(item);
    }

    // Tải ảnh / tệp (ngoài transaction), mỗi link chỉ tải 1 lần
    const cache = new Map<string, Promise<any>>();
    const once = (key: string, fn: () => Promise<any>) => {
      if (!cache.has(key)) cache.set(key, fn().catch((e) => ({ error: e.message })));
      return cache.get(key)!;
    };
    const media = new Map<Item, { image_file: string | null; file_file: string | null; file_name: string | null }>();
    for (const it of items) {
      const cur = get<any>("SELECT image_url, image_file, file_url, file_file, file_name FROM templates WHERE lower(shortcut) = lower(?)", it.shortcut);
      const m = { image_file: cur && cur.image_url === it.image ? cur.image_file : null, file_file: cur && cur.file_url === it.file ? cur.file_file : null, file_name: cur && cur.file_url === it.file ? cur.file_name : null };
      if (it.image && !m.image_file) {
        const r = await once(`i:${it.image}`, () => fetchTemplateImage(it.image));
        if (r.error) result.warnings.push({ row: it.row, reason: `Ảnh: ${r.error}` });
        else m.image_file = r.file;
      }
      if (it.file && !m.file_file) {
        const r = await once(`f:${it.file}`, () => fetchTemplateFile(it.file));
        if (r.error) result.warnings.push({ row: it.row, reason: `Tệp: ${r.error}` });
        else {
          m.file_file = r.file;
          m.file_name = r.name;
        }
      }
      media.set(it, m);
    }

    tx(() => {
      for (const it of items) {
        const m = media.get(it)!;
        const up = it.updated ? parseUpdated(it.updated) : { label: null, at: null };
        const existing = get<{ id: number }>("SELECT id FROM templates WHERE lower(shortcut) = lower(?)", it.shortcut);
        let id = existing?.id;
        if (id) result.updated++;
        else {
          id = Number(run("INSERT INTO templates(shortcut, content, created_by, created_at) VALUES(?, ?, ?, ?)", it.shortcut, it.content, req.user!.id, Date.now()).lastInsertRowid);
          result.created++;
        }
        run(
          `UPDATE templates SET content = ?, image_url = ?, image_file = ?, file_url = ?, file_file = ?, file_name = ?, ask_address = ?,
             updated_by = ?, updated_at = ?, updated_label = ? WHERE id = ?`,
          it.content,
          it.image || null,
          m.image_file,
          it.file || null,
          m.file_file,
          m.file_name,
          it.ask ? 1 : 0,
          up.label ? null : req.user!.id,
          up.at ?? Date.now(),
          up.label,
          id,
        );
        if (it.hasDepts || !existing) setLinks("template_departments", "template_id", id, "department_id", it.depts);
      }
    });
    logEvent(null, req.user!.id, "templates.imported", { created: result.created, updated: result.updated, merged: result.merged });
    bus.emit("settings.changed", "templates");
    res.json(result);
  }),
);
