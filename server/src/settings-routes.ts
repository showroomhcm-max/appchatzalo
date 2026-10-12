/**
 * Cài đặt: kênh Zalo, bộ phận, tag, tin nhắn mẫu (+ xuất/nhập Excel).
 * Mọi thay đổi chỉ quản trị viên làm được; nhân viên chỉ đọc phần thuộc bộ phận của mình.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { all, get, run, tx, logEvent } from "./db.js";
import { requireAdmin } from "./auth.js";
import { HttpError } from "./conversations.js";
import { canUseChannel, departmentItemFilter, scopeOf } from "./access.js";
import { zalo } from "./zalo.js";
import { bus } from "./bus.js";

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
  return all<any>("SELECT id, name, zalo_uid, zalo_name, avatar, default_department_id, active, created_at FROM channels ORDER BY id").map(
    (c) => ({
      ...c,
      department_ids: deptLinks.get(c.id) ?? [],
      user_ids: isAdmin ? userLinks.get(c.id) ?? [] : undefined,
      conversations: isAdmin ? convCounts.get(c.id) ?? 0 : undefined,
      status: c.active ? zalo.session(c.id).getStatus() : null,
    }),
  );
}

settingsRouter.get("/channels", (req, res) => {
  const scope = scopeOf(req.user!);
  res.json(channelPayload(scope.all).filter((c) => scope.all || (c.active && canUseChannel(scope, c.id))));
});

settingsRouter.post(
  "/channels",
  requireAdmin,
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
  requireAdmin,
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!get("SELECT 1 FROM channels WHERE id = ?", id)) throw new HttpError(404, "Không tìm thấy kênh");
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
    if (b.active !== undefined) {
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
  requireAdmin,
  h(async (req, res) => {
    const id = Number(req.params.id);
    const n = get<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE channel_id = ?", id)!.n;
    if (n > 0) throw new HttpError(400, `Kênh còn ${n} hội thoại (dữ liệu training). Hãy tắt kênh thay vì xóa.`);
    await zalo.remove(id);
    run("DELETE FROM channels WHERE id = ?", id);
    res.json({ ok: true });
  }),
);

const channelAction = (fn: (id: number) => unknown) =>
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!get("SELECT 1 FROM channels WHERE id = ? AND active = 1", id)) throw new HttpError(404, "Kênh không tồn tại hoặc đang tắt");
    await fn(id);
    res.json(zalo.session(id).getStatus());
  });
settingsRouter.post("/channels/:id/login-qr", requireAdmin, channelAction((id) => void zalo.session(id).startQRLogin()));
settingsRouter.post("/channels/:id/cancel", requireAdmin, channelAction((id) => zalo.session(id).cancelQR()));
settingsRouter.post(
  "/channels/:id/reconnect",
  requireAdmin,
  channelAction(async (id) => {
    await zalo.session(id).logout(false);
    await zalo.session(id).init();
  }),
);
settingsRouter.post("/channels/:id/logout", requireAdmin, channelAction((id) => zalo.session(id).logout(true)));

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

settingsRouter.post("/departments", requireAdmin, h((req, res) => res.json(saveDepartment(null, req.body))));
settingsRouter.patch("/departments/:id", requireAdmin, h((req, res) => res.json(saveDepartment(Number(req.params.id), req.body))));
settingsRouter.delete(
  "/departments/:id",
  requireAdmin,
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
  requireAdmin,
  h((req, res) => {
    const id = saveTag(null, req.body);
    res.json(tagPayload(req).find((t) => t.id === id));
  }),
);
settingsRouter.patch(
  "/tags/:id",
  requireAdmin,
  h((req, res) => {
    const id = saveTag(Number(req.params.id), req.body);
    bus.emit("settings.changed", "tags");
    res.json(tagPayload(req).find((t) => t.id === id));
  }),
);
settingsRouter.delete(
  "/tags/:id",
  requireAdmin,
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

function templatePayload(req: Request) {
  const scope = scopeOf(req.user!);
  const links = linkMap("template_departments", "template_id", "department_id");
  return all<any>(
    `SELECT t.id, t.shortcut, t.content, t.created_by FROM templates t
     WHERE ${departmentItemFilter(scope, "template_departments", "template_id", "t")} ORDER BY t.shortcut`,
  ).map((t) => ({ ...t, department_ids: links.get(t.id) ?? [] }));
}

function saveTemplate(id: number | null, b: any, userId: number) {
  return tx(() => {
    const shortcut = b?.shortcut !== undefined ? String(b.shortcut).trim().replace(/^\//, "").replace(/\s+/g, "-") : undefined;
    const content = b?.content !== undefined ? String(b.content).trim() : undefined;
    if (id === null) {
      if (!shortcut || !content) throw new HttpError(400, "Thiếu phím tắt hoặc nội dung");
      if (get("SELECT 1 FROM templates WHERE lower(shortcut) = lower(?)", shortcut)) throw new HttpError(400, `Phím tắt /${shortcut} đã có`);
      id = Number(run("INSERT INTO templates(shortcut, content, created_by, created_at) VALUES(?, ?, ?, ?)", shortcut, content, userId, Date.now()).lastInsertRowid);
    } else {
      if (!get("SELECT 1 FROM templates WHERE id = ?", id)) throw new HttpError(404, "Không tìm thấy tin nhắn mẫu");
      if (shortcut !== undefined) {
        if (!shortcut) throw new HttpError(400, "Phím tắt không được trống");
        if (get("SELECT 1 FROM templates WHERE lower(shortcut) = lower(?) AND id != ?", shortcut, id)) throw new HttpError(400, `Phím tắt /${shortcut} đã có`);
        run("UPDATE templates SET shortcut = ? WHERE id = ?", shortcut, id);
      }
      if (content !== undefined) {
        if (!content) throw new HttpError(400, "Nội dung không được trống");
        run("UPDATE templates SET content = ? WHERE id = ?", content, id);
      }
    }
    if (b?.department_ids !== undefined) setLinks("template_departments", "template_id", id, "department_id", ids(b.department_ids));
    return id;
  });
}

settingsRouter.get("/templates", (req, res) => res.json(templatePayload(req)));
settingsRouter.post(
  "/templates",
  requireAdmin,
  h((req, res) => {
    const id = saveTemplate(null, req.body, req.user!.id);
    res.json(templatePayload(req).find((t) => t.id === id));
  }),
);
settingsRouter.patch(
  "/templates/:id",
  requireAdmin,
  h((req, res) => {
    const id = saveTemplate(Number(req.params.id), req.body, req.user!.id);
    res.json(templatePayload(req).find((t) => t.id === id));
  }),
);
settingsRouter.delete("/templates/:id", requireAdmin, (req, res) => {
  run("DELETE FROM templates WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});

// ───────────── Xuất / nhập Excel ─────────────

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
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result ?? "");
  }
  return String(v);
}

async function sendWorkbook(res: Response, filename: string, sheet: string, headers: { header: string; key: string; width: number }[], rows: Record<string, string>[], note: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.columns = headers;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A804A" } };
  rows.forEach((r) => ws.addRow(r));
  ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  const help = wb.addWorksheet("Hướng dẫn");
  help.getColumn(1).width = 110;
  note.split("\n").forEach((line) => help.addRow([line]));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

async function readSheet(file: Express.Multer.File | undefined) {
  if (!file) throw new HttpError(400, "Chọn file Excel (.xlsx)");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as any);
  } catch {
    throw new HttpError(400, "File không phải Excel .xlsx hợp lệ");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, "File Excel trống");
  const rows: { row: number; cells: string[] }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return; // dòng tiêu đề
    const cells = [1, 2, 3].map((i) => cellText(row.getCell(i).value).trim());
    if (cells.some(Boolean)) rows.push({ row: n, cells });
  });
  return rows;
}

const DEPT_NOTE = "Cột Bộ phận: ghi tên bộ phận đúng như trong app, nhiều bộ phận cách nhau dấu phẩy. Để trống = dùng chung cho mọi bộ phận.";

settingsRouter.get(
  "/tags/export.xlsx",
  requireAdmin,
  h(async (_req, res) => {
    const names = deptNames();
    const links = linkMap("tag_departments", "tag_id", "department_id");
    const rows = all<{ id: number; name: string; color: string }>("SELECT id, name, color FROM tags ORDER BY name").map((t) => ({
      name: t.name,
      color: t.color,
      departments: (links.get(t.id) ?? []).map((d) => names.get(d)).filter(Boolean).join(", "),
    }));
    await sendWorkbook(
      res,
      "tag-zalo-cskh.xlsx",
      "Tag",
      [
        { header: "Tên tag", key: "name", width: 30 },
        { header: "Màu (#RRGGBB)", key: "color", width: 16 },
        { header: "Bộ phận", key: "departments", width: 40 },
      ],
      rows,
      `Nhập tag: mỗi dòng 1 tag. Tag trùng tên sẽ được cập nhật màu và bộ phận.\nCột Màu: mã màu dạng #0a804a (để trống = màu mặc định).\n${DEPT_NOTE}`,
    );
  }),
);

settingsRouter.post(
  "/tags/import",
  requireAdmin,
  upload.single("file"),
  h(async (req, res) => {
    const rows = await readSheet(req.file);
    const byName = new Map(all<{ id: number; name: string }>("SELECT id, name FROM departments").map((d) => [d.name.toLowerCase(), d.id]));
    const result = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };
    tx(() => {
      for (const { row, cells } of rows) {
        const [name, col, depts] = cells;
        if (!name) {
          result.skipped.push({ row, reason: "Thiếu tên tag" });
          continue;
        }
        const d = parseDeptCell(depts, byName);
        if (d.unknown.length) {
          result.skipped.push({ row, reason: `Không có bộ phận: ${d.unknown.join(", ")}` });
          continue;
        }
        const existing = get<{ id: number }>("SELECT id FROM tags WHERE lower(name) = lower(?)", name);
        if (existing) {
          if (col) run("UPDATE tags SET color = ? WHERE id = ?", color(col, "#97c354"), existing.id);
          setLinks("tag_departments", "tag_id", existing.id, "department_id", d.ids);
          result.updated++;
        } else {
          const id = Number(run("INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)", name, color(col, "#97c354"), Date.now()).lastInsertRowid);
          setLinks("tag_departments", "tag_id", id, "department_id", d.ids);
          result.created++;
        }
      }
    });
    bus.emit("settings.changed", "tags");
    res.json(result);
  }),
);

settingsRouter.get(
  "/templates/export.xlsx",
  requireAdmin,
  h(async (_req, res) => {
    const names = deptNames();
    const links = linkMap("template_departments", "template_id", "department_id");
    const rows = all<{ id: number; shortcut: string; content: string }>("SELECT id, shortcut, content FROM templates ORDER BY shortcut").map(
      (t) => ({
        shortcut: t.shortcut,
        content: t.content,
        departments: (links.get(t.id) ?? []).map((d) => names.get(d)).filter(Boolean).join(", "),
      }),
    );
    await sendWorkbook(
      res,
      "tin-nhan-mau-zalo-cskh.xlsx",
      "Tin nhắn mẫu",
      [
        { header: "Phím tắt", key: "shortcut", width: 18 },
        { header: "Nội dung", key: "content", width: 80 },
        { header: "Bộ phận", key: "departments", width: 30 },
      ],
      rows,
      `Nhập tin nhắn mẫu: mỗi dòng 1 mẫu. Phím tắt viết liền không dấu cách (vd: chao, tragop). Trong ô chat gõ /phím-tắt để chèn.\nPhím tắt trùng sẽ được cập nhật nội dung và bộ phận. Nội dung xuống dòng bằng Alt+Enter trong Excel.\n${DEPT_NOTE}`,
    );
  }),
);

settingsRouter.post(
  "/templates/import",
  requireAdmin,
  upload.single("file"),
  h(async (req, res) => {
    const rows = await readSheet(req.file);
    const byName = new Map(all<{ id: number; name: string }>("SELECT id, name FROM departments").map((d) => [d.name.toLowerCase(), d.id]));
    const result = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };
    tx(() => {
      for (const { row, cells } of rows) {
        const shortcut = cells[0].replace(/^\//, "").replace(/\s+/g, "-");
        const content = cells[1];
        if (!shortcut || !content) {
          result.skipped.push({ row, reason: "Thiếu phím tắt hoặc nội dung" });
          continue;
        }
        const d = parseDeptCell(cells[2], byName);
        if (d.unknown.length) {
          result.skipped.push({ row, reason: `Không có bộ phận: ${d.unknown.join(", ")}` });
          continue;
        }
        const existing = get<{ id: number }>("SELECT id FROM templates WHERE lower(shortcut) = lower(?)", shortcut);
        if (existing) {
          run("UPDATE templates SET content = ? WHERE id = ?", content, existing.id);
          setLinks("template_departments", "template_id", existing.id, "department_id", d.ids);
          result.updated++;
        } else {
          const id = Number(
            run("INSERT INTO templates(shortcut, content, created_by, created_at) VALUES(?, ?, ?, ?)", shortcut, content, req.user!.id, Date.now())
              .lastInsertRowid,
          );
          setLinks("template_departments", "template_id", id, "department_id", d.ids);
          result.created++;
        }
      }
    });
    res.json(result);
  }),
);
